from copy import deepcopy
import json
import unittest

from PIL import Image, ImageDraw, ImageOps
from recognize_furniture import ROOT, apply_furniture_edit, detect_furniture, overlap, conflicting_candidates


class FurnitureGeometryTests(unittest.TestCase):
    def setUp(self):
        self.document = {"image": {"width_px": 500, "height_px": 400},
                         "walls": [{"id": "W001"}], "openings": [], "solid_wall_segments": []}

    def test_add_update_reject_preserves_structure_and_prediction(self):
        before = deepcopy(self.document)
        doc, record = apply_furniture_edit(self.document, {"action":"add", "kind":"bed", "bbox_px":[10,20,110,180], "rotation_deg":90})
        self.assertEqual(self.document, before)
        self.assertEqual(record["furniture_id"], "F001")
        self.assertEqual(doc["furniture"][0]["size_px"], [100,160])
        doc["furniture"][0].update(source="symbol_template", match_score=.9)
        edited, _ = apply_furniture_edit(doc, {"action":"update", "furniture_id":"F001", "kind":"sofa", "bbox_px":[20,30,200,100], "rotation_deg":None})
        self.assertEqual(edited["furniture"][0]["prediction"]["kind"], "bed")
        self.assertEqual(edited["furniture"][0]["center_px"], [110,65])
        rejected, _ = apply_furniture_edit(edited, {"action":"reject", "furniture_id":"F001"})
        self.assertEqual(rejected["furniture"][0]["review_status"], "rejected")
        restored, _ = apply_furniture_edit(rejected, {"action":"update", "furniture_id":"F001", "kind":"unclassified"})
        self.assertEqual(restored["furniture"][0]["review_status"], "unreviewed")
        added, _ = apply_furniture_edit(restored, {"action":"add", "kind":"bed", "bbox_px":[1,1,40,40]})
        self.assertEqual(added["furniture"][-1]["id"], "F002")
        for key in ("walls", "openings", "solid_wall_segments"):
            self.assertEqual(added[key], before[key])

    def test_invalid_geometry_is_atomic(self):
        before=deepcopy(self.document)
        for bad in ([0,0,600,200], [1,1,1,20], [0,0,float('nan'),40], [True,0,40,40], "bad"):
            with self.assertRaises(ValueError):
                apply_furniture_edit(self.document, {"action":"add","kind":"bed","bbox_px":bad})
            self.assertEqual(self.document, before)
        for fields in ({"kind":"unsupported_kind"},{"rotation_deg":45},{"rotation_deg":True},{"action":"update","furniture_id":"F999"}):
            with self.assertRaises(ValueError):
                apply_furniture_edit(self.document, {"action":"add","kind":"bed","bbox_px":[1,1,40,40],**fields})

    def test_cabinet_edit_and_export_geometry(self):
        doc, _ = apply_furniture_edit(self.document, {"action":"add", "kind":"cabinet", "bbox_px":[20,30,180,65], "rotation_deg":None})
        self.assertEqual(doc["furniture"][0]["label"], "柜子")
        self.assertIsNone(doc["furniture"][0]["rotation_deg"])
        self.assertEqual(doc["furniture"][0]["review_status"], "confirmed")
        self.assertEqual(doc["walls"], self.document["walls"])

    def test_wet_area_stays_pending_until_bath_or_shower_confirmed(self):
        doc, _ = apply_furniture_edit(self.document, {"action":"add", "kind":"wet_area", "bbox_px":[20,30,90,95]})
        self.assertEqual(doc['furniture'][0]['review_status'],'unreviewed')
        for kind in ('bathtub','shower','wet_area'):
            doc, _ = apply_furniture_edit(doc, {"action":"update", "furniture_id":"F001", "kind":kind, "rotation_deg":90})
            self.assertIsNone(doc['furniture'][0]['rotation_deg'])
            self.assertEqual(doc['furniture'][0]['review_status'],'unreviewed' if kind=='wet_area' else 'confirmed')

    def test_counter_keeps_embedded_sink_or_hob_but_deduplicates_itself(self):
        counter={'kind':'kitchen_cabinet','bbox_px':[20,20,140,55]}
        for kind in ('kitchen_sink','cooktop'):
            fixture={'kind':kind,'bbox_px':[50,25,80,50]}
            self.assertFalse(conflicting_candidates(counter,fixture))
            self.assertFalse(conflicting_candidates(fixture,counter))
        self.assertTrue(conflicting_candidates(counter,deepcopy(counter)))


