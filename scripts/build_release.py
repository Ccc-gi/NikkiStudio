"""Build audited source and Windows Portable artifacts after explicit release authorization."""
import argparse
import hashlib
import importlib.metadata
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import uuid
import zipfile
from pathlib import Path
from audit_release import ROOT, audit, release_files


def digest(file):
    with Path(file).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def parser_worker(requested=None):
    candidates = [Path(requested)] if requested else [
        ROOT / 'local/parser-worker-mips', ROOT / 'local/parser-worker-next', ROOT / 'local/parser-worker']
    for worker in candidates:
        if not (worker / 'Nikki.AssetWorker.exe').is_file():
            continue
        required = ['build-manifest.json', 'Nikki.AssetWorker.runtimeconfig.json', 'coreclr.dll',
                    'hostpolicy.dll', 'CUE4Parse-LICENSE.txt', 'CUE4Parse-NOTICE.txt']
        for name in required:
            if not (worker / name).is_file():
                raise ValueError('Parser worker is missing ' + name)
        manifest = json.loads((worker / 'build-manifest.json').read_text(encoding='utf-8'))
        if manifest.get('selfContained') is not True:
            raise ValueError('The Portable package requires a self-contained parser worker')
        from build_parser_worker import REVISION
        if manifest.get('revision') != REVISION:
            raise ValueError('Parser worker revision does not match the pinned source')
        for file in worker.rglob('*'):
            if file.is_symlink() or file.is_junction():
                raise ValueError('Parser worker contains a link')
            if file.is_file() and (file.suffix.lower() in {'.usmap', '.pak', '.utoc', '.ucas', '.glb'} or
                                   'keys' in file.name.lower() or 'savedata' in file.name.lower() or
                                   file.name.lower().startswith('oo2core')):
                raise ValueError('Unexpected game or private input in parser worker: ' + file.name)
        return worker.resolve(), manifest
    raise ValueError('Build the parser worker before creating the Windows Portable package')


def runtime_licenses(bundle):
    versions = {}
    for dependency in ['cryptography', 'numpy', 'Pillow', 'cffi', 'pycparser', 'pyinstaller']:
        try:
            distribution = importlib.metadata.distribution(dependency)
        except importlib.metadata.PackageNotFoundError:
            continue
        versions[dependency] = distribution.version
        for item in distribution.files or []:
            if any(word in str(item).lower() for word in ('license', 'copying', 'notice')):
                source = distribution.locate_file(item)
                if source.is_file():
                    target = bundle / 'third_party/runtime' / dependency / Path(str(item))
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(source, target)
    for name in ('LICENSE.txt', 'LICENSE'):
        source = Path(sys.base_prefix) / name
        if source.is_file():
            target = bundle / 'third_party/runtime/Python-LICENSE.txt'
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
            break
    return versions


def version_resource(version):
    values = tuple(int(value) for value in version.split('.')) + (0,)
    return f'''VSVersionInfo(
  ffi=FixedFileInfo(filevers={values!r}, prodvers={values!r}, mask=0x3f, flags=0x0,
                   OS=0x40004, fileType=0x1, subtype=0x0, date=(0, 0)),
  kids=[StringFileInfo([StringTable('040904B0', [
    StringStruct('CompanyName', 'Nikki Studio Contributors'),
    StringStruct('FileDescription', 'Nikki Studio - Home Save Editor'),
    StringStruct('FileVersion', '{version}'),
    StringStruct('InternalName', 'NikkiStudio'),
    StringStruct('OriginalFilename', 'NikkiStudio.exe'),
    StringStruct('ProductName', 'Nikki Studio'),
    StringStruct('ProductVersion', '{version}')
  ])]), VarFileInfo([VarStruct('Translation', [1033, 1200])])]
)
'''


