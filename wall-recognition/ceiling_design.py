"""P35 authored ceilings and attached fixtures; derived outlines use scene mm."""
from copy import deepcopy
import math
import re

from shapely.geometry import Polygon, Point
from room_editing import geometry_of, outline, point_list
from model_settings import number

ROOM_DEFAULTS = dict(height_mm=2800., thickness_mm=100., color='#f5f2ec', visible=True)
COMPONENT_DEFAULTS = dict(kind='slab', style='flat', drop_mm=200., thickness_mm=80.,
    inset_mm=0., width_mm=400., levels=2, step_mm=100., color='#f5f2ec',
    light_type='flush', size_mm=300., depth_mm=80., hanging_mm=0., rotation_deg=0.,
    tilt_deg=0., intensity=1., temperature_k=3000., on=True, host_id='',
    channel_width_mm=120., channel_height_mm=60., light_group='')
LABELS = dict(slab='吊顶', cove='灯槽', light='灯具')


def room_key(room):
    return room.get('style_key', 'id:'+room['id'])


def settings(value, defaults):
    extra = {'points_px', 'center_px'} if defaults is COMPONENT_DEFAULTS else set()
    if not isinstance(value, dict) or set(value)-set(defaults)-extra:
        raise ValueError('顶面组件设置格式不正确。')
    result = {**defaults, **value}
    for key, val in result.items():
        if key.endswith('_mm'):
            lo = 0 if key in ('drop_mm', 'inset_mm', 'hanging_mm') else 10
            result[key] = number(val, lo, 20000, key)
        elif key.endswith('_deg'):
            result[key] = number(val, 0, 85 if key == 'tilt_deg' else 360, key)
        elif key == 'intensity':
            result[key] = number(val, 0, 20, '亮度')
        elif key == 'temperature_k':
            result[key] = number(val, 2000, 10000, '色温')
        elif key in ('visible', 'on') and type(val) is not bool:
            raise ValueError('显示与开关需为布尔值。')
        elif key == 'color' and (not isinstance(val, str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', val)):
            raise ValueError('颜色格式不正确。')
    if 'levels' in result and (type(result['levels']) is not int or not 1 <= result['levels'] <= 5):
        raise ValueError('跌级数需为 1–5 的整数。')
    if 'height_mm' in result and result['height_mm'] < 300:
        raise ValueError('顶面底标高至少 30 cm。')
    if 'channel_height_mm' in result and result['channel_height_mm'] < 30:
        raise ValueError('灯槽高度至少 3 cm。')
    if 'kind' in result:
        if (not isinstance(result['kind'], str) or result['kind'] not in LABELS
            or not isinstance(result['style'], str) or result['style'] not in ('flat', 'local', 'border', 'stepped')):
            raise ValueError('请选择有效的组件与吊顶样式。')
        if not isinstance(result['light_type'], str) or result['light_type'] not in ('flush', 'downlight', 'pendant', 'spot', 'track', 'linear'):
            raise ValueError('灯具类型不支持。')
        if not isinstance(result['host_id'], str) or len(result['host_id']) > 32:
            raise ValueError('灯具安装面不正确。')
        group = result['light_group']
        if not isinstance(group, str) or len(group) > 40 or any(ord(c) < 32 for c in group):
            raise ValueError('灯组名称需为不超过 40 字的单行文字。')
        result['light_group'] = group.strip()
        if result['kind'] == 'slab' and result['light_group']:
            raise ValueError('只有灯具与灯槽可以加入灯组。')
    return result


def validate_design(document):
    design = document.get('ceiling_design')
    if design is None:
        return
    if (not isinstance(design, dict) or set(design)-{'rooms', 'components', 'next_id'}
        or not isinstance(design.get('rooms'), dict) or len(design['rooms']) > 200
        or not isinstance(design.get('components'), list) or len(design['components']) > 300
        or type(design.get('next_id')) is not int or design['next_id'] < 1):
        raise ValueError('顶面设计数据不正确。')
    for key, value in design['rooms'].items():
        if not isinstance(key, str) or len(key) > 100:
            raise ValueError('顶面房间编号不正确。')
        settings(value, ROOM_DEFAULTS)
    ids = set()
    for item in design['components']:
        if not isinstance(item, dict) or set(item)-{'id', 'room_key', 'settings'}:
            raise ValueError('顶面组件格式不正确。')
        ident = item.get('id')
        if not isinstance(ident, str) or not re.fullmatch(r'C\d{3,9}', ident) or ident in ids:
            raise ValueError('顶面组件编号重复或无效。')
        ids.add(ident)
        if not isinstance(item.get('room_key'), str) or len(item['room_key']) > 100:
            raise ValueError('组件房间编号不正确。')
        value = settings(item.get('settings'), COMPONENT_DEFAULTS)
        item['settings'] = value
        if 'points_px' in value:
            poly = Polygon(point_list(value['points_px'], document))
            if not poly.is_valid or poly.area < 4:
                raise ValueError('局部吊顶轮廓不能交叉、退化或过小。')
        if 'center_px' in value:
            point_list([value['center_px']], document, 1)
        if value['kind'] == 'light' and 'center_px' not in value:
            raise ValueError('请指定灯具位置。')
        if value['kind'] == 'slab' and value['style'] == 'local' and 'points_px' not in value:
            raise ValueError('请先手绘局部吊顶轮廓。')
    design['next_id'] = max(design['next_id'], max((int(i[1:])+1 for i in ids), default=1))


def refresh_ceiling_layout(document, strict_id=None):
    """Rebuild on geometry/scale edits; orphaned authorship stays for recovery."""
    if 'ceiling_design' not in document:
        return document
    from shapely.affinity import scale as scale_geometry
    design = document['ceiling_design']
    scale = document.get('scale_mm_per_px')
    layout = dict(surfaces=[], lights=[], warnings=[])
    document['ceiling_layout'] = layout
    if not scale:
        layout['warnings'].append('顶面需要实际比例；重新标定后恢复。')
        return document
    rooms = {room_key(r): r for r in document.get('room_partition', {}).get('regions', [])
             if r.get('review_status') != 'rejected'}
    # Unconfigured rooms have a structural ceiling too. Keep defaults derived,
    # so creating/editing one room never overwrites the authorship of another.
    room_settings = {key:{**ROOM_DEFAULTS, 'height_mm':document.get('model_settings', {}).get('wall_height_mm', 2800.)}
                     for key in rooms}
    room_settings.update(design['rooms'])
    hosts = {}
    def warning(item, message):
        if item == strict_id:
            raise ValueError(message)
        layout['warnings'].append(f'{item}：{message}')
    def surface(ident, key, geo, bottom, thickness, color, role='ceiling', emissive=False):
        polygons = outline(geo)
        if not polygons:
            return
        layout['surfaces'].append(dict(id=ident, room_key=key, polygons_mm=polygons,
            bottom_mm=bottom, thickness_mm=thickness, color=color, role=role, emissive=emissive,
            visible=room_settings[key].get('visible', True)))
    for key, raw in room_settings.items():
        room = rooms.get(key)
        if not room:
            warning(key, '原房间轮廓已变更或移除，请重新指定房间；暂不生成顶面。')
            continue
        opts = settings(raw, ROOM_DEFAULTS)
        geo = scale_geometry(geometry_of(room), xfact=scale, yfact=scale, origin=(0, 0))
        hosts['room:'+key] = (geo, opts['height_mm'], key)
        surface('room:'+key, key, geo, opts['height_mm'], opts['thickness_mm'], opts['color'])
    # Slabs come first regardless of list order, so lights bind to a stable face.
    for item in design['components']:
        v = item['settings']; ident = item['id']; key = item['room_key']
        root = hosts.get('room:'+key)
        if not root:
            warning(ident, '所属房间不可用，组件保留，暂不显示。'); continue
        if v['kind'] != 'slab':
            continue
        geo, height, _ = root
        if v['style'] == 'local':
            local = scale_geometry(Polygon(v['points_px']), xfact=scale, yfact=scale, origin=(0, 0))
            if strict_id == ident and local.difference(geo).area > 1:
                raise ValueError('局部吊顶轮廓需位于房间内，不能穿过孔洞或墙体。')
            geo = geo.intersection(local)
        geo = geo.buffer(-v['inset_mm'], join_style=2)
        levels = v['levels'] if v['style'] == 'stepped' else 1
        faces = []
        for level in range(levels):
            outer = geo.buffer(-level*v['width_mm'], join_style=2)
            inner = geo.buffer(-(level+1)*v['width_mm'], join_style=2)
            part = outer.difference(inner) if v['style'] in ('border', 'stepped') else outer
            bottom = height-v['drop_mm']-level*v['step_mm']
            if bottom < 300 or bottom+v['thickness_mm'] > height:
                warning(ident, '下吊/跌级高度无效：净高至少 30 cm，吊顶上表面不能超过房间顶面。'); break
            if part.is_empty or part.area < 100:
                warning(ident, '边距或跌级宽度超出可用轮廓，请缩小参数。'); break
            face_id = ident if level == 0 else f'{ident}:{level+1}'
            hosts[face_id] = (part, bottom, key); faces.append(face_id)
            surface(face_id, key, part, bottom, v['thickness_mm'], v['color'])
            if level and v['style'] == 'stepped':
                # Close the vertical step so adjacent tiers do not float apart.
                riser = outer.difference(outer.buffer(-10, join_style=2))
                surface(face_id, key, riser, bottom+v['thickness_mm'], v['step_mm'], v['color'], 'riser')
    for item in design['components']:
        v = item['settings']; ident = item['id']; key = item['room_key']
        if v['kind'] == 'slab' or 'room:'+key not in hosts:
            continue
        host_id = v['host_id'] or 'room:'+key
        host = hosts.get(host_id)
        if not host or host[2] != key:
            warning(ident, '安装面不可用，灯具/灯槽暂不显示；请重新指定安装面。'); continue
        geo, height, _ = host
        if v['kind'] == 'cove':
            start_index = len(layout['surfaces'])
            outer = geo.buffer(-v['inset_mm'], join_style=2)
            inner = outer.buffer(-v['channel_width_mm'], join_style=2)
            band = outer.difference(inner)
            if inner.is_empty or band.area < 100:
                warning(ident, '灯槽宽度/边距过大，需保留内部净空。'); continue
            bottom = height-v['channel_height_mm']
            if bottom < 300:
                warning(ident, '灯槽剩余净高不足 30 cm。'); continue
            # U channel: bottom, outer retaining lip, and a raised inner LED strip.
            surface(ident, key, band, bottom, 10, v['color'], 'cove')
            lip = outer.difference(outer.buffer(-10, join_style=2))
            surface(ident, key, lip, bottom+10, max(10, v['channel_height_mm']-25), v['color'], 'cove')
            inner_lip = inner.buffer(10, join_style=2).difference(inner).intersection(band)
            surface(ident, key, inner_lip, bottom+10, 10, v['color'], 'cove')
            led = inner.buffer(12, join_style=2).difference(inner).intersection(band)
            surface(ident, key, led, bottom+22, 4, '#ffe6bc', 'strip', v['on'])
            if layout['surfaces'][-1]['role'] == 'strip':
                layout['surfaces'][-1].update(intensity=v['intensity'], temperature_k=v['temperature_k'])
            for part in layout['surfaces'][start_index:]:
                part['host_id'] = host_id
            continue
        center = [n*scale for n in v['center_px']]
        # Rotated square envelope prevents bodies crossing walls and room holes.
        from shapely.affinity import rotate
        radius = v['size_mm']/2
        half_depth = min(radius, 40) if v['light_type'] in ('track', 'linear') else radius
        footprint = Polygon([(center[0]-radius, center[1]-half_depth), (center[0]+radius, center[1]-half_depth),
            (center[0]+radius, center[1]+half_depth), (center[0]-radius, center[1]+half_depth)])
        footprint = rotate(footprint, v['rotation_deg'], origin=center)
        if not geo.buffer(.1).covers(footprint):
            warning(ident, '灯具占地不在所选安装面内，请移动、缩小或更换安装面。'); continue
        bottom = height-v['hanging_mm']-v['depth_mm']
        if bottom-(70 if v['light_type'] == 'track' else 0) < 300:
            warning(ident, '灯具最低点不足 30 cm。'); continue
        layout['lights'].append(dict(id=ident, room_key=key, host_id=host_id, center_mm=center,
            mount_mm=height, bottom_mm=bottom, settings=deepcopy(v)))
    return document


def apply_lighting_edit(document, request):
    """Apply a lighting patch atomically; retain invalid/orphaned authorship."""
    scope = request.get('scope')
    group = request.get('group_name')  # None: all; empty string: ungrouped.
    patch = request.get('settings')
    if scope not in ('room', 'project'):
        raise ValueError('请选择当前房间或整个项目的灯组范围。')
    if group is not None and (not isinstance(group, str) or len(group) > 40
                              or any(ord(c) < 32 for c in group)):
        raise ValueError('灯组名称不正确。')
    if group is not None:
        group = group.strip()
    if not isinstance(patch, dict) or not patch or set(patch)-{'on', 'intensity', 'temperature_k'}:
        raise ValueError('灯组仅支持开关、亮度和色温；请至少选择一项。')
    settings(patch, COMPONENT_DEFAULTS)
    result = deepcopy(document)
    validate_design(result)
    refresh_ceiling_layout(result)
    room = next((r for r in result.get('room_partition', {}).get('regions', [])
                 if r['id'] == request.get('room_id') and r.get('review_status') != 'rejected'), None)
    if scope == 'room' and room is None:
        raise ValueError('请先选择有效房间。')
    candidates = [c for c in result.get('ceiling_design', {}).get('components', [])
                  if c['settings']['kind'] in ('light', 'cove')
                  and (scope == 'project' or c['room_key'] == room_key(room))
                  and (group is None or c['settings']['light_group'] == group)]
    layout = result.get('ceiling_layout', {})
    active = {l['id'] for l in layout.get('lights', [])}
    active.update(s['id'] for s in layout.get('surfaces', []) if s['role'] == 'strip')
    targets = [c for c in candidates if c['id'] in active]
    if not targets:
        raise ValueError('所选范围没有可控制的灯具或灯槽；失效组件需先恢复安装面。')
    changed = 0
    for component in targets:
        before = component['settings']
        after = settings({**before, **patch}, COMPONENT_DEFAULTS)
        changed += after != before
        component['settings'] = after
    if changed:
        refresh_ceiling_layout(result)
    else:
        result = deepcopy(document)
    skipped = len(candidates)-len(targets)
    summary = f'已统一调整 {changed} 个灯具/灯槽' if changed else '灯组已是目标状态，无需修改'
    if skipped:
        summary += f'；跳过 {skipped} 个失效组件'
    return result, dict(id='lighting', type='ceiling_edit', summary=summary,
                        changed_count=changed, target_count=len(targets), skipped_count=skipped)


def apply_ceiling_edit(document, request):
    if not document.get('scale_mm_per_px'):
        raise ValueError('请先标定实际比例再设计顶面。')
    if request.get('action') == 'lighting':
        return apply_lighting_edit(document, request)
    result = deepcopy(document)
    design = result.setdefault('ceiling_design', dict(rooms={}, components=[], next_id=1))
    action = request.get('action'); ident = request.get('component_id')
    room = next((r for r in result.get('room_partition', {}).get('regions', [])
                 if r['id'] == request.get('room_id') and r.get('review_status') != 'rejected'), None)
    selected = next((c for c in design['components'] if c['id'] == ident), None)
    if action in ('room', 'add') and room is None:
        raise ValueError('请先分区并选择有效房间。')
    if action == 'room':
        key = room_key(room)
        design['rooms'][key] = settings(request.get('settings', {}), ROOM_DEFAULTS)
        ident = 'room:'+key
    elif action == 'add':
        if len(design['components']) >= 300:
            raise ValueError('顶面组件最多 300 个。')
        key = room_key(room)
        design['rooms'].setdefault(key, {**ROOM_DEFAULTS, 'height_mm':result.get('model_settings', {}).get('wall_height_mm', 2800.)})
        opts = settings(request.get('settings', {}), COMPONENT_DEFAULTS)
        ident = f"C{design['next_id']:03d}"; design['next_id'] += 1
        design['components'].append(dict(id=ident, room_key=key, settings=opts))
    elif action == 'rebind':
        if selected is None or room is None:
            raise ValueError('请选择失效组件与新的房间。')
        old_key = selected['room_key']; new_key = room_key(room)
        active_keys = {room_key(r) for r in result.get('room_partition', {}).get('regions', [])}
        if old_key in active_keys:
            raise ValueError('原房间仍存在，不能自动迁移整组顶面。')
        config = design['rooms'].pop(old_key, dict(ROOM_DEFAULTS))
        design['rooms'].setdefault(new_key, config)
        for component in design['components']:
            if component['room_key'] == old_key:
                component['room_key'] = new_key
                if component['settings']['host_id'] == 'room:'+old_key:
                    component['settings']['host_id'] = 'room:'+new_key
    elif action in ('update', 'delete', 'copy'):
        if selected is None:
            raise ValueError('请选择一个顶面组件。')
        if action == 'delete':
            dependents = [c['id'] for c in design['components'] if c['settings']['host_id'].split(':')[0] == ident]
            if dependents:
                raise ValueError('先移除或更换依附组件的安装面：'+', '.join(dependents))
            design['components'].remove(selected)
        else:
            opts = settings({**selected['settings'], **request.get('settings', {})}, COMPONENT_DEFAULTS)
            if action == 'copy':
                if len(design['components']) >= 300:
                    raise ValueError('顶面组件最多 300 个。')
                ident = f"C{design['next_id']:03d}"; design['next_id'] += 1
                design['components'].append(dict(id=ident, room_key=selected['room_key'], settings=opts))
            else:
                if opts['kind'] != selected['settings']['kind']:
                    raise ValueError('不能更改组件类别，请新增组件。')
                selected['settings'] = opts
    else:
        raise ValueError('顶面操作不支持。')
    validate_design(result)
    refresh_ceiling_layout(result, strict_id=ident if action not in ('delete', 'rebind') else None)
    # Parent edits must not silently invalidate attached children.
    if action in ('room', 'update'):
        old = {w.split('：')[0] for w in document.get('ceiling_layout', {}).get('warnings', [])}
        newly = [w for w in result['ceiling_layout']['warnings'] if w.split('：')[0] not in old]
        if newly:
            raise ValueError('修改使依附组件失效，请先调整：'+newly[0])
    return result, dict(id=ident, type='ceiling_edit', summary={'room':'已设置房间顶面', 'add':'已新增顶面组件',
        'update':'已修改顶面组件', 'delete':'已删除顶面组件', 'copy':'已复制顶面组件', 'rebind':'已将失效顶面及依附组件重新归属到所选房间'}[action])
