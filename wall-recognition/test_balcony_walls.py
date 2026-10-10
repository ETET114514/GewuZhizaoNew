"""Image-derived regressions for the three user-reported furnished-plan gaps."""
from pathlib import Path
import unittest

from PIL import Image, ImageDraw

from recognize_walls import detect_walls
from recognize_openings import detect_openings
from refine_walls import initialize_refinement, refresh_refinement


def contains(items, point, margin=3):
    x, y = point
    return any(b[0]-margin <= x <= b[2]+margin and b[1]-margin <= y <= b[3]+margin
               for item in items for b in [item['bbox_px']])


class BalconyWallTests(unittest.TestCase):
    def test_wide_exterior_frame_requires_three_lines_and_two_jambs(self):
        def plan(third=True,bottom=True):
            image=Image.new('RGB',(745,761),'white');draw=ImageDraw.Draw(image)
            draw.rectangle((300,50,317,237),fill='#777777')
            draw.rectangle((300,50,500,67),fill='#777777')
            if bottom:draw.rectangle((300,220,500,237),fill='#777777')
            for x in ([470,475,498] if third else [470,498]):
                draw.line((x,68,x,219),fill='#777777',width=1)
            return image
        image=plan()
        self.assertTrue(contains([o for o in detect_openings(image,detect_walls(image)) if o['kind']=='window'],(497,140),2))
        for image in (plan(third=False),plan(bottom=False)):
            self.assertFalse(any(o['evidence'].get('wide_frame_band') for o in detect_openings(image,detect_walls(image))))

    def test_reported_wall_and_glass_landmarks_under_transforms(self):
        image = Image.open(Path(__file__).parent/'input/floorplan.png').convert('RGB')
        # Selected landmarks from the source, independent of generated IDs.
        wall_points = [(385, 372), (267, 474)]
        glass_points = [(250, 740), (435, 722), (114, 728), (331, 100)]
        cases = [
            (image, lambda p:p),
            (image.transpose(Image.Transpose.FLIP_LEFT_RIGHT), lambda p:(image.width-1-p[0], p[1])),
            (image.transpose(Image.Transpose.ROTATE_90), lambda p:(p[1], image.width-1-p[0])),
            (image.resize((1117,1141)), lambda p:(p[0]*1117/745, p[1]*1141/761)),
        ]
        for index, (plan, transform) in enumerate(cases):
            with self.subTest(size=plan.size, transform=index):
                walls = detect_walls(plan)
                openings = detect_openings(plan, walls)
                result = initialize_refinement(dict(image={'width_px':plan.width,'height_px':plan.height},
                    walls=walls, openings=openings), plan)
                glass = [o for o in result['openings'] if o['kind']=='window']
                for p in wall_points:
                    self.assertTrue(contains(result['solid_wall_segments'],transform(p)), p)
                for p in glass_points:
                    self.assertTrue(contains(glass,transform(p),5),p)
                    self.assertFalse(contains(result['solid_wall_segments'],transform(p),0),p)
                self.assertEqual(refresh_refinement(result), result)

    def test_color_continuation_stops_at_blank_doorway(self):
        image = Image.new('RGB',(400,220),'white')
        draw = ImageDraw.Draw(image)
        draw.rectangle((25,60,115,71),fill='#777777')
        draw.rectangle((116,60,169,71),fill=(126,110,101))
        draw.rectangle((190,60,320,71),fill='#777777')
        draw.rectangle((25,110,115,121),fill='#777777')
        # A broad floor/cabinet fill has no edge contrast matching the host.
        draw.rectangle((116,90,170,145),fill=(126,110,101))
        for plan,point in [(image,(150,66)), (image.transpose(Image.Transpose.ROTATE_90),(66,249))]:
            walls = detect_walls(plan)
            self.assertTrue(contains(walls,point,0))
        walls = detect_walls(image)
        self.assertFalse(contains(walls,(180,66),0))
        self.assertFalse(contains(walls,(150,116),0))

    def test_detached_parallel_rectangle_is_not_glazing(self):
        image = Image.new('RGB',(400,400),'white')
        draw = ImageDraw.Draw(image)
        for inset in (0,4,8):
            draw.rectangle((100+inset,180+inset,290-inset,280-inset),outline='#777777',width=1)
        self.assertFalse(any(o['kind']=='window' for o in detect_openings(image, [])))

    def test_opaque_return_is_not_a_window(self):
        image = Image.new('RGB',(400,400),'white')
        draw = ImageDraw.Draw(image)
        draw.rectangle((50,70,61,340), fill='#777777')
        draw.rectangle((50,329,330,340), fill='#777777')
        draw.rectangle((319,70,330,340), fill='#777777')
        self.assertFalse(any(o['kind']=='window' for o in detect_openings(image,detect_walls(image))))


if __name__ == '__main__':
    unittest.main()
