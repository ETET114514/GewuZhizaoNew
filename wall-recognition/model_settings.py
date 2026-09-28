"""Validated, undoable calibration and white-model settings (all lengths in mm)."""
from copy import deepcopy
import math
import re

DEFAULTS = dict(wall_height_mm=2800, door_height_mm=2100, window_height_mm=1500,
                sill_height_mm=900, door_width_mm=800, opening_width_mm=900,
                window_width_mm=800, width_mode='detected', wall_color='#e4ddd3',
                floor_color='#ffffff', show_furniture=True, show_plan=False, show_room_floors=True)


def number(value, low, high, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
        raise ValueError(f'{label}需在 {low}–{high} 之间。')
    return float(value)


def apply_model_settings(document, request):
    result = deepcopy(document)
    settings = {**DEFAULTS, **document.get('model_settings', {})}
    supplied = request.get('settings', {})
    if not isinstance(supplied, dict) or set(supplied)-set(DEFAULTS):
        raise ValueError('三维设置格式不正确。')
    settings.update(supplied)
    for key in DEFAULTS:
        if key.endswith('_mm'):
            settings[key] = number(settings[key], 0 if key == 'sill_height_mm' else 100, 20000, key)
        elif key.endswith('_color'):
            if not isinstance(settings[key], str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', settings[key]):
                raise ValueError('颜色需为六位十六进制格式。')
        elif key.startswith('show_') and not isinstance(settings[key], bool):
            raise ValueError('显示设置需为布尔值。')
    if settings['width_mode'] not in ('detected', 'preset'):
        raise ValueError('请选择按图换算或使用预设宽度。')
    if settings['door_height_mm'] > settings['wall_height_mm']:
        raise ValueError('门洞高度不能大于墙高。')
    if settings['sill_height_mm']+settings['window_height_mm'] > settings['wall_height_mm']:
        raise ValueError('窗台高度与窗洞高度之和不能大于墙高。')
    if settings['door_width_mm'] > settings['opening_width_mm']:
        raise ValueError('预设门扇宽度不能大于门洞宽度。')
    result['model_settings'] = settings
    if 'calibration' in request and 'wall_calibration' in request:
        raise ValueError('一次只能选择一种标定方式。')
    if 'wall_calibration' in request:
        calibration = request['wall_calibration']
        if not isinstance(calibration, dict):
            raise ValueError('墙厚估算格式不正确。')
        wall = next((w for w in document['walls'] if w['id'] == calibration.get('wall_id')
                     and w.get('review_status') != 'rejected' and w.get('solid_parts', [w])), None)
        if wall is None:
            raise ValueError('请选择一段有效实墙作为墙厚依据。')
        actual = number(calibration.get('thickness_mm'), 50, 2000, '实际墙厚（mm）')
        pixels = number(wall.get('thickness_px'), .1, 2000, '图上墙厚')
        result['scale_mm_per_px'] = number(actual/pixels, .01, 10000, '比例（mm/px）')
        result['calibration'] = dict(method='wall_thickness', wall_id=wall['id'],
                                    thickness_mm=actual, thickness_px=pixels,
                                    image_sha256=document['image']['sha256'])
    if 'calibration' in request:
        calibration = request['calibration']
        if not isinstance(calibration, dict):
            raise ValueError('标定格式不正确。')
        points = calibration.get('points_px')
        if not isinstance(points, list) or len(points) != 2 or any(not isinstance(p, list) or len(p) != 2 for p in points):
            raise ValueError('请选择两个标定端点。')
        size = (document['image']['width_px'], document['image']['height_px'])
        points = [[number(v, 0, size[i], '标定坐标') for i, v in enumerate(p)] for p in points]
        distance = math.dist(*points)
        if distance < 5:
            raise ValueError('标定线太短，请选择至少 5 像素的已知长度。')
        length = number(calibration.get('length_mm'), 1, 1000000, '实际长度（mm）')
        scale = number(length/distance, .01, 10000, '比例（mm/px）')
        result['calibration'] = dict(points_px=points, length_mm=length, image_sha256=document['image']['sha256'])
        result['scale_mm_per_px'] = scale
    summary = '已按墙厚估算比例' if 'wall_calibration' in request else '已更新比例标定' if 'calibration' in request else '已更新三维尺寸与外观'
    return result, dict(id='MODEL', type='model_settings', summary=summary)
