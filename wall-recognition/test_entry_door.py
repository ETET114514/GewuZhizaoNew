import unittest
from opening_direction import opening_context
from opening_editing import apply_opening_edit, open_openings
from test_opening_direction import fixture

class EntryDoorTests(unittest.TestCase):
    def test_preset_marks_model_and_dimensions_and_opening_uses_one_indoor_side(self):
        doc=fixture();door=doc['openings'][2]
        result,_=apply_opening_edit(doc,dict(opening_id=door['id'],preset='entry_door_1200'))
        entry=result['openings'][2]
        self.assertEqual(entry['door_model'],'entry')
        self.assertEqual(entry['dimensions_mm']['width_mm'],1200)
        self.assertEqual(entry['dimensions_mm']['height_mm'],2100)
        opened,_,_=open_openings(result,dict(target_kind='door',opening_id=entry['id']))
        self.assertEqual(opened['openings'][2]['operation']['side'],'positive')

    def test_perimeter_fallback_does_not_turn_internal_doors_into_exterior_doors(self):
        doc=fixture();entry=doc['openings'][2];entry['door_model']='entry'
        context=opening_context(doc,entry,([],[]))
        self.assertEqual(context['interior_side'],'positive')
        self.assertIn('外轮廓',context['reason'])
        inner=doc['openings'][0];inner['door_model']='entry'
        self.assertIsNone(opening_context(doc,inner,([],[]))['interior_side'])
        self.assertIsNone(opening_context(doc,inner)['interior_side'])
        self.assertIn('两侧',opening_context(doc,inner)['reason'])

    def test_invalid_role_rejected_and_standard_preset_reverts_model(self):
        doc=fixture()
        with self.assertRaises(ValueError):apply_opening_edit(doc,dict(opening_id='O001',door_model='invalid'))
        doc['openings'][0]['door_model']='entry'
        result,_=apply_opening_edit(doc,dict(opening_id='O001',preset='bedroom_door_900'))
        self.assertEqual(result['openings'][0]['door_model'],'standard')

if __name__=='__main__':unittest.main()
