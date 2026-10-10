"""Create a new project with newly recognized windows; retain reviewed geometry."""
import argparse
from copy import deepcopy
from datetime import datetime
from io import BytesIO
import json
from pathlib import Path
import sys
import uuid

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from PIL import Image
from project_store import load_project
from recognize_walls import detect_walls
from recognize_openings import detect_openings, ALGORITHM
from refine_walls import initialize_refinement, refresh_refinement
from recognize_furniture import furniture_export


def recover(document,image):
    result=deepcopy(document)
    detected=detect_openings(image,detect_walls(image,**document.get('parameters',{})))
    def represented(candidate):
        axis=0 if candidate['orientation']=='horizontal' else 1
        for original in document['openings']:
            geometry=original.get('detected_geometry',original)
            if geometry['orientation']!=candidate['orientation']:continue
            overlap=min(geometry['end_px'][axis],candidate['end_px'][axis])-max(geometry['start_px'][axis],candidate['start_px'][axis])
            transverse=abs(geometry['start_px'][1-axis]-candidate['start_px'][1-axis])
            if overlap>.5*min(geometry['length_px'],candidate['length_px']) and transverse<=max(4,(geometry['thickness_px']+candidate['thickness_px'])/2):return True
        return False
    added=[]
    next_opening=max((int(o['id'][1:]) for o in result['openings']),default=0)+1
    next_wall=max([int(w['id'][1:]) for w in result['walls']]+[int(w[1:]) for w in result.get('opening_wall_ids',{}).values()]+[int(w[1:]) for w in result.get('suppressed_connection_ids',[])])+1
    for candidate in detected:
        if candidate['kind']!='window' or represented(candidate):continue
        candidate=deepcopy(candidate);candidate['id']=f'O{next_opening:03d}';next_opening+=1
        prepared=initialize_refinement(dict(image=result['image'],walls=result['walls'],openings=[candidate]),image)['openings'][0]
        result['openings'].append(prepared)
        result.setdefault('opening_wall_ids',{})[prepared['id']]=f'W{next_wall:03d}';next_wall+=1
        added.append(prepared['id'])
    rooms=result.pop('room_partition',None)
    result=refresh_refinement(result)
    if rooms is not None:
        if added:rooms['opening_geometry_changed']=True
        result['room_partition']=rooms
    result['opening_algorithm']=ALGORITHM
    return result,added,next_wall


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('project_id');args=parser.parse_args()
    saved=load_project(ROOT/'projects',args.project_id)
    image=Image.open(BytesIO(saved['png'])).convert('RGB')
    document,added,next_id=recover(saved['document'],image)
    if not added:print(json.dumps(dict(added=[],project_id=args.project_id)));sys.exit(0)
    identifier=datetime.now().strftime('%Y%m%d-%H%M%S')+'-'+uuid.uuid4().hex[:6]
    destination=ROOT/'projects'/identifier;destination.mkdir(exist_ok=False)
    (destination/'floorplan.png').write_bytes(saved['png'])
    records=saved['changes']+[dict(id=o,opening_id=o,type='opening_recovery',summary=f'{o} 已补识别外围玻璃窗') for o in added]
    files={'walls.json':document,'changes.json':records,'project.json':dict(version=1,next_id=max(saved['next_id'],next_id)),
           'furniture.json':furniture_export(document),'solid-walls.json':dict(image=document['image'],scale_mm_per_px=document.get('scale_mm_per_px'),coordinate_system=document['coordinate_system'],solid_wall_segments=document['solid_wall_segments'])}
    if 'room_partition' in document:files['regions.json']=document['room_partition']
    for name,value in files.items():(destination/name).write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(dict(added=added,project_id=identifier,opening_count=len(document['openings'])),ensure_ascii=False))
