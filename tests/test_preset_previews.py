import base64
import io
import tempfile
import unittest
from PIL import Image
from backend.presets import Presets
from backend.preset_previews import PresetPreviews
from backend.storage import Storage


class PreviewTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.storage = Storage(self.temp.name)
        self.presets = Presets(self.temp.name)
        self.presets.save('庭院', [{'cfg_item_id': 1170000001, 'colors': [2], 'trans': {
            'position': dict(x=0, y=0, z=0), 'rotation': dict(x=0, y=0, z=0),
            'scale': dict(x=1, y=1, z=1)}}])
        self.version = 'game-a'
        self.previews = PresetPreviews(self.storage, self.presets, lambda: self.version)
        image = Image.new('RGB', (512, 320), '#e9edf0')
        stream = io.BytesIO(); image.save(stream, format='PNG')
        self.encoded = base64.b64encode(stream.getvalue()).decode()

    def tearDown(self):
        self.temp.cleanup()

    def test_cached_png_is_separate_from_portable_preset(self):
        before = self.presets.export()
        key = self.previews.key('庭院')
        self.previews.save('庭院', key, self.encoded)
        self.assertTrue(self.previews.describe(self.presets.list()[0])['previewUrl'])
        self.assertEqual(self.presets.export(), before)
        self.assertTrue(self.previews.path(key).is_relative_to(self.storage.cache))

    def test_game_update_and_cache_epoch_invalidate_without_deleting_old_png(self):
        key = self.previews.key('庭院')
        self.previews.save('庭院', key, self.encoded)
        self.version = 'game-b'
        next_key = self.previews.key('庭院')
        self.assertNotEqual(next_key, key)
        self.assertTrue(self.previews.path(key).exists())
        self.storage.reset_epoch()
        self.assertNotEqual(self.previews.key('庭院'), next_key)
        self.assertEqual(len(self.presets.list()), 1)

    def test_rename_reuses_image_but_layout_change_invalidates(self):
        key = self.previews.key('庭院')
        self.presets.rename('庭院', '新名字')
        self.assertEqual(self.previews.key('新名字'), key)
        doc = self.presets.read('新名字')
        doc['items'][0]['trans']['position']['x'] = 10
        self.presets.save('新名字', doc['items'])
        self.assertNotEqual(self.previews.key('新名字'), key)

    def test_stale_key_wrong_png_size_and_path_traversal_are_rejected(self):
        with self.assertRaises(ValueError):
            self.previews.save('庭院', '0' * 64, self.encoded)
        with self.assertRaises(ValueError):
            self.previews.path('../../private/config')
        key = self.previews.key('庭院')
        with self.assertRaises(ValueError):
            self.previews.save('庭院', key, base64.b64encode(b'not png').decode())
        stream = io.BytesIO(); Image.new('RGB', (1, 1)).save(stream, format='PNG')
        with self.assertRaises(ValueError):
            self.previews.save('庭院', key, base64.b64encode(stream.getvalue()).decode())


if __name__ == '__main__':
    unittest.main()
