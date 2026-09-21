from copy import deepcopy
import json
from pathlib import Path
import tempfile
import threading
import unittest
from urllib.request import Request, build_opener, ProxyHandler
from urllib.error import HTTPError

from model_settings import apply_model_settings, DEFAULTS
from web_server import ReviewServer


def fixture():
    return dict(image=dict(width_px=800, height_px=600, sha256='test'),
                coordinate_system='image pixels', walls=[], furniture=[], openings=[], scale_mm_per_px=None)


class ModelSettingsTests(unittest.TestCase):
    def test_scale_and_settings_preserve_pixel_geometry(self):
        doc=fixture();doc['walls']=[{'id':'W001','start_px':[10,20],'end_px':[310,20],'thickness_px':10}]
        before=deepcopy(doc)
        result,_=apply_model_settings(doc,dict(calibration=dict(points_px=[[10,20],[310,20]],length_mm=6000)))
        self.assertEqual(result['scale_mm_per_px'],20)
        self.assertEqual(result['walls'],doc['walls'])
        self.assertEqual(doc,before)
        recalibrated,_=apply_model_settings(result,dict(calibration=dict(points_px=[[10,20],[310,20]],length_mm=3000)))
        self.assertEqual(recalibrated['scale_mm_per_px'],10)
        self.assertEqual(recalibrated['walls'],doc['walls'])
        self.assertEqual(recalibrated['model_settings'],DEFAULTS)

    def test_invalid_values_do_not_mutate_document(self):
        invalid=[dict(settings={'wall_height_mm':float('nan')}),dict(settings={'show_plan':1}),
                 dict(settings={'wall_color':'red'}),dict(settings={'window_height_mm':2000}),
                 dict(settings={'door_height_mm':2900}),dict(settings={'width_mode':'x'}),
                 dict(settings={'door_width_mm':1000}),
                 dict(calibration=dict(points_px=[[0,0],[1,1]],length_mm=10)),
                 dict(calibration=dict(points_px=[[0,0],[801,1]],length_mm=10)),
                 dict(calibration=dict(points_px=[[0,0],[100,0]],length_mm=True))]
        for request in invalid:
            with self.subTest(request=request):
                doc=fixture();before=deepcopy(doc)
                with self.assertRaises(ValueError):apply_model_settings(doc,request)
                self.assertEqual(doc,before)

    def test_api_save_and_undo_calibration_with_settings(self):
        with tempfile.TemporaryDirectory() as temp:
            server=ReviewServer(('127.0.0.1',0),Path(temp)/'feedback')
            server.sessions['model-test']=dict(document=fixture(),history=[],changes=[],next_id=1,png=b'test')
            thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            origin=f'http://127.0.0.1:{server.server_address[1]}'
            opener=build_opener(ProxyHandler({}))
            def post(route,data):
                request=Request(origin+route,data=json.dumps({'run_id':'model-test',**data}).encode(),headers={'X-Wall-Token':server.token,'Origin':origin,'Content-Type':'application/json'})
                with opener.open(request) as response:return json.load(response)
            try:
                first=post('/api/model-settings',dict(calibration=dict(points_px=[[0,0],[300,0]],length_mm=6000)))
                second=post('/api/model-settings',dict(settings={'wall_color':'#336699','show_plan':True}))
                saved=post('/api/save-project',{})
                folder=Path(temp)/'projects'/saved['saved_name']
                stored=json.loads((folder/'walls.json').read_text(encoding='utf-8'))
                solid=json.loads((folder/'solid-walls.json').read_text(encoding='utf-8'))
                self.assertEqual(stored,second['document']);self.assertEqual(solid['scale_mm_per_px'],20)
                restored=post('/api/undo-edit',{})
                self.assertEqual(restored['document'],first['document'])
                with self.assertRaises(HTTPError) as error:post('/api/model-settings',dict(settings={'door_height_mm':9000}))
                self.assertEqual(error.exception.code,400)
                self.assertEqual(post('/api/undo-edit',{})['document'],fixture())
            finally:
                server.shutdown();server.server_close();thread.join()


if __name__=='__main__':unittest.main()
