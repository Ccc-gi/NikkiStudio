"""Loopback-only UI/API with private state outside the served directory."""
import base64
import json
import mimetypes
import secrets
import threading
import time
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit
from backend.config import save_config
from backend.presets import Presets
from backend.preset_previews import PresetPreviews
from backend.storage import Storage, write_json
from asset_pipeline.runtime import Runtime

ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']


def bundled_parser():
    return next((p for p in (ROOT / 'parser-worker/Nikki.AssetWorker.exe',
                             ROOT / 'local/parser-worker-mips/Nikki.AssetWorker.exe',
                             ROOT / 'local/parser-worker-next/Nikki.AssetWorker.exe',
                             ROOT / 'local/parser-worker/Nikki.AssetWorker.exe') if p.is_file()), None)


def source_runtime_config(config):
    """Move legacy release-folder references to an installed source dependency."""
    config = dict(config)
    worker = bundled_parser()
    if not worker:
        return config
    release_root = (ROOT / 'dist').resolve()
    uses_release = any(config.get(key) and Path(config[key]).resolve().is_relative_to(release_root)
                       for key in ('parser', 'parserWorker'))
    packaged = ROOT / 'parser-worker/Nikki.AssetWorker.exe'
    if packaged.is_file() or uses_release:
        config['parser'] = str(worker)
        config['parserWorker'] = str(worker)
    elif not config.get('parserWorker'):
        config['parserWorker'] = str(worker)
    return config


class Application:
    def __init__(self, storage=None):
        self.storage = storage or Storage()
        self.presets = Presets(self.storage.root)
        self.token = secrets.token_urlsafe(32)
        self.runtime = None
        self.preset_previews = PresetPreviews(self.storage, self.presets,
                                            lambda: self.runtime.version if self.runtime else 'unconfigured')
        self.job = {'state': 'idle', 'message': '请选择游戏和输入文件'}
        self.job_lock = threading.Lock()
        self.scene_lock = threading.Lock()
        self.scene_result = None
        self.scene_id = None

    def configure(self, values):
        if not self.job_lock.acquire(blocking=False):
            raise ValueError('校验任务正在执行')
        try:
            worker = bundled_parser()
            config = save_config(self.storage, values['gameRoot'], values['keys'],
                                 base64.b64decode(values['usmap'], validate=True), str(worker) if worker else values.get('parser', ''),
                                 values.get('metadataFile'))
            if worker:
                config['parserWorker'] = str(worker)
        except Exception:
            self.job_lock.release()
            raise
        self.start(config, locked=True)

    def start(self, config=None, locked=False):
        if not locked and not self.job_lock.acquire(blocking=False):
            raise ValueError('校验任务正在执行')
        config = config or self.storage.config()
        if not config:
            self.job_lock.release()
            raise ValueError('尚未完成配置')
        config = source_runtime_config(config)
        self.job = {'state': 'running', 'message': '正在校验输入'}
        def work():
            try:
                runtime = Runtime(config, self.storage, self.progress)
                runtime.mount()
                write_json(self.storage.private / 'config.json', config)
                previous = self.runtime
                self.runtime = runtime
                if previous and previous.worker:
                    previous.worker.close()
                warning = ('；有 ' + str(len(runtime.missing_keys)) + ' 个归档缺少密钥，资源覆盖不完整'
                           if runtime.missing_keys else '')
                self.job = {'state': 'ready', 'message': '校验通过，模型将在请求时转换' + warning}
            except Exception as exc:
                self.job = {'state': 'failed', 'message': str(exc)}
            finally:
                self.job_lock.release()
        threading.Thread(target=work, daemon=True).start()

    def progress(self, message):
        if self.job_lock.locked():
            self.job = {'state': 'running', 'message': message}

    def status(self, force=True):
        changed = False
        if self.runtime:
            try:
                changed = not self.runtime.current(force=force)
            except OSError:
                changed = True
        active = self.storage.active()
        return {'configured': self.storage.config() is not None, 'ready': self.runtime is not None,
                'changed': changed, 'job': self.job, 'hasOldCache': active is not None,
                'version': self.runtime.version[:16] if self.runtime else None,
                'archives': self.runtime.report if self.runtime else [],
                'performance': dict(self.runtime.metrics) if self.runtime else {},
                'scene': getattr(self.runtime, 'scene_progress', None),
                'dataDirectory': str(self.storage.root), 'cacheDirectory': str(self.storage.cache)}


