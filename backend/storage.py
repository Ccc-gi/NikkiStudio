"""Private state and transactional versioned caches, separate from source files."""
import hashlib
import json
import os
import secrets
import sys
from functools import lru_cache
from pathlib import Path


@lru_cache(maxsize=4096)
def _digest(path, size, modified, created, inode):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def digest(path):
    path = Path(path).resolve()
    stat = path.stat()
    return _digest(str(path), stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns, stat.st_ino)


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + '.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
    os.replace(temp, path)


class Storage:
    def __init__(self, root=None, cache_root=None):
        custom = root is not None or bool(os.environ.get('NIKKI_STUDIO_DATA'))
        self.root = Path(root or os.environ.get('NIKKI_STUDIO_DATA') or
                         Path(os.environ.get('LOCALAPPDATA', Path.home())) / 'NikkiStudio').resolve()
        self.private = self.root / 'private'
        default_cache = (Path(sys.executable).resolve().parent / 'cache' if getattr(sys, 'frozen', False)
                         else Path(__file__).resolve().parents[1] / 'local/cache')
        self.cache = Path(cache_root or (self.root / 'cache' if custom else
                          default_cache)).absolute()
        if self.cache.is_symlink() or self.cache.is_junction():
            raise ValueError('缓存目录不能是链接目录')
        self.cache = self.cache.resolve()
        self.private.mkdir(parents=True, exist_ok=True)
        self.cache.mkdir(parents=True, exist_ok=True)

    def config(self):
        path = self.private / 'config.json'
        return json.loads(path.read_text(encoding='utf-8')) if path.exists() else None

    def cache_epoch(self):
        path = self.root / 'cache-epoch.json'
        if not path.exists():
            write_json(path, {'epoch': secrets.token_hex(16)})
        return json.loads(path.read_text(encoding='utf-8'))['epoch']

    def reset_epoch(self):
        write_json(self.root / 'cache-epoch.json', {'epoch': secrets.token_hex(16)})

    def active(self):
        pointer = self.root / 'active.json'
        if not pointer.exists():
            return None
        version = json.loads(pointer.read_text(encoding='utf-8'))['directory']
        target = (self.cache / version).resolve()
        if not target.is_relative_to(self.cache) or not (target / 'manifest.json').is_file():
            raise ValueError('Invalid cache pointer')
        return target

    def activate(self, folder):
        folder = Path(folder).resolve()
        if not folder.is_relative_to(self.cache) or not (folder / 'manifest.json').exists():
            raise ValueError('Unvalidated cache cannot be activated')
        write_json(self.root / 'active.json', {'directory': folder.name})
