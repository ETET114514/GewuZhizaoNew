"""Reopen local project snapshots without rerunning recognition or changing geometry."""
import hashlib
from io import BytesIO
import json
import math
from pathlib import Path
import re

from PIL import Image


def project_directory(root, name):
    if not isinstance(name, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', name):
        raise ValueError('项目编号不正确。')
    root = Path(root).resolve()
    directory = (root / name).resolve()
    if directory.parent != root or not directory.is_dir():
        raise ValueError('项目不存在或已被移动，请刷新列表。')
    return directory


def read_file(directory, name, limit):
    path = directory / name
    if path.resolve().parent != directory or not path.is_file():
        raise ValueError(f'项目缺少有效的 {name}。')
    if path.stat().st_size > limit:
        raise ValueError(f'项目文件 {name} 过大。')
    return path.read_bytes()


def read_json(directory, name):
    def reject_constant(value):
        raise ValueError('项目包含无效数字。')
    try:
        return json.loads(read_file(directory, name, 16 * 1024 * 1024), parse_constant=reject_constant)
    except (UnicodeError, json.JSONDecodeError, RecursionError) as error:
        raise ValueError(f'项目文件 {name} 无法解析。') from error


def validate_document(doc):
    if not isinstance(doc, dict) or doc.get('schema_version') != '0.3.0':
        raise ValueError('目前支持 0.3.0 项目；这份早期或未知版本暂不支持恢复。')
    image = doc.get('image')
    if not isinstance(image, dict):
        raise ValueError('项目缺少图片信息。')
    dimensions = [image.get('width_px'), image.get('height_px')]
    if any(type(n) is not int or n <= 0 for n in dimensions) or dimensions[0]*dimensions[1] > 4_000_000:
        raise ValueError('项目图片尺寸不正确。')
    if not isinstance(image.get('sha256'), str) or not re.fullmatch('[0-9a-f]{64}', image['sha256']):
        raise ValueError('项目缺少有效的图片校验信息。')
    def numbers(values, size):
        return isinstance(values, list) and len(values) == size and all(
            type(v) in (int, float) and math.isfinite(v) for v in values)
    doc.setdefault('furniture', [])  # Older 0.3 projects predate furniture recognition.
    for key in ('walls', 'openings', 'furniture'):
        values = doc.get(key)
        if not isinstance(values, list) or len(values) > 10000:
            raise ValueError(f'项目的 {key} 数据不正确。')
        ids = set()
        for item in values:
            if (not isinstance(item, dict) or not isinstance(item.get('id'), str)
                    or item['id'] in ids or not numbers(item.get('bbox_px'), 4)):
                raise ValueError(f'项目的 {key} 编号或坐标不正确。')
            ids.add(item['id'])
            if key == 'walls' and (not numbers(item.get('start_px'), 2)
                    or not numbers(item.get('end_px'), 2)
                    or type(item.get('thickness_px')) not in (float, int)
                    or not math.isfinite(item['thickness_px']) or item['thickness_px'] <= 0):
                raise ValueError('项目墙段几何不正确。')
    scale = doc.get('scale_mm_per_px')
    if scale is not None and (type(scale) not in (int, float) or not math.isfinite(scale) or scale <= 0):
        raise ValueError('项目比例不正确。')
    if 'room_partition' in doc:
        partition = doc['room_partition']
        if not isinstance(partition, dict) or not isinstance(partition.get('regions'), list):
            raise ValueError('项目区域数据不正确。')
        for room in partition['regions']:
            if (not isinstance(room, dict) or not isinstance(room.get('id'), str)
                    or not numbers(room.get('bbox_px'), 4) or not numbers(room.get('label_px'), 2)
                    or not isinstance(room.get('rings_px'), list)
                    or any(not isinstance(ring, list) or len(ring) < 3 or any(not numbers(p, 2) for p in ring)
                           for ring in room['rings_px'])):
                raise ValueError('项目区域轮廓不正确。')
    return doc


def list_projects(root):
    root = Path(root)
    if not root.exists():
        return dict(projects=[], truncated=False)
    directories = sorted((p for p in root.iterdir() if p.is_dir() and not p.is_symlink()),
                         key=lambda p: p.name, reverse=True)
    projects = []
    for directory in directories[:100]:
        item = dict(id=directory.name)
        try:
            directory = project_directory(root, directory.name)
            doc = validate_document(read_json(directory, 'walls.json'))
            item.update(filename=doc['image'].get('original_filename', '户型图'),
                        wall_count=len(doc['walls']), room_count=len(doc.get('room_partition', {}).get('regions', [])),
                        calibrated=bool(doc.get('scale_mm_per_px')))
            if not (directory / 'floorplan.png').is_file():
                item['error'] = '缺少底图，无法打开。'
        except (ValueError, OSError) as error:
            item['error'] = str(error) if isinstance(error, ValueError) else '项目无法读取。'
        projects.append(item)
    return dict(projects=projects, truncated=len(directories) > 100)


def load_project(root, name):
    directory = project_directory(root, name)
    doc = validate_document(read_json(directory, 'walls.json'))
    png = read_file(directory, 'floorplan.png', 20 * 1024 * 1024)
    if hashlib.sha256(png).hexdigest() != doc['image']['sha256']:
        raise ValueError('底图与保存的项目不匹配，未打开。')
    with Image.open(BytesIO(png)) as image:
        if image.format != 'PNG' or image.size != (doc['image']['width_px'], doc['image']['height_px']):
            raise ValueError('底图格式或尺寸与项目不匹配。')
        image.verify()
    changes = read_json(directory, 'changes.json') if (directory / 'changes.json').exists() else []
    if not isinstance(changes, list) or any(not isinstance(c, dict) or not isinstance(c.get('id'), str)
                                          or not isinstance(c.get('type'), str) for c in changes):
        raise ValueError('项目修改记录格式不正确。')
    # Includes reserved opening-wall IDs and removed walls in the change log.
    identifiers = re.findall(r'"W(\d+)"', json.dumps([doc, changes]))
    next_id = max((int(n) for n in identifiers), default=0) + 1
    if (directory / 'project.json').exists():
        metadata = read_json(directory, 'project.json')
        if not isinstance(metadata, dict) or type(metadata.get('next_id')) is not int or metadata['next_id'] < 1:
            raise ValueError('项目编号记录不正确。')
        next_id = max(next_id, metadata['next_id'])
    return dict(document=doc, png=png, changes=changes, history=[], next_id=next_id)
