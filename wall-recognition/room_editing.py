"""Persistent manual room outlines and per-room flooring, independent of walls."""
from copy import deepcopy
import hashlib
import json
import math
import re

from shapely.geometry import Polygon, MultiPolygon, GeometryCollection, LineString, box
from shapely.ops import unary_union, split

FLOOR_DEFAULTS = dict(material='solid', color='#e5d7be', width_mm=600., length_mm=600., angle_deg=0.)


def polygon_parts(geometry):
    if isinstance(geometry, Polygon):
        return [geometry] if geometry.area > .01 else []
    if isinstance(geometry, (MultiPolygon, GeometryCollection)):
        return [p for g in geometry.geoms for p in polygon_parts(g)]
    return []


def geometry_of(region):
    polygons = region.get('polygons_px', [region['rings_px']])
    return unary_union([Polygon(rings[0], rings[1:]) for rings in polygons if rings])


def outline(geometry):
    return [[[list(map(float, p)) for p in poly.exterior.coords[:-1]],
             *[[list(map(float, p)) for p in hole.coords[:-1]] for hole in poly.interiors]]
            for poly in polygon_parts(geometry)]


def floor_settings(value):
    if not isinstance(value, dict) or set(value)-set(FLOOR_DEFAULTS):
        raise ValueError('地面材质设置格式不正确。')
    settings = {**FLOOR_DEFAULTS, **value}
    if settings['material'] not in ('solid', 'tile', 'wood'):
        raise ValueError('请选择纯色、瓷砖或木地板。')
    if not isinstance(settings['color'], str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', settings['color']):
        raise ValueError('地面颜色格式不正确。')
    for key in ('width_mm', 'length_mm', 'angle_deg'):
        v = settings[key]
        lo, hi = (0, 360) if key == 'angle_deg' else (50, 5000)
        if isinstance(v, bool) or not isinstance(v, (float, int)) or not math.isfinite(v) or not lo <= v <= hi:
            raise ValueError('板块尺寸需为 50–5000 mm，方向为 0–360 度。')
    return settings


def name_value(value):
    if not isinstance(value, str) or not 1 <= len(value.strip()) <= 40:
        raise ValueError('区域名称需为 1–40 个字符。')
    return value.strip()


def point_list(value, document, minimum=3):
    if not isinstance(value, list) or not minimum <= len(value) <= 128:
        raise ValueError(f'请指定 {minimum}–128 个轮廓点。')
    w, h = document['image']['width_px'], document['image']['height_px']
    for point in value:
        if not isinstance(point, list) or len(point) != 2 or any(
                isinstance(v, bool) or not isinstance(v, (float, int)) or not math.isfinite(v)
                or not 0 <= v <= maximum for v, maximum in zip(point, (w, h))):
            raise ValueError('轮廓点必须位于图片范围内。')
    return value


def compose_rooms(document, partition):
    """Manual footprints take precedence; always clip floors away from solid walls."""
    edits = document.get('room_edits', {})
    properties = edits.get('properties', {})
    manual = edits.get('manual', [])
    excluded = [geometry_of(r) for r in edits.get('excluded', [])]
    footprints = [geometry_of(r) for r in manual]
    occupied = unary_union(excluded + footprints)
    solid = unary_union([box(*p['bbox_px']) for w in document['walls']
                         if w.get('review_status') != 'rejected'
                         for p in w.get('solid_parts', [w])])
    frame = box(0, 0, document['image']['width_px'], document['image']['height_px'])
    output = []
    def append(region, geo, key, source):
        polygons = outline(geo)
        if not polygons:
            return
        label = geo.representative_point()
        props = properties.get(key, {})
        output.append(dict(id=region['id'], source=source, style_key=key,
                           name=props.get('name', region.get('name', region['id'])),
                           floor=deepcopy(props.get('floor', FLOOR_DEFAULTS)),
                           review_status='edited' if source == 'manual' else 'unreviewed',
                           polygons_px=polygons, rings_px=[r for rings in polygons for r in rings],
                           bbox_px=list(geo.bounds), label_px=[label.x, label.y]))
    for region in partition['regions']:
        key = 'auto:'+hashlib.sha256(json.dumps(region['rings_px'], separators=(',', ':')).encode()).hexdigest()[:20]
        append(region, geometry_of(region).difference(occupied).difference(solid), key, 'automatic')
    covered = GeometryCollection()
    for region, geometry in zip(manual, footprints):
        geo = geometry.intersection(frame).difference(solid).difference(covered)
        append(region, geo, 'manual:'+region['id'], 'manual')
        covered = covered.union(geometry)
    partition['regions'] = output
    partition['region_count'] = len(output)
    if output:
        partition['warnings'] = [w for w in partition['warnings'] if not w.startswith('未找到可用的闭合区域')]
    if manual and not output:
        partition['warnings'].append('手绘区域与实墙重叠或已无可用空间，请检查轮廓。')
    return partition


def apply_room_edit(document, request):
    from partition_rooms import partition_rooms
    result = deepcopy(document)
    if 'room_partition' not in result:
        result['room_partition'] = partition_rooms(result)
    regions = {r['id']: r for r in result['room_partition']['regions']}
    action = request.get('action')
    edits = result.setdefault('room_edits', dict(manual=[], excluded=[], properties={}, next_id=1))
    selected = None if action == 'add' else regions.get(request.get('room_id'))
    if action != 'add' and selected is None:
        raise ValueError('请选择一个当前区域。')
    def remove(region):
        edits['manual'] = [m for m in edits['manual'] if m['id'] != region['id']]
        edits['excluded'].append(dict(rings_px=region['rings_px'], polygons_px=region.get('polygons_px', [region['rings_px']])))
    def add(geo, name, flooring):
        if len(edits['manual']) >= 100:
            raise ValueError('手工区域最多 100 个。')
        identifier = f"U{edits['next_id']:03d}"; edits['next_id'] += 1
        polygons = outline(geo)
        edits['manual'].append(dict(id=identifier, name=name, polygons_px=polygons,
                                    rings_px=[r for rings in polygons for r in rings]))
        edits['properties']['manual:'+identifier] = dict(name=name, floor=flooring)
        return identifier
    identifier = request.get('room_id')
    if action == 'settings':
        key = selected.get('style_key')
        if not key:
            # Upgrade an earlier saved analysis to stable geometry-based keys.
            result['room_partition'] = partition_rooms(result)
            selected = next(r for r in result['room_partition']['regions'] if r['id'] == identifier)
            key = selected['style_key']
        edits['properties'][key] = dict(name=name_value(request.get('name', selected.get('name', identifier))),
                                       floor=floor_settings(request.get('floor', selected.get('floor', {}))))
    elif action in ('add', 'reshape'):
        geo = Polygon(point_list(request.get('points_px'), result))
        if not geo.is_valid or geo.area < 4:
            raise ValueError('轮廓不能交叉、退化或过小，请重新画线。')
        solid = unary_union([box(*p['bbox_px']) for w in result['walls'] for p in w.get('solid_parts', [w])])
        if geo.difference(solid).area < 4:
            raise ValueError('区域完全位于实墙内，请重新画线。')
        for other in edits['manual']:
            if other['id'] != identifier and geo.intersection(geometry_of(other)).area > .01:
                raise ValueError('轮廓与另一手工区域重叠，请先调整或合并。')
        if selected:
            remove(selected)
        identifier = add(geo, selected.get('name', selected['id']) if selected else '手绘区域',
                         selected.get('floor', FLOOR_DEFAULTS) if selected else deepcopy(FLOOR_DEFAULTS))
    elif action == 'delete':
        remove(selected)
    elif action == 'split':
        points = point_list(request.get('points_px'), result, 2)
        if len(points) != 2 or points[0] == points[1]:
            raise ValueError('切分线需要两个不同端点。')
        geo = geometry_of(selected)
        pieces = polygon_parts(split(geo, LineString(points)))
        if len(pieces) <= len(polygon_parts(geo)) or any(p.area < 4 for p in pieces):
            raise ValueError('请将切分线两端画到区域外侧，并穿过整个区域。')
        remove(selected)
        for index, piece in enumerate(pieces, 1):
            identifier = add(piece, f"{selected.get('name', selected['id'])[:34]}-{index}", selected.get('floor', FLOOR_DEFAULTS))
    elif action == 'merge':
        target = regions.get(request.get('target_room_id'))
        if not target or target['id'] == selected['id']:
            raise ValueError('请选择另一个区域合并。')
        geo = geometry_of(selected).union(geometry_of(target))
        remove(selected); remove(target)
        identifier = add(geo, '合并区域', selected.get('floor', FLOOR_DEFAULTS))
    else:
        raise ValueError('区域操作不支持。')
    result['room_partition'] = partition_rooms(result)
    labels = dict(settings='已应用区域名称与地面材质', add='已补入手绘区域', reshape='已更新区域轮廓',
                  delete='已排除区域', split='已切分区域', merge='已合并区域')
    return result, dict(id='REGION', type='room_edit', room_id=identifier, summary=labels[action])
