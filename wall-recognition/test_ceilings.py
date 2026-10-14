from copy import deepcopy
import unittest

from shapely.geometry import Polygon
from shapely.ops import unary_union
from ceiling_design import apply_ceiling_edit, refresh_ceiling_layout, validate_design
from project_store import validate_document
import test_projects as project_tests


def fixture(hole=False):
    rings = [[[20,20],[380,20],[380,280],[20,280]]]
    if hole:
        rings.append([[150,100],[200,100],[200,150],[150,150]])
    return dict(schema_version='0.3.0',image=dict(width_px=400,height_px=300,sha256='a'*64),
        scale_mm_per_px=20, coordinate_system='image pixels', walls=[], openings=[], furniture=[],
        room_partition=dict(region_count=1,warnings=[],virtual_boundaries=[],regions=[dict(id='R001',style_key='manual:R001',rings_px=rings,
            polygons_px=[rings],bbox_px=[20,20,380,280],label_px=[100,60])]))


def edit(doc, **settings):
    return apply_ceiling_edit(doc,dict(action='add',room_id='R001',settings=settings))[0]


def area(surface):
    return sum(Polygon(rings[0],rings[1:]).area for rings in surface['polygons_mm'])


class CeilingGeometryTests(unittest.TestCase):
    def test_unconfigured_rooms_have_tops_and_custom_visibility_is_preserved(self):
        doc=fixture();room=deepcopy(doc['room_partition']['regions'][0]);room.update(id='R002',style_key='manual:R002')
        doc['room_partition']['regions'].append(room);doc['model_settings']=dict(wall_height_mm=3000)
        doc,_=apply_ceiling_edit(doc,dict(action='room',room_id='R001',settings=dict(height_mm=2600,visible=False)))
        self.assertEqual(len(doc['ceiling_design']['rooms']),1)
        tops=doc['ceiling_layout']['surfaces'];self.assertEqual(len(tops),2)
        self.assertEqual([s['bottom_mm'] for s in tops],[2600,3000]);self.assertEqual([s['visible'] for s in tops],[False,True])
    def test_old_projects_stay_identical_and_require_calibration(self):
        doc=fixture();before=deepcopy(doc);refresh_ceiling_layout(doc);self.assertEqual(doc,before)
        doc['scale_mm_per_px']=None
        with self.assertRaises(ValueError):edit(doc,kind='slab')

    def test_holes_concavity_and_multi_polygons_preserved(self):
        doc=edit(fixture(True),kind='slab',drop_mm=250)
        top=doc['ceiling_layout']['surfaces'][0];slab=doc['ceiling_layout']['surfaces'][1]
        self.assertAlmostEqual(area(top),(360*260-50*50)*400)
        self.assertAlmostEqual(area(top),area(slab));self.assertEqual(slab['bottom_mm'],2550)
        self.assertEqual(len(top['polygons_mm'][0]),2)

    def test_step_levels_nonoverlap_and_installation_faces(self):
        doc=edit(fixture(),kind='slab',style='stepped',levels=3,width_mm=400,drop_mm=200,step_mm=100)
        surfaces=[s for s in doc['ceiling_layout']['surfaces'][1:] if s['role']=='ceiling']
        self.assertEqual([s['id'] for s in surfaces],['C001','C001:2','C001:3'])
        self.assertEqual([s['bottom_mm'] for s in surfaces],[2600,2500,2400])
        polys=[unary_union([Polygon(r[0],r[1:]) for r in s['polygons_mm']]) for s in surfaces]
        self.assertTrue(all(polys[i].intersection(polys[j]).area<1 for i in range(3) for j in range(i)))
        doc=edit(doc,kind='light',host_id='C001:2',center_px=[55,100],size_mm=100)
        self.assertEqual(doc['ceiling_layout']['lights'][0]['mount_mm'],2500)

    def test_local_outline_rejects_hole_crossing_and_self_intersection(self):
        for points in ([[[100,80],[220,80],[220,170],[100,170]]], [[[30,30],[80,80],[30,80],[80,30]]]):
            with self.assertRaises(ValueError):edit(fixture(True),kind='slab',style='local',points_px=points[0])
        doc=edit(fixture(True),kind='slab',style='local',points_px=[[30,30],[130,30],[130,90],[30,90]])
        self.assertAlmostEqual(area(doc['ceiling_layout']['surfaces'][1]),100*60*400)

    def test_cove_has_channel_bottom_lip_and_led(self):
        doc=edit(fixture(),kind='cove',channel_width_mm=120,channel_height_mm=60)
        parts=doc['ceiling_layout']['surfaces'][1:]
        self.assertEqual([p['role'] for p in parts],['cove','cove','cove','strip'])
        self.assertTrue(parts[-1]['emissive']);self.assertEqual(parts[0]['bottom_mm'],2740)
        doc,_=apply_ceiling_edit(doc,dict(action='update',component_id='C001',settings=dict(on=False)))
        self.assertFalse(doc['ceiling_layout']['surfaces'][-1]['emissive'])

    def test_light_follows_host_and_cannot_delete_mount(self):
        doc=edit(fixture(),kind='slab',drop_mm=300)
        doc=edit(doc,kind='light',host_id='C001',center_px=[100,60],hanging_mm=600,depth_mm=100,light_type='pendant')
        self.assertEqual(doc['ceiling_layout']['lights'][0]['bottom_mm'],1800)
        doc,_=apply_ceiling_edit(doc,dict(action='update',component_id='C001',settings=dict(drop_mm=400)))
        self.assertEqual(doc['ceiling_layout']['lights'][0]['bottom_mm'],1700)
        with self.assertRaises(ValueError):apply_ceiling_edit(doc,dict(action='delete',component_id='C001'))
        doc,_=apply_ceiling_edit(doc,dict(action='room',room_id='R001',settings=dict(height_mm=3000)))
        self.assertEqual(doc['ceiling_layout']['lights'][0]['bottom_mm'],1900)

    def test_invalid_edits_atomic_and_parent_cannot_invalidate_children(self):
        doc=edit(fixture(),kind='slab',style='border',width_mm=400)
        doc=edit(doc,kind='light',host_id='C001',center_px=[30,60],size_mm=100)
        before=deepcopy(doc)
        for request in [dict(action='update',component_id='C001',settings=dict(width_mm=50)),
            dict(action='update',component_id='C002',settings=dict(host_id='bad')),
            dict(action='update',component_id='C001',settings=dict(drop_mm=2700))]:
            with self.assertRaises(ValueError):apply_ceiling_edit(doc,request)
            self.assertEqual(doc,before)

    def test_orphans_are_preserved_and_never_attach_to_reused_room_id(self):
        doc=edit(fixture(),kind='light',center_px=[100,60]);authored=deepcopy(doc['ceiling_design'])
        doc['room_partition']['regions'][0]['style_key']='different'
        refresh_ceiling_layout(doc)
        self.assertEqual(doc['ceiling_design'],authored);self.assertFalse(doc['ceiling_layout']['lights']);self.assertTrue(doc['ceiling_layout']['warnings'])
        restored,_=apply_ceiling_edit(doc,dict(action='rebind',component_id='C001',room_id='R001'))
        self.assertEqual(len(restored['ceiling_layout']['lights']),1);self.assertEqual(restored['ceiling_design']['components'][0]['room_key'],'different')

    def test_concave_and_disconnected_room_surfaces_preserve_area(self):
        doc=fixture();rings=[[[20,20],[100,20],[100,80],[60,80],[60,140],[20,140]]]
        second=[[[200,200],[250,200],[250,250],[200,250]]]
        doc['room_partition']['regions'][0]['polygons_px']=[rings,second]
        doc=edit(doc,kind='slab')
        surface=doc['ceiling_layout']['surfaces'][0]
        self.assertEqual(len(surface['polygons_mm']),2)
        self.assertAlmostEqual(area(surface),(80*60+40*60+50*50)*400)

    def test_copy_has_independent_id_and_saved_data_is_validated(self):
        doc=edit(fixture(),kind='light',center_px=[100,60]);original=deepcopy(doc['ceiling_design']['components'][0])
        doc,_=apply_ceiling_edit(doc,dict(action='copy',component_id='C001',settings=dict(center_px=[150,60])))
        self.assertEqual(doc['ceiling_design']['components'][0],original);self.assertEqual(doc['ceiling_design']['components'][1]['id'],'C002')
        validate_document(doc)
        for bad in [float('nan'),True,-1]:
            damaged=deepcopy(doc);damaged['ceiling_design']['components'][0]['settings']['size_mm']=bad
            with self.assertRaises(ValueError):validate_design(damaged)


