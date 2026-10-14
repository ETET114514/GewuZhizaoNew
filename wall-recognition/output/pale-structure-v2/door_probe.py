from probe import *
import cv2
from recognize_openings import line_segments, door_candidates, fitted_door_candidates, suppress
gray=np.asarray(im.convert('L'))
bg=cv2.morphologyEx(gray,cv2.MORPH_CLOSE,np.ones((13,13),np.uint8))
enh=np.minimum(gray,255-np.clip((bg.astype(float)-gray)/24,0,1)*210).astype('uint8')
enhanced=Image.fromarray(enh).convert('RGB')
walls=json.loads((out/'baseline.json').read_text())['walls']
scale=max(.5,min(im.size)/745,float(np.median([w['thickness_px'] for w in walls]))/12)
lines=line_segments(enh.astype(float),scale)
from recognize_pale_doors import detect_pale_doors
doors=detect_pale_doors(im,walls,scale)
from recognize_pale_boundaries import detect_pale_boundaries
doors+=detect_pale_boundaries(im,walls,scale)
doors=suppress(doors,scale)
for i,d in enumerate(doors):d['id']=str(i+1)
print('scale',scale,'lines',len(lines),'doors',len(doors))
print([(d['bbox_px'],d['score']) for d in doors])
(out/'doors-probe.json').write_text(json.dumps(doors,indent=2))
draw_openings(im,doors).save(out/'doors-probe.png')
