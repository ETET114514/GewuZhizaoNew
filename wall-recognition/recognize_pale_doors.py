"""Recover faint single/double swings at observed structural wall gaps."""
import cv2
import numpy as np


def detect_pale_doors(image, walls, scale):
    from recognize_openings import geometry, suppress
    gray = np.asarray(image.convert('L'))
    background = cv2.morphologyEx(gray, cv2.MORPH_CLOSE, np.ones((13, 13), np.uint8))
    contrast = np.maximum(0, background.astype(float)-gray)
    soft = np.clip(contrast/8, 0, 1).astype('float32')
    soft = cv2.dilate(soft, np.ones((3, 3), np.uint8))
    theta = np.linspace(.15, 1.42, 56)
    ct, st = np.cos(theta), np.sin(theta)
    step = max(1, round(scale))

    def sample(x, y):
        return cv2.remap(soft, np.asarray(x, dtype='float32'), np.asarray(y, dtype='float32'),
                         cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)

    def fit(axis, hinge_along, center, radius, direction, leaf_sign):
        offsets = np.arange(-4*step, 4*step+1, step)
        hs, cs, rs = np.meshgrid(offsets, offsets, np.arange(-3*step, 3*step+1, step), indexing='ij')
        hs, cs, rs = hinge_along+hs.ravel(), center+cs.ravel(), radius+rs.ravel()
        def sweep(rad):
            u = hs[:, None]+direction*rad[:, None]*ct
            v = cs[:, None]+leaf_sign*rad[:, None]*st
            return sample(u, v) if axis == 0 else sample(v, u)
        hit = sweep(rs)
        support = hit.mean(axis=1)
        coverage = np.minimum.reduce([part.mean(axis=1) for part in np.array_split(hit, 4, axis=1)])
        off = (sweep(rs-5*scale).mean(axis=1)+sweep(rs+5*scale).mean(axis=1))/2
        # A visible perpendicular leaf must agree with the fitted hinge/radius.
        t = np.linspace(.12, .88, 36)
        u = np.broadcast_to(hs[:, None], (len(hs), len(t)))
        v = cs[:, None]+leaf_sign*rs[:, None]*t
        leaf = (sample(u, v) if axis == 0 else sample(v, u)).mean(axis=1)
        valid = (support > .74) & (coverage > .52) & (support-off > .38) & (leaf > .60)
        scores = .55*support+.25*(support-off)+.20*leaf
        scores -= .002*(abs(hs-hinge_along)+abs(cs-center)+abs(rs-radius))
        indices = np.flatnonzero(valid)
        if not len(indices):
            return None
        k = indices[np.argmax(scores[indices])]
        return float(scores[k]), float(hs[k]), float(cs[k]), float(rs[k]), dict(
            arc_support=round(float(support[k]), 3), arc_contrast=round(float(support[k]-off[k]), 3),
            leaf_support=round(float(leaf[k]), 3), jamb_support='paired_wall_ends', feature_mode='soft_contrast')

    proposals = []
    for axis in (0, 1):
        oriented = [w for w in walls if w['orientation'] == ('horizontal' if axis == 0 else 'vertical')]
        # Project perpendicular jambs onto each real wall axis. Doorways often
        # end at a T junction rather than at another parallel wall segment.
        projected = list(oriented)
        for wall in oriented:
            c = wall['start_px'][1-axis]
            for cross in walls:
                box = cross['bbox_px']
                if cross['orientation'] == wall['orientation'] or not box[1-axis] <= c <= box[3-axis]:
                    continue
                projected.append({**geometry(axis, box[axis], box[axis+2], c, wall['thickness_px'], image.size),
                                  '_projected':True})
        for first in projected:
            a = first['bbox_px'][axis+2]
            c = first['start_px'][1-axis]
            for second in projected:
                if first.get('_projected') and second.get('_projected'):
                    continue
                b = second['bbox_px'][axis]
                if not 20*scale <= b-a <= 130*scale:
                    continue
                if abs(c-second['start_px'][1-axis]) > min(first['thickness_px'], second['thickness_px'])/2:
                    continue
                if any(w is not first and w is not second and
                       abs(w['start_px'][1-axis]-c) < 6*scale and
                       min(b, w['bbox_px'][axis+2])-max(a, w['bbox_px'][axis]) > 8*scale
                       for w in oriented):
                    continue
                center = (c+second['start_px'][1-axis])/2
                for count in (1, 2):
                    radius = (b-a)/count
                    if not 20*scale <= radius <= 65*scale:
                        continue
                    fitted = []
                    for hinge, direction in ((a, 1), (b, -1)):
                        fits = [fit(axis, hinge, center, radius, direction, sign) for sign in (-1, 1)]
                        fits = [(f, sign) for f, sign in zip(fits, (-1, 1)) if f is not None]
                        if fits:
                            f, sign = max(fits, key=lambda item:item[0][0])
                            fitted.append((f, sign, direction))
                    if count == 2 and (len(fitted) != 2 or fitted[0][1] != fitted[1][1]):
                        continue
                    if not fitted:
                        continue
                    f, sign, direction = max(fitted, key=lambda item:item[0][0])
                    score, hinge, cross, r, evidence = f
                    lo, hi = sorted((hinge, hinge+direction*r))
                    if count == 2:
                        lo, hi, cross = a, b, center
                    evidence = dict(evidence, leaf_count=count,
                                    swing_side=('down' if sign>0 else 'up') if axis==0 else ('right' if sign>0 else 'left'))
                    proposals.append({**geometry(axis, lo, hi, cross, min(first['thickness_px'], second['thickness_px']), image.size),
                        'kind':'door', 'label':'双扇门候选' if count==2 else '平开门候选', 'score':round(score, 4),
                        'hinge_px':[hinge, cross] if axis==0 else [cross, hinge],
                        'leaf_end_px':[hinge, cross+sign*r] if axis==0 else [cross+sign*r, hinge], 'evidence':evidence})
    return suppress(proposals, scale)
