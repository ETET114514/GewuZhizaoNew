import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildModel} from './web/model-geometry.mjs';

const wall=(id,orientation,start_px,end_px,thickness_px)=>({id,orientation,start_px,end_px,thickness_px});
function fixture(){return {image:{width_px:500,height_px:500},scale_mm_per_px:10,furniture:[],openings:[],walls:[
  wall('branch','horizontal',[85,100],[200,100],10),wall('receiver','vertical',[100,40],[100,200],20)]};}
function solid(model,x,z,y=1){
  const p=[(x-250)*.01,y,(z-250)*.01];
  return model.boxes.some(b=>b.kind==='wall'&&p.every((v,i)=>v>b.center[i]-b.size[i]/2+1e-7&&v<b.center[i]+b.size[i]/2-1e-7));
}
test('default flush removes short protrusions, closes T joins, preserves source and supports disabling',()=>{
  const doc=fixture(),before=JSON.stringify(doc),model=buildModel(doc);
  assert.equal(model.settings.flush_wall_joints,true);
  assert.equal(solid(model,87,100),false);assert.equal(solid(model,95,100),true);assert.equal(solid(model,112,100),true);
  assert.deepEqual(model.wallJointAdjustments,[{id:'branch',end:'start',from:85,to:90,receiver:'receiver'}]);
  assert.equal(JSON.stringify(doc),before);
  doc.model_settings={flush_wall_joints:false};assert.equal(solid(buildModel(doc),87,100),true);
  assert.equal(buildModel(doc).wallJointAdjustments.length,0);
});
test('sample upper wall tips W004 and W005 are flush with their receiving faces',()=>{
  const doc=fixture();doc.walls=[
    wall('W004','vertical',[365,181],[365,315],10),wall('W007','horizontal',[362,194.5],[576,194.5],15),
    wall('W005','horizontal',[259,193.5],[332,193.5],15),wall('W006','vertical',[272,186],[272,378],16)];
  const tips=buildModel(doc).wallJointAdjustments;
  assert(tips.some(t=>t.id==='W004'&&t.from===181&&t.to===187));
  assert(tips.some(t=>t.id==='W005'&&t.from===259&&t.to===264));
});
test('mirrors, rotated walls and recalibration use the same geometric rule',()=>{
  for(const rotate of [false,true])for(const mirror of [false,true])for(const scale of [10,20]){
    const doc=fixture();doc.scale_mm_per_px=scale;
    if(mirror)for(const w of doc.walls){w.start_px[0]=500-w.start_px[0];w.end_px[0]=500-w.end_px[0];if(w.orientation==='horizontal')[w.start_px,w.end_px]=[w.end_px,w.start_px];}
    if(rotate)for(const w of doc.walls){w.start_px.reverse();w.end_px.reverse();w.orientation=w.orientation==='horizontal'?'vertical':'horizontal';}
    const change=buildModel(doc).wallJointAdjustments.find(a=>a.id==='branch');
    assert.equal(Math.abs(change.to-change.from),5);assert.equal(change.end,mirror?'end':'start');
  }
});
test('long returns, disconnected walls, free ends, crossings and continuing split walls stay intact',()=>{
  for(const alter of [
    d=>{d.walls[0].start_px[0]=60;},
    d=>{d.walls[1].start_px[1]=110;},
    d=>{d.walls.pop();},
    d=>{d.walls[0].start_px[0]=40;d.walls[0].end_px[0]=200;},
    d=>{d.walls.push(wall('continuation','horizontal',[30,100],[85,100],10));},
    d=>{d.walls[1].review_status='rejected';}
  ]){
    const doc=fixture();alter(doc);const model=buildModel(doc);
    assert(!model.wallJointAdjustments.some(c=>c.id==='branch'));
  }
});
test('trimming cannot erase a door/window aperture or an unknown gap, or use it as a solid receiver',()=>{
  for(const kind of ['door','window','unknown'])for(const host of ['branch','receiver']){
    const doc=fixture();
    const range=host==='branch'?{orientation:'horizontal',start_px:[86,100],end_px:[95,100],thickness_px:10}:
      {orientation:'vertical',start_px:[100,80],end_px:[100,120],thickness_px:20};
    if(kind==='unknown')doc.walls.find(w=>w.id===host).opening_hints=[range];
    else doc.openings=[{id:'O1',kind,...range}];
    const before=JSON.stringify(doc),model=buildModel(doc);
    assert(!model.wallJointAdjustments.some(c=>c.id==='branch'));
    assert.equal(JSON.stringify(doc),before);
    if(kind!=='unknown')assert.equal(model.openings.length,1);
  }
});
test('door and window geometry and their sill/header voids survive nearby wall trimming',()=>{
  const doc=fixture();doc.openings=[{id:'D1',kind:'door',orientation:'horizontal',start_px:[130,100],end_px:[160,100],thickness_px:10}];
  let model=buildModel(doc);assert.equal(model.wallJointAdjustments.length,1);
  assert.equal(solid(model,145,100,1),false);assert.equal(solid(model,145,100,2.5),true);
  doc.model_settings={flush_wall_joints:false};const raw=buildModel(doc);
  assert.deepEqual(model.openings,raw.openings);
  assert.deepEqual(model.boxes.filter(b=>b.kind!=='wall'),raw.boxes.filter(b=>b.kind!=='wall'));
  doc.openings[0].kind='window';doc.model_settings={flush_wall_joints:true};model=buildModel(doc);
  assert.equal(solid(model,145,100,.5),true);assert.equal(solid(model,145,100,1.5),false);assert.equal(solid(model,145,100,2.6),true);
});

