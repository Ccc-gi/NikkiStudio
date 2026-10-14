"""Item presets saved from the editor's selection and placed back later.

A preset is a small save fragment: the selected items' types, colours and
transforms held relative to the group's ground anchor, so the whole group can be
dropped anywhere. Presets live in the user's own data directory, one file each,
so they survive browser changes and can be copied or edited by hand.
"""
import hashlib
import json
import re
import time
import threading
from functools import wraps
from pathlib import Path

from backend.storage import write_json

FORMAT = 'nikki-studio-preset'
VERSION = 1
MAX_ITEMS = 4000
MAX_NAME = 60
MAX_COLORS = 64
LIBRARY_FORMAT = 'nikki-studio-preset-library'
MAX_PRESETS = 200
SAFE = re.compile(r'[^0-9A-Za-z一-鿿._-]+')
AXES = ('x', 'y', 'z')


def preset_id(name):
    """A filesystem-safe identifier derived from the display name."""
    slug = SAFE.sub('-', str(name or '').strip()).strip('-._')[:MAX_NAME]
    if slug:
        if slug.split('.')[0].upper() in {'CON', 'PRN', 'AUX', 'NUL', *(f'COM{i}' for i in range(1, 10)), *(f'LPT{i}' for i in range(1, 10))}:
            slug = 'preset-' + slug
        return slug
    return 'preset-' + hashlib.sha1(str(name).encode('utf-8')).hexdigest()[:10]


def _number(value, default):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return default
    return value if value == value and abs(value) != float('inf') else default


def normalize_item(raw):
    """One furnitureInfo-shaped entry, or None when the row is not usable."""
    if not isinstance(raw, dict):
        return None
    ident = raw.get('cfg_item_id')
    if isinstance(ident, bool) or not isinstance(ident, int) or not 0 < ident < 2 ** 32:
        return None
    trans = raw.get('trans') if isinstance(raw.get('trans'), dict) else {}
    trans = {field: trans.get(field) if isinstance(trans.get(field), dict) else {} for field in ('position', 'rotation', 'scale')}
    colors = [color for color in (raw.get('colors') if isinstance(raw.get('colors'), list) else [])
              if isinstance(color, int) and not isinstance(color, bool) and 0 <= color < 10000]
    return {
        'cfg_item_id': ident,
        'attach_id': int(_number(raw.get('attach_id'), 0)),
        'colors': colors[:MAX_COLORS],
        'trans': {field: {axis: round(_number(trans[field].get(axis), 1.0 if field == 'scale' else 0.0), 6)
                          for axis in AXES} for field in trans},
    }


def synchronized(method):
    @wraps(method)
    def call(self, *args, **kwargs):
        with self.lock:
            return method(self, *args, **kwargs)
    return call


def portable_document(raw):
    """Validate imports completely; never silently drop an unsupported item."""
    if not isinstance(raw, dict) or raw.get('format') != FORMAT or raw.get('version') != VERSION:
        raise ValueError('预设格式或版本不兼容（支持版本 1）')
    name = raw.get('name')
    if not isinstance(name, str) or not name.strip() or len(name.strip()) > MAX_NAME:
        raise ValueError('预设名称为空或超过 60 字')
    items = raw.get('items')
    if not isinstance(items, list) or not 0 < len(items) <= MAX_ITEMS:
        raise ValueError('每个预设需要 1–4000 件物品')
    clean = []
    for index, item in enumerate(items):
        valid = normalize_item(item)
        if valid is None:
            raise ValueError(f'第 {index + 1} 件物品 ID 无效')
        trans = item.get('trans', {})
        for field in ('position', 'rotation', 'scale'):
            vector = trans.get(field) if isinstance(trans, dict) else None
            if not isinstance(vector, dict) or any(isinstance(vector.get(a), bool) or
                    not isinstance(vector.get(a), (int, float)) or
                    _number(vector[a], None) is None for a in AXES):
                raise ValueError(f'第 {index + 1} 件物品变换无效')
            if field == 'scale' and any(vector[a] <= 0 for a in AXES):
                raise ValueError(f'第 {index + 1} 件物品缩放无效')
        colors = item.get('colors', [])
        if not isinstance(colors, list) or len(colors) > MAX_COLORS or any(
                isinstance(c, bool) or not isinstance(c, int) or not 0 <= c < 10000 for c in colors):
            raise ValueError(f'第 {index + 1} 件物品染色无效')
        clean.append(valid)
    return {'format': FORMAT, 'version': VERSION, 'name': name.strip(),
            'savedAt': raw.get('savedAt') if isinstance(raw.get('savedAt'), str) else time.strftime('%Y-%m-%dT%H:%M:%S'),
            'items': clean}


