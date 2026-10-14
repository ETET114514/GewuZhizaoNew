"""Isolated UI review server using a copy of the saved reference project."""
import json
from pathlib import Path
import shutil
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from web_server import ReviewServer

with tempfile.TemporaryDirectory(prefix='space-partition-review-') as folder:
    root = Path(folder)
    source = ROOT/'projects/20261014-203817-f33e1d'
    shutil.copytree(source, root/'projects'/source.name)
    server = ReviewServer(('127.0.0.1', 0), root/'feedback')
    print(json.dumps(dict(origin=f'http://127.0.0.1:{server.server_address[1]}', project=source.name)), flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()
