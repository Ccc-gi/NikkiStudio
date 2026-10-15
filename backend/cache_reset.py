"""Explicit cold-start reset. Never touches private inputs or game files."""
import csv
import io
import json
import os
import shutil
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path


def stop_services(storage, ports=(8768, 8769)):
    if os.name != 'nt':
        raise RuntimeError('Cache reset currently requires Windows process checks')
    stopping = set()
    registered = []
    for path in (storage.root / 'service-registry').glob('*.json'):
        port = json.loads(path.read_text(encoding='utf-8')).get('port')
        if isinstance(port, int) and 1 <= port <= 65535:
            registered.append(port)
    ports = tuple(dict.fromkeys((*ports, *registered)))
    for port in ports:
        base = f'http://127.0.0.1:{port}'
        try:
            with urllib.request.urlopen(base + '/api/session', timeout=3) as response:
                session = json.load(response)
        except (urllib.error.URLError, TimeoutError):
            continue
        if (session.get('application') != 'NikkiStudio' or
                Path(session['status']['dataDirectory']).resolve() != storage.root):
            continue
        network = subprocess.run(['netstat', '-ano', '-p', 'tcp'], capture_output=True, check=True,
                                 creationflags=subprocess.CREATE_NO_WINDOW)
        for line in network.stdout.decode(errors='replace').splitlines():
            fields = line.split()
            if len(fields) == 5 and fields[1] == f'127.0.0.1:{port}' and fields[3] == 'LISTENING':
                stopping.add(int(fields[4]))
        request = urllib.request.Request(base + '/api/shutdown', data=b'{}',
                    headers={'Origin': base, 'X-Nikki-Token': session['token'],
                             'Content-Type': 'application/json'})
        with urllib.request.urlopen(request, timeout=5) as response:
            json.load(response)
    deadline = time.monotonic() + 40
    while True:
        output = subprocess.run(['tasklist', '/FI', 'IMAGENAME eq cue4parse.exe', '/FO', 'CSV', '/NH'],
                                capture_output=True, check=True,
                                creationflags=subprocess.CREATE_NO_WINDOW)
        rows = csv.reader(io.StringIO(output.stdout.decode(errors='replace')))
        converting = any(row and row[0].lower() == 'cue4parse.exe' for row in rows)
        alive = False
        for pid in stopping:
            output = subprocess.run(['tasklist', '/FI', f'PID eq {pid}', '/FO', 'CSV', '/NH'],
                                    capture_output=True, check=True,
                                    creationflags=subprocess.CREATE_NO_WINDOW)
            alive |= any(len(row) > 1 and row[1] == str(pid)
                         for row in csv.reader(io.StringIO(output.stdout.decode(errors='replace'))))
        if not converting and not alive:
            break
        if time.monotonic() >= deadline:
            raise RuntimeError('资源解析器仍在转换，缓存尚未清除。请等转换结束后重试。')
        time.sleep(1)
def reset_resources(storage, ports=(8768, 8769)):
    stop_services(storage, ports)
    from backend.cache_management import checked_tree, clear_external
    checked_tree(storage.cache)
    clear_external(storage)
    target = storage.cache
    if target.is_symlink() or target.is_junction() or target.resolve() != storage.cache:
        raise RuntimeError('Unsafe cache directory')
    # Check every descendant before recursively removing anything.
    files = list(target.rglob('*'))
    if any(p.is_symlink() or p.is_junction() for p in files):
        raise RuntimeError('缓存包含链接目录，已停止清理')
    size = sum(p.stat().st_size for p in files if p.is_file())
    shutil.rmtree(target)
    target.mkdir()
    (storage.root / 'active.json').unlink(missing_ok=True)
    storage.reset_epoch()
    return size
