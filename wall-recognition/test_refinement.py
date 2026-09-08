from copy import deepcopy
from pathlib import Path
import unittest

from PIL import Image, ImageDraw

from correction_engine import apply_edit
from refine_walls import initialize_refinement, refresh_refinement, segment, aligned


def wall(identifier, a, b, c=160, axis=0):
    return dict(id=identifier, source="automatic", review_status="unreviewed",
                **segment(axis, a, b, c, 10))


def opening(identifier, a, b, c=160, axis=0):
    return dict(id=identifier, kind="window", review_status="unreviewed",
                **segment(axis, a, b, c, 8))


def document(walls, openings):
    return dict(image={"width_px":400,"height_px":400}, walls=walls, openings=openings)


class RefinementTests(unittest.TestCase):
    def test_frame_removed_from_solid_but_perpendicular_wall_preserved(self):
        image=Image.new("RGB", (400,400), "white")
        base=document([wall("W001",40,350), wall("W002",80,250,c=170,axis=1)],
                      [opening("O001",130,210)])
        result=initialize_refinement(base,image)
        self.assertEqual(base["walls"][0]["end_px"],[350.,160.])
        parts=result["walls"][0]["solid_parts"]
        self.assertEqual([(p["start_px"][0],p["end_px"][0]) for p in parts],[(40,130),(210,350)])
        self.assertEqual(result["walls"][1]["solid_parts"][0]["length_px"],170)
        self.assertEqual(refresh_refinement(result),result)

    def test_supported_short_jambs_survive_without_filling_the_opening(self):
        image=Image.new("RGB",(400,400),"white")
        draw=ImageDraw.Draw(image)
        draw.rectangle((35,155,104,164),fill="#777777")
        draw.rectangle((205,155,365,164),fill="#777777")
        base=document([wall("W001",35,100),wall("W002",210,366)], [opening("O001",105,205)])
        result=initialize_refinement(base,image)
        bridge=next(w for w in result["walls"] if w.get("opening_id")=="O001")
        self.assertEqual([(p["start_px"][0],p["end_px"][0]) for p in bridge["solid_parts"]],[(100,105),(205,210)])
        self.assertEqual([(h["start_px"][0],h["end_px"][0]) for h in bridge["opening_hints"]],[(105,205)])

    def test_extend_move_shorten_and_reject_recalculate_solids(self):
        base=document([wall("W001",35,100),wall("W002",200,365)], [opening("O001",100,200)])
        image=Image.new("RGB",(400,400),"white")
        initial=initialize_refinement(base,image)
        edited,_,counter=apply_edit(initial,{"wall_id":"W001","type":"too_short","direction":"right","amount_px":130},4)
        host=next(w for w in edited["walls"] if w["id"]=="W001")
        self.assertEqual([(p["start_px"][0],p["end_px"][0]) for p in host["solid_parts"]],[(35,100),(200,230)])
        self.assertFalse(any(w.get("opening_id")=="O001" for w in edited["walls"]))
        shortened,_,_=apply_edit(edited,{"wall_id":"W001","type":"too_long","direction":"right","amount_px":80},counter)
        self.assertEqual(shortened["walls"][0]["solid_parts"][0]["end_px"][0],100)
        moved,_,_=apply_edit(edited,{"wall_id":"W001","type":"position","direction":"down","amount_px":30},counter)
        self.assertFalse(moved["walls"][0].get("opening_hints"))
        self.assertEqual(moved["openings"],edited["openings"])
        rejected=deepcopy(edited);rejected["openings"][0].update(kind="rejected",review_status="rejected")
        restored=refresh_refinement(rejected)
        self.assertEqual(restored["walls"][0]["solid_parts"][0]["length_px"],195)
        self.assertEqual(edited["openings"][0]["kind"],"window")

    def test_overlapping_openings_merge_and_new_wall_obeys_constraints(self):
        base=document([wall("W001",40,350)],[opening("O001",130,210),opening("O002",180,240)])
        result=initialize_refinement(base,Image.new("RGB",(400,400),"white"))
        self.assertEqual(len(result["walls"][0]["opening_hints"]),1)
        self.assertEqual(result["walls"][0]["opening_hints"][0]["length_px"],110)
        self.assertEqual(refresh_refinement(result),result)
        added,_,_=apply_edit(result,{"type":"missing_wall","region_px":[90,155,270,165]},4)
        new=next(w for w in added["walls"] if w["id"]=="W004")
        self.assertEqual([(p["start_px"][0],p["end_px"][0]) for p in new["solid_parts"]],[(90,130),(240,270)])

    def test_deleting_generated_connection_does_not_resurrect_it(self):
        result=initialize_refinement(document([wall("W001",35,100),wall("W002",200,365)],
                    [opening("O001",100,200)]),Image.new("RGB",(400,400),"white"))
        identifier=result["opening_wall_ids"]["O001"]
        deleted,_,_=apply_edit(result,{"wall_id":identifier,"type":"false_positive"},4)
        self.assertFalse(any(w["id"]==identifier for w in refresh_refinement(deleted)["walls"]))

    def test_manual_opening_hint_survives_refresh_and_moves_with_its_wall(self):
        host=wall("W001",40,350)
        host["opening_hints"]=[dict(id="H001",source="assisted_correction",**segment(0,110,140,160,10))]
        result=initialize_refinement(document([host],[opening("O001",180,230)]),Image.new("RGB",(400,400),"white"))
        self.assertEqual(refresh_refinement(result),result)
        moved,_,_=apply_edit(result,{"wall_id":"W001","type":"position","direction":"down","amount_px":30},3)
        hint=moved["walls"][0]["opening_hints"][0]
        self.assertEqual(hint["start_px"],[110,190])
        self.assertEqual(hint["end_px"],[140,190])

    def test_real_plan_has_no_solid_fill_across_aligned_openings(self):
        from web_server import recognize_upload
        payload=(Path(__file__).parent/"input/floorplan.png").read_bytes()
        result=recognize_upload(payload,"sample.png")["document"]
        self.assertEqual(len(result["coarse_walls"]),26)
        self.assertEqual(len(result["openings"]),10)
        self.assertGreater(result["refinement_summary"]["connection_count"],0)
        for o in result["openings"]:
            axis=0 if o["orientation"]=="horizontal" else 1
            for p in result["solid_wall_segments"]:
                if aligned(p,o):
                    self.assertLessEqual(min(p["end_px"][axis],o["end_px"][axis])-max(p["start_px"][axis],o["start_px"][axis]),0)
        self.assertTrue(any(p["length_px"]<7 for p in result["solid_wall_segments"]))


if __name__=="__main__":
    unittest.main()
