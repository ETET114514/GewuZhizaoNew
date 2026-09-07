"""Deterministic geometric edits requested through the local page."""
from copy import deepcopy
import math
import re

from apply_corrections import recompute_geometry


def apply_edit(document, request, next_id):
    result = deepcopy(document)
    width, height = result["image"]["width_px"], result["image"]["height_px"]
    walls = {w["id"]: w for w in result["walls"]}
    category = request.get("type", "other")
    note = request.get("note", "")
    if not isinstance(note, str) or len(note) > 1000:
        raise ValueError("修改说明最多 1000 字。")
    direction = request.get("direction", "")
    for name, pattern in {"up": r"向上|往上|上端", "down": r"向下|往下|下端", "left": r"向左|往左|左边|左端", "right": r"向右|往右|右边|右端"}.items():
        if not direction and re.search(pattern, note):
            direction = name
    target_id = request.get("target_wall_id", "")
    match = re.search(r"(?:到|连接|接到|直到)\s*(W\d{3,})", note, re.I)
    if not target_id and match:
        target_id = match.group(1).upper()
    if target_id and target_id not in walls:
        raise ValueError("连接目标不存在，请重新选择目标墙段。")
    amount = request.get("amount_px", 50)
    amount_match = re.search(r"(\d+(?:\.\d+)?)\s*(?:px|像素)", note, re.I)
    if amount_match:
        amount = float(amount_match.group(1))
    if not isinstance(amount, (int, float)) or not math.isfinite(amount) or not 0 < amount <= 2000:
        raise ValueError("调整量或厚度需为 0–2000 之间的正数。")
    if category == "other":
        if re.search(r"删|不是墙|不应该是墙", note): category = "false_positive"
        elif re.search(r"转角|拐角", note): category = "missing_corner"
        elif re.search(r"延长|太短|不够长|连接|一直到", note): category = "too_short"
        elif re.search(r"缩短|太长", note): category = "too_long"
        elif "厚" in note: category = "thickness"
        elif "移动" in note: category = "position"
        else: raise ValueError("这条文字还不够明确，请选择延长、转角、厚度或移动，并补齐参数。")
    if category == "missing_wall":
        box = request.get("region_px")
        if (not isinstance(box, list) or len(box) != 4 or not all(isinstance(v, (int, float)) and math.isfinite(v) for v in box)
                or not (0 <= box[0] < box[2] <= width and 0 <= box[1] < box[3] <= height)):
            raise ValueError("请在底图内框出要补的墙。")
        x0, y0, x1, y1 = box
        horizontal = direction in ("left", "right") or (direction not in ("up", "down") and x1-x0 >= y1-y0)
        wall = {"id": f"W{next_id:03d}", "start_px": [x0,(y0+y1)/2] if horizontal else [(x0+x1)/2,y0],
                "end_px": [x1,(y0+y1)/2] if horizontal else [(x0+x1)/2,y1], "thickness_px": y1-y0 if horizontal else x1-x0}
        next_id += 1
        result["walls"].append(wall)
        summary = f"已补入 {wall['id']}，可继续调整厚度和位置"
    else:
        wall = walls.get(request.get("wall_id"))
        if wall is None:
            raise ValueError("请先选择要修改的墙段。")
        original_id = wall["id"]
        axis = 0 if wall["orientation"] == "horizontal" else 1
        if category == "false_positive":
            result["walls"] = [w for w in result["walls"] if w["id"] != wall["id"]]
            summary = f"已删除 {wall['id']}"
        elif category == "thickness":
            wall["thickness_px"] = amount
            summary = f"{wall['id']} 厚度已改为 {amount:g} px"
        else:
            if direction not in ("up", "down", "left", "right"):
                raise ValueError("请选择修改方向，或在说明里写向上、向下、向左、向右。")
            move_axis = 0 if direction in ("left", "right") else 1
            sign = -1 if direction in ("left", "up") else 1
            if category == "position":
                for key in ("start_px", "end_px"):
                    wall[key][move_axis] += sign * amount
                for hint in wall.get("opening_hints", []):
                    for key in ("start_px", "end_px"):
                        hint[key][move_axis] += sign * amount
                summary = f"{wall['id']} 已移动 {amount:g} px"
            elif category in ("missing_corner", "too_short", "too_long"):
                if category == "missing_corner" or move_axis != axis:
                    if move_axis == axis:
                        raise ValueError("转角方向需与原墙垂直；沿原方向请选延长。")
                    category = "missing_corner"
                    anchor = list(wall["start_px"] if request.get("anchor", "end") == "start" else wall["end_px"])
                    wall = {"id": f"W{next_id:03d}", "start_px": list(anchor), "end_px": list(anchor), "thickness_px": walls[original_id]["thickness_px"], "related_to": original_id}
                    next_id += 1
                    result["walls"].append(wall)
                    axis = move_axis
                    endpoint = "start_px" if sign < 0 else "end_px"
                    current = anchor[axis]
                else:
                    endpoint = "start_px" if sign < 0 else "end_px"
                    current = wall[endpoint][axis]
                destination = current + sign * amount * (-1 if category == "too_long" else 1)
                if target_id:
                    target = walls[target_id]
                    target_axis = 0 if target["orientation"] == "horizontal" else 1
                    cross = 1-axis
                    if target_id == original_id or target_axis == axis:
                        raise ValueError("连接目标应是与延长方向垂直的另一段墙。")
                    if not target["start_px"][cross] <= wall[endpoint][cross] <= target["end_px"][cross]:
                        raise ValueError("沿这个方向碰不到目标墙，请调整转角端点或方向。")
                    destination = target["start_px"][axis]
                delta = (destination-current) * sign
                if (category == "too_long" and delta >= 0) or (category != "too_long" and delta <= 0):
                    raise ValueError("目标不在指定修改方向上，请检查方向或目标墙。")
                wall[endpoint][axis] = destination
                summary = f"已{'补转角' if category == 'missing_corner' else '缩短' if category == 'too_long' else '延长'} {wall['id']}" + (f"，连接到 {target_id}" if target_id else f"，调整 {amount:g} px")
            else:
                raise ValueError("请选择支持的修改类型。")
    if category != "false_positive":
        wall.update(source="user_correction", review_status="edited", correction_note=note)
        recompute_geometry(wall, width, height)
    result["review_revision"] = "interactive"
    record = {"id": wall["id"], "wall_id": wall["id"], "type": category, "direction": direction, "target_wall_id": target_id,
              "note": note, "summary": summary, "amount_px": amount}
    return result, record, next_id
