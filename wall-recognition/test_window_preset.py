from copy import deepcopy
import unittest

from model_settings import apply_model_settings
from opening_editing import apply_opening_edit, open_openings, validate_operation
from window_preset import apply_window_preset, window_width_mm
from test_opening_edit import fixture
import test_projects


class WindowPresetTests(unittest.TestCase):
    def test_threshold_is_physical_width_in_either_orientation(self):
        for vertical in (False, True):
            doc, _ = fixture(vertical)
            for width, axis in [(1799.9, 'vertical'), (1800, 'horizontal'), (1800.1, 'horizontal')]:
                with self.subTest(vertical=vertical, width=width):
                    doc['scale_mm_per_px'] = width / 100
                    before = deepcopy(doc)
                    result, _, report = open_openings(doc, {'target_kind': 'window'})
                    op = result['openings'][0]['operation']
                    self.assertEqual(op['pivot_axis'], axis)
                    self.assertEqual(op['hinge'], 'top' if axis == 'horizontal' else 'start')
                    self.assertEqual(op['angle_deg'], 45)
                    self.assertEqual(report['changed_count'], 1)
                    self.assertEqual(doc, before)

    def test_dimensions_and_global_preset_take_priority_no_scale_uses_side_open(self):
        doc, _ = fixture(); o = doc['openings'][0]
        doc['scale_mm_per_px'] = None
        self.assertIsNone(window_width_mm(doc, o))
        op = dict(type='hinged', axis_mode='width', angle_deg=45)
        self.assertEqual(apply_window_preset(doc, o, op)['pivot_axis'], 'vertical')
        doc['model_settings'] = dict(width_mode='preset', window_width_mm=2000)
        self.assertEqual(apply_window_preset(doc, o, op)['pivot_axis'], 'horizontal')
        o['dimensions_mm'] = dict(width_mm=800)
        self.assertEqual(apply_window_preset(doc, o, op)['pivot_axis'], 'vertical')

    def test_resize_recalibration_and_manual_override(self):
        doc, _ = fixture()
        auto, _, _ = open_openings(doc, {'target_kind': 'window'})
        wide, _ = apply_opening_edit(auto, dict(opening_id='O001', dimensions_mm={'width_mm':2000}))
        self.assertEqual(wide['openings'][0]['operation']['pivot_axis'], 'horizontal')
        narrow, _ = apply_model_settings(wide, dict(calibration=dict(points_px=[[0,0],[100,0]], length_mm=500)))
        self.assertEqual(narrow['openings'][0]['operation']['pivot_axis'], 'vertical')
        manual = dict(wide['openings'][0]['operation'], axis_mode='manual', pivot_axis='vertical', hinge='end', pivot_ratio=.75)
        edited, _ = apply_opening_edit(wide, dict(opening_id='O001', operation=manual))
        reopened, _, _ = open_openings(edited, {'target_kind':'all'})
        self.assertEqual(reopened['openings'][0]['operation'], manual)
        fixed = dict(type='fixed', hinge='start', side='negative', angle_deg=0, axis_mode='width')
        self.assertEqual(apply_window_preset(wide, wide['openings'][0], fixed), fixed)
        for bad in ['bad', True, None]:
            with self.assertRaises(ValueError):validate_operation({'axis_mode':bad}, 'window')
        with self.assertRaises(ValueError):validate_operation({'axis_mode':'width'}, 'door')


class WindowPresetWorkflowTests(unittest.TestCase):
    setUp = test_projects.ProjectWorkflowTests.setUp
    tearDown = test_projects.ProjectWorkflowTests.tearDown
    post = test_projects.ProjectWorkflowTests.post
    save = test_projects.ProjectWorkflowTests.save

    def test_preset_save_reopen_and_single_undo(self):
        self.doc['openings'][0]['kind'] = 'window'
        before = deepcopy(self.doc)
        status, result = self.post('/api/open-openings', dict(run_id='test', target_kind='window'))
        self.assertEqual(status, 200, result)
        self.assertEqual(result['document']['openings'][0]['operation']['axis_mode'], 'width')
        self.assertEqual(result['history_size'], 1)
        name, _ = self.save()
        status, restored = self.post('/api/open-project', dict(project_id=name))
        self.assertEqual(status, 200, restored)
        self.assertEqual(restored['document'], result['document'])
        self.assertEqual(self.post('/api/undo-edit', dict(run_id='test'))[1]['document'], before)


if __name__ == '__main__':unittest.main()
