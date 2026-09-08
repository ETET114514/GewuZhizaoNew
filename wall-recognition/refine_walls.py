"""Stage three: connect wall axes and subtract openings from solid geometry.

Editable axes are retained independently of the derived solid segments. Opening
constraints remain fixed in image coordinates; editing a wall never erases image
pixels or moves a detected door swing. Rejected openings cease to constrain walls.
"""
from copy import deepcopy

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from recognize_walls import wall_render_parts


ALGORITHM = "wall-opening-wall-v1"
GENERATED = "automatic_opening_connection"
CONSTRAINT = "opening_constraint"


def axis_of(item):
    return 0 if item["orientation"] == "horizontal" else 1


def segment(axis, a, b, center, thickness):
    start, end = ([a, center], [b, center]) if axis == 0 else ([center, a], [center, b])
    box = ([a, center-thickness/2, b, center+thickness/2] if axis == 0 else
           [center-thickness/2, a, center+thickness/2, b])
    return dict(orientation="horizontal" if axis == 0 else "vertical",
                start_px=list(map(float, start)), end_px=list(map(float, end)),
                bbox_px=list(map(float, box)), length_px=float(b-a), thickness_px=float(thickness))


def aligned(wall, opening):
    axis = axis_of(wall)
    return (wall["orientation"] == opening["orientation"] and
            abs(wall["start_px"][1-axis]-opening["start_px"][1-axis]) <=
            min(wall["thickness_px"], opening["thickness_px"])/2 + 1)


def strip_generated_hints(document):
    """Remove derived constraints before an edit validates new wall geometry."""
    for wall in document["walls"]:
        hints = [h for h in wall.get("opening_hints", []) if h.get("source") != CONSTRAINT]
        previous_manual = wall.pop("manual_opening_hints", [])
        if not hints:
            hints = previous_manual
        wall.pop("solid_parts", None)
        if hints:
            wall["opening_hints"] = hints
        else:
            wall.pop("opening_hints", None)


