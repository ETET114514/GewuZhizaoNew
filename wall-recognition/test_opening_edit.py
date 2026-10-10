from copy import deepcopy
import hashlib
from io import BytesIO
import json
from pathlib import Path
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, build_opener, ProxyHandler

from PIL import Image
from opening_editing import apply_opening_edit
from model_settings import apply_model_settings
from project_store import load_project
from refine_walls import initialize_refinement, segment
from web_server import ReviewServer


def fixture(vertical=False):
    image = Image.new('RGB', (500, 500), 'white')
    axis = 1 if vertical else 0
    walls = [dict(id='W001', **segment(axis, 20, 100, 200, 20)),
             dict(id='W002', **segment(axis, 200, 480, 200, 20))]
    opening = dict(id='O001', kind='window', review_status='confirmed', **segment(axis, 100, 200, 200, 20))
    png = BytesIO(); image.save(png, 'PNG')
    doc = dict(schema_version='0.3.0', image=dict(width_px=500, height_px=500,
               sha256=hashlib.sha256(png.getvalue()).hexdigest()), walls=walls, openings=[opening], furniture=[],
               scale_mm_per_px=10, coordinate_system='image_pixels')
    return initialize_refinement(doc, image), png.getvalue()


class OpeningEditTests(unittest.TestCase):
    def test_move_refills_old_gap_and_cuts_new_gap_in_both_orientations(self):
        for vertical in (False, True):
            doc, _ = fixture(vertical);before=deepcopy(doc)
            result, _ = apply_opening_edit(doc, dict(opening_id='O001', center_px=300))
            axis=1 if vertical else 0
            self.assertEqual(doc, before)
            self.assertTrue(any(p['start_px'][axis] < 150 < p['end_px'][axis] for p in result['solid_wall_segments']))
            self.assertFalse(any(p['start_px'][axis] < 300 < p['end_px'][axis] for p in result['solid_wall_segments']))
            self.assertEqual(result['openings'][0]['host_wall_id'], 'W002')
            again, _ = apply_opening_edit(result, dict(opening_id='O001', center_px=150))
            self.assertTrue(any(p['start_px'][axis] < 300 < p['end_px'][axis] for p in again['solid_wall_segments']))

    def test_dimensions_floor_glass_and_host_endpoint_clamp(self):
        doc, _ = fixture()
        result, _ = apply_opening_edit(doc, dict(opening_id='O001', dimensions_mm=dict(width_mm=800), center_px=490, preset='floor_glass'))
        o=result['openings'][0]
        self.assertEqual(o['start_px'], [400,200]);self.assertEqual(o['end_px'], [480,200])
        self.assertEqual(o['dimensions_mm'], dict(width_mm=800,height_mm=2800,sill_height_mm=0))

    def test_invalid_edits_do_not_mutate_and_cannot_cross_gap_or_overlap(self):
        doc, _ = fixture();before=deepcopy(doc)
        invalid=[dict(dimensions_mm=dict(width_mm=5000)),dict(dimensions_mm=dict(height_mm=2500)),
                 dict(dimensions_mm=dict(width_mm=True)),dict(dimensions_mm=dict(height_mm=float('nan'))),
                 dict(center_px=float('inf')),dict(dimensions_mm=dict(unknown=1))]
        for request in invalid:
            with self.assertRaises(ValueError):apply_opening_edit(doc, dict(opening_id='O001', **request))
            self.assertEqual(doc,before)
        doc['openings'].append(dict(id='O002',kind='door',review_status='confirmed',**segment(0,300,400,200,20)))
        with self.assertRaisesRegex(ValueError,'重叠'):apply_opening_edit(doc,dict(opening_id='O001',center_px=350))
        doc,_=fixture();doc['walls'].append(dict(id='W090',**segment(0,490,500,200,20)))
        result,_=apply_opening_edit(doc,dict(opening_id='O001',center_px=500))
        self.assertEqual(result['openings'][0]['end_px'][0],480)

    def test_scale_confirmation_and_door_grounding(self):
        doc,_=fixture();doc['scale_mm_per_px']=None
        with self.assertRaisesRegex(ValueError,'标定'):apply_opening_edit(doc,dict(opening_id='O001'))
        doc,_=fixture();doc['openings'][0].update(requires_confirmation=True,review_status='unreviewed')
        with self.assertRaises(ValueError):apply_opening_edit(doc,dict(opening_id='O001'))
        doc,_=fixture();doc['openings'][0]['kind']='door'
        with self.assertRaisesRegex(ValueError,'地面'):apply_opening_edit(doc,dict(opening_id='O001',dimensions_mm=dict(sill_height_mm=100)))
        with self.assertRaises(ValueError):apply_opening_edit(doc,dict(opening_id='O001',preset='floor_glass'))

    def test_recalibration_retains_image_geometry_and_updates_individual_width(self):
        doc,_=fixture()
        edited,_=apply_opening_edit(doc,dict(opening_id='O001',dimensions_mm=dict(width_mm=800)))
        resized,_=apply_model_settings(edited,dict(calibration=dict(points_px=[[0,0],[100,0]],length_mm=2000)))
        self.assertEqual(resized['openings'][0]['start_px'],edited['openings'][0]['start_px'])
        self.assertEqual(resized['openings'][0]['end_px'],edited['openings'][0]['end_px'])
        self.assertEqual(resized['openings'][0]['dimensions_mm']['width_mm'],1600)

    def test_custom_height_blocks_incompatible_global_wall_height_and_preserves_rooms(self):
        doc,_=fixture();doc['room_partition']=dict(regions=[dict(id='R001',name='阳台',floor=dict(material='wood'))])
        result,_=apply_opening_edit(doc,dict(opening_id='O001',center_px=300,preset='floor_glass'))
        self.assertEqual(result['room_partition']['regions'],doc['room_partition']['regions'])
        self.assertTrue(result['room_partition']['opening_geometry_changed'])
        with self.assertRaisesRegex(ValueError,'墙高'):apply_model_settings(result,dict(settings=dict(wall_height_mm=2500)))

    def test_api_edit_save_reload_undo_and_rejected_edit_history(self):
        doc,png=fixture()
        with tempfile.TemporaryDirectory() as directory:
            server=ReviewServer(('127.0.0.1',0),Path(directory)/'feedback')
            server.sessions['test']=dict(document=doc,png=png,changes=[],history=[],next_id=10)
            thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            origin=f'http://127.0.0.1:{server.server_address[1]}'
            opener=build_opener(ProxyHandler({}))
            def post(route,**data):
                request=Request(origin+route,data=json.dumps(dict(run_id='test',**data)).encode(),headers={'Content-Type':'application/json','Origin':origin,'X-Wall-Token':server.token})
                try:
                    with opener.open(request) as response:return response.status,json.load(response)
                except HTTPError as error:return error.code,json.load(error)
            try:
                for path in ['/opening-ui.js','/opening-edit.mjs']:
                    with opener.open(origin+path) as response:self.assertEqual(response.status,200)
                status,result=post('/api/edit-opening',opening_id='O001',center_px=300,preset='floor_glass')
                self.assertEqual(status,200);self.assertEqual(result['history_size'],1)
                status,_=post('/api/edit-opening',opening_id='O001',dimensions_mm=dict(width_mm=10000))
                self.assertEqual(status,400);self.assertEqual(len(server.sessions['test']['history']),1)
                _,saved=post('/api/save-project')
                reopened=load_project(Path(directory)/'projects',saved['saved_name'])
                self.assertEqual(reopened['document'],result['document'])
                status,reclassified=post('/api/review-opening',opening_id='O001',kind='door')
                self.assertEqual(status,200);self.assertEqual(reclassified['document']['openings'][0]['dimensions_mm']['sill_height_mm'],0)
                post('/api/undo-edit')
                status,undo=post('/api/undo-edit')
                self.assertEqual(status,200);self.assertEqual(undo['document'],doc);self.assertEqual(undo['history_size'],0)
            finally:server.shutdown();server.server_close();thread.join(3)


if __name__ == '__main__':unittest.main()
