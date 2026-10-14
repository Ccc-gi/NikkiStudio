"""Disposable, versioned PNG thumbnails; portable preset data stays elsewhere."""
import base64
import hashlib
import io
import json
import os
import re
import secrets
from PIL import Image

RENDER_VERSION = 'soft-studio-3'
KEY = re.compile(r'^[0-9a-f]{64}$')


class PresetPreviews:
    def __init__(self, storage, presets, resource_version):
        self.storage, self.presets, self.resource_version = storage, presets, resource_version

    @property
    def directory(self):
        return self.storage.cache / 'preset-previews'

    def key(self, ident):
        document = self.presets.read(ident)
        content = {'items': document['items'], 'resources': self.resource_version(),
                   'epoch': self.storage.cache_epoch(), 'render': RENDER_VERSION}
        return hashlib.sha256(json.dumps(content, sort_keys=True, separators=(',', ':')).encode()).hexdigest()

    def path(self, key):
        if not isinstance(key, str) or not KEY.fullmatch(key):
            raise ValueError('无效预览图标识')
        return self.directory / (key + '.png')

    def describe(self, row):
        try:
            key = self.key(row['id'])
            return {**row, 'previewKey': key, 'previewUrl': '/api/preset-preview/' + key + '.png'
                    if self.path(key).is_file() else None}
        except ValueError as error:
            return {**row, 'previewError': str(error)}

    def save(self, ident, key, encoded):
        if self.key(ident) != key:
            raise ValueError('预设或游戏资源已变化，请重新生成预览')
        if not isinstance(encoded, str) or len(encoded) > 1024 * 1024:
            raise ValueError('预览图过大或无效')
        try:
            payload = base64.b64decode(encoded, validate=True)
            if payload[:8] != b'\x89PNG\r\n\x1a\n':
                raise ValueError('预览图必须为 PNG')
            with Image.open(io.BytesIO(payload)) as image:
                if image.format != 'PNG' or image.size != (512, 320):
                    raise ValueError('预览图尺寸必须为 512 × 320')
                image.verify()
        except (OSError, SyntaxError) as error:
            raise ValueError('预览图无法读取') from error
        path = self.path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = path.with_name(path.name + '.' + secrets.token_hex(6) + '.tmp')
        try:
            temp.write_bytes(payload)
            os.replace(temp, path)
        finally:
            temp.unlink(missing_ok=True)
        return {'url': '/api/preset-preview/' + key + '.png', 'key': key}
