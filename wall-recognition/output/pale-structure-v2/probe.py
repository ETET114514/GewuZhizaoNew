import sys, json, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from PIL import Image
import numpy as np
from recognize_walls import detect_walls, draw_overlay
from recognize_openings import detect_openings, draw_openings

root = Path(__file__).resolve().parents[2]
out = Path(__file__).parent
im = Image.open(root/'input/furniture-references/11-light-rendered.png').convert('RGB')
if __name__ == '__main__':
    start=time.perf_counter()
    walls=detect_walls(im)
    openings=detect_openings(im,walls)
    (out/'baseline.json').write_text(json.dumps(dict(walls=walls,openings=openings),indent=2))
    draw_openings(draw_overlay(im,walls),openings).save(out/'baseline.png')
    print('baseline',len(walls),len(openings),time.perf_counter()-start)
    gray=np.array(im.convert('L'))
    for name,box in [('left',(112,220,150,480)),('top',(200,140,420,170)),('lower-left',(380,980,425,1170))]:
        x0,y0,x1,y1=box
        vals,counts=np.unique(gray[y0:y1,x0:x1],return_counts=True)
        print(name,sorted(zip(vals.tolist(),counts.tolist()),key=lambda v:-v[1])[:15])
    for name,box in [('top-doors',(740,130,1110,500)),('right-entry',(1025,570,1130,765)),('lower-doors',(680,770,1420,1135)),('perimeter',(85,130,180,270))]:
        im.crop(box).resize(((box[2]-box[0])*2,(box[3]-box[1])*2)).save(out/(name+'.png'))
