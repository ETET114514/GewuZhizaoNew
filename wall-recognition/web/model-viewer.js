import * as THREE from './vendor/three.module.min.js';
import {OrbitControls} from './vendor/OrbitControls.js';
import {buildModel} from './model-geometry.mjs';
import {buildFloors,floorGeometry,floorTexture} from './floor-geometry.mjs';
import {movePlacement} from './furniture-move.mjs';
import {buildFurniture} from './furniture-models.mjs';

export function createViewer(container, onFurnitureSelect=()=>{}, onFurnitureMove=()=>true) {
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor('#edf1f3');
  renderer.outputColorSpace=THREE.SRGBColorSpace;container.append(renderer.domElement);
  renderer.domElement.setAttribute('aria-label','三维户型，拖动旋转、滚轮缩放、右键平移');
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(40,1,.01,2000);
  const controls=new OrbitControls(camera,renderer.domElement);controls.maxPolarAngle=Math.PI/2-.02;
  controls.addEventListener('change',render);
  scene.add(new THREE.HemisphereLight(0xffffff,0x86929e,2.3));
  const light=new THREE.DirectionalLight(0xffffff,2.5);light.position.set(-8,15,10);scene.add(light);
  let group=new THREE.Group(),version=0,lastModel,selectedId=null,pointerStart=null,ghostWalls=false;scene.add(group);
  function setWallGhost(value){ghostWalls=value;group.traverse(o=>{if(['wall','frame','door','glass'].includes(o.userData.kind)){o.material.opacity=value?.12:(o.userData.kind==='glass'?.38:1);o.material.transparent=value||o.userData.kind==='glass';o.material.depthWrite=!o.material.transparent;o.material.needsUpdate=true;}});render();}
  const raycaster=new THREE.Raycaster();
  let document=null,moveEnabled=false,interactionEnabled=true,moving=null,positionPreview=null;
  function previewFurniturePosition(id,placement){
    if(!positionPreview){const f=document?.furniture.find(f=>f.id===id);if(!f)return;
      const s=document.scale_mm_per_px,b=f.bbox_px;
      positionPreview={id,x:(b[0]+b[2])/2*s,y:(b[1]+b[3])/2*s,parts:group.children.filter(mesh=>mesh.userData.kind==='furniture'&&mesh.userData.id===id).map(mesh=>({mesh,position:mesh.position.clone()}))};
    }
    if(positionPreview.id!==id)return;
    const dx=(placement.center_x_mm-positionPreview.x)/1000,dz=(placement.center_y_mm-positionPreview.y)/1000;
    for(const part of positionPreview.parts)part.mesh.position.copy(part.position).add(new THREE.Vector3(dx,0,dz));render();
  }
  function restoreFurniturePosition(){if(positionPreview){for(const part of positionPreview.parts)part.mesh.position.copy(part.position);positionPreview=null;render();}}
  function furnitureMesh(b){
    const material=new THREE.MeshStandardMaterial({color:b.color,roughness:.65,transparent:b.opacity<1,opacity:b.opacity??1,depthWrite:(b.opacity??1)===1});
    let geometry;
    if(b.shape==='ellipsoid')geometry=new THREE.SphereGeometry(.5,20,12);
    else if(b.shape==='cylinder')geometry=new THREE.CylinderGeometry(.5,.5,1,24);
    else if(b.shape==='ring'){geometry=new THREE.TorusGeometry(.41,.09,8,32);geometry.rotateX(Math.PI/2);geometry.scale(1,1/.18,1);}
    else geometry=new THREE.BoxGeometry(1,1,1);
    const mesh=new THREE.Mesh(geometry,material);mesh.scale.set(...b.size);mesh.position.set(...b.center);mesh.rotation.y=b.rotation_y||0;mesh.userData={id:b.id,kind:b.kind};return mesh;
  }
  function previewFurniture(doc,id){
    document=doc;positionPreview=null;
    for(const mesh of [...group.children])if(mesh.userData.kind==='furniture'&&mesh.userData.id===id){group.remove(mesh);mesh.geometry.dispose();mesh.material.dispose();}
    if(doc.model_settings?.show_furniture!==false)for(const part of buildFurniture({...doc,furniture:doc.furniture.filter(f=>f.id===id)}))group.add(furnitureMesh(part));
    selectFurniture(selectedId);render();
  }
  function setRay(event){const r=renderer.domElement.getBoundingClientRect();raycaster.setFromCamera(new THREE.Vector2((event.clientX-r.left)/r.width*2-1,-(event.clientY-r.top)/r.height*2+1),camera);}
  function groundPoint(event){setRay(event);return raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0),0),new THREE.Vector3());}
  function cursor(){renderer.domElement.style.cursor=moving?'grabbing':moveEnabled&&selectedId&&interactionEnabled?'grab':'';}
  function setMoveEnabled(value){if(!value)cancelMove();moveEnabled=value;cursor();}
  function setInteractionEnabled(value){interactionEnabled=value;cursor();}
  function finishMove(cancelled=false){
    if(!moving)return;const move=moving;moving=null;controls.enabled=true;pointerStart=null;
    if(renderer.domElement.hasPointerCapture(move.pointerId))renderer.domElement.releasePointerCapture(move.pointerId);
    const changed=Math.hypot(move.placement.center_x_mm-move.startX,move.placement.center_y_mm-move.startY)>.1;
    if(cancelled||!changed)for(const part of move.parts)part.mesh.position.copy(part.position);
    cursor();render();onFurnitureMove({phase:cancelled||!changed?'cancel':'end',id:move.id,placement:move.placement});
  }
  function cancelMove(){finishMove(true);}
  // Capture before OrbitControls: dragging selected furniture must not orbit the camera.
  renderer.domElement.addEventListener('pointerdown',event=>{
    if(moving){event.preventDefault();event.stopImmediatePropagation();return;}
    if(event.button!==0||!moveEnabled||!interactionEnabled||!selectedId||!document)return;
    setRay(event);const hit=raycaster.intersectObjects(group.children,true).find(hit=>!ghostWalls||!['wall','frame','door','glass'].includes(hit.object.userData.kind));
    if(hit?.object.userData.kind!=='furniture'||hit.object.userData.id!==selectedId)return;
    const point=groundPoint(event),item=document.furniture.find(f=>f.id===selectedId);
    if(!point||!item)return;
    const s=document.scale_mm_per_px,startX=(item.bbox_px[0]+item.bbox_px[2])/2*s,startY=(item.bbox_px[1]+item.bbox_px[3])/2*s;
    const placement=movePlacement(document,item,startX,startY);if(!placement)return;
    if(onFurnitureMove({phase:'start',id:selectedId})===false)return;
    moving={id:selectedId,pointerId:event.pointerId,item,point,startX,startY,placement:{...placement,center_x_mm:startX,center_y_mm:startY},
      parts:group.children.filter(mesh=>mesh.userData.kind==='furniture'&&mesh.userData.id===selectedId).map(mesh=>({mesh,position:mesh.position.clone()}))};
    controls.enabled=false;pointerStart=null;renderer.domElement.setPointerCapture(event.pointerId);
    event.preventDefault();event.stopImmediatePropagation();cursor();
  },true);
  renderer.domElement.addEventListener('pointermove',event=>{
    if(!moving||moving.pointerId!==event.pointerId)return;
    event.preventDefault();event.stopImmediatePropagation();const point=groundPoint(event);if(!point)return;
    const placement=movePlacement(document,moving.item,moving.startX+(point.x-moving.point.x)*1000,moving.startY+(point.z-moving.point.z)*1000);if(!placement)return;
    moving.placement=placement;const dx=(placement.center_x_mm-moving.startX)/1000,dz=(placement.center_y_mm-moving.startY)/1000;
    for(const part of moving.parts)part.mesh.position.copy(part.position).add(new THREE.Vector3(dx,0,dz));
    render();onFurnitureMove({phase:'preview',id:moving.id,placement});
  },true);
  renderer.domElement.addEventListener('pointerup',event=>{if(moving?.pointerId===event.pointerId){event.preventDefault();event.stopImmediatePropagation();finishMove();}},true);
  renderer.domElement.addEventListener('pointercancel',event=>{if(moving?.pointerId===event.pointerId)cancelMove();},true);
  renderer.domElement.addEventListener('lostpointercapture',event=>{if(moving?.pointerId===event.pointerId)cancelMove();});
  const escape=event=>{if(event.key==='Escape'&&moving){event.preventDefault();event.stopImmediatePropagation();cancelMove();}};
  window.addEventListener('keydown',escape,true);
  const blur=()=>cancelMove();window.addEventListener('blur',blur);
  function selectFurniture(id){selectedId=id;group.traverse(o=>{if(o.userData.kind==='furniture'&&o.material?.emissive)o.material.emissive.set(o.userData.id===id?'#304c58':'#000000');});cursor();render();}
  renderer.domElement.addEventListener('pointerdown',event=>{if(event.button===0)pointerStart=[event.clientX,event.clientY];});
  renderer.domElement.addEventListener('pointerup',event=>{
    if(!pointerStart||!interactionEnabled)return;const start=pointerStart;pointerStart=null;
    if(Math.hypot(event.clientX-start[0],event.clientY-start[1])>5)return;
    const r=renderer.domElement.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2((event.clientX-r.left)/r.width*2-1,-(event.clientY-r.top)/r.height*2+1),camera);
    const hit=raycaster.intersectObjects(group.children,true).find(hit=>!ghostWalls||!['wall','frame','door','glass'].includes(hit.object.userData.kind));
    if(hit?.object.userData.kind==='furniture')onFurnitureSelect(hit.object.userData.id);
  });
  renderer.domElement.addEventListener('pointercancel',()=>{pointerStart=null;});
  function focusFurniture(id){
    const bounds=new THREE.Box3();group.traverse(o=>{if(o.userData.kind==='furniture'&&o.userData.id===id)bounds.expandByObject(o);});
    if(bounds.isEmpty())return;
    const center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3()).length();
    const direction=camera.position.clone().sub(controls.target).normalize();
    controls.target.copy(center);camera.position.copy(center).addScaledVector(direction,Math.max(2,size*2));controls.update();render();
  }
  function render(){renderer.render(scene,camera);}
  function resize(){const w=container.clientWidth,h=container.clientHeight;if(!w||!h)return;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();render();}
  const observer=new ResizeObserver(resize);observer.observe(container);
  function clear(){group.traverse(o=>{o.geometry?.dispose();if(o.material){o.material.map?.dispose();o.material.dispose();}});scene.remove(group);group=new THREE.Group();scene.add(group);}
  function reset(top=false){cancelMove();if(!lastModel)return;const r=Math.max(lastModel.width,lastModel.depth,lastModel.height)*1.25/Math.min(1,camera.aspect);controls.target.set(0,0,0);camera.position.set(top?0:r,top?r*1.8:r*.95,top?.001:r);camera.far=Math.max(2000,r*10);camera.updateProjectionMatrix();controls.update();render();}
  function update(doc,imageUrl,fit=false){
    cancelMove();positionPreview=null;document=doc;
    const model=buildModel(doc);lastModel=model;const ticket=++version;clear();
    for(const b of model.boxes){
      const opacity=b.opacity??(b.kind==='glass'?.38:1);
      const material=new THREE.MeshStandardMaterial({color:b.color,roughness:.65,transparent:opacity<1,opacity,depthWrite:opacity===1});
      let geometry;
      if(b.shape==='ellipsoid')geometry=new THREE.SphereGeometry(.5,20,12);
      else if(b.shape==='cylinder')geometry=new THREE.CylinderGeometry(.5,.5,1,24);
      else if(b.shape==='ring'){geometry=new THREE.TorusGeometry(.41,.09,8,32);geometry.rotateX(Math.PI/2);geometry.scale(1,1/.18,1);}
      else geometry=new THREE.BoxGeometry(1,1,1);
      const mesh=new THREE.Mesh(geometry,material);mesh.scale.set(...b.size);mesh.position.set(...b.center);mesh.rotation.y=b.rotation_y||0;mesh.userData={id:b.id,kind:b.kind};group.add(mesh);
    }
    const floor=new THREE.Mesh(new THREE.BoxGeometry(model.width,.08,model.depth),new THREE.MeshStandardMaterial({color:model.settings.floor_color,roughness:1}));floor.position.y=-.045;group.add(floor);
    if(model.settings.show_room_floors!==false)for(const region of buildFloors(doc)){
      const texture=floorTexture(region.settings);
      const material=new THREE.MeshStandardMaterial({color:texture?'#ffffff':region.settings.color,map:texture,roughness:region.settings.material==='tile'?.5:.8,side:THREE.DoubleSide});
      const mesh=new THREE.Mesh(floorGeometry(region.polygons,region.settings),material);mesh.position.y=.006;
      mesh.userData={id:region.id,kind:'room-floor'};group.add(mesh);
    }
    if(model.settings.show_plan){new THREE.TextureLoader().load(imageUrl,texture=>{
      if(ticket!==version){texture.dispose();return;}texture.colorSpace=THREE.SRGBColorSpace;
      const plane=new THREE.Mesh(new THREE.PlaneGeometry(model.width,model.depth),new THREE.MeshBasicMaterial({map:texture,transparent:true,opacity:.85}));
      plane.rotation.x=-Math.PI/2;plane.position.y=.012;group.add(plane);render();
    });}
    setWallGhost(ghostWalls);selectFurniture(selectedId);resize();if(fit)reset();render();return model;
  }
  return {update,reset,resize,selectFurniture,focusFurniture,setWallGhost,setMoveEnabled,setInteractionEnabled,cancelMove,previewFurniturePosition,restoreFurniturePosition,previewFurniture,dispose(){cancelMove();positionPreview=null;window.removeEventListener('keydown',escape,true);window.removeEventListener('blur',blur);version++;observer.disconnect();controls.dispose();clear();renderer.dispose();renderer.domElement.remove();}};
}
