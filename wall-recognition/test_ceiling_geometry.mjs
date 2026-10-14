import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ceilingLayout,structuralCeilings,ceilingMeshGeometry,ceilingCollisionParts,fixtureParts,temperatureColor,mountingSurfaces,lightObstruction,ceilingViewTarget} from './web/ceiling-geometry.mjs';
import {checkCollisions} from './web/collision-boxes.mjs';

function fixture(){return {image:{width_px:400,height_px:300},scale_mm_per_px:20,walls:[],openings:[],furniture:[],
  ceiling_layout:{surfaces:[{id:'C001',role:'ceiling',color:'#ffffff',bottom_mm:2500,thickness_mm:80,
    polygons_mm:[[[[400,400],[7600,400],[7600,5600],[400,5600]],[[3000,2000],[4000,2000],[4000,3000],[3000,3000]]]]}],lights:[]}};}
test('extruded ceiling thickness, scene coordinates and holes',()=>{
  const d=fixture(),g=ceilingMeshGeometry(d,d.ceiling_layout.surfaces[0]);g.computeBoundingBox();
  assert(Math.abs(g.boundingBox.min.y-2.5)<1e-6);assert(Math.abs(g.boundingBox.max.y-2.58)<1e-6);
  assert(Math.abs(g.boundingBox.min.x+3.6)<1e-6);assert(g.attributes.normal.count>0);g.dispose();
});
test('ceiling collision triangles preserve holes and height separation',()=>{
  const d=fixture();d.furniture=[{id:'F001',kind:'chair',review_status:'confirmed',bbox_px:[160,110,190,140],model_3d:{height_mm:2700}}];
  assert.equal(checkCollisions(d).pairs.length,0);
  const outside={...d,furniture:[{...d.furniture[0],bbox_px:[50,50,90,90]}]};
  assert(checkCollisions(outside).pairs.some(p=>p.ids.includes('C001')));
  const low={...outside,furniture:[{...outside.furniture[0],model_3d:{height_mm:2400}}]};assert.equal(checkCollisions(low).pairs.length,0);
});
test('light bodies, suspension and warm/cool emissive colors',()=>{
  const d=fixture(),l={id:'C002',host_id:'C001',center_mm:[2000,1200],mount_mm:2500,bottom_mm:1800,settings:{size_mm:300,depth_mm:100,hanging_mm:600,rotation_deg:90,light_type:'pendant',color:'#ddddee',on:true,intensity:2,temperature_k:3000}};
  const p=fixtureParts(d,l);assert.equal(p[0].size[1],.6);assert.equal(p[1].center[1],1.85);assert(p[2].emissive);
  assert(temperatureColor(3000).b<temperatureColor(6500).b);
});
test('old scenes introduce no ceiling or light collisions',()=>{assert.deepEqual(ceilingCollisionParts({image:{},scale_mm_per_px:20}),[]);});
test('every valid room gets a default top without changing saved authorship',()=>{
  const room=(id,x)=>({id,style_key:id,polygons_px:[[[[x,20],[x+50,20],[x+50,80],[x,80]]]]});
  const d={image:{width_px:400,height_px:300},scale_mm_per_px:20,model_settings:{wall_height_mm:3000},room_partition:{regions:[room('R1',20),room('R2',100),{...room('R3',200),review_status:'rejected'}]}};
  const before=JSON.stringify(d),tops=ceilingLayout(d).surfaces;
  assert.equal(tops.length,2);assert(tops.every(s=>s.bottom_mm===3000));assert.equal(JSON.stringify(d),before);
  d.ceiling_design={rooms:{R1:{height_mm:2500,color:'#123456',visible:false}}};
  const customized=ceilingLayout(d).surfaces;assert.equal(customized[0].bottom_mm,2500);assert.equal(customized[0].visible,false);assert.equal(customized[1].bottom_mm,3000);
  d.ceiling_layout={surfaces:[customized[0]],lights:[]};assert.equal(ceilingLayout(d).surfaces.length,2);assert.equal(ceilingLayout(d).surfaces[0],customized[0]);
  d.scale_mm_per_px=null;assert.equal(ceilingLayout(d).surfaces.length,0);
});
test('closed displayed wall tops cover unpartitioned rooms while real gaps stay open',()=>{
  const d={image:{width_px:500,height_px:500},scale_mm_per_px:10,walls:[{}]};
  const wall=(x,z,w,h)=>({kind:'wall',center:[x,1.4,z],size:[w,2.8,h]});
  const model={height:2.8,boxes:[wall(0,-2,4,.2),wall(0,2,4,.2),wall(-2,0,.2,4),wall(2,0,.2,4)]};
  const tops=structuralCeilings(d,[],model);assert.equal(tops.length,1);assert(tops[0].structural);
  const occupied={id:'room:R001',polygons_mm:tops[0].polygons_mm};assert.equal(structuralCeilings(d,[occupied],model).length,0);
  const open={...model,boxes:model.boxes.slice(0,3)};assert.equal(structuralCeilings(d,[],open).length,0);
  const partial={...model,boxes:[...model.boxes.slice(0,3),wall(2,-1.2,.2,1.6),wall(2,1.2,.2,1.6)]};assert.equal(structuralCeilings(d,[],partial).length,0);
});
test('partitioned scenes never add uneditable tops, including excluded spaces',()=>{
  const wall=(x,z,w,h)=>({kind:'wall',center:[x,1.4,z],size:[w,2.8,h]});
  const model={height:2.8,boxes:[wall(0,-2,4,.2),wall(0,2,4,.2),wall(-2,0,.2,4),wall(2,0,.2,4)]};
  const doc={image:{width_px:500,height_px:500},scale_mm_per_px:10,walls:[{}],room_partition:{regions:[]}};
  assert.deepEqual(structuralCeilings(doc,[],model),[]);
  assert.equal(ceilingLayout(doc,model).supplementalCount,0);
  assert.equal(ceilingLayout(doc,model).surfaces.length,0);
  delete doc.room_partition;assert.equal(structuralCeilings(doc,[],model).length,1);
});
test('independent slabs warn on penetration while their own tier risers do not',()=>{
  const d=fixture(),s=d.ceiling_layout.surfaces[0];d.ceiling_layout.surfaces.push({...s,id:'C002',bottom_mm:2540});
  assert(checkCollisions(d).pairs.some(p=>p.ids.includes('C001')&&p.ids.includes('C002')));
  const own=fixture();own.ceiling_layout.surfaces.push({...s,id:'C001:2',bottom_mm:2540});assert.equal(checkCollisions(own).pairs.length,0);
});


