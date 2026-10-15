import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from backend.server import source_runtime_config


ROOT = Path(__file__).resolve().parents[1]


class SourceModeTest(unittest.TestCase):
    def test_release_build_is_blocked_before_creating_output(self):
        policy = json.loads((ROOT / 'project-policy.json').read_text(encoding='utf-8'))
        self.assertFalse(policy['releaseEnabled'])
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / 'must-not-exist'
            result = subprocess.run([sys.executable, '-X', 'utf8', str(ROOT / 'scripts/build_release.py'),
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
