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
from pathlib import Path

from backend.storage import write_json

FORMAT = 'nikki-studio-preset'
VERSION = 1
MAX_ITEMS = 4000
MAX_NAME = 60
MAX_COLORS = 64
SAFE = re.compile(r'[^0-9A-Za-z一-鿿._-]+')
AXES = ('x', 'y', 'z')


def preset_id(name):
    """A filesystem-safe identifier derived from the display name."""
    slug = SAFE.sub('-', str(name or '').strip()).strip('-._')[:MAX_NAME]
    if slug:
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
    colors = [color for color in raw.get('colors') or []
              if isinstance(color, int) and not isinstance(color, bool) and 0 <= color < 10000]
    return {
        'cfg_item_id': ident,
        'attach_id': int(_number(raw.get('attach_id'), 0)),
        'colors': colors[:MAX_COLORS],
        'trans': {field: {axis: round(_number(trans[field].get(axis), 1.0 if field == 'scale' else 0.0), 6)
                          for axis in AXES} for field in trans},
    }


class Presets:
    """The on-disk preset library. Every operation is validated before touching the disk."""

    def __init__(self, root):
        self.directory = Path(root) / 'presets'

    def path(self, ident):
        text = str(ident or '')
        if not text or text != preset_id(text):
            raise ValueError('无效的预设标识')
        return self.directory / (text + '.json')

    def read(self, ident):
        file = self.path(ident)
        if not file.is_file():
            raise ValueError('预设不存在：' + str(ident))
        document = json.loads(file.read_text(encoding='utf-8'))
        if document.get('format') != FORMAT:
            raise ValueError('预设文件格式不兼容：' + str(ident))
        document['id'] = file.stem
        return document

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

    def remove(self, ident):
        file = self.path(ident)
        if not file.is_file():
            raise ValueError('预设不存在：' + str(ident))
        file.unlink()
        return {'id': str(ident), 'removed': True}