class FurnitureDetectionTests(unittest.TestCase):
    def test_rendered_default_plan_and_coffee_table_negative(self):
        # Source-style calibration, not independent generalization accuracy.
        image = Image.open(ROOT / 'input/floorplan.png')
        truth = [
            ('bed',[431,200,513,315]), ('bed',[310,531,426,614]), ('bed',[482,509,607,603]),
            ('sofa',[77,499,121,618]), ('sofa',[139,470,180,512]), ('sofa',[143,596,186,638]),
            ('cabinet',[369,200,400,298]), ('cabinet',[366,373,491,407]), ('cabinet',[333,473,427,505]),
        ]
        fixtures=json.loads((ROOT/'input/furniture-references/fixture-landmarks.json').read_text(encoding='utf-8'))['targets']
        truth.extend((f['kind'],f['bbox_px']) for f in fixtures)
        found = detect_furniture(image)
        for kind, box in truth:
            matches = [f for f in found if f['kind']==kind and overlap(f['bbox_px'],box)[0]>.65]
            self.assertEqual(len(matches),1,(kind,box,found))
        self.assertEqual(len(found),len(truth),found)
        self.assertFalse(any(f['kind']=='sofa' and overlap(f['bbox_px'],[136,529,188,584])[1]>.2 for f in found))
        self.assertTrue(all(f['review_status']=='unreviewed' and f['rotation_deg'] is None for f in found if f['kind']=='wet_area'))

    def test_rendered_symbols_relocated_scaled_and_rotated(self):
        source = Image.open(ROOT / 'input/floorplan.png')
        canvas = Image.new('RGB',(550,480),'white')
        truth=[]
        for kind,box,angle,scale,pos in [
            ('bed',[431,200,513,315],180,.9,(50,40)),
            ('sofa',[77,499,121,618],90,1.1,(290,50)),
            ('sofa',[139,470,180,512],270,1.25,(355,300)),
            ('cabinet',[366,373,491,407],90,.9,(50,285)),
        ]:
            crop=source.crop(box).rotate(-angle,expand=True)
            crop=crop.resize((round(crop.width*scale),round(crop.height*scale)))
            canvas.paste(crop,pos)
            truth.append((kind,[*pos,pos[0]+crop.width,pos[1]+crop.height]))
        # Distractors: a tea table and exterior window lines, both rectangular.
        canvas.paste(source.crop((132,526,191,587)),(205,195))
        canvas.paste(source.crop((434,662,638,690)),(280,420))
        found=detect_furniture(canvas)
        for kind,box in truth:
            self.assertEqual(len([f for f in found if f['kind']==kind and overlap(f['bbox_px'],box)[0]>.65]),1,(kind,box,found))
        self.assertEqual(len([f for f in found if f['kind'] in {'bed','sofa','cabinet'}]),len(truth),found)
        self.assertTrue(all(f['kind'] in {'bed','sofa','cabinet','coffee_table'} for f in found),found)

    def test_fixture_context_transforms_keep_inner_boxes(self):
        source=Image.open(ROOT/'input/floorplan.png')
        canvas=Image.new('RGB',(520,470),'white')
        truth=[]
        cases=[
            ('dining_table',[74,332,149,414],[77,351,146,392],90,1.1,(40,40)),
            ('coffee_table',[130,525,192,590],[135,529,187,584],180,1.1,(330,40)),
            ('wet_area',[581,393,641,469],[589,400,633,464],270,1.2,(40,280)),
            ('kitchen_cabinet',[74,149,113,259],[79,152,109,256],90,1.1,(300,290)),
        ]
        for kind,context,box,angle,scale,pos in cases:
            crop=source.crop(context).rotate(-angle,expand=True)
            size=(round(crop.width*scale),round(crop.height*scale))
            canvas.paste(crop.resize(size),pos)
            targets=[(kind,box)]
            if kind=='kitchen_cabinet':targets.append(('cooktop',[79,192,105,237]))
            for target_kind,target_box in targets:
                mask=Image.new('L',(context[2]-context[0],context[3]-context[1]))
                x0,y0,x1,y1=target_box
                ImageDraw.Draw(mask).rectangle((x0-context[0],y0-context[1],x1-context[0]-1,y1-context[1]-1),fill=255)
                b=mask.rotate(-angle,expand=True).resize(size,Image.Resampling.NEAREST).getbbox()
                truth.append((target_kind,[b[0]+pos[0],b[1]+pos[1],b[2]+pos[0],b[3]+pos[1]]))
        found=detect_furniture(canvas)
        for kind,box in truth:
            self.assertEqual(len([f for f in found if f['kind']==kind and overlap(f['bbox_px'],box)[0]>.65]),1,(kind,box,found))
        self.assertEqual(len(found),len(truth),found)

    def test_blank_tiny_and_solid_are_not_furniture(self):
        for image in (Image.new('RGB',(200,200),'white'), Image.new('RGB',(200,200),'black'), Image.new('RGB',(12,20),'white')):
            self.assertEqual(detect_furniture(image), [])

    def test_transformed_symbols_have_no_fixed_image_positions(self):
        # Appearance/transform regression only, not an independent accuracy test.
        source = Image.open(ROOT / 'input/furniture-references/06.jpg')
        bed=source.crop((659,237,815,374)).rotate(90,expand=True)
        sofa=source.crop((295,264,367,465)).rotate(270,expand=True)
        canvas=Image.new('RGB',(600,540),'white')
        truth=[]
        for crop,kind,angle,position in [(bed,'bed',0,(35,40)),(sofa,'sofa',90,(370,40)),
                                         (ImageOps.mirror(bed),'bed',180,(320,325)),(sofa,'sofa',270,(60,265))]:
            crop=crop.resize((round(crop.width*.85),round(crop.height*.85))).rotate(-angle,expand=True)
            canvas.paste(crop,position)
            truth.append((kind,angle,[*position,position[0]+crop.width,position[1]+crop.height]))
        found=detect_furniture(canvas)
        for kind,angle,box in truth:
            matches=[f for f in found if f['kind']==kind and overlap(f['bbox_px'],box)[0]>.70]
            self.assertEqual(len(matches),1,(kind,angle,box,found))
            self.assertEqual(matches[0]['rotation_deg'],angle)
        self.assertEqual(len(found),len(truth))


if __name__=='__main__':
    unittest.main()
