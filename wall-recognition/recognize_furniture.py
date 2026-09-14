"""Local furniture and fixture candidates from explicit symbols, not trained weights.

Coordinates are half-open image pixel boxes. Matching scores are similarities,
not probabilities. Reference sheet crops never contain category captions.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
from functools import lru_cache
import json
import math
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parent
ALGORITHM = "furniture-symbol-match-v4"
LABELS = {"bed": "床", "sofa": "沙发", "cabinet": "柜子", "table": "桌子", "chair": "椅子", "unclassified": "待定家具",
          "coffee_table": "茶几", "dining_table": "餐桌", "shoe_cabinet": "鞋柜", "tv_console": "电视柜",
          "kitchen_cabinet": "厨房柜台", "kitchen_sink": "水槽", "cooktop": "灶台", "refrigerator": "冰箱",
          "vanity": "浴室柜", "toilet": "马桶", "wet_area": "洗浴区待确认",
          "bathtub": "浴缸", "shower": "淋浴间"}
DIRECTIONAL_KINDS = {"bed", "sofa"}
PENDING_KINDS = {"unclassified", "wet_area"}
COLORS = {"bed": "#a12bba", "sofa": "#19854c", "cabinet": "#b76a12",
          "shoe_cabinet": "#b76a12", "tv_console": "#b76a12", "kitchen_cabinet": "#b76a12",
          "coffee_table": "#3264b5", "dining_table": "#3264b5", "wet_area": "#737080"}
LIMITATIONS = ["家具和设施按收录图例匹配；画法不同、遮挡和低清图片可能漏检或误检。",
              "洗浴区不自动判断浴缸或淋浴间，需人工确认；鞋柜等用途来自参考图标注，不推断房间功能。",
              "家具匹配分数不是置信概率；朝向为图例推测，需校核。",
              "家具尺寸为像素，不推断单人/双人、真实尺寸或家具型号。"]


def ink_image(image):
    """Local contrast retains light CAD strokes and ignores flat colored rooms."""
    gray = np.asarray(image.convert("L"))
    background = cv2.morphologyEx(gray, cv2.MORPH_CLOSE, np.ones((13, 13), np.uint8))
    contrast = background.astype(np.int16) - gray.astype(np.int16)
    return ((contrast > 14) | (gray < 90)).astype(np.float32)


@lru_cache(maxsize=1)
def templates():
    folder = ROOT / "input/furniture-references"
    specs = json.loads((folder / "templates.json").read_text(encoding="utf-8"))
    result, sources, grayscale = [], {}, {}
    for spec in specs:
        if spec["image"] not in sources:
            with Image.open(folder / spec["image"]) as source:
                sources[spec["image"]] = ink_image(source)
                grayscale[spec["image"]] = np.asarray(source.convert('L'))
        # Process before cropping so border contrast agrees with the search image.
        x0, y0, x1, y1 = spec["bbox_px"]
        crop = sources[spec["image"]][y0:y1, x0:x1]
        upright = np.ascontiguousarray(np.rot90(crop, spec.get("head_rotation_deg", 0)//90))
        if "object_bbox_px" in spec:
            raw = grayscale[spec["image"]]
            left, top = max(0,x0-16), max(0,y0-16)
            spec = {**spec, "_raw_context": raw[top:y1+16, left:x1+16].copy(),
                    "_padding": (x0-left,y0-top)}
        result.append((spec, upright))
    return result


def resize_template(spec, base, width, height):
    if "_raw_context" not in spec:
        return cv2.resize(base, (width,height), interpolation=cv2.INTER_AREA)
    # Resize appearance before thresholding. Resizing binary ink instead makes
    # dense stove/counter strokes diverge from an uploaded resized photograph.
    turns = spec.get("head_rotation_deg",0)//90
    w,h = (height,width) if turns%2 else (width,height)
    x0,y0,x1,y1 = spec["bbox_px"]
    sx,sy = w/(x1-x0),h/(y1-y0)
    px,py = spec["_padding"]
    halo = 16
    transform = np.array([[sx,0,halo-px*sx],[0,sy,halo-py*sy]],dtype=np.float32)
    raw = cv2.warpAffine(spec["_raw_context"],transform,(w+2*halo,h+2*halo),
                         flags=cv2.INTER_CUBIC,borderMode=cv2.BORDER_REPLICATE)
    ink = ink_image(Image.fromarray(raw))[halo:halo+h,halo:halo+w]
    return np.ascontiguousarray(np.rot90(ink,turns))


def overlap(a, b):
    intersection = max(0, min(a[2], b[2])-max(a[0], b[0])) * max(0, min(a[3], b[3])-max(a[1], b[1]))
    aa, bb = (a[2]-a[0])*(a[3]-a[1]), (b[2]-b[0])*(b[3]-b[1])
    return intersection / max(1, aa+bb-intersection), intersection / max(1, min(aa, bb))


def object_box(spec, mirrored, turn):
    """Map an inner object through the same rotations/mirror as its context crop."""
    x0, y0, x1, y1 = spec["bbox_px"]
    a, b, c, d = spec.get("object_bbox_px", spec["bbox_px"])
    points = [((x-x0)/(x1-x0), (y-y0)/(y1-y0)) for x,y in ((a,b),(c,b),(c,d),(a,d))]
    for _ in range(spec.get("head_rotation_deg", 0)//90):
        points = [(y,1-x) for x,y in points]
    if mirrored:
        points = [(1-x,y) for x,y in points]
    for _ in range(turn):
        points = [(1-y,x) for x,y in points]
    xs, ys = zip(*points)
    return min(xs), min(ys), max(xs), max(ys)


def conflicting_candidates(a, b):
    iou, contained = overlap(a["bbox_px"], b["bbox_px"])
    # A sink or hob can be embedded in a counter: both are useful editable objects.
    kinds = {a["kind"], b["kind"]}
    if "kitchen_cabinet" in kinds and kinds & {"kitchen_sink", "cooktop"}:
        return False
    return iou > .25 or contained > .60


def geometry(item):
    x0, y0, x1, y1 = item["bbox_px"]
    item.update(center_px=[round((x0+x1)/2, 2), round((y0+y1)/2, 2)],
                size_px=[round(x1-x0, 2), round(y1-y0, 2)], label=LABELS[item["kind"]])
    return item


def template_peaks(blurred, coarse, integral, needle, threshold, density_limit, stride):
    """Locate on a reduced grid, then verify nearby positions at full resolution."""
    th,tw=needle.shape
    height,width=blurred.shape
    scores=cv2.matchTemplate(coarse,np.ascontiguousarray(needle[::stride,::stride]),cv2.TM_CCOEFF_NORMED)
    rows,cols=(height-th)//stride+1,(width-tw)//stride+1
    scores=scores[:rows,:cols].copy()
    density=(integral[th:height+1:stride,tw:width+1:stride]-integral[:height-th+1:stride,tw:width+1:stride]-
             integral[th:height+1:stride,:width-tw+1:stride]+integral[:height-th+1:stride,:width-tw+1:stride])/(th*tw)
    scores[(density<.025)|(density>density_limit)|~np.isfinite(scores)]=-1
    peaks=[]
    for _ in range(4 if stride==1 else 10):
        _,score,_,(cx,cy)=cv2.minMaxLoc(scores)
        if score < threshold-(.20 if stride>1 else 0):break
        scores[max(0,cy-th//(2*stride)):cy+th//(2*stride)+1,
               max(0,cx-tw//(2*stride)):cx+tw//(2*stride)+1]=-1
        x,y=cx*stride,cy*stride
        if stride>1:
            left,top=max(0,x-stride),max(0,y-stride)
            right,bottom=min(width-tw,x+stride),min(height-th,y+stride)
            local=cv2.matchTemplate(blurred[top:bottom+th,left:right+tw],needle,cv2.TM_CCOEFF_NORMED)
            amounts=(integral[top+th:bottom+th+1,left+tw:right+tw+1]-integral[top:bottom+1,left+tw:right+tw+1]-
                     integral[top+th:bottom+th+1,left:right+1]+integral[top:bottom+1,left:right+1])/(th*tw)
            local[(amounts<.025)|(amounts>density_limit)|~np.isfinite(local)]=-1
            _,score,_,(dx,dy)=cv2.minMaxLoc(local)
            x,y=left+dx,top+dy
        if score>=threshold:peaks.append((score,x,y))
    return sorted(peaks,reverse=True)[:4]


def detect_furniture(image: Image.Image, *, search_stride=3) -> list[dict]:
    # Bound runtime/memory for the four-megapixel upload limit. Search scales are
    # relative to the image, with no target-image paths or fixed output positions.
    factor = min(1.0, 1000 / max(image.size))
    small = image.resize((max(1, round(image.width*factor)), max(1, round(image.height*factor))))
    ink = ink_image(small)
    if min(ink.shape) < 28 or ink.sum() < 30:
        return []
    blurred = cv2.GaussianBlur(ink, (7, 7), 1.3)
    coarse = np.ascontiguousarray(blurred[::search_stride,::search_stride])
    integral = cv2.integral(ink)
    proposals = []
    max_size = min(330, min(ink.shape)*.65)
    sizes = np.geomspace(28, max_size, max(1, int(math.log(max_size/28)/math.log(1.06))+1)) if max_size >= 28 else []
    for spec, base in templates():
        # Rendered upholstery and hanging-clothes symbols contain denser strokes
        # than CAD outlines. Derive their bound from the reference, capped below solid.
        max_density = min(.72, max(.42, float(base.mean()) + .13))
        for size in sizes:
            h, w = base.shape
            w, h = max(8, round(w*size/max(base.shape))), max(8, round(h*size/max(base.shape)))
            min_side = spec.get("minimum_short_side", 40 if spec["kind"] == "bed" else 22 if spec["kind"] == "cabinet" else 28)
            if min(w, h) < min_side:
                continue  # At smaller sizes blur erases pillows/seats into plain stripes.
            resized = resize_template(spec,base,w,h)
            density_limit = min(.88,max(.42,float(resized.mean())+.10)) if "_raw_context" in spec else max_density
            template = cv2.GaussianBlur(resized, (7, 7), 1.3)
            for mirrored in (False, True):
                flipped = np.fliplr(template) if mirrored else template
                for turn in range(4):
                    needle = np.ascontiguousarray(np.rot90(flipped, -turn))
                    th, tw = needle.shape
                    if th >= ink.shape[0] or tw >= ink.shape[1]:
                        continue
                    minimum_score = spec.get("minimum_score", .86 if spec["kind"] == "bed" else .78)
                    threshold=spec.get("supported_minimum_score",minimum_score)
                    for score,x,y in template_peaks(blurred,coarse,integral,needle,threshold,density_limit,search_stride):
                        patch = ink[y:y+th, x:x+tw]
                        # Thick solid regions and almost empty outlines are not furniture.
                        if not .025 < float(patch.mean()) < density_limit:
                            continue
                        # Blurred outlines alone can turn a coffee table into a
                        # single-seat sofa. Verify the less-smoothed local strokes.
                        detail = np.ascontiguousarray(np.rot90(np.fliplr(resized) if mirrored else resized, -turn))
                        detail_score = float(cv2.matchTemplate(patch, detail, cv2.TM_CCOEFF_NORMED)[0, 0])
                        minimum_detail = .55 if spec["kind"] == "sofa" and min(th, tw) < 34 else .35
                        if not math.isfinite(detail_score) or detail_score < spec.get("minimum_detail_score", minimum_detail):
                            continue
                        a,b,c,d = object_box(spec, mirrored, turn)
                        proposals.append(dict(kind=spec["kind"],
                            bbox_px=[round((x+a*tw)/factor, 2), round((y+b*th)/factor, 2),
                                     min(image.width, round((x+c*tw)/factor, 2)), min(image.height, round((y+d*th)/factor, 2))],
                            rotation_deg=turn*90 if spec["kind"] in DIRECTIONAL_KINDS else None, match_score=round(float(score), 4),
                            source="symbol_template", review_status="unreviewed",
                            evidence={"template_id": spec["id"], "mirrored": mirrored,
                                      "detail_score": round(detail_score, 4),
                                      **({"requires_container": spec["support_kind"]} if score < minimum_score else {}),
                                      "score_type": "normalized_correlation_not_probability"}))
    supported = []
    for item in proposals:
        required = item["evidence"].get("requires_container")
        if required:
            a = item["bbox_px"]
            area = (a[2]-a[0])*(a[3]-a[1])
            if not any(parent["kind"] == required and
                       (parent["bbox_px"][2]-parent["bbox_px"][0])*(parent["bbox_px"][3]-parent["bbox_px"][1]) > area and
                       overlap(a,parent["bbox_px"])[1] >= .8 for parent in proposals):
                continue
        supported.append(item)
    kept = []
    for item in sorted(supported, key=lambda c: -c["match_score"]):
        if any(conflicting_candidates(item, old) for old in kept):
            continue
        kept.append(item)
        if len(kept) >= 100:
            break
    kept.sort(key=lambda c: (c["bbox_px"][1], c["bbox_px"][0]))
    return [geometry(dict(item, id=f"F{i:03d}")) for i, item in enumerate(kept, 1)]


def add_furniture(document, image):
    from recognize_learned_furniture import detect_learned
    items = detect_furniture(image)
    learned, status = detect_learned(image)
    # Keep explicit calibrated symbols when both engines describe the same
    # object. Correlation and model scores cannot be ranked against each other.
    for candidate in sorted(learned, key=lambda f: -f['match_score']):
        if not any(conflicting_candidates(candidate, old) for old in items):
            items.append(candidate)
    items.sort(key=lambda f: (f['bbox_px'][1], f['bbox_px'][0]))
    items = [geometry(dict(f, id=f'F{i:03d}')) for i,f in enumerate(items,1)]
    document.update(furniture=items, furniture_algorithm=ALGORITHM+'+floorcad-onnx-v3',
                    furniture_model_status=status,
                    furniture_basis="source_image; independent of wall and opening edits")
    document.setdefault("limitations", []).extend(LIMITATIONS)
    document['limitations'].append('线稿模型输出家具候选；卫浴补检结合两种图像处理、内部轮廓和邻近马桶校验，仍可能漏检或误检。洗浴区类型待人工确认。')
    if status != 'ready':
        document['limitations'].append('跨图家具模型未加载：请安装 ONNX Runtime 并运行模型安装脚本；当前仅使用图例匹配。')
    return document


def apply_furniture_edit(document, request):
    """Copy-on-write keeps invalid edits atomic and shares the existing undo stack."""
    action = request.get("action")
    if action not in {"add", "update", "reject"}:
        raise ValueError("请选择补家具、修改或排除。")
    result = deepcopy(document)
    items = result.setdefault("furniture", [])
    if action == "add":
        number = max((int(f["id"][1:]) for f in items), default=0)+1
        item = {"id": f"F{number:03d}", "source": "manual", "match_score": None,
                "evidence": {}, "kind": request.get("kind", "unclassified")}
        items.append(item)
    else:
        item = next((f for f in items if f["id"] == request.get("furniture_id")), None)
        if item is None:
            raise ValueError("家具编号不存在，请重新选择。")
    if action == "reject":
        item["review_status"] = "rejected"
        summary = f"{item['id']} 已排除"
    else:
        kind = request.get("kind", item["kind"])
        if kind not in LABELS:
            raise ValueError("请选择支持的家具或设施类别。")
        box = request.get("bbox_px", item.get("bbox_px"))
        width, height = result["image"]["width_px"], result["image"]["height_px"]
        if (not isinstance(box, list) or len(box) != 4 or
                not all(type(v) in (int, float) and math.isfinite(v) for v in box) or
                not (0 <= box[0] < box[2] <= width and 0 <= box[1] < box[3] <= height)):
            raise ValueError("家具框需在图片内，且宽、高大于零。")
        rotation = request.get("rotation_deg", item.get("rotation_deg"))
        if rotation is not None and (type(rotation) not in (int, float) or rotation not in (0,90,180,270)):
            raise ValueError("朝向需为未知或 0、90、180、270 度。")
        if kind not in DIRECTIONAL_KINDS:
            rotation = None
        if item.get("source") in {"symbol_template", "floorcad_onnx"}:
            item.setdefault("prediction", {key: deepcopy(item.get(key)) for key in ("kind", "bbox_px", "rotation_deg", "match_score")})
        item.update(kind=kind, bbox_px=list(box), rotation_deg=rotation,
                    review_status="unreviewed" if kind in PENDING_KINDS else "confirmed")
        geometry(item)
        summary = f"{item['id']} 已{'补入' if action == 'add' else '更新'}为{item['label']}"
    return result, dict(id=item["id"], furniture_id=item["id"], type="furniture_edit", summary=summary)


def furniture_export(document):
    return {key: document.get(key) for key in ("image", "coordinate_system", "scale_mm_per_px",
                                              "furniture_algorithm", "furniture_basis", "furniture")}


def draw_furniture(image, items):
    result = image.convert("RGB").copy()
    draw = ImageDraw.Draw(result)
    font_path = Path("C:/Windows/Fonts/msyh.ttc")
    font = ImageFont.truetype(str(font_path), max(12, round(image.width/80))) if font_path.exists() else ImageFont.load_default()
    for item in items:
        if item["review_status"] == "rejected":
            continue
        color = COLORS.get(item["kind"], "#168187")
        x0, y0, x1, y1 = item["bbox_px"]
        draw.rectangle((x0,y0,x1-1,y1-1), outline=color, width=3)
        label = f"{item['id']} {item['label'] if font_path.exists() else item['kind']}"
        box = draw.textbbox((x0,max(0,y0-23)),label,font=font)
        draw.rectangle(box, fill="white")
        draw.text((x0,max(0,y0-23)),label,font=font,fill=color)
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image", type=Path)
    parser.add_argument("--output", type=Path, default=ROOT / "output/fixtures-v1")
    args = parser.parse_args()
    with Image.open(args.image) as source:
        rgba = ImageOps.exif_transpose(source).convert("RGBA")
        image = Image.alpha_composite(Image.new("RGBA", rgba.size, "white"), rgba).convert("RGB")
    items = detect_furniture(image)
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "furniture.json").write_text(json.dumps({"algorithm": ALGORITHM, "furniture": items,
        "image": {"filename": args.image.name, "width_px": image.width, "height_px": image.height},
        "limitations": LIMITATIONS},ensure_ascii=False,indent=2),encoding="utf-8")
    draw_furniture(image, items).save(args.output / "furniture-overlay.png")
    print(json.dumps(items,ensure_ascii=False))
