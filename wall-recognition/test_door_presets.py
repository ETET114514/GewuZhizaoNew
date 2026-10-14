from copy import deepcopy
import unittest
from opening_editing import apply_opening_edit
from test_opening_edit import fixture


class DoorPresetTests(unittest.TestCase):
    def test_all_widths_both_orientations_preserve_operation_and_source(self):
        for vertical in (False,True):
            for preset,width in [('entry_door_1200',1200),('bedroom_door_900',900),('bathroom_door_800',800)]:
                doc,_=fixture(vertical);o=doc['openings'][0];o['kind']='door'
                o['operation']=dict(type='hinged',hinge='end',side='positive',angle_deg=45,direction_mode='manual')
                before=deepcopy(doc)
                result,_=apply_opening_edit(doc,dict(opening_id=o['id'],preset=preset))
                updated=result['openings'][0];axis=1 if vertical else 0
                self.assertEqual(updated['dimensions_mm']['width_mm'],width)
                self.assertAlmostEqual((updated['end_px'][axis]-updated['start_px'][axis])*doc['scale_mm_per_px'],width)
                self.assertEqual(updated['operation'],o['operation']);self.assertEqual(doc,before)

    def test_wrong_kind_and_unscaled_presets_fail_atomically(self):
        doc,_=fixture();before=deepcopy(doc)
        for preset in ['entry_door_1200','bedroom_door_900','bathroom_door_800',[]]:
            with self.assertRaises(ValueError):apply_opening_edit(doc,dict(opening_id='O001',preset=preset))
            self.assertEqual(doc,before)
        doc['openings'][0]['kind']='door';doc['scale_mm_per_px']=None
        with self.assertRaisesRegex(ValueError,'标定'):apply_opening_edit(doc,dict(opening_id='O001',preset='entry_door_1200'))


if __name__=='__main__':unittest.main()
