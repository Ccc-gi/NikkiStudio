import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from backend.cache_reset import reset_resources
from backend.storage import Storage


@unittest.skipUnless(__import__('os').name == 'nt', 'Windows reset')
class CacheResetTest(unittest.TestCase):
    def test_reset_preserves_inputs_and_only_removes_cache(self):
        with tempfile.TemporaryDirectory() as folder:
            storage = Storage(folder)
            before_epoch = storage.cache_epoch()
            private = storage.private / 'config.json'
            private.write_bytes(b'{"keep":true}')
            save = Path(folder) / 'user-save.json'
            save.write_bytes(b'{"Snapshots":{}}')
            asset = storage.cache / 'version/assets/model.glb'
            asset.parent.mkdir(parents=True)
            asset.write_bytes(b'generated')
            (storage.root / 'active.json').write_bytes(b'{}')
            with patch('backend.cache_reset.subprocess.run', return_value=subprocess.CompletedProcess([], 0, b'', b'')):
                self.assertEqual(reset_resources(storage, ports=()), 9)
            self.assertEqual(private.read_bytes(), b'{"keep":true}')
            self.assertEqual(save.read_bytes(), b'{"Snapshots":{}}')
            self.assertEqual(list(storage.cache.iterdir()), [])
            self.assertFalse((storage.root / 'active.json').exists())
            self.assertNotEqual(storage.cache_epoch(), before_epoch)
