"""Analysis-only structural closure. Never move editable walls or fill real gaps."""
from copy import deepcopy


def structural_additions(document, boundaries):
    """Complete touching corners and supported exterior window returns.

    Use the same window-return evidence as the model. Keep original solids:
    display trimming must not erase an established room boundary. Unknown
    openings remain protected, and there is no distance-based gap closing.
    """
    if not document.get('model_settings', {}).get('flush_wall_joints', True):
        return []
    walls = [w for w in document['walls'] if w.get('review_status') != 'rejected']
    effective = deepcopy(walls)
    additions = []
    used = {b['id'] for b in boundaries}
    openings = [o for o in document.get('openings', []) if o['id'] in used]
    for opening in openings:
        if opening['kind'] != 'window' or not opening.get('evidence', {}).get('exterior_frame'):
            continue
        span = opening.get('connection_span', opening)
        axis = 0 if span['orientation'] == 'horizontal' else 1
        cross = 1-axis
        center, thickness = span['start_px'][cross], span['thickness_px']
        for start, sign in ((True, -1), (False, 1)):
            tip = span['start_px' if start else 'end_px'][axis]
            for arm in walls:
                if (arm['id'] not in opening.get('jamb_support_ids', [])
                    or arm['orientation'] == span['orientation'] or arm.get('source') != 'automatic'
                    or arm.get('review_status') == 'confirmed' or arm.get('opening_hints')):
                    continue
                arm_center, arm_half = arm['start_px'][axis], arm['thickness_px']/2
                length = arm['end_px'][cross]-arm['start_px'][cross]
                if abs(arm_center-sign*arm_half-tip) > 1 or sign*(arm_center-tip) <= 0:
                    continue
                candidates = [main for main in walls if main['id'] != arm['id']
                    and main['orientation'] == arm['orientation']
                    and main['thickness_px'] >= arm['thickness_px']*1.5
                    and main['end_px'][cross]-main['start_px'][cross] >= length*3
                    and length <= main['thickness_px']*6
                    and min(abs(main['start_px'][cross]-center), abs(main['end_px'][cross]-center)) <= thickness/2+1
                    and main['start_px'][cross] <= center+thickness/2+1
                    and main['end_px'][cross] >= center-thickness/2-1
                    and sign*(main['start_px'][axis]-arm_center) > 0
                    and sign*(main['start_px'][axis]-sign*main['thickness_px']/2-tip) > 0
                    and abs(main['start_px'][axis]-sign*main['thickness_px']/2-tip) <= main['thickness_px']*2]
                if not candidates:
                    continue
                main = min(candidates, key=lambda w: abs(w['start_px'][axis]-tip))
                boundary = main['start_px'][axis]-sign*main['thickness_px']/2
                lo, hi = sorted((tip, boundary))
                protected = [o for o in document.get('openings', []) if o['id'] != opening['id']
                    and o.get('review_status') != 'rejected' and o.get('kind') not in ('wall', 'rejected')]
                protected += [hint for w in walls for hint in w.get('opening_hints', [])
                    if opening['id'] not in hint.get('opening_ids', [])]
                if any(o['orientation'] == span['orientation']
                    and abs(o['start_px'][cross]-center) <= max(o['thickness_px'], thickness)/2
                    and o['start_px'][axis] < hi and o['end_px'][axis] > lo for o in protected):
                    continue
                host = next((w for w in effective if w.get('source') == 'automatic_opening_connection'
                    and w['orientation'] == span['orientation']
                    and abs(w['start_px'][cross]-center) < 1e-6
                    and abs(w['start_px' if start else 'end_px'][axis]-tip) < 1e-6), None)
                if host is None:
                    continue
                half = host['thickness_px']/2
                rect = [lo, center-half, hi, center+half] if axis == 0 else [center-half, lo, center+half, hi]
                additions.append(rect)
                host['start_px' if start else 'end_px'][axis] = boundary
                host['bbox_px'][axis if start else axis+2] = boundary
    # A thickness-band intersection may complete a butt-ended L corner only
    # when its existing wall rectangles already touch. Never bridge a crack.
    protected = [o.get('connection_span', o)['bbox_px'] for o in document.get('openings', [])
        if o.get('review_status') != 'rejected' and o['id'] not in used
        and o.get('kind') not in ('wall', 'rejected')]
    protected += [h['bbox_px'] for w in walls for h in w.get('opening_hints', [])
        if not any(i in used for i in h.get('opening_ids', []))]
    from shapely.geometry import box
    from shapely.ops import unary_union
    void = unary_union([box(*r) for r in protected])
    for h in (w for w in effective if w['orientation'] == 'horizontal'):
        for v in (w for w in effective if w['orientation'] == 'vertical'):
            hb, vb = h['bbox_px'], v['bbox_px']
            if hb[2] < vb[0] or hb[0] > vb[2] or vb[3] < hb[1] or vb[1] > hb[3]:
                continue
            patch = box(vb[0], hb[1], vb[2], hb[3]).difference(void)
            # All cutters are rectangles, so decompose along their exact faces.
            if patch.is_empty:
                continue
            xs = sorted({vb[0], vb[2], *(p[i] for p in protected for i in (0, 2) if vb[0] < p[i] < vb[2])})
            ys = sorted({hb[1], hb[3], *(p[i] for p in protected for i in (1, 3) if hb[1] < p[i] < hb[3])})
            for x0, x1 in zip(xs, xs[1:]):
                for y0, y1 in zip(ys, ys[1:]):
                    cell = box(x0, y0, x1, y1)
                    if cell.difference(patch).area < 1e-9:
                        additions.append([x0, y0, x1, y1])
    return sorted(set(tuple(r) for r in additions))
