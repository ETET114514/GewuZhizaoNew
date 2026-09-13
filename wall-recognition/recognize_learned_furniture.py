"""Local ONNX floor-plan symbol inference; never sends images to a service."""
from functools import lru_cache
from pathlib import Path
import ast

import cv2
import numpy as np
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent


def letterbox(image, size=640):
    scale = min(size / image.width, size / image.height)
    width, height = round(image.width * scale), round(image.height * scale)
    left, top = (size - width) // 2, (size - height) // 2
    canvas = np.full((size, size, 3), 114, dtype=np.uint8)
    canvas[top:top+height, left:left+width] = cv2.resize(np.asarray(image.convert('RGB')), (width, height), interpolation=cv2.INTER_LINEAR)
    tensor = np.ascontiguousarray(canvas.transpose(2, 0, 1)[None], dtype=np.float32) / 255
    return tensor, (width/image.width, height/image.height, left, top)


@lru_cache(maxsize=2)
def session(path):
    import onnxruntime as ort
    options = ort.SessionOptions()
    options.intra_op_num_threads = 4
    options.inter_op_num_threads = 1
    runner = ort.InferenceSession(str(path), sess_options=options, providers=['CPUExecutionProvider'])
    names = ast.literal_eval(runner.get_modelmeta().custom_metadata_map['names'])
    return runner, names


def predict(image, path, threshold=.3, tiled=False, cad=False):
    runner, names = session(str(Path(path).resolve()))
    crops = [(0, 0, image.width, image.height)]
    if tiled and max(image.size) > 900:
        side = round(max(image.size) * .65)
        for top in sorted({0, max(0, image.height-side)}):
            for left in sorted({0, max(0, image.width-side)}):
                crops.append((left, top, min(image.width, left+side), min(image.height, top+side)))
    proposals = []
    size = runner.get_inputs()[0].shape[-1] if hasattr(runner.get_inputs()[0], 'shape') else 640
    for region in crops:
        crop = image.crop(region)
        if cad:
            crop = Image.fromarray(np.where(np.asarray(crop.convert('L')) < 215, 255, 0).astype('uint8')).convert('RGB')
        tensor, (sx, sy, left, top) = letterbox(crop, size)
        raw = runner.run(None, {runner.get_inputs()[0].name: tensor})[0][0].T
        labels = raw[:, 4:].argmax(axis=1)
        scores = raw[np.arange(len(raw)), labels+4]
        for row, label, score in zip(raw[scores >= threshold], labels[scores >= threshold], scores[scores >= threshold]):
            cx, cy, width, height = row[:4]
            box = [max(0., (cx-width/2-left)/sx)+region[0], max(0., (cy-height/2-top)/sy)+region[1],
                   min(float(crop.width), (cx+width/2-left)/sx)+region[0], min(float(crop.height), (cy+height/2-top)/sy)+region[1]]
            if box[2] <= box[0] or box[3] <= box[1]:
                continue
            proposals.append({'label': names[int(label)], 'score': float(score), 'bbox_px': [round(float(v), 2) for v in box]})
    result = []
    for label in sorted({p['label'] for p in proposals}):
        group = [p for p in proposals if p['label'] == label]
        boxes = [[p['bbox_px'][0], p['bbox_px'][1], p['bbox_px'][2]-p['bbox_px'][0], p['bbox_px'][3]-p['bbox_px'][1]] for p in group]
        for index in cv2.dnn.NMSBoxes(boxes, [p['score'] for p in group], threshold, .45):
            result.append(group[int(index)])
    return result


# Only categories checked against source drawings are enabled. The supplied
# taxonomy mislabels several fixtures; retain the raw label as evidence. The
# separately verified bathroom branch below does not change this global map.
CLASS_MAP = {'bed': 'bed', 'sofa': 'sofa', 'table': 'table', 'chair': 'chair',
             'half_height_cabinet': 'cabinet', 'high_cabinet': 'cabinet',
             'tv_cabinet': 'cabinet', 'bedside_cupboard': 'cabinet'}


