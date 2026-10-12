from copy import deepcopy
import json
import unittest

from opening_editing import apply_opening_edit, validate_operation
import test_opening_edit
import test_projects


class OpeningOperationTests(unittest.TestCase):
    def test_direction_only_preserves_all_geometry_rooms_and_scale_even_without_calibration(self):
        for vertical in (False, True):
            for kind in ('door','window'):
                doc,_=test_opening_edit.fixture(vertical)
                doc['openings'][0]['kind']=kind
                doc['scale_mm_per_px']=None
                doc['room_partition']={'regions':[{'id':'R001','name':'房间','floor':{'material':'wood'}}]}
                original=deepcopy(doc)
                for hinge in ('start','end'):
                    for side in ('negative','positive'):
                        operation=dict(type='hinged',hinge=hinge,side=side,angle_deg=35)
                        edited,_=apply_opening_edit(doc,dict(opening_id='O001',operation=operation))
                        self.assertEqual(edited['openings'][0]['operation'],operation)
                        del edited['openings'][0]['operation']
                        self.assertEqual(edited,original)
                        self.assertEqual(doc,original)

    def test_dimension_move_and_recalibration_preserve_operation_and_can_reset(self):
        from model_settings import apply_model_settings
        doc,_=test_opening_edit.fixture()
        op=dict(type='hinged',hinge='end',side='positive',angle_deg=45)
        edited,_=apply_opening_edit(doc,dict(opening_id='O001',operation=op,center_px=300,dimensions_mm={'width_mm':800}))
        changed,_=apply_model_settings(edited,dict(calibration=dict(points_px=[[0,0],[100,0]],length_mm=2000)))
        self.assertEqual(changed['openings'][0]['operation'],op)
        self.assertEqual(changed['openings'][0]['dimensions_mm']['width_mm'],1600)
        reset,_=apply_opening_edit(changed,dict(opening_id='O001',operation=None))
        del changed['openings'][0]['operation']
        self.assertEqual(reset,changed)

    def test_invalid_type_angle_and_direction_are_atomic(self):
        doc,_=test_opening_edit.fixture();before=deepcopy(doc)
        invalid=[[],False,{'angle_deg':True},{'angle_deg':float('nan')},{'angle_deg':91},
                 {'angle_deg':-1},{'hinge':'left'},{'side':1},{'type':'sliding'},
                 {'type':'fixed','angle_deg':45},{'unknown':1}]
        for operation in invalid:
            with self.subTest(operation=operation),self.assertRaises(ValueError):
                apply_opening_edit(doc,dict(opening_id='O001',operation=operation))
            self.assertEqual(doc,before)
        with self.assertRaises(ValueError):validate_operation({'type':'fixed'},'door')
        doc['openings'][0].update(requires_confirmation=True,review_status='unreviewed')
        with self.assertRaises(ValueError):apply_opening_edit(doc,dict(opening_id='O001',operation={'type':'hinged'}))


class OpeningOperationWorkflowTests(unittest.TestCase):
    setUp=test_projects.ProjectWorkflowTests.setUp
    tearDown=test_projects.ProjectWorkflowTests.tearDown
    post=test_projects.ProjectWorkflowTests.post
    save=test_projects.ProjectWorkflowTests.save

    def test_api_save_reopen_undo_and_invalid_saved_operation(self):
        before=deepcopy(self.doc)
        opening=self.doc['openings'][0];op=dict(type='hinged',hinge='end',side='negative',angle_deg=90)
        status,edited=self.post('/api/edit-opening',dict(run_id='test',opening_id=opening['id'],operation=op))
        self.assertEqual(status,200,edited);self.assertEqual(edited['history_size'],1)
        name,folder=self.save()
        status,opened=self.post('/api/open-project',dict(project_id=name))
        self.assertEqual(status,200,opened);self.assertEqual(opened['document'],edited['document'])
        status,bad=self.post('/api/edit-opening',dict(run_id='test',opening_id=opening['id'],operation={'angle_deg':float('inf')}))
        self.assertEqual(status,400,bad);self.assertEqual(len(self.server.sessions['test']['history']),1)
        self.assertEqual(self.post('/api/undo-edit',dict(run_id='test'))[1]['document'],before)
        status,window=self.post('/api/review-opening',dict(run_id=opened['run_id'],opening_id=opening['id'],kind='window'))
        self.assertEqual(status,200,window);self.assertNotIn('operation',window['document']['openings'][0])
        corrupt=deepcopy(edited['document']);corrupt['openings'][0]['operation']['angle_deg']=120
        (folder/'walls.json').write_text(json.dumps(corrupt),encoding='utf-8')
        status,rejected=self.post('/api/open-project',dict(project_id=name))
        self.assertEqual(status,400,rejected)


if __name__=='__main__':unittest.main()
