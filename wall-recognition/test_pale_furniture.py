"""Pale-source and transform calibration, never an independent accuracy claim."""
import json
import unittest
import numpy as np
from PIL import Image,ImageDraw,ImageOps
from recognize_furniture import ROOT,template_features,detect_furniture,overlap

class PaleFurnitureTests(unittest.TestCase):
    def test_soft_features_retain_faint_strokes_and_ignore_flat_background(self):
        image=Image.new('L',(200,160),255)
        ImageDraw.Draw(image).rectangle((40,40,140,110),outline=247,width=2)
        self.assertEqual(float(template_features(image).sum()),0)
        soft=template_features(image,'soft_contrast')
        self.assertGreater(float(soft[40,40]),0)
        self.assertEqual(float(soft[70,80]),0)
        for gray in (0,175,220,255):
            self.assertFalse(template_features(Image.new('L',(200,160),gray),'soft_contrast').any())

    def test_source_recovers_beds_curved_sofas_tables_cabinets_and_tub(self):
        image=Image.open(ROOT/'input/furniture-references/11-light-rendered.png')
        targets=json.loads((ROOT/'input/furniture-references/pale-landmarks.json').read_text())['targets']
        found=detect_furniture(image)
        for target in targets:
            hits=[f for f in found if f['kind']==target['kind'] and overlap(f['bbox_px'],target['bbox_px'])[0]>.8]
            self.assertEqual(len(hits),1,target)
            self.assertEqual(hits[0]['review_status'],'unreviewed')
            self.assertEqual(hits[0]['evidence']['feature_mode'],'soft_contrast')
            if target['kind']=='sofa':self.assertIsNone(hits[0]['rotation_deg'])
        self.assertEqual(len(found),len(targets),found)

    def test_relocated_rotated_mirrored_scaled_and_faded_symbols(self):
        source=Image.open(ROOT/'input/furniture-references/11-light-rendered.png')
        specs=json.loads((ROOT/'input/furniture-references/templates.json').read_text())
        ids={'pale-bed-right','pale-sofa-arc','pale-dining','pale-island','pale-cross-cabinet-left','pale-bathtub'}
        specs=[s for s in specs if s['id'] in ids]
        canvas=Image.new('RGB',(960,700),'white')
        truth=[]
        for i,spec in enumerate(specs):
            x0,y0,x1,y1=spec['bbox_px']
            crop=source.crop((x0,y0,x1,y1))
            mask=Image.new('L',crop.size)
            a,b,c,d=spec['object_bbox_px']
            ImageDraw.Draw(mask).rectangle((a-x0,b-y0,c-x0-1,d-y0-1),fill=255)
            if i%2:crop,mask=ImageOps.mirror(crop),ImageOps.mirror(mask)
            angle=(i%4)*90
            crop,mask=crop.rotate(angle,expand=True),mask.rotate(angle,expand=True)
            scale=.8 if i%2 else 1.1
            size=(round(crop.width*scale),round(crop.height*scale))
            crop=crop.resize(size)
            # Fading changes the pixel values; matching must retain the strokes.
            crop=Image.fromarray(np.round(255-(255-np.asarray(crop).astype('float32'))*.8).astype('uint8'))
            pos=(35+(i%3)*315,35+(i//3)*330)
            canvas.paste(crop,pos)
            a,b,c,d=mask.resize(size,Image.Resampling.NEAREST).getbbox()
            truth.append((spec['kind'],[pos[0]+a,pos[1]+b,pos[0]+c,pos[1]+d]))
        found=detect_furniture(canvas)
        for kind,box in truth:
            hits=[f for f in found if f['kind']==kind and overlap(f['bbox_px'],box)[0]>.7]
            self.assertEqual(len(hits),1,(kind,box,found))
        self.assertEqual(len(found),len(truth),found)

    def test_pale_windows_elevator_rug_and_dimension_lines_are_not_furniture(self):
        source=Image.open(ROOT/'input/furniture-references/11-light-rendered.png')
        canvas=Image.new('RGB',(700,520),'white')
        for box,pos in [((1236,701,1354,810),(35,35)),((107,28,840,69),(35,230)),
                        ((110,602,395,823),(360,35)),((860,85,1020,145),(35,360))]:
            canvas.paste(source.crop(box),pos)
        self.assertEqual(detect_furniture(canvas),[])

if __name__=='__main__':unittest.main()
