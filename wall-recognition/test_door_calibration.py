from copy import deepcopy
import unittest

from model_settings import apply_model_settings
from test_opening_edit import fixture
import test_projects


class DoorCalibrationTests(unittest.TestCase):
    def test_selected_door_scales_whole_plan_without_changing_pixel_geometry(self):
        for vertical in (False, True):
            doc, _ = fixture(vertical)
            doc['scale_mm_per_px'] = None
            door = doc['openings'][0];door['kind'] = 'door'
            doc['furniture'] = [dict(id='F001',kind='bed',bbox_px=[250,250,350,400])]
            doc['model_settings'] = dict(width_mode='preset',opening_width_mm=900)
            before = deepcopy(doc)
            result, record = apply_model_settings(doc, dict(door_calibration=dict(opening_id='O001',width_mm=800)))
            self.assertEqual(result['scale_mm_per_px'],8)
            self.assertEqual(result['calibration']['method'],'door_width')
            self.assertEqual(result['calibration']['opening_id'],'O001')
            self.assertEqual(result['calibration']['width_px'],100)
            self.assertEqual(result['model_settings']['width_mode'],'detected')
            for key in ('walls','openings','furniture','solid_wall_segments'):
                self.assertEqual(result[key],before[key])
            self.assertIn('800 mm',record['summary'])
            self.assertEqual(doc,before)

    def test_recalibration_updates_physical_width_and_window_preset(self):
        doc, _ = fixture();door = doc['openings'][0];door['kind']='door'
        door['dimensions_mm'] = dict(width_mm=1000,height_mm=2000)
        window = dict(deepcopy(door),id='O002',kind='window',start_px=[230,200],end_px=[480,200],
                      dimensions_mm=dict(width_mm=2500,height_mm=1500),
                      operation=dict(type='hinged',hinge='start',side='positive',angle_deg=45,axis_mode='width'))
        doc['openings'].append(window)
        result, _ = apply_model_settings(doc,dict(door_calibration=dict(opening_id='O001')))
        self.assertEqual(result['openings'][0]['dimensions_mm']['width_mm'],800)
        self.assertEqual(result['openings'][1]['dimensions_mm']['width_mm'],2000)
        self.assertEqual(result['openings'][1]['operation']['pivot_axis'],'horizontal')
        smaller, _ = apply_model_settings(result,dict(door_calibration=dict(opening_id='O001',width_mm=600)))
        self.assertEqual(smaller['openings'][1]['dimensions_mm']['width_mm'],1500)
        self.assertEqual(smaller['openings'][1]['operation']['pivot_axis'],'vertical')

    def test_invalid_reference_cannot_mutate_plan(self):
        doc, _ = fixture();doc['openings'][0]['kind']='door'
        for request in [None,dict(opening_id='missing'),dict(opening_id='O001',width_mm=True),
                        dict(opening_id='O001',width_mm=float('nan')),dict(opening_id='O001',unexpected=1)]:
            before=deepcopy(doc)
            with self.assertRaises(ValueError):apply_model_settings(doc,dict(door_calibration=request))
            self.assertEqual(doc,before)
        for attributes in [dict(kind='window'),dict(review_status='rejected'),dict(requires_confirmation=True,review_status='unreviewed'),dict(end_px=[103,200])]:
            bad=deepcopy(doc);bad['openings'][0].update(attributes)
            before=deepcopy(bad)
            with self.assertRaises(ValueError):apply_model_settings(bad,dict(door_calibration=dict(opening_id='O001')))
            self.assertEqual(bad,before)
        for key in ('calibration','wall_calibration'):
            with self.assertRaisesRegex(ValueError,'一种'):apply_model_settings(doc,{'door_calibration':dict(opening_id='O001'),key:{}})


class DoorCalibrationWorkflowTests(unittest.TestCase):
    setUp=test_projects.ProjectWorkflowTests.setUp
    tearDown=test_projects.ProjectWorkflowTests.tearDown
    post=test_projects.ProjectWorkflowTests.post
    save=test_projects.ProjectWorkflowTests.save

    def test_unscaled_reference_save_reopen_undo_then_manual_calibration(self):
        self.doc['scale_mm_per_px']=None;self.doc.pop('calibration',None)
        before=deepcopy(self.doc)
        status,result=self.post('/api/model-settings',dict(run_id='test',door_calibration=dict(opening_id='O001',width_mm=800)))
        self.assertEqual(status,200,result);self.assertEqual(result['history_size'],1)
        name,_=self.save()
        status,restored=self.post('/api/open-project',dict(project_id=name))
        self.assertEqual(status,200,restored);self.assertEqual(restored['document'],result['document'])
        self.assertEqual(self.post('/api/undo-edit',dict(run_id='test'))[1]['document'],before)
        status,manual=self.post('/api/model-settings',dict(run_id='test',calibration=dict(points_px=[[0,0],[100,0]],length_mm=2000)))
        self.assertEqual(status,200,manual);self.assertEqual(manual['document']['scale_mm_per_px'],20)
        self.assertNotEqual(manual['document']['calibration'].get('method'),'door_width')


if __name__=='__main__':unittest.main()