def windows_bundle(output, version, requested_worker=None):
    if os.name != 'nt' or platform.machine().lower() not in {'amd64', 'x86_64'}:
        raise SystemExit('Windows x64 binaries must be built on Windows x64')
    if not (ROOT / 'node_modules/three/package.json').is_file():
        raise SystemExit('Run npm ci first')
    worker, worker_manifest = parser_worker(requested_worker)
    icon = ROOT / 'frontend/app-icon.ico'
    if not icon.is_file():
        raise ValueError('The application icon is missing')
    if (output / 'NikkiStudio').exists():
        raise FileExistsError('Output already contains NikkiStudio; use a new output directory')
    work = ROOT / 'test-results' / ('portable-build-' + uuid.uuid4().hex[:12])
    work.mkdir(parents=True)
    version_file = work / 'version-info.txt'
    version_file.write_text(version_resource(version), encoding='utf-8')
    log = work / 'BUILD.log'
    command = [sys.executable, '-m', 'PyInstaller', '--noconfirm', '--clean', '--onedir', '--windowed',
               '--name', 'NikkiStudio', '--icon', str(icon), '--version-file', str(version_file),
               '--distpath', str(work / 'dist'), '--workpath', str(work / 'work'),
               '--specpath', str(work), '--paths', str(ROOT),
               '--add-data', str(ROOT / 'frontend') + ';frontend',
               '--add-data', str(ROOT / 'node_modules/three') + ';node_modules/three',
               '--add-data', str(ROOT / 'third_party') + ';third_party',
               '--add-data', str(ROOT / 'package.json') + ';.',
               '--hidden-import', 'tkinter', '--hidden-import', 'tkinter.filedialog', str(ROOT / 'launch.py')]
    print('Building Portable EXE; diagnostics: ' + str(log), flush=True)
    with log.open('wb') as stream:
        result = subprocess.run(command, cwd=ROOT, stdout=stream, stderr=subprocess.STDOUT)
    if result.returncode:
        raise RuntimeError('Portable build failed; diagnostics: ' + str(log))
    bundle = work / 'dist/NikkiStudio'
    shutil.copytree(worker, bundle / '_internal/parser-worker')
    runtime_config = json.loads((worker / 'Nikki.AssetWorker.runtimeconfig.json').read_text(encoding='utf-8'))
    dotnet_version = next(item['version'] for item in runtime_config['runtimeOptions']['includedFrameworks']
                          if item['name'] == 'Microsoft.NETCore.App')
    package_cache = Path(os.environ.get('NUGET_PACKAGES') or Path.home() / '.nuget/packages')
    runtime_pack = package_cache / 'microsoft.netcore.app.runtime.win-x64' / dotnet_version
    for name in ('LICENSE.TXT', 'THIRD-PARTY-NOTICES.TXT'):
        source = runtime_pack / name
        if not source.is_file():
            raise ValueError('Missing .NET runtime notice: ' + str(source))
        target = bundle / 'third_party/runtime/dotnet' / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
    (bundle / 'ClearCache.cmd').write_text('@echo off\r\nstart "" "%~dp0NikkiStudio.exe" --clear-cache\r\n', encoding='ascii')
    (bundle / 'Exit.cmd').write_text('@echo off\r\n"%~dp0NikkiStudio.exe" --stop\r\n', encoding='ascii')
    shutil.copy2(ROOT / 'docs/PORTABLE.md', bundle / 'README.md')
    for name in ['LICENSE', 'NOTICE.md']:
        shutil.copy2(ROOT / name, bundle / name)
    shutil.copytree(ROOT / 'third_party', bundle / 'third_party', dirs_exist_ok=True)
    versions = runtime_licenses(bundle)
    build_info = {'version': version, 'platform': 'win-x64', 'python': platform.python_version(),
                  'dependencies': versions, 'parser': worker_manifest, 'dotNetRuntime': dotnet_version,
                  'iconSha256': digest(icon)}
    (bundle / 'build-info.json').write_text(json.dumps(build_info, indent=2), encoding='utf-8')
    files = []
    for file in sorted(bundle.rglob('*')):
        if not file.is_file():
            continue
        if file.suffix.lower() in {'.pak', '.utoc', '.ucas', '.usmap', '.glb', '.record'}:
            raise ValueError('Unexpected game input in Portable output: ' + file.name)
        files.append({'path': file.relative_to(bundle).as_posix(), 'size': file.stat().st_size,
                      'sha256': digest(file)})
    (bundle / 'file-manifest.json').write_text(json.dumps(files, indent=2), encoding='utf-8')
    target = output / 'NikkiStudio'
    shutil.move(str(bundle), str(target))
    return target


def archive_folder(folder, target):
    with zipfile.ZipFile(target, 'x', compression=zipfile.ZIP_DEFLATED) as archive:
        for file in sorted(folder.rglob('*')):
            if file.is_file():
                archive.write(file, 'NikkiStudio/' + file.relative_to(folder).as_posix())


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--windows', action='store_true', help='Build source ZIP and Windows Portable ZIP')
    parser.add_argument('--portable', action='store_true', help='Build only the Windows Portable package')
    parser.add_argument('--out-dir')
    parser.add_argument('--worker-dir')
    parser.add_argument('--checksums', action='store_true', help='Also write SHA256SUMS.txt for downloads')
    args = parser.parse_args()
    policy_file = ROOT / 'project-policy.json'
    policy = json.loads(policy_file.read_text(encoding='utf-8')) if policy_file.exists() else {}
    if policy.get('releaseEnabled') is not True:
        raise SystemExit('当前为本地源码开发阶段，已禁用发布打包。仅在用户明确要求正式发布后更新 project-policy.json。')
    report = audit()
    output = Path(args.out_dir).resolve() if args.out_dir else ROOT.parent / 'NIKKI_BUILDER_RELEASE'
    version = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
    if not re.fullmatch(r'\d+\.\d+\.\d+', version):
        raise ValueError('Release version must contain three numeric components')
    artifacts = []
    source_archive = output / ('NikkiStudio-' + version + '-source.zip')
    windows_archive = output / ('NikkiStudio-' + version + '-portable-win-x64.zip')
    expected = ([] if args.portable else [source_archive]) + ([windows_archive] if args.windows or args.portable else [])
    for file in expected + [output / 'release-manifest.json'] + ([output / 'SHA256SUMS.txt'] if args.checksums else []):
        if file.exists():
            raise FileExistsError('Refusing to overwrite an existing release artifact: ' + str(file))
    output.mkdir(parents=True, exist_ok=True)
    if not args.portable:
        with zipfile.ZipFile(source_archive, 'x', compression=zipfile.ZIP_DEFLATED) as archive:
            for file in release_files():
                archive.write(file, 'NikkiStudio/' + file.relative_to(ROOT).as_posix())
        artifacts.append(source_archive)
    if args.windows or args.portable:
        bundle = windows_bundle(output, version, args.worker_dir)
        archive_folder(bundle, windows_archive)
        artifacts.append(windows_archive)
    report['artifacts'] = [{'name': file.name, 'size': file.stat().st_size} for file in artifacts]
    if args.checksums:
        for file, row in zip(artifacts, report['artifacts']):
            row['sha256'] = digest(file)
    (output / 'release-manifest.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    if args.checksums:
        (output / 'SHA256SUMS.txt').write_text(''.join(row['sha256'] + '  ' + row['name'] + '\n'
                                                    for row in report['artifacts']), encoding='utf-8')
    print(json.dumps(report, indent=2))