def handler_for(app):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.1'
        def log_message(self, *_):
            pass

        def valid_host(self):
            return self.headers.get('Host') in (f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}')

        def send(self, body, content='application/json; charset=utf-8', status=200):
            if not isinstance(body, bytes):
                body = json.dumps(body, ensure_ascii=False).encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type', content)
            self.send_header('Content-Length', str(len(body)))
            # The managed disk cache is authoritative; avoid unmanaged browser duplicates.
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Referrer-Policy', 'no-referrer')
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if not self.valid_host():
                return self.send({'error': 'Invalid Host'}, status=403)
            path = unquote(urlsplit(self.path).path)
            try:
                if path == '/api/session':
                    return self.send({'application': 'NikkiStudio', 'version': VERSION, 'api': 1, 'token': app.token,
                                      'capabilities': {'bundledParser': bundled_parser() is not None}, 'status': app.status()})
                if path == '/api/game-candidates':
                    from backend.discovery import find_games
                    return self.send({'paths': find_games()})
                if path == '/api/status':
                    return self.send(app.status(force=urlsplit(self.path).query != 'fast=1'))
                if path == '/api/cache':
                    from backend.cache_management import inventory
                    return self.send(inventory(app.storage))
                if path == '/api/scene-result':
                    return self.send({'id': app.scene_id, 'running': app.scene_lock.locked(), 'result': app.scene_result,
                                      'geometry': getattr(app.runtime, 'prepared_geometry', None)})
                if path.startswith('/api/item/'):
                    if not app.runtime or not app.runtime.current():
                        return self.send({'error': '请重新校验游戏资源'}, status=409)
                    return self.send(app.runtime.resolve_item(path.removeprefix('/api/item/')))
                if path.startswith('/api/material/'):
                    if not app.runtime or not app.runtime.current():
                        return self.send({'error': '请重新校验游戏资源'}, status=409)
                    version, relative = path.removeprefix('/api/material/').split('/', 1)
                    if version != app.runtime.version:
                        raise ValueError('Material version mismatch')
                    return self.send(app.runtime.materials(relative))
                if path.startswith('/api/texture-png/'):
                    if not app.runtime or not app.runtime.current():
                        raise ValueError('请先校验资源')
                    version, relative = path.removeprefix('/api/texture-png/').split('/', 1)
                    if version != app.runtime.version:
                        raise ValueError('Texture version mismatch')
                    return self.send(app.runtime.texture_fallback(relative).read_bytes(), 'image/png')
                if path.startswith('/api/icon/'):
                    if not app.runtime or not app.runtime.current():
                        return self.send({'error':'游戏资源已变化，请重新校验；旧图标缓存保留'},status=409)
                    version,relative=path.removeprefix('/api/icon/').split('/',1)
                    if version!=app.runtime.version:raise ValueError('Icon version mismatch')
                    return self.send(app.runtime.icon(relative).read_bytes(),'image/png')
                if path.startswith('/api/cached-material/'):
                    version, relative = path.removeprefix('/api/cached-material/').split('/', 1)
                    if len(version) != 64 or any(c not in '0123456789abcdef' for c in version):
                        raise ValueError('Invalid cache version')
                    base = app.storage.cache / version / 'materials'
                    file = (base / Path(relative).with_suffix('.json')).resolve()
                    if not file.is_relative_to(base.resolve()):
                        raise ValueError('Invalid cached material path')
                    slots = json.loads(file.read_text(encoding='utf-8')) if file.exists() else {}
                    for slot in slots.values():
                        for key, value in list(slot.items()):
                            if isinstance(value, str) and value.startswith('/asset/' + version + '/'):
                                slot[key] = value.replace('/asset/', '/cached-asset/', 1)
                    return self.send(slots)
                if path == '/':
                    path = '/setup.html'
                if path == '/api/saves':
                    config = app.storage.config()
                    folder = Path(config['gameRoot']) / 'X6Game/Saved/SavedData/BuildData' if config else None
                    return self.send({'files': [p.name for p in folder.glob('*SAVEDATA_*.json')]
                                      if folder and folder.exists() else []})
                if path.startswith('/api/save/'):
                    name = path.removeprefix('/api/save/')
                    if '/' in name or '\\' in name or not name.endswith('.json'):
                        raise ValueError('Invalid save name')
                    config = app.storage.config()
                    if not config:
                        raise ValueError('尚未配置')
                    file = Path(config['gameRoot']) / 'X6Game/Saved/SavedData/BuildData' / name
                    return self.send(file.read_bytes())
                if path == '/preview_version.json':
                    return self.send({'mapping': app.runtime.version[:10] if app.runtime else 'unconfigured'})
                if path == '/scene_mapping.json':
                    return self.send(app.runtime.mapping if app.runtime else {})
                if path == '/api/recovery-mapping':
                    active = app.storage.active()
                    mapping = json.loads((active / 'scene_mapping.json').read_text(encoding='utf-8')) if active else {}
                    for row in mapping.values():
                        available = []
                        for component in row.get('components', []):
                            relative = Path(component['package']).with_suffix('.glb').as_posix()
                            if (active / 'assets' / relative).is_file():
                                available.append({**component, 'path': '/cached-asset/' + active.name + '/' + relative})
                        row['components'] = available
                        row['path'] = available[0]['path'] if available else None
                    return self.send(mapping)
                if path == '/furniture_catalog.json':
                    return self.send(app.runtime.catalog() if app.runtime else {})
                if path == '/furniture_categories.json':
                    return self.send(app.runtime.categories() if app.runtime else {'categories':{},'report':{'state':'not_ready'}})
                if path == '/api/presets':
                    return self.send({'presets': [app.preset_previews.describe(row) for row in app.presets.list()]})
                if path.startswith('/api/preset-preview/'):
                    key = path.removeprefix('/api/preset-preview/').removesuffix('.png')
                    file = app.preset_previews.path(key)
                    if not file.is_file():
                        return self.send({'error': '预览图尚未生成'}, status=404)
                    return self.send(file.read_bytes(), content='image/png')
                if path == '/api/presets/export':
                    return self.send(app.presets.export())
                if path.startswith('/api/presets/export/'):
                    return self.send(app.presets.export(path.removeprefix('/api/presets/export/')))
                if path.startswith('/api/presets/'):
                    return self.send(app.presets.read(path.removeprefix('/api/presets/')))
                if path == '/save_validation_rules.json':
                    return self.send(app.runtime.validation_rules() if app.runtime else
                                     {'source': 'not ready', 'version': 'unverified',
                                      'constraints': {}, 'polygons': {}})
                if path in ('/scene_material_manifest.json', '/texture_lod_manifest.json', '/asset_versions.json'):
                    return self.send({})
                if path == '/furniture_dye_manifest.json':
                    return self.send(app.runtime.dye_manifest() if app.runtime else {'configs': {}, 'materials': {}, 'parts': {}})
                if path.startswith('/asset/'):
                    if not app.runtime:
                        raise ValueError('尚未完成资源校验')
                    if not app.runtime.current():
                        return self.send({'error': '游戏资源已更新，请重新校验。旧缓存保留。'}, status=409)
                    version, relative = path.removeprefix('/asset/').split('/', 1)
                    if version != app.runtime.version:
                        return self.send({'error': '资源版本已变化，请重新打开编辑器'}, status=409)
                    file = app.runtime.asset(relative)
                elif path.startswith('/cached-asset/'):
                    # Explicit recovery view only; old model files never masquerade as current.
                    version, relative = path.removeprefix('/cached-asset/').split('/', 1)
                    if len(version) != 64 or any(c not in '0123456789abcdef' for c in version):
                        raise ValueError('Invalid cache version')
                    base = app.storage.cache / version / 'assets'
                    file = (base / relative).resolve()
                    if not file.is_relative_to(base.resolve()):
                        raise ValueError('Invalid cache path')
                elif path.startswith('/vendor/'):
                    base = ROOT / 'node_modules/three'
                    file = (base / path.removeprefix('/vendor/')).resolve()
                    if not file.is_relative_to(base.resolve()):
                        raise ValueError('Invalid vendor path')
                else:
                    base = ROOT / 'frontend'
                    file = (base / path.lstrip('/')).resolve()
                    if not file.is_relative_to(base.resolve()):
                        raise ValueError('Invalid UI path')
                return self.send(file.read_bytes(), mimetypes.guess_type(file.name)[0] or 'application/octet-stream')
            except FileNotFoundError:
                self.send({'error': '文件不存在'}, status=404)
            except Exception as exc:
                self.send({'error': str(exc)}, status=400)

        def do_POST(self):
            origin = self.headers.get('Origin')
            allowed = {f'http://127.0.0.1:{self.server.server_port}', f'http://localhost:{self.server.server_port}'}
            if not self.valid_host() or origin not in allowed or not secrets.compare_digest(self.headers.get('X-Nikki-Token', ''), app.token):
                return self.send({'error': '本地请求验证失败'}, status=403)
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= 8 * 1024 * 1024:
                    raise ValueError('请求过大或为空')
                values = json.loads(self.rfile.read(length))
                path = urlsplit(self.path).path
                if path == '/api/cache/browser':
                    self.send_response(200)
                    self.send_header('Clear-Site-Data', '"cache", "storage"' if values.get('settings') is True else '"cache"')
                    self.send_header('Content-Length', '2')
                    self.send_header('Cache-Control', 'no-store')
                    self.end_headers()
                    self.wfile.write(b'{}')
                    return
                if path == '/api/cache/old':
                    from backend.cache_management import clear_old
                    if not app.job_lock.acquire(blocking=False):
                        raise ValueError('资源校验中，请稍后清理')
                    try:
                        return self.send(clear_old(app.storage))
                    finally:
                        app.job_lock.release()
                if path == '/api/configure':
                    app.configure(values)
                    return self.send({'started': True}, status=202)
                if path == '/api/revalidate':
                    app.start()
                    return self.send({'started': True}, status=202)
                if path == '/api/prepare-scene':
                    if not app.runtime or not app.runtime.current():
                        raise ValueError('请先校验资源')
                    items = values.get('items')
                    if not isinstance(items, list) or not 0 < len(items) <= 10000 or any(not isinstance(i, dict) or 'id' not in i for i in items):
                        raise ValueError('无效场景物品列表')
                    if not app.scene_lock.acquire(blocking=False):
                        raise ValueError('上一场景资源准备仍在执行')
                    app.scene_id = secrets.token_hex(8)
                    app.scene_result = None
                    runtime = app.runtime
                    runtime.prepared_geometry = None
                    def prepare():
                        try:
                            app.scene_result = runtime.prepare_scene(items)
                        except Exception as exc:
                            app.scene_result = {'error': str(exc)}
                            runtime.scene_progress = {'state': 'failed', 'message': str(exc)}
                        finally:
                            app.scene_lock.release()
                    threading.Thread(target=prepare, daemon=True).start()
                    return self.send({'id': app.scene_id}, status=202)
                if path == '/api/shutdown':
                    self.send({'stopping': True})
                    threading.Thread(target=self.server.shutdown, daemon=True).start()
                    return
                if path == '/api/presets':
                    return self.send(app.presets.save(values.get('name'), values.get('items')))
                if path == '/api/presets/rename':
                    return self.send(app.presets.rename(values.get('id'), values.get('name')))
                if path == '/api/presets/import':
                    return self.send(app.presets.import_documents(values.get('documents')))
                if path == '/api/presets/preview':
                    return self.send(app.preset_previews.save(values.get('id'), values.get('key'), values.get('image')))
                if path == '/api/presets/duplicate':
                    return self.send(app.presets.duplicate(values.get('id')))
                if path == '/api/presets/delete':
                    return self.send(app.presets.remove(values.get('id')))
                if path == '/api/browse':
                    # Runs on this request thread; Windows dialog is explicitly user-triggered.
                    import tkinter as tk
                    from tkinter import filedialog
                    window = tk.Tk()
                    window.withdraw()
                    window.attributes('-topmost', True)
                    try:
                        selected = (filedialog.askdirectory(parent=window) if values.get('kind') == 'game'
                                    else filedialog.askopenfilename(parent=window,
                                          filetypes=[('Executable', '*.exe')] if values.get('kind') == 'parser'
                                          else [('JSON', '*.json')]))
                    finally:
                        window.destroy()
                    return self.send({'path': selected})
                self.send({'error': 'Unknown endpoint'}, status=404)
            except Exception as exc:
                self.send({'error': str(exc)}, status=400)
    return Handler


