"""First experiment: extract editable, axis-aligned wall candidates from a plan.

This is a classical image-processing baseline, not a trained wall detector.
All geometry is in image pixels until a real-world dimension is supplied.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps


def runs(line: np.ndarray) -> list[tuple[int, int]]:
    """Return half-open ranges containing True values."""
    edges = np.diff(np.pad(line.astype(np.int8), (1, 1)))
    return list(zip(np.flatnonzero(edges == 1).tolist(),
                    np.flatnonzero(edges == -1).tolist()))


def bridge_gaps(mask: np.ndarray, maximum: int) -> np.ndarray:
    result = mask.copy()
    for row in result:
        for start, end in runs(~row):
            if start > 0 and end < len(row) and end - start <= maximum:
                row[start:end] = True
    return result


def long_runs(mask: np.ndarray, minimum: int) -> np.ndarray:
    result = np.zeros_like(mask)
    for y, row in enumerate(mask):
        for start, end in runs(row):
            if end - start >= minimum:
                result[y, start:end] = True
    return result


def components(mask: np.ndarray) -> list[list[tuple[int, int]]]:
    remaining = mask.copy()
    height, width = mask.shape
    result = []
    for y, x in zip(*np.nonzero(mask)):
        if not remaining[y, x]:
            continue
        remaining[y, x] = False
        pending = [(int(x), int(y))]
        points = []
        while pending:
            px, py = pending.pop()
            points.append((px, py))
            for nx, ny in ((px - 1, py), (px + 1, py),
                           (px, py - 1), (px, py + 1)):
                if 0 <= nx < width and 0 <= ny < height and remaining[ny, nx]:
                    remaining[ny, nx] = False
                    pending.append((nx, ny))
        result.append(points)
    return result


def detect_walls(image: Image.Image, *, threshold: int = 180,
                 max_color_spread: int = 10, min_length: int = 35,
                 min_thickness: int = 7, max_thickness: int = 24,
                 gap: int = 1) -> list[dict]:
    rgb = np.asarray(image.convert("RGB"), dtype=np.int16)
    gray = rgb @ np.array([0.299, 0.587, 0.114])
    spread = rgb.max(axis=2) - rgb.min(axis=2)
    dark = (gray <= threshold) & (spread <= max_color_spread)
    candidates = []
    for orientation in ("horizontal", "vertical"):
        source = dark if orientation == "horizontal" else dark.T
        supported = long_runs(bridge_gaps(source, gap), min_length)
        supported = long_runs(supported.T, min_thickness).T
        for points in components(supported):
            coords = np.asarray(points)
            start, top = coords.min(axis=0)
            end, bottom = coords.max(axis=0) + 1
            length, thickness = int(end - start), int(bottom - top)
            fill = len(points) / (length * thickness)
            if (length < min_length or thickness > max_thickness
                    or length < thickness * 3 or fill < 0.65):
                continue
            center = (top + bottom) / 2
            if orientation == "horizontal":
                p1, p2 = [float(start), float(center)], [float(end), float(center)]
                box = [int(start), int(top), int(end), int(bottom)]
            else:
                p1, p2 = [float(center), float(start)], [float(center), float(end)]
                box = [int(top), int(start), int(bottom), int(end)]
            candidates.append({
                "orientation": orientation,
                "start_px": p1, "end_px": p2,
                "thickness_px": thickness,
                "length_px": length,
                "bbox_px": box,
                "source": "automatic",
                "review_status": "unreviewed",
            })
    candidates.sort(key=lambda wall: (wall["bbox_px"][1], wall["bbox_px"][0]))
    for number, wall in enumerate(candidates, 1):
        wall["id"] = f"W{number:03d}"
    return candidates


def wall_render_parts(wall: dict) -> list[dict]:
    """Split a host wall around opening hints, keeping openings out of solid fill."""
    hints = wall.get("opening_hints", [])
    if not hints:
        return [wall]
    axis = 0 if wall["orientation"] == "horizontal" else 1
    cursor = wall["start_px"][axis]
    end = wall["end_px"][axis]
    parts = []
    for hint in [*sorted(hints, key=lambda h: h["start_px"][axis]), None]:
        stop = hint["start_px"][axis] if hint else end
        if cursor < stop:
            p1, p2 = list(wall["start_px"]), list(wall["end_px"])
            p1[axis], p2[axis] = cursor, stop
            half = wall["thickness_px"] / 2
            box = ([cursor, p1[1] - half, stop, p1[1] + half] if axis == 0 else
                   [p1[0] - half, cursor, p1[0] + half, stop])
            parts.append({**wall, "start_px": p1, "end_px": p2,
                          "bbox_px": box, "length_px": stop - cursor})
        if hint:
            parts.append({**hint, "classification": "unclassified_boundary"})
            cursor = hint["end_px"][axis]
    return parts


def draw_overlay(image: Image.Image, walls: list[dict],
                 boundaries: list[dict] | None = None) -> Image.Image:
    base = image.convert("RGBA")
    layer = Image.new("RGBA", base.size)
    draw = ImageDraw.Draw(layer)
    try:
        font = ImageFont.truetype("arial.ttf", 12)
    except OSError:
        font = ImageFont.load_default()
    used_labels = []
    labels = []
    for wall in [*walls, *(boundaries or [])]:
        boundary = wall.get("classification") == "unclassified_boundary"
        revised = wall.get("source") == "assisted_correction"
        color = (0, 119, 103) if boundary else ((198, 80, 0) if revised else (0, 84, 175))
        x0, y0, x1, y1 = wall["bbox_px"]
        for part in wall_render_parts(wall):
            part_boundary = part.get("classification") == "unclassified_boundary"
            part_color = (0, 119, 103) if part_boundary else color
            bx0, by0, bx1, by1 = part["bbox_px"]
            draw.rectangle((bx0, by0, bx1 - 1, by1 - 1),
                           fill=(*part_color, 55 if part_boundary else 90),
                           outline=None if part_boundary else (*part_color, 235), width=1)
            a1, a2 = tuple(part["start_px"]), tuple(part["end_px"])
            if part_boundary:
                length = part["length_px"]
                for offset in range(0, int(length), 10):
                    a, b = offset / length, min(offset + 6, length) / length
                    segment = tuple((a1[0] + t * (a2[0] - a1[0]),
                                     a1[1] + t * (a2[1] - a1[1])) for t in (a, b))
                    draw.line(segment, fill=(*part_color, 255), width=2)
            else:
                draw.line((a1, a2), fill=(*part_color, 255), width=1)
        p1, p2 = tuple(wall["start_px"]), tuple(wall["end_px"])
        for x, y in (p1, p2):
            draw.ellipse((x - 2, y - 2, x + 2, y + 2), fill=(*color, 255))
        label = wall["id"]
        bounds = draw.textbbox((0, 0), label, font=font)
        label_width = bounds[2] - bounds[0] + 8
        label_height = bounds[3] - bounds[1] + 8
        lx = max(0, min(image.width - label_width, (x0 + x1 - label_width) / 2))
        ly = max(0, min(image.height - label_height, (y0 + y1 - label_height) / 2))
        if wall["orientation"] == "vertical" and x0 > image.width * 0.8:
            lx = min(image.width - label_width, x1 + 8)
        for _ in range(20):
            if not any(lx < bx + bw and lx + label_width > bx
                       and ly < by + bh and ly + label_height > by
                       for bx, by, bw, bh in used_labels):
                break
            ly = min(image.height - label_height, ly + label_height + 2)
        used_labels.append((lx, ly, label_width, label_height))
        labels.append((lx, ly, label_width, label_height, bounds, color, label,
                       (x0 + x1) / 2, (y0 + y1) / 2))
    # Paint labels last so later wall segments cannot obscure earlier IDs.
    for lx, ly, label_width, label_height, bounds, color, label, cx, cy in labels:
        center = (lx + label_width / 2, ly + label_height / 2)
        if abs(center[0] - cx) + abs(center[1] - cy) > 4:
            draw.line(((cx, cy), center), fill=(*color, 220), width=1)
    for lx, ly, label_width, label_height, bounds, color, label, cx, cy in labels:
        draw.rounded_rectangle((lx, ly, lx + label_width, ly + label_height),
                               radius=3, fill=(*color, 255))
        draw.text((lx + 4, ly + 4 - bounds[1]), label, font=font,
                  fill=(255, 255, 255, 255))
    return Image.alpha_composite(base, layer).convert("RGB")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image", type=Path)
    parser.add_argument("--output", type=Path, default=Path("output"))
    parser.add_argument("--threshold", type=int, default=180)
    parser.add_argument("--max-color-spread", type=int, default=10)
    parser.add_argument("--min-length", type=int, default=35)
    parser.add_argument("--min-thickness", type=int, default=7)
    parser.add_argument("--max-thickness", type=int, default=24)
    parser.add_argument("--gap", type=int, default=1)
    args = parser.parse_args()
    if not (0 <= args.threshold <= 255 and 0 <= args.max_color_spread <= 255
            and 1 <= args.min_thickness <= args.max_thickness
            and args.min_length >= 1 and 0 <= args.gap <= 3):
        parser.error("Invalid parameters: brightness/color 0..255, positive lengths, gap 0..3.")
    try:
        with Image.open(args.image) as original:
            if original.width * original.height > 16_000_000:
                parser.error("Image exceeds 16 megapixels; resize it before processing.")
            rgba = ImageOps.exif_transpose(original).convert("RGBA")
            white = Image.new("RGBA", rgba.size, "white")
            image = Image.alpha_composite(white, rgba).convert("RGB")
    except (OSError, ValueError) as error:
        parser.error(f"Cannot read image: {error}")
    settings = {key: getattr(args, key) for key in (
        "threshold", "max_color_spread", "min_length", "min_thickness",
        "max_thickness", "gap")}
    walls = detect_walls(image, **settings)
    document = {
        "schema_version": "0.1.0",
        "image": {"filename": args.image.name, "width_px": image.width,
                  "height_px": image.height,
                  "sha256": hashlib.sha256(args.image.read_bytes()).hexdigest()},
        "coordinate_system": "image pixels; origin top-left; x right; y down",
        "geometry": {
            "editable_fields": ["start_px", "end_px", "thickness_px"],
            "derived_fields": ["bbox_px", "length_px", "orientation"],
            "endpoints": "centerline at the outer extent of each candidate",
            "bbox": "left, top, right-exclusive, bottom-exclusive",
        },
        "scale_mm_per_px": None,
        "algorithm": "neutral-dark-axis-runs-v1",
        "parameters": settings,
        "limitations": ["Candidates require manual review; no measured accuracy yet.",
                        "Only horizontal/vertical dark neutral walls are supported.",
                        "Furniture can cause false positives; light walls can be missed.",
                        "No automatic window/door identification or real-world scale."],
        "walls": walls,
    }
    args.output.mkdir(parents=True, exist_ok=True)
    json_path = args.output / "walls.json"
    overlay_path = args.output / "walls-overlay.png"
    json_path.write_text(json.dumps(document, ensure_ascii=False, indent=2), encoding="utf-8")
    draw_overlay(image, walls).save(overlay_path)
    print(f"Wall candidates: {len(walls)} (all require review)")
    print(f"Geometry: {json_path.resolve()}")
    print(f"Overlay: {overlay_path.resolve()}")


if __name__ == "__main__":
    main()
