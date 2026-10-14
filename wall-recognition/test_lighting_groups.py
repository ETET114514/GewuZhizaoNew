from copy import deepcopy
import unittest

from ceiling_design import apply_ceiling_edit, refresh_ceiling_layout, validate_design
from test_ceilings import fixture, edit
from test_projects import ProjectWorkflowTests


def lighting(doc, group=None, scope='project', **patch):
    return apply_ceiling_edit(doc, dict(action='lighting', scope=scope, room_id='R001',
                                       group_name=group, settings=patch))


def grouped_fixture():
    doc = edit(fixture(), kind='light', center_px=[100, 60], light_group='主灯')
    doc = edit(doc, kind='cove', light_group='主灯', intensity=2)
    doc = edit(doc, kind='light', center_px=[200, 60], on=False, intensity=3)
    room = deepcopy(doc['room_partition']['regions'][0])
    room.update(id='R002', style_key='manual:R002', name='另一个房间')
    doc['room_partition']['regions'].append(room)
    doc, _ = apply_ceiling_edit(doc, dict(action='add', room_id='R002',
        settings=dict(kind='light', center_px=[300, 60], light_group='主灯', temperature_k=6000)))
    return doc


class LightingGroupTests(unittest.TestCase):
    def test_room_and_project_scopes_include_coves_and_preserve_geometry(self):
        doc = grouped_fixture(); before = deepcopy(doc)
        result, record = lighting(doc, '主灯', 'room', on=False, intensity=.5, temperature_k=4500)
        self.assertEqual(doc, before)
        self.assertEqual(record['changed_count'], 2)
        values = [c['settings'] for c in result['ceiling_design']['components']]
        self.assertEqual([(v['on'], v['intensity']) for v in values], [(False,.5),(False,.5),(False,3),(True,1)])
        self.assertEqual(result['ceiling_layout']['surfaces'][-1]['emissive'], False)
        self.assertEqual(result['ceiling_layout']['surfaces'][-1]['temperature_k'], 4500)
        for a, b in zip(before['ceiling_layout']['lights'], result['ceiling_layout']['lights']):
            self.assertEqual({k:v for k,v in a.items() if k!='settings'}, {k:v for k,v in b.items() if k!='settings'})
        result, record = lighting(result, '主灯', on=True)
        self.assertEqual(record['target_count'], 3)
        self.assertEqual(record['changed_count'], 2)
        self.assertEqual(result['ceiling_design']['components'][2], before['ceiling_design']['components'][2])

    def test_ungrouped_all_and_partial_patches_keep_individual_parameters(self):
        doc = grouped_fixture()
        result, record = lighting(doc, '', on=True)
        self.assertEqual(record['target_count'], 1)
        self.assertEqual(result['ceiling_design']['components'][2]['settings']['intensity'], 3)
        self.assertEqual(result['ceiling_design']['components'][0], doc['ceiling_design']['components'][0])
        result, record = lighting(doc, temperature_k=5000)
        self.assertEqual(record['target_count'], 4)
        self.assertEqual([c['settings']['on'] for c in result['ceiling_design']['components']], [True,True,False,True])
        self.assertEqual([c['settings']['intensity'] for c in result['ceiling_design']['components']], [1,2,3,1])

    def test_invalid_requests_are_atomic_and_do_not_change_membership(self):
        doc = grouped_fixture(); before = deepcopy(doc)
        for request in [dict(scope='bad'), dict(scope='room', room_id='missing'), dict(group_name=[]),
                        dict(group_name='a'*41), dict(settings={}), dict(settings=dict(on='false')),
                        dict(settings=dict(intensity=True)), dict(settings=dict(intensity=float('nan'))),
                        dict(settings=dict(temperature_k=1500)), dict(settings=dict(size_mm=300))]:
            payload = dict(action='lighting', scope='project', settings=dict(on=False)); payload.update(request)
            with self.subTest(request=request), self.assertRaises(ValueError):
                apply_ceiling_edit(doc, payload)
            self.assertEqual(doc, before)

    def test_orphans_invalid_hosts_and_rejected_rooms_are_skipped(self):
        doc = grouped_fixture()
        doc['room_partition']['regions'][1]['review_status']='rejected'
        doc['ceiling_design']['components'][2]['settings']['host_id']='missing'
        refresh_ceiling_layout(doc)
        result, record = lighting(doc, on=False)
        self.assertEqual(record['target_count'], 2)
        self.assertEqual(record['skipped_count'], 2)
        self.assertEqual(result['ceiling_design']['components'][3],doc['ceiling_design']['components'][3])
        self.assertEqual(result['ceiling_design']['components'][2],doc['ceiling_design']['components'][2])
        with self.assertRaises(ValueError):lighting(doc, '', on=False)

    def test_names_normalized_and_copy_preserves_group_but_old_projects_have_none(self):
        doc = edit(fixture(),kind='light',center_px=[100,60],light_group='  主灯  ')
        self.assertEqual(doc['ceiling_design']['components'][0]['settings']['light_group'],'主灯')
        copied,_=apply_ceiling_edit(doc,dict(action='copy',component_id='C001',settings=dict(center_px=[200,60])))
        self.assertEqual([c['settings']['light_group'] for c in copied['ceiling_design']['components']],['主灯','主灯'])
        for bad in [None, True, 'x'*41, 'a\nb']:
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                edit(fixture(),kind='light',center_px=[100,60],light_group=bad)
        with self.assertRaises(ValueError):edit(fixture(),kind='slab',light_group='主灯')
        old=deepcopy(doc);del old['ceiling_design']['components'][0]['settings']['light_group'];validate_design(old)
        self.assertEqual(old['ceiling_design']['components'][0]['settings']['light_group'],'')
        result,record=lighting(doc,'主灯',on=True)
        self.assertEqual(result,doc);self.assertEqual(record['changed_count'],0)


