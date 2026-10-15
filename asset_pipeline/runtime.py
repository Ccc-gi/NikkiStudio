"""Demand-driven local exports. No game assets belong in the source tree."""
import json
import os
import re
import shutil
import struct
import subprocess
import tempfile
import threading
import queue
import time
from contextlib import contextmanager
from concurrent.futures import Future
from pathlib import Path
from backend.config import load_keys, usmap_header
from backend.storage import digest, write_json
from asset_pipeline.iostore import fingerprint, index
from adapters.paperbin import parse as parse_paperbin
from adapters.build_rules import parse as parse_build_rules
from adapters import build_area as build_area_data
from adapters.blueprint_transforms import BlueprintTransforms
from adapters.archive_order import select_current
from adapters.paperbin_dye import parse_dye
from adapters.paperbin_catalog import parse_catalog


def glb_document(path):
    with Path(path).open('rb') as stream:
        header = stream.read(20)
        if len(header) != 20:
            raise ValueError('Truncated GLB')
        magic, version, length, size, kind = struct.unpack('<5I', header)
        if magic != 0x46546C67 or version != 2 or kind != 0x4E4F534A or length != Path(path).stat().st_size or size > length - 20:
            raise ValueError('Invalid GLB')
        doc = json.loads(stream.read(size))
    if not doc.get('meshes') or not doc.get('accessors') or not doc.get('scenes'):
        raise ValueError('GLB has no usable scene geometry')
    for image in doc.get('images', []):
        uri = image.get('uri')
        if uri and not uri.startswith('data:'):
            target = (Path(path).parent / uri).resolve()
            if not target.is_relative_to(Path(path).parent.resolve()) or not target.is_file():
                raise ValueError('Missing or unsafe GLB image dependency')
    return doc


def package_path(package):
    if package.startswith('/Game/'):
        package = 'X6Game/Content/' + package.removeprefix('/Game/').split('.', 1)[0] + '.uasset'
    p = Path(package)
    if p.is_absolute() or '..' in p.parts or ':' in package or not package.startswith('X6Game/Content/'):
        raise ValueError('Invalid resource path')
    return p.as_posix()