def serve(port=8768, data_dir=None, open_browser=False, browser_path='/'):
    app = Application(Storage(data_dir))
    try:
        server = ThreadingHTTPServer(('127.0.0.1', port), handler_for(app))
    except OSError:
        import urllib.request
        url = f'http://127.0.0.1:{port}'
        try:
            with urllib.request.urlopen(url + '/api/session', timeout=2) as response:
                existing = json.load(response)
            if (existing.get('application') == 'NikkiStudio' and existing.get('version') == VERSION and
                    existing['status']['dataDirectory'] == str(app.storage.root) and
                    existing['status'].get('cacheDirectory') == str(app.storage.cache)):
                if open_browser:
                    import webbrowser
                    webbrowser.open(url + browser_path)
                return
        except Exception:
            pass
        raise RuntimeError('本地端口已被其他程序或数据目录占用，请使用 --port 指定其他端口') from None
    if app.storage.config():
        app.start()
    registration = app.storage.root / 'service-registry' / (str(server.server_port) + '.json')
    write_json(registration, {'port': server.server_port, 'pid': os.getpid()})
    url = f'http://127.0.0.1:{server.server_port}'
    import sys
    if sys.stdout:
        print('Nikki Studio: ' + url, flush=True)
    if open_browser:
        import webbrowser
        webbrowser.open(url + browser_path)
    try:
        server.serve_forever()
    finally:
        server.server_close()
        if app.runtime and app.runtime.worker:
            app.runtime.worker.close()
        registration.unlink(missing_ok=True)
