"""Serialized stdio RPC to one mounted parser; no credentials in argv or logs."""
import json
import os
import queue
import subprocess
import threading
from pathlib import Path


class ParserWorker:
    def __init__(self, executable, config):
        self.lock = threading.Lock()
        self.responses = queue.Queue()
        self.process = subprocess.Popen([str(executable)], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, text=True, encoding='utf-8',
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        def reader():
            for line in self.process.stdout:
                try:
                    self.responses.put(json.loads(line))
                except ValueError:
                    self.responses.put({'ok': False, 'error': 'Invalid worker response'})
            self.responses.put({'ok': False, 'error': 'Parser worker exited'})
        threading.Thread(target=reader, daemon=True).start()
        self.info = self.request({'op': 'init', **{k: config[k] for k in ('gameRoot', 'keysFile', 'usmapFile')}}, timeout=120)

    def request(self, message, timeout=360):
        with self.lock:
            self.process.stdin.write(json.dumps(message, ensure_ascii=False) + '\n')
            self.process.stdin.flush()
            try:
                result = self.responses.get(timeout=timeout)
            except queue.Empty:
                self.close()
                raise ValueError('常驻解析器超时') from None
            if not result.get('ok'):
                raise ValueError('常驻解析器失败：' + result.get('error', 'Unknown error'))
            return result

    def export(self, packages, output, fmt):
        result = self.request({'op': 'export', 'packages': packages, 'output': str(Path(output).resolve()), 'format': fmt})
        if result.get('errors') and fmt == 'json':
            raise ValueError('解析器无法转换：' + '; '.join(result['errors'][:8]))
        return result

    def close(self):
        if self.process.poll() is None:
            try:
                self.process.stdin.close()
                self.process.wait(timeout=5)
            except (OSError, subprocess.TimeoutExpired):
                self.process.kill()  # only this object's own worker, never an external parser
                self.process.wait()
