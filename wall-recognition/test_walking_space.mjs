import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Vector3} from './web/vendor/three.module.min.js';
import {collisionBox} from './web/collision-boxes.mjs';
import {createWalkingSpace,EYE_HEIGHT} from './web/walking-space.mjs';
const doc={image:{width_px:1200,height_px:1000},scale_mm_per_px:10};
const eye=(x,z)=>new Vector3(x,EYE_HEIGHT,z);
const wall=(x,z,width,depth)=>collisionBox({id:'wall',kind:'wall',center:[x,1.4,z],size:[width,2.8,depth]});

test('standing stays 170 cm above the floor and inside the actual base floor',()=>{
  const space=createWalkingSpace(doc,[]);assert(space.valid(eye(0,0)));assert(!space.valid(new Vector3(0,-1,0)));
  assert(!space.valid(eye(6,0)));assert(!space.valid(eye(0,5)));
  const moved=space.move(eye(0,0),new Vector3(0,-100,2));assert.equal(moved.y,1.7);assert(Math.abs(moved.z-2)<1e-8);
});
test('swept movement cannot jump through a thin wall and slides along it',()=>{
  const space=createWalkingSpace(doc,[wall(0,0,.1,8)]);
  const blocked=space.move(eye(-1,0),new Vector3(10,0,0));assert(blocked.x<=-.23+.001);assert.equal(blocked.z,0);
  const slid=space.move(eye(-1,0),new Vector3(2,0,1));assert(slid.x<=-.23+.001);assert(Math.abs(slid.z-1)<1e-8);assert(space.valid(slid));
});
test('door aperture permits passage but a closed leaf or sill blocks it',()=>{
  const jambs=[wall(0,-2,.1,3),wall(0,2,.1,3)],space=createWalkingSpace(doc,jambs);
  assert(space.move(eye(-1,0),new Vector3(2,0,0)).x>.9);
  const closed=createWalkingSpace(doc,[...jambs,wall(0,0,.035,1)]);assert(closed.move(eye(-1,0),new Vector3(2,0,0)).x<0);
  const sill=collisionBox({id:'sill',kind:'wall',center:[0,.45,0],size:[.2,.9,1]});
  assert(createWalkingSpace(doc,[...jambs,sill]).move(eye(-1,0),new Vector3(2,0,0)).x<0);
});
test('low ceilings block standing while ceiling holes and overhead objects remain clear',()=>{
  const top=(bottom,polygon)=>collisionBox({id:'top',kind:'ceiling',center:[0,bottom+.05,0],size:[4,.1,4],polygon});
  assert(createWalkingSpace(doc,[top(2.6)]).valid(eye(0,0)));
  assert(!createWalkingSpace(doc,[top(1.8)]).valid(eye(0,0)));
  const triangle=top(1.8,[[-2,-2],[2,-2],[-2,2]]),space=createWalkingSpace(doc,[triangle]);
  assert(!space.valid(eye(-1,-1)));assert(space.valid(eye(1,1)));
});
test('spawn finds nearby clear standing space without putting the eye in furniture or a low room',()=>{
  const table=collisionBox({id:'table',kind:'furniture',center:[0,.4,0],size:[1,.8,1]}),space=createWalkingSpace(doc,[table]);
  const spawn=space.find(eye(0,0),p=>p.x<=0);assert(spawn&&space.valid(spawn));assert(spawn.x<=0);
  const roof=collisionBox({id:'low',kind:'ceiling',center:[0,1.55,0],size:[12,.1,10]});assert.equal(createWalkingSpace(doc,[roof]).find(eye(0,0)),null);
});
