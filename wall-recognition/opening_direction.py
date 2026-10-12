"""Infer indoor sides from closed structural regions; room ownership stays explicit."""
from partition_rooms import partition_rooms


def ring_contains(ring, x, y):
    inside = False
    for a, b in zip(ring, ring[1:]+ring[:1]):
        if (a[1] > y) != (b[1] > y) and x < (b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]:
            inside = not inside
    return inside


def contains(region, point):
    polygons = region.get('polygons_px') or ([region['rings_px']] if region.get('rings_px') else [])
    return any(rings and ring_contains(rings[0], *point) and
               not any(ring_contains(hole, *point) for hole in rings[1:]) for rings in polygons)


def direction_rooms(document):
    # Floor exclusions and materials do not turn an enclosed room into outdoors.
    source = dict(document, room_edits={})
    try:
        structural = partition_rooms(source)['regions']
    except ValueError:
        structural = []
    return structural, document.get('room_partition', {}).get('regions', [])


def opening_context(document, opening, rooms=None):
    structural, named = rooms if rooms is not None else direction_rooms(document)
    axis = 0 if opening['orientation'] == 'horizontal' else 1
    start, end = opening['start_px'][axis], opening['end_px'][axis]
    cross = opening['start_px'][1-axis]
    distance = opening['thickness_px']/2 + max(.5, min(2, (end-start)/10))
    hits, closed = {}, {}
    for side, sign in (('negative', -1), ('positive', 1)):
        points = []
        for fraction in (.25, .5, .75):
            point = [0,0];point[axis]=start+(end-start)*fraction;point[1-axis]=cross+sign*distance
            points.append(point)
        physical = [r for r in structural if any(contains(r,p) for p in points)]
        names = [r for r in named if any(contains(r,p) for p in points)]
        closed[side] = bool(physical)
        hits[side] = [dict(id=r['id'], name=r.get('name') or r['id']) for r in (names or physical)]
    interior = 'negative' if closed['negative'] and not closed['positive'] else 'positive' if closed['positive'] and not closed['negative'] else None
    reason = '由闭合墙体边界确定室内侧' if interior else '两侧都有房间，请选择归属房间或手动开启侧' if all(closed.values()) else '未找到可靠的闭合室内边界，请手动选择开启侧'
    return dict(**hits, interior_side=interior, reason=reason)


def resolve_direction(operation, context, kind):
    if operation.get('direction_mode', 'manual') == 'manual' or operation['type'] == 'fixed':
        return operation
    interior = context['interior_side']
    owner = operation.get('interior_room_id')
    if owner:
        sides = [s for s in ('negative','positive') if any(r['id']==owner for r in context[s])]
        if len(sides) != 1:
            raise ValueError('归属房间不在门窗的单一邻侧，请重新选择房间或手动开启侧。')
        interior = sides[0]
    if interior is None:
        raise ValueError(context['reason'])
    result = dict(operation)
    result['side'] = interior if kind == 'door' else ('positive' if interior == 'negative' else 'negative')
    return result
