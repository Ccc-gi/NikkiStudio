"""Explicit synthetic UI test server; does not enable a fake mode in production."""
import argparse
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fixtures import create_game, fixture_runtime
from backend.storage import Storage, write_json
from backend.server import Application, handler_for
import backend.server as backend
from http.server import ThreadingHTTPServer

if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--root', required=True)
    p.add_argument('--port', type=int, default=8770)
    args = p.parse_args()
    root = Path(args.root).resolve()
    values = create_game(root / 'game')
    (root / 'input.usmap').write_bytes(values.pop('usmapBytes'))
    write_json(root / 'fixture-inputs.json', values)
    backend.Runtime = fixture_runtime()
    app = Application(Storage(root / 'empty-data'))
    server = ThreadingHTTPServer(('127.0.0.1', args.port), handler_for(app))
    print(f'SYNTHETIC test only: http://127.0.0.1:{args.port}; inputs: {root}', flush=True)
    server.serve_forever()
