"""Reproduce the feedback-image result; template source calibration only."""
from pathlib import Path
import sys, json, time
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from PIL import Image,ImageDraw
from web_server import recognize_upload
from recognize_openings import draw_openings
from recognize_furniture import draw_furniture
root=Path(__file__).resolve().parents[2]
out=Path(__file__).parent
source=root/'input/furniture-references/11-light-rendered.png'
start=time.perf_counter()
doc=recognize_upload(source.read_bytes(),source.name)['document']
(out/'result.json').write_text(json.dumps(doc,ensure_ascii=False,indent=2),encoding='utf-8')
image=Image.open(source).convert('RGBA')
layer=Image.new('RGBA',image.size)
draw=ImageDraw.Draw(layer)
for w in doc['solid_wall_segments']:
    draw.rectangle(w['bbox_px'],fill=(35,103,206,65),outline=(35,103,206,180))
preview=Image.alpha_composite(image,layer).convert('RGB')
preview=draw_openings(preview,doc['openings'])
draw_furniture(preview,doc['furniture']).save(out/'result.png')
print(json.dumps(dict(seconds=round(time.perf_counter()-start,1),
    doors=sum(o['kind']=='door' for o in doc['openings']),
    boundaries=doc['refinement_summary']['uncertain_boundary_count'],
    objects=len(doc['furniture']),areas=sum(f['kind']=='unclassified_area' for f in doc['furniture']))))
