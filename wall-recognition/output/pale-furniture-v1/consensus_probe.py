from probe import ROOT,OUT
from PIL import Image,ImageOps
import cv2,numpy as np,json
from recognize_learned_furniture import predict,CLASS_MAP
from recognize_furniture import overlap,geometry,draw_furniture
image=Image.open(next((ROOT.parent/'平面图').glob('*395*'))).convert('RGB')
gray=np.asarray(image.convert('L'))
views={'inverse':ImageOps.invert(image),
       'contrast':ImageOps.invert(ImageOps.autocontrast(image.convert('L'),cutoff=1)).convert('RGB'),
       'clahe':Image.fromarray(255-cv2.createCLAHE(clipLimit=2,tileGridSize=(8,8)).apply(gray)).convert('RGB')}
items=[]
for name,base in views.items():
 for turns in range(4):
  rotated=base.rotate(90*turns,expand=True)
  raw=predict(rotated,ROOT/'models/floorcad-nano.onnx',threshold=.3)
  for r in raw:
   if r['label'] not in CLASS_MAP:continue
   a,b,c,d=r['bbox_px']; pts=[(a,b),(c,b),(c,d),(a,d)]
   for _ in range(turns):
    # Reverse each CCW transform; dimensions change at each reverse step.
    pass
   if turns==1:pts=[(image.width-y,x) for x,y in pts]
   elif turns==2:pts=[(image.width-x,image.height-y) for x,y in pts]
   elif turns==3:pts=[(y,image.height-x) for x,y in pts]
   xs,ys=zip(*pts)
   items.append(dict(kind=CLASS_MAP[r['label']],bbox_px=[min(xs),min(ys),max(xs),max(ys)],score=r['score'],view=name,turns=turns))
kept=[]
for f in sorted(items,key=lambda f:-f['score']):
 if f['score']<.65:continue
 box=f['bbox_px']; aspect=max((box[2]-box[0])/(box[3]-box[1]),(box[3]-box[1])/(box[2]-box[0]))
 if f['kind']=='bed' and aspect>2.4:continue
 support=[s for s in items if (s['view'],s['turns'])!=(f['view'],f['turns']) and s['kind']==f['kind'] and s['score']>=.45 and overlap(box,s['bbox_px'])[0]>.65]
 if not support:continue
 if any(overlap(box,s['bbox_px'])[1]>.6 for s in kept):continue
 f['support']=[{k:v for k,v in s.items() if k!='support'} for s in support];kept.append(f)
for f in kept:print(f['kind'],round(f['score'],2),f['bbox_px'],[(s['view'],s['turns'],round(s['score'],2)) for s in f['support']],flush=True)
(OUT/'consensus.json').write_text(json.dumps({'raw':items,'kept':kept},indent=2))
draw_furniture(image,[geometry(dict(f,id=f'F{i:03d}',review_status='unreviewed')) for i,f in enumerate(kept,1)]).save(OUT/'consensus.png')
