"""Review-only gap proposals. Geometry suggests a location, never proves a wall.

Use actual solid ends and protect all non-rejected opening candidates. A preview
is a disposable copy; only an explicit, revision-checked confirmation edits walls.
"""
from copy import deepcopy
import hashlib
from itertools import combinations
import json

from connect_walls import overlaps, SOURCE
from partition_rooms import partition_rooms
from refine_walls import GENERATED, axis_of, refresh_refinement, segment


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def ignored_ids(document):
    value = document.get('ignored_wall_gaps', [])
    if (not isinstance(value, list) or len(value) > 1000 or
            any(not isinstance(v, str) or len(v) != 64 or
                any(c not in '0123456789abcdef' for c in v) for v in value)):
        raise ValueError('缺口忽略记录无效。')
    return value


def automatic_partition(document):
    # Hand-drawn rooms must not be mistaken for evidence of wall closure.
    raw = {k: v for k, v in document.items() if k not in ('room_edits', 'room_partition')}
    return partition_rooms(raw)


def diagnose_closure(document):
    ignored = set(ignored_ids(document))
    partition = automatic_partition(document)
    walls = [w for w in document['walls'] if w.get('review_status') != 'rejected'
             and w.get('source') != GENERATED]
    parts = [dict(p, host_wall_id=w['id'], id=p.get('id', w['id']))
             for w in walls for p in w.get('solid_parts', [w])]
    protected = [p['bbox_px'] for o in document.get('openings', [])
                 if o.get('review_status') != 'rejected' and o.get('kind') not in ('wall', 'rejected')
                 for p in (o, o.get('connection_span', o))]
    protected += [h['bbox_px'] for w in walls for h in w.get('opening_hints', [])]
    barriers = [b['bbox_px'] for b in partition['virtual_boundaries']]

    def contains(box, point):
        return all(box[k]-.001 <= point[k] <= box[k+2]+.001 for k in (0, 1))

    free = {(i, side) for i, p in enumerate(parts) for side in ('start_px', 'end_px')
            if not any(contains(b, p[side]) for b in protected + barriers)
            and not any(j != i and contains(q['bbox_px'], p[side]) for j, q in enumerate(parts))}
    candidates = {}
    width, height = document['image']['width_px'], document['image']['height_px']
    # Bound combinatorial work on unusually fragmented input; report the limit.
    truncated = len(parts) > 600
    for (i, one), (j, two) in combinations(list(enumerate(parts))[:600], 2):
        if not any((n, side) in free for n in (i, j) for side in ('start_px', 'end_px')):
            continue
        axis = axis_of(one)
        thickness = min(one['thickness_px'], two['thickness_px'])
        if max(one['thickness_px'], two['thickness_px']) > 2.5*thickness:
            continue
        limit = min(12*thickness, .2*min(width, height))
        pieces, ends = [], []
        if axis == axis_of(two):
            if abs(one['start_px'][1-axis]-two['start_px'][1-axis]) > .001:
                continue
            (li, left), (ri, right) = sorted(((i, one), (j, two)), key=lambda v: v[1]['start_px'][axis])
            gap = right['start_px'][axis]-left['end_px'][axis]
            if not .001 < gap <= limit:
                continue
            ends = [(li, 'end_px'), (ri, 'start_px')]
            pieces = [segment(axis, left['end_px'][axis], right['start_px'][axis],
                              left['start_px'][1-axis], thickness)]
            kind = 'collinear'
        else:
            for n, wall, target in ((i, one, two), (j, two, one)):
                a = axis_of(wall)
                coordinate = target['start_px'][a]
                lo, hi = wall['start_px'][a], wall['end_px'][a]
                if coordinate < lo:
                    ends.append((n, 'start_px'))
                    pieces.append(segment(a, coordinate, lo, wall['start_px'][1-a], wall['thickness_px']))
                elif coordinate > hi:
                    ends.append((n, 'end_px'))
                    pieces.append(segment(a, hi, coordinate, wall['start_px'][1-a], wall['thickness_px']))
            kind = 'corner' if len(pieces) == 2 else 'junction'
        if not pieces or any(e not in free for e in ends) or any(p['length_px'] > limit for p in pieces):
            continue
        if any(p['bbox_px'][0] < 0 or p['bbox_px'][1] < 0 or
               p['bbox_px'][2] > width or p['bbox_px'][3] > height for p in pieces):
            continue
        if any(overlaps(p['bbox_px'], b) for p in pieces for b in protected):
            continue
        # Do not jump through a third wall or offer spans already covered by it.
        if any(overlaps(p['bbox_px'], q['bbox_px']) for p in pieces
               for n, q in enumerate(parts) if n not in (i, j)):
            continue
        wall_ids = sorted({one['host_wall_id'], two['host_wall_id']})
        identifier = digest([wall_ids, pieces])
        boxes = [p['bbox_px'] for p in pieces]
        candidates[identifier] = dict(id=identifier, kind=kind, wall_ids=wall_ids, pieces=pieces,
            length_px=sum(p['length_px'] for p in pieces), ignored=identifier in ignored,
            bbox_px=[min(b[0] for b in boxes), min(b[1] for b in boxes),
                     max(b[2] for b in boxes), max(b[3] for b in boxes)])
    ordered = sorted(candidates.values(), key=lambda c: (c['ignored'], c['length_px'], c['id']))
    return dict(revision=digest(document), candidates=ordered[:100], truncated=truncated or len(ordered) > 100,
                automatic_region_count=partition['region_count'],
                free_ends=[dict(wall_id=parts[i]['host_wall_id'], point_px=parts[i][side]) for i, side in sorted(free)],
                skipped_opening_ids=partition['skipped_opening_ids'],
                pending_opening_ids=partition['pending_opening_ids'])


