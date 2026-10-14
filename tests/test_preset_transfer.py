import json
import os
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch
from backend.presets import Presets, FORMAT, LIBRARY_FORMAT
from backend.storage import Storage
from backend.cache_reset import reset_resources


def item(ident=1170000001):
    return {'cfg_item_id': ident, 'attach_id': 0, 'colors': [10, 20],
            'trans': {'position': {'x': 12.5, 'y': -4, 'z': 0},
                      'rotation': {'x': 0, 'y': 35, 'z': 0},
                      'scale': {'x': 1, 'y': 1, 'z': 1}}}


class TransferTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = Presets(self.temp.name)
        self.store.save('温馨庭院', [item()])

    def tearDown(self):
        self.temp.cleanup()

    def test_backup_import_on_another_computer_keeps_layout_and_colors(self):
        backup = self.store.export()
        self.assertEqual(backup['format'], LIBRARY_FORMAT)
        with tempfile.TemporaryDirectory() as second:
            other = Presets(second)
            other.import_documents([json.loads(json.dumps(backup))])
            self.assertEqual(other.export(), backup)
            self.assertEqual(Presets(second).export(), backup)

    def test_same_name_and_windows_filename_collisions_keep_both(self):
        original = self.store.export('温馨庭院')
        result = self.store.import_documents([original, original])
        self.assertEqual(len(self.store.list()), 3)
        self.assertEqual(len({r['id'].casefold() for r in result['imported']}), 2)
        self.assertEqual(self.store.export('温馨庭院'), original)
        doc = dict(original, name='CON')
        saved = self.store.import_documents([doc])['imported'][0]
        self.assertTrue(saved['id'].startswith('preset-'))

    def test_invalid_batch_does_not_import_anything(self):
        good = self.store.export('温馨庭院')
        bad = dict(good, version=999)
        with self.assertRaises(ValueError):
            self.store.import_documents([good, bad])
        self.assertEqual(len(self.store.list()), 1)
        bad = dict(good, items=[item(), {'cfg_item_id': 0}])
        with self.assertRaises(ValueError):
            self.store.import_documents([bad])
        self.assertEqual(len(self.store.list()), 1)

    def test_copy_and_rename_are_independent(self):
        copied = self.store.duplicate('温馨庭院')
        self.store.rename(copied['id'], '另一个庭院')
        self.assertEqual(self.store.read('另一个庭院')['items'], self.store.read('温馨庭院')['items'])
        self.assertEqual(len(self.store.list()), 2)

    def test_unknown_game_items_are_preserved(self):
        doc = self.store.export('温馨庭院')
        doc['items'][0]['cfg_item_id'] = 1999999999
        result = self.store.import_documents([doc])['imported'][0]
        self.assertEqual(self.store.read(result['id'])['items'][0]['cfg_item_id'], 1999999999)

    def test_disk_failure_rolls_back_only_new_imports(self):
        from backend.storage import write_json
        doc = self.store.export('温馨庭院')
        calls = []
        def failing_write(path, value):
            calls.append(path)
            if len(calls) == 2:
                raise OSError('disk full')
            write_json(path, value)
        with patch('backend.presets.write_json', side_effect=failing_write):
            with self.assertRaises(OSError):
                self.store.import_documents([doc, doc])
        self.assertEqual(self.store.export('温馨庭院'), doc)
        self.assertEqual(len(self.store.list()), 1)

    def test_concurrent_imports_do_not_overwrite(self):
        doc = self.store.export('温馨庭院')
        with ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(lambda _: self.store.import_documents([doc]), range(8)))
        self.assertEqual(len(self.store.list()), 9)

    @unittest.skipUnless(os.name == 'nt', 'Windows cache-reset acceptance')
    def test_actual_cache_reset_keeps_presets_and_private_inputs(self):
        storage = Storage(self.temp.name)
        (storage.cache / 'generated').write_bytes(b'cache')
        (storage.private / 'marker').write_bytes(b'private')
        backup = self.store.export()
        with patch('backend.cache_reset.subprocess.run') as run:
            run.return_value.stdout = b''
            self.assertEqual(reset_resources(storage, ports=()), 5)
        self.assertEqual(self.store.export(), backup)
        self.assertEqual((storage.private / 'marker').read_bytes(), b'private')
        self.assertFalse((storage.cache / 'generated').exists())


if __name__ == '__main__':
    unittest.main()
