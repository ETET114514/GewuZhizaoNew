"""Small, explicit furniture audit: reference reuse is not independent accuracy."""
import argparse
import json
from pathlib import Path
from time import perf_counter
from PIL import Image
from recognize_furniture import ROOT, detect_furniture, draw_furniture, overlap


def evaluate(output):
    cases = [
        ("default-plan", "input/floorplan.png", "rendered_template_source_calibration",
         [("bed",[431,200,513,315]),("bed",[310,531,426,614]),("bed",[482,509,607,603]),
          ("sofa",[77,499,121,618]),("sofa",[139,470,180,512]),("sofa",[143,596,186,638]),
          ("cabinet",[369,200,400,298]),("cabinet",[366,373,491,407]),("cabinet",[333,473,427,505])]),
        ("example-06", "input/furniture-references/06.jpg", "template_source_calibration",
         [("bed",[659,237,815,374]),("bed",[601,1014,758,1130]),("sofa",[295,264,367,465])]),
        ("example-08", "input/furniture-references/08.jpg", "same_layout_redrawn_not_independent",
         [("bed",[600,224,732,330]),("bed",[551,895,681,989]),("sofa",[284,248,348,415])]),
        ("reference-04", "input/reference-plans/04-furnished.png", "different_drawing_style_not_in_templates",
         [("bed",[702,769,932,942]),("bed",[1074,727,1304,938]),("sofa",[517,690,612,932])]),
    ]
    fixtures=json.loads((ROOT/'input/furniture-references/fixture-landmarks.json').read_text(encoding='utf-8'))['targets']
    cases[0][3].extend((f['kind'],f['bbox_px']) for f in fixtures)
    output.mkdir(exist_ok=True, parents=True)
    results=[]
    for name,path,role,truth in cases:
        image=Image.open(ROOT/path).convert('RGB')
        started=perf_counter();items=detect_furniture(image);elapsed=round(perf_counter()-started,2)
        matched=set();hits=[];missed=[]
        for kind,box in truth:
            candidates=[f for f in items if f['id'] not in matched and f['kind']==kind and overlap(f['bbox_px'],box)[0]>=.5]
            if candidates:
                best=max(candidates,key=lambda f:overlap(f['bbox_px'],box)[0]);matched.add(best['id']);hits.append(best['id'])
            else:missed.append({'kind':kind,'bbox_px':box})
        report={'case':name,'role':role,'target_count':len(truth),'matched_count':len(hits),
                'unmatched_candidates':[f for f in items if f['id'] not in matched],
                'missed_targets':missed,'seconds':elapsed,'furniture':items}
        folder=output/name;folder.mkdir(exist_ok=True)
        draw_furniture(image,items).save(folder/'furniture-overlay.png')
        (folder/'furniture.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
        results.append({k:v for k,v in report.items() if k!='furniture'})
        print(f'{name}: {len(hits)}/{len(truth)} targets, {len(items)-len(hits)} unmatched candidates, {elapsed}s',flush=True)
    (output/'evaluation.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,default=ROOT/'output/fixtures-v1')
    evaluate(parser.parse_args().output)
