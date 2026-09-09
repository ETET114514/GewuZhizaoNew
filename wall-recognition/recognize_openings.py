"""Reviewable door/window candidates from line geometry, without trained weights.

The reference legends motivate parallel frame lines and quarter-circle door
swings. They are not training data. No room type, bearing capacity, or furniture
class is inferred. Output stays separate from editable solid-wall geometry.
"""
from __future__ import annotations

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

from recognize_walls import bridge_gaps, runs


ALGORITHM = "wall-aware-frames-and-swing-arcs-v2"
LIMITATIONS = [
    "门窗为待校核候选；规则分数不是准确率或概率。",
    "支持水平/垂直多线窗框和平开门开启弧；浅色、遮挡和非直角符号可能漏检。",
    "窗框候选不细分固定窗/推拉窗/平开窗；门的朝向以图像坐标表示，不推断室内外。",
    "尚不自动分类飘窗、井道、家具、厨卫设备及承重/非承重墙。",
]


def line_segments(gray: np.ndarray, scale: float) -> list[dict]:
    """Extract narrow straight strokes, also retaining light frame lines."""
    lines = []
    for axis in (0, 1):
        source = gray if axis == 0 else gray.T
        # Cross-line contrast removes solid fills and most floor texture.
        offset = max(3, round(3 * scale))
        padded = np.pad(source, ((offset, offset), (0, 0)), mode="edge")
        contrast = np.maximum(padded[:-2*offset],padded[2*offset:]) - source
        mask = (source < 235) & (contrast > 12)
        supported = bridge_gaps(mask, max(1, round(scale)))
        tracks = []
        for row, pixels in enumerate(supported):
            for a,b in runs(pixels):
                if b-a < max(12,round(18*scale)):
                    continue
                match = next((t for t in reversed(tracks) if row-t["last"] == 1 and
                              abs(t["a"]-a) <= 4*scale and abs(t["b"]-b) <= 4*scale),None)
                if match:
                    match.update(a=min(a,match["a"]),b=max(b,match["b"]),last=row)
                else:
                    tracks.append(dict(a=a,b=b,first=row,last=row))
        for t in tracks:
            width=t["last"]-t["first"]+1
            if width <= max(4,round(5*scale)):
                lines.append(dict(axis=axis,a=t["a"],b=t["b"],c=(t["first"]+t["last"])/2,width=width))
    return lines


def wall_distance(point, walls):
    x, y = point
    return min((max(w["bbox_px"][0]-x, 0, x-w["bbox_px"][2])**2 +
                max(w["bbox_px"][1]-y, 0, y-w["bbox_px"][3])**2)**.5
               for w in walls) if walls else float("inf")


def end_support(axis, a, b, c, walls, scale):
    """Require wall ends/jambs, not merely a nearby parallel furniture edge."""
    eligible = []
    for wall in walls:
        box = wall["bbox_px"]
        lo,hi = box[axis],box[axis+2]
        if min(b,hi)-max(a,lo) > .45*(b-a):
            continue
        eligible.append(wall)
    p1,p2 = ([a,c],[b,c]) if axis == 0 else ([c,a],[c,b])
    return [wall_distance(p,eligible) for p in (p1,p2)]


def alongside_wall(axis,a,b,c,walls,scale):
    for wall in walls:
        if wall["orientation"] != ("horizontal" if axis == 0 else "vertical"):
            continue
        if (abs(wall["start_px"][1-axis]-c) <= wall["thickness_px"]/2+8*scale and
            min(b,wall["end_px"][axis])-max(a,wall["start_px"][axis]) > .5*(b-a)):
            return True
    return False


def wall_continuation(axis,a,b,c,walls,scale):
    return any(w["orientation"] == ("horizontal" if axis==0 else "vertical") and
               abs(w["start_px"][1-axis]-c) <= max(5*scale,w["thickness_px"]/2) and
               (abs(w["end_px"][axis]-a) <= 14*scale or abs(w["start_px"][axis]-b) <= 14*scale)
               for w in walls)


def geometry(axis, a, b, c, thickness, size):
    p1, p2 = ([a, c], [b, c]) if axis == 0 else ([c, a], [c, b])
    box = ([a, c-thickness/2, b, c+thickness/2] if axis == 0 else
           [c-thickness/2, a, c+thickness/2, b])
    box = [max(0., min(float(v), float(size[i % 2]))) for i, v in enumerate(box)]
    return dict(orientation="horizontal" if axis == 0 else "vertical",
                start_px=p1, end_px=p2, bbox_px=box, length_px=b-a,
                thickness_px=thickness)


