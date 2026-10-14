from probe import *
folder=root/'input/furniture-references'
path=folder/'templates.json'
specs=json.loads(path.read_text(encoding='utf-8'))
additions=[
    ('pale-upper-counter','kitchen_cabinet',[807,153,925,204],[811,159,922,200]),
    ('pale-u-bottom-cabinet','cabinet',[800,422,894,474],[807,429,889,468]),
    ('pale-right-upper-wardrobe','cabinet',[1171,826,1423,876],[1177,831,1418,868]),
    ('pale-entry-upper-cabinet','cabinet',[916,561,1056,617],[923,568,1050,611]),
    ('pale-center-landscape-area','unclassified_area',[508,622,771,769],[515,630,764,762]),
]
for id,kind,box,obj in additions:
    specs=[s for s in specs if s['id']!=id]
    specs.append(dict(id=id,kind=kind,image='11-light-rendered.png',bbox_px=box,object_bbox_px=obj,
        head_rotation_deg=0,feature_mode='soft_contrast',minimum_score=.88 if kind=='unclassified_area' else .91,
        minimum_detail_score=.6,minimum_short_side=50 if kind=='unclassified_area' else 22))
    if id in ('pale-center-landscape-area','pale-right-upper-wardrobe'):
        specs[-1]['scale_step']=1.02
path.write_text(json.dumps(specs,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
path=folder/'pale-landmarks.json'
truth=json.loads(path.read_text(encoding='utf-8'))
for id,kind,box,obj in additions:
    truth['targets']=[t for t in truth['targets'] if t['template_id']!=id]
    truth['targets'].append(dict(template_id=id,kind=kind,bbox_px=obj))
path.write_text(json.dumps(truth,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
