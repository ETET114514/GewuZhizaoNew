"""Validated per-item 3D appearance and placement, sharing the 2D footprint."""
import math
import re


def number(value, low, high, label):
    if type(value) not in (int, float) or not math.isfinite(value) or not low <= value <= high:
        raise ValueError(f'{label}需在 {low:g}～{high:g} 范围内。')
    return value


def model_options(options):
    if not isinstance(options, dict) or set(options) - {'height_mm', 'elevation_mm', 'rotation_deg', 'color'}:
        raise ValueError('家具三维参数格式不正确。')
    result = {}
    for key, low, high, label in [('height_mm', 20, 10000, '家具高度'),
                                   ('elevation_mm', 0, 10000, '离地高度'),
                                   ('rotation_deg', 0, 360, '整体旋转角度')]:
        if key in options:
            result[key] = number(options[key], low, high, label)
    if 'color' in options:
        if not isinstance(options['color'], str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', options['color']):
            raise ValueError('请选择有效的家具颜色。')
        result['color'] = options['color'].lower()
    return result


def placement_box(document, placement):
    keys = {'center_x_mm', 'center_y_mm', 'width_mm', 'depth_mm'}
    if not isinstance(placement, dict) or set(placement) != keys:
        raise ValueError('请填写家具中心位置与占地尺寸。')
    scale = document.get('scale_mm_per_px')
    if type(scale) not in (int, float) or not math.isfinite(scale) or scale <= 0:
        raise ValueError('请先标定比例，再修改实际家具尺寸。')
    x = number(placement['center_x_mm'], 0, document['image']['width_px'] * scale, '中心 X') / scale
    y = number(placement['center_y_mm'], 0, document['image']['height_px'] * scale, '中心 Y') / scale
    w = number(placement['width_mm'], 20, 50000, '横向占地') / scale
    d = number(placement['depth_mm'], 20, 50000, '纵向占地') / scale
    return [x-w/2, y-d/2, x+w/2, y+d/2]


def validate_footprint(image, box, options):
    angle = math.radians(options.get('rotation_deg', 0))
    w, d = box[2]-box[0], box[3]-box[1]
    cx, cy = (box[0]+box[2])/2, (box[1]+box[3])/2
    rx = (abs(math.cos(angle))*w + abs(math.sin(angle))*d)/2
    ry = (abs(math.sin(angle))*w + abs(math.cos(angle))*d)/2
    if cx-rx < -1e-7 or cy-ry < -1e-7 or cx+rx > image['width_px']+1e-7 or cy+ry > image['height_px']+1e-7:
        raise ValueError('旋转后的家具超出底图，请调整中心位置或尺寸。')
