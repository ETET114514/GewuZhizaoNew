from copy import deepcopy
import json
from pathlib import Path
import tempfile
import threading
import unittest
from urllib.request import Request, build_opener, ProxyHandler

from PIL import Image

from correction_engine import apply_edit
from partition_rooms import partition_rooms
from refine_walls import initialize_refinement, segment
from web_server import ReviewServer


def wall(identifier, axis, a, b, c, thickness=10):
    return dict(id=identifier, **segment(axis, a, b, c, thickness))


def fixture(door=True):
    walls = [wall('W001', 0, 20, 380, 30), wall('W002', 0, 20, 380, 280),
             wall('W003', 1, 30, 280, 20), wall('W004', 1, 30, 280, 380),
             wall('W005', 1, 30, 110, 200), wall('W006', 1, 160, 280, 200)]
    openings = [dict(id='O001', kind='door', review_status='confirmed',
                     **segment(1, 110, 160, 200, 10))] if door else []
    return initialize_refinement(dict(image=dict(width_px=400, height_px=300),
                                     coordinate_system='image pixels', walls=walls, openings=openings,
                                     furniture=[]), Image.new('RGB', (400, 300), 'white'))


class RoomPartitionTests(unittest.TestCase):
    def test_door_splits_rooms_without_changing_real_geometry(self):
        doc = fixture(); before = deepcopy(doc)
        result = partition_rooms(doc)
        self.assertEqual(result['region_count'], 2)
        self.assertEqual(len(result['virtual_boundaries']), 1)
        self.assertEqual(doc, before)
        self.assertEqual(partition_rooms(fixture(False))['region_count'], 1)
        self.assertEqual(result, partition_rooms(doc))

    def test_pending_rejected_or_floating_doors_are_not_barriers(self):
        for changes in [dict(kind='unclassified', requires_confirmation=True, review_status='unreviewed'),
                        dict(review_status='rejected')]:
            doc = fixture(); doc['openings'][0].update(changes)
            self.assertEqual(partition_rooms(doc)['region_count'], 1)
        doc = fixture()
        op = doc['openings'][0]; op.update(segment(1, 110, 160, 260, 10)); op.pop('connection_span')
        result = partition_rooms(doc)
        self.assertEqual(result['region_count'], 1)
        self.assertEqual(result['skipped_opening_ids'], ['O001'])

    def test_window_can_complete_perimeter_and_fractional_leak_stays_open(self):
        doc = fixture(False)
        doc['walls'] = doc['walls'][:4]
        doc['walls'][3] = wall('W004', 1, 30, 100, 380)
        doc['walls'].append(wall('W008', 1, 160, 280, 380))
        doc['openings'] = [dict(id='O002', kind='window', **segment(1, 100, 160, 380, 10))]
        doc = initialize_refinement(doc, Image.new('RGB', (400, 300), 'white'))
        self.assertEqual(partition_rooms(doc)['region_count'], 1)
        doc['openings'] = []
        self.assertEqual(partition_rooms(doc)['region_count'], 0)
        doc = fixture(False)
        doc['walls'][1] = wall('W002', 0, 20, 210, 280)
        doc['walls'].append(wall('W009', 0, 210.2, 380, 280))
        self.assertEqual(partition_rooms(doc)['region_count'], 0)

    def test_furniture_is_not_a_boundary_and_inner_wall_is_a_hole(self):
        doc = fixture(False)
        baseline = partition_rooms(doc)
        doc['furniture'] = [dict(id='F001', bbox_px=[40, 40, 180, 200])]
        self.assertEqual(partition_rooms(doc), baseline)
        doc['walls'].append(wall('W009', 0, 70, 120, 90, 20))
        result = partition_rooms(doc)
        self.assertEqual(result['region_count'], 1)
        self.assertEqual(len(result['regions'][0]['rings_px']), 2)

    def test_edit_recomputes_partition(self):
        doc = fixture(); doc['room_partition'] = partition_rooms(doc)
        result, _, _ = apply_edit(doc, dict(type='false_positive', wall_id='W005'), 20)
        self.assertEqual(result['room_partition']['region_count'], 1)
        self.assertEqual(doc['room_partition']['region_count'], 2)

    def test_empty_and_small_wall_cavities_are_not_rooms(self):
        doc = fixture(False); doc['walls'] = []; doc['openings'] = []
        self.assertEqual(partition_rooms(doc)['regions'], [])
        doc['walls'] = [wall('W001', 0, 20, 35, 20), wall('W002', 0, 20, 35, 35),
                        wall('W003', 1, 20, 35, 20), wall('W004', 1, 20, 35, 35)]
        self.assertEqual(partition_rooms(doc)['regions'], [])

    def test_partition_api_save_geometry_edit_and_undo(self):
        with tempfile.TemporaryDirectory() as temp:
            server = ReviewServer(('127.0.0.1', 0), Path(temp)/'feedback')
            doc = fixture()
            server.sessions['rooms'] = dict(document=doc, png=b'test', history=[], changes=[], next_id=20)
            thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
            origin = f'http://127.0.0.1:{server.server_address[1]}'
            opener = build_opener(ProxyHandler({}))
            def post(route, **data):
                req = Request(origin+route, data=json.dumps(dict(run_id='rooms', **data)).encode(),
                              headers={'X-Wall-Token':server.token, 'Origin':origin, 'Content-Type':'application/json'})
                with opener.open(req) as response: return json.load(response)
            try:
                result = post('/api/partition-rooms')
                self.assertEqual(result['document']['room_partition']['region_count'], 2)
                self.assertEqual(result['document']['walls'], doc['walls'])
                saved = post('/api/save-project')
                folder = Path(temp)/'projects'/saved['saved_name']
                self.assertEqual(json.loads((folder/'regions.json').read_text(encoding='utf-8')), result['document']['room_partition'])
                self.assertEqual(json.loads((folder/'solid-walls.json').read_text(encoding='utf-8'))['solid_wall_segments'], doc['solid_wall_segments'])
                edited = post('/api/apply-edit', type='false_positive', wall_id='W005')
                self.assertEqual(edited['document']['room_partition']['region_count'], 1)
                self.assertEqual(post('/api/undo-edit')['document'], result['document'])
                self.assertEqual(post('/api/undo-edit')['document'], doc)
            finally:
                server.shutdown(); server.server_close(); thread.join(3)


if __name__ == '__main__': unittest.main()
