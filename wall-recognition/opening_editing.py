"""Per-opening dimensions and movement on a continuous host wall."""
from copy import deepcopy
import math

from model_settings import DEFAULTS, number
from window_preset import apply_window_preset
from refine_walls import GENERATED, aligned, axis_of, is_active_opening, refresh_refinement, segment

DOOR_WIDTH_PRESETS = {'entry_door_1200': 1200, 'bedroom_door_900': 900,
                      'bathroom_door_800': 800, 'ordinary_door_800': 800}


def validate_operation(values, kind):
    if not isinstance(values, dict) or set(values) - {'type', 'hinge', 'side', 'angle_deg', 'pivot_axis', 'pivot_ratio', 'direction_mode', 'interior_room_id', 'axis_mode'}:
        raise ValueError('门窗开启参数格式不正确。')
    operation = dict(type='hinged', hinge='start', side='negative', angle_deg=0)
    operation.update(values)
    if operation['type'] not in ('fixed', 'hinged') or kind == 'door' and operation['type'] != 'hinged':
        raise ValueError('门支持单扇平开；窗支持固定玻璃或单扇平开。')
    pivot_axis = operation.get('pivot_axis', 'vertical')
    if pivot_axis not in ('vertical', 'horizontal') or kind == 'door' and pivot_axis != 'vertical':
        raise ValueError('门使用左右竖轴；窗支持侧开竖轴或上下横轴。')
    hinges = ('start','end') if pivot_axis == 'vertical' else ('top','bottom')
    if operation['hinge'] not in hinges or operation['side'] not in ('negative', 'positive'):
        raise ValueError('请选择有效的铰链端和开启侧。')
    if 'pivot_ratio' in operation:
        number(operation['pivot_ratio'], 0, 1, '转轴位置比例')
    if 'axis_mode' in operation and (kind != 'window' or operation['axis_mode'] not in ('width', 'manual')):
        raise ValueError('窗转轴预设需选择按宽度或手动。')
    if operation.get('direction_mode', 'manual') not in ('auto', 'manual'):
        raise ValueError('请选择自动内外判断或手动开启侧。')
    if 'interior_room_id' in operation and (not isinstance(operation['interior_room_id'], str) or len(operation['interior_room_id']) > 100):
        raise ValueError('归属房间编号不正确。')
    number(operation['angle_deg'], 0, 90, '开启角度')
    if operation['type'] == 'fixed' and operation['angle_deg'] != 0:
        raise ValueError('固定玻璃的开启角度需为 0。')
    return operation


