from copy import deepcopy
from pathlib import Path
import unittest
from unittest.mock import patch
from PIL import Image, ImageDraw
from recognize_walls import detect_walls
from recognize_openings import detect_openings, geometry
from recognize_entry_doors import classify_entry_doors


class EntryRecognitionTests(unittest.TestCase):
    def test_source_mirror_rotation_and_resize_keep_entry_and_glazing_distinct(self):
        source=Image.open(Path(__file__).parent/'input/floorplan.png')
        for transform in ('original','mirror','rotate','enlarge'):
            im=source if transform=='original' else source.transpose(Image.Transpose.FLIP_LEFT_RIGHT) if transform=='mirror' else source.transpose(Image.Transpose.ROTATE_90) if transform=='rotate' else source.resize((1118,1142),Image.Resampling.LANCZOS)
            walls=detect_walls(im)
            items=detect_openings(im,walls)
            entries=[o for o in items if o.get('door_model')=='entry']
            self.assertEqual(len(entries),1,transform)
            entry=entries[0]
            x,y=(197,69) if transform=='original' else (source.width-197,69) if transform=='mirror' else (69,source.width-197) if transform=='rotate' else (197*1.5,69*1.5)
            self.assertTrue(entry['bbox_px'][0]-5<=x<=entry['bbox_px'][2]+5 and entry['bbox_px'][1]-5<=y<=entry['bbox_px'][3]+5,transform)
            self.assertEqual(entry['kind'],'door');self.assertTrue(entry['evidence']['closed_entry_panel'])
            self.assertEqual(entry['operation']['angle_deg'],0)
            # Resizing already leaves one glass frame unclassified in the old
            # recognizer. Check preservation against that baseline separately.
            if transform=='enlarge':
                with patch('recognize_entry_doors.classify_entry_doors',side_effect=lambda *args: None):
                    baseline=detect_openings(im,walls)
                old_glazing={(o['kind'],tuple(o['bbox_px'])) for o in baseline if o['kind'] in ('window','unclassified')}
                new_glazing={(o['kind'],tuple(o['bbox_px'])) for o in items if o['kind'] in ('window','unclassified')}
                self.assertEqual(new_glazing,old_glazing)
            for px,py in ([(315,110)] if transform=='enlarge' else [(315,110),(573,290),(642,430)]):
                qx,qy=(px,py) if transform=='original' else (source.width-px,py) if transform=='mirror' else (py,source.width-px) if transform=='rotate' else (px*1.5,py*1.5)
                self.assertTrue(any(o['kind']=='window' and o['bbox_px'][0]-8<=qx<=o['bbox_px'][2]+8 and o['bbox_px'][1]-8<=qy<=o['bbox_px'][3]+8 for o in items),(transform,px,py))
            if transform=='original':
                self.assertEqual(entry['id'],'O001');self.assertEqual(len([o for o in items if o['kind']=='window']),9)

    def test_plain_window_detached_hardware_midspan_and_missing_support_are_not_entry(self):
        def plan(latch=None):
            im=Image.new('RGB',(745,745),'white');d=ImageDraw.Draw(im)
            d.rectangle((205,100,400,180),fill='#e8e8e8')
            d.line((195,100,195,180),fill='#555555');d.line((204,100,204,180),fill='#555555')
            if latch:
                y=140 if latch=='middle' else 171
                if latch!='detached':d.line((204,y,214,y),fill='#666666',width=2)
                d.ellipse((212,y-3,218,y+3),fill='#444444')
            c=dict(geometry(1,100,180,200,12,im.size),kind='window',label='窗候选',evidence=dict(exterior_frame=True,parallel_line_count=2,end_wall_distances_px=[0,0]))
            return im,c
        for style in (None,'detached','middle'):
            im,c=plan(style);classify_entry_doors(im,[c],1);self.assertEqual(c['kind'],'window',style)
        im,c=plan('near_end');classify_entry_doors(im,[c],1)
        self.assertEqual(c['door_model'],'entry')
        for change in [dict(exterior_frame=False),dict(parallel_line_count=3),dict(wide_frame_band=True),dict(end_wall_distances_px=[20,0])]:
            im,c=plan('near_end');c['evidence'].update(change);classify_entry_doors(im,[c],1);self.assertEqual(c['kind'],'window')

if __name__=='__main__':unittest.main()
