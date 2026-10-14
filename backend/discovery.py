"""Bounded Windows installation discovery; never recursively scans user drives."""
import os
from pathlib import Path
from backend.config import game_root


def find_games():
    candidates = []
    if os.name == 'nt':
        import winreg
        for hive in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
            for branch in (r'SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',
                           r'SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'):
                try:
                    with winreg.OpenKey(hive, branch) as parent:
                        for i in range(winreg.QueryInfoKey(parent)[0]):
                            try:
                                with winreg.OpenKey(parent, winreg.EnumKey(parent, i)) as entry:
                                    name = str(winreg.QueryValueEx(entry, 'DisplayName')[0]).lower()
                                    if 'nikki' in name or '无限暖暖' in name:
                                        candidates.append(Path(winreg.QueryValueEx(entry, 'InstallLocation')[0]))
                            except OSError:
                                pass
                except OSError:
                    pass
        import ctypes
        mask = ctypes.windll.kernel32.GetLogicalDrives()
        for index in range(26):
            if mask & (1 << index):
                drive = Path(chr(65 + index) + ':/')
                for base in [drive, drive / 'games', drive / 'Games', drive / 'Program Files']:
                    for name in ['InfinityNikki', 'InfinityNikki Launcher']:
                        candidates.append(base / name)
    found = set()
    for path in candidates:
        try:
            found.add(str(game_root(path)))
        except (ValueError, OSError):
            pass
    return sorted(found)
