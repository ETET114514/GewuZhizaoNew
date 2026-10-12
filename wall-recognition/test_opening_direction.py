from copy import deepcopy
import unittest

from opening_direction import opening_context, resolve_direction
from opening_editing import apply_opening_edit, open_openings, validate_operation
from refine_walls import segment, refresh_refinement
import test_rooms
import test_projects


def fixture():
    doc=test_rooms.fixture()
    doc['scale_mm_per_px']=20
    doc['openings'].extend([dict(id='O002',kind='window',review_status='confirmed',**segment(0,270,340,30,10)),
        dict(id='O003',kind='door',review_status='confirmed',**segment(1,70,105,20,10))])
    return refresh_refinement(doc)


class OpeningDirectionTests(unittest.TestCase):
    def test_external_sides_and_ambiguous_interior_door_do_not_depend_on_floor_exclusions(self):
        doc=fixture()
        self.assertEqual(opening_context(doc,doc['openings'][1])['interior_side'],'positive')
        self.assertEqual(opening_context(doc,doc['openings'][2])['interior_side'],'positive')
        context=opening_context(doc,doc['openings'][0]);self.assertIsNone(context['interior_side'])
        self.assertTrue(context['negative']);self.assertTrue(context['positive'])
        op=dict(type='hinged',hinge='start',side='negative',angle_deg=90,direction_mode='auto')
        with self.assertRaisesRegex(ValueError,'归属'):resolve_direction(op,context,'door')
        owner=context['positive'][0]['id']
        self.assertEqual(resolve_direction(dict(op,interior_room_id=owner),context,'door')['side'],'positive')
        self.assertEqual(resolve_direction(dict(op,interior_room_id=owner),context,'window')['side'],'negative')
        with self.assertRaises(ValueError):resolve_direction(dict(op,interior_room_id='missing'),context,'door')
        doc['room_partition']={'regions':[]}
        self.assertEqual(opening_context(doc,doc['openings'][1])['interior_side'],'positive')

    def test_quick_open_defaults_window_outward_45_door_inward_90_and_opens_ambiguous(self):
        doc=fixture();before=deepcopy(doc)
        edited,record,report=open_openings(doc,dict(target_kind='all'))
        self.assertEqual(report['skipped_unknown_count'],0)
        self.assertEqual(report['fallback_direction_count'],1)
        self.assertEqual(record['opening_ids'],['O001','O002','O003'])
        self.assertEqual(edited['openings'][0]['operation']['angle_deg'],90)
        self.assertEqual(edited['openings'][1]['operation']['angle_deg'],45)
        self.assertEqual(edited['openings'][1]['operation']['side'],'negative')
        self.assertEqual(edited['openings'][2]['operation']['angle_deg'],90)
        self.assertEqual(edited['openings'][2]['operation']['side'],'positive')
        self.assertEqual(doc,before);self.assertEqual(edited['walls'],doc['walls'])
        _,record,report=open_openings(edited,dict(target_kind='all'));self.assertIsNone(record)
        self.assertEqual(report['changed_count'],0)

    def test_pivot_axes_bounds_auto_room_and_manual_override_survive_edits(self):
        doc=fixture();before=deepcopy(doc)
        context=opening_context(doc,doc['openings'][0]);owner=context['negative'][0]['id']
        door_op=dict(type='hinged',hinge='end',side='positive',angle_deg=90,pivot_axis='vertical',pivot_ratio=.8,direction_mode='auto',interior_room_id=owner)
        edited,_=apply_opening_edit(doc,dict(opening_id='O001',operation=door_op))
        self.assertEqual(edited['openings'][0]['operation']['side'],'negative')
        window_op=dict(type='hinged',hinge='top',side='positive',angle_deg=45,pivot_axis='horizontal',pivot_ratio=1,direction_mode='auto')
        edited,_=apply_opening_edit(edited,dict(opening_id='O002',operation=window_op))
        self.assertEqual(edited['openings'][1]['operation']['side'],'negative')
        moved,_=apply_opening_edit(edited,dict(opening_id='O002',center_px=290,dimensions_mm={'width_mm':1000}))
        self.assertEqual(moved['openings'][1]['operation'],edited['openings'][1]['operation'])
        manual=dict(window_op,direction_mode='manual',side='positive')
        overridden,_=apply_opening_edit(doc,dict(opening_id='O002',operation=manual))
        self.assertEqual(overridden['openings'][1]['operation']['side'],'positive')
        self.assertEqual(doc,before)
        for values,kind in [(dict(pivot_axis='horizontal',hinge='top'),'door'),(dict(pivot_ratio=True),'window'),
                            (dict(pivot_ratio=1.01),'window'),(dict(pivot_axis='other'),'window'),(dict(interior_room_id=True),'door')]:
            with self.subTest(values=values),self.assertRaises(ValueError):validate_operation(values,kind)


class OpeningDirectionWorkflowTests(unittest.TestCase):
    setUp=test_projects.ProjectWorkflowTests.setUp
    tearDown=test_projects.ProjectWorkflowTests.tearDown
    post=test_projects.ProjectWorkflowTests.post
    save=test_projects.ProjectWorkflowTests.save

    def test_context_read_only_auto_pivot_save_reopen_and_undo(self):
        before=deepcopy(self.doc)
        status,data=self.post('/api/opening-context',dict(run_id='test'))
        self.assertEqual(status,200,data);self.assertEqual(self.server.sessions['test']['history'],[])
        context=data['contexts']['O001'];owner=context['positive'][0]['id']
        op=dict(type='hinged',hinge='end',side='negative',angle_deg=90,pivot_axis='vertical',pivot_ratio=.75,direction_mode='auto',interior_room_id=owner)
        status,edited=self.post('/api/edit-opening',dict(run_id='test',opening_id='O001',operation=op))
        self.assertEqual(status,200,edited);self.assertEqual(edited['document']['openings'][0]['operation']['side'],'positive')
        name,_=self.save();status,opened=self.post('/api/open-project',dict(project_id=name))
        self.assertEqual(status,200,opened);self.assertEqual(opened['document'],edited['document'])
        self.assertEqual(self.post('/api/undo-edit',dict(run_id='test'))[1]['document'],before)
        status,rejected=self.post('/api/edit-opening',dict(run_id='test',opening_id='O001',operation=dict(op,interior_room_id='missing')))
        self.assertEqual(status,400,rejected);self.assertEqual(self.server.sessions['test']['document'],before)


if __name__=='__main__':unittest.main()
