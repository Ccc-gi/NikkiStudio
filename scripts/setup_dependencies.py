"""Install declared dependencies into a project-local environment using Python."""
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV = ROOT / '.venv'

if __name__ == '__main__':
    subprocess.run([sys.executable, '-m', 'venv', str(ENV)], check=True)
    python = ENV / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    subprocess.run([str(python), '-m', 'pip', 'install', '-r', str(ROOT / 'requirements.txt')], check=True)
    npm = shutil.which('npm.cmd' if os.name == 'nt' else 'npm')
    if not npm:
        raise SystemExit('请安装 Node.js LTS（含 npm），然后重新运行本脚本。')
    subprocess.run([npm, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], cwd=ROOT, check=True)
    print('依赖已准备。运行 .venv/Scripts/python.exe launch.py，或构建 Windows 发布包。')
