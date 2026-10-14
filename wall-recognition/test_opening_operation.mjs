import {test} from 'node:test';
import assert from 'node:assert/strict';
import {operationOf,swingGeometry,openingSymbol} from './web/opening-operation.mjs';
import {openingPreview} from './web/opening-edit.mjs';
import {buildModel} from './web/model-geometry.mjs';

const near=(a,b)=>assert(Math.abs(a-b)<1e-8,`${a} != ${b}`);
function fixture(vertical,kind='door'){
  const g=(a,b)=>({orientation:vertical?'vertical':'horizontal',start_px:vertical?[250,a]:[a,250],end_px:vertical?[250,b]:[b,250],thickness_px:20,length_px:b-a});
  return {image:{width_px:500,height_px:500},scale_mm_per_px:10,walls:[{id:'W001',...g(20,480)}],openings:[{id:'O001',kind,review_status:'confirmed',...g(100,200)}],furniture:[]};
}

test('ordinary door 800 mm aperture leaves room for the fitted leaf in 2D and 3D',()=>{
  for(const vertical of [false,true]){
    const doc=fixture(vertical),o=doc.openings[0];
    o.operation={type:'hinged',hinge:'end',side:'positive',angle_deg:90};
    const before=structuredClone(doc),preview=openingPreview(doc,'O001',{width_mm:800}),edited=preview.openings[0];
    const model=buildModel(preview),leaf=model.boxes.find(b=>b.kind==='door');
    near((model.openings[0].b-model.openings[0].a)*doc.scale_mm_per_px,800);
    near(leaf.size[0],.7);near(openingSymbol(preview,edited).length*doc.scale_mm_per_px,700);
    assert.deepEqual(edited.operation,o.operation);assert.deepEqual(doc,before);
    const preset=buildModel({...doc,model_settings:{width_mode:'preset',opening_width_mm:800}});
    near((preset.openings[0].b-preset.openings[0].a)*doc.scale_mm_per_px,800);
    const old=buildModel({...doc,model_settings:{width_mode:'preset',opening_width_mm:900}});
    near((old.openings[0].b-old.openings[0].a)*doc.scale_mm_per_px,900);
  }
});
test('all hinge and side choices agree between screen symbols and 3D door pivots in either orientation',()=>{
  for(const vertical of [false,true])for(const hinge of ['start','end'])for(const side of ['negative','positive'])for(const angle_deg of [0,35,90]){
    const doc=fixture(vertical),o=doc.openings[0],axis=vertical?1:0;
    o.operation={type:'hinged',hinge,side,angle_deg};
    const before=JSON.stringify(doc),symbol=openingSymbol(doc,o),model=buildModel(doc),leaf=model.boxes.find(b=>b.kind==='door');
    const world=p=>[(p[0]-250)*.01,(p[1]-250)*.01];
    const start=world(symbol.hinge),end=world(symbol.tip),direction=[Math.cos(leaf.rotation_y),-Math.sin(leaf.rotation_y)];
    near(leaf.center[0]-direction[0]*leaf.size[0]/2,start[0]);near(leaf.center[2]-direction[1]*leaf.size[0]/2,start[1]);
    near(leaf.center[0]+direction[0]*leaf.size[0]/2,end[0]);near(leaf.center[2]+direction[1]*leaf.size[0]/2,end[1]);
    near(symbol.hinge[axis],hinge==='start'?105:195);
    if(angle_deg>0)assert((symbol.tip[1-axis]-250)*(side==='negative'?-1:1)>0);
    assert.equal(JSON.stringify(doc),before);
  }
});
test('window sash frame and glass rotate together and fixed windows keep legacy geometry',()=>{
  for(const vertical of [false,true]){
    const doc=fixture(vertical,'window'),baseline=buildModel(doc);
    doc.openings[0].operation={type:'fixed',angle_deg:0};assert.deepEqual(buildModel(doc).boxes,baseline.boxes);
    doc.openings[0].operation={type:'hinged',hinge:'end',side:'positive',angle_deg:45};
    const model=buildModel(doc),glass=model.boxes.find(b=>b.kind==='glass'),moving=model.boxes.filter(b=>b.rotation_y!==undefined);
    assert.equal(moving.length,5);assert(moving.every(b=>b.rotation_y===glass.rotation_y));
    near(glass.center[1],1.65);assert.equal(model.boxes.filter(b=>b.kind==='wall').length,baseline.boxes.filter(b=>b.kind==='wall').length);
  }
});
test('direction previews require no scale, leave structural data intact and reject malformed operations',()=>{
  const doc=fixture(false);doc.scale_mm_per_px=null;doc.room_partition={regions:[{id:'R001',name:'房间'}]};
  const before=JSON.stringify(doc),op={type:'hinged',hinge:'start',side:'positive',angle_deg:90};
  const preview=openingPreview(doc,'O001',undefined,undefined,op);
  assert.deepEqual(preview.walls,doc.walls);assert.deepEqual(preview.room_partition,doc.room_partition);
  assert.deepEqual(preview.openings[0].operation,op);assert.equal(JSON.stringify(doc),before);
  assert.deepEqual(openingPreview(preview,'O001',undefined,undefined,null),doc);
  for(const operation of [{angle_deg:NaN},{angle_deg:91},{angle_deg:true},{hinge:'left'},{side:1},{type:'fixed'},{unknown:1}])assert.throws(()=>operationOf(doc.openings[0],operation));
  assert.equal(openingSymbol(doc,doc.openings[0]),null);
});
test('arc sweep travels toward the chosen image side for both hinges and orientations',()=>{
  for(const axis of [0,1])for(const hinge of ['start','end'])for(const side of ['negative','positive']){
    const s=swingGeometry({axis},100,200,250,{hinge,side,angle_deg:90});
    const sign=hinge==='start'?1:-1,positive=side==='positive'?1:-1;
    const expected=axis===0?(sign*positive>0?1:0):(sign*positive<0?1:0);
    assert(s.arc.includes(`0 0 ${expected} `));near(s.tip[axis],s.hinge[axis]);near(s.tip[1-axis]-250,100*positive);
  }
});

test('entry, bedroom and bathroom doors have 50 mm jambs and matching net leaf widths in 2D/3D',()=>{
  for(const vertical of [false,true])for(const scale of [5,10,20])for(const width of [1200,900,800]){
    const doc=fixture(vertical);doc.scale_mm_per_px=scale;
    const o=doc.openings[0];o.operation={type:'hinged',hinge:'start',side:'negative',angle_deg:0};
    const preview=openingPreview(doc,o.id,{width_mm:width}),model=buildModel(preview);
    const leaf=model.boxes.find(b=>b.kind==='door'),axis=vertical?2:0;
    near(leaf.size[0],(width-100)/1000);
    const jambs=model.boxes.filter(b=>b.kind==='frame'&&b.size[1]>1);
    assert.equal(jambs.length,2);for(const jamb of jambs)near(jamb.size[axis],.05);
    near(openingSymbol(preview,preview.openings[0]).length*scale,width-100);
  }
});
