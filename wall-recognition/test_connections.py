from copy import deepcopy
import unittest

from PIL import Image, ImageDraw

from connect_walls import connect_walls, SOURCE
from correction_engine import apply_edit
from refine_walls import initialize_refinement, segment


def wall(identifier, a, b, c=100, axis=0, thickness=10):
    return dict(id=identifier, source='automatic', review_status='unreviewed',
                **segment(axis, a, b, c, thickness))


class ConnectionTests(unittest.TestCase):
    def run_connection(self, walls, openings=(), image=None):
        image = image or Image.new('RGB', (400, 400), 'white')
        base = initialize_refinement(dict(image=dict(width_px=400, height_px=400),
                                         walls=walls, openings=list(openings)), image)
        result, record, next_id = connect_walls(base, image, 20)
        return base, result, record, next_id

    def repairs(self, result):
        return [w for w in result['walls'] if w.get('source') == SOURCE]

    def test_small_collinear_gap_and_repeated_click(self):
        base, result, record, next_id = self.run_connection([wall('W001', 20, 100), wall('W002', 104, 200)])
        self.assertEqual(len(self.repairs(result)), 1)
        self.assertEqual(self.repairs(result)[0]['bbox_px'], [100, 95, 104, 105])
        self.assertEqual(base['walls'][0]['end_px'], [100, 100])
        again, _, final_id = connect_walls(result, Image.new('RGB', (400, 400), 'white'), next_id)
        self.assertEqual(again['walls'], result['walls'])
        self.assertEqual(final_id, next_id)
        self.assertEqual(record['wall_ids'], ['W020'])

    def test_l_corner_and_t_junction_touch_without_moving_originals(self):
        for target, expected in [(wall('W002', 104, 200, 104, 1), 2), (wall('W002', 20, 200, 104, 1), 1)]:
            base, result, _, _ = self.run_connection([wall('W001', 20, 100), target])
            self.assertEqual(len(self.repairs(result)), expected)
            self.assertEqual(result['walls'][:2], base['walls'])
            self.assertLess(result['wall_connection']['free_end_count'], 4)

    def test_blank_door_sized_gap_and_offset_parallel_walls_not_joined(self):
        for target in (wall('W002', 120, 220), wall('W002', 104, 220, 120)):
            _, result, _, _ = self.run_connection([wall('W001', 20, 100), target])
            self.assertEqual(self.repairs(result), [])

    def test_supported_filled_and_outlined_missing_strip(self):
        for outlined in (False, True):
            image = Image.new('RGB', (400, 400), 'white')
            draw = ImageDraw.Draw(image)
            if outlined:
                draw.line((20, 95, 220, 95), fill='#aaaaaa', width=1)
                draw.line((20, 105, 220, 105), fill='#aaaaaa', width=1)
            else:
                draw.rectangle((20, 95, 220, 104), fill='#666666')
            _, result, _, _ = self.run_connection([wall('W001', 20, 100), wall('W002', 120, 220)], image=image)
            self.assertEqual(len(self.repairs(result)), 1)
            self.assertEqual(self.repairs(result)[0]['length_px'], 20)

    def test_protected_opening_even_when_pixels_look_like_wall(self):
        image = Image.new('RGB', (400, 400), 'white')
        ImageDraw.Draw(image).rectangle((20, 95, 220, 104), fill='#666666')
        for kind, axis in [('door', 0), ('window', 0), ('unclassified', 0), ('door', 1)]:
            op = dict(id='O001', kind=kind, review_status='unreviewed', requires_confirmation=kind == 'unclassified',
                      **(segment(0, 100, 120, 100, 10) if axis == 0 else segment(1, 90, 110, 110, 10)))
            _, result, _, _ = self.run_connection([wall('W001', 20, 100), wall('W002', 120, 220)], [op], image)
            self.assertEqual(self.repairs(result), [])

    def test_manual_gap_and_single_stroke_not_filled(self):
        host = wall('W001', 20, 100)
        host['opening_hints'] = [dict(id='H001', **segment(0, 98, 100, 100, 10))]
        # Manual hint occupying a proposed L connection blocks the whole corner.
        target = wall('W002', 104, 200, 98, 1)
        _, result, _, _ = self.run_connection([host, target])
        self.assertEqual(self.repairs(result), [])
        image = Image.new('RGB', (400, 400), 'white')
        ImageDraw.Draw(image).line((20, 100, 220, 100), fill='black')
        _, result, _, _ = self.run_connection([wall('W001', 20, 100), wall('W002', 120, 220)], image=image)
        self.assertEqual(self.repairs(result), [])

    def test_connection_can_be_deleted_and_does_not_regenerate_on_refresh(self):
        _, result, _, next_id = self.run_connection([wall('W001', 20, 100), wall('W002', 104, 200)])
        removed, _, _ = apply_edit(result, dict(type='false_positive', wall_id='W020'), next_id)
        self.assertEqual(self.repairs(removed), [])
        self.assertEqual(removed['wall_connection']['repair_wall_count'], 0)
        self.assertEqual(removed['wall_connection']['free_end_count'], 4)

    def test_rotation_and_scale(self):
        for factor in (.75, 1, 2):
            for axis in (0, 1):
                image = Image.new('RGB', (int(400*factor), int(400*factor)), 'white')
                walls = [wall('W001', 20*factor, 100*factor, 100*factor, axis, 10*factor),
                         wall('W002', 104*factor, 200*factor, 100*factor, axis, 10*factor)]
                _, result, _, _ = self.run_connection(walls, image=image)
                self.assertEqual(len(self.repairs(result)), 1)


if __name__ == '__main__':
    unittest.main()
