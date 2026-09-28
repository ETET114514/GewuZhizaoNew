import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildFloors,floorGeometry} from './web/floor-geometry.mjs';

function fixture(){return {image:{width_px:400,height_px:300},scale_mm_per_px:20,room_partition:{regions:[{
  id:'R001',rings_px:[[[20,20],[200,20],[200,200],[20,200]],[[60,60],[60,100],[100,100],[100,60]]],
  floor:{material:'tile',color:'#dddddd',width_mm:600,length_mm:1200,angle_deg:0}}]}};}

test('floor mesh respects holes and real-world scale',()=>{
  const doc=fixture(),before=JSON.stringify(doc),floor=buildFloors(doc)[0];
  const mesh=floorGeometry(floor.polygons,floor.settings),pos=mesh.attributes.position,index=mesh.index;
  let area=0;
  for(let i=0;i<index.count;i+=3){const [a,b,c]=[0,1,2].map(k=>index.getX(i+k));
    area+=Math.abs((pos.getX(b)-pos.getX(a))*(pos.getZ(c)-pos.getZ(a))-(pos.getZ(b)-pos.getZ(a))*(pos.getX(c)-pos.getX(a)))/2;
  }
  assert(Math.abs(area-(180*180-40*40)*.02*.02)<1e-5);
  assert.equal(JSON.stringify(doc),before);mesh.dispose();
});
test('UVs encode tile size and rotation, recalibration scales the footprint',()=>{
  const doc=fixture(),floor=buildFloors(doc)[0];
  const a=floorGeometry(floor.polygons,floor.settings),b=floorGeometry(floor.polygons,{...floor.settings,angle_deg:90});
  assert.notDeepEqual([...a.attributes.uv.array],[...b.attributes.uv.array]);
  const x=a.attributes.position.getX(0),z=a.attributes.position.getZ(0);
  assert(Math.abs(a.attributes.uv.getX(0)-x/.6)<1e-5);assert(Math.abs(a.attributes.uv.getY(0)-z/1.2)<1e-5);
  doc.scale_mm_per_px=40;assert.equal(buildFloors(doc)[0].polygons[0][0][0][0],floor.polygons[0][0][0][0]*2);
  a.dispose();b.dispose();
});
test('unscaled or unpartitioned plans do not fabricate room floors',()=>{
  const doc=fixture();delete doc.room_partition;assert.deepEqual(buildFloors(doc),[]);
  const unscaled=fixture();unscaled.scale_mm_per_px=null;assert.deepEqual(buildFloors(unscaled),[]);
});
