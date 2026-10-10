import {test} from 'node:test';
import assert from 'node:assert/strict';
import {movePlacement,presetPlacement,placementOf,placementBox,placementFromCm,turnFurniture,fitTurnFurniture,validateFurnitureRotation} from './web/furniture-move.mjs';
const doc={scale_mm_per_px:10,image:{width_px:1000,height_px:800}};
const item={bbox_px:[100,100,300,200],rotation_deg:90};
test('movement clamps both axes and preserves the footprint and source orientation',()=>{
  assert.deepEqual(movePlacement(doc,item,-500,9000),{center_x_mm:1000,center_y_mm:7500,width_mm:2000,depth_mm:1000});
  assert.deepEqual(item,{bbox_px:[100,100,300,200],rotation_deg:90});
});
test('arbitrary extra rotation keeps the entire footprint inside the image',()=>{
  const rotated={...item,model_3d:{rotation_deg:45}},half=1500/Math.sqrt(2);
  const result=movePlacement(doc,rotated,100000,-100000);
  assert(Math.abs(result.center_x_mm-(10000-half))<1e-8);
  assert(Math.abs(result.center_y_mm-half)<1e-8);
});
test('rounding at the boundary does not push a rotated item outside',()=>{
  const rotated={...item,model_3d:{rotation_deg:37}},p=movePlacement(doc,rotated,0,0);
  const theta=37*Math.PI/180;
  assert(p.center_x_mm>=Math.cos(theta)*1000+Math.sin(theta)*500-1e-8);
  assert(p.center_y_mm>=Math.sin(theta)*1000+Math.cos(theta)*500-1e-8);
});
test('unscaled, nonfinite and oversized placements cannot start a move',()=>{
  assert.equal(movePlacement({...doc,scale_mm_per_px:null},item,1000,1000),null);
  assert.equal(movePlacement(doc,item,NaN,1000),null);
  assert.equal(movePlacement(doc,{bbox_px:[0,0,1200,900]},1000,1000),null);
});
test('extra quarter turn keeps both the raw box and rotated footprint inside',()=>{
  const p=movePlacement(doc,{...item,model_3d:{rotation_deg:90}},-100,-100);
  assert.equal(p.center_x_mm,1000);assert.equal(p.center_y_mm,1000);
  assert.deepEqual(placementBox(doc,p,90),[0,50,200,150]);
});
test('preset placement uses real dimensions and requires calibrated space',()=>{
  const p=presetPlacement(doc,'bed',500,400);
  assert.deepEqual(p,{center_x_mm:5000,center_y_mm:4000,width_mm:1800,depth_mm:2000});
  assert.deepEqual(placementBox(doc,p),[410,300,590,500]);
  assert.equal(presetPlacement({...doc,scale_mm_per_px:null},'bed',500,400),null);
  assert.equal(presetPlacement({...doc,scale_mm_per_px:1},'bed',500,400),null);
  assert.equal(presetPlacement(doc,'unknown',500,400),null);
});
test('cm editing preserves untouched precision and rejects empty or out of bounds fields',()=>{
  const original=placementOf(doc,{bbox_px:[100.123456,200,300.234567,400]});
  const cm=Object.fromEntries(Object.entries(original).map(([k,v])=>[k,String(Number((v/10).toFixed(3)))]));
  assert.deepEqual(placementFromCm(cm,original),original);
  cm.width_mm='180.5';assert.equal(placementFromCm(cm,original).width_mm,1805);
  assert.throws(()=>placementFromCm({...cm,depth_mm:''},original),/完整填写/);
  assert.throws(()=>placementBox(doc,{...original,center_x_mm:0}),/超出底图/);
  assert.throws(()=>placementBox(doc,{...original,width_mm:10}),/2～5000/);
});
test('quarter turns wrap angles while preserving placement, source heading and appearance',()=>{
  const original={...item,model_3d:{rotation_deg:0,height_mm:730,elevation_mm:150,color:'#123456'}};
  const left=turnFurniture(doc,original,-90);
  assert.equal(left.model_3d.rotation_deg,270);
  assert.equal(turnFurniture(doc,left,90).model_3d.rotation_deg,0);
  assert.deepEqual(left.bbox_px,original.bbox_px);assert.equal(left.rotation_deg,90);
  assert.equal(left.model_3d.height_mm,730);assert.equal(left.model_3d.color,'#123456');
  assert.equal(original.model_3d.rotation_deg,0);
});
test('rotation also works without scale, rejects edge overflow without relocating and validates angles',()=>{
  const unscaled={...doc,scale_mm_per_px:null};
  assert.equal(turnFurniture(unscaled,item,90).model_3d.rotation_deg,90);
  const nearEdge={bbox_px:[100,0,300,100]};
  assert.throws(()=>turnFurniture(doc,nearEdge,90),/超出底图/);
  assert.deepEqual(nearEdge.bbox_px,[100,0,300,100]);
  for(const angle of [-1,361,NaN])assert.throws(()=>validateFurnitureRotation(doc,item.bbox_px,angle),/角度/);
});
test('fit turns retain the edge-aligned box, absorb quarter free turns and do not accumulate dimensions',()=>{
  const original={bbox_px:[100,0,300,100],rotation_deg:90,model_3d:{height_mm:700,color:'#123456'}},before=JSON.stringify(original);
  assert.throws(()=>turnFurniture(doc,original,90),/超出底图/);
  let fitted=fitTurnFurniture({...doc,scale_mm_per_px:null},original,90);
  assert.equal(fitted.model_3d.fit_rotation_deg,90);assert.equal(fitted.model_3d.rotation_deg,0);
  assert.deepEqual(fitted.bbox_px,original.bbox_px);assert.equal(fitted.rotation_deg,90);
  for(let i=0;i<3;i++)fitted=fitTurnFurniture(doc,fitted,90);
  assert.equal(fitted.model_3d.fit_rotation_deg,0);assert.deepEqual(fitted.bbox_px,original.bbox_px);
  const mixed=fitTurnFurniture(doc,{...original,model_3d:{...original.model_3d,fit_rotation_deg:90,rotation_deg:270}},-90);
  assert.equal(mixed.model_3d.fit_rotation_deg,270);assert.equal(mixed.model_3d.rotation_deg,0);
  assert.equal(mixed.model_3d.height_mm,700);assert.equal(mixed.model_3d.color,'#123456');
  assert.equal(JSON.stringify(original),before);
  assert.throws(()=>fitTurnFurniture(doc,{...original,model_3d:{rotation_deg:35}},90),/整数倍/);
});
