from copy import deepcopy
import json
import unittest

from recognize_furniture import apply_furniture_edit, furniture_export
import test_projects


def fixture():
    return dict(image=dict(width_px=500, height_px=400), scale_mm_per_px=10,
                furniture=[dict(id='F001', kind='bed', bbox_px=[150,100,250,300],
                                rotation_deg=90, source='manual', review_status='confirmed')])


class FurnitureModelTests(unittest.TestCase):
    def test_fit_turn_preserves_box_at_image_edge_and_appearance_without_scale(self):
        doc=fixture();doc['scale_mm_per_px']=None
        item=doc['furniture'][0];item.update(kind='toilet',bbox_px=[100,0,300,100],rotation_deg=None,
            model_3d=dict(height_mm=700,color='#123456',rotation_deg=0))
        before=deepcopy(doc)
        with self.assertRaisesRegex(ValueError,'旋转后'):
            apply_furniture_edit(doc,dict(action='update',furniture_id='F001',model_3d=dict(rotation_deg=90)))
        for angle in (90,180,270,0):
            result,_=apply_furniture_edit(doc,dict(action='update',furniture_id='F001',model_3d=dict(fit_rotation_deg=angle,rotation_deg=0)))
            updated=result['furniture'][0]
            self.assertEqual(updated['bbox_px'],item['bbox_px'])
            self.assertEqual(updated['model_3d']['height_mm'],700)
            self.assertEqual(updated['model_3d']['color'],'#123456')
            self.assertEqual(updated['model_3d']['fit_rotation_deg'],angle)
        for value in (True,-90,360,45,float('nan'),'90'):
            with self.subTest(value=value),self.assertRaises(ValueError):
                apply_furniture_edit(doc,dict(action='update',furniture_id='F001',model_3d=dict(fit_rotation_deg=value)))
        self.assertEqual(doc,before)

    def test_bathing_type_switch_resets_height_preserves_placement_and_explicit_override(self):
        doc=fixture();item=doc['furniture'][0]
        item.update(kind='wet_area',model_3d=dict(height_mm=2400,elevation_mm=50,rotation_deg=90))
        before=deepcopy(doc)
        bath,_=apply_furniture_edit(doc,dict(action='update',furniture_id='F001',kind='bathtub'))
        self.assertEqual(bath['furniture'][0]['model_3d'],dict(height_mm=550,elevation_mm=50,rotation_deg=90))
        self.assertEqual(bath['furniture'][0]['bbox_px'],item['bbox_px'])
        shower,_=apply_furniture_edit(bath,dict(action='update',furniture_id='F001',kind='shower'))
        self.assertEqual(shower['furniture'][0]['model_3d']['height_mm'],2100)
        custom,_=apply_furniture_edit(shower,dict(action='update',furniture_id='F001',kind='bathtub',model_3d=dict(height_mm=650)))
        self.assertEqual(custom['furniture'][0]['model_3d']['height_mm'],650)
        self.assertEqual(doc,before)

    def test_move_resize_and_appearance_share_2d_data_without_mutating_source(self):
        doc = fixture(); before = deepcopy(doc)
        result, record = apply_furniture_edit(doc, dict(action='update', furniture_id='F001',
            placement_mm=dict(center_x_mm=2500, center_y_mm=1800, width_mm=1200, depth_mm=1600),
            model_3d=dict(height_mm=1300, elevation_mm=200, rotation_deg=35, color='#AAbbCC')))
        item = result['furniture'][0]
        self.assertEqual(item['bbox_px'], [190,100,310,260])
        self.assertEqual(item['model_3d']['color'], '#aabbcc')
        self.assertEqual(item['rotation_deg'], 90)
        self.assertEqual(doc, before)
        self.assertEqual(record['furniture_id'], 'F001')
        self.assertEqual(furniture_export(result)['furniture'][0], item)

    def test_bad_edits_are_atomic(self):
        doc = fixture(); before = deepcopy(doc)
        invalid = [dict(height_mm=0),dict(height_mm=True),dict(elevation_mm=-1),
                   dict(rotation_deg=361),dict(color='red'),dict(height_mm=float('nan')),
                   dict(height_mm=float('inf')),dict(unknown=1)]
        for model in invalid:
            with self.subTest(model=model), self.assertRaises(ValueError):
                apply_furniture_edit(doc, dict(action='update', furniture_id='F001',model_3d=model))
            self.assertEqual(doc,before)
        with self.assertRaisesRegex(ValueError,'旋转后'):
            apply_furniture_edit(doc,dict(action='update',furniture_id='F001',bbox_px=[0,0,100,200],model_3d=dict(rotation_deg=45)))

    def test_2d_edits_preserve_3d_settings_and_reset_is_explicit(self):
        doc=fixture();doc['furniture'][0]['model_3d']=dict(height_mm=1200,color='#abcdef')
        result,_=apply_furniture_edit(doc,dict(action='update',furniture_id='F001',bbox_px=[100,100,200,300]))
        self.assertEqual(result['furniture'][0]['model_3d'],doc['furniture'][0]['model_3d'])
        result,_=apply_furniture_edit(result,dict(action='update',furniture_id='F001',model_3d=None))
        self.assertNotIn('model_3d',result['furniture'][0])

    def test_unscaled_position_and_ambiguous_units_rejected(self):
        doc=fixture();doc['scale_mm_per_px']=None
        placement=dict(center_x_mm=1000,center_y_mm=1000,width_mm=500,depth_mm=500)
        with self.assertRaisesRegex(ValueError,'标定'):
            apply_furniture_edit(doc,dict(action='update',furniture_id='F001',placement_mm=placement))
        with self.assertRaisesRegex(ValueError,'不能同时'):
            apply_furniture_edit(fixture(),dict(action='update',furniture_id='F001',placement_mm=placement,bbox_px=[1,1,20,20]))


