"""Long pale perimeter strokes: candidates only, never implicit solid walls."""
import cv2
import numpy as np


def detect_pale_boundaries(image, walls, scale):
    from recognize_openings import geometry, suppress, alongside_wall
    gray = np.asarray(image.convert('L'), dtype=np.float32)
    _, white_regions = cv2.connectedComponents((gray > 248).astype('uint8'))
    margin = max(1, round(min(image.size)*.05))
    border_regions = np.unique(np.concatenate((white_regions[:margin].ravel(), white_regions[-margin:].ravel(),
                                               white_regions[:, :margin].ravel(), white_regions[:, -margin:].ravel())))
    proposals = []
    minimum = max(100, round(100*scale))
    offset = max(3, round(3*scale))
    for axis in (0, 1):
        source = gray if axis == 0 else gray.T
        regions = white_regions if axis == 0 else white_regions.T
        pad = np.pad(source, ((offset, offset), (0, 0)), mode='edge')
        contrast = np.maximum(pad[:-2*offset], pad[2*offset:])-source
        ink = ((source > 200) & (source < 248) & (contrast > 5)).astype('uint8')
        joined = cv2.morphologyEx(ink, cv2.MORPH_CLOSE, np.ones((1, max(3, round(5*scale))), np.uint8))
        long = cv2.morphologyEx(joined, cv2.MORPH_OPEN, np.ones((1, minimum), np.uint8))
        n, _, stats, _ = cv2.connectedComponentsWithStats(long)
        for a, lo, length, thickness, area in stats[1:]:
            if thickness > 6*scale or length < minimum:
                continue
            b, c = int(a+length), float(lo+thickness/2)
            a = int(a)
            if alongside_wall(axis, a, b, c, walls, scale):
                continue
            supported = False
            for sign in (-1, 1):
                def strip(side, d1, d2):
                    l, h = sorted((round(c+side*d1*scale), round(c+side*d2*scale)))
                    return source[max(0,l):min(source.shape[0],h), a:b]
                outside, inside = strip(sign, 10, 24), strip(-sign, 10, 24)
                if not outside.size or not inside.size or min(outside.shape)<2:
                    continue
                # Hatch/terrain on one side, bright room on the other. Keep
                # local contrast so flat fills and page/dimension lines fail.
                gy, gx = np.gradient(outside)
                coherence = abs(float(np.mean(gx*gy))) / max(1, float(np.sqrt(np.mean(gx*gx)*np.mean(gy*gy))))
                il, ih = sorted((round(c-sign*10*scale), round(c-sign*24*scale)))
                region_patch = regions[max(0,il):min(regions.shape[0],ih), a:b]
                enclosed = np.mean((region_patch != 0) & ~np.isin(region_patch, border_regions)) > .55
                if (enclosed and coherence > .3 and 180 < float(outside.mean()) < 236 and float(outside.std()) > 6
                        and float(inside.mean()) > 245 and np.mean(inside > 245) > .8):
                    supported = True
                    break
            if supported:
                proposals.append({**geometry(axis, a, b, c, 8*scale, image.size),
                    'kind':'unclassified', 'label':'浅色外围边界待确认', 'score':.6,
                    'requires_confirmation':True,
                    'evidence':{'feature_mode':'pale_perimeter', 'ambiguity':'wall or glazing; no material inference'}})
    return suppress(proposals, scale)
