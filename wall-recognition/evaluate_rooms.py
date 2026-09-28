"""Render room candidates from the three saved connection-repair fixtures."""
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

from partition_rooms import partition_rooms

ROOT = Path(__file__).parent
OUT = ROOT/'output/rooms-v1'


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    metrics = []
    for name, path in [('default', 'input/floorplan.png'),
                       ('dense', 'input/reference-plans/07-dense-furnished.png'),
                       ('pale', 'input/furniture-references/11-light-rendered.png')]:
        doc = json.loads((ROOT/f'output/connections-v1/{name}.json').read_text(encoding='utf-8'))
        result = partition_rooms(doc)
        (OUT/f'{name}.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
        image = Image.open(ROOT/path).convert('RGBA')
        colors = [(35, 165, 154), (155, 119, 211), (229, 164, 60), (91, 148, 223), (221, 129, 154)]
        overlay = np.zeros((image.height, image.width, 4), dtype=np.uint8)
        for i, region in enumerate(result['regions']):
            contours = [np.rint(r).astype(np.int32) for r in region['rings_px']]
            cv2.fillPoly(overlay, contours, (*colors[i % len(colors)], 75))
            cv2.polylines(overlay, contours, True, (*colors[i % len(colors)], 230), 2)
        image = Image.alpha_composite(image, Image.fromarray(overlay))
        draw = ImageDraw.Draw(image)
        for region in result['regions']:
            draw.text(region['label_px'], region['id'], fill='black', stroke_width=2, stroke_fill='white')
        for boundary in result['virtual_boundaries']:
            draw.line([tuple(boundary['start_px']), tuple(boundary['end_px'])], fill='#b054a1', width=3)
        image.convert('RGB').save(OUT/f'{name}.png')
        item = dict(name=name, regions=result['region_count'],
                    virtual_boundaries=len(result['virtual_boundaries']),
                    skipped=result['skipped_opening_ids'], pending=result['pending_opening_ids'])
        metrics.append(item); print(json.dumps(item), flush=True)
    (OUT/'metrics.json').write_text(json.dumps(metrics, indent=2), encoding='utf-8')


if __name__ == '__main__': main()