class FurnitureModelWorkflowTests(unittest.TestCase):
    setUp=test_projects.ProjectWorkflowTests.setUp
    tearDown=test_projects.ProjectWorkflowTests.tearDown
    post=test_projects.ProjectWorkflowTests.post
    save=test_projects.ProjectWorkflowTests.save

    def test_fit_turn_http_save_reopen_move_and_undo(self):
        self.doc['furniture']=fixture()['furniture'];original=deepcopy(self.doc)
        status,result=self.post('/api/edit-furniture',dict(run_id='test',action='update',furniture_id='F001',model_3d=dict(fit_rotation_deg=90,rotation_deg=0)))
        self.assertEqual(status,200,result);edited=deepcopy(result['document'])
        self.assertEqual(edited['furniture'][0]['bbox_px'],original['furniture'][0]['bbox_px'])
        name,folder=self.save()
        self.assertEqual(json.loads((folder/'furniture.json').read_text(encoding='utf-8'))['furniture'],edited['furniture'])
        status,restored=self.post('/api/open-project',dict(project_id=name))
        self.assertEqual(status,200,restored);self.assertEqual(restored['document'],edited)
        status,moved=self.post('/api/edit-furniture',dict(run_id='test',action='update',furniture_id='F001',placement_mm=dict(center_x_mm=2000,center_y_mm=2000,width_mm=1000,depth_mm=2000)))
        self.assertEqual(status,200,moved);self.assertEqual(moved['document']['furniture'][0]['model_3d']['fit_rotation_deg'],90)
        self.assertEqual(self.post('/api/undo-edit',dict(run_id='test'))[1]['document'],edited)
        self.assertEqual(self.post('/api/undo-edit',dict(run_id='test'))[1]['document'],original)

    def test_http_edit_undo_save_reopen(self):
        self.doc['furniture']=fixture()['furniture']
        original=deepcopy(self.doc)
        status,result=self.post('/api/edit-furniture',dict(run_id='test',action='update',furniture_id='F001',
            placement_mm=dict(center_x_mm=4000,center_y_mm=3000,width_mm=1000,depth_mm=1600),
            model_3d=dict(height_mm=1234,elevation_mm=100,rotation_deg=20,color='#123456')))
        self.assertEqual(status,200,result)
        edited=deepcopy(result['document'])
        name,folder=self.save()
        self.assertEqual(json.loads((folder/'furniture.json').read_text(encoding='utf-8'))['furniture'],edited['furniture'])
        status,restored=self.post('/api/open-project',dict(project_id=name))
        self.assertEqual(status,200,restored);self.assertEqual(restored['document'],edited)
        status,undone=self.post('/api/undo-edit',dict(run_id='test'))
        self.assertEqual(status,200);self.assertEqual(undone['document'],original)
        status,result=self.post('/api/edit-furniture',dict(run_id='test',action='update',furniture_id='F001',model_3d=dict(height_mm=-10)))
        self.assertEqual(status,400)
        self.assertEqual(self.server.sessions['test']['document'],original)
        self.assertEqual(len(self.server.sessions['test']['history']),0)


if __name__=='__main__': unittest.main()
