"""Local wall review app. Bind to loopback; all recognition runs in Python."""
from __future__ import annotations

import argparse
from datetime import datetime
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
import json
import math
from pathlib import Path
import secrets
import threading
from urllib.parse import unquote, urlsplit
import uuid
import webbrowser

from PIL import Image, ImageOps
from recognize_walls import detect_walls, ALGORITHM as WALL_ALGORITHM
from recognize_openings import detect_openings, ALGORITHM, LIMITATIONS
from correction_engine import apply_edit
from copy import deepcopy
from refine_walls import initialize_refinement, refresh_refinement

ROOT = Path(__file__).resolve().parent
ISSUE_TYPES = {"too_short", "too_long", "missing_corner", "position", "thickness", "false_positive", "missing_wall", "other"}
SETTINGS = dict(threshold=180, max_color_spread=10, min_length=35, min_thickness=7, max_thickness=24, gap=1, junction_max_thickness=64)
MAX_IMAGE_BYTES = 12 * 1024 * 1024


def recognize_upload(payload: bytes, filename: str) -> dict:
    if not payload or len(payload) > MAX_IMAGE_BYTES:
        raise ValueError("图片需小于 12 MB。")
    with Image.open(BytesIO(payload)) as original:
        if original.format not in {"PNG", "JPEG", "WEBP"}:
            raise ValueError("请使用 PNG、JPG 或 WebP 图片。")
        if original.width * original.height > 4_000_000:
            raise ValueError("本步支持最多 400 万像素，请先缩小图片。")
        rgba = ImageOps.exif_transpose(original).convert("RGBA")
        normalized = Image.alpha_composite(Image.new("RGBA", rgba.size, "white"), rgba).convert("RGB")
    image_file = BytesIO()
    normalized.save(image_file, format="PNG")
    png = image_file.getvalue()
    document = {
        "schema_version": "0.2.0",
        "image": {"filename": "floorplan.png", "original_filename": filename[:200],
                  "width_px": normalized.width, "height_px": normalized.height,
                  "sha256": hashlib.sha256(png).hexdigest(),
                  "original_sha256": hashlib.sha256(payload).hexdigest()},
        "coordinate_system": "image pixels; origin top-left; x right; y down",
        "scale_mm_per_px": None,
        "geometry": {"editable_fields": ["start_px", "end_px", "thickness_px"],
                     "derived_fields": ["bbox_px", "length_px", "orientation"],
                     "bbox": "left, top, right-exclusive, bottom-exclusive"},
        "algorithm": WALL_ALGORITHM, "parameters": SETTINGS,
        "opening_algorithm": ALGORITHM,
        "opening_basis": "source_image; independent of subsequent wall edits",
        "limitations": ["自动结果需校核；尺寸单位为像素。", *LIMITATIONS],
        "walls": detect_walls(normalized, **SETTINGS),
    }
    document["openings"] = detect_openings(normalized, document["walls"])
    document = initialize_refinement(document, normalized)
    reserved = [*document["opening_wall_ids"].values(), *(w["id"] for w in document["walls"])]
    return {"document": document, "png": png, "history": [], "changes": [],
            "next_id": max((int(identifier[1:]) for identifier in reserved), default=0)+1}


def validate_feedback(document: dict, issues: list) -> list[dict]:
    if not isinstance(issues, list) or not 1 <= len(issues) <= 200:
        raise ValueError("请先标记问题，最多支持 200 条。")
    walls = {wall["id"]: wall for wall in document["walls"]}
    checked, ids = [], set()
    width, height = document["image"]["width_px"], document["image"]["height_px"]
    for issue in issues:
        if not isinstance(issue, dict):
            raise ValueError("问题格式不正确。")
        identifier, category = issue.get("id"), issue.get("type")
        if not isinstance(identifier, str) or identifier in ids or len(identifier) > 32 or category not in ISSUE_TYPES:
            raise ValueError("问题编号或类型不正确。")
        ids.add(identifier)
        note, direction, target = issue.get("note", ""), issue.get("direction", ""), issue.get("target_wall_id", "")
        if not isinstance(note, str) or len(note) > 1000 or direction not in ("", "up", "down", "left", "right"):
            raise ValueError("问题说明或方向不正确。")
        if target and target not in walls:
            raise ValueError("连接目标不在本次识别结果中。")
        item = dict(id=identifier, type=category, direction=direction, target_wall_id=target, note=note)
        if issue.get("wall_id"):
            wall_id = issue["wall_id"]
            if wall_id not in walls or category == "missing_wall" or identifier != wall_id:
                raise ValueError("墙段编号已变化，请重新选择。")
            item.update(wall_id=wall_id, expected_geometry={key: walls[wall_id][key] for key in ("start_px", "end_px", "thickness_px")})
        else:
            box = issue.get("region_px")
            if (category != "missing_wall" or not isinstance(box, list) or len(box) != 4
                    or not all(isinstance(v, (float, int)) and math.isfinite(v) for v in box)
                    or not (0 <= box[0] < box[2] <= width and 0 <= box[1] < box[3] <= height)):
                raise ValueError("漏识别区域超出图片或尺寸不正确。")
            item["region_px"] = box
        checked.append(item)
    return checked


class ReviewServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, feedback_root: Path = ROOT / "feedback"):
        super().__init__(address, ReviewHandler)
        self.token = secrets.token_urlsafe(32)
        self.sessions = {}
        self.state_lock = threading.Lock()
        self.detect_lock = threading.Lock()
        self.feedback_root = feedback_root


class ReviewHandler(BaseHTTPRequestHandler):
    server: ReviewServer

    def log_message(self, format, *args):
        pass

    def send_bytes(self, status, data, content_type):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'self'")
        self.end_headers()
        self.wfile.write(data)

    def send_json(self, status, data):
        self.send_bytes(status, json.dumps(data, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")

    def do_GET(self):
        route = urlsplit(self.path).path
        pages = {"/": ("index.html", "text/html; charset=utf-8"), "/app.css": ("app.css", "text/css; charset=utf-8"), "/app.js": ("app.js", "text/javascript; charset=utf-8")}
        if route in pages:
            filename, content_type = pages[route]
            self.send_bytes(200, (ROOT / "web" / filename).read_bytes(), content_type)
        elif route == "/api/config":
            self.send_json(200, {"token": self.server.token})
        elif route == "/api/sample-image":
            self.send_bytes(200, (ROOT / "input/floorplan.png").read_bytes(), "image/png")
        elif route.startswith("/api/runs/") and route.endswith("/image"):
            with self.server.state_lock:
                run = self.server.sessions.get(route.split("/")[3])
            if run:
                self.send_bytes(200, run["png"], "image/png")
            else:
                self.send_json(404, {"error": "这份识别结果已过期，请重新识别。"})
        else:
            self.send_json(404, {"error": "页面不存在。"})

    def do_POST(self):
        port = self.server.server_address[1]
        allowed = {f"http://127.0.0.1:{port}", f"http://localhost:{port}"}
        if (self.headers.get("X-Wall-Token") != self.server.token
                or self.headers.get("Origin", next(iter(allowed))) not in allowed):
            self.send_json(403, {"error": "请从本地页面发起操作。"})
            return
        route = urlsplit(self.path).path
        try:
            length = int(self.headers.get("Content-Length", "0"))
            limit = MAX_IMAGE_BYTES if route == "/api/detect" else 1024 * 1024
            if not 0 < length <= limit:
                raise ValueError("文件或反馈大小超出限制。")
            payload = self.rfile.read(length)
            if route == "/api/detect":
                if not self.server.detect_lock.acquire(blocking=False):
                    self.send_json(409, {"error": "正在处理另一张图片，请稍后重试。"})
                    return
                try:
                    run = recognize_upload(payload, unquote(self.headers.get("X-Image-Name", "floorplan.png")))
                    run_id = uuid.uuid4().hex
                    with self.server.state_lock:
                        if len(self.server.sessions) >= 8:
                            self.server.sessions.pop(next(iter(self.server.sessions)))
                        self.server.sessions[run_id] = run
                    self.send_json(200, {"run_id": run_id, "document": run["document"], "image_url": f"/api/runs/{run_id}/image"})
                finally:
                    self.server.detect_lock.release()
            elif route in ("/api/apply-edit", "/api/undo-edit", "/api/save-project", "/api/review-opening"):
                request = json.loads(payload)
                if not isinstance(request, dict) or not isinstance(request.get("run_id"), str):
                    raise ValueError("操作格式不正确。")
                with self.server.state_lock:
                    run = self.server.sessions.get(request["run_id"])
                    if run is None:
                        raise ValueError("识别结果已过期，请重新识别。")
                    if route == "/api/review-opening":
                        kind=request.get("kind")
                        if kind not in ("window","door","unclassified","rejected"):
                            raise ValueError("请选择门、窗、待定或误报。")
                        document=deepcopy(run["document"])
                        opening=next((o for o in document.get("openings",[]) if o["id"]==request.get("opening_id")),None)
                        if opening is None:
                            raise ValueError("门窗编号不存在，请重新选择。")
                        opening.setdefault("predicted_kind",opening["kind"])
                        opening.update(kind=kind, review_status="rejected" if kind=="rejected" else "unreviewed" if kind=="unclassified" else "confirmed")
                        if kind == "unclassified":
                            opening["requires_confirmation"] = True
                        labels={"window":"窗","door":"门","unclassified":"待定门窗","rejected":"误报"}
                        opening["label"]=labels[kind]
                        document=refresh_refinement(document)
                        run["history"].append((run["document"],list(run["changes"]),run["next_id"]))
                        run["history"]=run["history"][-50:]
                        run["document"]=document
                        run["changes"].append({"id":opening["id"],"opening_id":opening["id"],"type":"opening_review",
                                               "summary":f"{opening['id']} 已标为{labels[kind]}"})
                    elif route == "/api/apply-edit":
                        document, record, next_id = apply_edit(run["document"], request, run["next_id"])
                        run["history"].append((run["document"], list(run["changes"]), run["next_id"]))
                        run["history"] = run["history"][-50:]
                        run["document"], run["next_id"] = document, next_id
                        run["changes"].append(record)
                    elif route == "/api/undo-edit":
                        if not run["history"]:
                            raise ValueError("没有可撤销的修改。")
                        run["document"], run["changes"], run["next_id"] = run["history"].pop()
                    else:
                        name = datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6]
                        destination = self.server.feedback_root.parent / "projects" / name
                        destination.mkdir(parents=True, exist_ok=False)
                        (destination / "floorplan.png").write_bytes(run["png"])
                        for filename, data in (("walls.json", run["document"]), ("changes.json", run["changes"])):
                            (destination / filename).write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
                        (destination / "solid-walls.json").write_text(json.dumps({
                            "image": run["document"]["image"], "scale_mm_per_px": None,
                            "coordinate_system": run["document"]["coordinate_system"],
                            "solid_wall_segments": run["document"].get("solid_wall_segments", [])
                        }, ensure_ascii=False, indent=2), encoding="utf-8")
                        self.send_json(200, {"saved_name": name, "count": len(run["document"]["walls"]),
                                             "solid_count": len(run["document"].get("solid_wall_segments", [])),
                                             "opening_count": run["document"].get("refinement_summary", {}).get("active_opening_count", 0)})
                        return
                    response = {"document": run["document"], "changes": run["changes"], "history_size": len(run["history"])}
                self.send_json(200, response)
            elif route == "/api/save-feedback":
                request = json.loads(payload)
                if not isinstance(request, dict) or not isinstance(request.get("run_id"), str):
                    raise ValueError("反馈格式不正确。")
                with self.server.state_lock:
                    run = self.server.sessions.get(request.get("run_id"))
                if run is None:
                    raise ValueError("识别结果已过期，请重新识别。")
                issues = validate_feedback(run["document"], request.get("issues"))
                name = datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6]
                destination = self.server.feedback_root / name
                destination.mkdir(parents=True, exist_ok=False)
                report = {"schema_version": "0.1.0", "image_sha256": run["document"]["image"]["sha256"],
                          "run_id": request["run_id"], "created_at": datetime.now().astimezone().isoformat(),
                          "status": "submitted_for_correction", "issues": issues}
                (destination / "floorplan.png").write_bytes(run["png"])
                for filename, content in (("walls.json", run["document"]), ("feedback.json", report)):
                    (destination / filename).write_text(json.dumps(content, ensure_ascii=False, indent=2), encoding="utf-8")
                self.send_json(200, {"saved_name": name, "count": len(issues)})
            else:
                self.send_json(404, {"error": "操作不存在。"})
        except ValueError as error:
            self.send_json(400, {"error": str(error)})
        except (TypeError, KeyError, Image.DecompressionBombError):
            self.send_json(400, {"error": "图片或反馈无效，请检查文件、墙段编号与区域范围。"})
        except OSError:
            self.send_json(400, {"error": "无法读取图片或保存文件，请检查格式及本地磁盘空间。"})


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--open-browser", action="store_true")
    args = parser.parse_args()
    try:
        server = ReviewServer(("127.0.0.1", args.port))
    except OSError as error:
        raise SystemExit(f"无法启动本地页面（端口 {args.port} 可能已被占用）：{error}")
    print(f"Local: http://127.0.0.1:{server.server_address[1]}", flush=True)
    print("Press Ctrl+C to stop.", flush=True)
    if args.open_browser:
        threading.Timer(0.5, lambda: webbrowser.open(f"http://127.0.0.1:{server.server_address[1]}/")).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
