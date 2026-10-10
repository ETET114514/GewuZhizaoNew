from copy import deepcopy
import unittest
from unittest.mock import patch
from PIL import Image
from refine_walls import segment
from test_opening_edit import fixture
from tools.recover_missing_windows import recover


class WindowRecoveryTests(unittest.TestCase):
    def test_recovery_keeps_reviewed_edits_and_room_materials_and_is_idempotent(self):
        doc,_=fixture()
        doc['openings'][0]['dimensions_mm']=dict(width_mm=1000,height_mm=1400,sill_height_mm=800)
        doc['room_partition']=dict(regions=[dict(id='R1',name='玄关',floor=dict(material='wood'))])
        before=deepcopy(doc)
        candidate=dict(id='O999',kind='window',review_status='unreviewed',**segment(1,20,480,300,10))
        original=deepcopy(doc['openings'][0]);original['kind']='window'
        # Existing original geometry must still match if it has subsequently
        # been moved, resized or reclassified by the user.
        doc['openings'][0].update(kind='rejected',review_status='rejected')
        original_state=deepcopy(doc)
        with patch('tools.recover_missing_windows.detect_walls',return_value=[]),patch('tools.recover_missing_windows.detect_openings',return_value=[original,candidate]):
            result,added,next_wall=recover(doc,Image.new('RGB',(500,500),'white'))
            self.assertEqual(added,['O002'])
            self.assertEqual(result['openings'][0],doc['openings'][0])
            self.assertEqual(result['room_partition']['regions'],before['room_partition']['regions'])
            self.assertEqual(result['furniture'],doc['furniture'])
            self.assertEqual(doc,original_state)
            again,extra,_=recover(result,Image.new('RGB',(500,500),'white'))
            self.assertFalse(extra);self.assertEqual(again,result)
            self.assertGreater(next_wall,max(int(w['id'][1:]) for w in doc['walls']))


if __name__=='__main__':unittest.main()