def interior_shapes(image, box):
    """Measure enclosed symbol outlines in local coordinates, independent of pose."""
    x0,y0,x1,y1 = [round(v) for v in box]
    gray = np.asarray(image.convert('L'))[max(0,y0):y1,max(0,x0):x1]
    if not gray.size:
        return []
    ink = (gray < 215).astype('uint8')
    contours, _ = cv2.findContours(ink, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    shapes = []
    for contour in contours:
        area = cv2.contourArea(contour)/gray.size
        if .08 < area < .9:
            vertices = len(cv2.approxPolyDP(contour, .02*cv2.arcLength(contour,True), True))
            shapes.append((area, vertices))
    return shapes


def bathroom_candidates(image, raw, alternate):
    """Conservative fixture recovery from two appearances plus symbol/context checks.

    This checkpoint calls several toilet symbols 'escalator' and basins 'bath'.
    These labels alone never authorize relabeling: require agreement, enclosed
    bowl geometry, and a nearby verified toilet for the other bathroom fixtures.
    """
    from recognize_furniture import overlap
    def agrees(item):
        return any(other['label']==item['label'] and other['score']>=.7 and
                   overlap(item['bbox_px'],other['bbox_px'])[0]>.65 for other in alternate)
    def rounded_inside(item):
        return any(.2 < area < .65 and 5 <= vertices <= 12
                   for area,vertices in interior_shapes(image,item['bbox_px']))
    toilets = [r for r in raw if r['label']=='escalator' and r['score']>=.85
               and agrees(r) and rounded_inside(r)]
    found = [(r,'toilet','two_views_and_enclosed_bowl') for r in toilets]
    def near_toilet(item):
        a = item['bbox_px']
        for toilet in toilets:
            b = toilet['bbox_px']
            scale = max(b[2]-b[0],b[3]-b[1])
            distance = np.hypot((a[0]+a[2]-b[0]-b[2])/2, (a[1]+a[3]-b[1]-b[3])/2)
            if distance < 2.5*scale:
                return True
        return False
    for r in raw:
        if r['label']=='bath' and r['score']>=.75 and agrees(r) and rounded_inside(r) and near_toilet(r):
            found.append((r,'vanity','two_views_enclosed_basin_near_toilet'))
    for r in alternate:
        if r['label']=='bath_tub' and r['score']>=.55 and near_toilet(r):
            if any(area>.5 and vertices==4 for area,vertices in interior_shapes(image,r['bbox_px'])):
                found.append((r,'wet_area','model_and_enclosed_zone_near_toilet_type_unconfirmed'))
    return found


def detect_learned(image):
    path = ROOT / 'models/floorcad-nano.onnx'
    if not path.exists():
        return [], 'missing_model'
    try:
        raw = predict(image, path, threshold=.55, cad=True)
        alternate = predict(ImageOps.invert(image.convert('RGB')), path, threshold=.55) if any(
            r['label']=='escalator' and r['score']>=.85 for r in raw) else []
    except ImportError:
        return [], 'missing_runtime'
    items = []
    candidates = [(r,CLASS_MAP[r['label']],None) for r in raw if r['label'] in CLASS_MAP]
    candidates.extend(bathroom_candidates(image,raw,alternate))
    for item,kind,verification in candidates:
        items.append(dict(kind=kind, bbox_px=item['bbox_px'], rotation_deg=None,
                          source='floorcad_onnx', match_score=round(item['score'],4), review_status='unreviewed',
                          evidence={'model':'floorcad-nano', 'raw_label':item['label'],
                                    **({'fixture_verification':verification} if verification else {}),
                                    'score_type':'model_score_not_calibrated_probability',
                                    'preprocessing':'binary_215_and_continuous_inverse' if verification else 'bright_strokes_215_on_black'}))
    return items, 'ready'