class Presets:
    """The on-disk preset library. Every operation is validated before touching the disk."""

    def __init__(self, root):
        self.directory = Path(root) / 'presets'
        self.lock = threading.RLock()

    def path(self, ident):
        text = str(ident or '')
        if not text or text != preset_id(text):
            raise ValueError('无效的预设标识')
        return self.directory / (text + '.json')

    @synchronized
    def read(self, ident):
        file = self.path(ident)
        if not file.is_file():
            raise ValueError('预设不存在：' + str(ident))
        document = json.loads(file.read_text(encoding='utf-8'))
        document = portable_document(document)
        document['id'] = file.stem
        return document

    @synchronized
    def list(self):
        if not self.directory.is_dir():
            return []
        rows = []
        for file in sorted(self.directory.glob('*.json')):
            try:
                document = json.loads(file.read_text(encoding='utf-8'))
            except (OSError, ValueError):
                continue
            if not isinstance(document, dict) or document.get('format') != FORMAT:
                continue
            items = document.get('items')
            rows.append({'id': file.stem, 'name': document.get('name') or file.stem,
                         'savedAt': document.get('savedAt'), 'items': len(items) if isinstance(items, list) else 0})
        return sorted(rows, key=lambda row: ((row['name'] or '').lower(), row['id']))

    @synchronized
    def save(self, name, items):
        label = str(name or '').strip()[:MAX_NAME]
        if not label:
            raise ValueError('请先给预设起个名字')
        clean = [item for item in (normalize_item(raw) for raw in items or []) if item]
        if not clean:
            raise ValueError('没有可保存的物品')
        if len(clean) > MAX_ITEMS:
            raise ValueError('一次最多保存 ' + str(MAX_ITEMS) + ' 件物品')
        ident = preset_id(label)
        self.directory.mkdir(parents=True, exist_ok=True)
        write_json(self.directory / (ident + '.json'),
                   {'format': FORMAT, 'version': VERSION, 'name': label,
                    'savedAt': time.strftime('%Y-%m-%dT%H:%M:%S'), 'items': clean})
        return {'id': ident, 'name': label, 'items': len(clean)}

    @synchronized
    def rename(self, ident, name):
        label = str(name or '').strip()[:MAX_NAME]
        if not label:
            raise ValueError('请先给预设起个名字')
        document = self.read(ident)
        document['name'] = label
        document.pop('id', None)
        target = preset_id(label)
        destination = self.directory / (target + '.json')
        if target != str(ident) and destination.exists():
            raise ValueError('已有一个同名预设：' + label)
        write_json(destination, document)
        if target != str(ident):
            self.path(ident).unlink()
        return {'id': target, 'name': label}

    @synchronized
    def remove(self, ident):
        file = self.path(ident)
        if not file.is_file():
            raise ValueError('预设不存在：' + str(ident))
        file.unlink()
        return {'id': str(ident), 'removed': True}

    def unique_name(self, name, occupied):
        label = name[:MAX_NAME]
        count = 2
        while preset_id(label).casefold() in occupied:
            suffix = f' ({count})'
            label = name[:MAX_NAME - len(suffix)] + suffix
            count += 1
        occupied.add(preset_id(label).casefold())
        return label

    @synchronized
    def export(self, ident=None):
        if ident:
            document = self.read(ident)
            document.pop('id', None)
            return document
        documents = [self.export(row['id']) for row in self.list()]
        return {'format': LIBRARY_FORMAT, 'version': VERSION, 'presets': documents}

    @synchronized
    def import_documents(self, documents):
        if not isinstance(documents, list) or not documents:
            raise ValueError('没有可导入的文件')
        expanded = []
        for raw in documents:
            if isinstance(raw, dict) and raw.get('format') == LIBRARY_FORMAT:
                if raw.get('version') != VERSION or not isinstance(raw.get('presets'), list):
                    raise ValueError('预设备份格式或版本不兼容')
                expanded.extend(raw['presets'])
            else:
                expanded.append(raw)
        if not 0 < len(expanded) <= MAX_PRESETS:
            raise ValueError('一次最多导入 200 个预设')
        clean = [portable_document(raw) for raw in expanded]
        occupied = {p.stem.casefold() for p in self.directory.glob('*.json')}
        for document in clean:
            document['name'] = self.unique_name(document['name'], occupied)
        written = []
        try:
            for document in clean:
                destination = self.path(preset_id(document['name']))
                write_json(destination, document)
                written.append(destination)
        except Exception:
            for file in written:
                file.unlink(missing_ok=True)
            raise
        return {'imported': [{'id': preset_id(d['name']), 'name': d['name'], 'items': len(d['items'])} for d in clean]}

    @synchronized
    def duplicate(self, ident):
        document = self.export(ident)
        document['name'] = document['name'][:MAX_NAME - 3] + ' 副本'
        document['savedAt'] = time.strftime('%Y-%m-%dT%H:%M:%S')
        return self.import_documents([document])['imported'][0]
