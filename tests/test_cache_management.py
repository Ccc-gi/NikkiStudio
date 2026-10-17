import json
import tempfile
import unittest
import threading
import urllib.request
import urllib.error
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from backend.storage import Storage, write_json
from backend.cache_management import clear_old, migrate, inventory, external_staging
from backend.server import Application, handler_for


class ManagedCacheTests(unittest.TestCase):
    def test_default_is_project_cache_and_custom_data_is_isolated(self):
        with tempfile.TemporaryDirectory() as temp:
            with patch.dict('os.environ', {'LOCALAPPDATA': temp, 'NIKKI_STUDIO_DATA': ''}):
                store = Storage()
                self.assertEqual(store.cache, Path(__file__).resolve().parents[1] / 'local/cache')
            store = Storage(Path(temp) / 'test-user')
            self.assertEqual(store.cache, store.root / 'cache')

    def test_portable_cache_is_next_to_executable_and_private_data_stays_separate(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            executable = base / 'portable/NikkiStudio.exe'
            with patch.dict('os.environ', {'LOCALAPPDATA': str(base / 'user'), 'NIKKI_STUDIO_DATA': ''}), \
                    patch('sys.frozen', True, create=True), patch('sys.executable', str(executable)):
                store = Storage()
                self.assertEqual(store.cache, base / 'portable/cache')
                self.assertEqual(store.private, base / 'user/NikkiStudio/private')
                isolated = Storage(base / 'isolated')
                self.assertEqual(isolated.cache, base / 'isolated/cache')

    def test_migration_preserves_epoch_pointer_bytes_and_private_data(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            store = Storage(base / 'user', base / 'project/local/cache')
            version = 'a' * 64
            old = store.root / 'cache' / version
            write_json(old / 'manifest.json', {'version': version})
            (old / 'model.glb').write_bytes(b'model-bytes')
            write_json(store.root / 'active.json', {'directory': version})
            epoch = store.cache_epoch()
            write_json(store.private / 'config.json', {'keep': 'private'})
            write_json(store.root / 'presets/preset.json', {'keep': 'preset'})
            migrate(store)
            self.assertFalse((store.root / 'cache').exists())
            self.assertEqual((store.active() / 'model.glb').read_bytes(), b'model-bytes')
            self.assertEqual(store.cache_epoch(), epoch)
            self.assertTrue((store.root / 'presets/preset.json').exists())
            self.assertEqual(store.config(), {'keep': 'private'})

    def test_only_old_versions_removed(self):
        with tempfile.TemporaryDirectory() as temp:
            store = Storage(temp)
            active, old = 'a' * 64, 'b' * 64
            for name in (active, old, 'preset-previews', 'staging-registry'):
                write_json(store.cache / name / 'manifest.json', {})
            store.activate(store.cache / active)
            clear_old(store)
            self.assertFalse((store.cache / old).exists())
            self.assertTrue(store.active().exists())
            self.assertTrue((store.cache / 'preset-previews').exists())

    def test_conflicts_do_not_overwrite(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            store = Storage(base / 'user', base / 'managed')
            write_json(store.root / 'cache/item.json', {'source': True})
            write_json(store.cache / 'item.json', {'target': True})
            with self.assertRaises(ValueError):
                migrate(store)
            self.assertTrue((store.root / 'cache/item.json').exists())

    def test_external_registry_cannot_authorize_arbitrary_directories(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            store = Storage(base / 'user')
            write_json(store.private / 'config.json', {'gameRoot': str(base / 'game')})
            write_json(store.cache / 'staging-registry/bad.json', {'path': str(base / 'personal')})
            self.assertEqual(external_staging(store), [])

    def test_http_management_auth_and_browser_header(self):
        with tempfile.TemporaryDirectory() as temp:
            store = Storage(temp)
            for name in ('a' * 64, 'b' * 64):
                write_json(store.cache / name / 'manifest.json', {})
            store.activate(store.cache / ('a' * 64))
            app = Application(store)
            server = ThreadingHTTPServer(('127.0.0.1', 0), handler_for(app))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            url = f'http://127.0.0.1:{server.server_port}'
            def post(path, token):
                return urllib.request.urlopen(urllib.request.Request(url + path, data=b'{}', headers={
                    'Origin': url, 'X-Nikki-Token': token, 'Content-Type': 'application/json'}))
            try:
                with self.assertRaises(urllib.error.HTTPError) as error:
                    post('/api/cache/old', 'wrong')
                self.assertEqual(error.exception.code, 403)
                error.exception.close()
                self.assertTrue((store.cache / ('b' * 64)).exists())
                with post('/api/cache/old', app.token) as response:
                    self.assertEqual(json.load(response)['removedVersions'], 1)
                self.assertTrue(store.active().exists())
                with post('/api/cache/browser', app.token) as response:
                    self.assertEqual(response.headers['Clear-Site-Data'], '"cache"')
                with urllib.request.urlopen(url + '/save_scene.html') as response:
                    self.assertEqual(response.headers['Cache-Control'], 'no-store')
            finally:
                server.shutdown()
                server.server_close()
                thread.join()
