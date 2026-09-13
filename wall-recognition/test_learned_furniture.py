import unittest
from unittest.mock import patch
import numpy as np
from PIL import Image

from recognize_learned_furniture import ROOT, letterbox, predict, detect_learned, bathroom_candidates


class LearnedGeometryTests(unittest.TestCase):
    def test_letterbox_preserves_non_square_geometry(self):
        tensor, (sx, sy, left, top) = letterbox(Image.new('RGB', (1000, 500), 'white'))
        self.assertEqual(tensor.shape, (1, 3, 640, 640))
        self.assertEqual((sx, sy, left, top), (.64, .64, 0, 160))
        self.assertEqual(float(tensor[0, 0, 200, 20]), 1.)

    def test_predictions_remove_padding_restore_pixels_and_suppress_duplicates(self):
        class Runner:
            def get_inputs(self):
                return [type('Input', (), {'name': 'images'})()]
            def run(self, outputs, inputs):
                # Two copies of a bed in padded model coordinates.
                return [np.array([[[160, 320, 128, 192, .9],
                                   [161, 321, 128, 192, .8]]], dtype=np.float32).transpose(0, 2, 1)]
        with patch('recognize_learned_furniture.session', return_value=(Runner(), {0: 'bed'})):
            found = predict(Image.new('RGB', (1000, 500)), 'unused.onnx')
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]['bbox_px'], [150., 100., 350., 400.])

    @unittest.skipUnless((ROOT/'models/floorcad-nano.onnx').exists(), 'optional model not installed')
    def test_new_line_drawing_major_furniture_and_blank(self):
        from recognize_furniture import overlap
        found, status = detect_learned(Image.open(ROOT/'input/reference-plans/04-furnished.png'))
        if status == 'missing_runtime':
            self.skipTest('optional ONNX runtime not installed')
        self.assertEqual(status, 'ready')
        for kind, box in [('bed',[1078,730,1305,938]), ('bed',[704,770,932,940]),
                          ('sofa',[519,691,608,926]), ('sofa',[387,896,475,982]),
                          ('sofa',[373,654,495,722]), ('table',[387,746,468,873]),
                          ('table',[229,384,384,474])]:
            self.assertEqual(sum(f['kind']==kind and overlap(box,f['bbox_px'])[0]>.7 for f in found),1)
        self.assertTrue(all(f['rotation_deg'] is None and f['review_status']=='unreviewed' for f in found))
        for kind,box in [('toilet',[891,292,973,346]),('vanity',[908,383,973,481]),('wet_area',[794,163,975,272])]:
            matches=[f for f in found if f['kind']==kind and overlap(box,f['bbox_px'])[0]>.7]
            self.assertEqual(len(matches),1,(kind,found))
            self.assertIn('fixture_verification',matches[0]['evidence'])
        self.assertFalse(any(f['kind'] in {'bathtub','shower'} for f in found))
        self.assertEqual(detect_learned(Image.new('RGB',(400,400),'white'))[0], [])

    def test_learned_prediction_survives_manual_reclassification(self):
        from recognize_furniture import apply_furniture_edit
        doc={'image':{'width_px':500,'height_px':400}, 'furniture':[
            {'id':'F001','kind':'table','source':'floorcad_onnx','bbox_px':[10,20,110,120],
             'rotation_deg':None,'match_score':.8,'review_status':'unreviewed'}]}
        changed,_=apply_furniture_edit(doc,{'action':'update','furniture_id':'F001','kind':'coffee_table'})
        self.assertEqual(changed['furniture'][0]['prediction']['kind'],'table')
        self.assertEqual(doc['furniture'][0]['kind'],'table')

    def test_fixture_labels_alone_cannot_turn_rectangles_into_bathroom_objects(self):
        from PIL import ImageDraw
        image=Image.new('RGB',(500,400),'white')
        draw=ImageDraw.Draw(image)
        draw.rectangle((20,20,119,79),outline='black',width=3)
        draw.rectangle((30,30,109,69),outline='black',width=2)
        raw=[{'label':'escalator','bbox_px':[20,20,120,80],'score':.99},
             {'label':'bath','bbox_px':[20,100,120,180],'score':.99},
             {'label':'bath_tub','bbox_px':[140,20,320,120],'score':.99}]
        self.assertEqual(bathroom_candidates(image,raw,raw),[])

    def test_fixture_recovery_requires_second_view_and_nearby_toilet(self):
        from PIL import ImageDraw
        image=Image.new('RGB',(600,400),'white')
        draw=ImageDraw.Draw(image)
        for x,y,w,h in [(30,30,100,70),(30,140,80,90),(450,250,80,90)]:
            draw.rectangle((x,y,x+w-1,y+h-1),outline='black',width=3)
            draw.ellipse((x+10,y+10,x+w-20,y+h-10),outline='black',width=3)
        raw=[{'label':'escalator','bbox_px':[30,30,130,100],'score':.95},
             {'label':'bath','bbox_px':[30,140,110,230],'score':.9},
             {'label':'bath','bbox_px':[450,250,530,340],'score':.9}]
        self.assertEqual(bathroom_candidates(image,raw,[]),[])
        found=bathroom_candidates(image,raw,raw)
        self.assertEqual([kind for _,kind,_ in found],['toilet','vanity'])


if __name__ == '__main__':
    unittest.main()
