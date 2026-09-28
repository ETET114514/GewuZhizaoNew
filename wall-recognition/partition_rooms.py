"""Candidate regions bounded by walls and virtual door/window barriers.

Coordinate compression keeps subpixel cracks open. Barriers are analysis-only:
the editable walls, solid export and 3D apertures are never filled or moved.
"""
from collections import defaultdict

import cv2
import numpy as np


def boundary_rings(mask, xs, ys):
    """Trace the exact cell union, including holes, as orthogonal rings."""
    edges = defaultdict(list)
    padded = np.pad(mask, 1)
    neighbors = (padded[:-2, 1:-1], padded[1:-1, 2:],
                 padded[2:, 1:-1], padded[1:-1, :-2])
    for direction, neighbor in enumerate(neighbors):
        for y, x in zip(*np.where(mask & ~neighbor)):
            corners = ((x, y), (x+1, y), (x+1, y+1), (x, y+1))
            edges[corners[direction]].append((corners[(direction+1) % 4], direction))
    rings = []
    while edges:
        start = min(edges)
        point, incoming, ring = start, 0, []
        while True:
            ring.append(point)
            # Prefer a right turn at touching vertices; do not splice hole rings.
            options = edges[point]
            end, direction = min(options, key=lambda e: ({1: 0, 0: 1, 3: 2, 2: 3}[(e[1]-incoming) % 4], e[0]))
            options.remove((end, direction))
            if not options:
                del edges[point]
            point, incoming = end, direction
            if point == start:
                break
        simplified = []
        for i, point in enumerate(ring):
            before, after = ring[i-1], ring[(i+1) % len(ring)]
            if not (before[0] == point[0] == after[0] or before[1] == point[1] == after[1]):
                simplified.append([float(xs[point[0]]), float(ys[point[1]])])
        if len(simplified) >= 4:
            rings.append(simplified)
    return rings


def partition_rooms(document):
    width, height = document['image']['width_px'], document['image']['height_px']
    walls = [w for w in document['walls'] if w.get('review_status') != 'rejected']
    solids = [p for w in walls for p in w.get('solid_parts', [w])]
    openings = [o for o in document.get('openings', []) if o.get('review_status') != 'rejected'
                and o.get('kind') in ('door', 'window')
                and (not o.get('requires_confirmation') or o.get('review_status') == 'confirmed')]
    spans = [(o, o.get('connection_span', o)) for o in openings]
    boundaries, skipped = [], []
    for opening, span in spans:
        axis = 0 if span['orientation'] == 'horizontal' else 1
        cross = 1-axis
        box = span['bbox_px']
        # A frame floating in space must not create an artificial room divider.
        supports = [p['bbox_px'] for p in solids]
        supports += [s['bbox_px'] for o, s in spans if o['id'] != opening['id']]
        attached = [any(b[axis]-.01 <= end <= b[axis+2]+.01 and
                        min(b[cross+2], box[cross+2])-max(b[cross], box[cross]) > .01
                        for b in supports) for end in (box[axis], box[axis+2])]
        if all(attached):
            boundaries.append(dict(id=opening['id'], kind=opening['kind'], bbox_px=list(box),
                                   start_px=list(span['start_px']), end_px=list(span['end_px'])))
        else:
            skipped.append(opening['id'])
    boxes = [p['bbox_px'] for p in solids] + [b['bbox_px'] for b in boundaries]
    boxes = [[max(0., b[0]), max(0., b[1]), min(float(width), b[2]), min(float(height), b[3])]
             for b in boxes if b[2] > 0 and b[3] > 0 and b[0] < width and b[1] < height]
    xs = np.array(sorted({0., float(width), *(x for b in boxes for x in (b[0], b[2]))}))
    ys = np.array(sorted({0., float(height), *(y for b in boxes for y in (b[1], b[3]))}))
    if (len(xs)-1)*(len(ys)-1) > 4_000_000:
        raise ValueError('墙段过多，区域分割网格超出上限，请先整理重复墙段。')
    blocked = np.zeros((len(ys)-1, len(xs)-1), dtype=np.uint8)
    for x0, y0, x1, y1 in boxes:
        a, b = np.searchsorted(xs, [x0, x1])
        c, d = np.searchsorted(ys, [y0, y1])
        blocked[c:d, a:b] = 1
    count, labels = cv2.connectedComponents(1-blocked, connectivity=4)
    exterior = set(np.concatenate((labels[0], labels[-1], labels[:, 0], labels[:, -1])).tolist())
    thickness = float(np.median([w['thickness_px'] for w in walls])) if walls else 1.
    regions, small_count = [], 0
    cell_weights = np.diff(ys)[:, None]*np.diff(xs)[None, :]
    for label in range(1, count):
        if label in exterior:
            continue
        mask = labels == label
        row, col = np.where(mask)
        bbox = [float(xs[col.min()]), float(ys[row.min()]),
                float(xs[col.max()+1]), float(ys[row.max()+1])]
        # Filter wall cavities/slivers, not furniture: furniture is never a barrier.
        if min(bbox[2]-bbox[0], bbox[3]-bbox[1]) < thickness*1.5 or cell_weights[mask].sum() < 6*thickness**2:
            small_count += 1
            continue
        rings = boundary_rings(mask, xs, ys)
        # Choose the widest interior cell as a guaranteed inside label position.
        sizes = np.minimum(np.diff(ys)[row], np.diff(xs)[col])
        i = int(sizes.argmax())
        x, y = int(col[i]), int(row[i])
        regions.append(dict(id=f'R{len(regions)+1:03d}', review_status='unreviewed',
                            bbox_px=bbox, rings_px=rings,
                            label_px=[float((xs[x]+xs[x+1])/2), float((ys[y]+ys[y+1])/2)]))
    pending = [o['id'] for o in document.get('openings', []) if o.get('review_status') != 'rejected'
               and o.get('kind') not in ('wall', 'rejected') and o not in openings]
    warnings = ['未着色部分可能与图外连通；漏墙、漏门会造成区域缺失或合并。区域编号不代表房间用途。']
    if skipped:
        warnings.append(f'{len(skipped)} 处门窗未接上两端边界，未用于封闭分区。')
    if pending:
        warnings.append(f'{len(pending)} 处边界类型待确认，暂不作为分区边界。')
    if not regions:
        warnings.append('未找到可用的闭合区域，请先补墙或校核门窗。')
    from room_editing import compose_rooms
    return compose_rooms(document, dict(algorithm='wall-door-regions-v1', regions=regions, region_count=len(regions),
                virtual_boundaries=boundaries, skipped_opening_ids=skipped,
                pending_opening_ids=pending, ignored_small_region_count=small_count,
                warnings=warnings))