function cornerFixture(){
  const doc=fixture();doc.walls=[
    {...wall('MAIN','horizontal',[20,100],[200,100],20),source:'automatic'},
    {...wall('ARM','horizontal',[165,135],[207,135],8),source:'automatic'},
    {...wall('HOST','vertical',[200,139],[200,260],10),source:'automatic_opening_connection'}];
  doc.openings=[{id:'WIN',kind:'window',orientation:'vertical',start_px:[200,139],end_px:[200,260],thickness_px:10,
    evidence:{exterior_frame:true},jamb_support_ids:['ARM']}];
  return doc;
}
test('exterior frame returns become aligned short jambs, while window geometry and all source data stay intact',()=>{
  const doc=cornerFixture(),before=JSON.stringify(doc),model=buildModel(doc);
  assert.deepEqual(model.wallCornerAdjustments,[{id:'ARM',host:'HOST',end:'start',from:139,to:110,receiver:'MAIN'}]);
  assert(!model.boxes.some(b=>b.kind==='wall'&&b.id==='ARM'));
  assert.equal(solid(model,200,125),true);assert.equal(solid(model,170,135),false);assert.equal(solid(model,206,135),false);
  assert.equal(solid(model,200,180,1.5),false);assert.equal(solid(model,200,180,.5),true);assert.equal(solid(model,200,180,2.6),true);
  assert.equal(JSON.stringify(doc),before);
  doc.model_settings={flush_wall_joints:false};const raw=buildModel(doc);
  assert.equal(raw.wallCornerAdjustments.length,0);assert.equal(solid(raw,170,135),true);
  assert.deepEqual(raw.openings,model.openings);
  assert.deepEqual(raw.boxes.filter(b=>b.kind!=='wall'),model.boxes.filter(b=>b.kind!=='wall'));
});
test('confirmed/manual partitions, ambiguous corners and protected openings cannot be replaced as frame returns',()=>{
  for(const alter of [
    d=>{d.walls[1].review_status='confirmed';},d=>{d.walls[1].source='manual';},
    d=>{d.walls[0].start_px[0]=100;},d=>{d.walls[0].end_px[0]=350;},
    d=>{d.walls[0].thickness_px=8;},d=>{d.openings[0].evidence.exterior_frame=false;},
    d=>{d.openings[0].jamb_support_ids=[];},
    d=>{d.openings.push({id:'PENDING',kind:'unclassified',orientation:'vertical',start_px:[200,120],end_px:[200,130],thickness_px:10,requires_confirmation:true});},
    d=>{d.walls[2].opening_hints=[{orientation:'vertical',start_px:[200,120],end_px:[200,130]}];},
    d=>{d.walls[1].opening_hints=[{start_px:[170,135],end_px:[180,135]}];}
  ]){
    const doc=cornerFixture();alter(doc);assert.equal(buildModel(doc).wallCornerAdjustments.length,0);
  }
});
test('aligned window jamb replacement works after mirroring, axis rotation and scale changes',()=>{
  for(const mirror of [false,true])for(const rotate of [false,true])for(const scale of [10,20]){
    const doc=cornerFixture();doc.scale_mm_per_px=scale;
    if(mirror)for(const item of [...doc.walls,...doc.openings]){
      item.start_px[1]=500-item.start_px[1];item.end_px[1]=500-item.end_px[1];
      if(item.orientation==='vertical')[item.start_px,item.end_px]=[item.end_px,item.start_px];
    }
    if(rotate)for(const item of [...doc.walls,...doc.openings]){
      item.start_px.reverse();item.end_px.reverse();item.orientation=item.orientation==='horizontal'?'vertical':'horizontal';
    }
    const before=JSON.stringify(doc),change=buildModel(doc).wallCornerAdjustments[0];
    assert(change);assert.equal(change.id,'ARM');assert.equal(Math.abs(change.to-change.from),29);assert.equal(change.end,mirror?'end':'start');
    assert.equal(JSON.stringify(doc),before);
  }
});
test('aperture end frames support flush corners but window interiors and unresolved gaps do not',()=>{
  for(const kind of ['window','door']){
    const doc=fixture();doc.walls=[wall('ARM','horizontal',[160,96],[211,96],8),wall('HOST','vertical',[200,100],[200,230],10)];
    doc.openings=[{id:'OPEN',kind,orientation:'vertical',start_px:[200,100],end_px:[200,230],thickness_px:10}];
    const model=buildModel(doc);assert(model.wallJointAdjustments.some(c=>c.id==='ARM'&&c.to===205));
    doc.walls[0].start_px[1]=doc.walls[0].end_px[1]=160;
    assert(!buildModel(doc).wallJointAdjustments.some(c=>c.id==='ARM'));
  }
});
test('thin arms use the thicker receiver allowance; source screenshot door and balcony tips become flush',()=>{
  const doc=fixture();doc.walls=[wall('ARM','horizontal',[399,693],[451,693],8),wall('MAIN','vertical',[431,465],[431,697],16)];
  assert(buildModel(doc).wallJointAdjustments.some(c=>c.id==='ARM'&&c.to===439));
  doc.walls[0].end_px[0]=470;assert(!buildModel(doc).wallJointAdjustments.some(c=>c.id==='ARM'));
});

