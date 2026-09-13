"""Download the pinned FloorCAD checkpoint, verify it, and export local ONNX.

Run using the optional model-build environment described in models/README.md.
Images are never uploaded. Model weights are distributed under AGPL-3.0.
"""
from pathlib import Path
import hashlib
import json
import urllib.request
from benchmark_models import load_detector

ROOT = Path(__file__).resolve().parents[1]
REVISION = '02995225d7aed598bc7e0214f5b7f3fe7fe95657'
SHA256 = 'be1a5a404c5ad1c454ba7531e2c16548a6330945319cbf989751ff73578b494c'
REPO = 'mudasir13cs/floorcad-yolov8n-detect'


def main():
    folder = ROOT / 'models'
    folder.mkdir(exist_ok=True)
    path = folder / 'floorcad-nano.pt'
    if not path.exists() or hashlib.sha256(path.read_bytes()).hexdigest() != SHA256:
        url = f'https://huggingface.co/{REPO}/resolve/{REVISION}/floorcad-yolov8n-detect.pt'
        temporary = path.with_suffix('.download')
        with urllib.request.urlopen(url, timeout=60) as response, temporary.open('wb') as target:
            while block := response.read(1024 * 256):
                target.write(block)
        if hashlib.sha256(temporary.read_bytes()).hexdigest() != SHA256:
            raise ValueError('Model download is incomplete or has an unexpected checksum. Retry setup.')
        temporary.replace(path)
    model = load_detector(path)
    model.export(format='onnx', imgsz=1280, device='cpu', opset=17, simplify=False, dynamic=False)
    metadata = {'repo': REPO, 'revision': REVISION, 'license': 'agpl-3.0', 'sha256': SHA256,
                'onnx_sha256': hashlib.sha256(path.with_suffix('.onnx').read_bytes()).hexdigest(),
                'input_size': 1280, 'opset': 17, 'preprocessing': 'bright_strokes_215_on_black'}
    (folder / 'floorcad-nano-source.json').write_text(json.dumps(metadata, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
