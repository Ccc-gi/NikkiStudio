import json
import tempfile
import unittest
from pathlib import Path

from backend.presets import FORMAT, Presets, normalize_item, preset_id


def item(ident=1170001276, x=0.0, colors=(0,)):
    return {'cfg_item_id': ident, 'attach_id': 0, 'colors': list(colors),
            'trans': {'position': {'x': x, 'y': 1, 'z': 2},
                      'rotation': {'x': 0, 'y': 90, 'z': 0},
                      'scale': {'x': 1, 'y': 1, 'z': 1}}}


class PresetIdTest(unittest.TestCase):
    def test_keeps_a_readable_name(self):
        self.assertEqual(preset_id('湖心水池'), '湖心水池')
        self.assertEqual(preset_id('pond v2'), 'pond-v2')

    def test_a_path_never_survives_sanitising(self):
        for name in ('../evil', 'a/b', '..\\evil', 'C:evil'):
            self.assertNotIn('/', preset_id(name))
            self.assertNotIn('\\', preset_id(name))
            self.assertNotEqual(preset_id(name), name)

    def test_an_empty_name_still_yields_an_id(self):
        self.assertTrue(preset_id('   ').startswith('preset-'))

    def test_the_store_refuses_an_id_it_would_not_have_written(self):
        with tempfile.TemporaryDirectory() as folder:
            store = Presets(folder)
            for ident in ('../secret', 'a/b', '', 'a b'):
                with self.assertRaises(ValueError):
                    store.path(ident)


class NormalizeTest(unittest.TestCase):
    def test_a_usable_row_survives_round_trip(self):
        self.assertEqual(normalize_item(item()), item())

    def test_a_row_without_a_real_item_id_is_dropped(self):
        for raw in (None, 'text', {}, {'cfg_item_id': 0}, {'cfg_item_id': -1},
                    {'cfg_item_id': '1170001276'}, {'cfg_item_id': True}):
            self.assertIsNone(normalize_item(raw))

    def test_non_numeric_and_non_finite_values_fall_back(self):
        raw = item()
        raw['trans']['position'] = {'x': 'nonsense', 'y': float('nan'), 'z': 5}
        self.assertEqual(normalize_item(raw)['trans']['position'], {'x': 0.0, 'y': 0.0, 'z': 5.0})

    def test_a_missing_scale_defaults_to_one_not_zero(self):
        raw = item()
        raw['trans'].pop('scale')
        self.assertEqual(normalize_item(raw)['trans']['scale'], {'x': 1.0, 'y': 1.0, 'z': 1.0})

    def test_colour_codes_are_filtered(self):
        raw = item(colors=(0, 11, -3, 'x', 99999))
        self.assertEqual(normalize_item(raw)['colors'], [0, 11])


class StoreTest(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.store = Presets(self.folder.name)

    def tearDown(self):
        self.folder.cleanup()

    def test_an_empty_library_lists_nothing(self):
        self.assertEqual(self.store.list(), [])

    def test_save_list_read_round_trip(self):
        saved = self.store.save('湖心水池', [item(), item(1170001277, x=100)])
        self.assertEqual(saved, {'id': '湖心水池', 'name': '湖心水池', 'items': 2})
        self.assertEqual(self.store.list(), [{'id': '湖心水池', 'name': '湖心水池',
                                              'savedAt': self.store.list()[0]['savedAt'], 'items': 2}])
        document = self.store.read('湖心水池')
        self.assertEqual(document['format'], FORMAT)
        self.assertEqual(document['items'][1]['trans']['position']['x'], 100.0)
        self.assertEqual(document['id'], '湖心水池')

    def test_the_file_is_plain_json_on_disk(self):
        self.store.save('pond', [item()])
        written = json.loads((Path(self.folder.name) / 'presets' / 'pond.json').read_text(encoding='utf-8'))
        self.assertEqual(written['format'], FORMAT)
        self.assertEqual(written['items'][0]['cfg_item_id'], 1170001276)

    def test_saving_the_same_name_replaces_it(self):
        self.store.save('pond', [item()])
        self.store.save('pond', [item(), item()])
        self.assertEqual(len(self.store.list()), 1)
        self.assertEqual(len(self.store.read('pond')['items']), 2)

    def test_a_name_without_content_is_refused(self):
        with self.assertRaises(ValueError):
            self.store.save('', [item()])
        with self.assertRaises(ValueError):
            self.store.save('pond', [])
        with self.assertRaises(ValueError):
            self.store.save('pond', [{'cfg_item_id': 0}])

    def test_rename_moves_the_file(self):
        self.store.save('pond', [item()])
        self.assertEqual(self.store.rename('pond', '湖'), {'id': '湖', 'name': '湖'})
        self.assertEqual([row['id'] for row in self.store.list()], ['湖'])
        self.assertFalse((Path(self.folder.name) / 'presets' / 'pond.json').exists())
        self.assertEqual(self.store.read('湖')['name'], '湖')

    def test_rename_onto_an_existing_name_is_refused(self):
        self.store.save('one', [item()])
        self.store.save('two', [item()])
        with self.assertRaises(ValueError):
            self.store.rename('one', 'two')
        self.assertEqual(len(self.store.list()), 2)

    def test_remove_deletes_only_that_preset(self):
        self.store.save('one', [item()])
        self.store.save('two', [item()])
        self.store.remove('one')
        self.assertEqual([row['id'] for row in self.store.list()], ['two'])

    def test_reading_or_removing_a_missing_preset_is_an_error(self):
        with self.assertRaises(ValueError):
            self.store.read('missing')
        with self.assertRaises(ValueError):
            self.store.remove('missing')

    def test_a_corrupt_file_is_skipped_by_the_list(self):
        self.store.save('good', [item()])
        (Path(self.folder.name) / 'presets' / 'broken.json').write_text('{ not json', encoding='utf-8')
        (Path(self.folder.name) / 'presets' / 'other.json').write_text('{"format":"x"}', encoding='utf-8')
        self.assertEqual([row['id'] for row in self.store.list()], ['good'])


if __name__ == '__main__':
    unittest.main()
