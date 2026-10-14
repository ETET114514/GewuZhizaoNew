import {Vector3} from './vendor/three.module.min.js';

const LIMIT=85*Math.PI/180;
export function lookDirection(yaw,pitch){
  pitch=Math.max(-LIMIT,Math.min(LIMIT,pitch));
  return new Vector3(Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),-Math.cos(yaw)*Math.cos(pitch));
}
export function walkDelta(keys,yaw,seconds,speed=2){
  let forward=Number(keys.has('w'))-Number(keys.has('s')),right=Number(keys.has('d'))-Number(keys.has('a'));
  const length=Math.hypot(forward,right);if(!length)return new Vector3();
  forward/=length;right/=length;const step=Math.max(0,Math.min(.05,seconds))*speed;
  return new Vector3((Math.sin(yaw)*forward+Math.cos(yaw)*right)*step,0,(-Math.cos(yaw)*forward+Math.sin(yaw)*right)*step);
}

// The eye never orbits its target: mouse input changes heading, WASD changes position.
// Keep world Y as up and stop short of the poles, where heading becomes ambiguous.
export function createStableControls(camera,canvas,onChange,environment=window){
  const page=canvas.ownerDocument,keys=new Set(),target=new Vector3();
  let active=false,enabled=true,locked=false,yaw=0,pitch=0,distance=1,drag=null,frame=null,lastTime=null,constrainMove=null,walking=true;
  const listeners=[];
  function listen(object,name,fn,options){object.addEventListener(name,fn,options);listeners.push(()=>object.removeEventListener(name,fn,options));}
  function aim(){camera.up.set(0,1,0);target.copy(camera.position).addScaledVector(lookDirection(yaw,pitch),distance);camera.lookAt(target);onChange();}
  function update(){const vector=target.clone().sub(camera.position);distance=Math.max(.01,vector.length());
    if(Math.hypot(vector.x,vector.z)>1e-8)yaw=Math.atan2(vector.x,-vector.z);
    pitch=Math.max(-LIMIT,Math.min(LIMIT,Math.asin(Math.max(-1,Math.min(1,vector.y/distance)))));aim();}
  function stop(){keys.clear();lastTime=null;if(frame!==null)environment.cancelAnimationFrame(frame);frame=null;
    const held=drag;drag=null;if(held&&canvas.hasPointerCapture(held.id))canvas.releasePointerCapture(held.id);}
  function usable(){return active&&enabled&&!locked;}
  function tick(time){frame=null;if(!usable()||!keys.size){lastTime=null;return;}
    const seconds=lastTime===null?0:(time-lastTime)/1000;lastTime=time;
    const delta=walkDelta(keys,yaw,seconds,keys.has('shift')?4:2);const next=constrainMove?constrainMove(camera.position,delta):camera.position.clone().add(delta);target.add(next.clone().sub(camera.position));camera.position.copy(next);camera.lookAt(target);onChange();
    frame=environment.requestAnimationFrame(tick);}
  listen(canvas,'pointerdown',event=>{if(!active||!enabled||event.button!==0||drag)return;canvas.focus({preventScroll:true});if(locked)return;
    drag={id:event.pointerId,x:event.clientX,y:event.clientY};canvas.setPointerCapture(event.pointerId);});
  listen(canvas,'pointermove',event=>{if(!usable()||drag?.id!==event.pointerId)return;
    const dx=event.clientX-drag.x,dy=event.clientY-drag.y;drag.x=event.clientX;drag.y=event.clientY;
    yaw=Math.atan2(Math.sin(yaw+dx*.003),Math.cos(yaw+dx*.003));pitch=Math.max(-LIMIT,Math.min(LIMIT,pitch-dy*.003));aim();});
  function end(event){if(drag?.id===event.pointerId){const id=drag.id;drag=null;if(canvas.hasPointerCapture(id))canvas.releasePointerCapture(id);}}
  listen(canvas,'pointerup',end);listen(canvas,'pointercancel',end);listen(canvas,'lostpointercapture',()=>{drag=null;});
  listen(canvas,'contextmenu',event=>{if(active)event.preventDefault();});
  listen(canvas,'wheel',event=>{if(!active||!enabled)return;event.preventDefault();if(locked)return;
    camera.fov=Math.max(35,Math.min(110,camera.fov*Math.exp(event.deltaY*.001)));camera.updateProjectionMatrix();onChange();},{passive:false});
  listen(environment,'keydown',event=>{const key=event.key.toLowerCase();
    if(!usable()||!walking||page.activeElement!==canvas||!['w','a','s','d','shift'].includes(key)||event.ctrlKey||event.metaKey||event.altKey)return;
    event.preventDefault();keys.add(key);if(frame===null)frame=environment.requestAnimationFrame(tick);});
  listen(environment,'keyup',event=>{keys.delete(event.key.toLowerCase());if(!keys.size)stop();});
  listen(canvas,'blur',stop);listen(environment,'blur',stop);listen(page,'visibilitychange',()=>{if(page.hidden)stop();});
  return {setMovementConstraint:fn=>{constrainMove=fn;},setWalking:value=>{walking=value;stop();},target,update,stop,get enabled(){return enabled;},set enabled(value){enabled=value;if(!value)stop();},
    setActive(value){active=value;if(!value)stop();},setLocked(value){locked=value;stop();},dispose(){stop();listeners.forEach(remove=>remove());}};
}
