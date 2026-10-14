import {test} from 'node:test';
import assert from 'node:assert/strict';
import {unionWallBoxes} from './web/wall-joints.mjs';
import {buildModel} from './web/model-geometry.mjs';
import * as THREE from './web/vendor/three.module.min.js';

const box=(id,lo,hi)=>({id,kind:'wall',center:lo.map((v,i)=>(v+hi[i])/2),size:lo.map((v,i)=>hi[i]-v)});
const inside=(boxes,p)=>boxes.some(b=>p.every((v,i)=>v>b.center[i]-b.size[i]/2&&v<b.center[i]+b.size[i]/2));
const points=m=>m.indices.map(i=>m.positions.slice(i*3,i*3+3));
function verify(m,boxes,volume){
  const p=points(m),edges=new Map();let actual=0;
  for(let i=0;i<p.length;i+=3){
    const [a,b,c]=p.slice(i,i+3),u=b.map((v,j)=>v-a[j]),v=c.map((v,j)=>v-a[j]);
    const n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],length=Math.hypot(...n);
    assert(length>0);const center=a.map((v,j)=>(v+b[j]+c[j])/3),delta=n.map(v=>v/length*1e-7);
    assert(inside(boxes,center.map((v,j)=>v-delta[j])),'triangle must border masonry on inside');
    assert(!inside(boxes,center.map((v,j)=>v+delta[j])),'no triangle inside overlapping masonry');
    actual+=(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;
    for(const [s,t] of [[a,b],[b,c],[c,a]]){const key=[s.join(','),t.join(',')].sort().join('|');edges.set(key,(edges.get(key)||0)+1);}
  }
  for(const count of edges.values())assert.equal(count,2,'closed union has two triangles per geometric edge');
  assert(Math.abs(actual-volume)<1e-8,`union volume ${actual} != ${volume}`);
}

test('touching and overlapping boxes produce a closed exterior union without internal faces',()=>{
  for(const boxes of [
    [box('A',[0,0,0],[2,2,1]),box('B',[2,0,0],[3,2,1])],
    [box('A',[0,0,0],[2,2,1]),box('B',[1,0,0],[3,2,1])],
    [box('A',[0,0,0],[3,2,1]),box('B',[1,.5,.2],[2,1.5,.8])]
  ]){const before=JSON.stringify(boxes),mesh=unionWallBoxes(boxes);verify(mesh,boxes,6);assert.equal(JSON.stringify(boxes),before);}
});

test('unequal L/T/cross walls and corner patches share a watertight boundary',()=>{
  const boxes=[box('H',[0,0,0],[3,2,1]),box('V',[2,0,.5],[2.5,2,3]),box('corner',[2.5,0,1],[3,2,1.5])];
  verify(unionWallBoxes(boxes),boxes,8.5);
});

test('door/window apertures remain open with their sill, header and reveals',()=>{
  const boxes=[box('left',[0,0,0],[1,3,.2]),box('right',[2,0,0],[3,3,.2]),box('header',[1,2,0],[2,3,.2])];
  verify(unionWallBoxes(boxes),boxes,1.4);
  boxes.push(box('sill',[1,0,0],[2,.5,.2]));verify(unionWallBoxes(boxes),boxes,1.5);
});

test('disconnected solids and narrow real gaps stay disconnected; only masonry is merged',()=>{
  const boxes=[box('A',[0,0,0],[1,1,1]),box('B',[1.000001,0,0],[2.000001,1,1])];
  const mesh=unionWallBoxes([...boxes,{...boxes[0],id:'glass',kind:'glass'}]);verify(mesh,boxes,2);
  assert.equal(mesh.boxCount,2);assert.deepEqual(mesh.sourceIds,['A','B']);
  assert.deepEqual(unionWallBoxes([]).indices,[]);
});

test('buildModel exposes a merged mesh while retaining immutable wall and opening records',()=>{
  const doc={image:{width_px:200,height_px:200},scale_mm_per_px:10,walls:[
    {id:'H',orientation:'horizontal',start_px:[20,100],end_px:[100,100],thickness_px:20},
    {id:'V',orientation:'vertical',start_px:[100,100],end_px:[100,180],thickness_px:10}],openings:[],furniture:[]};
  const original=JSON.stringify(doc),model=buildModel(doc);assert(model.wallMesh.indices.length>0);
  assert.equal(model.wallMesh.boxCount,model.boxes.filter(b=>b.kind==='wall').length);
  assert.equal(JSON.stringify(doc),original);
  doc.model_settings={flush_wall_joints:false};assert(buildModel(doc).wallMesh.indices.length>0);
});

test('merged geometry raycasts through a door/window aperture and hits the retained header/sill',()=>{
  const boxes=[box('left',[0,0,0],[1,3,.2]),box('right',[2,0,0],[3,3,.2]),box('header',[1,2,0],[2,3,.2])];
  function hits(y){
    const data=unionWallBoxes(boxes),geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(data.positions,3));geometry.setIndex(data.indices);
    const material=new THREE.MeshBasicMaterial(),mesh=new THREE.Mesh(geometry,material);
    const ray=new THREE.Raycaster(new THREE.Vector3(1.5,y,1),new THREE.Vector3(0,0,-1));
    const result=ray.intersectObject(mesh);geometry.dispose();material.dispose();return result;
  }
  assert.equal(hits(1).length,0);assert(hits(2.5).length>0);
  boxes.push(box('sill',[1,0,0],[2,.5,.2]));assert.equal(hits(1).length,0);assert(hits(.25).length>0);
});