def window_candidates(image, gray, walls, lines, scale):
    proposals = []
    background=ImageOps.expand(Image.fromarray(np.uint8(gray>245)*255),border=1,fill=255)
    ImageDraw.floodfill(background,(0,0),128)
    exterior=np.asarray(background)[1:-1,1:-1]==128
    for axis in (0, 1):
        strokes = sorted((s for s in lines if s["axis"] == axis), key=lambda s:s["c"])
        for i, first in enumerate(strokes):
            for second in strokes[i+1:]:
                spacing = second["c"]-first["c"]
                if spacing > 14*scale:
                    break
                if spacing < 2*scale:
                    continue
                a, b = max(first["a"], second["a"]), min(first["b"], second["b"])
                if b-a < 22*scale or (b-a)/min(first["b"]-first["a"], second["b"]-second["a"]) < .7:
                    continue
                center = (first["c"]+second["c"])/2
                geo = geometry(axis, a, b, center, spacing+2*scale, image.size)
                distances = end_support(axis,a,b,center,walls,scale)
                if min(distances) > 12*scale or alongside_wall(axis,a,b,center,walls,scale):
                    continue
                # A compact closed rectangle with another long side is more
                # likely a fixture/cabinet outline than a window opening.
                if enclosed_rectangle(axis,a,b,center,lines,scale) and not exterior_side(axis,a,b,center,exterior,scale):
                    continue
                # A filled stripe is a wall edge, not a multi-line frame.
                src = gray if axis == 0 else gray.T
                interior = src[int(first["c"])+1:int(second["c"]), a:b]
                if not interior.size or np.mean(interior < 160) > .48:
                    continue
                count = sum(a <= s["b"] and b >= s["a"] and
                            min(b,s["b"])-max(a,s["a"]) >= .65*(b-a) and
                            first["c"] <= s["c"] <= second["c"] for s in strokes)
                proposals.append({**geo, "kind":"window", "label":"窗框候选",
                                  "score":round(min(.94, .63+.055*min(count,5)-min(max(distances),20*scale)/(300*scale)),3),
                                  "evidence":{"parallel_line_count":count, "end_wall_distances_px":distances}})
    # A long pair of frame strokes can continue along a white wall. Split at
    # recovered wall bands before it is ever used to subtract solid geometry.
    trimmed = []
    for proposal in proposals:
        axis = 0 if proposal["orientation"] == "horizontal" else 1
        center = proposal["start_px"][1-axis]
        spans = [(proposal["start_px"][axis],proposal["end_px"][axis])]
        for wall in walls:
            if (wall.get("source") != "automatic_paired_outline"
                    or wall["orientation"] != proposal["orientation"]
                    or abs(wall["start_px"][1-axis]-center) >
                    min(wall["thickness_px"],proposal["thickness_px"])/2+1):
                continue
            lo,hi = wall["start_px"][axis],wall["end_px"][axis]
            next_spans = []
            for a,b in spans:
                if hi <= a or lo >= b:
                    next_spans.append((a,b))
                else:
                    if a < lo: next_spans.append((a,lo))
                    if hi < b: next_spans.append((hi,b))
            spans = next_spans
        for a,b in spans:
            if b-a < 22*scale:
                continue
            evidence = dict(proposal["evidence"],end_wall_distances_px=end_support(axis,a,b,center,walls,scale))
            trimmed.append({**proposal,**geometry(axis,a,b,center,proposal["thickness_px"],image.size),"evidence":evidence})
    proposals = trimmed
    accepted=[]
    for p in proposals:
        distances=p["evidence"]["end_wall_distances_px"]
        if max(distances)<=12*scale:
            accepted.append(p)
            continue
        axis=0 if p["orientation"]=="horizontal" else 1
        if not exterior_side(axis,p["start_px"][axis],p["end_px"][axis],p["start_px"][1-axis],exterior,scale):
            continue
        free=p["end_px"] if distances[1]>distances[0] else p["start_px"]
        # L-shaped glazed boundaries can terminate on another frame instead of
        # a solid wall. Both arms must independently reach a structural jamb.
        if any(q["orientation"]!=p["orientation"] and min(
            np.linalg.norm(np.asarray(free)-q[k]) for k in ("start_px","end_px"))<9*scale
            for q in proposals):
            p["evidence"]["frame_corner_support"]=True
            accepted.append(p)
    return accepted


