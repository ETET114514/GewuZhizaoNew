"""Offline manually marked room experiment. Does not alter the application.

Run with the application's Python environment. Targets and room boundaries are
fixed before inference. These are selected visual landmarks, not complete truth.
"""
from copy import deepcopy
import json
from pathlib import Path
import sys
from time import perf_counter

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from recognize_furniture import add_furniture, conflicting_candidates, overlap
from recognize_learned_furniture import predict, session, CLASS_MAP

OUT = Path(__file__).resolve().parent
MODEL = ROOT / 'models/floorcad-nano.onnx'

def t(name, kind, box):
    return {'name': name, 'kind': kind, 'bbox_px': box}

CASES = [
    {'id': 'gray', 'image': 'input/furniture-references/06.jpg', 'regions': [
        {'name': 'kitchen', 'label': '厨房', 'bbox_px': [548, 590, 780, 768], 'targets': [
            t('上柜台', 'cabinet', [647,608,757,650]), t('右柜台', 'cabinet', [714,651,757,715]),
            t('下柜台', 'cabinet', [572,717,758,760]), t('水槽', 'kitchen_sink', [718,657,754,712]),
            t('灶台', 'cooktop', [632,722,695,758]), t('冰箱', 'refrigerator', [579,608,645,651])]},
        {'name': 'dining', 'label': '餐厅', 'bbox_px': [280,460,557,785], 'targets': [
            t('餐桌', 'table', [406,595,471,725]),
            *[t(f'餐椅{i+1}', 'chair', b) for i,b in enumerate([
                [377,600,417,637],[460,600,501,637],[377,642,417,679],
                [460,642,501,679],[377,682,417,718],[460,682,501,718]])]]},
        {'name': 'bedroom', 'label': '卧室（含桌子）', 'bbox_px': [192,879,575,1200], 'targets': [
            t('左下衣柜', 'cabinet', [211,1027,248,1097]),
            t('左上柜体', 'cabinet', [249,900,305,938]),
            t('右侧上柜体', 'cabinet', [516,1006,557,1097]),
            t('右侧下柜体', 'cabinet', [516,1112,557,1184]),
            t('右侧书桌', 'table', [516,899,558,1006]),
            t('书桌椅', 'chair', [487,931,526,969]),
            t('左侧梳妆桌', 'table', [218,936,251,990])]},
    ]},
    {'id': 'line', 'image': 'input/reference-plans/04-furnished.png', 'regions': [
        {'name': 'kitchen', 'label': '厨房', 'bbox_px': [543,143,789,507], 'targets': [
            t('水槽', 'kitchen_sink', [589,176,675,235]),
            t('灶台', 'cooktop', [710,275,765,376])]},
        {'name': 'dining', 'label': '餐厅', 'bbox_px': [200,270,548,610], 'targets': [
            t('餐桌', 'table', [229,384,384,474]),
            *[t(f'餐椅{i+1}', 'chair', b) for i,b in enumerate([
                [237,347,297,384],[313,347,374,384],[237,473,298,509],[313,473,375,509]])]]},
        {'name': 'bedroom', 'label': '主卧', 'bbox_px': [950,568,1324,1027], 'targets': [
            t('床', 'bed', [1078,730,1305,938]),
            t('衣柜', 'cabinet', [1120,573,1307,640]),
            t('上床头柜', 'cabinet', [1253,678,1307,730]),
            t('下床头柜', 'cabinet', [1254,938,1307,992])]},
        {'name': 'study', 'label': '书房', 'bbox_px': [997,318,1316,568], 'targets': [
            t('书桌', 'table', [1238,330,1306,493]),
            t('书桌椅', 'chair', [1202,401,1249,455])]},
    ]},
]

FAMILY = {'dining_table':'table', 'coffee_table':'table', 'kitchen_cabinet':'cabinet',
          'shoe_cabinet':'cabinet', 'tv_console':'cabinet'}
PREFERRED = {'kitchen': {'cabinet','kitchen_sink','cooktop','refrigerator'},
             'dining': {'table','chair','cabinet'},
             'bedroom': {'bed','cabinet','table','chair'}, 'study': {'table','chair','cabinet'}}

def inside(item, region):
    a,b,c,d = item['bbox_px']
    x0,y0,x1,y1 = region
    return x0 <= (a+c)/2 < x1 and y0 <= (b+d)/2 < y1

def translate(items, left, top):
    items = deepcopy(items)
    for item in items:
        a,b,c,d = item['bbox_px']
        item['bbox_px'] = [round(a+left,2),round(b+top,2),round(c+left,2),round(d+top,2)]
    return items

