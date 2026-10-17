import importlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from backend.runtime_check import check_runtime, write_report


class RuntimeCheckTests(unittest.TestCase):
    def test_native_dependencies_and_png_roundtrip(self):
        report = check_runtime()
        self.assertTrue(report['passed'], report)
        self.assertTrue(report['pngRoundtrip'])

    def test_missing_imaging_is_reported_without_crashing(self):
        original = importlib.import_module

        def missing(name):
            if name == 'PIL._imaging':
                raise ModuleNotFoundError('native imaging fixture unavailable')
            return original(name)

        with tempfile.TemporaryDirectory() as folder, patch(
                'backend.runtime_check.importlib.import_module', side_effect=missing):
            path = Path(folder) / 'diagnostics.json'
            report = write_report(path)
            self.assertFalse(report['passed'])
            self.assertIn('native imaging fixture unavailable', report['modules']['PIL._imaging']['error'])
            self.assertTrue(path.is_file())

    def test_frozen_runtime_rejects_dependencies_from_development_machine(self):
        with tempfile.TemporaryDirectory() as folder, patch('sys.frozen', True, create=True), \
                patch('sys._MEIPASS', folder, create=True):
            report = check_runtime()
            self.assertFalse(report['passed'])
            self.assertIn('outside the Portable bundle', report['modules']['PIL._imaging']['error'])


if __name__ == '__main__':
    unittest.main()