test('lamp mounting suggestions use room, holes and the lowest covering surface',()=>{
  const d=fixture(),s=d.ceiling_layout.surfaces[0];s.room_key='r1';
  d.ceiling_layout.surfaces.push({...s,id:'room:r1',bottom_mm:2800},{...s,id:'other',room_key:'r2',bottom_mm:2000});
  assert.deepEqual(mountingSurfaces(d,'r1',[2000,1200]).map(s=>s.id),['C001','room:r1']);
  assert.deepEqual(mountingSurfaces(d,'r1',[3500,2500]),[]); // hole
  assert.deepEqual(mountingSurfaces(d,'r1',[100,100]),[]); // outside
  const light={id:'L1',room_key:'r1',host_id:'room:r1',center_mm:[2000,1200],bottom_mm:2720};
  assert.equal(lightObstruction(d,light).id,'C001');
  assert.equal(lightObstruction(d,{...light,host_id:'C001',bottom_mm:2420}),null);
  assert.equal(lightObstruction(d,{...light,center_mm:[3500,2500]}),null);
});
test('ceiling camera targets the chosen room and lamp, below any covering slab',()=>{
  const d=fixture(),s=d.ceiling_layout.surfaces[0];s.room_key='r1';
  d.room_partition={regions:[{id:'R1',style_key:'r1',label_px:[100,60]},{id:'R2',label_px:[250,100]}]};
  d.ceiling_layout.lights=[{id:'L1',room_key:'r1',host_id:'room:r1',center_mm:[2200,1400],bottom_mm:2720}];
  const before=JSON.stringify(d),room=ceilingViewTarget(d,'R1'),lamp=ceilingViewTarget(d,'R1','L1');
  assert.equal(room.x,-2);assert.equal(room.z,-1.8);assert.equal(room.height,2.5);
  assert.equal(lamp.x,-1.8);assert.equal(lamp.z,-1.6);assert(lamp.light);assert(lamp.eye<lamp.height);
  assert.equal(ceilingViewTarget(d,'R2','L1').light,false); // never jump to another room's lamp
  assert.equal(ceilingViewTarget(d,'missing'),null);assert.equal(JSON.stringify(d),before);
});
