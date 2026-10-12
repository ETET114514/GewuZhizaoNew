"""Width-based window opening preset, measured along the wall in millimetres."""
import math

WINDOW_FLIP_THRESHOLD_MM = 1800


def window_width_mm(document, opening):
    width = opening.get('dimensions_mm', {}).get('width_mm')
    if width is None:
        settings = document.get('model_settings', {})
        if settings.get('width_mode') == 'preset':
            width = settings.get('window_width_mm', 800)
        else:
            scale = document.get('scale_mm_per_px')
            if type(scale) not in (int, float) or not math.isfinite(scale) or scale <= 0:
                return None
            axis = 0 if opening['orientation'] == 'horizontal' else 1
            width = abs(opening['end_px'][axis] - opening['start_px'][axis]) * scale
    return width if type(width) in (int, float) and math.isfinite(width) and width > 0 else None


def apply_window_preset(document, opening, operation):
    if opening['kind'] != 'window' or operation['type'] == 'fixed':
        return operation
    mode = operation.get('axis_mode', 'manual')
    if mode == 'manual':
        return operation
    wide = (window_width_mm(document, opening) or 0) >= WINDOW_FLIP_THRESHOLD_MM
    # Top-hung leaves lift their lower edge; side-hung leaves turn at the start.
    return dict(operation, axis_mode='width', pivot_axis='horizontal' if wide else 'vertical',
                hinge='top' if wide else 'start', pivot_ratio=1 if wide else 0)


def refresh_window_presets(document):
    for opening in document.get('openings', []):
        if opening.get('operation') and opening.get('kind') == 'window':
            opening['operation'] = apply_window_preset(document, opening, opening['operation'])
