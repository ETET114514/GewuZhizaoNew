import {test} from 'node:test';
import assert from 'node:assert/strict';
import {collisionBox,boxesIntersect,buildCollisionBoxes,checkCollisions,furnitureCollisionBox,boxFootprint,collisionMessage} from './web/collision-boxes.mjs';
const box=(center,size=[1,1,1],angle=0)=>collisionBox({center,size,rotation_y:angle});
const furniture=(id,bbox_px,model_3d={},kind='chair')=>({id,kind,bbox_px,model_3d,review_status:'confirmed'});
function fixture(){return {image:{width_px:500,height_px:400},scale_mm_per_px:10,walls:[],openings:[],furniture:[]};}
const pair=(result,a,b)=>result.pairs.some(p=>p.ids.includes(a)&&p.ids.includes(b));
function wallFixture(){return {...fixture(),walls:[{id:'W1',orientation:'horizontal',start_px:[0,100],end_px:[500,100],thickness_px:20}],
  openings:[{id:'D1',kind:'door',orientation:'horizontal',start_px:[50,100],end_px:[150,100],thickness_px:20},
    {id:'O1',kind:'window',orientation:'horizontal',start_px:[250,100],end_px:[400,100],thickness_px:20}]};}

test('touching, separated, and sub-mm contact are allowed; real penetration is detected',()=>{
  const a=box([0,.5,0]);
  assert.equal(boxesIntersect(a,box([1,.5,0])),false);
  assert.equal(boxesIntersect(a,box([.9995,.5,0])),false);
  assert.equal(boxesIntersect(a,box([.99,.5,0])),true);
  assert.equal(boxesIntersect(a,box([0,1.5,0])),false);
});
test('parallel rotated thin boxes with overlapping AABBs remain separated',()=>{
  const a=box([0,.5,0],[2,1,.1],Math.PI/4);
  const b=box([.15,.5,.15],[2,1,.1],Math.PI/4);
  assert.ok(a.min[0]<b.max[0]&&a.max[0]>b.min[0]);
  assert.equal(boxesIntersect(a,b),false);
  assert.equal(boxesIntersect(a,box([.02,.5,.02],[2,1,.1],Math.PI/4)),true);
});
test('arbitrary tilted opening boxes use quaternion axes, not just ground projection',()=>{
  const tilted=collisionBox({center:[0,1,0],size:[1,1,.04],quaternion:[Math.sin(Math.PI/8),0,0,Math.cos(Math.PI/8)]});
  assert.equal(boxesIntersect(tilted,box([0,1,.2],[.1,.1,.1])),false);
  assert.equal(boxesIntersect(tilted,box([0,1+.2/Math.SQRT2,.2/Math.SQRT2],[.1,.1,.1])),true);
});
test('furniture boxes preserve rotation, height and elevation; upper furniture does not hit lower furniture',()=>{
  const doc=fixture();doc.furniture=[furniture('F1',[30,30,100,100],{height_mm:500}),furniture('F2',[30,30,100,100],{height_mm:600,elevation_mm:500,rotation_deg:45})];
  assert.equal(checkCollisions(doc).pairs.length,0);
  assert.equal(checkCollisions({...doc,furniture:[doc.furniture[0],{...doc.furniture[1],model_3d:{height_mm:600,elevation_mm:400}}]}).pairs.length,1);
  assert.equal(furnitureCollisionBox(doc,doc.furniture[1]).size[1],.6);
});
test('rotated footprint matches free rotation; fit turns and detected facing do not rotate the source box again',()=>{
  const doc=fixture(),f=furniture('F1',[50,50,150,100],{rotation_deg:90,fit_rotation_deg:90});f.rotation_deg=90;
  const points=boxFootprint(doc,furnitureCollisionBox(doc,f));
  assert.ok(Math.abs(Math.min(...points.map(p=>p[0]))-75)<1e-8);
  assert.ok(Math.abs(Math.min(...points.map(p=>p[1]))-25)<1e-8);
});
test('door holes are empty below header; window sill and header remain physical walls',()=>{
  const doc=wallFixture();
  assert.equal(checkCollisions(doc).pairs.length,0,'fixed frames are not treated as moving sashes');
  for(const [bbox,height,elevation,expected] of [
    [[80,90,120,110],500,0,false],[[80,90,120,110],500,2200,true],
    [[290,90,310,110],500,0,true],[[290,90,310,110],500,1000,false],[[290,90,310,110],500,2500,true]]){
    const f=furniture('F1',bbox,{height_mm:height,elevation_mm:elevation});
    assert.equal(pair(checkCollisions(doc,{additional:f}),'F1','W1'),expected);
  }
});
test('unclassified gaps remain open; rejected furniture and unknown region categories have no boxes',()=>{
  const doc=wallFixture();doc.openings=[];doc.walls[0].opening_hints=[{start_px:[50,100],end_px:[150,100]}];
  doc.furniture=[furniture('F1',[80,90,120,110]),{...furniture('F2',[80,90,120,110]),review_status:'rejected'},furniture('R1',[0,0,50,50],{},'water_feature')];
  const result=checkCollisions(doc);assert.equal(result.pairs.length,0);
  assert.ok(result.boxes.every(b=>!['F2','R1'].includes(b.id)));
});
test('wall contacts use the trimmed 3D geometry and collision analysis respects wall heights',()=>{
  const doc=wallFixture();doc.model_settings={wall_height_mm:2800,show_furniture:false};
  const contact=furniture('F1',[180,110,220,150]);assert.equal(pair(checkCollisions(doc,{additional:contact}),'F1','W1'),false);
  const high=furniture('F1',[180,90,220,110],{elevation_mm:2800});assert.equal(pair(checkCollisions(doc,{additional:high}),'F1','W1'),false);
  assert.equal(pair(checkCollisions(doc,{additional:furniture('F1',[180,99,220,130])}),'F1','W1'),true);
});
test('open door position detects furniture contact; closing removes it and scene geometry is unchanged',()=>{
  const doc=wallFixture();doc.openings=doc.openings.slice(0,1);
  doc.openings[0].operation={type:'hinged',hinge:'start',side:'positive',angle_deg:90,pivot_axis:'vertical',pivot_ratio:0,direction_mode:'manual'};
  const door=buildCollisionBoxes(doc).find(b=>b.kind==='door');
  const p=boxFootprint(doc,door),x=p.reduce((s,v)=>s+v[0],0)/p.length,z=p.reduce((s,v)=>s+v[1],0)/p.length;
  doc.furniture=[furniture('F1',[x-8,z-8,x+8,z+8])];const before=structuredClone(doc);
  assert.equal(pair(checkCollisions(doc),'D1','F1'),true);assert.deepEqual(doc,before);
  const closed={...doc,openings:doc.openings.map(o=>({...o,operation:{...o.operation,angle_deg:0}}))};
  assert.equal(pair(checkCollisions(closed),'D1','F1'),false);
});
test('moving window sashes participate independently of fixed frames',()=>{
  const doc=wallFixture();doc.openings=doc.openings.slice(1);doc.openings[0].operation={type:'hinged',hinge:'top',side:'positive',angle_deg:45,pivot_axis:'horizontal',pivot_ratio:0,direction_mode:'manual',axis_mode:'manual'};
  const glass=buildCollisionBoxes(doc).find(b=>b.kind==='window'&&b.size[1]>.5);
  const p=boxFootprint(doc,glass),x=p.reduce((s,v)=>s+v[0],0)/p.length,z=p.reduce((s,v)=>s+v[1],0)/p.length;
  assert.equal(pair(checkCollisions(doc,{additional:furniture('F1',[x-5,z-5,x+5,z+5],{height_mm:glass.center[1]*1000+300})}),'F1','O1'),true);
});
test('contained sink and hob overlap with kitchen counter is intentional; partial crossing still warns',()=>{
  const doc=fixture();doc.furniture=[furniture('C1',[30,30,150,120],{},'kitchen_cabinet'),furniture('S1',[50,50,100,90],{},'kitchen_sink')];
  assert.equal(checkCollisions(doc).pairs.length,0);
  assert.equal(checkCollisions(doc,{replacement:furniture('S1',[140,50,190,90],{},'kitchen_sink')}).pairs.length,1);
});
test('replacement previews exclude original; copies are independent; cancel returns baseline without mutation',()=>{
  const doc=fixture();doc.furniture=[furniture('F1',[20,20,60,60]),furniture('F2',[100,100,140,140])];const original=structuredClone(doc);
  const draft=furniture('F1',[100,100,140,140]);assert.equal(checkCollisions(doc,{replacement:draft}).pairs.length,1);
  assert.equal(checkCollisions(doc,{additional:{...draft,id:'待复制'}}).pairs.length,1);
  assert.equal(checkCollisions(doc).pairs.length,0);assert.deepEqual(doc,original);
});
test('pairs are deduplicated across door components; unscaled scenes do not invent physical dimensions',()=>{
  const doc=wallFixture();doc.openings[0].door_model='entry';
  const result=checkCollisions(doc,{additional:furniture('F1',[60,95,140,105],{height_mm:2000})});
  assert.equal(result.pairs.filter(p=>p.ids.includes('D1')&&p.ids.includes('F1')).length,1);
  assert.match(collisionMessage(result,'F1'),/D1/);
  assert.deepEqual(buildCollisionBoxes({...doc,scale_mm_per_px:null}),[]);
});
