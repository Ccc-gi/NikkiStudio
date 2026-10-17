import json
import subprocess
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from backend.server import source_runtime_config, serve, VERSION


ROOT = Path(__file__).resolve().parents[1]


class SourceModeTest(unittest.TestCase):
    def test_existing_source_instance_is_not_reused_for_a_different_cache(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            existing = {'application': 'NikkiStudio', 'version': VERSION,
                        'status': {'dataDirectory': str(root), 'cacheDirectory': str(root / 'different-cache')}}
            with patch('backend.server.ThreadingHTTPServer', side_effect=OSError), \
                    patch('urllib.request.urlopen') as urlopen, patch('webbrowser.open') as open_browser:
                urlopen.return_value.__enter__.return_value.read.return_value = json.dumps(existing).encode()
                with self.assertRaises(RuntimeError):
                    serve(8769, str(root), open_browser=True)
                open_browser.assert_not_called()

    def test_release_build_is_blocked_before_creating_output(self):
        with tempfile.TemporaryDirectory() as folder:
            isolated = Path(folder)
            scripts = isolated / 'scripts'
            scripts.mkdir()
            for name in ('build_release.py', 'audit_release.py'):
                shutil.copy2(ROOT / 'scripts' / name, scripts / name)
            (isolated / 'project-policy.json').write_text(json.dumps({'releaseEnabled': False}))
            output = isolated / 'must-not-exist'
            result = subprocess.run([sys.executable, '-X', 'utf8', str(scripts / 'build_release.py'),
                                     '--windows', '--out-dir', str(output)], capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('已禁用发布打包', result.stderr.decode('utf-8'))
            self.assertFalse(output.exists())

    def test_old_dist_paths_migrate_without_mutating_original_config(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            worker = root / 'local/parser-worker-mips/Nikki.AssetWorker.exe'
            worker.parent.mkdir(parents=True); worker.write_bytes(b'fixture')
            original = {'parser': str(root / 'dist/v0.3.0/worker.exe'),
                        'parserWorker': str(root / 'dist/v0.3.0/worker.exe'), 'cacheEpoch': 'keep'}
            with patch('backend.server.ROOT', root):
                updated = source_runtime_config(original)
            self.assertEqual(updated['parser'], str(worker))
            self.assertEqual(updated['parserWorker'], str(worker))
            self.assertEqual(updated['cacheEpoch'], 'keep')
            self.assertIn('dist', original['parser'])

    def test_custom_external_worker_is_preserved(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            worker = root / 'local/parser-worker-mips/Nikki.AssetWorker.exe'
            worker.parent.mkdir(parents=True); worker.write_bytes(b'fixture')
            original = {'parser': str(root.parent / 'custom.exe'), 'parserWorker': str(root.parent / 'custom.exe')}
            with patch('backend.server.ROOT', root):
                self.assertEqual(source_runtime_config(original), original)


if __name__ == '__main__':
    unittest.main()
