"""Closed exterior entrance symbols: a supported panel plus a compact latch."""
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageOps


def classify_entry_doors(image, candidates, scale):
    gray=np.asarray(image.convert('L'))
    background=ImageOps.expand(Image.fromarray(np.uint8(gray>245)*255),border=1,fill=255)
    ImageDraw.floodfill(background,(0,0),128)
    exterior=np.asarray(background)[1:-1,1:-1]==128
    for c in candidates:
        e=c.get('evidence',{})
        if c['kind']!='window' or not e.get('exterior_frame') or e.get('wide_frame_band') or e.get('frame_corner_support'):
            continue
        if e.get('parallel_line_count',0)!=2 or max(e.get('end_wall_distances_px',[float('inf')]))>12*scale:
            continue
        axis=0 if c['orientation']=='horizontal' else 1
        a,b=c['start_px'][axis],c['end_px'][axis];center=c['start_px'][1-axis];width=b-a;half=c['thickness_px']/2
        if not 40*scale<=width<=140*scale or not 3<=width/c['thickness_px']<=12:
            continue
        src=gray if axis==0 else gray.T
        outside=exterior if axis==0 else exterior.T
        def outside_fraction(sign):
            lo,hi=sorted([round(center+sign*(half+8*scale)),round(center+sign*(half+25*scale))])
            patch=outside[max(0,lo):min(outside.shape[0],hi),round(a+5*scale):round(b-5*scale)]
            return float(patch.mean()) if patch.size else 0
        hit=None
        for sign in (-1,1):
            # The exterior-frame gate already requires a broad exterior strip.
            # Allow small entrance annotations in this narrower local probe.
            if outside_fraction(-sign)<.75 or outside_fraction(sign)>.25:
                continue
            lo,hi=sorted([round(center+sign*(half+2*scale)),round(center+sign*(half+24*scale))])
            # Resampling can merge a short piece of the leaf into a coarse wall
            # and trim the candidate. Search a small margin for its latch.
            start,end=max(0,round(a-6*scale)),min(src.shape[1],round(b+10*scale))
            patch=src[max(0,lo):min(src.shape[0],hi),start:end]
            if not patch.size:continue
            _,_,stats,centroids=cv2.connectedComponentsWithStats((patch<110).astype('uint8'),8)
            for (x,y,w,h,area),mid in zip(stats[1:],centroids[1:]):
                if not 4*scale<=w<=13*scale or not 4*scale<=h<=16*scale or area<8*scale*scale or area/(w*h)<.2:
                    continue
                along=start+float(mid[0]);cross=max(0,lo)+float(mid[1]);fraction=(along-a)/width
                # A latch is near one end of the leaf and stands away from its
                # edge. Thin frame strokes, end caps and central mullions fail.
                if not (-.08<=fraction<=.35 or .65<=fraction<=1.15) or abs(cross-center)<half+6*scale:
                    continue
                p0,p1=sorted([round(center+sign*half),round(cross)])
                bridge=src[max(0,p0):min(src.shape[0],p1+1),max(0,start+x-2):min(src.shape[1],start+x+w+2)]
                support=float((bridge<200).any(axis=1).mean()) if bridge.size else 0
                if support<.6:continue
                hit=dict(area=int(area),fraction=round(fraction,3),side='positive' if sign>0 else 'negative',support=round(support,3))
                break
            if hit:break
        if hit:
            c.update(kind='door',label='大入户门候选',door_model='entry',
                operation=dict(type='hinged',hinge='start' if hit['fraction']>.5 else 'end',side=hit['side'],angle_deg=0,direction_mode='auto'))
            e.update(closed_entry_panel=True,entry_latch=hit,classification_basis='exterior supported two-line panel with compact near-end latch')
    return candidates
