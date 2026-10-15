"""Inventory and narrowly scoped cleanup of generated files; never user content."""
import hashlib
import os
import shutil
import stat
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[1]


def checked_tree(path):
    path = Path(path).absolute()
    if any(p.is_symlink() or p.is_junction() for p in (path, *path.parents)):
        raise ValueError('拒绝操作链接目录：' + str(path))
    if not path.exists():
        return []
    rows = list(path.rglob('*'))
    if any(p.is_symlink() or p.is_junction() for p in rows):
        raise ValueError('目录包含链接，停止操作：' + str(path))
    return rows


def measure(path):
    path = Path(path).absolute()
    if any(p.is_symlink() or p.is_junction() for p in (path, *path.parents)):
        raise ValueError('拒绝统计链接目录：' + str(path))
    if not path.exists():
        return 0
    if path.is_file():
        return path.stat().st_size
    total, pending = 0, [path]
    while pending:
        with os.scandir(pending.pop()) as entries:
            for entry in entries:
                info = entry.stat(follow_symlinks=False)
                if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400:
                    raise ValueError('目录包含链接，停止统计：' + entry.path)
                if stat.S_ISDIR(info.st_mode):
                    pending.append(Path(entry.path))
                elif stat.S_ISREG(info.st_mode):
                    total += info.st_size
    return total


def inventory(storage):
    active = storage.active()
    entries = []
    for p in storage.cache.iterdir():
        entries.append({'name': p.name, 'bytes': measure(p),
                        'active': p == active, 'old': is_version(p.name) and p != active})
    return {'path': str(storage.cache), 'bytes': sum(e['bytes'] for e in entries),
            'entries': entries, 'userData': str(storage.root),
            'developmentArtifacts': {'path': str(PROJECT / 'test-results'),
                                     'bytes': measure(PROJECT / 'test-results')},
            'legacyCache': {'path': str(storage.root / 'cache'),
                            'bytes': measure(storage.root / 'cache') if storage.cache != storage.root / 'cache' else 0},
            'externalTemporary': [{'path': str(p), 'bytes': measure(p)} for p in external_staging(storage)]}


def external_staging(storage):
    """Only registered app-created staging on the configured game volume."""
    config = storage.config()
    if not config or not config.get('gameRoot'):
        return []
    import json
    parent = Path(config['gameRoot']).resolve().parent
    result = []
    for record in (storage.cache / 'staging-registry').glob('*.json'):
        checked_tree(record)
        row = json.loads(record.read_text(encoding='utf-8'))
        target = Path(row['path']).absolute()
        if target.parent != parent or not target.name.startswith('.nikki-studio-stage-'):
            continue
        checked_tree(target)
        result.append(target)
    return result


def clear_external(storage):
    targets = external_staging(storage)
    for path in targets:
        if path.exists():
            shutil.rmtree(path)


def is_version(name):
    return len(name) == 64 and all(c in '0123456789abcdef' for c in name)


def clear_old(storage):
    active = storage.active()
    targets = [p for p in storage.cache.iterdir() if is_version(p.name) and p.is_dir() and p != active]
    # Validate all targets before removing any. Call only while configuration is locked.
    size = sum(measure(p) for p in targets)
    for p in targets:
        assert p.parent == storage.cache
        shutil.rmtree(p)
    return {'removedBytes': size, 'removedVersions': len(targets)}


def migrate(storage):
    """Run with servers stopped. Preserve version names, epoch, pointers and bytes."""
    old = storage.root / 'cache'
    if old == storage.cache or not old.exists():
        return {'movedBytes': 0}
    files = checked_tree(old)
    checked_tree(storage.cache)
    # Conflicts are never silently overwritten.
    for p in old.iterdir():
        if (storage.cache / p.name).exists():
            raise ValueError('目标已存在，保留原缓存以免覆盖：' + p.name)
    size = sum(p.stat().st_size for p in files if p.is_file())
    for p in list(old.iterdir()):
        dest = storage.cache / p.name
        if p.drive.lower() == dest.drive.lower():
            p.rename(dest)
        else:
            # Check copied contents before removing the source on a different disk.
            if p.is_dir():
                shutil.copytree(p, dest)
                pairs = [(x, dest / x.relative_to(p)) for x in checked_tree(p) if x.is_file()]
            else:
                shutil.copy2(p, dest)
                pairs = [(p, dest)]
            for src, target in pairs:
                with src.open('rb') as a, target.open('rb') as b:
                    if hashlib.file_digest(a, 'sha256').digest() != hashlib.file_digest(b, 'sha256').digest():
                        raise ValueError('复制校验失败，原缓存保留')
            shutil.rmtree(p) if p.is_dir() else p.unlink()
    old.rmdir()
    return {'movedBytes': size, 'path': str(storage.cache)}
