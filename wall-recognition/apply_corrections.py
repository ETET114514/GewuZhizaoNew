"""Apply explicit, image-specific review corrections without retraining the detector."""
from __future__ import annotations

import argparse
from copy import deepcopy
import hashlib
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

from recognize_walls import draw_overlay


def recompute_geometry(item: dict, width: int, height: int) -> None:
    x0, y0 = item["start_px"]
    x1, y1 = item["end_px"]
    thickness = item["thickness_px"]
    if not all(isinstance(v, (int, float)) and math.isfinite(v)
               for v in (x0, y0, x1, y1, thickness)) or thickness <= 0:
        raise ValueError(f"Invalid geometry: {item['id']}")
    if y0 == y1 and x0 < x1:
        item["orientation"] = "horizontal"
        box = [x0, y0 - thickness / 2, x1, y0 + thickness / 2]
        item["length_px"] = x1 - x0
    elif x0 == x1 and y0 < y1:
        item["orientation"] = "vertical"
        box = [x0 - thickness / 2, y0, x0 + thickness / 2, y1]
        item["length_px"] = y1 - y0
    else:
        raise ValueError(f"Expected ordered, axis-aligned endpoints: {item['id']}")
    if box[0] < 0 or box[1] < 0 or box[2] > width or box[3] > height:
        raise ValueError(f"Geometry outside image: {item['id']}")
    item["bbox_px"] = box
    axis = 0 if item["orientation"] == "horizontal" else 1
    cross = 1 - axis
    previous_end = item["start_px"][axis]
    for opening in sorted(item.get("opening_hints", []), key=lambda o: o["start_px"][axis]):
        recompute_geometry(opening, width, height)
        if (opening["orientation"] != item["orientation"]
                or opening["start_px"][cross] != item["start_px"][cross]
                or opening["start_px"][axis] < previous_end
                or opening["end_px"][axis] > item["end_px"][axis]
                or opening["thickness_px"] > thickness):
            raise ValueError(f"Opening must lie on its wall and not overlap another opening: {opening['id']}")
        previous_end = opening["end_px"][axis]


def apply_corrections(base: dict, corrections: dict) -> dict:
    if base["image"]["sha256"] != corrections["image_sha256"]:
        raise ValueError("Correction file belongs to a different image.")
    if ("expected_revision" in corrections
            and base.get("review_revision") != corrections["expected_revision"]):
        raise ValueError("Apply this correction to the specified previous review revision.")
    result = deepcopy(base)
    walls = {wall["id"]: wall for wall in result["walls"]}
    width, height = result["image"]["width_px"], result["image"]["height_px"]
    for patch in corrections.get("updates", []):
        if patch["id"] not in walls:
            raise ValueError(f"Wall no longer exists: {patch['id']}")
        wall = walls[patch["id"]]
        if any(wall.get(key) != value for key, value in patch["expected"].items()):
            raise ValueError(f"Baseline changed; review wall ID before applying: {patch['id']}")
        wall.update(deepcopy(patch["geometry"]))
        wall.update(source="assisted_correction", review_status="unreviewed",
                    correction_note=patch["note"])
        recompute_geometry(wall, width, height)
    occupied = set(walls) | {item["id"] for item in result.get("boundary_candidates", [])}
    for key, target in (("add_walls", "walls"), ("add_boundaries", "boundary_candidates")):
        for addition in corrections.get(key, []):
            item = deepcopy(addition)
            if item["id"] in occupied:
                raise ValueError(f"Duplicate ID: {item['id']}")
            occupied.add(item["id"])
            item.update(source="assisted_correction", review_status="unreviewed")
            recompute_geometry(item, width, height)
            result.setdefault(target, []).append(item)
    result["schema_version"] = "0.1.2" if any(w.get("opening_hints") for w in result["walls"]) else "0.1.1"
    result["review_revision"] = corrections["revision"]
    result["review_method"] = "User feedback interpreted against the source image; geometric estimates require confirmation."
    limitation = "Boundary candidates are separate from solid walls; opening types are unconfirmed."
    if limitation not in result["limitations"]:
        result["limitations"].append(limitation)
    if result["schema_version"] == "0.1.2":
        result["geometry"]["opening_hints"] = "Wall centerlines may span openings. Exclude opening_hints from solid-wall rendering; these opening positions and types remain unconfirmed."
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image", type=Path)
    parser.add_argument("base", type=Path)
    parser.add_argument("corrections", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        base = json.loads(args.base.read_text(encoding="utf-8"))
        corrections = json.loads(args.corrections.read_text(encoding="utf-8"))
        if hashlib.sha256(args.image.read_bytes()).hexdigest() != base["image"]["sha256"]:
            raise ValueError("Source image does not match the geometry file.")
        result = apply_corrections(base, corrections)
        with Image.open(args.image) as original:
            rgba = ImageOps.exif_transpose(original).convert("RGBA")
            image = Image.alpha_composite(Image.new("RGBA", rgba.size, "white"), rgba).convert("RGB")
        if image.size != (base["image"]["width_px"], base["image"]["height_px"]):
            raise ValueError("Source image dimensions do not match the geometry file.")
        if args.base.resolve() == (args.output / "walls.json").resolve():
            raise ValueError("Use a different output directory to preserve the baseline.")
        overlay = draw_overlay(image, result["walls"], result.get("boundary_candidates"))
        try:
            font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 15)
            title = corrections.get("diagram_title", f"户型校正 · {corrections['revision']}")
            legend = "蓝：原候选    橙：按反馈修正    绿虚线：待分类边界（可能为门窗）"
        except OSError:
            font = ImageFont.load_default()
            title = f"Floor plan corrections: {corrections['revision']}"
            legend = "Blue: automatic | Orange: revised | Green dashed: unclassified boundary"
        sheet = Image.new("RGB", (image.width, image.height + 68), "white")
        sheet.paste(overlay, (0, 68))
        draw = ImageDraw.Draw(sheet)
        draw.text((16, 8), title, fill="#172b42", font=font)
        draw.text((16, 36), legend, fill="#425066", font=font)
        args.output.mkdir(parents=True, exist_ok=True)
        (args.output / "walls.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        overlay.save(args.output / "walls-overlay.png")
        sheet.save(args.output / "review.png")
    except (OSError, ValueError, KeyError, TypeError) as error:
        parser.error(str(error))
    print(f"Saved {len(result['walls'])} wall candidates and {len(result.get('boundary_candidates', []))} separate boundary candidates.")
    print(f"Review: {(args.output / 'review.png').resolve()}")


if __name__ == "__main__":
    main()
