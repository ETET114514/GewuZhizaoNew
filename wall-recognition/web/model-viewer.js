import * as THREE from './vendor/three.module.min.js';
import {OrbitControls} from './vendor/OrbitControls.js';
import {buildModel} from './model-geometry.mjs';
import {buildFloors,floorGeometry,floorTexture} from './floor-geometry.mjs';
import {movePlacement,placementOf} from './furniture-move.mjs';
import {snapFurniture} from './furniture-snap.mjs';
import {buildFurniture} from './furniture-models.mjs';
import {checkCollisions,boxCorners} from './collision-boxes.mjs';
import {ceilingLayout,ceilingMeshGeometry,fixtureParts,temperatureColor,ceilingViewTarget} from './ceiling-geometry.mjs';

export function createViewer(container, onFurnitureSelect=()=>{}, onFurnitureMove=()=>true, onCollisions=()=>{}) {
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor('#edf1f3');
  renderer.outputColorSpace=THREE.SRGBColorSpace;container.append(renderer.domElement);
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1;
  renderer.domElement.setAttribute('aria-label','三维户型，拖动旋转、滚轮缩放、右键平移');
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(40,1,.01,2000);
  const controls=new OrbitControls(camera,renderer.domElement);controls.maxPolarAngle=Math.PI/2-.02;
  controls.addEventListener('change',render);
  scene.add(new THREE.HemisphereLight(0xffffff,0x86929e,2.3));
  const light=new THREE.DirectionalLight(0xffffff,2.5);light.position.set(-8,15,10);scene.add(light);
  let group=new THREE.Group(),version=0,lastModel,selectedId=null,pointerStart=null,ghostWalls=false;scene.add(group);
  let ceilingVisible=false;
  let ceilingSelectedId=null;
  const ceilingSelection=new THREE.Group();scene.add(ceilingSelection);
  function highlightCeiling(id=ceilingSelectedId){
    ceilingSelectedId=id;
    for(const line of [...ceilingSelection.children]){line.geometry.dispose();line.material.dispose();ceilingSelection.remove(line);}
    const l=document?.ceiling_layout?.lights?.find(l=>l.id===id);if(!l)return;
    const x=(l.center_mm[0]-document.image.width_px*document.scale_mm_per_px/2)/1000,
      z=(l.center_mm[1]-document.image.height_px*document.scale_mm_per_px/2)/1000,size=l.settings.size_mm/1000;
    const long=['linear','track'].includes(l.settings.light_type),w=size*.58,h=long?Math.min(size,.08)*.7:w;
    const points=long?[[-w,-h],[w,-h],[w,h],[-w,h]]:Array.from({length:48},(_,i)=>[Math.cos(i*Math.PI/24)*w,Math.sin(i*Math.PI/24)*w]);
    const angle=-l.settings.rotation_deg*Math.PI/180;
    const geometry=new THREE.BufferGeometry().setFromPoints(points.map(([dx,dz])=>new THREE.Vector3(x+dx*Math.cos(angle)+dz*Math.sin(angle),l.bottom_mm/1000-.014,z-dx*Math.sin(angle)+dz*Math.cos(angle))));
    ceilingSelection.add(new THREE.LineLoop(geometry,new THREE.LineBasicMaterial({color:'#7c3aed'})));render();
  }
  function setCeilingVisible(value){ceilingVisible=value;group.traverse(o=>{if(o.userData.topSurface)o.visible=value&&o.userData.roomVisible!==false;});render();}
  function setWallGhost(value){ghostWalls=value;group.traverse(o=>{if(['wall','frame','door','glass'].includes(o.userData.kind)){o.material.opacity=value?.12:(o.userData.kind==='glass'?.38:1);o.material.transparent=value||o.userData.kind==='glass';o.material.depthWrite=!o.material.transparent;o.material.needsUpdate=true;}});render();}
  const raycaster=new THREE.Raycaster();
  let document=null,moveEnabled=false,interactionEnabled=true,moving=null,positionPreview=null;
  const collisionGroup=new THREE.Group();scene.add(collisionGroup);
  let collisionOptions={enabled:true,showAll:false},collisionReplacement=null;
  function clearCollisionBoxes(){for(const line of [...collisionGroup.children]){line.geometry.dispose();line.material.dispose();collisionGroup.remove(line);}}
  function updateCollisions(replacement=null){
    collisionReplacement=replacement;clearCollisionBoxes();
    if(!document)return;
    const result=checkCollisions(document,{replacement});onCollisions(result);
    if(!collisionOptions.enabled)return;
    for(const box of result.boxes){
      const conflict=result.conflictingIds.has(box.id);
      if(!conflict&&box.id!==selectedId&&!collisionOptions.showAll)continue;
      if(box.kind==='furniture'&&document.model_settings?.show_furniture===false)continue;
      const corners=boxCorners(box),vertices=[];
      for(let bits=0;bits<8;bits++)for(const step of [1,2,4])if(!(bits&step))vertices.push(...corners[bits],...corners[bits|step]);
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
      const line=new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color:conflict?'#e23b3b':'#2676d9',transparent:true,opacity:conflict?.95:box.id===selectedId?.85:.35,depthTest:false}));
      line.renderOrder=10;line.userData={id:box.id,kind:'collision',conflict};collisionGroup.add(line);
    }
  }
  function setCollisionOptions(options){collisionOptions={...collisionOptions,...options};updateCollisions(collisionReplacement);render();}
  function positionCollisions(id,placement){
    const item=document?.furniture.find(f=>f.id===id);if(!item)return;
    const scale=document.scale_mm_per_px,box=item.bbox_px;
    const dx=placement.center_x_mm/scale-(box[0]+box[2])/2,dz=placement.center_y_mm/scale-(box[1]+box[3])/2;
    updateCollisions({...item,bbox_px:box.map((v,i)=>v+(i%2?dz:dx))});
  }
  function previewFurniturePosition(id,placement){
    if(!positionPreview){const f=document?.furniture.find(f=>f.id===id);if(!f)return;
      const s=document.scale_mm_per_px,b=f.bbox_px;
      positionPreview={id,x:(b[0]+b[2])/2*s,y:(b[1]+b[3])/2*s,parts:group.children.filter(mesh=>mesh.userData.kind==='furniture'&&mesh.userData.id===id).map(mesh=>({mesh,position:mesh.position.clone()}))};
    }
    if(positionPreview.id!==id)return;
    const dx=(placement.center_x_mm-positionPreview.x)/1000,dz=(placement.center_y_mm-positionPreview.y)/1000;
    for(const part of positionPreview.parts)part.mesh.position.copy(part.position).add(new THREE.Vector3(dx,0,dz));positionCollisions(id,placement);render();
  }
  function restoreFurniturePosition(){if(positionPreview){for(const part of positionPreview.parts)part.mesh.position.copy(part.position);positionPreview=null;updateCollisions();render();}}
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
    if(cancelled||!changed)updateCollisions();
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
    let placement=movePlacement(document,moving.item,moving.startX+(point.x-moving.point.x)*1000,moving.startY+(point.z-moving.point.z)*1000);if(!placement)return;
    const candidate={...moving.item,bbox_px:moving.item.bbox_px.map((v,i)=>v+(i%2?(placement.center_y_mm-moving.startY):(placement.center_x_mm-moving.startX))/document.scale_mm_per_px)};
    const snapped=snapFurniture(document,candidate,{threshold:80/document.scale_mm_per_px,enabled:!event.altKey&&globalThis.document.getElementById('furniture-snap-toggle').checked});
    placement=placementOf(document,snapped.item);
    moving.placement=placement;const dx=(placement.center_x_mm-moving.startX)/1000,dz=(placement.center_y_mm-moving.startY)/1000;
    for(const part of moving.parts)part.mesh.position.copy(part.position).add(new THREE.Vector3(dx,0,dz));
    updateCollisions(snapped.item);
    render();onFurnitureMove({phase:'preview',id:moving.id,placement,gaps:snapped.gaps,guides:snapped.guides});
  },true);
  renderer.domElement.addEventListener('pointerup',event=>{if(moving?.pointerId===event.pointerId){event.preventDefault();event.stopImmediatePropagation();finishMove();}},true);
  renderer.domElement.addEventListener('pointercancel',event=>{if(moving?.pointerId===event.pointerId)cancelMove();},true);
  renderer.domElement.addEventListener('lostpointercapture',event=>{if(moving?.pointerId===event.pointerId)cancelMove();});
  const escape=event=>{if(event.key==='Escape'&&moving){event.preventDefault();event.stopImmediatePropagation();cancelMove();}};
  window.addEventListener('keydown',escape,true);
  const blur=()=>cancelMove();window.addEventListener('blur',blur);
  function selectFurniture(id){selectedId=id;group.traverse(o=>{if(o.userData.kind==='furniture'&&o.material?.emissive)o.material.emissive.set(o.userData.id===id?'#304c58':'#000000');});updateCollisions();cursor();render();}
  renderer.domElement.addEventListener('pointerdown',event=>{if(event.button===0)pointerStart=[event.clientX,event.clientY];});
  renderer.domElement.addEventListener('pointerup',event=>{
    if(!pointerStart||!interactionEnabled)return;const start=pointerStart;pointerStart=null;
    if(Math.hypot(event.clientX-start[0],event.clientY-start[1])>5)return;
    const r=renderer.domElement.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2((event.clientX-r.left)/r.width*2-1,-(event.clientY-r.top)/r.height*2+1),camera);
    const hit=raycaster.intersectObjects(group.children,true).find(hit=>!ghostWalls||!['wall','frame','door','glass'].includes(hit.object.userData.kind));
    if(hit?.object.userData.kind==='furniture')onFurnitureSelect(hit.object.userData.id);
    else if(['ceiling','cove','strip','light'].includes(hit?.object.userData.kind))window.dispatchEvent(new CustomEvent('ceiling-select',{detail:hit.object.userData.id}));
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
  function reset(top=false){cancelMove();if(!lastModel)return;camera.fov=40;camera.up.set(0,1,0);controls.maxPolarAngle=Math.PI/2-.02;const r=Math.max(lastModel.width,lastModel.depth,lastModel.height)*1.25/Math.min(1,camera.aspect);controls.target.set(0,0,0);camera.position.set(top?0:r,top?r*1.8:r*.95,top?.001:r);camera.far=Math.max(2000,r*10);camera.updateProjectionMatrix();controls.update();render();}
  function viewCeiling(roomId,componentId){cancelMove();if(!lastModel)return;
    const target=ceilingViewTarget(document,roomId,componentId);if(!target)return;
    highlightCeiling(componentId||null);
    controls.maxPolarAngle=Math.PI-.02;camera.fov=target.light?55:110;camera.up.set(0,0,-1);camera.updateProjectionMatrix();
    controls.target.set(target.x,target.height-.01,target.z);camera.position.set(target.x+(target.light?.35:0),target.eye,target.z+(target.light?.15:.001));controls.update();render();
  }
  function update(doc,imageUrl,fit=false){
    cancelMove();positionPreview=null;document=doc;
    const model=buildModel(doc),ceilings=ceilingLayout(doc,model);model.ceilingRoomCount=ceilings.surfaces.filter(s=>s.role==='ceiling'&&s.id.startsWith('room:')).length;
    model.ceilingSupplementalCount=ceilings.supplementalCount||0;
    if(ceilings.supplementalCount)model.warnings.push(`${ceilings.supplementalCount} 块未分区的闭合空间已补默认顶面；如需单独编辑，请在二维补充房间区域。`);
    lastModel=model;const ticket=++version;clear();
    if(model.wallMesh.indices.length){
      const geometry=new THREE.BufferGeometry();
      geometry.setAttribute('position',new THREE.Float32BufferAttribute(model.wallMesh.positions,3));
      geometry.setAttribute('normal',new THREE.Float32BufferAttribute(model.wallMesh.normals,3));
      geometry.setIndex(model.wallMesh.indices);geometry.computeBoundingSphere();
      const material=new THREE.MeshStandardMaterial({color:model.settings.wall_color,roughness:.65});
      const mesh=new THREE.Mesh(geometry,material);mesh.userData={id:'walls',kind:'wall',sourceIds:model.wallMesh.sourceIds};group.add(mesh);
    }
    if(model.windowFrameMesh.indices.length){
      const data=model.windowFrameMesh,geometry=new THREE.BufferGeometry();
      geometry.setAttribute('position',new THREE.Float32BufferAttribute(data.positions,3));
      geometry.setAttribute('normal',new THREE.Float32BufferAttribute(data.normals,3));geometry.setIndex(data.indices);geometry.computeBoundingSphere();
      const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:'#657e88',roughness:.65}));
      mesh.userData={id:'window-frames',kind:'frame',sourceIds:data.sourceIds};group.add(mesh);
    }
    for(const b of model.boxes.filter(b=>b.kind!=='wall'&&!['window_fixed_frame','window_fixed_mullion','window_corner_frame'].includes(b.component))){
      const opacity=b.opacity??(b.kind==='glass'?.38:1);
      const material=new THREE.MeshStandardMaterial({color:b.color,roughness:.65,transparent:opacity<1,opacity,depthWrite:opacity===1});
      let geometry;
      if(b.shape==='ellipsoid')geometry=new THREE.SphereGeometry(.5,20,12);
      else if(b.shape==='cylinder')geometry=new THREE.CylinderGeometry(.5,.5,1,24);
      else if(b.shape==='ring'){geometry=new THREE.TorusGeometry(.41,.09,8,32);geometry.rotateX(Math.PI/2);geometry.scale(1,1/.18,1);}
      else geometry=new THREE.BoxGeometry(1,1,1);
      const mesh=new THREE.Mesh(geometry,material);mesh.scale.set(...b.size);mesh.position.set(...b.center);
      if(b.quaternion)mesh.quaternion.fromArray(b.quaternion);else mesh.rotation.y=b.rotation_y||0;
      mesh.userData={id:b.id,kind:b.kind};group.add(mesh);
    }
    const floor=new THREE.Mesh(new THREE.BoxGeometry(model.width,.08,model.depth),new THREE.MeshStandardMaterial({color:model.settings.floor_color,roughness:1}));floor.position.y=-.045;group.add(floor);
    if(model.settings.show_room_floors!==false)for(const region of buildFloors(doc)){
      const texture=floorTexture(region.settings);
      const material=new THREE.MeshStandardMaterial({color:texture?'#ffffff':region.settings.color,map:texture,roughness:region.settings.material==='tile'?.5:.8,side:THREE.DoubleSide});
      const mesh=new THREE.Mesh(floorGeometry(region.polygons,region.settings),material);mesh.position.y=.006;
      mesh.userData={id:region.id,kind:'room-floor'};group.add(mesh);
    }
    for(const s of ceilings.surfaces){
      const material=new THREE.MeshStandardMaterial({color:s.color,roughness:.75,side:THREE.DoubleSide,
        emissive:s.emissive?(s.temperature_k?temperatureColor(s.temperature_k):s.color):'#000000',emissiveIntensity:s.emissive?(s.intensity??1.5):0});
      const mesh=new THREE.Mesh(ceilingMeshGeometry(doc,s),material);
      mesh.userData={id:s.id,kind:s.role,topSurface:true,roomVisible:s.visible};group.add(mesh);
    }
    for(const l of doc.ceiling_layout?.lights||[]){
      for(const part of fixtureParts(doc,l)){
        const mesh=furnitureMesh(part);
        if(part.emissive&&part.on){mesh.material.emissive.copy(temperatureColor(part.temperature_k));mesh.material.emissiveIntensity=part.intensity;}
        group.add(mesh);
      }
    }
    let realLights=0;
    for(const l of doc.ceiling_layout?.lights||[]){
      const v=l.settings;if(!v.on||v.intensity<=0||realLights++>=16)continue;
      const x=(l.center_mm[0]-doc.image.width_px*doc.scale_mm_per_px/2)/1000,z=(l.center_mm[1]-doc.image.height_px*doc.scale_mm_per_px/2)/1000;
      const spot=['spot','downlight','track'].includes(v.light_type);
      const source=spot?new THREE.SpotLight(temperatureColor(v.temperature_k),v.intensity*8,10,Math.PI/4,.5,2):new THREE.PointLight(temperatureColor(v.temperature_k),v.intensity*5,10,2);
      source.position.set(x,l.bottom_mm/1000-.02,z);group.add(source);
      if(spot){const tilt=v.tilt_deg*Math.PI/180,angle=-v.rotation_deg*Math.PI/180;
        source.target.position.set(x+Math.sin(tilt)*Math.sin(angle),source.position.y-Math.cos(tilt),z+Math.sin(tilt)*Math.cos(angle));group.add(source.target);}
    }
    setCeilingVisible(ceilingVisible);
    if(model.settings.show_plan){new THREE.TextureLoader().load(imageUrl,texture=>{
      if(ticket!==version){texture.dispose();return;}texture.colorSpace=THREE.SRGBColorSpace;
      const plane=new THREE.Mesh(new THREE.PlaneGeometry(model.width,model.depth),new THREE.MeshBasicMaterial({map:texture,transparent:true,opacity:.85}));
      plane.rotation.x=-Math.PI/2;plane.position.y=.012;group.add(plane);render();
    });}
    setWallGhost(ghostWalls);selectFurniture(selectedId);highlightCeiling();resize();if(fit)reset();render();return model;
  }
  return {update,reset,viewCeiling,resize,selectFurniture,focusFurniture,setWallGhost,setCeilingVisible,setMoveEnabled,setInteractionEnabled,setCollisionOptions,cancelMove,previewFurniturePosition,restoreFurniturePosition,previewFurniture,dispose(){cancelMove();highlightCeiling(null);scene.remove(ceilingSelection);positionPreview=null;clearCollisionBoxes();scene.remove(collisionGroup);window.removeEventListener('keydown',escape,true);window.removeEventListener('blur',blur);version++;observer.disconnect();controls.dispose();clear();renderer.dispose();renderer.domElement.remove();}};
}
