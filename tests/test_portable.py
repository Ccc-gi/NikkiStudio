"""Run with python -m unittest discover -s tests. Synthetic fixtures only."""
import base64
import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from http.server import ThreadingHTTPServer
from unittest.mock import patch
from types import SimpleNamespace
from backend.storage import Storage, digest
from backend.config import save_config
from backend.server import Application, handler_for
from fixtures import create_game, fixture_runtime


class PortableTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='nikki-portable-')
        self.root = Path(self.temp.name)
        self.values = create_game(self.root / 'different computer' / 'game')
        self.storage = Storage(self.root / 'empty user data')
        self.config = save_config(self.storage, self.values['gameRoot'], self.values['keys'],
                                  self.values['usmapBytes'], self.values['parser'])
        self.Runtime = fixture_runtime()

    def tearDown(self):
        self.temp.cleanup()

    def test_demand_export_and_update_recovery(self):
        runtime = self.Runtime(self.config, self.storage)
        runtime.mount()
        self.assertFalse((runtime.directory / 'assets').exists(), 'Mount must not pre-bake models')
        relative = next(iter(runtime.mapping.values()))['components'][0]['package'].replace('.uasset', '.glb')
        model = runtime.asset(relative)
        old_bytes, old_active = model.read_bytes(), self.storage.active()
        self.assertEqual(runtime.asset(relative).read_bytes(), old_bytes)
        create_game(Path(self.values['gameRoot']), revision=2)
        self.assertFalse(runtime.current(force=True))
        bad = {**self.config, 'usmapFile': str(self.root / 'bad.usmap')}
        Path(bad['usmapFile']).write_bytes(b'bad')
        # Invalid AES prevents activation, leaving the complete previous cache intact.
        bad_keys = json.loads(Path(self.config['keysFile']).read_text())
        for row in bad_keys['dynamicKeys']:
            row['key'] = 'FF' * 32
        bad_config = save_config(self.storage, self.values['gameRoot'], bad_keys,
                                self.values['usmapBytes'], self.values['parser'])
        with self.assertRaises(ValueError):
            self.Runtime(bad_config, self.storage).mount()
        self.assertEqual(self.storage.active(), old_active)
        self.assertEqual(model.read_bytes(), old_bytes)
        new = self.Runtime(self.config, self.storage)
        new.mount()
        self.assertNotEqual(new.version, runtime.version)
        self.assertNotEqual(new.asset(relative).read_bytes(), old_bytes)
        self.assertEqual(model.read_bytes(), old_bytes)

    def test_http_origin_private_files_and_empty_setup(self):
        app = Application(self.storage)
        server = ThreadingHTTPServer(('127.0.0.1', 0), handler_for(app))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        url = f'http://127.0.0.1:{server.server_port}'
        try:
            status = json.load(urllib.request.urlopen(url + '/api/status'))
            self.assertFalse(status['configured'])
            body = json.dumps({'gameRoot': self.values['gameRoot'], 'keys': self.values['keys'],
                               'usmap': base64.b64encode(self.values['usmapBytes']).decode(), 'parser': self.values['parser']}).encode()
            request = urllib.request.Request(url + '/api/configure', data=body, headers={'Content-Type': 'application/json'})
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(request)
            self.assertEqual(error.exception.code, 403)
            error.exception.close()
            with patch('backend.server.Runtime', self.Runtime):
                request.add_header('Origin', url)
                request.add_header('X-Nikki-Token', app.token)
                self.assertEqual(urllib.request.urlopen(request).status, 202)
                import time
                deadline = time.monotonic() + 15
                while app.job['state'] == 'running' and time.monotonic() < deadline:
                    time.sleep(.02)
                self.assertEqual(app.job['state'], 'ready', app.job)
            for path in ['/private/config.json', '/private/' + Path(self.config['keysFile']).name, '/%2e%2e/backend/config.py']:
                with self.assertRaises(urllib.error.HTTPError) as error:
                    urllib.request.urlopen(url + path)
                error.exception.close()
            mapping = json.load(urllib.request.urlopen(url + '/scene_mapping.json'))
            asset = next(iter(mapping.values()))['path']
            self.assertEqual(urllib.request.urlopen(url + asset).read()[:4], b'glTF')
            create_game(Path(self.values['gameRoot']), revision=2)
            self.assertTrue(json.load(urllib.request.urlopen(url + '/api/status'))['changed'])
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(url + asset)
            self.assertEqual(error.exception.code, 409)
            error.exception.close()
            recovery = json.load(urllib.request.urlopen(url + '/api/recovery-mapping'))
            self.assertEqual(urllib.request.urlopen(url + next(iter(recovery.values()))['path']).read()[:4], b'glTF')
        finally:
            server.shutdown()
            server.server_close()

    def test_invalid_usmap_keeps_old_pointer(self):
        runtime = self.Runtime(self.config, self.storage)
        runtime.mount()
        active = self.storage.active()
        bad_file = self.root / 'wrong.usmap'
        bad_file.write_bytes(b'{"url":"metadata-is-not-usmap"}')
        with self.assertRaises(ValueError):
            self.Runtime({**self.config, 'usmapFile': str(bad_file)}, self.storage).mount()
        self.assertEqual(self.storage.active(), active)

    def test_archive_priority_and_ambiguity(self):
        from adapters.archive_order import select_current
        old = {'archive': 'Delay_Map_2827_P.utoc'}
        new = {'archive': 'Delay_Map_m4_2843_2865_P.utoc'}
        self.assertEqual(select_current([new, old]), new)
        with self.assertRaises(ValueError):
            select_current([old, {'archive': 'Other_Map_2827_P.utoc'}])

    def test_staging_copy_fallback_does_not_modify_game(self):
        from asset_pipeline.runtime import Runtime
        runtime = self.Runtime(self.config, self.storage)
        runtime.mount()
        toc = Path(self.config['gameRoot']) / 'X6Game/Content/Paks/Test.utoc'
        before = digest(toc)
        package = next(iter(runtime.mapping.values()))['components'][0]['package']
        observed = []
        def child(command, **kwargs):
            stage = Path(command[command.index('-i') + 1])
            observed.append(stage)
            self.assertEqual((stage / 'Test.utoc').read_bytes()[64:80], bytes(16))
            self.assertEqual((stage / 'Test.ucas').read_bytes(), b'SYNTHETIC_GAME_1')
            self.assertIn(package, command)
            return SimpleNamespace(returncode=0)
        with patch('asset_pipeline.runtime.os.link', side_effect=OSError('simulated unsupported hardlinks')):
            with patch('asset_pipeline.runtime.subprocess.run', side_effect=child):
                Runtime.export(runtime, [package], self.root / 'output', 'mesh')
        self.assertEqual(digest(toc), before)
        self.assertFalse(observed[0].exists(), 'Staging must be removed after completion')

    def test_parallel_models_share_one_export_batch(self):
        import concurrent.futures
        runtime = self.Runtime(self.config, self.storage)
        runtime.mount()
        source = next(iter(runtime.mapping.values()))['components'][0]['package']
        packages = [source.replace('S_TestCube.uasset', f'S_TestCube{i}.uasset') for i in range(6)]
        for i, package in enumerate(packages):
            runtime.by_package[package] = [{**runtime.by_package[source][0], 'package': package}]
            runtime.mapping[str(i)] = {'components': [{'package': package}]}
        exported = []
        original = runtime.export
        def observed(packages, output, fmt):
            exported.append((list(packages), fmt))
            return original(packages, output, fmt)
        runtime.export = observed
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            files = list(pool.map(runtime.asset, [p.replace('.uasset', '.glb') for p in packages]))
        self.assertTrue(all(p.is_file() for p in files))
        self.assertEqual(len(exported), 1)
        self.assertEqual(len(exported[0][0]), 6)

    def test_cached_dependency_never_restarts_cli(self):
        from asset_pipeline.runtime import Runtime
        runtime = self.Runtime(self.config, self.storage)
        runtime.mount()
        package = next(iter(runtime.mapping.values()))['components'][0]['package']
        output = runtime.directory / 'properties'
        file = output / Path(package).with_suffix('.json')
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text('[{"Type":"StaticMesh","Properties":{}}]')
        with patch('asset_pipeline.runtime.subprocess.run') as child:
            Runtime.export(runtime, [package], output, 'json')
        child.assert_not_called()

if __name__ == '__main__':
    unittest.main()
