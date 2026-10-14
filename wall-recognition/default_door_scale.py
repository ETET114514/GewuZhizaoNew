"""Estimate an unscaled plan once at entry, keeping existing calibration intact."""
import math
from statistics import median

from model_settings import apply_model_settings
from opening_direction import direction_rooms, opening_context
from opening_editing import opening_host
from refine_walls import is_active_opening


def estimate_default_door_scale(document):
    scale = document.get('scale_mm_per_px')
    if type(scale) in (int,float) and math.isfinite(scale) and scale > 0:
        return document, None
    candidates = []
    rooms = None
    for opening in document.get('openings', []):
        if opening.get('kind') != 'door' or not is_active_opening(opening) or opening.get('door_model') == 'entry':
            continue
        known = opening.get('dimensions_mm', {}).get('width_mm')
        # Do not reinterpret an explicitly dimensioned 900/1200 mm door as 800 mm.
        if known is not None and known != 800:
            continue
        axis = 0 if opening['orientation'] == 'horizontal' else 1
        width = abs(opening['end_px'][axis]-opening['start_px'][axis])
        if not math.isfinite(width) or width < max(5, opening.get('thickness_px',0)*2):
            continue
        try:
            opening_host(document, opening)
        except ValueError:
            continue
        if rooms is None:
            rooms = direction_rooms(document)
        context = opening_context(document, opening, rooms)
        # A door with one closed indoor side is an exterior candidate; only a
        # confirmed 800 mm physical dimension allows that reference automatically.
        if context['interior_side'] and known is None:
            continue
        interior = bool(context['negative'] and context['positive'])
        candidates.append((opening,width,interior))
    if not candidates:
        return document, None
    typical = median(width for _,width,_ in candidates)
    candidates.sort(key=lambda c:(not c[2],c[0].get('review_status')!='confirmed',abs(c[1]-typical),c[0]['id']))
    for opening,_,_ in candidates:
        try:
            result,record = apply_model_settings(document,dict(door_calibration=dict(opening_id=opening['id'],width_mm=800)))
        except ValueError:
            continue
        result['calibration']['automatic'] = True
        record['summary'] = f"默认按普通门 {opening['id']} 门洞 800 mm 估算全图比例；可撤销或重新标定"
        return result,record
    return document,None


def apply_default_door_scale(run, history=True):
    document,record = estimate_default_door_scale(run['document'])
    if record is None:
        return False
    if history:
        run['history'].append((run['document'],list(run['changes']),run['next_id']))
        run['history'] = run['history'][-50:]
    run['document'] = document
    run['changes'].append(record)
    return True
