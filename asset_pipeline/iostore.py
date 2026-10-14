"""Bounded IoStore directory indexing for the Nikki profile used by this adapter."""
import hashlib
import struct
from pathlib import Path
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from backend.storage import digest

MAGIC = b'-==--==--==--==-'


def u32(data, offset):
    return struct.unpack_from('<I', data, offset)[0]


def directory_data(data, key=None):
    if len(data) < 144 or data[:16] != MAGIC:
        raise ValueError('Unsupported or truncated IoStore header')
    offset = (u32(data, 20) + u32(data, 24) * 22 + u32(data, 84) * 4 + u32(data, 96) * 4
              + u32(data, 28) * u32(data, 32) + u32(data, 36) * u32(data, 40))
    if data[80] & 4:
        offset += 4 + 2 * u32(data, offset) + 20 * u32(data, 28)
    length = u32(data, 48)
    if offset + length > len(data):
        raise ValueError('Truncated directory index')
    raw = data[offset:offset + length]
    if key is not None:
        decryptor = Cipher(algorithms.AES(key), modes.ECB()).decryptor()
        raw = bytearray(decryptor.update(raw) + decryptor.finalize())
        for i in range(0, len(raw), 16):
            raw[i] ^= key[-1]
            raw[i + 15] ^= key[0]
    return raw


def paths(data):
    pos = 0
    def string():
        nonlocal pos
        size = struct.unpack_from('<i', data, pos)[0]
        pos += 4
        if not -100000 < size < 100000:
            raise ValueError('Invalid string size')
        length = abs(size) * (2 if size < 0 else 1)
        if pos + length > len(data):
            raise ValueError('Truncated string')
        value = data[pos:pos + length].decode('utf-16-le' if size < 0 else 'utf-8').rstrip('\0')
        pos += length
        return value
    mount = string()
    if not mount.startswith(('/', '../')):
        raise ValueError('Invalid mount path; check AES')
    arrays = []
    for stride, fmt in ((16, '<4I'), (12, '<3I')):
        count = u32(data, pos)
        pos += 4
        if count > 2000000 or pos + count * stride > len(data):
            raise ValueError('Invalid index array')
        arrays.append([struct.unpack_from(fmt, data, pos + i * stride) for i in range(count)])
        pos += count * stride
    count = u32(data, pos)
    pos += 4
    if count > 2000000:
        raise ValueError('Invalid string table')
    names = [string() for _ in range(count)]
    dirs, files = arrays
    mount = mount.replace('\\', '/')
    while mount.startswith('../'):
        mount = mount[3:]
    stack, seen = ([(0, mount.rstrip('/'))] if dirs else []), set()
    while stack:
        idx, parent = stack.pop()
        if idx == 0xFFFFFFFF:
            continue
        if idx in seen:
            raise ValueError('Directory cycle')
        seen.add(idx)
        name, child, sibling, first = dirs[idx]
        folder = parent + '/' + names[name] if name != 0xFFFFFFFF else parent
        stack.extend(((sibling, parent), (child, folder)))
        file_seen = set()
        while first != 0xFFFFFFFF:
            if first in file_seen:
                raise ValueError('File cycle')
            file_seen.add(first)
            name, nxt, user_data = files[first]
            package = (folder + '/' + names[name]).lstrip('/')
            if '..' in Path(package).parts or ':' in package:
                raise ValueError('Unsafe package path')
            yield package, user_data
            first = nxt


def archives(root):
    x6 = Path(root) / 'X6Game'
    # Only game content and installed patches; exclude caches/backups.
    return sorted(set(p for folder in [x6 / 'Content/Paks', x6 / 'Saved/Paks']
                      if folder.exists() for p in folder.rglob('*.utoc')))


def fingerprint(config):
    root = Path(config['gameRoot'])
    rows = []
    for toc in archives(root):
        row = {'path': toc.relative_to(root).as_posix(), 'tocHash': digest(toc), 'parts': []}
        for sibling in sorted(toc.parent.glob(toc.stem + '*')):
            if sibling.suffix.lower() in {'.ucas', '.pak'}:
                stat = sibling.stat()
                row['parts'].append([sibling.name, stat.st_size, stat.st_mtime_ns])
        rows.append(row)
    paper = root / 'X6Game/Saved/PaperBin'
    components = {'archives': rows, 'paperbin': digest(paper) if paper.exists() else None,
                  'usmap': digest(config['usmapFile']), 'parser': digest(config['parser']),
                  'adapter': 'nikki-paperbin-v3', 'pipeline': 6,
                  'keys': digest(config['keysFile']),
                  'parserWorker': digest(config['parserWorker']) if config.get('parserWorker') else None,
                  'cacheEpoch': config.get('cacheEpoch'),
                  'metadata': digest(config['metadataFile']) if config.get('metadataFile') else None}
    if config.get('parserWorker'):
        folder = Path(config['parserWorker']).parent
        components['workerAssemblies'] = {name: digest(folder / name) for name in
            ('Nikki.AssetWorker.dll', 'CUE4Parse.dll', 'CUE4Parse-Conversion.dll', 'Nikki.AssetWorker.deps.json') if (folder / name).is_file()}
    components['standalonePaks'] = [[p.relative_to(root).as_posix(), p.stat().st_size, p.stat().st_mtime_ns]
                                    for base in [root / 'X6Game/Content/Paks', root / 'X6Game/Saved/Paks']
                                    if base.exists() for p in sorted(base.rglob('*.pak')) if not p.with_suffix('.utoc').exists()]
    import json
    return hashlib.sha256(json.dumps(components, sort_keys=True).encode()).hexdigest(), components


def index(root, keys, progress=lambda _: None):
    records, reports = [], []
    files = archives(root)
    if not files:
        raise ValueError('游戏目录中没有 IoStore 索引文件')
    for i, toc in enumerate(files):
        progress(f'检查资源包 {i + 1}/{len(files)}：{toc.name}')
        data = toc.read_bytes()
        if len(data) < 144 or data[:16] != MAGIC:
            raise ValueError('未知 IoStore 格式：' + toc.name)
        guid = ''.join('%08X' % u32(data, p) for p in (64, 68, 72, 76))
        report = {'archive': toc.relative_to(root).as_posix(), 'guid': guid, 'status': 'no_directory'}
        if data[80] & 8 and u32(data, 48):
            if data[80] & 2 and guid not in keys:
                report['status'] = 'missing_key'
            else:
                try:
                    entries = list(paths(directory_data(data, keys.get(guid) if data[80] & 2 else None)))
                    report.update(status='validated', files=len(entries))
                    records.extend({'package': package, 'archive': str(toc), 'guid': guid,
                                    'encrypted': bool(data[80] & 2), 'chunk_index': chunk}
                                   for package, chunk in entries if package.endswith('.uasset'))
                except (ValueError, IndexError, UnicodeError, struct.error):
                    report['status'] = 'invalid_key_or_index'
        reports.append(report)
    if not records:
        raise ValueError('没有可用资源索引；请检查密钥或游戏格式')
    return records, reports
