"""Inspect first; --apply explicitly performs the chosen maintenance action."""
import argparse
import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.storage import Storage
from backend.cache_management import PROJECT, checked_tree, inventory, migrate, clear_old, clear_external
from backend.cache_reset import stop_services, reset_resources


def main():
    parser = argparse.ArgumentParser(description='缓存管理与卸载前清理；默认只显示，不删除')
    parser.add_argument('action', choices=['status', 'migrate', 'old', 'clear', 'uninstall'], nargs='?', default='status')
    parser.add_argument('--apply', action='store_true', help='执行所选操作；不提供时只显示占用')
    parser.add_argument('--data-dir')
    parser.add_argument('--remove-user-data', action='store_true', help='仅 uninstall：同时删除配置、密钥和预设；先导出备份')
    args = parser.parse_args()
    storage = Storage(args.data_dir)
    if args.remove_user_data and args.action != 'uninstall':
        parser.error('--remove-user-data 只能用于 uninstall')
    if not args.apply or args.action == 'status':
        print(json.dumps(inventory(storage), ensure_ascii=False, indent=2))
        return
    if args.action == 'clear':
        print(json.dumps({'removedBytes': reset_resources(storage)}))
        return
    stop_services(storage)
    if args.action == 'migrate':
        print(json.dumps(migrate(storage), ensure_ascii=False))
    elif args.action == 'old':
        print(json.dumps(clear_old(storage)))
    else:
        # User explicitly selected uninstall. Never touch game directories or source.
        targets = [storage.cache, PROJECT / 'test-results']
        legacy = storage.root / 'cache'
        if legacy != storage.cache:
            targets.append(legacy)
        targets += [p for p in PROJECT.rglob('__pycache__')
                    if not any(x in p.parts for x in ('.venv', 'node_modules', '.git', 'local'))]
        if args.remove_user_data:
            if storage.root in (PROJECT, PROJECT.parent, Path.home(), Path(storage.root.anchor)) or PROJECT.is_relative_to(storage.root):
                raise ValueError('拒绝删除不安全的用户目录')
            targets.append(storage.root)
        for path in targets:
            checked_tree(path)
        clear_external(storage)
        for path in targets:
            if path.exists():
                shutil.rmtree(path)
        print('已清理生成缓存和测试产物。浏览器数据请先在设置中清理；工程依赖随工程目录一并删除。')
        if not args.remove_user_data:
            print('配置和预设保留于：' + str(storage.root))


if __name__ == '__main__':
    main()