class CeilingWorkflowTests(unittest.TestCase):
    setUp = project_tests.ProjectWorkflowTests.setUp
    tearDown = project_tests.ProjectWorkflowTests.tearDown
    post = project_tests.ProjectWorkflowTests.post
    save = project_tests.ProjectWorkflowTests.save
    def test_manual_room_reshape_preserves_ceiling_and_fixture_binding(self):
        from room_editing import apply_room_edit
        room=next(r for r in self.doc['room_partition']['regions'] if r['source']=='manual')
        doc,_=apply_ceiling_edit(self.doc,dict(action='add',room_id=room['id'],settings=dict(kind='light',center_px=room['label_px'],size_mm=100)))
        original_key=doc['ceiling_design']['components'][0]['room_key']
        doc,_=apply_room_edit(doc,dict(action='reshape',room_id=room['id'],points_px=[[30,40],[150,40],[150,200],[30,200]]))
        refresh_ceiling_layout(doc)
        self.assertNotEqual(doc['ceiling_design']['components'][0]['room_key'],original_key)
        self.assertEqual(len(doc['ceiling_layout']['lights']),1)
    def test_preview_commit_undo_save_reopen_and_failed_request(self):
        room=self.doc['room_partition']['regions'][0]['id']
        payload=dict(run_id='test',action='add',room_id=room,settings=dict(kind='slab',drop_mm=200))
        before=deepcopy(self.doc)
        status,preview=self.post('/api/preview-ceiling',payload)
        self.assertEqual(status,200);self.assertIn('ceiling_layout',preview['document'])
        self.assertEqual(self.server.sessions['test']['document'],before);self.assertEqual(self.server.sessions['test']['history'],[])
        self.assertEqual(self.post('/api/edit-ceiling',payload,authorized=False)[0],403)
        status,result=self.post('/api/edit-ceiling',payload);self.assertEqual(status,200);self.assertEqual(result['history_size'],1)
        authored=result['document'];name,_=self.save()
        self.assertEqual(self.post('/api/undo-edit',dict(run_id='test'))[1]['document'],before)
        status,reopened=self.post('/api/open-project',dict(project_id=name));self.assertEqual(status,200)
        self.assertEqual(reopened['document'],authored)
        payload['settings']['drop_mm']=3000
        self.assertEqual(self.post('/api/edit-ceiling',payload)[0],400)
        self.assertEqual(self.server.sessions['test']['document'],before)


if __name__ == '__main__':unittest.main()
