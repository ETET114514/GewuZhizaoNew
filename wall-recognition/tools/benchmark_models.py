"""Evaluate downloaded floor-plan detectors locally before enabling them in the app."""
from pathlib import Path
import argparse
import hashlib
import importlib
import json
import os
from time import perf_counter

ROOT = Path(__file__).resolve().parents[1]
os.environ['YOLO_CONFIG_DIR'] = str(ROOT / '.model-runtime')
os.environ['YOLO_AUTOINSTALL'] = 'false'


def load_detector(path):
    import torch
    from ultralytics import YOLO, settings
    from ultralytics.cfg import DEFAULT_CFG_DICT
    settings.update({'sync': False})
    torch.set_num_threads(4)
    # Checkpoints contain standard library model objects. Never enable arbitrary
    # pickle execution or import modules supplied by the checkpoint.
    allowed = []
    for name in torch.serialization.get_unsafe_globals_in_checkpoint(path):
        module, _, attr = name.rpartition('.')
        if not (module.startswith('torch.nn.') or module.startswith('ultralytics.nn.')):
            raise ValueError(f'Checkpoint global requires review: {name}')
        allowed.append(getattr(importlib.import_module(module),attr))
    with torch.serialization.safe_globals(allowed):
        checkpoint = torch.load(path, map_location='cpu', weights_only=True)
    net = (checkpoint.get('ema') or checkpoint['model']).float().eval()
    model = YOLO('yolov8n.yaml', task='detect')
    model.model = net
    model.model.task = 'detect'
    model.model.pt_path = str(path)
    model.model.args = {**DEFAULT_CFG_DICT, **getattr(net, 'args', {})}
    model.ckpt = checkpoint
    model.ckpt_path = str(path)
    model.overrides = {'model':str(path),'task':'detect'}
    return model


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('weights',type=Path)
    parser.add_argument('--export',action='store_true')
    parser.add_argument('--cad',action='store_true',help='Normalize light drawings to bright CAD strokes on black')
    parser.add_argument('--size',type=int,default=640)
    args = parser.parse_args()
    from PIL import Image
    model = load_detector(args.weights.resolve())
    out = ROOT/'output/model-trial'/args.weights.stem
    out.mkdir(exist_ok=True,parents=True)
    report={'weights_sha256':hashlib.sha256(args.weights.read_bytes()).hexdigest(),
            'names':model.names,'cases':[]}
    for name,rel in [('reference-04','input/reference-plans/04-furnished.png'),
                     ('default-plan','input/floorplan.png'),
                     ('reference-05','input/reference-plans/05-dimensioned.png')]:
        start=perf_counter()
        source=Image.open(ROOT/rel).convert('RGB')
        if args.cad:
            import numpy as np
            source=Image.fromarray(np.where(np.asarray(source.convert('L'))<215,255,0).astype('uint8')).convert('RGB')
        result=model.predict(source,device='cpu',imgsz=args.size,conf=.20,verbose=False)[0]
        detections=[{'label':model.names[int(b.cls.item())],'score':round(float(b.conf.item()),4),
                     'bbox_px':[round(float(v),2) for v in b.xyxy[0]]} for b in result.boxes]
        case={'case':name,'seconds':round(perf_counter()-start,3),'detections':detections}
        report['cases'].append(case)
        Image.fromarray(result.plot()[...,::-1]).save(out/f'{name}.png')
        print(json.dumps(case),flush=True)
    (out/'evaluation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    if args.export:
        model.export(format='onnx',imgsz=args.size,device='cpu',opset=17,simplify=False,dynamic=False)


if __name__=='__main__':
    main()