def open_openings(document, request):
    from opening_direction import direction_rooms, opening_context, resolve_direction
    action = request.get('action', 'open')
    if action not in ('open', 'close'):
        raise ValueError('请选择打开或关闭门窗。')
    closing = action == 'close'
    verb = '关闭' if closing else '打开'
    rooms = None if closing else direction_rooms(document)
    kind = request.get('target_kind')
    if kind not in ('door', 'window', 'all'):
        raise ValueError('请选择门、窗或所有门窗。')
    selected = request.get('opening_id')
    if 'opening_id' in request and (not isinstance(selected, str) or not selected):
        raise ValueError('请先选择一扇门或窗。')
    items = document.get('openings', [])
    if selected is not None:
        items = [o for o in items if o['id'] == selected]
        if not items or items[0]['kind'] not in ('door', 'window') or kind != 'all' and items[0]['kind'] != kind:
            raise ValueError('所选门窗与操作范围不匹配，请重新选择。')
    targets = [o for o in items if o['kind'] in ('door', 'window') and
               (kind == 'all' or o['kind'] == kind) and is_active_opening(o)]
    updates, fixed, unknown = {}, 0, 0
    for opening in targets:
        operation = validate_operation(opening.get('operation', {}), opening['kind'])
        if opening['kind'] == 'window' and opening.get('operation', {}).get('type') == 'fixed':
            fixed += 1
            continue
        if closing:
            if operation['angle_deg'] > 0:
                updates[opening['id']] = {**opening['operation'], 'angle_deg': 0}
            continue
        operation.update(type='hinged', angle_deg=90 if opening['kind']=='door' else 45)
        if opening['kind'] == 'window' and not any(key in operation for key in ('axis_mode', 'pivot_axis', 'pivot_ratio')):
            operation['axis_mode'] = 'width'
        operation = apply_window_preset(document, opening, operation)
        if 'direction_mode' not in operation:
            operation['direction_mode'] = 'auto'
        try:
            operation = resolve_direction(operation, opening_context(document,opening,rooms), opening['kind'])
        except ValueError:
            unknown += 1
            # Uncertain indoor sides must not prevent the leaf from opening.
        if opening.get('operation') != operation:
            updates[opening['id']] = operation
    doors = sum(o['id'] in updates and o['kind'] == 'door' for o in targets)
    windows = len(updates) - doors
    message = f'已{verb} {doors} 扇门、{windows} 扇窗' if updates else f'没有需要{verb}的门窗'
    if fixed:
        message += f'；跳过 {fixed} 扇固定玻璃窗'
    if unknown:
        message += f'；{unknown} 扇沿用当前开启侧'
    report = dict(changed_count=len(updates), opened_door_count=doors, opened_window_count=windows,
                  skipped_fixed_count=fixed, skipped_unknown_count=0, fallback_direction_count=unknown, message=message)
    if closing:
        report.update(opened_door_count=0, opened_window_count=0,
                      closed_door_count=doors, closed_window_count=windows)
    if not updates:
        return document, None, report
    result = deepcopy(document)
    for opening in result['openings']:
        if opening['id'] in updates:
            opening['operation'] = updates[opening['id']]
    record = dict(id=selected or 'OPENINGS', type='opening_batch', opening_ids=list(updates), summary=message)
    if selected is not None:
        record['opening_id'] = selected
    return result, record, report


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
    if 'door_model' in opening and (opening['kind'] != 'door' or opening['door_model'] not in ('standard','entry')):
        raise ValueError('门模型需为普通门或大入户门。')
    if 'operation' in opening:
        validate_operation(opening['operation'], opening['kind'])
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
    if request.get('action') == 'add':
        return add_opening(document, request)
    result = deepcopy(document)
    opening = next((o for o in result.get('openings', []) if o['id'] == request.get('opening_id')), None)
    if not opening or opening['kind'] not in ('door', 'window') or not is_active_opening(opening):
        raise ValueError('请选择有效的门或窗；待定边界需先确认为门窗。')
    if 'door_model' in request:
        opening['door_model'] = request['door_model']
        opening['label'] = '大入户门' if opening['door_model'] == 'entry' else '门'
        validate_opening_settings(opening, {**DEFAULTS, **document.get('model_settings', {})})
    if 'operation' in request:
        if request['operation'] is None:
            opening.pop('operation', None)
        else:
            opening['operation'] = apply_window_preset(result, opening, validate_operation(request['operation'], opening['kind']))
            if opening['operation'].get('direction_mode') == 'auto' and not any(key in request for key in ('dimensions_mm','center_px','preset')):
                from opening_direction import opening_context, resolve_direction
                try:
                    opening['operation'] = resolve_direction(opening['operation'], opening_context(document, opening), opening['kind'])
                except ValueError:
                    if opening['operation'].get('interior_room_id'):
                        raise
        if not any(key in request for key in ('dimensions_mm', 'center_px', 'preset')):
            return result, dict(id=opening['id'], opening_id=opening['id'], type='opening_edit',
                                summary=f"{opening['id']} 已更新开启方式与方向")
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
        if isinstance(request['preset'], str) and request['preset'] in DOOR_WIDTH_PRESETS and opening['kind'] == 'door':
            dimensions['width_mm'] = DOOR_WIDTH_PRESETS[request['preset']]
            opening['door_model'] = 'entry' if request['preset'] == 'entry_door_1200' else 'standard'
            opening['label'] = '大入户门' if opening['door_model'] == 'entry' else '门'
            if opening['door_model'] == 'entry':
                dimensions['height_mm'] = 2100
        elif request['preset'] == 'floor_glass' and opening['kind'] == 'window':
            dimensions.update(height_mm=settings['wall_height_mm'], sill_height_mm=0)
        else:
            raise ValueError('入户/卧室/卫生间门宽预设仅适用于门；落地玻璃预设仅适用于窗。')
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
    updated = next(o for o in result['openings'] if o['id'] == opening['id'])
    if updated.get('operation'):
        updated['operation'] = apply_window_preset(result, updated, updated['operation'])
    if updated.get('operation', {}).get('direction_mode') == 'auto':
        from opening_direction import opening_context, resolve_direction
        try:
            updated['operation'] = resolve_direction(updated['operation'], opening_context(result, updated), updated['kind'])
        except ValueError:
            if updated['operation'].get('interior_room_id'):
                raise
    return result, dict(id=opening['id'], opening_id=opening['id'], type='opening_edit',
                        summary=f"{opening['id']} 已更新尺寸与沿墙位置" + ('及开启设置' if 'operation' in request else ''))


def add_opening(document, request):
    """Create an aperture on an existing structural axis; refinement owns solids."""
    kind = request.get('kind')
    if kind not in ('door', 'window'):
        raise ValueError('请选择新增门或窗。')
    wall = next((w for w in document['walls'] if w['id'] == request.get('wall_id')
                 and w.get('review_status') != 'rejected'), None)
    if wall is None:
        raise ValueError('请选择有效的墙段放置门窗。')
    dimensions = request.get('dimensions_mm')
    if not isinstance(dimensions, dict) or 'width_mm' not in dimensions:
        raise ValueError('请填写新增门窗的实际宽度。')
    seed = deepcopy(document)
    used = {o['id'] for o in seed.get('openings', [])}
    index = 1
    while f'O{index:03d}' in used:
        index += 1
    opening_id = f'O{index:03d}'
    axis = axis_of(wall)
    opening = dict(segment(axis, wall['start_px'][axis], wall['end_px'][axis],
                           wall['start_px'][1-axis], wall['thickness_px']),
                   id=opening_id, kind=kind, label='门' if kind == 'door' else '窗',
                   predicted_kind=kind, source='manual', confidence=1.0,
                   review_status='confirmed', requires_confirmation=False, host_wall_id=wall['id'])
    opening['operation'] = validate_operation(dict(type='hinged', angle_deg=0,
        direction_mode='auto', **({'axis_mode': 'width'} if kind == 'window' else {})), kind)
    if 'door_model' in request:
        opening['door_model'] = request['door_model']
        opening['label'] = '大入户门' if opening['door_model'] == 'entry' else '门'
        validate_opening_settings(opening, {**DEFAULTS, **document.get('model_settings', {})})
    seed.setdefault('openings', []).append(opening)
    result, _ = apply_opening_edit(seed, dict(opening_id=opening_id,
        dimensions_mm=dimensions, center_px=request.get('center_px')))
    if 'room_partition' in result:
        result['room_partition']['opening_geometry_changed'] = True
    return result, dict(id=opening_id, opening_id=opening_id, type='opening_add',
                        summary=f"已新增{opening['label']} {opening_id}，请核对房间边界")
