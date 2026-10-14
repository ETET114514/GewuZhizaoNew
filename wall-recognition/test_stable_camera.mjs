import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PerspectiveCamera,Vector3} from './web/vendor/three.module.min.js';
import {createStableControls,lookDirection,walkDelta} from './web/stable-camera.mjs';

class Surface {
  events=new Map();
  addEventListener(name,fn){if(!this.events.has(name))this.events.set(name,new Set());this.events.get(name).add(fn);}
  removeEventListener(name,fn){this.events.get(name)?.delete(fn);}
  emit(name,data={}){const event={preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;},...data};for(const fn of this.events.get(name)||[])fn(event);return event;}
}
function fixture(){
  const env=new Surface(),page=new Surface(),canvas=new Surface(),frames=new Map();let serial=0;
  env.requestAnimationFrame=fn=>{frames.set(++serial,fn);return serial;};env.cancelAnimationFrame=id=>frames.delete(id);
  env.step=time=>{const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn(time));};
  canvas.ownerDocument=page;canvas.focus=()=>page.activeElement=canvas;canvas.capture=new Set();
  canvas.setPointerCapture=id=>canvas.capture.add(id);canvas.hasPointerCapture=id=>canvas.capture.has(id);canvas.releasePointerCapture=id=>canvas.capture.delete(id);
  const camera=new PerspectiveCamera(55,1,.01,1000);camera.position.set(2,1.1,3);
  const controls=createStableControls(camera,canvas,()=>{},env);controls.target.set(2,2.6,2.8);controls.update();controls.setActive(true);canvas.focus();
  return {env,page,canvas,camera,controls,frames};
}
test('extreme mouse drags clamp pitch and retain a horizontal camera right axis without moving the eye',()=>{
  const {canvas,camera,controls}=fixture(),eye=camera.position.clone();
  canvas.emit('pointerdown',{button:0,pointerId:1,clientX:0,clientY:0});
  for(const [x,y] of [[1e6,-1e6],[-1e6,1e6],[0,-1e6],[0,1e6]]){
    canvas.emit('pointermove',{pointerId:1,clientX:x,clientY:y});
    const forward=camera.getWorldDirection(new Vector3());assert(Math.abs(forward.y)<=Math.sin(85*Math.PI/180)+1e-9);
    camera.updateMatrixWorld();assert(Math.abs(camera.matrixWorld.elements[1])<1e-9);assert.deepEqual(camera.up.toArray(),[0,1,0]);assert(camera.position.equals(eye));
  }
  canvas.emit('pointerup',{pointerId:1});assert.equal(canvas.capture.size,0);controls.dispose();
});
test('WASD follows heading on the horizontal plane and normalizes diagonals',()=>{
  assert.deepEqual(walkDelta(new Set(['w']),0,.05).toArray(),[0,0,-.1]);
  assert(Math.abs(walkDelta(new Set(['w']),Math.PI/2,.05).x-.1)<1e-9);
  assert(Math.abs(walkDelta(new Set(['d']),Math.PI/2,.05).z-.1)<1e-9);
  assert(Math.abs(walkDelta(new Set(['w','d']),0,.05).length()-.1)<1e-9);
  assert.equal(walkDelta(new Set(['w','s','a','d']),0,.05).length(),0);
  assert.equal(walkDelta(new Set(['w']),0,100).length(),.1); // background frame does not jump
});
test('held movement stops on release, blur, dialog close and focus in a form',()=>{
  const {env,page,canvas,camera,controls,frames}=fixture(),eye=camera.position.clone();
  env.emit('keydown',{key:'w'});env.emit('keydown',{key:'w',repeat:true});assert.equal(frames.size,1);
  env.step(0);env.step(50);assert(camera.position.distanceTo(eye)>.09);assert.equal(camera.position.y,eye.y);
  env.emit('keyup',{key:'w'});const stopped=camera.position.clone();env.step(100);assert(camera.position.equals(stopped));assert.equal(frames.size,0);
  page.activeElement={tagName:'INPUT'};assert(!env.emit('keydown',{key:'w'}).prevented);assert.equal(frames.size,0);
  canvas.focus();env.emit('keydown',{key:'d'});env.emit('blur');assert.equal(frames.size,0);
  env.emit('keydown',{key:'a'});controls.setActive(false);assert.equal(frames.size,0);env.step(5000);assert(camera.position.equals(stopped));controls.dispose();
});
test('wheel and locked controls cannot change standing position, heading or continue movement',()=>{
  const {canvas,camera,controls,env,frames}=fixture(),eye=camera.position.clone();
  canvas.emit('wheel',{deltaY:-1e6});assert.equal(camera.fov,35);assert(camera.position.equals(eye));
  canvas.emit('wheel',{deltaY:1e6});assert.equal(camera.fov,110);assert(camera.position.equals(eye));
  env.emit('keydown',{key:'w'});controls.setLocked(true);assert.equal(frames.size,0);
  const quaternion=camera.quaternion.clone();canvas.emit('pointerdown',{button:0,pointerId:1,clientX:0,clientY:0});canvas.emit('pointermove',{pointerId:1,clientX:500,clientY:500});
  canvas.emit('wheel',{deltaY:-100});env.emit('keydown',{key:'w'});env.step(50);
  assert.equal(camera.fov,110);assert(camera.quaternion.equals(quaternion));assert(camera.position.equals(eye));controls.dispose();
});
test('straight up and down targets stay finite; suspension and resuming preserve the pose',()=>{
  const {controls,camera}=fixture();controls.target.copy(camera.position).add(new Vector3(0,10,0));controls.update();
  assert(camera.quaternion.toArray().every(Number.isFinite));assert(lookDirection(0,Math.PI/2).y<1);
  const position=camera.position.clone(),quaternion=camera.quaternion.clone();controls.setActive(false);controls.setActive(true);
  assert(camera.position.equals(position));assert(camera.quaternion.equals(quaternion));controls.dispose();
});
test('Shift raises, Ctrl lowers and modifier movement retains heading without saving shortcuts',()=>{
  const {env,camera,controls}=fixture(),eye=camera.position.clone(),quaternion=camera.quaternion.clone();
  const shift=env.emit('keydown',{key:'Shift'});assert(shift.prevented&&shift.stopped);env.step(0);env.step(50);
  assert(Math.abs(camera.position.y-eye.y-.03)<1e-9);assert.equal(camera.position.x,eye.x);assert.equal(camera.position.z,eye.z);assert(camera.quaternion.angleTo(quaternion)<1e-7);
  env.emit('keyup',{key:'Shift'});env.emit('keydown',{key:'Control',ctrlKey:true});const backward=env.emit('keydown',{key:'s',ctrlKey:true});assert(backward.stopped);
  env.step(100);env.step(150);assert(Math.abs(camera.position.y-eye.y)<1e-9);assert(camera.position.distanceTo(eye)>.09);
  env.emit('keyup',{key:'Control'});env.emit('keyup',{key:'s'});controls.dispose();
  assert.equal(walkDelta(new Set(['shift','control']),0,.05).y,0);
  assert.equal(walkDelta(new Set(['w','shift']),0,.05).z,-.1); // Shift no longer accelerates walking
});