function buttCorner(){
  const doc=fixture();doc.walls=[wall('H','horizontal',[20,100],[100,100],20),wall('V','vertical',[100,100],[100,200],10)];
  return doc;
}

test('touching L corners fill the missing outer quadrant and unequal wall thickness notch',()=>{
  const doc=buttCorner(),before=JSON.stringify(doc),model=buildModel(doc);
  assert.equal(solid(model,103,95),true);assert.equal(solid(model,103,95,2.79),true);
  assert.equal(solid(model,106,95),false);assert.equal(solid(model,103,89),false);
  assert(model.wallCornerFills.length>0);assert.equal(JSON.stringify(doc),before);
  doc.model_settings={flush_wall_joints:false};assert.equal(solid(buildModel(doc),103,95),false);
  assert.deepEqual(buildModel(doc).wallCornerFills,[]);
});

test('corner completion protects window and door volumes including edited sill/header heights',()=>{
  for(const kind of ['window','door']){
    const doc=buttCorner();doc.openings=[{id:'O',kind,orientation:'vertical',start_px:[100,100],end_px:[100,200],thickness_px:10,
      dimensions_mm:kind==='window'?{height_mm:1200,sill_height_mm:500}:{height_mm:1900}}];
    const model=buildModel(doc),opening=model.openings[0];
    assert.equal(solid(model,103,105,1),false);
    assert.equal(solid(model,103,95,1),true);
    for(const p of model.wallCornerFills){
      assert(!(p.x0<105&&p.x1>95&&p.z0<200&&p.z1>100&&p.bottom<opening.top&&p.top>opening.bottom));
    }
    doc.model_settings={flush_wall_joints:false};const raw=buildModel(doc);
    assert.deepEqual(model.openings,raw.openings);
    assert.deepEqual(model.boxes.filter(b=>b.kind!=='wall'),raw.boxes.filter(b=>b.kind!=='wall'));
  }
});

test('two meeting windows retain both apertures while their sill and header corners are completed',()=>{
  const doc=buttCorner();doc.openings=[
    {id:'OH',kind:'window',orientation:'horizontal',start_px:[20,100],end_px:[100,100],thickness_px:20},
    {id:'OV',kind:'window',orientation:'vertical',start_px:[100,100],end_px:[100,200],thickness_px:10}];
  const model=buildModel(doc);
  assert.equal(solid(model,103,95,.5),true);assert.equal(solid(model,103,95,2.6),true);
  assert.equal(solid(model,103,95,1.5),false);
  assert.equal(solid(model,97,105,1.5),false);assert.equal(solid(model,97,95,1.5),false);
  assert.equal(model.openings.length,2);
});

test('unknown openings, real gaps, rejected walls, free ends and existing T/cross joins gain no masonry',()=>{
  const unknown=buttCorner();unknown.walls[0].opening_hints=[{start_px:[90,100],end_px:[105,100]}];
  assert.equal(solid(buildModel(unknown),103,95),false);
  for(const alter of [
    d=>{d.walls[0].end_px[0]=94.999;},d=>{d.walls[1].start_px[1]=110.001;},
    d=>{d.walls[1].review_status='rejected';},d=>{d.walls.pop();},
    d=>{d.walls[1].start_px[1]=20;},d=>{d.walls[0].end_px[0]=200;d.walls[1].start_px[1]=20;}
  ]){const doc=buttCorner();alter(doc);assert.equal(buildModel(doc).wallCornerFills.length,0);}
});

test('outer corner completion follows mirroring, rotation and recalibration',()=>{
  for(const mirror of [false,true])for(const rotate of [false,true])for(const scale of [10,20]){
    const doc=buttCorner();doc.scale_mm_per_px=scale;let point=[103,95];
    if(mirror){point[0]=500-point[0];for(const w of doc.walls){w.start_px[0]=500-w.start_px[0];w.end_px[0]=500-w.end_px[0];if(w.orientation==='horizontal')[w.start_px,w.end_px]=[w.end_px,w.start_px];}}
    if(rotate){point.reverse();for(const w of doc.walls){w.start_px.reverse();w.end_px.reverse();w.orientation=w.orientation==='horizontal'?'vertical':'horizontal';}}
    const p=[(point[0]-250)*scale/1000,1,(point[1]-250)*scale/1000],model=buildModel(doc);
    assert(model.boxes.some(b=>b.component==='wall_corner'&&p.every((v,i)=>v>b.center[i]-b.size[i]/2&&v<b.center[i]+b.size[i]/2)));
  }
});
