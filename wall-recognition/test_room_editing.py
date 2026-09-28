from copy import deepcopy
import unittest
import json
from pathlib import Path
import tempfile
import threading
from urllib.request import Request, build_opener, ProxyHandler

from shapely.geometry import Polygon

from model_settings import apply_model_settings
from partition_rooms import partition_rooms
from room_editing import apply_room_edit, geometry_of
from test_rooms import fixture
from web_server import ReviewServer


class RoomEditingTests(unittest.TestCase):
    def test_api_calibration_material_save_and_undo(self):
        with tempfile.TemporaryDirectory() as temp:
            server=ReviewServer(('127.0.0.1',0),Path(temp)/'feedback')
            doc=fixture();doc['image']['sha256']='example';doc['room_partition']=partition_rooms(doc)
            server.sessions['floors']=dict(document=doc,png=b'test',history=[],changes=[],next_id=20)
            thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            origin=f'http://127.0.0.1:{server.server_address[1]}';opener=build_opener(ProxyHandler({}))
            def post(route,**data):
                req=Request(origin+route,data=json.dumps(dict(run_id='floors',**data)).encode(),headers={'X-Wall-Token':server.token,'Origin':origin,'Content-Type':'application/json'})
                with opener.open(req) as response:return json.load(response)
            try:
                calibrated=post('/api/model-settings',wall_calibration=dict(wall_id='W001',thickness_mm=200))
                edited=post('/api/edit-room',action='settings',room_id='R001',name='卧室',floor=dict(material='wood',width_mm=180,length_mm=1200))
                added=post('/api/edit-room',action='add',points_px=[[30,40],[150,40],[150,200],[30,200]])
                saved=post('/api/save-project')
                folder=Path(temp)/'projects'/saved['saved_name']
                self.assertEqual(json.loads((folder/'walls.json').read_text(encoding='utf-8')),added['document'])
                self.assertEqual(json.loads((folder/'regions.json').read_text(encoding='utf-8')),added['document']['room_partition'])
                self.assertEqual(post('/api/undo-edit')['document'],edited['document'])
                self.assertEqual(post('/api/undo-edit')['document'],calibrated['document'])
                self.assertEqual(post('/api/undo-edit')['document'],doc)
            finally:
                server.shutdown();server.server_close();thread.join(3)

    def test_thickness_estimate_is_explicit_and_keeps_geometry(self):
        doc=fixture();doc['image']['sha256']='sample';before=deepcopy(doc)
        result,_=apply_model_settings(doc,dict(wall_calibration=dict(wall_id='W001',thickness_mm=200)))
        self.assertEqual(result['scale_mm_per_px'],20)
        self.assertEqual(result['calibration']['method'],'wall_thickness')
        self.assertEqual(result['walls'],doc['walls']);self.assertEqual(doc,before)
        measured,_=apply_model_settings(result,dict(calibration=dict(points_px=[[0,0],[100,0]],length_mm=1000)))
        self.assertEqual(measured['scale_mm_per_px'],10)
        self.assertNotEqual(measured['calibration'].get('method'),'wall_thickness')
        for request in [dict(wall_id='W007',thickness_mm=200),dict(wall_id='W001',thickness_mm=True),dict(wall_id='missing',thickness_mm=200)]:
            with self.assertRaises(ValueError):apply_model_settings(doc,dict(wall_calibration=request))

    def test_material_persists_on_repartition_without_changing_walls(self):
        doc=fixture();doc['room_partition']=partition_rooms(doc)
        changed,_=apply_room_edit(doc,dict(action='settings',room_id='R001',name='卧室',floor=dict(material='wood',color='#bb8855',width_mm=180,length_mm=1200,angle_deg=90)))
        result=partition_rooms(changed)
        self.assertEqual(result['regions'][0]['name'],'卧室')
        self.assertEqual(result['regions'][0]['floor']['material'],'wood')
        self.assertEqual(changed['solid_wall_segments'],doc['solid_wall_segments'])
        self.assertNotIn('room_edits',doc)

    def test_manual_polygon_split_merge_reshape_delete(self):
        doc=fixture(False);doc['walls']=[];doc['solid_wall_segments']=[]
        initial,_=apply_room_edit(doc,dict(action='add',points_px=[[20,20],[200,20],[200,200],[20,200]]))
        self.assertEqual(initial['room_partition']['region_count'],1)
        additional,_=apply_room_edit(initial,dict(action='add',room_id='U001',points_px=[[220,20],[260,20],[260,80],[220,80]]))
        self.assertEqual(additional['room_partition']['region_count'],2)
        self.assertTrue(any(r['id']=='U001' for r in additional['room_partition']['regions']))
        split_doc,_=apply_room_edit(initial,dict(action='split',room_id='U001',points_px=[[0,100],[250,100]]))
        rooms=split_doc['room_partition']['regions'];self.assertEqual(len(rooms),2)
        self.assertAlmostEqual(sum(geometry_of(r).area for r in rooms),180*180)
        merged,_=apply_room_edit(split_doc,dict(action='merge',room_id=rooms[0]['id'],target_room_id=rooms[1]['id']))
        self.assertEqual(merged['room_partition']['region_count'],1)
        identifier=merged['room_partition']['regions'][0]['id']
        shaped,_=apply_room_edit(merged,dict(action='reshape',room_id=identifier,points_px=[[20,20],[150,20],[150,80],[80,80],[80,200],[20,200]]))
        self.assertEqual(len(shaped['room_partition']['regions'][0]['rings_px'][0]),6)
        deleted,_=apply_room_edit(shaped,dict(action='delete',room_id=shaped['room_partition']['regions'][0]['id']))
        self.assertEqual(partition_rooms(deleted)['region_count'],0)
        self.assertEqual(initial['room_partition']['region_count'],1)

    def test_manual_overrides_auto_and_clips_walls_without_overlap(self):
        doc=fixture()
        result,_=apply_room_edit(doc,dict(action='add',points_px=[[0,0],[240,0],[240,300],[0,300]]))
        rooms=result['room_partition']['regions']
        manual=next(r for r in rooms if r['source']=='manual')
        self.assertFalse(geometry_of(manual).contains(Polygon([(190,40),(210,40),(210,80),(190,80)])))
        for other in rooms:
            if other!=manual:self.assertLess(geometry_of(other).intersection(geometry_of(manual)).area,.01)
        self.assertEqual(partition_rooms(result),result['room_partition'])

    def test_invalid_edits_are_atomic(self):
        doc=fixture();doc['room_partition']=partition_rooms(doc);before=deepcopy(doc)
        invalid=[dict(action='add',points_px=[[20,20],[100,100],[20,100],[100,20]]),
                 dict(action='add',points_px=[[-1,0],[100,0],[100,100]]),
                 dict(action='split',room_id='R001',points_px=[[0,0],[1,1]]),
                 dict(action='settings',room_id='R001',floor={'material':'unknown'}),
                 dict(action='settings',room_id='R001',floor={'length_mm':float('nan')}),
                 dict(action='merge',room_id='R001',target_room_id='R001')]
        for request in invalid:
            with self.assertRaises(ValueError):apply_room_edit(doc,request)
            self.assertEqual(doc,before)


if __name__=='__main__':unittest.main()
