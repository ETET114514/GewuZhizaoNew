from copy import deepcopy
import unittest
from opening_editing import apply_opening_edit
from test_opening_edit import fixture
import test_projects


class OpeningAddTests(unittest.TestCase):
    def test_horizontal_vertical_and_independent_ids(self):
        for vertical in (False, True):
            doc, _ = fixture(vertical)
            before = deepcopy(doc)
            result, record = apply_opening_edit(doc, dict(action='add',kind='door',wall_id='W002',
                center_px=320,dimensions_mm=dict(width_mm=800,height_mm=2100,sill_height_mm=0)))
            opening = result['openings'][-1]
            axis = 1 if vertical else 0
            self.assertEqual(opening['start_px'][axis],280)
            self.assertEqual(opening['end_px'][axis],360)
            self.assertEqual(opening['host_wall_id'],'W002')
            self.assertEqual(record['type'],'opening_add')
            self.assertNotEqual(opening['id'],doc['openings'][0]['id'])
            self.assertEqual(doc,before)
            self.assertTrue(all(not (p['start_px'][axis]<320<p['end_px'][axis])
                                for p in result['walls'][1]['solid_parts']))

    def test_invalid_creation_is_atomic(self):
        doc, _ = fixture();before=deepcopy(doc)
        request=dict(action='add',kind='window',wall_id='W002',center_px=150,
                     dimensions_mm=dict(width_mm=800,height_mm=1500,sill_height_mm=900))
        for change in [dict(kind='other'),dict(wall_id='missing'),dict(dimensions_mm=dict(width_mm=9000)),
                       dict(dimensions_mm=dict(width_mm=800,height_mm=2500,sill_height_mm=900)),
                       dict(center_px=float('nan'))]:
            with self.assertRaises(ValueError):apply_opening_edit(doc,{**request,**change})
            self.assertEqual(doc,before)
        with self.assertRaisesRegex(ValueError,'重叠'):apply_opening_edit(doc,request)
        doc['scale_mm_per_px']=None
        with self.assertRaisesRegex(ValueError,'标定'):apply_opening_edit(doc,{**request,'center_px':320})

    def test_api_save_reload_undo_and_rejected_history(self):
        t=test_projects.ProjectWorkflowTests();t.setUp()
        try:
            doc,png=fixture();t.server.sessions['test'].update(document=doc,png=png,changes=[],history=[])
            status,result=t.post('/api/edit-opening',dict(run_id='test',action='add',kind='window',
                wall_id='W002',center_px=340,dimensions_mm=dict(width_mm=800,height_mm=1500,sill_height_mm=900)))
            self.assertEqual(status,200);self.assertEqual(result['history_size'],1)
            opening_id=result['changes'][-1]['opening_id']
            status,_=t.post('/api/edit-opening',dict(run_id='test',action='add',kind='door',wall_id='W002',center_px=340,dimensions_mm=dict(width_mm=800)))
            self.assertEqual(status,400);self.assertEqual(len(t.server.sessions['test']['history']),1)
            name,_=t.save()
            status,reopened=t.post('/api/open-project',dict(project_id=name))
            self.assertEqual(status,200);self.assertEqual(reopened['document'],result['document'])
            self.assertTrue(any(o['id']==opening_id for o in reopened['document']['openings']))
            status,undo=t.post('/api/undo-edit',dict(run_id='test'))
            self.assertEqual(status,200);self.assertEqual(undo['document'],doc)
        finally:t.tearDown()

    def test_preserves_rooms_materials_and_uses_unique_ids(self):
        doc, _ = fixture()
        doc['room_partition']=dict(regions=[dict(id='R001',name='卧室',floor=dict(material='wood'))])
        # IDs can have holes after exclusions or imported edits.
        doc['openings'][0]['id']='O002'
        result,_=apply_opening_edit(doc,dict(action='add',kind='door',wall_id='W002',center_px=320,
            dimensions_mm=dict(width_mm=800,height_mm=2100,sill_height_mm=0)))
        self.assertEqual(result['openings'][-1]['id'],'O001')
        self.assertEqual(result['room_partition']['regions'],doc['room_partition']['regions'])
        self.assertTrue(result['room_partition']['opening_geometry_changed'])


if __name__=='__main__':unittest.main()
