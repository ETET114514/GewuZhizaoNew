"""Whole-image appearance diagnostic, without room detection or crop matching."""
from pathlib import Path
import sys,json
import numpy as np
import cv2
from PIL import Image,ImageOps
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
from recognize_learned_furniture import predict,CLASS_MAP
from recognize_furniture import draw_furniture,geometry
OUT=Path(__file__).resolve().parent
source=next((ROOT.parent/'平面图').glob('*395*'))
image=Image.open(source).convert('RGB')
gray=np.asarray(image.convert('L'))
variants={'original':image,'inverse':ImageOps.invert(image),
          'contrast_inverse':ImageOps.invert(ImageOps.autocontrast(image.convert('L'),cutoff=1)).convert('RGB'),
          'clahe_inverse':Image.fromarray(255-cv2.createCLAHE(clipLimit=2,tileGridSize=(8,8)).apply(gray)).convert('RGB')}
for threshold in (175,200,215,230,240,248):
    variants[f'binary_{threshold}']=Image.fromarray((gray<threshold).astype('uint8')*255).convert('RGB')
report={}
for name,variant in variants.items():
    raw=predict(variant,ROOT/'models/floorcad-nano.onnx',threshold=.3)
    items=[geometry(dict(kind=CLASS_MAP[r['label']],bbox_px=r['bbox_px'],rotation_deg=None,
                         id=f'F{i:03d}',match_score=r['score'],review_status='unreviewed'))
           for i,r in enumerate(raw,1) if r['label'] in CLASS_MAP]
    draw_furniture(image,items).save(OUT/f'{name}.png')
    report[name]=raw
    print(name,[(r['label'],round(r['score'],2),r['bbox_px']) for r in raw if r['label'] in CLASS_MAP],flush=True)
(OUT/'probe.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
