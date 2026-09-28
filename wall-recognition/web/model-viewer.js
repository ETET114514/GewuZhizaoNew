import * as THREE from './vendor/three.module.min.js';
import {OrbitControls} from './vendor/OrbitControls.js';
import {buildModel} from './model-geometry.mjs';
import {buildFloors,floorGeometry,floorTexture} from './floor-geometry.mjs';

export function createViewer(container) {
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor('#edf1f3');
  renderer.outputColorSpace=THREE.SRGBColorSpace;container.append(renderer.domElement);
  renderer.domElement.setAttribute('aria-label','三维户型，拖动旋转、滚轮缩放、右键平移');
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(40,1,.01,2000);
  const controls=new OrbitControls(camera,renderer.domElement);controls.maxPolarAngle=Math.PI/2-.02;
  controls.addEventListener('change',render);
  scene.add(new THREE.HemisphereLight(0xffffff,0x86929e,2.3));
  const light=new THREE.DirectionalLight(0xffffff,2.5);light.position.set(-8,15,10);scene.add(light);
  let group=new THREE.Group(),version=0,lastModel;scene.add(group);
  function render(){renderer.render(scene,camera);}
  function resize(){const w=container.clientWidth,h=container.clientHeight;if(!w||!h)return;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();render();}
  const observer=new ResizeObserver(resize);observer.observe(container);
  function clear(){group.traverse(o=>{o.geometry?.dispose();if(o.material){o.material.map?.dispose();o.material.dispose();}});scene.remove(group);group=new THREE.Group();scene.add(group);}
  function reset(top=false){if(!lastModel)return;const r=Math.max(lastModel.width,lastModel.depth,lastModel.height)*1.25/Math.min(1,camera.aspect);controls.target.set(0,0,0);camera.position.set(top?0:r,top?r*1.8:r*.95,top?.001:r);camera.far=Math.max(2000,r*10);camera.updateProjectionMatrix();controls.update();render();}
  function update(doc,imageUrl,fit=false){
    const model=buildModel(doc);lastModel=model;const ticket=++version;clear();
    for(const b of model.boxes){
      const material=new THREE.MeshStandardMaterial({color:b.color,roughness:.8,transparent:b.kind==='glass',opacity:b.kind==='glass'?.38:1});
      const mesh=new THREE.Mesh(new THREE.BoxGeometry(...b.size),material);mesh.position.set(...b.center);mesh.userData={id:b.id,kind:b.kind};group.add(mesh);
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
    resize();if(fit)reset();render();return model;
  }
  return {update,reset,resize,dispose(){version++;observer.disconnect();controls.dispose();clear();renderer.dispose();renderer.domElement.remove();}};
}