def initialize_refinement(document, image):
    result = deepcopy(document)
    walls = result["walls"]
    result["coarse_walls"] = deepcopy(walls)
    rgb = np.asarray(image.convert("RGB"), dtype=np.int16)
    gray = rgb @ np.array([.299, .587, .114])
    settings = result.get("parameters", {})
    dark = (gray <= settings.get("threshold", 180)) & (
        rgb.max(axis=2)-rgb.min(axis=2) <= settings.get("max_color_spread", 10))
    scale = max(.5, min(image.size)/745)
    next_id = max((int(w["id"][1:]) for w in walls), default=0)+1
    mapping = {}
    for opening in result.get("openings", []):
        original = {key: deepcopy(opening[key]) for key in
                    ("orientation", "start_px", "end_px", "bbox_px", "length_px", "thickness_px")}
        opening["detected_geometry"] = original
        axis = axis_of(opening)
        a, b = opening["start_px"][axis], opening["end_px"][axis]
        center, thickness = opening["start_px"][1-axis], opening["thickness_px"]
        # A nearby collinear wall supplies the actual host axis and thickness.
        nearby = [w for w in walls if aligned(w, opening) and min(
            abs(w["end_px"][axis]-a), abs(w["start_px"][axis]-b)) <= 14*scale]
        if nearby:
            host = min(nearby, key=lambda w: abs(w["start_px"][1-axis]-center))
            center, thickness = host["start_px"][1-axis], host["thickness_px"]
        thickness = min(thickness, 2*center, 2*(image.size[1-axis]-center))
        supports = []
        for end, is_start in ((a, True), (b, False)):
            candidates = []
            for wall in walls:
                box = wall["bbox_px"]
                if not box[1-axis]-2*scale <= center <= box[3-axis]+2*scale:
                    continue
                # Only walls ending near the jamb qualify. A frame mistakenly
                # spanning the entire opening must not protect itself from cuts.
                if min(b, box[axis+2])-max(a, box[axis]) > .45*(b-a):
                    continue
                edge = box[axis+2] if is_start else box[axis]
                if abs(edge-end) <= 14*scale:
                    candidates.append((abs(edge-end), edge, wall["id"]))
            # Glazed corners can meet a perpendicular opening, without a jamb.
            for other in result.get("openings", []):
                other_geometry = other.get("detected_geometry", other)
                if other["id"] == opening["id"] or axis_of(other_geometry) == axis:
                    continue
                edge = other_geometry["start_px"][axis]
                if (abs(edge-end) <= 9*scale and min(abs(other_geometry[k][1-axis]-center)
                    for k in ("start_px", "end_px")) <= 9*scale):
                    candidates.append((abs(edge-end)+1, edge, other["id"]))
            supports.append(min(candidates) if candidates else (0, end, None))
        start, end = supports[0][1], supports[1][1]
        if end-start < max(4, .5*(b-a)):
            start, end = a, b
            supports = [(0, a, None), (0, b, None)]
        connection = segment(axis, start, end, center, thickness)
        # Preserve short dark jamb pieces between an observed opening and the
        # supporting wall. No added solid cap is inferred merely from distance.
        source = dark if axis == 0 else dark.T
        lo, hi = max(0, int(center-thickness/2)), min(source.shape[0], int(np.ceil(center+thickness/2)))
        profile = source[lo:hi].mean(axis=0) if hi > lo else np.zeros(source.shape[1])
        cut_start, cut_end = start, end
        for pixel in range(int(np.ceil(start)), min(int(a), int(end))):
            if profile[pixel] < .72:
                break
            cut_start = pixel+1
        for pixel in range(int(end)-1, max(int(np.ceil(b)), int(cut_start))-1, -1):
            if profile[pixel] < .72:
                break
            cut_end = pixel
        if cut_end <= cut_start:
            cut_start, cut_end = start, end
        opening.update(segment(axis, cut_start, cut_end, center, thickness))
        opening["connection_span"] = connection
        opening["jamb_support_ids"] = [s[2] for s in supports if s[2]]
        mapping[opening["id"]] = f"W{next_id:03d}"
        next_id += 1
    result.update(schema_version="0.3.0", refinement_algorithm=ALGORITHM,
                  opening_wall_ids=mapping, suppressed_connection_ids=[])
    result["opening_basis"] = "source-image jamb constraints; reapplied after every edit"
    result.setdefault("geometry", {}).update(
        walls="Editable axes; never fill their entire bbox without subtracting opening_hints.",
        solid_wall_segments="Derived solid geometry with openings removed; used for display and export.")
    return refresh_refinement(result)


