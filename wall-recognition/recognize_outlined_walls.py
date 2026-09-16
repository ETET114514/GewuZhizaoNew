"""Recover white wall bands from paired strokes and observed end connections.

Work on local cross sections so a frame or railing cannot absorb an adjacent
wall of a different width. No room closure or arbitrary gap filling is used.
"""
import numpy as np
import cv2

from recognize_walls import runs


def detect_outlined_walls(image, filled):
    ordinary = _detect_outlined_walls(image, filled)
    network = _detect_outlined_walls(image, filled, network=True)
    if not network:
        return ordinary
    combined = []
    for candidate in sorted([*ordinary,*network],key=lambda p:-p["length_px"]):
        axis = 0 if candidate["orientation"] == "horizontal" else 1
        if any(candidate["orientation"] == old["orientation"]
               and abs(candidate["start_px"][1-axis]-old["start_px"][1-axis]) <= 2
               and min(candidate["end_px"][axis],old["end_px"][axis])
                   -max(candidate["start_px"][axis],old["start_px"][axis]) >= .85*candidate["length_px"]
               for old in combined):
            continue
        combined.append(candidate)
    return combined


def _detect_outlined_walls(image, filled, network=False):
    rgb = np.asarray(image.convert("RGB"), dtype=np.int16)
    gray = rgb @ np.array([.299, .587, .114])
    ink = (gray < 220) & (rgb.max(axis=2) - rgb.min(axis=2) <= 20)
    # Dense furnished/dimensioned drawings contain many accidental line pairs.
    # Use conservative evidence there instead of treating every pair as a wall.
    ys, xs = np.nonzero(ink)
    density = float(ink[ys.min():ys.max()+1,xs.min():xs.max()+1].mean()) if len(xs) else 0.
    dense = (density > .10 and len(xs) > 0
             and min(xs.max()-xs.min(),ys.max()-ys.min()) > .3*min(image.size))
    if network and not dense:
        return []
    frame_ink = ink
    if dense and not network:
        ink = ink & (gray < 130)
    scale = max(.5, min(image.size) / 745,
                float(np.median([w["thickness_px"] for w in filled])) / 12 if filled else .5)
    stroke_limit = max(2, round(3 * scale))
    if network:
        stroke_limit = max(stroke_limit, round(3.5*scale))
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
        for t in sorted(tracks, key=lambda v: (v["a"], v["lo"]) if network else (v["lo"], v["a"])):
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
            if network and b-a >= 35*scale:
                # At a junction a perpendicular stroke can make a wall edge
                # too thick for pair extraction. Continue only while both
                # observed edges and the empty wall core persist pixel by pixel.
                inset = max(2, min(stroke_limit+1, (thickness-1)//2))
                core = source[lo+inset:hi-inset]
                valid = core.mean(axis=0) < .08 if core.size else np.zeros(source.shape[1],bool)
                for edge in (lo,hi-1):
                    valid &= source[max(0,edge-tolerance):edge+tolerance+1].any(axis=0)
                while a > 0 and valid[a-1]:
                    a -= 1
                while b < source.shape[1] and valid[b]:
                    b += 1
            if b-a < max(minimum_length, .7*thickness) or (not network and t["extras"]/(b-a) > .55):
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
            if network:
                inset = max(2, min(stroke_limit+1, (thickness-1)//2))
                core = source[lo+inset:hi-inset,a+2:b-2]
                proposals[-1]["evidence"].update(
                    extra_edge_fraction=t["extras"]/(b-a),
                    interior_ink_fraction=float(core.mean()) if core.size else 1.)
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

    if network:
        return select_outline_network(proposals, image.size, scale, touches, frame_ink)
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


def select_outline_network(proposals, size, scale, touches, ink):
    """Bootstrap dense white-wall drawings from long, empty parallel bands.

    Filled furniture hatch is not a wall-width prior. Require architectural
    extent in both directions before using the observed outline width instead.
    """
    clean = [p for p in proposals if p["evidence"]["interior_ink_fraction"] < .06]
    long = [p for p in clean if p["length_px"] >= .18*min(size)
            and p["thickness_px"] >= 9*scale]
    if len(long) < 3 or len({p["orientation"] for p in long}) < 2:
        return []
    bounds = np.array([p["bbox_px"] for p in long])
    if np.any(bounds[:,2:].max(axis=0)-bounds[:,:2].min(axis=0) < .55*np.array(size)):
        return []
    weights = sorted(long, key=lambda p:p["thickness_px"])
    midpoint = sum(p["length_px"] for p in weights)/2
    cumulative = 0
    for p in weights:
        cumulative += p["length_px"]
        if cumulative >= midpoint:
            width = p["thickness_px"]
            break
    outside = np.pad((~ink).astype(np.uint8),1,constant_values=1)
    cv2.floodFill(outside,None,(0,0),2)
    outside = outside[1:-1,1:-1] == 2

    def exterior(p):
        x,y,r,b = map(int,p["bbox_px"])
        offset = max(2,round(3*scale))
        if p["orientation"] == "horizontal":
            sides = [outside[max(0,y-offset),x:r],outside[min(size[1]-1,b+offset),x:r]]
        else:
            sides = [outside[y:b,max(0,x-offset)],outside[y:b,min(size[0]-1,r+offset)]]
        return any(s.size and s.mean() > .6 for s in sides)

    eligible = [p for p in clean if .72*width <= p["thickness_px"] <= 1.22*width
                and p["length_px"] >= max(2*p["thickness_px"],35*scale)]
    accepted = [p for p in eligible if p in long]
    accepted.extend(p for p in clean if p not in accepted
                    and .72*width <= p["thickness_px"] <= 1.22*width
                    and p["length_px"] >= 18*scale and exterior(p))
    # Separated rooms may have disconnected wall runs. A substantial matching
    # band is evidence by itself; short objects must join the observed network.
    accepted.extend(p for p in eligible if p not in accepted and p["length_px"] >= 70*scale)
    thin = [p for p in clean if .5*width <= p["thickness_px"] < .72*width
            and p["length_px"] >= 55*scale]
    accepted.extend(p for p in thin if p["length_px"] >= 120*scale
                    or (all(p["evidence"]["end_caps"])
                        and any(touches(p,w,.6) for w in accepted)))
    while True:
        additions = [p for p in eligible if p not in accepted
                     and any(touches(p,w,.6) or touches(w,p,.6) for w in accepted)]
        if not additions:
            break
        accepted.extend(additions)
    return accepted
