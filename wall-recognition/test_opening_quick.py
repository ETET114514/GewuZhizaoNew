from copy import deepcopy
import unittest

from opening_editing import open_openings
import test_opening_edit
import test_projects


def fixture():
    doc,_=test_opening_edit.fixture()
    template=doc['openings'][0]
    doc['scale_mm_per_px']=None
    doc['openings']=[dict(deepcopy(template),id='O001',kind='door'),
        dict(deepcopy(template),id='O002',kind='door',operation=dict(type='hinged',hinge='end',side='positive',angle_deg=35)),
        dict(deepcopy(template),id='O003',kind='window'),
        dict(deepcopy(template),id='O004',kind='window',operation=dict(type='fixed',hinge='start',side='negative',angle_deg=0)),
        dict(deepcopy(template),id='O005',kind='door',requires_confirmation=True,review_status='unreviewed'),
        dict(deepcopy(template),id='O006',kind='window',review_status='rejected')]
    for o in doc['openings']:
        if o['id'] in ('O001','O002','O003'):
            o['operation']={**o.get('operation',dict(type='hinged',hinge='start',side='negative',angle_deg=0)), 'direction_mode':'manual'}
    return doc


class OpeningQuickTests(unittest.TestCase):
    def test_all_scopes_preserve_structure_sides_and_explicit_fixed_windows_without_scale(self):
        doc=fixture();before=deepcopy(doc)
        for kind,expected in [('door',['O001','O002']),('window',['O003']),('all',['O001','O002','O003'])]:
            with self.subTest(kind=kind):
                result,record,report=open_openings(doc,dict(target_kind=kind))
                self.assertEqual(record['opening_ids'],expected)
                self.assertEqual(report['changed_count'],len(expected))
                for old,new in zip(doc['openings'],result['openings']):
                    if old['id'] in expected:
                        op=new.pop('operation');self.assertEqual(op['angle_deg'],90 if old['kind']=='door' else 45)
                        self.assertEqual(op['type'],'hinged')
                        if old['id']=='O002':self.assertEqual((op['hinge'],op['side']),('end','positive'))
                        new.update({'operation':old['operation']} if 'operation' in old else {})
                    self.assertEqual(new,old)
                self.assertEqual(result,before);self.assertEqual(doc,before)

    def test_single_noop_and_invalid_batch_are_atomic(self):
        doc=fixture();before=deepcopy(doc)
        edited,record,_=open_openings(doc,dict(target_kind='window',opening_id='O003'))
        self.assertEqual(record['opening_ids'],['O003']);self.assertEqual(edited['openings'][0],doc['openings'][0])
        same,record,report=open_openings(edited,dict(target_kind='window',opening_id='O003'))
        self.assertIsNone(record);self.assertEqual(report['changed_count'],0);self.assertEqual(same,edited)
        fixed,record,report=open_openings(doc,dict(target_kind='window',opening_id='O004'))
        self.assertIsNone(record);self.assertEqual(report['skipped_fixed_count'],1);self.assertEqual(fixed,doc)
        for request in [dict(target_kind='door',opening_id='O003'),dict(target_kind='all',opening_id='missing'),
                        dict(target_kind='all',opening_id=None),dict(target_kind='all',opening_id=True),dict(target_kind='unknown')]:
            with self.subTest(request=request),self.assertRaises(ValueError):open_openings(doc,request)
            self.assertEqual(doc,before)
        bad=deepcopy(doc);bad['openings'][2]['operation']={'type':'hinged','angle_deg':120}
        bad_before=deepcopy(bad)
        with self.assertRaises(ValueError):open_openings(bad,dict(target_kind='all'))
        self.assertEqual(bad,bad_before)


class OpeningQuickWorkflowTests(unittest.TestCase):
    setUp=test_projects.ProjectWorkflowTests.setUp
    tearDown=test_projects.ProjectWorkflowTests.tearDown
    post=test_projects.ProjectWorkflowTests.post
    save=test_projects.ProjectWorkflowTests.save

    def test_batch_one_undo_save_reopen_and_noop_does_not_record_history(self):
        base=self.doc['openings'][0]
        base['operation']=dict(type='hinged',hinge='start',side='negative',angle_deg=0,direction_mode='manual')
        self.doc['openings'].extend([dict(deepcopy(base),id='O002',kind='window'),
            dict(deepcopy(base),id='O003',kind='window',operation=dict(type='fixed',hinge='end',side='positive',angle_deg=0))])
        before=deepcopy(self.doc)
        status,result=self.post('/api/open-openings',dict(run_id='test',target_kind='all'))
        self.assertEqual(status,200,result);self.assertEqual(result['history_size'],1)
        self.assertEqual(result['changed_count'],2);self.assertEqual(result['skipped_fixed_count'],1)
        name,_=self.save()
        status,restored=self.post('/api/open-project',dict(project_id=name))
        self.assertEqual(status,200,restored);self.assertEqual(restored['document'],result['document'])
        status,noop=self.post('/api/open-openings',dict(run_id='test',target_kind='all'))
        self.assertEqual(status,200,noop);self.assertEqual(noop['history_size'],1);self.assertEqual(noop['changed_count'],0)
        status,bad=self.post('/api/open-openings',dict(run_id='test',target_kind='door',opening_id='O002'))
        self.assertEqual(status,400,bad);self.assertEqual(len(self.server.sessions['test']['history']),1)
        status,undone=self.post('/api/undo-edit',dict(run_id='test'))
        self.assertEqual(status,200,undone);self.assertEqual(undone['document'],before);self.assertEqual(undone['history_size'],0)


if __name__=='__main__':unittest.main()