def refresh_refinement(document):
    """Rebuild derived connections, hints, and solids without rerunning detection."""
    result = deepcopy(document)
    if result.get("refinement_algorithm") != ALGORITHM:
        return result
    strip_generated_hints(result)
    walls = [w for w in result["walls"] if w.get("source") != GENERATED]
    active = [o for o in result.get("openings", []) if o.get("review_status") != "rejected" and o.get("kind") != "rejected"]
    occupied = {w["id"] for w in walls} | set(result.get("suppressed_connection_ids", []))
    for opening in active:
        connection = opening.get("connection_span", opening)
        axis = axis_of(connection)
        a, b = connection["start_px"][axis], connection["end_px"][axis]
        identifier = result["opening_wall_ids"].get(opening["id"])
        if not identifier or identifier in occupied:
            continue
        # A user may already have extended a wall across this gap.
        if any(aligned(w, connection) and w["start_px"][axis] <= a and w["end_px"][axis] >= b for w in walls):
            continue
        walls.append({**deepcopy(connection), "id": identifier, "source": GENERATED,
                      "review_status": "unreviewed", "opening_id": opening["id"]})
        occupied.add(identifier)
    solid = []
    for wall in walls:
        axis = axis_of(wall)
        intervals = []
        manual = deepcopy(wall.get("opening_hints", []))
        if manual:
            wall["manual_opening_hints"] = manual
        # Keep manual hints as geometry constraints too, merging overlaps safely.
        for hint in wall.get("opening_hints", []):
            intervals.append((hint["start_px"][axis], hint["end_px"][axis], [hint["id"]]))
        for opening in active:
            if not aligned(wall, opening):
                continue
            a = max(wall["start_px"][axis], opening["start_px"][axis])
            b = min(wall["end_px"][axis], opening["end_px"][axis])
            if b > a:
                intervals.append((a, b, [opening["id"]]))
        merged = []
        for a, b, ids in sorted(intervals):
            if merged and a <= merged[-1][1]:
                merged[-1][1] = max(b, merged[-1][1])
                merged[-1][2] = sorted(set(merged[-1][2]+ids))
            else:
                merged.append([a, b, ids])
        if merged:
            wall["opening_hints"] = [
                {**segment(axis, a, b, wall["start_px"][1-axis], wall["thickness_px"]),
                 "id": f"{wall['id']}:G{n}", "source": CONSTRAINT,
                 "opening_ids": ids, "classification": "unclassified_boundary"}
                for n, (a, b, ids) in enumerate(merged, 1)]
        else:
            wall.pop("opening_hints", None)
        parts = []
        for part in wall_render_parts(wall):
            if part.get("classification") == "unclassified_boundary":
                continue
            geo = {key: deepcopy(part[key]) for key in
                   ("orientation", "start_px", "end_px", "bbox_px", "length_px", "thickness_px")}
            parts.append({**geo, "id": f"{wall['id']}:S{len(parts)+1}", "host_wall_id": wall["id"]})
        wall["solid_parts"] = parts
        solid.extend(deepcopy(parts))
    result["walls"] = walls
    result["solid_wall_segments"] = solid
    result["refinement_summary"] = dict(
        coarse_wall_count=len(result.get("coarse_walls", [])),
        active_opening_count=len(active),
        connection_count=sum(w.get("source") == GENERATED for w in walls),
        constrained_wall_count=sum(bool(w.get("opening_hints")) for w in walls),
        solid_segment_count=len(solid),
        excluded_length_px=round(sum(h["length_px"] for w in walls for h in w.get("opening_hints", [])), 2))
    return result


def draw_pipeline_preview(image, document):
    """Comparable panels, using the exact solid geometry exported by stage 3."""
    try:
        font = ImageFont.truetype("msyh.ttc", 18)
        titles = ("第一步：粗识别墙体", "第二、三步：识别门窗，再整理实墙")
        notes = ("蓝色：原来的墙体候选", "蓝色：实墙　绿色：保留洞口　橙色：补出的短墙")
    except OSError:
        font = ImageFont.load_default(size=18)
        titles = ("1. Coarse walls", "2-3. Openings and refined walls")
        notes = ("Blue: coarse candidates", "Blue: solid walls | Green: openings | Orange: recovered jambs")
    width, height = image.size
    canvas = Image.new("RGB", (width*2+36, height+92), "#f3f6fa")
    draw = ImageDraw.Draw(canvas)
    coarse_ids = {w["id"] for w in document["coarse_walls"]}
    for index, items in enumerate((document["coarse_walls"], document["solid_wall_segments"])):
        panel = image.convert("RGBA")
        layer = Image.new("RGBA", image.size)
        ink = ImageDraw.Draw(layer)
        for item in items:
            recovered = index and item["host_wall_id"] not in coarse_ids
            color = (211, 108, 28) if recovered else (35, 103, 206)
            x0, y0, x1, y1 = item["bbox_px"]
            ink.rectangle((x0,y0,x1-1,y1-1),fill=(*color,95),outline=(*color,230))
        if index:
            for opening in document["openings"]:
                if opening.get("review_status") == "rejected":
                    continue
                a, b = opening["start_px"], opening["end_px"]
                ink.line((tuple(a),tuple(b)),fill=(0,135,112,255),width=3)
                for x,y in (a,b):
                    ink.ellipse((x-2,y-2,x+2,y+2),fill=(0,135,112,255))
        left = 12+index*(width+12)
        canvas.paste(Image.alpha_composite(panel,layer).convert("RGB"),(left,80))
        draw.text((left+8,12),titles[index],font=font,fill="#22334b")
        draw.text((left+8,43),notes[index],font=font,fill="#5a6e82")
    return canvas
