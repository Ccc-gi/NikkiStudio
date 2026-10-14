"""Build the pinned parser worker with a local .NET 10 SDK. No game inputs required."""
import argparse
import json
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REVISION = 'ab447bbcd4e11f426c41c417cacd937fab71c789'


def build(dotnet='dotnet', source=None, output=None):
    source = Path(source).resolve() if source else ROOT / 'local/CUE4Parse'
    output = Path(output).resolve() if output else ROOT / 'local/parser-worker'
    if not source.exists():
        source.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(['git', 'clone', 'https://github.com/joric/CUE4Parse.CLI.git', str(source)], check=True)
        subprocess.run(['git', 'checkout', REVISION], cwd=source, check=True)
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=source, text=True).strip()
    if revision != REVISION:
        raise ValueError('Parser dependency revision mismatch')
    # Use the pinned upstream image dependency. The worker accepts game packages,
    # never arbitrary image files, TIFF processing, or histogram operations.
    props = source / 'Directory.Packages.props'
    text = props.read_text(encoding='utf-8').replace('[3.2.0]', '[3.1.12]').replace('[4.1.3]', '[3.1.12]')
    props.write_text(text, encoding='utf-8')
    project = ROOT / 'parser_worker/Nikki.AssetWorker.csproj'
    result = subprocess.run([str(dotnet), 'publish', str(project), '-c', 'Release', '-r', 'win-x64',
                             '--self-contained', 'true', '-p:CueSource=' + str(source), '-o', str(output)],
                            capture_output=True)
    log = ROOT / 'test-results/WORKER_BUILD.log'
    log.parent.mkdir(exist_ok=True)
    log.write_bytes(result.stdout + result.stderr)
    if result.returncode:
        raise RuntimeError('Worker build failed; diagnostics: ' + str(log))
    for name in ('LICENSE', 'NOTICE'):
        shutil.copy2(source / name, output / ('CUE4Parse-' + name + '.txt'))
    assets = json.loads((ROOT / 'parser_worker/obj/project.assets.json').read_text())
    license_root = output / 'licenses'
    for package, info in assets['libraries'].items():
        if info.get('type') != 'package':
            continue
        for folder in assets['packageFolders']:
            base = Path(folder) / info['path']
            if not base.is_dir():
                continue
            for name in info.get('files', []):
                file = base / name
                if file.is_file() and (file.suffix == '.nuspec' or any(word in file.name.lower() for word in ('license', 'notice', 'copying'))):
                    target = license_root / package / file.name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(file, target)
    (output / 'build-manifest.json').write_text(json.dumps({'revision': REVISION, 'framework': 'net10.0',
                                                           'selfContained': True}, indent=2))
    return output


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--dotnet', default='dotnet')
    parser.add_argument('--source')
    parser.add_argument('--output')
    args = parser.parse_args()
    print(build(args.dotnet, args.source, args.output))
