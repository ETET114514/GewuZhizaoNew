"""Per-opening dimensions and movement on a continuous host wall."""
from copy import deepcopy
import math

from model_settings import DEFAULTS, number
from refine_walls import GENERATED, aligned, axis_of, is_active_opening, refresh_refinement, segment


def opening_host(document, opening):
    axis = axis_of(opening)
    a, b = opening['start_px'][axis], opening['end_px'][axis]
    candidates = [w for w in document['walls'] if w.get('review_status') != 'rejected'
                  and aligned(w, opening)]
    groups = []
    for wall in sorted(candidates, key=lambda w: w['start_px'][axis]):
        start, end = wall['start_px'][axis], wall['end_px'][axis]
        if groups and start <= groups[-1]['b'] + .01:
            groups[-1]['b'] = max(end, groups[-1]['b'])
            groups[-1]['walls'].append(wall)
        else:
            groups.append(dict(a=start, b=end, walls=[wall]))
    group = next((g for g in groups if g['a'] <= a + .1 and g['b'] >= b - .1), None)
    if not group:
        raise ValueError('门窗未贴合连续墙段，请先校核墙体或确认门窗类型。')
    host = next((w for w in group['walls'] if w['id'] == opening.get('host_wall_id')), None)
    host = host or max(group['walls'], key=lambda w: (w.get('source') != GENERATED, w['length_px']))
    return dict(**group, axis=axis, center=host['start_px'][1-axis], thickness=host['thickness_px'], id=host['id'])


def validate_opening_settings(opening, settings):
    values = opening.get('dimensions_mm', {})
    if not isinstance(values, dict) or set(values) - {'width_mm', 'height_mm', 'sill_height_mm'}:
        raise ValueError('门窗尺寸格式不正确。')
    for key, value in values.items():
        number(value, 0 if key == 'sill_height_mm' else 100, 20000, key)
    height = values.get('height_mm', settings['window_height_mm'] if opening['kind'] == 'window' else settings['door_height_mm'])
    sill = values.get('sill_height_mm', settings['sill_height_mm']) if opening['kind'] == 'window' else 0
    if opening['kind'] == 'door' and values.get('sill_height_mm', 0) != 0:
        raise ValueError('门洞需从地面开始，离地高度为 0。')
    if sill + height > settings['wall_height_mm'] + 1e-6:
        raise ValueError(f"{opening['id']} 的离地高度加洞口高度不能超过墙高。")


def apply_opening_edit(document, request):
    result = deepcopy(document)
    opening = next((o for o in result.get('openings', []) if o['id'] == request.get('opening_id')), None)
    if not opening or opening['kind'] not in ('door', 'window') or not is_active_opening(opening):
        raise ValueError('请选择有效的门或窗；待定边界需先确认为门窗。')
    scale = document.get('scale_mm_per_px')
    if type(scale) not in (int, float) or not math.isfinite(scale) or scale <= 0:
        raise ValueError('请先标定比例，再按厘米编辑门窗。')
    settings = {**DEFAULTS, **document.get('model_settings', {})}
    host = opening_host(result, opening)
    axis = host['axis']
    values = request.get('dimensions_mm', {})
    if not isinstance(values, dict) or set(values) - {'width_mm', 'height_mm', 'sill_height_mm'}:
        raise ValueError('门窗尺寸格式不正确。')
    dimensions = {**opening.get('dimensions_mm', {}), **values}
    if request.get('preset') is not None:
        if request['preset'] != 'floor_glass' or opening['kind'] != 'window':
            raise ValueError('落地玻璃预设仅适用于窗。')
        dimensions.update(height_mm=settings['wall_height_mm'], sill_height_mm=0)
    opening['dimensions_mm'] = dimensions
    validate_opening_settings(opening, settings)
    width = dimensions.get('width_mm', (opening['end_px'][axis]-opening['start_px'][axis])*scale)/scale
    if width > host['b']-host['a'] + 1e-6:
        raise ValueError('门窗宽度不能超过所属连续墙段。')
    center = request.get('center_px', (opening['start_px'][axis]+opening['end_px'][axis])/2)
    center = number(center, 0, document['image']['width_px' if axis == 0 else 'height_px'], '沿墙位置')
    center = max(host['a']+width/2, min(host['b']-width/2, center))
    a, b = center-width/2, center+width/2
    for other in result.get('openings', []):
        if other['id'] != opening['id'] and is_active_opening(other) and aligned(other, opening):
            if min(b, other['end_px'][axis])-max(a, other['start_px'][axis]) > .01:
                raise ValueError('这个位置与其他门窗重叠，请缩小宽度或沿墙移动。')
    # Keep the old structural axis: relocating a generated gap must refill its old
    # aperture, not delete the supporting span and leave an invisible wall hole.
    for wall in host['walls']:
        if wall.get('source') == GENERATED:
            wall['source'] = 'assisted_opening_host'
            wall['review_status'] = 'edited'
    opening.update(segment(axis, a, b, host['center'], host['thickness']))
    opening['dimensions_mm']['width_mm'] = width*scale
    opening.update(host_wall_id=host['id'], review_status='confirmed')
    opening['connection_span'] = segment(axis, a, b, host['center'], host['thickness'])
    # Preserve edited room outlines and materials rather than silently replacing
    # them with a fresh automatic partition when only a window is moved.
    rooms = result.pop('room_partition', None)
    result = refresh_refinement(result)
    if rooms is not None:
        original = next(o for o in document['openings'] if o['id'] == opening['id'])
        if opening['start_px'] != original['start_px'] or opening['end_px'] != original['end_px']:
            rooms['opening_geometry_changed'] = True
        result['room_partition'] = rooms
    return result, dict(id=opening['id'], opening_id=opening['id'], type='opening_edit',
                        summary=f"{opening['id']} 已更新尺寸与沿墙位置")