class LightingWorkflowTests(unittest.TestCase):
    setUp = ProjectWorkflowTests.setUp
    tearDown = ProjectWorkflowTests.tearDown
    post = ProjectWorkflowTests.post
    save = ProjectWorkflowTests.save

    def test_preview_group_commit_noop_undo_save_reopen_and_auth(self):
        self.server.sessions['test']['document']=grouped_fixture()
        self.server.sessions['test']['document']['image']=deepcopy(self.doc['image'])
        before=deepcopy(self.server.sessions['test']['document'])
        payload=dict(run_id='test',action='lighting',scope='project',group_name='主灯',
                     settings=dict(on=False,intensity=.4,temperature_k=4200))
        status,preview=self.post('/api/preview-ceiling',payload)
        self.assertEqual(status,200);self.assertEqual(preview['operation']['changed_count'],3)
        self.assertEqual(self.server.sessions['test']['document'],before)
        self.assertEqual(self.post('/api/edit-ceiling',payload,authorized=False)[0],403)
        status,result=self.post('/api/edit-ceiling',payload)
        self.assertEqual(status,200);self.assertEqual(result['history_size'],1)
        authored=deepcopy(result['document']);name,_=self.save()
        status,noop=self.post('/api/edit-ceiling',payload)
        self.assertEqual(status,200);self.assertEqual(noop['history_size'],1)
        self.assertEqual(noop['operation']['changed_count'],0);self.assertEqual(noop['changes'],result['changes'])
        payload['settings']['intensity']=100
        self.assertEqual(self.post('/api/edit-ceiling',payload)[0],400)
        self.assertEqual(self.server.sessions['test']['document'],authored)
        self.assertEqual(self.post('/api/undo-edit',dict(run_id='test'))[1]['document'],before)
        status,reopened=self.post('/api/open-project',dict(project_id=name))
        self.assertEqual(status,200,reopened);self.assertEqual(reopened['document'],authored)


if __name__ == '__main__':unittest.main()
