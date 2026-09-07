from copy import deepcopy
import json
from pathlib import Path
import unittest

from apply_corrections import apply_corrections
from recognize_walls import wall_render_parts


ROOT = Path(__file__).parent


class CorrectionTests(unittest.TestCase):
    def setUp(self):
        self.base = json.loads((ROOT / "output/walls.json").read_text(encoding="utf-8"))
        self.patch = json.loads((ROOT / "input/floorplan-corrections-01.json").read_text(encoding="utf-8"))

    def test_length_geometry_ids_and_openings_remain_consistent(self):
        before = deepcopy(self.base)
        result = apply_corrections(self.base, self.patch)
        self.assertEqual(self.base, before)
        walls = {w["id"]: w for w in result["walls"]}
        self.assertEqual(walls["W021"]["length_px"], 194)
        self.assertEqual(walls["W021"]["bbox_px"], [262, 465, 273, 659])
        for original in self.base["walls"]:
            if original["id"] not in ("W013", "W021"):
                self.assertEqual(walls[original["id"]], original)
        self.assertEqual(len(walls), len(result["walls"]))
        self.assertEqual(len(result["boundary_candidates"]), 3)
        self.assertFalse(set(walls) & {b["id"] for b in result["boundary_candidates"]})

    def test_reject_wrong_image_or_renumbered_baseline(self):
        self.patch["image_sha256"] = "wrong"
        with self.assertRaises(ValueError):
            apply_corrections(self.base, self.patch)
        self.patch["image_sha256"] = self.base["image"]["sha256"]
        self.base["walls"][20]["start_px"] = [1, 2]
        with self.assertRaises(ValueError):
            apply_corrections(self.base, self.patch)

    def test_reject_duplicate_or_out_of_bounds_geometry(self):
        self.patch["add_walls"][0]["id"] = "W021"
        with self.assertRaises(ValueError):
            apply_corrections(self.base, self.patch)
        self.patch["add_walls"][0]["id"] = "W027"
        self.patch["updates"][0]["geometry"]["start_px"] = [267.5, -1]
        with self.assertRaises(ValueError):
            apply_corrections(self.base, self.patch)

    def test_second_review_connects_requested_walls_and_preserves_previous_work(self):
        first = apply_corrections(self.base, self.patch)
        second_patch = json.loads((ROOT / "input/floorplan-corrections-02.json").read_text(encoding="utf-8"))
        second = apply_corrections(first, second_patch)
        walls = {w["id"]: w for w in second["walls"]}
        self.assertEqual(second["boundary_candidates"], first["boundary_candidates"])
        for old in first["walls"]:
            if old["id"] not in ("W005", "W023"):
                self.assertEqual(walls[old["id"]], old)
        for turn_id, host_id, point in (("W028", "W010", "end_px"),
                                         ("W029", "W002", "start_px"),
                                         ("W030", "W008", "start_px"),
                                         ("W030", "W013", "end_px")):
            x, y = walls[turn_id][point]
            host = walls[host_id]
            self.assertEqual(y, host["start_px"][1])
            self.assertLessEqual(host["start_px"][0], x)
            self.assertLessEqual(x, host["end_px"][0])
        self.assertEqual(walls["W005"]["end_px"][0], walls["W004"]["start_px"][0])
        self.assertEqual(walls["W023"]["end_px"][0], walls["W021"]["start_px"][0])
        self.assertLess(walls["W029"]["end_px"][1], walls["W028"]["start_px"][1])
        for wall in walls.values():
            if wall.get("opening_hints"):
                parts = wall_render_parts(wall)
                self.assertAlmostEqual(sum(p["length_px"] for p in parts), wall["length_px"])
                void_length = sum(p["length_px"] for p in parts if p.get("classification") == "unclassified_boundary")
                self.assertEqual(void_length, sum(h["length_px"] for h in wall["opening_hints"]))

    def test_second_review_rejects_wrong_base_or_opening_outside_host(self):
        patch = json.loads((ROOT / "input/floorplan-corrections-02.json").read_text(encoding="utf-8"))
        with self.assertRaises(ValueError):
            apply_corrections(self.base, patch)
        first = apply_corrections(self.base, self.patch)
        patch["updates"][0]["geometry"]["opening_hints"][0]["end_px"] = [400, 193.5]
        with self.assertRaises(ValueError):
            apply_corrections(first, patch)


if __name__ == "__main__":
    unittest.main()
