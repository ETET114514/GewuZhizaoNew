from copy import deepcopy
import hashlib
from io import BytesIO
import json
from pathlib import Path
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, build_opener, ProxyHandler

from PIL import Image

from closure_diagnostics import diagnose_closure, preview_gap, resolve_gap
from partition_rooms import partition_rooms
from refine_walls import initialize_refinement, segment, refresh_refinement
from test_rooms import fixture, wall
from web_server import ReviewServer


def leaking_room():
    doc = fixture(False)
    doc['walls'] = doc['walls'][:4]
    doc['walls'][0] = wall('W001', 0, 20, 170, 30)
    doc['walls'].append(wall('W008', 0, 210, 380, 30))
    return refresh_refinement(doc)


def request_for(doc, action='confirm'):
    report = diagnose_closure(doc)
    return dict(revision=report['revision'], candidate_id=report['candidates'][0]['id'], action=action)


class ClosureTests(unittest.TestCase):
    def test_preview_is_immutable_confirmation_closes_room(self):
        doc = leaking_room(); before = deepcopy(doc)
        request = request_for(doc)
        preview = preview_gap(doc, request, 20)
        self.assertEqual((preview['before_count'], preview['after_count']), (0, 1))
        self.assertEqual(doc, before)
        result, record, next_id = resolve_gap(doc, request, 20)
        self.assertEqual(result['room_partition']['region_count'], 1)
        self.assertEqual(next_id, 21)
        self.assertEqual(record['wall_ids'], ['W020'])
        self.assertEqual(result['walls'][:-1], doc['walls'])
        self.assertEqual(len(result['solid_wall_segments']), len(doc['solid_wall_segments'])+1)
        self.assertEqual(diagnose_closure(result)['candidates'], [])

    def test_closed_room_has_no_gap_and_open_end_is_not_proof(self):
        doc = fixture(); doc['walls'] = doc['walls'][:4]; doc['openings'] = []
        doc = refresh_refinement(doc)
        report = diagnose_closure(doc)
        self.assertEqual(report['automatic_region_count'], 1)
        self.assertEqual(report['candidates'], [])
        doc['walls'] = [wall('W001', 0, 20, 100, 100)]
        report = diagnose_closure(refresh_refinement(doc))
        self.assertEqual(len(report['free_ends']), 2)
        self.assertEqual(report['candidates'], [])

    def test_collinear_corner_junction_and_rotation(self):
        for target, count in [(wall('W002', 0, 130, 250, 100), 1),
                              (wall('W002', 1, 130, 250, 130), 2),
                              (wall('W002', 1, 20, 250, 130), 1)]:
            for transpose in (False, True):
                walls = [wall('W001', 0, 20, 100, 100), deepcopy(target)]
                if transpose:
                    walls = [dict(w, **segment(1 if w['orientation']=='horizontal' else 0,
                        w['start_px'][0 if w['orientation']=='horizontal' else 1],
                        w['end_px'][0 if w['orientation']=='horizontal' else 1],
                        w['start_px'][1 if w['orientation']=='horizontal' else 0],10)) for w in walls]
                doc=initialize_refinement(dict(image=dict(width_px=400,height_px=400),walls=walls,openings=[]),Image.new('RGB',(400,400)))
                report=diagnose_closure(doc)
                self.assertEqual(len(report['candidates']),1)
                self.assertEqual(len(report['candidates'][0]['pieces']),count)
                self.assertEqual(preview_gap(doc,request_for(doc),20)['after_count'],0)

    def test_all_opening_candidates_and_manual_hints_are_protected(self):
        for kind in ('door','window','unclassified'):
            doc=leaking_room()
            doc['openings']=[dict(id='O010',kind=kind,review_status='unreviewed',
                requires_confirmation=kind=='unclassified',**segment(0,170,210,30,10))]
            doc=initialize_refinement(doc,Image.new('RGB',(400,300)))
            self.assertEqual(diagnose_closure(doc)['candidates'],[])
        doc=leaking_room(); doc['walls'][0]['opening_hints']=[dict(id='H1',**segment(0,168,170,30,10))]
        self.assertEqual(diagnose_closure(refresh_refinement(doc))['candidates'],[])

    def test_fractional_gap_long_gap_offset_and_third_wall(self):
        doc=leaking_room();doc['walls'][-1]=wall('W008',0,170.2,380,30)
        self.assertEqual(len(diagnose_closure(refresh_refinement(doc))['candidates']),1)
        doc=leaking_room();doc['walls'][-1]=wall('W008',0,300,380,30)
        self.assertEqual(diagnose_closure(refresh_refinement(doc))['candidates'],[])
        doc=leaking_room();doc['walls'][-1]=wall('W008',0,210,380,34)
        self.assertEqual(diagnose_closure(refresh_refinement(doc))['candidates'],[])
        doc=leaking_room();doc['walls'].append(wall('W009',1,10,90,190))
        report=diagnose_closure(refresh_refinement(doc))
        self.assertFalse(any(c['wall_ids']==['W001','W008'] for c in report['candidates']))

    def test_stale_or_forged_candidate_cannot_modify_geometry(self):
        doc=leaking_room(); request=request_for(doc);before=deepcopy(doc)
        for changes in (dict(revision='stale'),dict(candidate_id='forged'),dict(action='delete')):
            with self.assertRaises(ValueError):resolve_gap(doc,{**request,**changes},20)
        self.assertEqual(doc,before)
        doc['walls'].pop()
        with self.assertRaises(ValueError):resolve_gap(doc,request,20)

    def test_ignore_restore_preserve_walls_and_candidate_geometry(self):
        doc=leaking_room();request=request_for(doc,'ignore')
        ignored,_,_=resolve_gap(doc,request,20)
        self.assertEqual(ignored['walls'],doc['walls'])
        self.assertTrue(diagnose_closure(ignored)['candidates'][0]['ignored'])
        with self.assertRaises(ValueError):resolve_gap(ignored,request_for(ignored),20)
        restored,_,_=resolve_gap(ignored,request_for(ignored,'restore'),20)
        self.assertFalse(diagnose_closure(restored)['candidates'][0]['ignored'])
        self.assertEqual(restored['walls'],doc['walls'])

    def test_manual_room_does_not_hide_leak_and_is_preserved(self):
        from room_editing import apply_room_edit
        doc=leaking_room()
        doc,_=apply_room_edit(doc,dict(action='add',points_px=[[50,60],[100,60],[100,120],[50,120]]))
        self.assertEqual(doc['room_partition']['region_count'],1)
        self.assertEqual(diagnose_closure(doc)['automatic_region_count'],0)
        result,_,_=resolve_gap(doc,request_for(doc),20)
        self.assertEqual(result['room_edits'],doc['room_edits'])

    def test_pending_and_unattached_boundaries_reported(self):
        doc=fixture();doc['openings'][0].update(segment(1,110,160,260,10));doc['openings'][0].pop('connection_span',None)
        self.assertEqual(diagnose_closure(doc)['skipped_opening_ids'],['O001'])
        doc['openings'][0].update(kind='unclassified',requires_confirmation=True,review_status='unreviewed')
        self.assertEqual(diagnose_closure(doc)['pending_opening_ids'],['O001'])


