"""Use the one source checkout for live iteration, retaining private user data."""
import json
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

root = Path(__file__).resolve().parents[1]
url = 'http://127.0.0.1:8769'
try:
    session = json.load(urllib.request.urlopen(url + '/api/session', timeout=2))
except (urllib.error.URLError, OSError):
    session = None
if session:
    assert session['application'] == 'NikkiStudio'
    data = session['status']['dataDirectory']
    request = urllib.request.Request(url + '/api/shutdown', data=b'{}', headers={
        'Content-Type': 'application/json', 'Origin': url, 'X-Nikki-Token': session['token']})
    urllib.request.urlopen(request, timeout=3).close()
    for _ in range(100):
        try:
            urllib.request.urlopen(url + '/api/session', timeout=.3).close()
        except (urllib.error.URLError, OSError):
            break
        time.sleep(.1)
    else:
        raise RuntimeError('Previous preview did not stop')
else:
    data = None
args = [str(root / '.venv/Scripts/python.exe'), '-X', 'utf8', str(root / 'launch.py'), '--no-browser', '--port', '8769']
import os
default_data = Path(os.environ.get('NIKKI_STUDIO_DATA') or
                    Path(os.environ.get('LOCALAPPDATA', Path.home())) / 'NikkiStudio').resolve()
if data and Path(data).resolve() != default_data:
    args += ['--data-dir', data]
log = root / 'test-results/source-preview.log'
log.parent.mkdir(exist_ok=True)
with log.open('ab') as output:
    process = subprocess.Popen(args, cwd=root, stdout=output, stderr=output,
                               creationflags=subprocess.CREATE_NO_WINDOW)
for _ in range(160):
    try:
        current = json.load(urllib.request.urlopen(url + '/api/session', timeout=1))
        if current['status']['ready']:
            print('Source preview ready: ' + url + '; PID=' + str(process.pid))
            break
    except (urllib.error.URLError, OSError):
        pass
    if process.poll() is not None:
        raise RuntimeError(log.read_text(encoding='utf-8', errors='replace'))
    time.sleep(.25)
else:
    raise RuntimeError('Source preview not ready; inspect ' + str(log))
