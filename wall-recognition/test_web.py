import hashlib
import json
from pathlib import Path
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, build_opener, ProxyHandler
urlopen = build_opener(ProxyHandler({})).open

from web_server import ReviewServer

ROOT = Path(__file__).parent


class WebWorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.server = ReviewServer(("127.0.0.1", 0), Path(cls.temp.name) / "feedback")
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.origin = f"http://127.0.0.1:{cls.server.server_address[1]}"
        cls.token = cls.server.token
        payload = (ROOT / "input/floorplan.png").read_bytes()
        request = Request(cls.origin + "/api/detect", data=payload, headers={"X-Wall-Token": cls.token, "Content-Type": "image/png", "Origin": cls.origin})
        with urlopen(request) as response:
            cls.detected = json.load(response)

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=3)
        cls.temp.cleanup()

    def post(self, path, data, token=True, origin=None):
        headers = {"Content-Type": "application/json", "Origin": origin or self.origin}
        if token:
            headers["X-Wall-Token"] = self.token
        try:
            with urlopen(Request(self.origin + path, data=json.dumps(data).encode(), headers=headers)) as response:
                return response.status, json.load(response)
        except HTTPError as error:
            return error.code, json.load(error)

    def test_real_recognition_matches_existing_program(self):
        original = json.loads((ROOT / "output/walls.json").read_text(encoding="utf-8"))
        self.assertEqual(self.detected["document"]["coarse_walls"], original["walls"])
        with urlopen(self.origin + self.detected["image_url"]) as response:
            self.assertEqual(hashlib.sha256(response.read()).hexdigest(), self.detected["document"]["image"]["sha256"])

    def test_repeated_recognition_reuses_pristine_data_not_user_edits(self):
        def detect(name):
            request=Request(self.origin+'/api/detect',data=(ROOT/'input/floorplan.png').read_bytes(),
                            headers={'X-Wall-Token':self.token,'Origin':self.origin,'X-Image-Name':name})
            with urlopen(request) as response:return json.load(response)
        first=detect('first.png')
        self.assertTrue(first['cache_hit'])
        status,edited=self.post('/api/edit-furniture',{'run_id':first['run_id'],'action':'add','kind':'bed','bbox_px':[2,3,22,33]})
        self.assertEqual(status,200)
        second=detect('second.png')
        self.assertTrue(second['cache_hit'])
        self.assertNotEqual(first['run_id'],second['run_id'])
        self.assertEqual(first['document']['furniture'],second['document']['furniture'])
        self.assertEqual(second['document']['image']['original_filename'],'second.png')
        self.assertEqual(self.server.sessions[second['run_id']]['history'],[])

    def test_save_wall_problem_and_missing_region_with_paired_source(self):
        issues = [
            {"id": "W010", "wall_id": "W010", "type": "missing_corner", "direction": "up", "note": "右端缺转角"},
            {"id": "M001", "type": "missing_wall", "region_px": [630, 398, 650, 465], "note": "右侧漏线"},
        ]
        status, result = self.post("/api/save-feedback", {"run_id": self.detected["run_id"], "issues": issues})
        self.assertEqual(status, 200)
        folder = Path(self.temp.name) / "feedback" / result["saved_name"]
        report = json.loads((folder / "feedback.json").read_text(encoding="utf-8"))
        document = json.loads((folder / "walls.json").read_text(encoding="utf-8"))
        self.assertEqual(report["image_sha256"], hashlib.sha256((folder / "floorplan.png").read_bytes()).hexdigest())
        self.assertEqual(document, self.detected["document"])
        self.assertEqual(report["issues"][0]["wall_id"], "W010")
        self.assertEqual(report["issues"][0]["expected_geometry"]["end_px"], original_end := document["walls"][9]["end_px"])
        self.assertEqual(original_end, [200.0, 291.5])
        self.assertEqual(report["issues"][1]["region_px"], [630, 398, 650, 465])

    def test_reject_stale_wall_outside_region_and_malformed_body(self):
        for issue in [
            {"id": "W999", "wall_id": "W999", "type": "too_short"},
            {"id": "M001", "type": "missing_wall", "region_px": [-1, 1, 30, 30]},
        ]:
            self.assertEqual(self.post("/api/save-feedback", {"run_id": self.detected["run_id"], "issues": [issue]})[0], 400)
        self.assertEqual(self.post("/api/save-feedback", [])[0], 400)
        self.assertEqual(self.post("/api/detect", {"not": "an image"})[0], 400)

    def test_apply_edit_save_geometry_and_undo(self):
        run_id = self.detected["run_id"]
        status, edited = self.post("/api/apply-edit", {"run_id": run_id, "wall_id": "W005", "type": "too_short", "direction": "right", "target_wall_id": "W004"})
        self.assertEqual(status, 200)
        self.assertEqual(next(w for w in edited["document"]["walls"] if w["id"] == "W005")["end_px"][0], 365)
        status, saved = self.post("/api/save-project", {"run_id": run_id})
        self.assertEqual(status, 200)
        path = Path(self.temp.name) / "projects" / saved["saved_name"] / "walls.json"
        self.assertEqual(json.loads(path.read_text(encoding="utf-8")), edited["document"])
        solids=json.loads((path.parent/"solid-walls.json").read_text(encoding="utf-8"))
        self.assertEqual(solids["solid_wall_segments"],edited["document"]["solid_wall_segments"])
        self.assertTrue(next(w for w in edited["document"]["walls"] if w["id"]=="W005")["opening_hints"])
        status, undone = self.post("/api/undo-edit", {"run_id": run_id})
        self.assertEqual(status, 200)
        self.assertEqual(undone["document"], self.detected["document"])
        self.assertEqual(undone["history_size"], 0)

    def test_local_request_protection_and_page_assets(self):
        self.assertEqual(self.post("/api/save-feedback", {}, token=False)[0], 403)
        self.assertEqual(self.post("/api/save-feedback", {}, origin="https://example.com")[0], 403)
        for path in ["/", "/app.css", "/app.js", "/api/sample-image"]:
            with urlopen(self.origin + path) as response:
                self.assertEqual(response.status, 200)
                self.assertGreater(int(response.headers["Content-Length"]), 0)
        with self.assertRaises(HTTPError) as caught:
            urlopen(self.origin + "/../recognize_walls.py")
        self.assertEqual(caught.exception.code, 404)

    def test_opening_review_save_and_undo(self):
        run_id=self.detected["run_id"]
        original=self.detected["document"]
        opening=original["openings"][0]
        for kind in ("door","unclassified","rejected"):
            status,result=self.post("/api/review-opening",{"run_id":run_id,"opening_id":opening["id"],"kind":kind})
            self.assertEqual(status,200)
            self.assertEqual(result["document"]["coarse_walls"],original["coarse_walls"])
            self.assertEqual(result["document"]["openings"][0]["kind"],kind)
            status,saved=self.post("/api/save-project",{"run_id":run_id})
            folder=Path(self.temp.name)/"projects"/saved["saved_name"]
            self.assertEqual(json.loads((folder/"walls.json").read_text(encoding="utf-8")),result["document"])
            status,undone=self.post("/api/undo-edit",{"run_id":run_id})
            self.assertEqual(undone["document"],original)
        for bad in ({"opening_id":"O999","kind":"door"},{"opening_id":opening["id"],"kind":"anything"}):
            self.assertEqual(self.post("/api/review-opening",{"run_id":run_id,**bad})[0],400)
        self.assertEqual(self.post("/api/undo-edit",{"run_id":run_id})[0],400)

    def test_furniture_edit_save_and_shared_undo(self):
        run_id=self.detected["run_id"]
        original=self.detected["document"]
        status,added=self.post('/api/edit-furniture',{'run_id':run_id,'action':'add','kind':'bed','bbox_px':[50,60,160,200],'rotation_deg':90})
        self.assertEqual(status,200)
        furniture=added['document']['furniture'][-1]
        self.assertEqual(furniture['source'],'manual')
        self.assertEqual(added['document']['solid_wall_segments'],original['solid_wall_segments'])
        status,invalid=self.post('/api/edit-furniture',{'run_id':run_id,'action':'update','furniture_id':furniture['id'],'bbox_px':[0,0,9999,9999]})
        self.assertEqual(status,400)
        status,saved=self.post('/api/save-project',{'run_id':run_id})
        folder=Path(self.temp.name)/'projects'/saved['saved_name']
        exported=json.loads((folder/'furniture.json').read_text(encoding='utf-8'))
        self.assertEqual(exported['furniture'],added['document']['furniture'])
        status,rejected=self.post('/api/edit-furniture',{'run_id':run_id,'action':'reject','furniture_id':furniture['id']})
        self.assertEqual(status,200)
        self.assertEqual(rejected['document']['furniture'][-1]['review_status'],'rejected')
        status,undo=self.post('/api/undo-edit',{'run_id':run_id})
        self.assertEqual(undo['document'],added['document'])
        status,undo=self.post('/api/undo-edit',{'run_id':run_id})
        self.assertEqual(undo['document'],original)

    def test_fixture_categories_and_bathing_confirmation_save_undo(self):
        run_id=self.detected['run_id']
        original=self.detected['document']
        baths=[f for f in original['furniture'] if f['kind']=='wet_area']
        self.assertEqual(len(baths),2)
        self.assertTrue(all(f['review_status']=='unreviewed' for f in baths))
        for kind in ('bathtub','shower'):
            status,edited=self.post('/api/edit-furniture',{'run_id':run_id,'action':'update','furniture_id':baths[0]['id'],'kind':kind})
            self.assertEqual(status,200)
            item=next(f for f in edited['document']['furniture'] if f['id']==baths[0]['id'])
            self.assertEqual(item['review_status'],'confirmed')
            self.assertEqual(item['prediction']['kind'],'wet_area')
            self.assertEqual(edited['document']['solid_wall_segments'],original['solid_wall_segments'])
            status,saved=self.post('/api/save-project',{'run_id':run_id})
            self.assertEqual(status,200)
            path=Path(self.temp.name)/'projects'/saved['saved_name']/'furniture.json'
            self.assertEqual(json.loads(path.read_text(encoding='utf-8'))['furniture'],edited['document']['furniture'])
            status,undone=self.post('/api/undo-edit',{'run_id':run_id})
            self.assertEqual(undone['document'],original)


if __name__ == "__main__":
    unittest.main()