class ClosureApiTests(unittest.TestCase):
    def test_read_only_preview_save_reopen_ignore_confirm_and_undo(self):
        from project_store import load_project
        with tempfile.TemporaryDirectory() as temp:
            server=ReviewServer(('127.0.0.1',0),Path(temp)/'feedback')
            thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            origin=f'http://127.0.0.1:{server.server_address[1]}'
            opener=build_opener(ProxyHandler({}))
            def post(path, data):
                try:
                    with opener.open(Request(origin+'/api/'+path,data=json.dumps(dict(run_id='test',**data)).encode(),
                        headers={'Origin':origin,'X-Wall-Token':server.token,'Content-Type':'application/json'})) as response:
                        return response.status,json.load(response)
                except HTTPError as e:return e.code,json.load(e)
            try:
                image=Image.new('RGB',(400,300),'white');buf=BytesIO();image.save(buf,format='PNG')
                doc=leaking_room();doc['schema_version']='0.3.0';doc['image']['sha256']=hashlib.sha256(buf.getvalue()).hexdigest()
                run=dict(document=doc,history=[],changes=[],next_id=20,png=buf.getvalue());server.sessions['test']=run
                _,report=post('diagnose-closure',{})
                req=dict(revision=report['revision'],candidate_id=report['candidates'][0]['id'])
                self.assertEqual(post('preview-gap',req)[0],200)
                self.assertEqual(run['history'],[]);self.assertEqual(run['next_id'],20)
                self.assertEqual(post('resolve-gap',dict(req,action='ignore'))[0],200)
                _,saved=post('save-project',{})
                reopened=load_project(Path(temp)/'projects',saved['saved_name'])
                self.assertTrue(diagnose_closure(reopened['document'])['candidates'][0]['ignored'])
                post('undo-edit',{})
                _,confirmed=post('resolve-gap',dict(req,action='confirm'))
                self.assertEqual(confirmed['document']['room_partition']['region_count'],1)
                self.assertEqual(post('resolve-gap',dict(req,action='confirm'))[0],400)
                self.assertEqual(len(run['history']),1)
                _,saved=post('save-project',{})
                reopened=load_project(Path(temp)/'projects',saved['saved_name'])
                self.assertEqual(reopened['document'],confirmed['document'])
                _,undone=post('undo-edit',{})
                self.assertEqual(undone['document'],doc);self.assertEqual(run['next_id'],20)
                with opener.open(origin+'/closure-ui.js') as response:self.assertEqual(response.status,200)
            finally:server.shutdown();server.server_close();thread.join()


if __name__=='__main__':unittest.main()
