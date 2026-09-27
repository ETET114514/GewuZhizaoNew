"""Conservative, user-invoked wall connections in source pixel coordinates.

Add editable wall pieces instead of moving detected walls. Every proposal is
bounded by local thickness and checked against openings before it is committed.
This repairs local connectivity, not room topology or a watertight mesh.
"""
from copy import deepcopy
from itertools import combinations

import numpy as np

from refine_walls import GENERATED, axis_of, refresh_refinement, segment
from recognize_walls import wall_pixel_mask

SOURCE = "assisted_wall_connection"


def overlaps(a, b):
    return all(min(a[k+2], b[k+2])-max(a[k], b[k]) > .01 for k in (0, 1))


def connection_audit(document):
    """Free axis ends are review locations, not proof of a missing wall."""
    walls = [w for w in document['walls'] if w.get('review_status') != 'rejected']
    ends = []
    for wall in walls:
        for side in ('start_px', 'end_px'):
            point = wall[side]
            if not any(other['id'] != wall['id'] and all(
                    other['bbox_px'][k]-.1 <= point[k] <= other['bbox_px'][k+2]+.1
                    for k in (0, 1)) for other in walls):
                ends.append(dict(wall_id=wall['id'], point_px=list(point), side=side))
    return dict(free_end_count=len(ends), free_ends=ends)


def connect_walls(document, image, next_id):
    result = deepcopy(document)
    # Generated door/window host spans must never serve as solid-wall evidence.
    anchors = [w for w in result['walls'] if w.get('source') not in (GENERATED, SOURCE)
               and w.get('review_status') != 'rejected']
    scale = max(.5, min(image.size)/745)
    settings = result.get('parameters', {})
    rgb = np.asarray(image.convert('RGB'), dtype=np.int16)
    filled = wall_pixel_mask(rgb, settings.get('threshold', 180),
                            settings.get('max_color_spread', 10),
                            settings.get('wall_colors', ()), settings.get('color_tolerance', 8))
    # Dual edges also support outlined/pale walls; a single furniture stroke does not.
    ink = rgb.mean(axis=2) < 245
    protected = [o['bbox_px'] for o in result.get('openings', [])
                 if o.get('review_status') != 'rejected' and o.get('kind') not in ('wall', 'rejected')]
    protected += [h['bbox_px'] for w in result['walls'] for h in w.get('opening_hints', [])]

    def evidence(piece):
        axis = axis_of(piece)
        a, b = piece['start_px'][axis], piece['end_px'][axis]
        c, t = piece['start_px'][1-axis], piece['thickness_px']
        src = filled if axis == 0 else filled.T
        lines = ink if axis == 0 else ink.T
        left, right = int(np.ceil(a)), int(np.floor(b))
        lo, hi = max(0, int(np.floor(c-t/2))), min(src.shape[0], int(np.ceil(c+t/2)))
        if right <= left or hi <= lo:
            return 0.
        fill = float((src[lo:hi, left:right].mean(axis=0) >= .6).mean())
        band = max(1, int(round(t*.2)))
        low = lines[max(0, lo-band):min(lines.shape[0], lo+band+1), left:right].any(axis=0)
        high = lines[max(0, hi-band-1):min(lines.shape[0], hi+band), left:right].any(axis=0)
        return max(fill, float((low & high).mean()))

    def extension(wall, coordinate):
        axis = axis_of(wall)
        a, b = wall['start_px'][axis], wall['end_px'][axis]
        if a <= coordinate <= b:
            return None
        return segment(axis, min(coordinate, a) if coordinate < a else b,
                       a if coordinate < a else coordinate,
                       wall['start_px'][1-axis], wall['thickness_px'])

    proposals = []
    for one, two in combinations(anchors, 2):
        axis = axis_of(one)
        thickness = min(one['thickness_px'], two['thickness_px'])
        if max(one['thickness_px'], two['thickness_px']) > 2.5*thickness:
            continue
        limit = min(3*thickness, 40*scale)
        pieces = []
        if axis == axis_of(two):
            if abs(one['start_px'][1-axis]-two['start_px'][1-axis]) > min(thickness*.25, 3*scale):
                continue
            left, right = sorted((one, two), key=lambda w: w['start_px'][axis])
            gap = right['start_px'][axis]-left['end_px'][axis]
            if not .01 < gap <= limit:
                continue
            pieces = [segment(axis, left['end_px'][axis], right['start_px'][axis],
                              left['start_px'][1-axis], thickness)]
            kind = 'collinear'
        else:
            # L corners extend both arms to their common intersection; T joins one.
            for wall, target in ((one, two), (two, one)):
                piece = extension(wall, target['start_px'][axis_of(wall)])
                if piece:
                    pieces.append(piece)
            if not pieces or any(p['length_px'] > limit for p in pieces):
                continue
            kind = 'corner' if len(pieces) == 2 else 'junction'
        if any(any(overlaps(p['bbox_px'], box) for box in protected) for p in pieces):
            continue
        scores = [evidence(p) for p in pieces]
        # Only sub-thickness cracks can be inferred from geometry alone.
        if any(p['length_px'] > min(.6*thickness, 8*scale) and score < .75
               for p, score in zip(pieces, scores)):
            continue
        proposals.append((sum(p['length_px'] for p in pieces), one['id'], two['id'], kind, pieces, scores))

    added = []
    used_ends = set()
    for _, first, second, kind, pieces, scores in sorted(proposals, key=lambda p: p[:3]):
        pair = [next(w for w in anchors if w['id'] == identifier) for identifier in (first, second)]
        ends = {(w['id'], side) for w in pair for side in ('start_px', 'end_px')
                if any(all(p['bbox_px'][k]-.01 <= w[side][k] <= p['bbox_px'][k+2]+.01
                           for k in (0, 1)) for p in pieces)}
        if ends & used_ends:
            continue
        fresh = []
        for piece, score in zip(pieces, scores):
            # A previous repair or manual edit may already cover this exact span.
            if any(axis_of(w) == axis_of(piece) and all(
                    w['bbox_px'][k] <= piece['bbox_px'][k]+.01 and
                    w['bbox_px'][k+2] >= piece['bbox_px'][k+2]-.01 for k in (0, 1))
                   for w in result['walls'] if w.get('source') != GENERATED):
                continue
            box = piece['bbox_px']
            if box[0] < 0 or box[1] < 0 or box[2] > image.width or box[3] > image.height:
                fresh = []
                break
            fresh.append((piece, score))
        for piece, score in fresh:
            identifier = f'W{next_id:03d}'
            next_id += 1
            wall = dict(**piece, id=identifier, source=SOURCE, review_status='unreviewed',
                        connection_kind=kind, connection_wall_ids=[first, second],
                        pixel_support=round(score, 3))
            result['walls'].append(wall)
            added.append(identifier)
        used_ends.update(ends)
    result['wall_connection'] = dict(algorithm='local-wall-connection-v1', added_wall_ids=added)
    result = refresh_refinement(result)
    result['wall_connection'].update(connection_audit(result))
    record = dict(id='CONNECT', type='wall_connection', wall_ids=added,
                  summary=f'连接修复新增 {len(added)} 段墙；剩余 {result["wall_connection"]["free_end_count"]} 个自由端点待校核（可能为正常墙端）')
    return result, record, next_id
