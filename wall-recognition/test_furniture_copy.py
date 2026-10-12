from copy import deepcopy
import json
import unittest

from recognize_furniture import apply_furniture_edit
from test_furniture_model import fixture
import test_projects


class FurnitureCopyTests(unittest.TestCase):
    def test_copy_keeps_both_rotations_and_appearance_without_mutating_detected_source(self):
        doc = fixture()
        doc['furniture'][0].update(source='floorcad_onnx', match_score=.9, evidence={'detected': True},
            prediction={'bbox_px': [150,100,250,300]},
            model_3d=dict(height_mm=1234, elevation_mm=120, color='#123456', rotation_deg=35, fit_rotation_deg=90))
        doc['furniture'].append(dict(id='F008', kind='chair', bbox_px=[10,10,20,20], review_status='rejected'))
        before = deepcopy(doc)
        copied, record = apply_furniture_edit(doc, dict(action='copy', furniture_id='F001', center_px=[320,200]))
        item = copied['furniture'][-1]
        self.assertEqual(item['id'], 'F009')
        self.assertEqual(item['bbox_px'], [270,100,370,300])
        self.assertEqual(item['rotation_deg'], 90)
        self.assertEqual(item['model_3d'], doc['furniture'][0]['model_3d'])
        self.assertEqual(item['copied_from_id'], 'F001')
        self.assertEqual(item['source'], 'manual')
        self.assertIsNone(item['match_score'])
        self.assertNotIn('prediction', item)
        self.assertEqual(record['source_furniture_id'], 'F001')
        self.assertEqual(copied['furniture'][:-1], before['furniture'])
        item['model_3d']['height_mm'] = 777
        self.assertEqual(doc, before)
        self.assertEqual(copied['furniture'][0], before['furniture'][0])

    def test_unscaled_copy_uses_original_pixel_size_and_ignores_replacement_dimensions(self):
        doc = fixture(); doc['scale_mm_per_px'] = None
        doc['furniture'][0]['bbox_px'] = [100.12345,100,110.98765,120.34567]
        copied, _ = apply_furniture_edit(doc, dict(action='copy', furniture_id='F001', center_px=[200,150],
            kind='sofa', model_3d={'color':'#ffffff'}, placement_mm={'width_mm':1000}))
        item = copied['furniture'][-1]
        self.assertEqual(item['kind'], 'bed')
        self.assertNotIn('model_3d', item)
        for axis in (0,1):
            self.assertAlmostEqual(item['bbox_px'][axis+2]-item['bbox_px'][axis],
                                   doc['furniture'][0]['bbox_px'][axis+2]-doc['furniture'][0]['bbox_px'][axis])

    def test_invalid_copy_is_atomic_including_rotated_outside_footprint(self):
        doc = fixture(); doc['furniture'][0]['model_3d'] = dict(rotation_deg=45)
        before = deepcopy(doc)
        for center in (None, [True,100], [float('nan'),100], [100], [-1,200], [50,100]):
            with self.subTest(center=center), self.assertRaises(ValueError):
                apply_furniture_edit(doc, dict(action='copy', furniture_id='F001', center_px=center))
            self.assertEqual(doc, before)
        for kind, status in (('bed','rejected'), ('unclassified','unreviewed'),
                             ('unclassified_area','unreviewed'), ('water_feature','confirmed')):
            bad = deepcopy(doc); bad['furniture'][0].update(kind=kind, review_status=status)
            with self.subTest(kind=kind), self.assertRaises(ValueError):
                apply_furniture_edit(bad, dict(action='copy', furniture_id='F001', center_px=[250,200]))
        with self.assertRaises(ValueError):
            apply_furniture_edit(doc, dict(action='copy', furniture_id='missing', center_px=[250,200]))


class FurnitureCopyWorkflowTests(unittest.TestCase):
    setUp = test_projects.ProjectWorkflowTests.setUp
    tearDown = test_projects.ProjectWorkflowTests.tearDown
    post = test_projects.ProjectWorkflowTests.post
    save = test_projects.ProjectWorkflowTests.save

    def test_copy_save_reopen_edit_independently_and_undo_one_step(self):
        self.doc['furniture'] = [dict(id='F001', kind='chair', label='椅子', bbox_px=[100,100,140,160],
            rotation_deg=None, review_status='confirmed', source='manual',
            model_3d=dict(height_mm=800, elevation_mm=20, color='#abcdef', rotation_deg=30, fit_rotation_deg=90))]
        before = deepcopy(self.doc)
        status, result = self.post('/api/edit-furniture', dict(run_id='test', action='copy', furniture_id='F001', center_px=[250,200]))
        self.assertEqual(status,200,result)
        self.assertEqual(result['history_size'],1)
        copied = deepcopy(result['document'])
        name, folder = self.save()
        self.assertEqual(json.loads((folder/'furniture.json').read_text(encoding='utf-8'))['furniture'], copied['furniture'])
        status, opened = self.post('/api/open-project',dict(project_id=name))
        self.assertEqual(status,200,opened)
        self.assertEqual(opened['document'],copied)
        status, updated = self.post('/api/edit-furniture',dict(run_id=opened['run_id'], action='update', furniture_id='F002', model_3d=dict(color='#123456')))
        self.assertEqual(status,200,updated)
        self.assertEqual(updated['document']['furniture'][0], before['furniture'][0])
        self.assertEqual(self.post('/api/undo-edit',dict(run_id='test'))[1]['document'],before)
        status, rejected = self.post('/api/edit-furniture',dict(run_id='test',action='copy',furniture_id='F001',center_px=[10,10]))
        self.assertEqual(status,400,rejected)
        self.assertEqual(self.server.sessions['test']['document'],before)
        self.assertEqual(self.server.sessions['test']['history'],[])


if __name__ == '__main__':
    unittest.main()
