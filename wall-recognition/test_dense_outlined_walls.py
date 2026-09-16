"""Real drawing landmarks and rotation checks, not complete segmentation truth."""
import unittest
from pathlib import Path

from PIL import Image

from evaluate_reference_plans import contains, recognize
from recognize_outlined_walls import _detect_outlined_walls

SOURCE = Path(__file__).parent / "input/reference-plans/07-dense-furnished.png"
WALLS = [(18,150),(18,600),(45,41),(220,41),(350,167),(455,189),
         (595,189),(720,189),(310,220),(310,350),(433,235),(433,345),
         (623,235),(623,350),(750,240),(750,550),(550,383),(715,383),
         (450,471),(310,580),(520,600),(520,770),(550,715),(40,814),(480,814)]
NONWALLS = [(350,470),(470,380),(670,380),(520,430),(390,190),(520,190),
            (680,190),(351,120),(650,715),(220,814),(470,682),(710,682),
            (270,75),(595,270),(650,475),(450,515),(460,240),(200,320)]


class DenseOutlinedWallTests(unittest.TestCase):
    def test_wall_landmarks_and_open_doorways_in_full_pipeline(self):
        with Image.open(SOURCE) as image:
            doc = recognize(image.convert("RGB"))
        for point in WALLS:
            self.assertTrue(contains(doc["solid_wall_segments"],point),point)
        for point in NONWALLS:
            self.assertFalse(contains(doc["solid_wall_segments"],point),point)

    def test_rotated_and_resized_network_keeps_main_partitions(self):
        # These are transform checks on one source, not new building samples.
        with Image.open(SOURCE) as original:
            for angle,scale in [(90,1.),(180,.85),(270,1.15)]:
                with self.subTest(angle=angle,scale=scale):
                    image = original.rotate(angle,expand=True)
                    width,height = image.size
                    image = image.resize((round(width*scale),round(height*scale)))
                    walls = _detect_outlined_walls(image,[],network=True)
                    for x,y in [(18,150),(220,41),(310,220),(433,235),(623,350),(750,550),(520,600)]:
                        if angle == 90: x,y = y,original.width-1-x
                        elif angle == 180: x,y = original.width-1-x,original.height-1-y
                        else: x,y = original.height-1-y,x
                        self.assertTrue(contains(walls,(x*image.width/width,y*image.height/height)),(x,y))

    def test_furniture_crop_cannot_bootstrap_building_network(self):
        with Image.open(SOURCE) as image:
            for box in [(105,465,300,713),(593,550,745,693),(120,249,233,397)]:
                with self.subTest(box=box):
                    self.assertEqual(_detect_outlined_walls(image.crop(box),[],network=True),[])


if __name__ == "__main__":
    unittest.main()