def current_candidate(document, request):
    if request.get('revision') != digest(document):
        raise ValueError('项目已变化，请重新诊断并预览缺口。')
    report = diagnose_closure(document)
    candidate = next((c for c in report['candidates'] if c['id'] == request.get('candidate_id')), None)
    if candidate is None:
        raise ValueError('缺口已变化或不再可补接，请重新诊断。')
    return candidate, report


def repaired_document(document, candidate, next_id):
    result = deepcopy(document)
    identifiers = []
    occupied = {w['id'] for w in result['walls']} | set(result.get('opening_wall_ids', {}).values())
    for piece in candidate['pieces']:
        while f'W{next_id:03d}' in occupied:
            next_id += 1
        identifier = f'W{next_id:03d}'
        next_id += 1
        identifiers.append(identifier)
        result['walls'].append(dict(deepcopy(piece), id=identifier, source=SOURCE, review_status='edited',
                                    connection_kind=candidate['kind'], connection_wall_ids=candidate['wall_ids'],
                                    confirmed_gap_id=candidate['id']))
    result.setdefault('wall_connection', dict(algorithm='reviewed-wall-gap-v1'))
    result['wall_connection']['added_wall_ids'] = identifiers
    result = refresh_refinement(result)
    result['room_partition'] = partition_rooms(result)
    return result, identifiers, next_id


def preview_gap(document, request, next_id):
    candidate, report = current_candidate(document, request)
    result, _, _ = repaired_document(document, candidate, next_id)
    after = automatic_partition(result)
    return dict(candidate=candidate, revision=report['revision'], before_count=report['automatic_region_count'],
                after_count=after['region_count'], regions=after['regions'])


def resolve_gap(document, request, next_id):
    action = request.get('action')
    if action not in ('confirm', 'ignore', 'restore'):
        raise ValueError('请选择确认补墙、忽略或恢复。')
    candidate, _ = current_candidate(document, request)
    if action == 'confirm':
        if candidate['ignored']:
            raise ValueError('请先恢复这处已忽略的缺口，再预览补墙。')
        result, ids, next_id = repaired_document(document, candidate, next_id)
        record = dict(id='GAP', type='wall_connection', wall_ids=ids,
                      summary=f'确认缺口补墙 {len(ids)} 段；已重算房间区域')
    else:
        result = deepcopy(document)
        ignored = set(ignored_ids(document))
        if action == 'ignore':
            if len(ignored) >= 1000:
                raise ValueError('忽略记录已达上限，请先恢复部分记录。')
            ignored.add(candidate['id'])
        else:
            ignored.discard(candidate['id'])
        result['ignored_wall_gaps'] = sorted(ignored)
        record = dict(id='GAP', type='gap_review', summary='已忽略此缺口疑点' if action == 'ignore' else '已恢复此缺口疑点')
    return result, record, next_id
