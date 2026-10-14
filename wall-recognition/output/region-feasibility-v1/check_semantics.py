"""Exploratory kitchen context check, reusing existing basin verification gates.

The model's 'bath' label alone cannot mean kitchen sink. Require the manual
kitchen region, two-view agreement, and an enclosed rounded basin. Output stays
unreviewed. This experiment has not been integrated into detection.
"""
import json
from PIL import Image, ImageOps
from evaluate import ROOT, OUT, MODEL, inside, merge, metrics, overlap, render
from recognize_learned_furniture import predict, interior_shapes

rows=json.loads((OUT/'results.json').read_text(encoding='utf-8'))
scales=json.loads((OUT/'scale-results.json').read_text(encoding='utf-8'))
report=[]
for name,file in [('gray','input/furniture-references/06.jpg'),('line','input/reference-plans/04-furnished.png')]:
    image=Image.open(ROOT/file).convert('RGB')
    region=next(r['region'] for r in rows if r['image']==name and r['region']['name']=='kitchen')
    base=next(r['union'] for r in scales if r['image']==name and r['region']['name']=='kitchen')
    raw=predict(image,MODEL,threshold=.35,cad=True)
    alternate=predict(ImageOps.invert(image),MODEL,threshold=.55)
    candidates=[]
    exclusions=[]
    for item in raw:
        if item['label']!='bath' or item['score']<.75:
            continue
        agreement=max((overlap(item['bbox_px'],other['bbox_px'])[0] for other in alternate
                       if other['label']=='bath' and other['score']>=.7),default=0)
        shapes=interior_shapes(image,item['bbox_px'])
        rounded=any(.2<area<.65 and 5<=vertices<=12 for area,vertices in shapes)
        audit={**item,'second_view_iou':round(agreement,3),'basin_geometry':rounded,
               'in_kitchen':inside(item,region['bbox_px'])}
        if agreement>.65 and rounded and audit['in_kitchen']:
            candidates.append({'kind':'kitchen_sink','label':'水槽待校核','bbox_px':item['bbox_px'],
                               'match_score':item['score'],'review_status':'unreviewed',
                               'source':'offline_room_semantic_experiment','evidence':audit})
        else:
            exclusions.append(audit)
    combined=merge(base,candidates)
    entry={'image':name,'region':region,'candidates':candidates,'excluded':exclusions,
           'metrics':metrics(combined,region['targets']),'combined':combined}
    report.append(entry)
    render(image,region,[('整图＋尺度补检',base),('区域＋盆体双视图校核',combined)],OUT/f'{name}-kitchen-semantic.png')
    print(name,'new candidates',len(candidates),'hits',entry['metrics']['hits'],'/',entry['metrics']['targets'],flush=True)
(OUT/'semantic-results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print('TOTAL with exploratory semantic rule',sum(r['union_metrics']['hits'] for r in scales)
      +sum(r['metrics']['hits']-next(s['union_metrics']['hits'] for s in scales
          if s['image']==r['image'] and s['region']['name']=='kitchen') for r in report))
