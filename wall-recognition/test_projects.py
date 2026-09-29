from copy import deepcopy
import hashlib
from io import BytesIO
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, build_opener, ProxyHandler

from PIL import Image
from model_settings import apply_model_settings
from partition_rooms import partition_rooms
from room_editing import apply_room_edit
from project_store import load_project
from test_rooms import fixture
from web_server import ReviewServer


class ProjectWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.server = ReviewServer(('127.0.0.1', 0), self.root/'feedback')
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.origin = f'http://127.0.0.1:{self.server.server_address[1]}'
        self.opener = build_opener(ProxyHandler({}))
        image = BytesIO(); Image.new('RGB', (400, 300), 'white').save(image, 'PNG')
        self.png = image.getvalue()
        doc = fixture()
        doc['image'].update(sha256=hashlib.sha256(self.png).hexdigest(), original_filename='测试户型.png')
        doc['parameters'] = dict(wall_colors=['#b0b0b0'], color_tolerance=7)
        doc, _ = apply_model_settings(doc, dict(wall_calibration=dict(wall_id='W001', thickness_mm=200)))
        doc['room_partition'] = partition_rooms(doc)
        doc, record = apply_room_edit(doc, dict(action='add', points_px=[[30,40],[150,40],[150,200],[30,200]]))
        doc, material = apply_room_edit(doc, dict(action='settings', room_id=record['room_id'], name='卧室', floor=dict(material='wood')))
        self.doc = doc
        self.server.sessions['test'] = dict(document=doc, png=self.png, changes=[record,material], history=[], next_id=91)

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join(3); self.temp.cleanup()

    def post(self, route, data=None, authorized=True):
        headers = {'Content-Type':'application/json','Origin':self.origin}
        if authorized: headers['X-Wall-Token'] = self.server.token
        try:
            with self.opener.open(Request(self.origin+route, data=json.dumps(data or {}).encode(), headers=headers)) as response:
                return response.status, json.load(response)
        except HTTPError as error:
            return error.code, json.load(error)

    def save(self):
        status, saved = self.post('/api/save-project', dict(run_id='test'))
        self.assertEqual(status, 200)
        return saved['saved_name'], self.root/'projects'/saved['saved_name']

    def test_restore_after_session_loss_preserves_everything_without_recognition(self):
        name, folder = self.save()
        self.server.sessions.clear()
        with patch('web_server.recognize_upload', side_effect=AssertionError('Must not recognize')):
            status, result = self.post('/api/open-project', dict(project_id=name))
        self.assertEqual(status, 200)
        self.assertEqual(result['document'], self.doc)
        self.assertEqual(result['history_size'], 0)
        self.assertEqual(len(result['changes']), 2)
        with self.opener.open(self.origin+result['image_url']) as response:
            self.assertEqual(response.read(), self.png)
        run_id = result['run_id']
        status, edited = self.post('/api/apply-edit', dict(run_id=run_id, type='missing_wall', region_px=[40,210,140,220]))
        self.assertEqual(status, 200)
        self.assertIn('W091', [w['id'] for w in edited['document']['walls']])
        status, saved = self.post('/api/save-project', dict(run_id=run_id))
        self.assertEqual(status, 200); self.assertNotEqual(saved['saved_name'], name)
        self.assertEqual(json.loads((folder/'walls.json').read_text(encoding='utf-8')), self.doc)
        status, undone = self.post('/api/undo-edit', dict(run_id=run_id))
        self.assertEqual(status, 200); self.assertEqual(undone['document'], self.doc)

    def test_old_snapshot_without_metadata_uses_reserved_and_removed_ids(self):
        name, folder = self.save(); (folder/'project.json').unlink()
        doc = deepcopy(self.doc); del doc['furniture']; del doc['room_partition']; del doc['room_edits']
        doc['opening_wall_ids']['retired'] = 'W200'
        (folder/'walls.json').write_text(json.dumps(doc), encoding='utf-8')
        (folder/'changes.json').write_text(json.dumps([dict(id='W250', type='false_positive')]), encoding='utf-8')
        run = load_project(self.root/'projects', name)
        self.assertEqual(run['next_id'], 251)
        self.assertEqual(run['document']['furniture'], [])
        self.assertEqual(run['document']['walls'], doc['walls'])

    def test_list_empty_valid_and_damaged_projects(self):
        self.assertEqual(self.post('/api/projects')[1]['projects'], [])
        name, folder = self.save()
        broken = folder.parent/'broken'; broken.mkdir(); (broken/'walls.json').write_text('{')
        status, result = self.post('/api/projects')
        self.assertEqual(status, 200)
        valid = next(p for p in result['projects'] if p['id'] == name)
        self.assertEqual(valid['room_count'], self.doc['room_partition']['region_count'])
        self.assertTrue(valid['calibrated'])
        self.assertIn('error', next(p for p in result['projects'] if p['id'] == 'broken'))

    def test_bad_paths_token_and_missing_projects_leave_sessions_untouched(self):
        self.assertEqual(self.post('/api/projects', authorized=False)[0], 403)
        self.assertEqual(self.post('/api/open-project', dict(project_id='test'), authorized=False)[0], 403)
        for name in ('../feedback', '/etc', '..', r'..\feedback', 'absent', None):
            self.assertEqual(self.post('/api/open-project', dict(project_id=name))[0], 400)
        self.assertEqual(list(self.server.sessions), ['test'])

    def test_corrupt_snapshot_and_mismatched_image_do_not_replace_session(self):
        name, folder = self.save()
        original = (folder/'walls.json').read_bytes()
        for value in ('{', '[]', json.dumps({**self.doc, 'schema_version':'99.0'}),
                      json.dumps({**self.doc, 'scale_mm_per_px':float('nan')})):
            (folder/'walls.json').write_text(value, encoding='utf-8')
            self.assertEqual(self.post('/api/open-project', dict(project_id=name))[0], 400)
        (folder/'walls.json').write_bytes(original)
        (folder/'floorplan.png').write_bytes(b'bad image')
        self.assertEqual(self.post('/api/open-project', dict(project_id=name))[0], 400)
        (folder/'floorplan.png').unlink()
        self.assertEqual(self.post('/api/open-project', dict(project_id=name))[0], 400)
        self.assertEqual(list(self.server.sessions), ['test'])
        self.assertEqual(self.server.sessions['test']['document'], self.doc)


if __name__ == '__main__': unittest.main()
