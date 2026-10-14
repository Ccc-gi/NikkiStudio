"""Portable source entry point; paths resolve relative to this file, never cwd."""
import argparse
from backend.server import serve

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8768)
    parser.add_argument('--data-dir')
    args = parser.parse_args()
    serve(args.port, args.data_dir)
