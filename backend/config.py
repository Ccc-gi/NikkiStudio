"""Validate local inputs without exposing credentials in diagnostics."""
import json
import re
from pathlib import Path
from backend.storage import write_json


def parse_keys(document):
    if not isinstance(document, dict):
        raise ValueError('AES 必须是 JSON 对象')
    result = {}
    rows = [{'guid': '0' * 32, 'key': document.get('mainKey', document.get('MainKey'))}]
    dynamic = document.get('dynamicKeys', document.get('DynamicKeys', []))
    if not isinstance(dynamic, list):
        raise ValueError('dynamicKeys 必须是数组')
    rows += dynamic
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError('动态密钥条目必须是对象')
        guid = str(row.get('guid', row.get('Guid', ''))).replace('-', '').upper()
        key = str(row.get('key', row.get('Key', ''))).removeprefix('0x').removeprefix('0X')
        if not re.fullmatch('[0-9A-F]{32}', guid) or not re.fullmatch('[0-9a-fA-F]{64}', key):
            raise ValueError('密钥必须是 64 位十六进制，GUID 必须是 32 位十六进制')
        if guid in result and result[guid] != bytes.fromhex(key):
            raise ValueError('同一 GUID 存在冲突密钥')
        result[guid] = bytes.fromhex(key)
    return result


def game_root(value):
    path = Path(value).expanduser().resolve()
    for candidate in [path, path / 'InfinityNikki']:
        if (candidate / 'X6Game').is_dir():
            return candidate
    if path.name == 'X6Game' and path.is_dir():
        return path.parent
    raise ValueError('请选择包含 X6Game 的游戏目录或启动器目录')


def usmap_header(raw):
    if len(raw) < 12 or raw[:2] != b'\xc4\x30':
        raise ValueError('不是有效的二进制 usmap 文件；接口 JSON 不是映射文件')


def save_config(storage, game, keys, usmap, parser, metadata=None):
    root = game_root(game)
    parse_keys(keys)
    usmap_header(usmap)
    executable = Path(parser).expanduser().resolve()
    if not executable.is_file() or executable.suffix.lower() != '.exe':
        raise ValueError('请选择本机的 cue4parse.exe；发布源码不包含该第三方程序')
    # Per-input files are immutable. A failed setup never changes the old configuration.
    import hashlib
    encoded = json.dumps(keys, sort_keys=True).encode()
    keyfile = storage.private / ('keys-' + hashlib.sha256(encoded).hexdigest()[:16] + '.json')
    mapfile = storage.private / ('mappings-' + hashlib.sha256(usmap).hexdigest()[:16] + '.usmap')
    write_json(keyfile, keys)
    mapfile.write_bytes(usmap)
    config = {'schema': 1, 'gameRoot': str(root), 'keysFile': str(keyfile),
              'usmapFile': str(mapfile), 'parser': str(executable)}
    if metadata:
        source = Path(metadata).expanduser().resolve()
        if not source.is_file():
            raise ValueError('家具元数据文件不存在')
        config['metadataFile'] = str(source)
    return config


def load_keys(config):
    return parse_keys(json.loads(Path(config['keysFile']).read_text(encoding='utf-8-sig')))
