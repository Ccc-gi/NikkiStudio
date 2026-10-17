import tempfile
import threading
import unittest
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

from backend.server import Application, handler_for
from backend.storage import Storage
from launch import stop_server


class StopServerTests(unittest.TestCase):
    def test_stop_matches_configuration_and_cache_before_shutting_down(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            app = Application(Storage(root / 'active'))
            server = ThreadingHTTPServer(('127.0.0.1', 0), handler_for(app))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                with self.assertRaises(ValueError):
                    stop_server(server.server_port, root / 'another-instance')
                with urllib.request.urlopen(f'http://127.0.0.1:{server.server_port}/api/session') as response:
                    self.assertEqual(response.status, 200)
                self.assertTrue(stop_server(server.server_port, root / 'active'))
                thread.join(timeout=3)
                self.assertFalse(thread.is_alive())
            finally:
                server.shutdown()
                server.server_close()