class Runtime:
    def __init__(self, config, storage, progress=lambda _: None):
        config = {**config, 'cacheEpoch': storage.cache_epoch()}
        self.config, self.storage, self.progress = config, storage, progress
        self.keys = load_keys(config)
        usmap_header(Path(config['usmapFile']).read_bytes())
        self.version, self.inputs = fingerprint(config)
        self.directory = storage.cache / self.version
        self.lock = threading.RLock()
        self.records = []
        self.by_package = {}
        self.report = []
        self.rows = {}
        self.mapping = {}
        self.metadata = {}
        self.constraints = {}
        self.build_area = {}
        self.dye_configs = {}
        self.dye_schemes = {}
        self.catalog_items = {}
        self.catalog_categories = {}
        self.catalog_report = {}
        self.ui_packages = set()
        self._ui_sources = {}
        self.worker = None
        self._worker_guard = threading.Lock()
        self.metrics = {'exportProcesses': 0, 'cacheHits': 0, 'batchedModels': 0, 'modelBatches': 0}
        self._asset_guard = threading.Lock()
        self._publish_guard = threading.Lock()
        self._asset_pending = {}
        self._asset_queue = queue.Queue()
        self._asset_thread = None
        self._fingerprint_guard = threading.Lock()
        self._last_fingerprint_check = 0
        self._last_current = False

    def mount(self):
        self.records, self.report = index(Path(self.config['gameRoot']), self.keys, self.progress)
        for row in self.records:
            self.by_package.setdefault(row['package'], []).append(row)
        invalid = [r for r in self.report if r['status'] == 'invalid_key_or_index']
        if invalid:
            detail = '; '.join(r['archive'] + ' GUID ' + r['guid'] + ' ' + r['status'] for r in invalid)
            raise ValueError('部分资源包未通过校验，保持旧缓存。' + detail)
        self.missing_keys = [r for r in self.report if r['status'] == 'missing_key']
        paper = Path(self.config['gameRoot']) / 'X6Game/Saved/PaperBin'
        if not paper.is_file():
            raise ValueError('缺少 X6Game/Saved/PaperBin，请先进入游戏加载家园配置')
        paper_data = paper.read_bytes()
        self.rows = {str(k): v for k, v in parse_paperbin(paper_data).items()}
        # The game states each item's own build limits, so the editor's
        # 建造合法性 switch and the save check need nothing from the user.
        for ident, rule in parse_build_rules(paper_data).items():
            self.constraints[str(ident)] = rule
        self.build_area = {'polygons': build_area_data.POLYGONS,
                           'unlocks': build_area_data.UNLOCKS}
        self.dye_configs = parse_dye(paper_data)
        # The presets each item offers, as area*10 + choice, so the save check can
        # tell a dye the item supports from one it does not.
        self.dye_schemes = {}
        for ident, config in self.dye_configs.items():
            codes = sorted({int(group) * 10 + int(choice)
                            for group, choices in config.items()
                            for choice in choices if int(choice)})
            if codes:
                self.dye_schemes[ident] = codes
        try:
            self.catalog_items,self.catalog_categories,self.catalog_report=parse_catalog(paper_data,self.rows)
            write_json(self.directory/'catalog-v1.json',{'items':self.catalog_items,'categories':self.catalog_categories,'report':self.catalog_report})
        except ValueError as error:
            self.catalog_report={'schema':1,'state':'incompatible','error':str(error)}
        for row in [*self.catalog_items.values(),*self.catalog_categories.values()]:
            if row.get('sourceIcon'):self.icon_url(row['sourceIcon'])
        for config in self.dye_configs.values():
            for choices in config.values():
                for entry in choices.values():
                    entry['icon']=self.icon_url(entry.get('sourceIcon'))
        if self.config.get('metadataFile'):
            db = json.loads(Path(self.config['metadataFile']).read_text(encoding='utf-8-sig'))
            if not isinstance(db, dict) or not isinstance(db.get('d'), list):
                raise ValueError('可选元数据必须是 BuildingMomo 家具数据 JSON')
            for ident, values in db['d']:
                self.metadata[str(ident)] = {'name': values[0], 'size': values[3],
                                             'dye': values[7] if len(values) > 7 else None}
        # Resolve templates through the current game's JSON exports, never legacy reports.
        probe = next((c['package'] for r in self.rows.values() for c in r['components']
                      if len(self.by_package.get(c['package'], [])) == 1), None)
        if not probe:
            raise ValueError('家具配置与当前资源索引不匹配')
        self.directory.mkdir(parents=True, exist_ok=True)
        self.progress('解析探针：验证 usmap 关键字段与实际模型')
        with tempfile.TemporaryDirectory(prefix='probe-', dir=self.directory) as temp:
            output = Path(temp)
            self.export([probe], output / 'json', 'json')
            objects = self.read_objects(output / 'json', probe)
            if not any(o.get('Type') in ('StaticMesh', 'SkeletalMesh') and isinstance(o.get('Properties'), dict)
                       and ('Materials' in o['Properties'] or 'StaticMaterials' in o['Properties']) for o in objects):
                raise ValueError('usmap 实际解析探针失败：缺少网格及材质字段')
            self.export([probe], output / 'mesh', 'mesh')
            glb_document(output / 'mesh' / Path(probe).with_suffix('.glb'))
        self.progress('建立按需家具映射')
        for ident, row in self.rows.items():
            components = [dict(c, path=self.asset_url(c['package'])) for c in row['components'] if c['package'] in self.by_package]
            if components:
                self.mapping[ident] = {**row, 'path': components[0]['path'], 'components': components,
                                       'expected_components': len(row['components']),
                                       'complete': row.get('complete', True) and len(components) == len(row['components'])}
        write_json(self.directory / 'scene_mapping.json', self.mapping)
        write_json(self.directory / 'manifest.json', {'schema': 1, 'version': self.version,
                   'inputs': self.inputs, 'archives': self.report, 'types': len(self.mapping),
                   'limitations': 'Blueprint runtime animation and unsupported PaperBin records use placeholders.'})
        if fingerprint(self.config)[0] != self.version:
            raise ValueError('校验期间游戏文件发生变化，请等待游戏更新结束后重试')
        self.storage.activate(self.directory)

    def asset_url(self, package):
        return '/asset/' + self.version + '/' + str(Path(package).with_suffix('.glb')).replace('\\', '/')

    def current(self, force=False):
        # Coalesce simultaneous browser requests; committing converted output always
        # forces a fresh snapshot check. Update recognition is delayed at most one second.
        with self._fingerprint_guard:
            now = time.monotonic()
            if force or now - self._last_fingerprint_check >= 1:
                self._last_current = fingerprint(self.config)[0] == self.version
                self._last_fingerprint_check = time.monotonic()
            return self._last_current

    def select(self, package):
        rows = self.by_package.get(package, [])
        if not rows:
            raise ValueError('当前游戏未找到资源：' + package)
        # Ambiguous patch precedence must not silently pick the first inventory row.
        try:
            return select_current(rows)
        except ValueError:
            raise ValueError('资源存在同优先级归档，覆盖顺序尚未验证：' + package) from None

    def export(self, packages, output, fmt):
        if not packages:
            raise ValueError('禁止空选择器导出')
        if fmt == 'ktx2' and not self.config.get('parserWorker'):
            fmt = 'png'
        if fmt in ('json', 'png', 'ktx2'):
            pending = []
            for package in packages:
                file = Path(output) / Path(package_path(package)).with_suffix('.json' if fmt == 'json' else '.png')
                hit = False
                if fmt == 'json' and file.exists():
                    try:
                        self.read_objects(output, package_path(package))
                        hit = True
                    except (ValueError, OSError):
                        pass
                elif fmt in ('png', 'ktx2'):
                    hit = file.exists() or file.with_name(file.stem + '_LAYER0.png').exists()
                    if fmt == 'ktx2':
                        hit = hit or file.with_suffix('.ktx2').exists() or file.with_name(file.stem + '_LAYER0.ktx2').exists()
                if hit:
                    self.metrics['cacheHits'] += 1
                else:
                    pending.append(package)
            packages = pending
            if not packages:
                return
        if self.config.get('parserWorker'):
            for package in packages:
                self.select(package_path(package))
            with self._worker_guard:
                if self.worker is None:
                    from asset_pipeline.worker import ParserWorker
                    self.worker = ParserWorker(self.config['parserWorker'], self.config,
                                               self.storage.cache / 'parser-temp')
                    self.metrics['exportProcesses'] += 1
                    self.metrics['workerMountSeconds'] = self.worker.info['seconds']
            result = self.worker.export(sorted(set(package_path(p) for p in packages)), output, fmt)
            self.metrics.setdefault('workerProfile', []).append({'format': fmt, 'packages': len(packages), 'seconds': result['seconds']})
            if result.get('errors'):
                self.metrics.setdefault('unsupportedExports', []).extend(result['errors'])
            self.metrics['workerRequests'] = self.metrics.get('workerRequests', 0) + 1
            return
        groups = {}
        for package in sorted(set(package_path(p) for p in packages)):
            row = self.select(package)
            groups.setdefault(row['guid'], []).append(row)
        for guid, rows in groups.items():
            for start in range(0, len(rows), 60):
                batch = rows[start:start + 60]
                with self.staging_directory(batch) as temp:
                    stage = Path(temp)
                    tocs = {Path(r['archive']) for r in batch}
                    # IoStore global metadata is a dependency even when not selected.
                    root = Path(self.config['gameRoot']) / 'X6Game'
                    tocs.update(p for base in [root / 'Content/Paks', root / 'Saved/Paks']
                                if base.exists() for p in base.rglob('global.utoc'))
                    sources = {}
                    for toc in tocs:
                        siblings = [toc] + list(toc.parent.glob(toc.stem + '*.ucas')) + [toc.with_suffix('.pak')]
                        for src in siblings:
                            if not src.exists():
                                continue
                            if src.name in sources and sources[src.name] != src:
                                raise ValueError('staging 文件名冲突：' + src.name)
                            sources[src.name] = src
                    copy_size = sum(src.stat().st_size for src in sources.values()
                                    if src.suffix != '.utoc' and src.drive.lower() != stage.drive.lower())
                    if copy_size and shutil.disk_usage(stage).free < copy_size + 512 * 1024 ** 2:
                        raise ValueError('跨盘临时复制空间不足，请将用户数据目录设到游戏所在盘')
                    for name, src in sources.items():
                        dst = stage / name
                        if src.suffix == '.utoc':
                            raw = bytearray(src.read_bytes())
                            raw[64:80] = bytes(16)
                            dst.write_bytes(raw)
                        else:
                            try:
                                os.link(src, dst)
                            except OSError:
                                if shutil.disk_usage(stage).free < src.stat().st_size + 512 * 1024 ** 2:
                                    raise ValueError('临时复制空间不足')
                                self.progress('跨卷或硬链接不可用，临时复制：' + src.name)
                                shutil.copyfile(src, dst)
                    command = [self.config['parser'], '-i', str(stage), '-o', str(output),
                               '-g', 'GAME_InfinityNikki', '-m', self.config['usmapFile'], '-y']
                    if any(r['encrypted'] for r in batch):
                        command += ['-k', self.keys[guid].hex()]
                    command += ['-f', fmt] if fmt in ('json', 'png') else ['--mesh-format', 'Gltf2', '--export-materials', 'true']
                    for row in batch:
                        command += ['-p', row['package']]
                    self.progress('按需转换 ' + str(len(batch)) + ' 项 ' + fmt)
                    try:
                        self.metrics['exportProcesses'] += 1
                        temp_directory = self.storage.cache / 'parser-temp'
                        temp_directory.mkdir(exist_ok=True)
                        env = {**os.environ, 'TEMP': str(temp_directory), 'TMP': str(temp_directory)}
                        result = subprocess.run(command, capture_output=True, timeout=360, env=env,
                                                creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
                    except subprocess.TimeoutExpired:
                        raise ValueError('资源转换超时，旧缓存仍保留') from None
                    if result.returncode:
                        # Child stdout/stderr can echo keys; never persist them verbatim.
                        raise ValueError('解析器转换失败，退出码 ' + str(result.returncode))

    @contextmanager
    def staging_directory(self, rows):
        """Keep temporary links on the game volume even when the cache lives elsewhere."""
        source = Path(rows[0]['archive'])
        temporary = None
        if source.drive.lower() != self.directory.drive.lower():
            # A sibling of the installation is outside all scanned game archive paths.
            # Never write temporary utoc copies inside Content/Paks or Saved/Paks.
            try:
                temporary = tempfile.TemporaryDirectory(prefix='.nikki-studio-stage-',
                                                         dir=Path(self.config['gameRoot']).parent)
            except OSError:
                self.progress('游戏盘临时目录不可写，将检查跨卷复制空间')
        temporary = temporary or tempfile.TemporaryDirectory(prefix='stage-', dir=self.directory)
        registry = self.storage.cache / 'staging-registry'
        registry.mkdir(exist_ok=True)
        record = registry / (Path(temporary.name).name + '.json')
        write_json(record, {'path': temporary.name, 'parent': str(Path(self.config['gameRoot']).parent.resolve())})
        try:
            yield temporary.name
        finally:
            temporary.cleanup()
            record.unlink(missing_ok=True)

    @staticmethod
    def read_objects(root, package):
        file = Path(root) / Path(package).with_suffix('.json')
        if not file.is_file():
            raise ValueError('解析器没有生成指定资源 JSON')
        objects = json.loads(file.read_text(encoding='utf-8-sig'))
        if not isinstance(objects, list) or not all(isinstance(o, dict) for o in objects):
            raise ValueError('解析器输出结构不兼容')
        return objects

    def asset(self, relative):
        p = Path(relative)
        if p.is_absolute() or '..' in p.parts or ':' in relative:
            raise ValueError('Invalid asset path')
        target = self.directory / 'assets' / p
        if target.is_file():
            self.metrics['cacheHits'] += 1
            return target
        if p.suffix != '.glb':
            raise FileNotFoundError('纹理尚未由模型导出')
        package = package_path(p.with_suffix('.uasset').as_posix())
        allowed = {c['package'] for r in self.mapping.values() for c in r['components']}
        if package not in allowed:
            raise ValueError('仅允许家具配置实际引用的模型')
        with self._asset_guard:
            future = self._asset_pending.get(package)
            if future is None:
                future = Future()
                self._asset_pending[package] = future
                self._asset_queue.put((package, future))
            if self._asset_thread is None:
                self._asset_thread = threading.Thread(target=self._export_model_batches, daemon=True)
                self._asset_thread.start()
        return future.result()

    def _export_model_batches(self):
        while True:
            try:
                first = self._asset_queue.get(timeout=10)
            except queue.Empty:
                with self._asset_guard:
                    if self._asset_queue.empty():
                        self._asset_thread = None
                        return
                continue
            batch = [first]
            deadline = time.monotonic() + .1
            while len(batch) < 256:
                try:
                    batch.append(self._asset_queue.get(timeout=max(0, deadline - time.monotonic())))
                except queue.Empty:
                    break
            accepted = []
            for package, future in batch:
                try:
                    self.select(package)
                    accepted.append((package, future))
                except Exception as exc:
                    future.set_exception(exc)
            try:
                if not accepted:
                    continue
                with tempfile.TemporaryDirectory(prefix='asset-batch-', dir=self.directory) as temp:
                    output = Path(temp)
                    self.export([p for p, _ in accepted], output, 'mesh')
                    results = {}
                    for package, future in accepted:
                        file = output / Path(package).with_suffix('.glb')
                        try:
                            glb_document(file)
                            results[package] = file
                        except Exception as exc:
                            future.set_exception(exc)
                    if not self.current(force=True):
                        raise ValueError('游戏在转换期间更新，未发布转换结果')
                    with self._publish_guard:
                        for file in output.rglob('*'):
                            if not file.is_file() or file.suffix == '.glb':
                                continue
                            destination = self.directory / 'assets' / file.relative_to(output)
                            destination.parent.mkdir(parents=True, exist_ok=True)
                            temporary = destination.with_name(destination.name + '.partial')
                            shutil.copyfile(file, temporary)
                            os.replace(temporary, destination)
                        for package, file in results.items():
                            target = self.directory / 'assets' / file.relative_to(output)
                            target.parent.mkdir(parents=True, exist_ok=True)
                            os.replace(file, target)
                    self.metrics['modelBatches'] += 1
                    self.metrics['batchedModels'] += len(results)
                    for package, future in accepted:
                        if not future.done():
                            future.set_result(self.directory / 'assets' / Path(package).with_suffix('.glb'))
            except Exception as exc:
                for _, future in accepted:
                    if not future.done():
                        future.set_exception(exc)
            finally:
                with self._asset_guard:
                    for package, _ in batch:
                        self._asset_pending.pop(package, None)

    def resolve_item(self, ident):
        """Blueprint structure is resolved when an item is actually used, before GLB requests."""
        with self.lock:
            if ident in self.mapping:
                return self.mapping[ident]
            row = self.rows.get(ident)
            if not row or not row.get('blueprint'):
                return {'complete': False, 'limitations': 'No supported component references'}
            root = self.directory / 'properties'
            package = package_path(row['blueprint'])
            pending, visited = [package], set()
            while pending:
                current = pending.pop()
                if current in visited:
                    continue
                if len(visited) >= 64:
                    raise ValueError('Blueprint dependency limit exceeded')
                visited.add(current)
                file = root / Path(current).with_suffix('.json')
                if not file.exists():
                    self.export([current], root, 'json')
                for obj in self.read_objects(root, current):
                    if not any(kind in obj.get('Type', '') for kind in ('MeshComponent', 'SceneComponent')):
                        continue
                    template = (obj.get('Template') or {}).get('ObjectPath', '')
                    if template.startswith('/Game/') and package_path(template) in self.by_package:
                        pending.append(package_path(template))
            hierarchy = BlueprintTransforms([root])
            bp = row['blueprint']
            components, unresolved = [], []
            for obj in self.read_objects(root, package):
                if 'MeshComponent' not in obj.get('Type', '') or not obj.get('Name', '').endswith('_GEN_VARIABLE'):
                    continue
                props = obj.get('Properties') or {}
                mesh = props.get('StaticMesh') or props.get('SkeletalMesh')
                if not mesh or not mesh.get('ObjectPath') or props.get('bHiddenInGame') or props.get('bVisible') is False:
                    continue
                target = package_path(mesh['ObjectPath'])
                try:
                    if target not in self.by_package:
                        raise ValueError('Missing mesh')
                    matrix, chain = hierarchy.component(bp, obj['Name'])
                    components.append({'package': target, 'path': self.asset_url(target),
                                       'matrix': matrix.T.reshape(-1).tolist(), 'component_name': obj['Name'],
                                       'blueprintAttachmentChain': chain})
                except (ValueError, KeyError) as exc:
                    unresolved.append(str(exc))
            result = {'path': components[0]['path'] if components else None, 'components': components,
                      'transformSpace': 'actor', 'complete': False, 'limitations':
                      'Blueprint reference pose; runtime effects unsupported', 'unresolved': unresolved}
            self.mapping[ident] = result
            write_json(self.directory / 'scene_mapping.json', self.mapping)
            return result

    def materials(self, relative):
        """Exact UE material references; no global same-name texture guessing."""
        with self.lock:
            from asset_pipeline.materials import prepare_materials
            package = package_path(Path(relative).with_suffix('.uasset').as_posix())
            prepare_materials(self, [package])
            return json.loads((self.directory / 'materials' / Path(package).with_suffix('.json')).read_text(encoding='utf-8'))
    def prepare_scene(self, items):
        from asset_pipeline.materials import prepare_materials
        started = time.monotonic()
        ids = sorted(set(str(item['id']) for item in items))
        self.scene_progress = {'state': 'running', 'message': '批量解析家具配置'}
        for ident in ids:
            if ident not in self.mapping:
                self.resolve_item(ident)
        packages = sorted({c['package'] for ident in ids for c in self.mapping.get(ident, {}).get('components', [])})
        self.scene_progress = {'state': 'running', 'message': f'批量转换 {len(packages)} 个模型'}
        # Enqueue the entire scene before waiting; browser decode limits no longer
        # force the parser into batches of just six packages.
        futures = []
        with self._asset_guard:
            for package in packages:
                target = self.directory / 'assets' / Path(package).with_suffix('.glb')
                if target.exists():
                    continue
                future = self._asset_pending.get(package)
                if future is None:
                    future = Future()
                    self._asset_pending[package] = future
                    self._asset_queue.put((package, future))
                futures.append(future)
            if futures and self._asset_thread is None:
                self._asset_thread = threading.Thread(target=self._export_model_batches, daemon=True)
                self._asset_thread.start()
        errors = []
        for future in futures:
            try:
                future.result()
            except Exception as exc:
                errors.append(str(exc))
        models_seconds = time.monotonic() - started
        self.prepared_geometry = {'mapping': {ident: self.mapping.get(ident, {}) for ident in ids},
                                  'modelsSeconds': models_seconds, 'allSeconds': models_seconds,
                                  'dye': self.dye_manifest(ids)}
        self.scene_progress = {'state': 'running', 'message': '合批解析材质依赖与染色贴图'}
        with self.lock:
            prepare_materials(self, packages)
        result = {'mapping': {ident: self.mapping.get(ident, {}) for ident in ids},
                  'modelsSeconds': models_seconds, 'allSeconds': time.monotonic() - started,
                  'models': len(packages), 'errors': errors, 'dye': self.dye_manifest(ids)}
        result['materials'] = {self.asset_url(package): json.loads((self.directory / 'materials' / Path(package).with_suffix('.json')).read_text()) for package in packages}
        self.scene_progress = {'state': 'ready', 'message': '资源转换完成',
                               **{k: result[k] for k in ('modelsSeconds', 'allSeconds', 'models', 'errors')}}
        return result

    def dye_manifest(self, ids=None):
        parts = {}
        for ident in ids or self.mapping:
            offset, rows = 0, []
            for component in self.mapping.get(ident, {}).get('components', []):
                file = self.directory / 'assets' / Path(component['package']).with_suffix('.glb')
                try:
                    count = sum(len(m['primitives']) for m in glb_document(file)['meshes'])
                except (OSError, ValueError, KeyError):
                    count = 0
                rows.append({'offset': offset, 'count': count})
                offset += count
            parts[ident] = rows
        from adapters.paperbin_dye import resolve_slots
        configs = {ident: resolve_slots(config, parts.get(ident, [])) for ident, config in self.dye_configs.items()}
        return {'configs': configs, 'materials': {}, 'parts': parts}

    def catalog(self):
        return {ident: {'name': self.catalog_items.get(ident, {}).get('name',self.metadata.get(ident, {}).get('name', '家具 ' + ident)),
                        'size': self.metadata.get(ident, {}).get('size', [100, 100, 100]),
                        'categoryId':self.catalog_items.get(ident,{}).get('categoryId','0'),
                        'categorySource':'current-game PaperBin',
                        'previewIcon':self.icon_url(self.catalog_items.get(ident,{}).get('sourceIcon')) or '/placeholder.svg'} for ident in self.rows}

    def categories(self):
        return {'categories':{ident:{**row,'icon':self.icon_url(row.get('sourceIcon')) or '/placeholder.svg'}
                              for ident,row in self.catalog_categories.items()},'report':self.catalog_report}

    # Per-item build limits plus the buildable area, for the editor's 建造合法性
    # switch and the save check. The limits are read from the game's own records,
    # so the feature works without the optional furniture data, and the plot
    # regions ship with the editor.
    def validation_rules(self):
        return {'source': 'game PaperBin',
                'version': self.version,
                'constraints': self.constraints,
                'dyeSchemes': self.dye_schemes,
                'polygons': self.build_area.get('polygons', {}),
                'unlocks': self.build_area.get('unlocks', [])}

    def icon_url(self,reference):
        if not reference:return None
        package=package_path(reference)
        source=package
        if source not in self.by_package:
            p=Path(package).relative_to('X6Game/Content')
            source=(Path('X6Game/Content/__ExternalPaper2dAtlas__/SaveAtlas')/p.parent/'__Frames'/(p.stem+'_PNG.uasset')).as_posix()
            if source not in self.by_package:return None
        self._ui_sources[package]=source
        self.ui_packages.add(package)
        return '/api/icon/'+self.version+'/'+Path(package).with_suffix('.png').as_posix()

    def icon(self,relative):
        if Path(relative).suffix!='.png':raise ValueError('Invalid UI icon type')
        package=package_path(Path(relative).with_suffix('.uasset').as_posix())
        if package not in self.ui_packages:raise ValueError('Icon is not referenced by current game configuration')
        root=self.directory/'ui-icons';target=root/Path(package).with_suffix('.png')
        with self.lock:
            if not target.is_file():
                from asset_pipeline.ui_icons import export_icon
                export_icon(self,self._ui_sources[package],target,root)
        if not target.is_file():raise FileNotFoundError('Referenced game icon could not be exported')
        return target

    def texture_fallback(self, relative):
        path = Path(relative)
        if path.is_absolute() or '..' in path.parts or ':' in relative or path.suffix != '.png':
            raise ValueError('Invalid texture fallback path')
        root = self.directory / 'assets'
        target = root / path
        if target.exists():
            return target
        if not target.with_suffix('.ktx2').exists():
            raise ValueError('Only an already prepared texture may request fallback')
        package = path.with_name(re.sub(r'_LAYER\d+$', '', path.stem)).with_suffix('.uasset').as_posix()
        with self.lock:
            self.export([package], root, 'png')
        if not target.exists():
            raise FileNotFoundError('Texture fallback unavailable')
        return target
