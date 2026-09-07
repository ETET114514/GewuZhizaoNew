from copy import deepcopy
import json
from pathlib import Path
import unittest
from correction_engine import apply_edit


class DirectEditTests(unittest.TestCase):
    def setUp(self):
        self.base = json.loads((Path(__file__).parent / "output/walls.json").read_text(encoding="utf-8"))

    def test_user_examples_execute_without_assistant(self):
        document, record, counter = apply_edit(self.base, {"wall_id":"W021","type":"too_short","note":"向上延长 50 像素"}, 27)
        self.assertEqual(next(w for w in document["walls"] if w["id"] == "W021")["start_px"], [267.5,465])
        document, record, counter = apply_edit(document, {"wall_id":"W008","type":"too_short","note":"向下一直到w013"}, counter)
        new = next(w for w in document["walls"] if w["id"] == "W027")
        self.assertEqual(new["end_px"], [577,372])
        self.assertEqual(new["orientation"], "vertical")
        document, record, counter = apply_edit(document, {"wall_id":"W023","type":"too_short","direction":"right","target_wall_id":"W021"}, counter)
        self.assertEqual(next(w for w in document["walls"] if w["id"] == "W023")["end_px"], [267.5,651.5])

    def test_delete_add_and_invalid_edits_preserve_input(self):
        before = deepcopy(self.base)
        result, _, counter = apply_edit(self.base, {"wall_id":"W010","type":"false_positive"}, 27)
        self.assertFalse(any(w["id"] == "W010" for w in result["walls"]))
        result, _, counter = apply_edit(result, {"type":"missing_wall","region_px":[600,300,610,350]}, counter)
        self.assertEqual(result["walls"][-1]["start_px"], [605,300])
        with self.assertRaises(ValueError):
            apply_edit(self.base, {"wall_id":"W005","type":"too_short","direction":"left","target_wall_id":"W004"}, 27)
        self.assertEqual(self.base,before)


if __name__ == "__main__":
    unittest.main()
