"""Offline diagnostics for the bundled Python/native runtime, without game inputs."""
import importlib
import importlib.machinery
import io
import json
import platform
import sys
from pathlib import Path


def check_runtime():
    frozen = bool(getattr(sys, 'frozen', False))
    internal = Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parents[1])).resolve()
    report = {'python': sys.version, 'windows': platform.platform(), 'machine': platform.machine(),
              'frozen': frozen, 'extensionSuffixes': importlib.machinery.EXTENSION_SUFFIXES,
              'modules': {}, 'passed': True}
    for name in ('PIL._imaging', 'PIL.Image', 'numpy', 'cryptography.hazmat.bindings._rust'):
        try:
            module = importlib.import_module(name)
            origin = Path(module.__file__).resolve()
            if frozen and not origin.is_relative_to(internal):
                raise RuntimeError('Module was loaded outside the Portable bundle: ' + str(origin))
            report['modules'][name] = {'ok': True, 'path': str(origin)}
        except Exception as error:
            report['passed'] = False
            report['modules'][name] = {'ok': False, 'error': repr(error)}
    try:
        from PIL import Image
        stream = io.BytesIO()
        Image.new('RGBA', (512, 320), (240, 217, 168, 255)).save(stream, format='PNG')
        stream.seek(0)
        with Image.open(stream) as image:
            image.load()
            assert image.size == (512, 320) and image.getpixel((0, 0)) == (240, 217, 168, 255)
        report['pngRoundtrip'] = True
    except Exception as error:
        report['passed'] = False
        report['pngRoundtrip'] = repr(error)
    if frozen:
        import ctypes
        report['pillowNativeFiles'] = []
        for file in sorted((internal / 'PIL').glob('_imaging*.pyd')):
            row = {'name': file.name, 'size': file.stat().st_size}
            if sys.platform == 'win32':
                try:
                    ctypes.WinDLL(str(file), winmode=0x1100)
                    row['loadLibrary'] = 'passed'
                except OSError as error:
                    row.update(loadLibrary=str(error), winerror=error.winerror)
            report['pillowNativeFiles'].append(row)
    return report


def write_report(path):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    report = check_runtime()
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    return report
