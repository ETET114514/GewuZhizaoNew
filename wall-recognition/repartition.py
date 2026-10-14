"""Rebuild space partitions while conservatively retaining authored design."""
from copy import deepcopy

from shapely.geometry import Point, Polygon
from partition_rooms import partition_rooms
from room_editing import geometry_of


def refresh_room_partition(document):
    previous = document.get('room_partition', {}).get('regions', [])
    partition = partition_rooms(document)
    document['room_partition'] = partition
    old = {r.get('style_key', 'id:'+r['id']): geometry_of(r) for r in previous
           if r.get('review_status') != 'rejected'}
    new = {r.get('style_key', 'id:'+r['id']): geometry_of(r) for r in partition['regions']}
    matches = {}
    for key, geo in old.items():
        candidates = [k for k, g in new.items() if geo.area and g.area
                      and geo.intersection(g).area >= .95*max(geo.area, g.area)]
        if len(candidates) == 1:
            matches[key] = candidates[0]
    # Many old rooms collapsing into one is ambiguous, even with large overlap.
    matches = {k: v for k, v in matches.items() if list(matches.values()).count(v) == 1}
    properties = document.get('room_edits', {}).get('properties', {})
    for key, target in matches.items():
        if key != target and key in properties:
            properties.setdefault(target, deepcopy(properties[key]))
    # Apply migrated names/materials to this result without another geometry pass.
    for r in partition['regions']:
        props = properties.get(r.get('style_key'), {})
        for field in ('name', 'floor'):
            if field in props:
                r[field] = deepcopy(props[field])
    design = document.get('ceiling_design')
    if design:
        for key, target in matches.items():
            if key != target and key in design['rooms']:
                design['rooms'].setdefault(target, design['rooms'].pop(key))
        components = design['components']
        targets = {}
        for item in components:
            key, value = item['room_key'], item['settings']
            if key in new:
                targets[item['id']] = key
            elif key in matches:
                targets[item['id']] = matches[key]
            elif key in old:
                if value['kind'] == 'light':
                    point = Point(value['center_px'])
                    candidates = [k for k, g in new.items() if g.contains(point)]
                elif value['kind'] == 'slab' and value.get('style') == 'local':
                    geo = Polygon(value['points_px'])
                    candidates = [k for k, g in new.items() if geo.difference(g).area < .01]
                else:
                    candidates = []
                if len(candidates) == 1:
                    targets[item['id']] = candidates[0]
        # A dependent lamp/cove may move only together with its authored host.
        for item in components:
            value = item['settings']
            host = value.get('host_id', '')
            if host and not host.startswith('room:'):
                parent = host.split(':')[0]
                if targets.get(parent) != targets.get(item['id']):
                    targets.pop(item['id'], None)
        migrated, unresolved = [], []
        for item in components:
            original = item['room_key']
            target = targets.get(item['id'])
            if target and target != original:
                item['room_key'] = target
                host = item['settings'].get('host_id', '')
                if host == 'room:'+original:
                    item['settings']['host_id'] = 'room:'+target
                migrated.append(item['id'])
            elif original not in new:
                unresolved.append(item['id'])
        partition['design_migration'] = dict(migrated_ids=migrated, unresolved_ids=unresolved)
        if unresolved:
            partition['warnings'].append('重分区后 '+ '、'.join(unresolved)+' 的归属不明确，设计已保留，请在顶面编辑器重新指定房间。')
        from ceiling_design import refresh_ceiling_layout
        refresh_ceiling_layout(document)
    return document
