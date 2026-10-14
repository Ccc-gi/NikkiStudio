"""Audit an explicit release allowlist, independent of .gitignore."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOP = {'README.md', 'LICENSE', 'NOTICE.md', '.gitignore', 'requirements.txt', 'requirements-build.txt',
       'package.json', 'package-lock.json', 'config.example.json', 'keys.example.json', 'start.py', 'launch.py'}
FOLDERS = {'frontend', 'backend', 'asset_pipeline', 'adapters', 'tests', 'docs', 'third_party', '.github'}
SCRIPTS = {'audit_release.py', 'build_release.py', 'setup_dependencies.py', 'build_parser_worker.py'}


def release_files():
    for path in sorted(ROOT.rglob('*')):
        rel = path.relative_to(ROOT)
        if not path.is_file() or '__pycache__' in rel.parts:
            continue
        if len(rel.parts) == 1 and path.name in TOP or rel.parts[0] in FOLDERS or rel.parts[0] == 'scripts' and path.name in SCRIPTS or rel.parts[0] == 'parser_worker' and len(rel.parts) == 2 and path.suffix in ('.cs', '.csproj'):
            yield path


def audit(files=None):
    problems = []
    files = list(files or release_files())
    for path in files:
        rel = path.relative_to(ROOT)
        if path.suffix.lower() in {'.ucas', '.utoc', '.pak', '.usmap', '.glb', '.exe', '.record'}:
            problems.append(str(rel) + ': forbidden game/private/binary input')
        if path.stat().st_size > 2 * 1024 * 1024:
            problems.append(str(rel) + ': unexpected large source file')
        text = path.read_text(encoding='utf-8')
        if re.search(r'[A-Z]:[\\/]Users[\\/][^\\/\s]+', text, re.I):
            problems.append(str(rel) + ': machine-specific user path')
        if re.search(r'[A-Z]:[\\/]games[\\/]', text, re.I):
            problems.append(str(rel) + ': machine-specific game path')
        # A literal 256-bit credential next to a key field is never a config example.
        if re.search(r'["\x27](?:mainKey|key)["\x27]\s*:\s*["\x27](?:0x)?[0-9a-fA-F]{64}["\x27]', text):
            problems.append(str(rel) + ': literal AES input')
    if problems:
        raise ValueError('\n'.join(problems))
    return {'files': len(files), 'sourceBytes': sum(p.stat().st_size for p in files), 'status': 'passed'}


if __name__ == '__main__':
    import json
    print(json.dumps(audit(), indent=2))