def metrics(items, targets):
    # Greedy one-to-one pairing, with the strongest IoU first. A generic table
    # counts as table localization; this does not establish its specific use.
    pairs = sorted([(overlap(f['bbox_px'],gt['bbox_px'])[0], i, j)
                    for i,f in enumerate(items) for j,gt in enumerate(targets)
                    if FAMILY.get(f['kind'],f['kind']) == gt['kind']], reverse=True)
    used, hits, matches = set(), set(), []
    for iou,i,j in pairs:
        if iou >= .5 and i not in used and j not in hits:
            used.add(i); hits.add(j)
            matches.append({'target':targets[j]['name'], 'iou':round(iou,3), 'prediction':items[i]})
    return {'hits':len(hits), 'targets':len(targets), 'missed':[gt['name'] for j,gt in enumerate(targets) if j not in hits],
            'matches':matches, 'unmatched_candidates':[f for i,f in enumerate(items) if i not in used]}

def merge(full, additions):
    kept = deepcopy(full)
    for item in sorted(additions, key=lambda i:-i['match_score']):
        if not any(conflicting_candidates(item, old) for old in kept):
            kept.append(item)
    return kept

def render(image, region, variants, path):
    x0,y0,x1,y1 = region['bbox_px']
    scale = min(1.8, 560/(x1-x0))
    w,h = round((x1-x0)*scale), round((y1-y0)*scale)
    canvas = Image.new('RGB', (len(variants)*(w+24),h+100), 'white')
    font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 15)
    for column,(title,items) in enumerate(variants):
        offset = column*(w+24)+12
        crop = image.crop(region['bbox_px']).resize((w,h))
        canvas.paste(crop,(offset,65))
        draw = ImageDraw.Draw(canvas)
        draw.text((offset,8),region['label']+' · '+title,font=font,fill='black')
        m = metrics(items,region['targets'])
        draw.text((offset,31),f"核查目标命中 {m['hits']}/{m['targets']}",font=font,fill='black')
        for gt in region['targets']:
            a,b,c,d=gt['bbox_px']
            draw.rectangle((offset+(a-x0)*scale,65+(b-y0)*scale,offset+(c-x0)*scale,65+(d-y0)*scale),outline='#109040',width=2)
        for i,item in enumerate(items,1):
            a,b,c,d=item['bbox_px']
            coords=(offset+max(0,a-x0)*scale,65+max(0,b-y0)*scale,
                    offset+min(x1-x0,c-x0)*scale,65+min(y1-y0,d-y0)*scale)
            draw.rectangle(coords,outline='#d03340',width=2)
            draw.text((coords[0],max(65,coords[1]-18)),f"{i} {item.get('label',item['kind'])}",font=font,fill='#a01020',stroke_width=1,stroke_fill='white')
    canvas.save(path)


def main():
    (OUT/'cases.json').write_text(json.dumps(CASES,ensure_ascii=False,indent=2),encoding='utf-8')
    session(str(MODEL))
    report=[]
    for case in CASES:
        image=Image.open(ROOT/case['image']).convert('RGB')
        started=perf_counter()
        full=add_furniture({},image)['furniture']
        full_seconds=perf_counter()-started
        raw_full=predict(image,MODEL,threshold=.35,cad=True)
        for region in case['regions']:
            x0,y0,x1,y1=region['bbox_px']
            crop=image.crop((x0,y0,x1,y1))
            started=perf_counter()
            local=translate(add_furniture({},crop)['furniture'],x0,y0)
            local_seconds=perf_counter()-started
            baseline=[f for f in full if inside(f,region['bbox_px'])]
            combined=merge(baseline,local)
            # A separate diagnostic asks whether prioritized lower-score model
            # candidates help. Unsupported raw fixture labels are never remapped.
            raw_local=translate(predict(crop,MODEL,threshold=.35,cad=True),x0,y0)
            preferred=[]
            for r in raw_local:
                kind=CLASS_MAP.get(r['label'])
                if kind in PREFERRED[region['name']] and .40 <= r['score'] < .55:
                    preferred.append({'kind':kind,'bbox_px':r['bbox_px'],'match_score':r['score'],
                                      'source':'room_priority_diagnostic','raw_label':r['label']})
            prioritized=merge(combined,preferred)
            variants={'full':baseline,'crop':local,'combined':combined,'priority':prioritized}
            row={'image':case['id'],'region':region,'full_seconds':round(full_seconds,3),
                 'crop_seconds':round(local_seconds,3),'metrics':{k:metrics(v,region['targets']) for k,v in variants.items()},
                 'predictions':variants,'raw_full':[r for r in raw_full if inside(r,region['bbox_px'])],
                 'raw_crop':raw_local}
            report.append(row)
            render(image,region,[('整图',baseline),('单独分区',local),('整图＋分区',combined)],OUT/f"{case['id']}-{region['name']}.png")
            (OUT/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
            print(case['id'],region['name'],{k:f"{m['hits']}/{m['targets']}" for k,m in row['metrics'].items()},round(local_seconds,2),flush=True)
    print('TOTAL',{k:sum(r['metrics'][k]['hits'] for r in report) for k in ('full','crop','combined','priority')},
          'targets',sum(len(r['region']['targets']) for r in report),flush=True)

if __name__ == '__main__':
    main()
