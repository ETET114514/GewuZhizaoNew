"""Follow-up hypothesis: cropped symbols were enlarged beyond model scale.

Three fixed scales are tested for every room, with no per-room tuning.
All additions remain proposals. This is not an automatic room detector.
"""
from copy import deepcopy
import json
from time import perf_counter
import numpy as np
from PIL import Image
from evaluate import OUT, ROOT, MODEL, CLASS_MAP, FAMILY, PREFERRED, inside, merge, metrics, render
from recognize_learned_furniture import predict, detect_learned, session

rows=json.loads((OUT/'results.json').read_text(encoding='utf-8'))
report=[]
session(str(MODEL))
for row in rows:
    region=row['region']
    image=Image.open(ROOT/('input/furniture-references/06.jpg' if row['image']=='gray' else 'input/reference-plans/04-furnished.png')).convert('RGB')
    x0,y0,x1,y1=region['bbox_px']
    crop=image.crop(region['bbox_px'])
    background=tuple(int(v) for v in np.median(np.asarray(image).reshape(-1,3),axis=0))
    base=row['predictions']['full']
    # Control: lower the score threshold on the original full-image predictions.
    control=[]
    for raw in row['raw_full']:
        kind=CLASS_MAP.get(raw['label'])
        if kind in PREFERRED[region['name']] and .4 <= raw['score'] < .55:
            control.append(dict(kind=kind,bbox_px=raw['bbox_px'],match_score=raw['score'],source='full_lower_score'))
    lower=merge(base,control)
    variants={}
    union=deepcopy(base)
    for zoom in (1.0,1.5,2.0):
        side=max(max(crop.size),round(max(image.size)/zoom))
        canvas=Image.new('RGB',(side,side),background)
        left,top=(side-crop.width)//2,(side-crop.height)//2
        canvas.paste(crop,(left,top))
        started=perf_counter()
        found,status=detect_learned(canvas)
        elapsed=perf_counter()-started
        translated=[]
        for f in found:
            a,b,c,d=f['bbox_px']
            f=deepcopy(f)
            f['bbox_px']=[round(a-left+x0,2),round(b-top+y0,2),round(c-left+x0,2),round(d-top+y0,2)]
            if inside(f,region['bbox_px']):
                f['crop_scale']=zoom
                translated.append(f)
        preferred=[f for f in translated if FAMILY.get(f['kind'],f['kind']) in PREFERRED[region['name']]]
        combined=merge(base,preferred)
        union=merge(union,preferred)
        variants[str(zoom)]={'seconds':round(elapsed,3),'predictions':translated,'preferred':preferred,
                             'combined':combined,'metrics':metrics(combined,region['targets'])}
    record={'image':row['image'],'region':region,'full':row['metrics']['full'],
            'lower_full_metrics':metrics(lower,region['targets']),'variants':variants,
            'union':union,'union_metrics':metrics(union,region['targets'])}
    report.append(record)
    render(image,region,[('整图',base),('保持尺度补检',variants['1.0']['combined']),('三尺度补检',union)],OUT/f"{row['image']}-{region['name']}-scale.png")
    (OUT/'scale-results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(row['image'],region['name'],'full',row['metrics']['full']['hits'],
          'lower_full',record['lower_full_metrics']['hits'],
          'scales',{z:v['metrics']['hits'] for z,v in variants.items()},'union',record['union_metrics']['hits'],flush=True)
print('TOTAL full',sum(r['full']['hits'] for r in report),'lower_full',sum(r['lower_full_metrics']['hits'] for r in report),
      'scales',{z:sum(r['variants'][z]['metrics']['hits'] for r in report) for z in ('1.0','1.5','2.0')},
      'union',sum(r['union_metrics']['hits'] for r in report),flush=True)