def exterior_side(axis,a,b,c,exterior,scale):
    src=exterior if axis==0 else exterior.T
    for sign in (-1,1):
        lo,hi=sorted([round(c+sign*15*scale),round(c+sign*32*scale)])
        strip=src[max(0,lo):min(src.shape[0],hi),round(a+5*scale):round(b-5*scale)]
        if strip.size and np.mean(strip)>.85:
            return True
    return False


def enclosed_rectangle(axis,a,b,c,lines,scale):
    for opposite in lines:
        distance=abs(opposite["c"]-c)
        if (opposite["axis"]!=axis or not 18*scale<distance<100*scale or
            (b-a)/distance>3.8 or
            min(b,opposite["b"])-max(a,opposite["a"])<.8*(b-a)):
            continue
        lo,hi=sorted([c,opposite["c"]])
        if all(any(s["axis"]!=axis and abs(s["c"]-end)<8*scale and
                   s["a"]<=lo+8*scale and s["b"]>=hi-8*scale for s in lines) for end in (a,b)):
            return True
    return False


def suppress(proposals, scale):
    result = []
    for candidate in sorted(proposals, key=lambda p:(p["score"],p["length_px"]), reverse=True):
        axis = 0 if candidate["orientation"] == "horizontal" else 1
        a,b = candidate["start_px"][axis],candidate["end_px"][axis]
        if any(other["kind"] == candidate["kind"] and other["orientation"] == candidate["orientation"] and
               abs(other["start_px"][1-axis]-candidate["start_px"][1-axis]) < 16*scale and
               max(0,min(b,other["end_px"][axis])-max(a,other["start_px"][axis])) >
               .5*min(b-a,other["length_px"]) for other in result):
            continue
        result.append(candidate)
    return result


def door_candidates(image,gray,walls,lines,scale):
    # Search quarter-circle sweeps anchored at an observed open leaf endpoint.
    # Radial off-curve samples discount texture that merely happens to be dark.
    local_light=np.asarray(image.convert("L").filter(ImageFilter.MaxFilter(7)),dtype=np.float32)
    ink=((local_light-gray)>16)&(gray<235)
    ink=np.asarray(Image.fromarray(ink).filter(ImageFilter.MaxFilter(3)),dtype=bool)
    height,width=gray.shape
    theta=np.linspace(.18,1.39,48)
    def sample(x,y):
        xi,yi=np.rint(x).astype(int),np.rint(y).astype(int)
        valid=(xi>=0)&(yi>=0)&(xi<width)&(yi<height)
        return ink[np.clip(yi,0,height-1),np.clip(xi,0,width-1)]&valid
    proposals=[]
    for leaf in lines:
        length=leaf["b"]-leaf["a"]
        if not 28*scale <= length <= 85*scale:
            continue
        axis=1-leaf["axis"]
        for at_start in (True,False):
            root=leaf["a"] if at_start else leaf["b"]
            leaf_sign=1 if at_start else -1
            hinge=[leaf["c"],root] if axis==0 else [root,leaf["c"]]
            if wall_distance(hinge,walls)>12*scale:
                continue
            for direction in (-1,1):
                best=None
                for radius in np.arange(max(18*scale,length-5*scale),length+7*scale,2*scale):
                    a,b=sorted([hinge[axis],hinge[axis]+direction*radius])
                    center=hinge[1-axis]
                    if a<0 or b>image.size[axis] or alongside_wall(axis,a,b,center,walls,scale):
                        continue
                    if max(end_support(axis,a,b,center,walls,scale)) > 14*scale:
                        continue
                    if radius<28*scale or not wall_continuation(axis,a,b,center,walls,scale):
                        continue
                    if enclosed_rectangle(axis,a,b,center,lines,scale):
                        continue
                    def sweep(r):
                        u=hinge[axis]+direction*r*np.cos(theta)
                        v=hinge[1-axis]+leaf_sign*r*np.sin(theta)
                        return sample(u,v) if axis==0 else sample(v,u)
                    hits=sweep(radius)
                    support=float(hits.mean())
                    coverage=min(float(chunk.mean()) for chunk in np.array_split(hits,3))
                    off=float(np.mean([sweep(radius-5*scale).mean(),sweep(radius+5*scale).mean()]))
                    if support<.85 or coverage<.5 or support-off<.12:
                        continue
                    score=.6*support+.4*(support-off)
                    if best is None or score>best["score"]:
                        best={**geometry(axis,a,b,center,8*scale,image.size),"kind":"door",
                              "label":"平开门候选","score":round(score,3),
                              "hinge_px":hinge,"leaf_end_px":([hinge[0],root+leaf_sign*radius] if axis==0 else [root+leaf_sign*radius,hinge[1]]),
                              "evidence":{"arc_support":round(support,3),"arc_contrast":round(support-off,3),
                                          "leaf_length_px":length,"swing_side":"down" if axis==0 and leaf_sign>0 else "up" if axis==0 else "right" if leaf_sign>0 else "left"}}
                if best:
                    proposals.append(best)
    return proposals


