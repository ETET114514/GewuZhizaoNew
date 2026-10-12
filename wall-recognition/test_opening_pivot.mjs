import {test} from 'node:test';
import assert from 'node:assert/strict';
import {leafPose,rotateVector,resolveOperation,operationOf,openingSymbol} from './web/opening-operation.mjs';
import {buildModel} from './web/model-geometry.mjs';
const near=(a,b)=>assert(Math.abs(a-b)<1e-8,`${a} != ${b}`);
test('side pivots keep chosen axis fixed and swing the far edge to the requested side',()=>{
  for(const axis of [0,1])for(const hinge of ['start','end'])for(const side of ['negative','positive'])for(const ratio of [0,.25,.75,1]){
    const op={pivot_axis:'vertical',hinge,side,pivot_ratio:ratio,angle_deg:45},origin=[1,.9,2],width=1.2,height=1.5;
    const pose=leafPose(axis,origin,width,height,op),pivot=pose.transform([ratio*width,0,0]);
    near(pivot[0],origin[0]+(axis===0?ratio*width:0));near(pivot[2],origin[2]+(axis===1?ratio*width:0));
    const up=pose.transform([ratio*width,height,0]);near(up[1],.9+height);
    const length=Math.hypot(...rotateVector(pose.quaternion,[width,0,0]));near(length,width);
    if((hinge==='start'&&ratio<1)||(hinge==='end'&&ratio>0)){
      const free=pose.transform([hinge==='start'?width:0,0,0]);
      assert((free[axis===0?2:0]-origin[axis===0?2:0])*(side==='negative'?-1:1)>0);
    }
  }
});
test('top and bottom pivots tilt entire sash into correct side and retain horizontal axis endpoints',()=>{
  for(const axis of [0,1])for(const hinge of ['top','bottom'])for(const side of ['negative','positive']){
    const ratio=hinge==='top'?1:0,origin=[1,.9,2],pose=leafPose(axis,origin,1.2,1.5,{pivot_axis:'horizontal',pivot_ratio:ratio,hinge,side,angle_deg:45});
    for(const x of [0,1.2]){const p=pose.transform([x,ratio*1.5,0]);near(p[1],.9+ratio*1.5);near(p[0],1+(axis===0?x:0));near(p[2],2+(axis===1?x:0));}
    const free=pose.transform([.6,(1-ratio)*1.5,0]);assert((free[axis===0?2:0]-origin[axis===0?2:0])*(side==='negative'?-1:1)>0);
  }
});
test('window parts share quaternion; side/internal axes and tilt preserve wall aperture and fixed frame',()=>{
  const wall={id:'W001',orientation:'horizontal',start_px:[20,250],end_px:[480,250],thickness_px:20};
  const opening={id:'O001',kind:'window',orientation:'horizontal',start_px:[100,250],end_px:[200,250],thickness_px:20,review_status:'confirmed'};
  const doc={image:{width_px:500,height_px:500},scale_mm_per_px:10,walls:[wall],openings:[opening],furniture:[]},baseline=buildModel(doc);
  for(const [pivot_axis,hinge,pivot_ratio] of [['horizontal','top',1],['horizontal','bottom',0],['vertical','end',.75]]){
    opening.operation={type:'hinged',pivot_axis,hinge,pivot_ratio,side:'positive',angle_deg:45};
    const model=buildModel(doc),parts=model.boxes.filter(b=>b.quaternion);
    assert.equal(parts.length,5);assert(parts.every(b=>JSON.stringify(b.quaternion)===JSON.stringify(parts[0].quaternion)));
    assert.deepEqual(model.boxes.filter(b=>b.kind==='wall'),baseline.boxes.filter(b=>b.kind==='wall'));
    assert.equal(openingSymbol(doc,opening).flip,pivot_axis==='horizontal'?true:undefined);
  }
});
test('indoor room ownership resolves inward doors and outward windows; ambiguous ownership rejects auto',()=>{
  const context={negative:[{id:'R1'}],positive:[{id:'R2'}],interior_side:null,reason:'选择归属房间'},op={type:'hinged',hinge:'start',side:'positive',angle_deg:45,direction_mode:'auto',interior_room_id:'R1'};
  assert.equal(resolveOperation({kind:'door'},op,context).side,'negative');assert.equal(resolveOperation({kind:'window'},op,context).side,'positive');
  assert.throws(()=>resolveOperation({kind:'door'},{...op,interior_room_id:''},context),/归属/);
  for(const invalid of [{pivot_axis:'horizontal',hinge:'top'},{pivot_ratio:true},{pivot_ratio:-1}])assert.throws(()=>operationOf({kind:'door'},invalid));
});
