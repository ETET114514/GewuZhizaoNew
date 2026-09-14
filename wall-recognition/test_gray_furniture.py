"""Gray-sheet calibration and relocated-symbol regression, not accuracy metrics."""
import json
import unittest

import numpy as np
from PIL import Image, ImageDraw, ImageOps

from recognize_furniture import ROOT, add_furniture, detect_furniture, overlap, apply_furniture_edit
from recognize_learned_furniture import cad_ink


class GrayFurnitureTests(unittest.TestCase):
    def test_background_is_not_ink_and_light_sheet_strokes_stay_unchanged(self):
        for background in (175, 198, 220, 255):
            image = Image.new('L', (300, 300), background)
            self.assertFalse(cad_ink(image).any())
            ImageDraw.Draw(image).rectangle((60, 80, 130, 190), outline=30, width=3)
            ink = cad_ink(image)
            self.assertEqual(int(ink[80, 60]), 1)
            self.assertEqual(int(ink[100, 100]), 0)
            self.assertLess(float(ink.mean()), .05)
        gray = np.full((300, 300), 255, dtype='uint8')
        gray[20:40, 30:70] = 210
        np.testing.assert_array_equal(cad_ink(Image.fromarray(gray)), gray < 215)

    def test_gray_source_contains_each_requested_target_once(self):
        image = Image.open(ROOT / 'input/furniture-references/06.jpg')
        truth = json.loads((ROOT / 'input/furniture-references/gray-landmarks.json').read_text())['targets']
        doc = add_furniture({'image': {'width_px': image.width, 'height_px': image.height}}, image)
        for target in truth:
            matches = [f for f in doc['furniture'] if f['kind'] == target['kind'] and
                       overlap(f['bbox_px'], target['bbox_px'])[0] > .75]
            self.assertEqual(len(matches), 1, target)
            self.assertEqual(matches[0]['review_status'], 'unreviewed')
        # Model table/chair boxes must not replace the calibrated tabletop.
        dining = next(f for f in doc['furniture'] if f['kind'] == 'dining_table')
        self.assertLess(dining['bbox_px'][2] - dining['bbox_px'][0], 75)
        fridge = next(f for f in doc['furniture'] if f['kind'] == 'refrigerator')
        changed, _ = apply_furniture_edit(doc, {'action': 'update', 'furniture_id': fridge['id'],
                                              'kind': 'refrigerator', 'rotation_deg': 90})
        updated = next(f for f in changed['furniture'] if f['id'] == fridge['id'])
        self.assertIsNone(updated['rotation_deg'])
        self.assertEqual(updated['review_status'], 'confirmed')
        self.assertEqual(fridge['review_status'], 'unreviewed')

    def test_symbols_relocated_mirrored_rotated_and_scaled(self):
        source = Image.open(ROOT / 'input/furniture-references/06.jpg')
        specs = json.loads((ROOT / 'input/furniture-references/templates.json').read_text())
        specs = [s for s in specs if s['id'].startswith('gray-')]
        canvas = Image.new('RGB', (750, 620), (198, 196, 183))
        truth = []
        for i, spec in enumerate(specs):
            x0, y0, x1, y1 = spec['bbox_px']
            crop = source.crop((x0, y0, x1, y1))
            mask = Image.new('L', crop.size)
            a, b, c, d = spec['object_bbox_px']
            ImageDraw.Draw(mask).rectangle((a-x0, b-y0, c-x0-1, d-y0-1), fill=255)
            if i % 2:
                crop, mask = ImageOps.mirror(crop), ImageOps.mirror(mask)
            crop, mask = crop.rotate(90*(i % 4), expand=True), mask.rotate(90*(i % 4), expand=True)
            scale = .9 if i % 2 else 1.15
            size = (round(crop.width*scale), round(crop.height*scale))
            pos = (30 + (i % 3)*240, 30 + (i // 3)*195)
            canvas.paste(crop.resize(size), pos)
            a, b, c, d = mask.resize(size, Image.Resampling.NEAREST).getbbox()
            truth.append((spec['kind'], [a+pos[0], b+pos[1], c+pos[0], d+pos[1]]))
        found = detect_furniture(canvas)
        for kind, box in truth:
            matches = [f for f in found if f['kind'] == kind and overlap(f['bbox_px'], box)[0] > .65]
            self.assertEqual(len(matches), 1, (kind, box, found))


if __name__ == '__main__':
    unittest.main()
