"""Geometry behavior and a small, explicitly bounded sample-image regression."""
from pathlib import Path
import unittest

from PIL import Image, ImageDraw

from recognize_walls import detect_walls
from recognize_openings import detect_openings


def window_plan(count):
    image=Image.new("RGB",(400,400),"white")
    draw=ImageDraw.Draw(image)
    draw.rectangle((35,155,149,164),fill="#777777")
    draw.rectangle((240,155,365,164),fill="#777777")
    for n in range(count):
        y=156+2*n
        draw.line((150,y,239,y),fill="#777777",width=1)
    return image


class OpeningTests(unittest.TestCase):
    def test_two_to_five_line_windows_and_transforms(self):
        for count in (2,3,4,5):
            for rotation in (0,90):
                with self.subTest(lines=count,rotation=rotation):
                    image=window_plan(count).rotate(rotation)
                    result=detect_openings(image,detect_walls(image))
                    windows=[o for o in result if o["kind"]=="window"]
                    self.assertEqual(len(windows),1)
                    self.assertGreater(windows[0]["length_px"],80)
                    self.assertEqual(windows[0]["review_status"],"unreviewed")

    def test_blank_solid_wall_and_unanchored_furniture(self):
        image=Image.new("RGB",(400,400),"white")
        self.assertEqual(detect_openings(image,[]),[])
        draw=ImageDraw.Draw(image)
        draw.rectangle((30,80,350,91),fill="#666666")
        draw.rectangle((120,220,280,280),outline="#777777",width=2)
        draw.rectangle((125,225,275,275),outline="#777777",width=1)
        self.assertEqual(detect_openings(image,detect_walls(image)),[])

    def test_swing_requires_arc_and_retains_mirrored_hinge(self):
        image=Image.new("RGB",(400,400),"white")
        draw=ImageDraw.Draw(image)
        draw.rectangle((40,155,159,164),fill="#777777")
        draw.rectangle((210,155,359,164),fill="#777777")
        draw.line((160,160,160,210),fill="#555555",width=2)
        self.assertFalse(any(o["kind"]=="door" for o in detect_openings(image,detect_walls(image))))
        draw.arc((110,110,210,210),0,90,fill="#555555",width=1)
        for transformed in (image,image.transpose(Image.Transpose.FLIP_LEFT_RIGHT),image.rotate(90)):
            doors=[o for o in detect_openings(transformed,detect_walls(transformed)) if o["kind"]=="door"]
            self.assertEqual(len(doors),1)
            self.assertAlmostEqual(doors[0]["length_px"],50,delta=6)

    def test_sample_windows_doors_and_fixture_exclusion(self):
        image=Image.open(Path(__file__).parent/"input/floorplan.png")
        result=detect_openings(image,detect_walls(image))
        # Visually checked locations, not a claim of whole-image accuracy.
        for x,y,kind in [(573,290,"window"),(642,430,"window"),(643,650,"window"),
                         (540,682,"window"),(365,340,"door"),(492,445,"door")]:
            self.assertTrue(any(o["kind"]==kind and
                o["bbox_px"][0]-5<=x<=o["bbox_px"][2]+5 and
                o["bbox_px"][1]-5<=y<=o["bbox_px"][3]+5 for o in result),(x,y,kind))
        self.assertFalse(any(285<o["start_px"][0]<310 and 195<o["start_px"][1]<250 for o in result))
        self.assertEqual(result,detect_openings(image,detect_walls(image)))

    def test_furnished_plan_recovers_all_eight_doors_without_equipment_false_positives(self):
        image=Image.open(Path(__file__).parent/"input/reference-plans/04-furnished.png")
        result=detect_openings(image,detect_walls(image))
        doors=[o for o in result if o["kind"]=="door"]
        # Entry, upper balcony, bath, study, two bedrooms and two lower balcony
        # doors. Locations were read from the plan, not generated detections.
        for x,y in [(460,152),(1110,325),(855,494),(1050,503),
                    (675,629),(1010,632),(345,1033),(815,1033)]:
            self.assertTrue(any(o["orientation"]=="horizontal" and
                o["bbox_px"][0]-5 <= x <= o["bbox_px"][2]+5 and
                o["bbox_px"][1]-8 <= y <= o["bbox_px"][3]+8 for o in doors),(x,y))
        self.assertEqual(len(doors),8)
        # The nearby equipment has circles, diagonal crosses and a closed box.
        self.assertFalse(any(o["bbox_px"][0]<310 and o["bbox_px"][1]>1045 for o in doors))

    def test_fitted_hinge_requires_arc_even_without_coarse_wall_candidates(self):
        image=Image.new("RGB",(800,800),"white")
        draw=ImageDraw.Draw(image)
        draw.rectangle((150,300,319,317),fill="#777777")
        draw.rectangle((385,300,560,317),fill="#777777")
        # The extracted leaf endpoint extends 12 pixels beyond the true hinge.
        draw.line((320,244,320,321),fill="#555555",width=2)
        self.assertFalse(any(o["kind"]=="door" for o in detect_openings(image,[])))
        draw.arc((255,244,385,374),270,360,fill="#555555",width=2)
        for plan in (image,image.transpose(Image.Transpose.FLIP_LEFT_RIGHT),image.rotate(90)):
            doors=[o for o in detect_openings(plan,[]) if o["kind"]=="door"]
            self.assertEqual(len(doors),1)
            self.assertAlmostEqual(doors[0]["length_px"],65,delta=8)
            self.assertEqual(doors[0]["evidence"].get("jamb_support"),"source_image")


if __name__=="__main__":
    unittest.main()
