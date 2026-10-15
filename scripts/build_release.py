"""Build audited source ZIP, optionally a self-contained Windows desktop package."""
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path
from audit_release import ROOT, audit, release_files

if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--windows', action='store_true')
    p.add_argument('--out-dir')
    args = p.parse_args()
    policy_file = ROOT / 'project-policy.json'
    policy = json.loads(policy_file.read_text(encoding='utf-8')) if policy_file.exists() else {}
    if policy.get('releaseEnabled') is not True:
        raise SystemExit('当前为本地源码开发阶段，已禁用发布打包。仅在用户明确要求正式发布后更新 project-policy.json。')
    report = audit()
    output = Path(args.out_dir).resolve() if args.out_dir else ROOT / 'dist'
    output.mkdir(exist_ok=True)
    version = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
    archive = output / ('NikkiStudio-' + version + '-source.zip')
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as z:
        for file in release_files():
            z.write(file, 'NikkiStudio/' + file.relative_to(ROOT).as_posix())
    built = [archive]
    if args.windows:
        if os.name != 'nt':
            raise SystemExit('Windows binaries must be built on Windows')
        if not (ROOT / 'node_modules/three/package.json').exists():
            raise SystemExit('Run npm ci first')
        work = ROOT / 'test-results/pyinstaller'
        work.mkdir(parents=True, exist_ok=True)
        subprocess.run([sys.executable, '-m', 'PyInstaller', '--noconfirm', '--clean', '--onedir', '--windowed',
                        '--name', 'NikkiStudio', '--distpath', str(output), '--workpath', str(work / 'work'),
                        '--specpath', str(work), '--paths', str(ROOT),
                        '--add-data', str(ROOT / 'frontend') + ';frontend',
                        '--add-data', str(ROOT / 'node_modules/three') + ';node_modules/three',
                        '--add-data', str(ROOT / 'third_party') + ';third_party',
                        '--add-data', str(ROOT / 'package.json') + ';.',
                        '--hidden-import', 'tkinter', '--hidden-import', 'tkinter.filedialog',
                        str(ROOT / 'launch.py')], cwd=ROOT, check=True)
        bundle = output / 'NikkiStudio'
        worker = ROOT / 'local/parser-worker-mips'
        if not worker.is_dir():
            worker = ROOT / 'local/parser-worker-next'
        if not (worker / 'Nikki.AssetWorker.exe').exists():
            worker = ROOT / 'local/parser-worker'
        if not (worker / 'Nikki.AssetWorker.exe').exists():
            raise ValueError('Build the parser worker before creating the Windows release')
        shutil.copytree(worker, bundle / '_internal/parser-worker', dirs_exist_ok=True)
        (bundle / 'ClearCache.cmd').write_text('@echo off\nstart "" "%~dp0NikkiStudio.exe" --clear-cache\n', encoding='ascii')
        import importlib.metadata
        license_root = bundle / 'third_party/runtime'
        for dependency in ['cryptography', 'numpy', 'cffi', 'pycparser', 'pyinstaller']:
            distribution = importlib.metadata.distribution(dependency)
            for item in distribution.files or []:
                if 'license' in str(item).lower() or 'copying' in str(item).lower():
                    source = distribution.locate_file(item)
                    if source.is_file():
                        target = license_root / dependency / Path(str(item))
                        target.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copy2(source, target)
        python_license = Path(sys.base_prefix) / 'LICENSE.txt'
        if python_license.exists():
            license_root.mkdir(parents=True, exist_ok=True)
            shutil.copy2(python_license, license_root / 'Python-LICENSE.txt')
        for name in ['LICENSE', 'NOTICE.md', 'README.md']:
            shutil.copy2(ROOT / name, bundle / name)
        shutil.copytree(ROOT / 'third_party', bundle / 'third_party', dirs_exist_ok=True)
        win_archive = output / ('NikkiStudio-' + version + '-windows-x64.zip')
        with zipfile.ZipFile(win_archive, 'w', compression=zipfile.ZIP_DEFLATED) as z:
            for file in bundle.rglob('*'):
                if file.is_file():
                    z.write(file, 'NikkiStudio/' + file.relative_to(bundle).as_posix())
        built.append(win_archive)
    report['artifacts'] = [{'name': file.name, 'size': file.stat().st_size,
                            'sha256': hashlib.sha256(file.read_bytes()).hexdigest()} for file in built]
    (output / 'release-manifest.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2))
