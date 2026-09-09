"""Repeatable visual and point checks for the six user-provided reference plans.

Points are selected review landmarks, not a complete segmentation ground truth.
Related annotated/raw/furnished versions are one group, not independent samples.
"""
from pathlib import Path
import json
from PIL import Image, ImageDraw, ImageFont

from recognize_walls import detect_walls
from recognize_openings import detect_openings
from refine_walls import initialize_refinement, is_active_opening

ROOT = Path(__file__).resolve().parent
FIXTURES = ROOT / "input/reference-plans"


def contains(items, point):
    x,y = point
    return any(w["bbox_px"][0] <= x < w["bbox_px"][2]
               and w["bbox_px"][1] <= y < w["bbox_px"][3] for w in items)


def recognize(image, outlined=True):
    walls = detect_walls(image, include_outlined=outlined)
    return initialize_refinement(dict(image={"width_px":image.width,"height_px":image.height},
        walls=walls,openings=detect_openings(image,walls)),image)


def panel(image, doc):
    base = image.convert("RGBA")
    layer = Image.new("RGBA",image.size)
    draw = ImageDraw.Draw(layer)
    hosts = {w["id"]:w for w in doc["walls"]}
    for wall in doc["solid_wall_segments"]:
        color = (223,116,32) if hosts[wall["host_wall_id"]]["source"] == "automatic_paired_outline" else (36,94,187)
        x0,y0,x1,y1 = wall["bbox_px"]
        draw.rectangle((x0,y0,x1-1,y1-1),fill=(*color,105),outline=(*color,235),width=2)
    for opening in doc["openings"]:
        color = (4,131,133) if is_active_opening(opening) else (117,91,141)
        draw.line((tuple(opening["start_px"]),tuple(opening["end_px"])),fill=(*color,255),width=3)
    return Image.alpha_composite(base,layer).convert("RGB")


def main():
    output = ROOT/"output/reference-v2"
    output.mkdir(parents=True,exist_ok=True)
    cases = json.loads((FIXTURES/"landmarks.json").read_text(encoding="utf-8"))
    font = ImageFont.truetype("msyh.ttc",22)
    report = []
    for case in cases:
        image = Image.open(FIXTURES/case["file"]).convert("RGB")
        before, after = recognize(image,False), recognize(image)
        tests = {}
        for label,key,positive in [("wall_landmarks","walls",True),("nonwall_landmarks","nonwalls",False)]:
            points = case.get(key,[])
            tests[label] = dict(total=len(points),
                before=sum(contains(before["solid_wall_segments"],p)==positive for p in points),
                after=sum(contains(after["solid_wall_segments"],p)==positive for p in points),
                failed_after=[p for p in points if contains(after["solid_wall_segments"],p)!=positive])
        row = dict(file=case["file"],group=case["group"],checks=tests,
                   before=before["refinement_summary"],after=after["refinement_summary"])
        report.append(row)
        stem = Path(case["file"]).stem
        (output/f"{stem}.json").write_text(json.dumps(after,ensure_ascii=False,indent=2),encoding="utf-8")
        # The comparison baseline disables only the new wall branch. Its
        # opening stage uses current rules, explicitly avoiding a false v1 claim.
        panels = [image,panel(image,before),panel(image,after)]
        thumbs = []
        for p in panels:
            p.thumbnail((560,690))
            thumbs.append(p)
        canvas = Image.new("RGB",(1740,790),"#f4f6f9")
        draw = ImageDraw.Draw(canvas)
        for i,(p,title) in enumerate(zip(thumbs,("原图","仅实心墙分支","实心墙 + 双线墙"))):
            left = 20+i*580
            draw.text((left,14),title,font=font,fill="#203049")
            canvas.paste(p,(left,58))
        draw.text((20,753),"蓝：原实墙   橙：双线墙   青：洞口候选   紫：边界待确认（不扣墙）",font=font,fill="#425168")
        canvas.save(output/f"{stem}-comparison.png")
        print(json.dumps(row,ensure_ascii=True),flush=True)
    (output/"metrics.json").write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")


if __name__ == "__main__":
    main()
