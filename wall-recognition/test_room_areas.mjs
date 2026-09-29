import {test} from 'node:test';
import assert from 'node:assert/strict';
import {roomAreaM2, formatRoomArea} from './web/room-areas.mjs';
import {floorGeometry} from './web/floor-geometry.mjs';
const rectangle = (x, y, w, h) => [[x,y],[x+w,y],[x+w,y+h],[x,y+h]];

test('rectangle uses squared scale, changes immediately after recalibration', () => {
  const room = {rings_px:[rectangle(20,30,300,200)]};
  assert.equal(roomAreaM2(room,10),6);
  assert.equal(roomAreaM2(room,20),24);
  assert.equal(roomAreaM2(room,10),6);
});
test('concave room subtracts holes regardless of winding and includes disjoint parts once', () => {
  const room = {polygons_px:[
    [[[0,0],[100,0],[100,40],[40,40],[40,100],[0,100]], rectangle(10,10,20,20).reverse()],
    [rectangle(200,0,50,80)]
  ], rings_px:[rectangle(0,0,999,999)]};
  const before = JSON.stringify(room);
  assert.equal(roomAreaM2(room,10),1);
  assert.equal(JSON.stringify(room),before);
});
test('missing scale or geometry never fabricates a real-world area', () => {
  const room = {rings_px:[rectangle(0,0,100,100)]};
  for (const scale of [null,undefined,NaN,Infinity,0,-2,'10']) assert.equal(roomAreaM2(room,scale),null);
  for (const region of [{},{polygons_px:[]},{rings_px:[]},{rings_px:[[[0,0],[1,0]]]},{rings_px:[rectangle(0,0,10,10),rectangle(0,0,20,20)]},{rings_px:[[[0,0],[Infinity,0],[0,2]]]}]) assert.equal(roomAreaM2(region,10),null);
});
test('closed rings and coordinate translation preserve area', () => {
  const ring = rectangle(1e9,1e9,100,200); ring.push(ring[0]);
  assert.equal(roomAreaM2({rings_px:[ring]},10),2);
});
test('room area agrees with triangulated floor surface including holes', () => {
  const polygon = [rectangle(0,0,10,12),rectangle(2,3,4,5)];
  const mesh = floorGeometry([polygon],{material:'solid',width_mm:600,length_mm:600,angle_deg:0});
  const pos = mesh.attributes.position, indices = mesh.index;
  let surface = 0;
  for (let i=0; i<indices.count; i+=3) {
    const [a,b,c] = [0,1,2].map(k=>indices.getX(i+k));
    surface += Math.abs((pos.getX(b)-pos.getX(a))*(pos.getZ(c)-pos.getZ(a))-(pos.getZ(b)-pos.getZ(a))*(pos.getX(c)-pos.getX(a)))/2;
  }
  assert.equal(roomAreaM2({polygons_px:[polygon]},1000),surface); mesh.dispose();
});
test('display retains useful precision without rounding tiny rooms to zero', () => {
  assert.equal(formatRoomArea(12.3456),'12.35 m²');
  assert.equal(formatRoomArea(0.003),'<0.01 m²');
  assert.equal(formatRoomArea(null),'—');
});
