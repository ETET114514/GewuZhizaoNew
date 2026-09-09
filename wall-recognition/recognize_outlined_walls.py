"""Recover white wall bands from paired strokes and observed end connections.

Work on local cross sections so a frame or railing cannot absorb an adjacent
wall of a different width. No room closure or arbitrary gap filling is used.
"""
import numpy as np

from recognize_walls import runs


def detect_outlined_walls(image, filled):
    rgb = np.asarray(image.convert("RGB"), dtype=np.int16)
    gray = rgb @ np.array([.299, .587, .114])
    ink = (gray < 220) & (rgb.max(axis=2) - rgb.min(axis=2) <= 20)
    # Dense furnished/dimensioned drawings contain many accidental line pairs.
    # Use conservative evidence there instead of treating every pair as a wall.
    ys, xs = np.nonzero(ink)
    density = float(ink[ys.min():ys.max()+1,xs.min():xs.max()+1].mean()) if len(xs) else 0.
    dense = (density > .10 and len(xs) > 0
             and min(xs.max()-xs.min(),ys.max()-ys.min()) > .3*min(image.size))
    frame_ink = ink
    if dense:
        ink = ink & (gray < 130)
    scale = max(.5, min(image.size) / 745,
                float(np.median([w["thickness_px"] for w in filled])) / 12 if filled else .5)
    stroke_limit = max(2, round(3 * scale))
    minimum_width = max(5, 5 * scale)
    maximum_width = max(24, 26 * scale)
    minimum_length = max(8, round(8 * scale))
    tolerance = max(1, round(scale))
    proposals = []
    for axis in (0, 1):
        source = ink if axis == 0 else ink.T
        frame_source = frame_ink if axis == 0 else frame_ink.T
        active, tracks = [], []
        for x, column in enumerate(source.T):
            strokes = runs(column)
            frame_strokes = runs(frame_source[:,x]) if dense else strokes
            pairs = []
            for i, ((lo, first_end), (second_start, hi)) in enumerate(zip(strokes, strokes[1:])):
                thickness = hi - lo
                if (first_end-lo > stroke_limit or hi-second_start > stroke_limit
                        or not minimum_width <= thickness <= maximum_width
                        or second_start-first_end < max(2, 2*scale)):
                    continue
                # Three or more nearby strokes are frame/railing evidence.
                extra = ((i > 0 and lo-strokes[i-1][1] < thickness*.8
                          and strokes[i-1][1]-strokes[i-1][0] <= stroke_limit)
                         or (i+2 < len(strokes) and strokes[i+2][0]-hi < thickness*.8
                             and strokes[i+2][1]-strokes[i+2][0] <= stroke_limit))
                if dense:
                    extra = extra or any(v-u <= stroke_limit and
                        first_end < u and v < second_start for u,v in frame_strokes)
                pairs.append((lo, hi, extra))
            previous, active = active, []
            for lo, hi, extra in pairs:
                match = next((t for t in previous if abs(t["lo"]-lo) <= tolerance
                              and abs(t["hi"]-hi) <= tolerance), None)
                if match is None:
                    match = dict(a=x, b=x+1, lo=lo, hi=hi, extras=int(extra))
                    tracks.append(match)
                else:
                    previous.remove(match)
                    match.update(b=x+1, extras=match["extras"]+int(extra))
                active.append(match)
        # A crossing stroke may briefly interrupt a white band. Join only where
        # BOTH original edges continue, never across a blank doorway.
        merged = []
        for t in sorted(tracks, key=lambda v: (v["lo"], v["a"])):
            match = None
            for old in reversed(merged):
                if (abs(old["lo"]-t["lo"]) <= tolerance and abs(old["hi"]-t["hi"]) <= tolerance
                        and 0 <= t["a"]-old["b"] <= max(3*stroke_limit,old["hi"]-old["lo"])):
                    edge_support = []
                    for edge in (old["lo"],old["hi"]-1):
                        strip = source[max(0,edge-tolerance):edge+tolerance+1,old["b"]:t["a"]]
                        edge_support.append(not strip.size or strip.any(axis=0).mean() >= .85)
                    if all(edge_support):
                        match = old
                        break
            if match is None:
                merged.append(t.copy())
            else:
                match["b"] = t["b"]
                match["extras"] += t["extras"]
        for t in merged:
            a, b, lo, hi = (t[k] for k in ("a", "b", "lo", "hi"))
            thickness = hi-lo
            if b-a < max(minimum_length, .7*thickness) or t["extras"]/(b-a) > .55:
                continue
            # At least one observed cap, junction or filled-wall transition.
            # Inspect interior pixels, not the two long strokes themselves.
            inset = max(1, round(stroke_limit/2))
            caps = []
            reach = max(2, round(2*scale))
            for end in (a, b-1):
                patch = source[lo+inset:hi-inset, max(0,end-reach):min(source.shape[1],end+reach+1)]
                caps.append(bool(patch.size and np.max(patch.mean(axis=0)) >= .72))
            if not any(caps) and b-a < 2*thickness:
                continue
            center = (lo+hi)/2
            start, end = ([a,center],[b,center]) if axis == 0 else ([center,a],[center,b])
            box = [a,lo,b,hi] if axis == 0 else [lo,a,hi,b]
            if any(w["orientation"] == ("horizontal" if axis==0 else "vertical")
                   and abs(w["start_px"][1-axis]-center) <= (w["thickness_px"]+thickness)/2
                   and min(b,w["end_px"][axis])-max(a,w["start_px"][axis]) > .5*(b-a)
                   for w in filled):
                continue
            proposals.append(dict(orientation="horizontal" if axis==0 else "vertical",
                                  start_px=list(map(float,start)), end_px=list(map(float,end)),
                                  bbox_px=box, thickness_px=thickness, length_px=b-a,
                                  source="automatic_paired_outline", review_status="unreviewed",
                                  evidence={"paired_edges":True, "end_caps":caps}))
    # Uncapped spans at L/T junctions become walls only when they join an
    # observed wall network. This also excludes detached double furniture boxes.
    def touches(first, second, factor=1.5):
        axis = 0 if first["orientation"] == "horizontal" else 1
        box = second["bbox_px"]
        reach = factor*max(first["thickness_px"],second["thickness_px"]) + tolerance
        for point in (first["start_px"],first["end_px"]):
            if first["orientation"] == second["orientation"]:
                if abs(point[1-axis]-second["start_px"][1-axis]) > max(2, .3*reach):
                    continue
            elif not box[1-axis]-reach <= point[1-axis] <= box[3-axis]+reach:
                continue
            dx = max(box[0]-point[0],0,point[0]-box[2])
            dy = max(box[1]-point[1],0,point[1]-box[3])
            if (dx*dx+dy*dy)**.5 <= reach:
                return True
        return False

    if dense:
        host_width = float(np.median([w["thickness_px"] for w in filled])) if filled else 12*scale
        eligible = [p for p in proposals
                    if .5*host_width <= p["thickness_px"] <= 1.35*host_width
                    and p["length_px"] >= max(3*p["thickness_px"],75*scale)]
        accepted = [p for p in eligible if any(p["evidence"]["end_caps"])
                    and any(touches(p,w) for w in filled)]
        while True:
            additions = [p for p in eligible if p not in accepted
                         and any(touches(p,w) or touches(w,p) for w in accepted)]
            if not additions:
                return accepted
            accepted.extend(additions)
    accepted = [p for p in proposals if any(p["evidence"]["end_caps"])
                or any(touches(p,w,2) for w in filled)]
    while True:
        additions = [p for p in proposals if p not in accepted
                     and any(touches(p,w) or touches(w,p) for w in accepted)]
        if not additions:
            break
        accepted.extend(additions)
    # Pure outline plans have no filled seeds. Retain substantial connected
    # networks; a small isolated furniture rectangle is insufficient evidence.
    remaining = [p for p in proposals if p not in accepted]
    while remaining:
        group = [remaining.pop(0)]
        for item in group:
            neighbors = [p for p in remaining if touches(item,p) or touches(p,item)]
            group.extend(neighbors)
            remaining = [p for p in remaining if p not in neighbors]
        if (not filled and len(group) >= 3
                and sum(p["length_px"] for p in group) >= 450*scale):
            accepted.extend(group)
    return accepted
