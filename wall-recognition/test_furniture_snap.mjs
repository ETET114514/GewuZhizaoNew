import {test} from 'node:test';
import assert from 'node:assert/strict';
import {snapFurniture,footprint} from './web/furniture-snap.mjs';
const furniture=(id,box,angle=0)=>({id,kind:'chair',bbox_px:box,model_3d:{rotation_deg:angle}});
const base={image:{width_px:500,height_px:400},walls:[],furniture:[]};
test('snaps to wall face and preserves dimensions without changing document',()=>{
  const doc={...base,solid_wall_segments:[{id:'W1',bbox_px:[10,10,20,390]}]},item=furniture('F1',[24,60,64,100]);
  const before=structuredClone(doc),result=snapFurniture(doc,item);
  assert.deepEqual(result.item.bbox_px,[20,60,60,100]);assert.equal(result.guides[0].target,'W1');
  assert.deepEqual(doc,before);assert.deepEqual(item.bbox_px,[24,60,64,100]);
  assert.deepEqual(snapFurniture(doc,item,{enabled:false}).item,item);
});
test('snaps centers and edges to furniture, excludes moving source and rejected objects',()=>{
  const doc={...base,furniture:[furniture('F1',[10,60,50,100]),furniture('F2',[100,200,160,240]),{...furniture('F3',[40,20,80,60]),review_status:'rejected'}]};
  const result=snapFurniture(doc,furniture('F1',[106,60,146,100]));
  assert.deepEqual(result.item.bbox_px,[110,60,150,100]);
  assert.equal(result.guides[0].value,130);
});
test('rotated footprint touches wall without penetrating it and boundary snap is rejected',()=>{
  const doc={...base,solid_wall_segments:[{id:'W1',bbox_px:[10,0,20,400]}]};
  const item=furniture('F1',[25,80,105,120],90),r=snapFurniture(doc,item,{threshold:26});
  assert.ok(Math.abs(footprint(r.item)[0]-20)<1e-7);
  const edge={...base,furniture:[furniture('F2',[-10,100,0,140])]};
  assert.deepEqual(snapFurniture(edge,furniture('F1',[2,70,42,110])).item.bbox_px,[0,70,40,110]);
  const beyond={...base,furniture:[furniture('F2',[-12,100,-2,140])]};
  assert.equal(snapFurniture(beyond,furniture('F1',[2,70,42,110])).item.bbox_px[0],2);
});
test('distance labels use nearest objects with an overlapping projection and apertures have no solid face',()=>{
  const doc={...base,solid_wall_segments:[{id:'W1',bbox_px:[10,0,20,50]},{id:'W2',bbox_px:[10,160,20,400]}],furniture:[furniture('F2',[120,80,160,120])]};
  const result=snapFurniture(doc,furniture('F1',[24,80,64,120]));
  assert.ok(result.guides.every(g=>g.target==='F2'));
  const gap=result.gaps.find(g=>g.target==='F2');assert.equal(gap.distance,56);
});
