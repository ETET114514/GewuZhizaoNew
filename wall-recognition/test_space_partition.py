from copy import deepcopy
import json
from pathlib import Path
import unittest

from PIL import Image

from ceiling_design import apply_ceiling_edit
from partition_rooms import ALGORITHM, partition_rooms
from refine_walls import initialize_refinement, segment
from repartition import refresh_room_partition
from test_rooms import fixture, wall
import test_projects as project_tests


class SpacePartitionTests(unittest.TestCase):
    def test_supported_window_return_closes_space_without_scale(self):
        main = wall('W001', 0, 190, 385, 30, 15)
        arm = dict(wall('W004', 0, 342, 384, 56.5, 7), source='automatic')
        host = dict(wall('W005', 1, 60, 272.5, 380, 8), source='automatic_opening_connection', solid_parts=[])
        doc = dict(image=dict(width_px=450, height_px=320), furniture=[], walls=[main,
            wall('W002', 0, 190, 385, 280, 15), wall('W003', 1, 30, 280, 200, 10), arm, host],
            openings=[dict(id='O001', kind='window', review_status='confirmed',
                evidence=dict(exterior_frame=True), jamb_support_ids=['W004', 'W002'],
                **segment(1, 60, 272.5, 380, 8))])
        self.assertEqual(partition_rooms(doc)['region_count'], 1)
        doc['walls'][3]['review_status'] = 'confirmed'
        self.assertEqual(partition_rooms(doc)['region_count'], 0)
        doc['walls'][3].pop('review_status')
        doc['openings'][0]['review_status'] = 'unreviewed'
        doc['openings'][0]['requires_confirmation'] = True
        self.assertEqual(partition_rooms(doc)['region_count'], 0)

    def test_door_sides_and_open_pose_do_not_change_spaces(self):
        doc = fixture()
        before = deepcopy(doc)
        result = partition_rooms(doc)
        self.assertEqual(result['algorithm'], ALGORITHM)
        self.assertEqual(result['door_sides'][0]['status'], 'separate')
        self.assertEqual(doc, before)
        doc['openings'][0]['operation'] = dict(angle_deg=90)
        self.assertEqual(partition_rooms(doc), result)

    def test_door_with_bypass_is_diagnosed_instead_of_forced_split(self):
        doc = fixture()
        doc['walls'][5] = wall('W006', 1, 160, 220, 200)
        doc = initialize_refinement(doc, Image.new('RGB', (400, 300), 'white'))
        result = partition_rooms(doc)
        self.assertEqual(result['region_count'], 1)
        self.assertEqual(result['door_sides'][0]['status'], 'same_space')

    def test_entry_seals_exterior_without_creating_an_outdoor_room(self):
        doc = fixture(False)
        doc['walls'] = doc['walls'][:3] + [wall('W004', 1, 30, 110, 380), wall('W005', 1, 160, 280, 380)]
        doc['openings'] = [dict(id='O001', kind='door', door_model='entry',
            review_status='confirmed', **segment(1, 110, 160, 380, 10))]
        doc = initialize_refinement(doc, Image.new('RGB', (400, 300), 'white'))
        result = partition_rooms(doc)
        self.assertEqual(result['region_count'], 1)
        check = result['door_sides'][0]
        self.assertEqual(check['status'], 'entry')
        self.assertIn(['outside'], check['sides'])
        doc['openings'][0].pop('door_model')
        self.assertEqual(partition_rooms(doc)['door_sides'][0]['status'], 'leak')

    def test_touching_corners_complete_but_a_real_gap_is_preserved(self):
        doc = fixture(False)
        result = partition_rooms(doc)
        self.assertTrue(result['structural_additions_px'])
        doc['walls'] = doc['walls'][:4]
        doc['walls'][0] = wall('W001', 0, 25.1, 380, 30)
        doc = initialize_refinement(doc, Image.new('RGB', (400, 300), 'white'))
        self.assertEqual(partition_rooms(doc)['region_count'], 0)

    def test_disabling_corner_alignment_recomputes_analysis(self):
        doc = fixture()
        doc['model_settings'] = dict(flush_wall_joints=False)
        self.assertEqual(partition_rooms(doc)['structural_additions_px'], [])

    def test_split_retains_ambiguous_slab_and_its_lamp_but_moves_root_lamp(self):
        doc = fixture(False)
        doc['scale_mm_per_px'] = 20
        refresh_room_partition(doc)
        doc, _ = apply_ceiling_edit(doc, dict(action='add', room_id='R001', settings=dict(kind='slab')))
        doc, _ = apply_ceiling_edit(doc, dict(action='add', room_id='R001', settings=dict(kind='light', center_px=[100, 150])))
        doc, _ = apply_ceiling_edit(doc, dict(action='add', room_id='R001', settings=dict(kind='light', host_id='C001', center_px=[100, 150])))
        authored = deepcopy(doc['ceiling_design']['components'])
        doc['openings'] = deepcopy(fixture()['openings'])
        refresh_room_partition(doc)
        items = doc['ceiling_design']['components']
        self.assertEqual(doc['room_partition']['region_count'], 2)
        self.assertEqual(items[0], authored[0])
        self.assertEqual(items[2], authored[2])
        self.assertNotEqual(items[1]['room_key'], authored[1]['room_key'])
        self.assertEqual(doc['room_partition']['design_migration']['unresolved_ids'], ['C001', 'C003'])
        self.assertEqual([l['id'] for l in doc['ceiling_layout']['lights']], ['C002'])

    def test_repeat_partition_keeps_authored_components(self):
        doc = fixture()
        doc['scale_mm_per_px'] = 20
        refresh_room_partition(doc)
        doc, _ = apply_ceiling_edit(doc, dict(action='add', room_id='R001', settings=dict(kind='light', center_px=[100, 150])))
        before = deepcopy(doc['ceiling_design'])
        refresh_room_partition(doc)
        self.assertEqual(doc['ceiling_design'], before)
        self.assertEqual(doc['room_partition']['design_migration']['unresolved_ids'], [])

    def test_current_plan_restores_two_rooms_and_preserves_all_four_components(self):
        path = Path(__file__).parent/'projects/20261014-203817-f33e1d/walls.json'
        if not path.exists():
            self.skipTest('Local saved plan is not distributed with the repository')
        doc = json.loads(path.read_text(encoding='utf-8'))
        source = deepcopy(doc['walls'])
        authored = deepcopy(doc['ceiling_design']['components'])
        refresh_room_partition(doc)
        self.assertEqual(doc['room_partition']['region_count'], 5)
        checks = {c['opening_id']: c['status'] for c in doc['room_partition']['door_sides']}
        self.assertEqual(checks['O006'], 'separate')
        self.assertEqual(checks['O009'], 'separate')
        self.assertEqual(checks['O010'], 'same_space')
        self.assertEqual(doc['walls'], source)
        self.assertEqual(len(doc['ceiling_layout']['lights']), 2)
        self.assertEqual(doc['room_partition']['design_migration']['unresolved_ids'], [])
        for before, after in zip(authored, doc['ceiling_design']['components']):
            self.assertEqual(before['id'], after['id'])
            self.assertEqual(before['settings'], after['settings'])
        self.assertEqual(len([s for s in doc['ceiling_layout']['surfaces'] if s['id'].startswith('room:')]), 5)

    def test_http_repartition_is_undoable_and_roundtrips_authored_design(self):
        workflow = project_tests.ProjectWorkflowTests()
        workflow.setUp()
        try:
            doc = fixture(False)
            doc['scale_mm_per_px'] = 20
            doc['image'] = deepcopy(workflow.doc['image'])
            refresh_room_partition(doc)
            doc, _ = apply_ceiling_edit(doc, dict(action='add', room_id='R001', settings=dict(kind='light', center_px=[100, 150])))
            doc['openings'] = deepcopy(fixture()['openings'])
            workflow.server.sessions['test'].update(document=doc, changes=[], history=[])
            before = deepcopy(doc)
            status, updated = workflow.post('/api/partition-rooms', dict(run_id='test'))
            self.assertEqual(status, 200)
            self.assertEqual(updated['document']['room_partition']['region_count'], 2)
            self.assertEqual(updated['history_size'], 1)
            self.assertEqual(len(updated['document']['ceiling_layout']['lights']), 1)
            name, _ = workflow.save()
            status, opened = workflow.post('/api/open-project', dict(project_id=name))
            self.assertEqual(status, 200)
            self.assertEqual(opened['document'], updated['document'])
            status, undone = workflow.post('/api/undo-edit', dict(run_id='test'))
            self.assertEqual(status, 200)
            self.assertEqual(undone['document'], before)
        finally:
            workflow.tearDown()


if __name__ == '__main__':
    unittest.main()
