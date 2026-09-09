"""Behavior checks from the supplied drawing styles and selected landmarks."""
from copy import deepcopy
import json
from pathlib import Path
import unittest
from PIL import Image, ImageDraw

from recognize_walls import detect_walls
from recognize_openings import detect_openings
from refine_walls import initialize_refinement, refresh_refinement, segment
from evaluate_reference_plans import contains, recognize

FIXTURES = Path(__file__).parent / "input/reference-plans"


class OutlinedWallTests(unittest.TestCase):
    def test_white_double_lines_recover_walls_without_closing_a_door(self):
        image = Image.new("RGB",(320,240),"white")
        draw = ImageDraw.Draw(image)
        for box in [(20,50,139,61),(170,50,289,61)]:
            draw.rectangle(box,fill="white",outline="#666666",width=2)
        for rotation in (0,90,180,270):
            plan = image.rotate(rotation,expand=True)
            walls = detect_walls(plan)
            self.assertEqual(len(walls),2)
            self.assertTrue(all(w["source"] == "automatic_paired_outline" for w in walls))
            self.assertFalse(any(o["kind"] == "window" for o in detect_openings(plan,walls)))
            # Rotate the original doorway point with the image.
            point = {0:(155,55),90:(55,164),180:(164,184),270:(184,155)}[rotation]
            self.assertFalse(contains(walls,point))

    def test_thick_junction_does_not_discard_the_long_wall(self):
        image = Image.new("RGB",(260,300),"white")
        draw = ImageDraw.Draw(image)
        draw.rectangle((50,20,79,270),fill="#777777")
        draw.rectangle((20,210,119,239),fill="#777777")
        walls = detect_walls(image)
        self.assertTrue(contains(walls,(65,100)))
        self.assertFalse(contains(walls,(130,100)))

    def test_ambiguous_boundary_does_not_cut_until_confirmed(self):
        wall = dict(id="W001",source="automatic",review_status="unreviewed",**segment(0,20,250,60,12))
        boundary = dict(id="O001",kind="unclassified",requires_confirmation=True,
                        review_status="unreviewed",**segment(0,100,160,60,12))
        doc = initialize_refinement(dict(walls=[wall],openings=[boundary]),Image.new("RGB",(300,200),"white"))
        self.assertTrue(contains(doc["solid_wall_segments"],(130,60)))
        self.assertEqual(doc["refinement_summary"]["uncertain_boundary_count"],1)
        confirmed = deepcopy(doc)
        confirmed["openings"][0].update(kind="window",review_status="confirmed")
        confirmed = refresh_refinement(confirmed)
        self.assertFalse(contains(confirmed["solid_wall_segments"],(130,60)))
        confirmed["openings"][0].update(kind="unclassified",review_status="unreviewed")
        restored = refresh_refinement(confirmed)
        self.assertTrue(contains(restored["solid_wall_segments"],(130,60)))

    def test_six_reference_plans_keep_reviewed_walls_and_nonwalls(self):
        cases = json.loads((FIXTURES/"landmarks.json").read_text(encoding="utf-8"))
        for case in cases:
            with self.subTest(plan=case["file"]):
                doc = recognize(Image.open(FIXTURES/case["file"]).convert("RGB"))
                for point in case["walls"]:
                    if point in case.get("known_missed_walls",[]):
                        continue
                    self.assertTrue(contains(doc["solid_wall_segments"],point),point)
                for point in case["nonwalls"]:
                    self.assertFalse(contains(doc["solid_wall_segments"],point),point)

    def test_outline_wall_cannot_be_removed_as_a_parallel_window(self):
        image = Image.open(FIXTURES/"03-raw.png")
        doc = recognize(image)
        for point in [(800,315),(300,1020),(173,970)]:
            self.assertTrue(contains(doc["solid_wall_segments"],point),point)
            self.assertFalse(contains(doc["openings"],point),point)


if __name__ == "__main__":
    unittest.main()
