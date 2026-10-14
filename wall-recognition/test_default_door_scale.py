from copy import deepcopy
import unittest
from unittest.mock import patch

from default_door_scale import estimate_default_door_scale
from test_opening_edit import fixture
import test_projects
import test_opening_direction


class DefaultDoorScaleTests(unittest.TestCase):
    def test_unscaled_plan_is_estimated_without_changing_image_geometry(self):
        for vertical in (False,True):
            doc,_=fixture(vertical);doc['scale_mm_per_px']=None;doc['openings'][0]['kind']='door'
            before=deepcopy(doc);result,record=estimate_default_door_scale(doc)
            self.assertEqual(result['scale_mm_per_px'],8)
            self.assertTrue(result['calibration']['automatic'])
            self.assertEqual(result['calibration']['width_mm'],800)
            for key in ('walls','openings','furniture','solid_wall_segments'):
                self.assertEqual(result[key],before[key])
            self.assertIsNotNone(record);self.assertEqual(doc,before)

    def test_existing_scale_entry_door_pending_and_other_known_widths_are_preserved(self):
        doc,_=fixture();doc['openings'][0]['kind']='door'
        self.assertEqual(estimate_default_door_scale(doc),(doc,None))
        doc['scale_mm_per_px']=None
        for attrs in [dict(door_model='entry'),dict(kind='window'),dict(review_status='rejected'),
                      dict(requires_confirmation=True,review_status='unreviewed'),dict(dimensions_mm=dict(width_mm=900)),
                      dict(end_px=[102,200])]:
            bad=deepcopy(doc);bad['openings'][0].update(attrs)
            self.assertEqual(estimate_default_door_scale(bad),(bad,None))

    def test_internal_reference_precedes_unknown_entry_and_exterior_candidate(self):
        doc=test_opening_direction.fixture();doc['scale_mm_per_px']=None;doc['image']['sha256']='test'
        result,_=estimate_default_door_scale(doc)
        self.assertEqual(result['calibration']['opening_id'],'O001')
        doc['openings'][0]['door_model']='entry'
        self.assertEqual(estimate_default_door_scale(doc),(doc,None))


class DefaultDoorScaleWorkflowTests(unittest.TestCase):
    setUp=test_projects.ProjectWorkflowTests.setUp
    tearDown=test_projects.ProjectWorkflowTests.tearDown
    post=test_projects.ProjectWorkflowTests.post
    save=test_projects.ProjectWorkflowTests.save

    def test_open_unscaled_save_reopen_and_undo_without_reapplying(self):
        self.doc['scale_mm_per_px']=None;self.doc.pop('calibration',None)
        original=deepcopy(self.doc);name,_=self.save()
        status,opened=self.post('/api/open-project',dict(project_id=name))
        self.assertEqual(status,200);self.assertTrue(opened['default_scale_applied'])
        self.assertEqual(opened['history_size'],1);self.assertTrue(opened['document']['calibration']['automatic'])
        run_id=opened['run_id'];self.server.sessions['test']=self.server.sessions[run_id]
        name,_=self.save();status,reopened=self.post('/api/open-project',dict(project_id=name))
        self.assertFalse(reopened['default_scale_applied']);self.assertEqual(reopened['history_size'],0)
        self.assertEqual(reopened['document'],opened['document'])
        status,undo=self.post('/api/undo-edit',dict(run_id=run_id))
        self.assertEqual(undo['document'],original);self.assertEqual(undo['history_size'],0)

    def test_detect_and_cached_detect_have_one_undo_and_keep_cache_pristine(self):
        self.doc['scale_mm_per_px']=None;self.doc.pop('calibration',None)
        source=deepcopy(self.server.sessions['test'])
        source['document']['image']['original_filename']='floorplan.png'
        original_changes=deepcopy(source['changes'])
        with patch('web_server.recognize_upload',return_value=source) as recognize:
            status,first=self.post('/api/detect',{})
            self.assertEqual(status,200);self.assertTrue(first['default_scale_applied'])
            self.assertEqual(first['history_size'],1)
            status,second=self.post('/api/detect',{})
            self.assertEqual(status,200);self.assertTrue(second['cache_hit']);self.assertEqual(recognize.call_count,1)
            self.assertEqual(second['history_size'],1)
            self.assertEqual(first['document'],second['document'])
            cached=next(iter(self.server.recognition_cache.values()))
            self.assertIsNone(cached['document']['scale_mm_per_px']);self.assertEqual(cached['changes'],original_changes)
            status,undo=self.post('/api/undo-edit',dict(run_id=second['run_id']))
            self.assertIsNone(undo['document']['scale_mm_per_px'])

    def test_confirming_first_ordinary_door_estimates_in_the_same_undo(self):
        self.doc['scale_mm_per_px']=None;self.doc.pop('calibration',None)
        self.doc['openings'][0].update(kind='unclassified',review_status='unreviewed',requires_confirmation=True)
        before=deepcopy(self.doc)
        status,result=self.post('/api/review-opening',dict(run_id='test',opening_id='O001',kind='door'))
        self.assertEqual(status,200);self.assertTrue(result['document']['calibration']['automatic'])
        self.assertEqual(result['history_size'],1)
        self.assertEqual(self.post('/api/undo-edit',dict(run_id='test'))[1]['document'],before)


if __name__=='__main__':unittest.main()
