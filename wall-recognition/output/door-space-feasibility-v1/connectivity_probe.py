"""Compare existing floor boundaries with repaired wall-top connectivity offline."""
from copy import deepcopy
import json
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from partition_rooms import partition_rooms
from opening_direction import contains
import numpy as np

doc = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
top = json.loads(Path(sys.argv[2]).read_text(encoding='utf-8'))

def calculate(source):
    start = time.perf_counter()
    result = partition_rooms(source)
    elapsed = (time.perf_counter() - start) * 1000
    regions = result['regions']
    doors = []
    for opening in doc['openings']:
        if opening.get('kind') != 'door' or opening.get('review_status') == 'rejected':
            continue
        span = opening.get('connection_span', opening)
        axis = 0 if span['orientation'] == 'horizontal' else 1
        box = span['bbox_px']
        middle = [(box[0]+box[2])/2, (box[1]+box[3])/2]
        sides = []
        for sign in (-1, 1):
            point = middle.copy()
            point[1-axis] = box[1-axis if sign < 0 else 3-axis] + sign
            sides.append([r['id'] for r in regions if contains(r, point)])
        doors.append(dict(id=opening['id'], door_model=opening.get('door_model'), sides=sides))
    return dict(elapsed_ms=round(elapsed, 2), region_count=len(regions),
                regions=regions, doors=doors,
                skipped_opening_ids=result['skipped_opening_ids'])

baseline = deepcopy(doc)
baseline['room_edits'] = {}
structural = deepcopy(baseline)
structural['walls'] = []
filter_thickness = float(np.median([w['thickness_px'] for w in baseline['walls']
    if w.get('review_status') != 'rejected']))
for i, box in enumerate(top['rects']):
    horizontal = box[2]-box[0] >= box[3]-box[1]
    structural['walls'].append(dict(id=f'T{i:03d}', bbox_px=box,
        thickness_px=filter_thickness,
        orientation='horizontal' if horizontal else 'vertical', review_status='confirmed'))

result = dict(input_project=Path(sys.argv[1]).parent.name, scale_mm_per_px=doc['scale_mm_per_px'],
    baseline=calculate(baseline), repaired_wall_top=calculate(structural))
combined = deepcopy(baseline)
combined['walls'].extend(structural['walls'])
result['combined_boundaries'] = calculate(combined)
Path(sys.argv[3]).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
for variant in ('baseline', 'repaired_wall_top', 'combined_boundaries'):
    data = result[variant]
    print(variant, data['region_count'], 'regions', data['elapsed_ms'], 'ms')
    for door in data['doors']:
        print(door['id'], door['sides'])
