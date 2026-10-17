"""Packaged and source desktop entry point."""
import argparse
import sys
from pathlib import Path


def stop_server(port, data_dir=None):
    import json
    import urllib.error
    import urllib.request
    from backend.storage import Storage
    storage = Storage(data_dir)
    base = f'http://127.0.0.1:{port}'
    try:
        with urllib.request.urlopen(base + '/api/session', timeout=3) as response:
            session = json.load(response)
    except urllib.error.URLError:
        return False
    status = session.get('status', {})
    if (session.get('application') != 'NikkiStudio' or
            Path(status.get('dataDirectory', '')).resolve() != storage.root or
            Path(status.get('cacheDirectory', '')).resolve() != storage.cache):
        raise ValueError('端口正在被其他实例使用，请在对应实例中退出。')
    request = urllib.request.Request(base + '/api/shutdown', data=b'{}', headers={
        'Origin': base, 'X-Nikki-Token': session['token'], 'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=5) as response:
        json.load(response)
    return True


if __name__ == '__main__':
    from backend.server import serve
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8769)
    parser.add_argument('--data-dir')
    parser.add_argument('--no-browser', action='store_true')
    parser.add_argument('--stop', action='store_true', help='正常退出使用同一数据目录和缓存的本地服务')
    parser.add_argument('--clear-cache', action='store_true', help='清除生成的资源缓存并冷启动，保留配置和存档')
    args = parser.parse_args()
    try:
        if args.stop:
            stop_server(args.port, args.data_dir)
            raise SystemExit(0)
        if args.clear_cache:
            from backend.cache_reset import reset_resources
            from backend.storage import Storage
            size = reset_resources(Storage(args.data_dir), tuple(dict.fromkeys((8768, 8769, args.port))))
            if sys.stdout:
                print(f'已清除资源缓存：{size / 1024 / 1024:.1f} MiB', flush=True)
        serve(args.port, args.data_dir, open_browser=not args.no_browser,
              browser_path='/clear_cache.html' if args.clear_cache else '/')
    except Exception as exc:
        if sys.stderr:
            print(str(exc), file=sys.stderr)
        if sys.platform == 'win32' and not args.no_browser:
            import ctypes
            ctypes.windll.user32.MessageBoxW(None, str(exc), 'Nikki Studio 启动失败', 0x10)
        raise SystemExit(1)