def detect_openings(image: Image.Image, walls: list[dict]) -> list[dict]:
    gray = np.asarray(image.convert("L"), dtype=np.float32)
    scale = max(.5, min(image.size)/745,
                float(np.median([w["thickness_px"] for w in walls]))/12 if walls else .5)
    lines = line_segments(gray, scale)
    candidates = window_candidates(image, gray, walls, lines, scale)
    candidates += door_candidates(image,gray,walls,lines,scale)
    candidates = suppress(candidates, scale)
    for candidate in candidates:
        axis = 0 if candidate["orientation"] == "horizontal" else 1
        if (candidate["kind"] == "window"
                and candidate["evidence"].get("parallel_line_count",0) >= 4
                and enclosed_rectangle(axis,candidate["start_px"][axis],candidate["end_px"][axis],
                                       candidate["start_px"][1-axis],lines,scale)):
            candidate.update(kind="unclassified",label="窗/栏杆/设备边界待定",requires_confirmation=True)
            candidate["evidence"]["ambiguity"] = "parallel strokes on a closed rectangle"
    # Door thresholds can contain several straight strokes too. Prefer an
    # observed swing over a generic frame interpretation of the same opening.
    doors=[c for c in candidates if c["kind"]=="door"]
    candidates=[c for c in candidates if c["kind"]=="door" or not any(
        d["orientation"]==c["orientation"] and
        abs(d["start_px"][1-(axis:=0 if c["orientation"]=="horizontal" else 1)]-c["start_px"][1-axis])<10*scale and
        min(d["end_px"][axis],c["end_px"][axis])-max(d["start_px"][axis],c["start_px"][axis])>.6*min(d["length_px"],c["length_px"])
        for d in doors)]
    candidates.sort(key=lambda c:(c["bbox_px"][1],c["bbox_px"][0],c["kind"]))
    for number, candidate in enumerate(candidates,1):
        candidate.update(id=f"O{number:03d}",source="automatic_symbol_rules",
                         review_status="unreviewed", geometry_role="boundary_candidate" if candidate.get("requires_confirmation") else "opening_candidate")
    return candidates


def draw_openings(image, openings):
    result = image.convert("RGB").copy()
    draw = ImageDraw.Draw(result)
    try:
        font = ImageFont.truetype("arial.ttf",12)
    except OSError:
        font = ImageFont.load_default()
    for opening in openings:
        color = "#087e8b" if opening["kind"] == "window" else "#b74915" if opening["kind"] == "door" else "#737080"
        a,b = opening["start_px"],opening["end_px"]
        draw.line((tuple(a),tuple(b)),fill=color,width=3)
        for x,y in (a,b):
            draw.ellipse((x-3,y-3,x+3,y+3),fill=color)
        x,y = (a[0]+b[0])/2,(a[1]+b[1])/2
        label = opening["id"] + (" WIN" if opening["kind"] == "window" else " DOOR" if opening["kind"] == "door" else " ?")
        x = max(0,min(result.width-80,x+7)); y=max(0,min(result.height-18,y-10))
        draw.rectangle((x-2,y-2,x+77,y+15),fill="white",outline=color)
        draw.text((x,y),label,fill=color,font=font)
    return result
