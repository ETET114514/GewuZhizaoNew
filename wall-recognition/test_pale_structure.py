"""Structural evidence, transforms, and multi-color settings regressions."""
import unittest
from pathlib import Path
from PIL import Image, ImageDraw, ImageOps
from recognize_walls import detect_walls
from recognize_openings import detect_openings
from recognize_pale_doors import detect_pale_doors
from recognize_pale_boundaries import detect_pale_boundaries
from web_server import recognition_options

ROOT = Path(__file__).parent


class PaleStructureTests(unittest.TestCase):
    def test_multiple_wall_colors_keep_gaps_and_ignore_large_floor_fill(self):
        image = Image.new('RGB', (400, 400), 'white')
        d = ImageDraw.Draw(image)
        for box, color in [((30,50,160,59),'#555555'), ((220,50,370,59),'#e4e4e4'),
                           ((220,60,229,250),'#b5d4e6'), ((30,220,170,370),'#b5d4e6')]:
            d.rectangle(box, fill=color)
        walls = detect_walls(image, wall_colors=['#e4e4e4','#b5d4e6'])
        for x,y in [(70,55),(270,55),(225,150)]:
            self.assertTrue(any(a<=x<b and c<=y<e for a,c,b,e in [w['bbox_px'] for w in walls]))
        for x,y in [(190,55),(100,290),(300,300)]:
            self.assertFalse(any(a<=x<b and c<=y<e for a,c,b,e in [w['bbox_px'] for w in walls]))

    def test_palette_validation_and_canonical_cache_settings(self):
        self.assertEqual(recognition_options({'wall_colors':['#aAbBcC','#AABBCC']}),
                         dict(wall_colors=['#aabbcc'],color_tolerance=8))
        for options in [[], {'wall_colors':'#123456'}, {'wall_colors':['#ffffff']},
                        {'wall_colors':['#12345x']}, {'wall_colors':['#123456']*7},
                        {'color_tolerance':0}, {'color_tolerance':True}, {'color_tolerance':1.5}, {'unknown':1}]:
            with self.subTest(options=options), self.assertRaises(ValueError):
                recognition_options(options)

    def test_pale_plan_doors_and_perimeter_exclude_equipment_and_page_edges(self):
        image=Image.open(ROOT/'input/furniture-references/11-light-rendered.png')
        found=detect_openings(image,detect_walls(image))
        doors=[o for o in found if o['kind']=='door']
        for x,y in [(924,225),(950,470),(1080,474),(1238,326),(1055,695),
                    (1100,860),(768,910),(1340,921),(769,1072)]:
            self.assertTrue(any(o['bbox_px'][0]-5<=x<=o['bbox_px'][2]+5 and
                                o['bbox_px'][1]-5<=y<=o['bbox_px'][3]+5 for o in doors),(x,y))
        self.assertEqual(len(doors),9)
        self.assertTrue(any(o['evidence'].get('leaf_count')==2 for o in doors))
        boundaries=[o for o in found if o['evidence'].get('feature_mode')=='pale_perimeter']
        self.assertEqual(len(boundaries),4)
        self.assertTrue(all(o['requires_confirmation'] and o['kind']=='unclassified' for o in boundaries))
        for x,y in [(135,350),(300,162),(300,580),(404,1050)]:
            self.assertTrue(any(o['bbox_px'][0]-5<=x<=o['bbox_px'][2]+5 and
                                o['bbox_px'][1]-5<=y<=o['bbox_px'][3]+5 for o in boundaries),(x,y))

    def test_faint_single_and_double_doors_transform_and_need_both_arc_and_leaf(self):
        for double in (False,True):
            base=Image.new('RGB',(600,600),'white')
            d=ImageDraw.Draw(base)
            end=300 if double else 250
            d.rectangle((60,195,199,204),fill='#777777')
            d.rectangle((end,195,520,204),fill='#777777')
            d.line((200,200,200,250),fill='#eeeeee',width=2)
            if double:d.line((300,200,300,250),fill='#eeeeee',width=2)
            scale=600/745
            self.assertEqual(detect_pale_doors(base,detect_walls(base),scale),[])
            d.arc((150,150,250,250),0,90,fill='#eeeeee',width=2)
            if double:d.arc((250,150,350,250),90,180,fill='#eeeeee',width=2)
            for image in (base,base.rotate(90),ImageOps.mirror(base),base.resize((480,480))):
                found=detect_pale_doors(image,detect_walls(image),min(image.size)/745)
                self.assertEqual(len(found),1,(double,image.size,found))
                self.assertEqual(found[0]['evidence']['leaf_count'],2 if double else 1)

    def test_blank_and_flat_fill_are_not_pale_boundaries(self):
        for color in ('white','#e4e4e4','#555555'):
            self.assertEqual(detect_pale_boundaries(Image.new('RGB',(300,300),color),[],.5),[])


if __name__=='__main__':unittest.main()
