import * as THREE from './vendor/three.module.min.js';
import {buildModel} from './model-geometry.mjs';

function containsRing(ring,x,y){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const a=ring[i],b=ring[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;}

// Use the actual footprint, including holes, rather than the room bounding box.
export function mountingSurfaces(doc,roomKey,pointMm){
  if(!pointMm?.every(Number.isFinite))return [];
  return (doc.ceiling_layout?.surfaces||[]).filter(s=>s.role==='ceiling'&&s.room_key===roomKey
    &&s.polygons_mm.some(rings=>containsRing(rings[0],...pointMm)&&!rings.slice(1).some(r=>containsRing(r,...pointMm))))
    .sort((a,b)=>a.bottom_mm-b.bottom_mm);
}
export function lightObstruction(doc,light){
  return mountingSurfaces(doc,light.room_key,light.center_mm).find(s=>s.id!==light.host_id&&s.bottom_mm<light.bottom_mm-.1)||null;
}
export function ceilingViewTarget(doc,roomId,componentId){
  const room=doc.room_partition?.regions.find(r=>r.id===roomId&&r.review_status!=='rejected');if(!room)return null;
  const roomKey=room.style_key||'id:'+room.id,light=doc.ceiling_layout?.lights?.find(l=>l.id===componentId&&l.room_key===roomKey);
  const point=light?.center_mm||room.label_px?.map(v=>v*doc.scale_mm_per_px);if(!point?.every(Number.isFinite))return null;
  const opts=doc.ceiling_design?.rooms?.[roomKey];
  const height=Math.min(light?.bottom_mm??Infinity,mountingSurfaces(doc,roomKey,point)[0]?.bottom_mm??opts?.height_mm??doc.model_settings?.wall_height_mm??2800)/1000;
  return {x:(point[0]-doc.image.width_px*doc.scale_mm_per_px/2)/1000,
    z:(point[1]-doc.image.height_px*doc.scale_mm_per_px/2)/1000,height,eye:Math.max(.05,Math.min(1.1,height-.6)),light:!!light};
}

// The displayed top of the walls includes repaired corners and opening
// headers that the original 2D floor partition does not include.
export function structuralCeilings(doc,knownSurfaces,model=null){
  // Once partitioned, every top must belong to an editable region. Manual
  // exclusions/splits and failed closure must never create hidden extra rooms.
  if(doc.room_partition)return [];
  if(!doc.walls?.length)return [];
  const built=model||buildModel({...doc,model_settings:{...doc.model_settings,show_furniture:false}},{buildMeshes:false});
  const scale=doc.scale_mm_per_px,W=doc.image.width_px*scale,H=doc.image.height_px*scale;
  const round=v=>Math.round(v*10000)/10000;
  const rects=built.boxes.filter(b=>b.kind==='wall'&&b.center[1]+b.size[1]/2>=built.height-.0001).map(b=>[
    (b.center[0]-b.size[0]/2)*1000+W/2,(b.center[2]-b.size[2]/2)*1000+H/2,
    (b.center[0]+b.size[0]/2)*1000+W/2,(b.center[2]+b.size[2]/2)*1000+H/2].map(round));
  if(!rects.length)return [];
  const covered=knownSurfaces.filter(s=>s.id.startsWith('room:')).flatMap(s=>s.polygons_mm.map(r=>r[0]));
  // Preserve intentional holes/exclusions instead of capping them as new rooms.
  for(const r of doc.room_partition?.regions||[])for(const rings of r.polygons_px||(r.rings_px?[r.rings_px]:[]))covered.push(rings[0].map(p=>p.map(v=>v*scale)));
  const xs=[...new Set([0,W,...rects.flatMap(r=>[r[0],r[2]]),...covered.flat().map(p=>round(p[0]))])].sort((a,b)=>a-b),
    zs=[...new Set([0,H,...rects.flatMap(r=>[r[1],r[3]]),...covered.flat().map(p=>round(p[1]))])].sort((a,b)=>a-b);
  const nx=xs.length-1,nz=zs.length-1;if(nx*nz>4_000_000)return [];
  const xIndex=new Map(xs.map((v,i)=>[v,i])),zIndex=new Map(zs.map((v,i)=>[v,i])),blocked=new Uint8Array(nx*nz),outside=new Uint8Array(nx*nz);
  for(const r of rects)for(let z=zIndex.get(r[1]);z<zIndex.get(r[3]);z++)for(let x=xIndex.get(r[0]);x<xIndex.get(r[2]);x++)blocked[z*nx+x]=1;
  function neighbors(id){const x=id%nx,z=Math.floor(id/nx);return [x? id-1:-1,x<nx-1?id+1:-1,z?id-nx:-1,z<nz-1?id+nx:-1].filter(n=>n>=0);}
  const queue=[];for(let id=0;id<nx*nz;id++){const x=id%nx,z=Math.floor(id/nx);if(!blocked[id]&&(x===0||x===nx-1||z===0||z===nz-1)){outside[id]=1;queue.push(id);}}
  for(let i=0;i<queue.length;i++)for(const n of neighbors(queue[i]))if(!blocked[n]&&!outside[n]){outside[n]=1;queue.push(n);}
  const mask=new Uint8Array(nx*nz);
  for(let id=0;id<mask.length;id++)if(!blocked[id]&&!outside[id]){const x=id%nx,z=Math.floor(id/nx),cx=(xs[x]+xs[x+1])/2,cz=(zs[z]+zs[z+1])/2;
    if(!covered.some(r=>containsRing(r,cx,cz)))mask[id]=1;}
  const result=[];
  for(let seed=0;seed<mask.length;seed++)if(mask[seed]){
    const cells=[seed];mask[seed]=0;let area=0,x0=Infinity,x1=-Infinity,z0=Infinity,z1=-Infinity;
    for(let i=0;i<cells.length;i++){const id=cells[i],x=id%nx,z=Math.floor(id/nx);area+=(xs[x+1]-xs[x])*(zs[z+1]-zs[z]);x0=Math.min(x0,xs[x]);x1=Math.max(x1,xs[x+1]);z0=Math.min(z0,zs[z]);z1=Math.max(z1,zs[z+1]);
      for(const n of neighbors(id))if(mask[n]){mask[n]=0;cells.push(n);}}
    if(area<100000||Math.min(x1-x0,z1-z0)<100)continue;
    const occupied=new Set(cells),edges=new Map(),vertex=(x,z)=>z*(nx+1)+x;
    for(const id of cells){const x=id%nx,z=Math.floor(id/nx),corners=[vertex(x,z),vertex(x+1,z),vertex(x+1,z+1),vertex(x,z+1)],adjacent=[z?id-nx:-1,x<nx-1?id+1:-1,z<nz-1?id+nx:-1,x?id-1:-1];
      for(let side=0;side<4;side++)if(!occupied.has(adjacent[side])){const start=corners[side];if(!edges.has(start))edges.set(start,[]);edges.get(start).push({end:corners[(side+1)%4],direction:side});}}
    const rings=[];
    while(edges.size){const start=edges.keys().next().value;let p=start,incoming=0;const ring=[];
      do{ring.push([xs[p%(nx+1)],zs[Math.floor(p/(nx+1))]]);const options=edges.get(p);
        options.sort((a,b)=>[1,0,3,2].indexOf((a.direction-incoming+4)%4)-[1,0,3,2].indexOf((b.direction-incoming+4)%4));
        const next=options.shift();if(!options.length)edges.delete(p);p=next.end;incoming=next.direction;
      }while(p!==start);
      const simple=ring.filter((p,i)=>{const a=ring[(i+ring.length-1)%ring.length],b=ring[(i+1)%ring.length];return !(a[0]===p[0]&&p[0]===b[0]||a[1]===p[1]&&p[1]===b[1]);});
      if(simple.length>=3)rings.push(simple);
    }
    const signed=r=>r.reduce((sum,p,i)=>{const q=r[(i+1)%r.length];return sum+p[0]*q[1]-q[0]*p[1];},0)/2;
    const outers=rings.filter(r=>signed(r)>0),holes=rings.filter(r=>signed(r)<0);
    const polygons=outers.map(r=>[r,...holes.filter(h=>containsRing(r,...h[0]))]);if(!polygons.length)continue;
    const key=`structural:${round(x0)}:${round(z0)}:${round(x1)}:${round(z1)}`;
    result.push({id:'room:'+key,room_key:key,polygons_mm:polygons,bottom_mm:built.height*1000,thickness_mm:100,
      color:'#f5f2ec',visible:true,role:'ceiling',emissive:false,structural:true});
  }
  return result;
}

export function ceilingLayout(doc,model=null){
  const layout=doc.ceiling_layout||{},surfaces=[...(layout.surfaces||[])];
  const scale=doc.scale_mm_per_px;if(!Number.isFinite(scale)||scale<=0)return {...layout,surfaces:[],lights:[]};
  const present=new Set(surfaces.map(s=>s.id));
  for(const r of doc.room_partition?.regions||[]){
    if(r.review_status==='rejected')continue;
    const key=r.style_key||'id:'+r.id,id='room:'+key;if(present.has(id))continue;
    const polygons=r.polygons_px||(r.rings_px?[r.rings_px]:[]);
    if(!polygons.length||polygons.some(rings=>!rings.length||rings.some(ring=>ring.length<3||ring.some(p=>p.length!==2||!p.every(Number.isFinite)))))continue;
    const opts={height_mm:doc.model_settings?.wall_height_mm??2800,thickness_mm:100,color:'#f5f2ec',visible:true,...doc.ceiling_design?.rooms?.[key]};
    surfaces.push({id,room_key:key,polygons_mm:polygons.map(rings=>rings.map(ring=>ring.map(p=>p.map(v=>v*scale)))),
      bottom_mm:opts.height_mm,thickness_mm:opts.thickness_mm,color:opts.color,visible:opts.visible,role:'ceiling',emissive:false});
  }
  const supplemental=structuralCeilings(doc,surfaces,model);surfaces.push(...supplemental);
  return {...layout,surfaces,lights:layout.lights||[],warnings:layout.warnings||[],supplementalCount:supplemental.length};
}

export function temperatureColor(k){
  const t=k/100,clamp=v=>Math.max(0,Math.min(255,v))/255;
  return new THREE.Color().setRGB(clamp(t<=66?255:329.698*Math.pow(t-60,-.1332)),
    clamp(t<=66?99.47*Math.log(t)-161.12:288.122*Math.pow(t-60,-.0755)),
    clamp(t>=66?255:t<=19?0:138.518*Math.log(t-10)-305.045),THREE.SRGBColorSpace);
}
export function ceilingShapes(doc,surface){
  const ox=doc.image.width_px*doc.scale_mm_per_px/2,oz=doc.image.height_px*doc.scale_mm_per_px/2;
  return surface.polygons_mm.map(rings=>{
    const vectors=ring=>ring.map(([x,z])=>new THREE.Vector2((x-ox)/1000,-(z-oz)/1000));
    const shape=new THREE.Shape(vectors(rings[0]));shape.holes=rings.slice(1).map(r=>new THREE.Path(vectors(r)));return shape;
  });
}
export function ceilingMeshGeometry(doc,surface){
  const geometry=new THREE.ExtrudeGeometry(ceilingShapes(doc,surface),{depth:surface.thickness_mm/1000,bevelEnabled:false,steps:1});
  geometry.rotateX(-Math.PI/2);geometry.translate(0,surface.bottom_mm/1000,0);return geometry;
}
export function ceilingCollisionParts(doc){
  const result=[];
  for(const s of ceilingLayout(doc).surfaces){
    if(s.role==='strip')continue;
    const geometry=new THREE.ShapeGeometry(ceilingShapes(doc,s)),p=geometry.attributes.position,i=geometry.index;
    for(let n=0;n<i.count;n+=3){
      const polygon=[0,1,2].map(k=>[p.getX(i.getX(n+k)),-p.getY(i.getX(n+k))]);
      const xs=polygon.map(p=>p[0]),zs=polygon.map(p=>p[1]),x0=Math.min(...xs),x1=Math.max(...xs),z0=Math.min(...zs),z1=Math.max(...zs);
      if(x1-x0<1e-8||z1-z0<1e-8)continue;
      result.push({id:s.id,kind:'ceiling',host_id:s.host_id,polygon,size:[x1-x0,s.thickness_mm/1000,z1-z0],
        center:[(x0+x1)/2,(s.bottom_mm+s.thickness_mm/2)/1000,(z0+z1)/2]});
    }
    geometry.dispose();
  }
  for(const l of doc.ceiling_layout?.lights||[])result.push(...fixtureParts(doc,l).filter(p=>p.solid));
  return result;
}
export function fixtureParts(doc,l){
  const v=l.settings,x=(l.center_mm[0]-doc.image.width_px*doc.scale_mm_per_px/2)/1000,
    z=(l.center_mm[1]-doc.image.height_px*doc.scale_mm_per_px/2)/1000,
    size=v.size_mm/1000,depth=v.depth_mm/1000,bottom=l.bottom_mm/1000,mount=l.mount_mm/1000;
  const angle=-v.rotation_deg*Math.PI/180,result=[];
  function part(component,dx,y,dz,w,h,d,color,shape='box',emissive=false,solid=true){
    result.push({id:l.id,kind:'light',host_id:l.host_id,component,center:[x+dx*Math.cos(angle)+dz*Math.sin(angle),y,z-dx*Math.sin(angle)+dz*Math.cos(angle)],
      size:[w,h,d],rotation_y:angle,color,shape,emissive,solid,intensity:v.intensity,temperature_k:v.temperature_k,on:v.on});
  }
  const round=['flush','downlight','pendant','spot'].includes(v.light_type);
  if(v.hanging_mm>0)part('suspension',0,(mount+bottom+depth)/2,0,.012,v.hanging_mm/1000,.012,'#7e8185','cylinder');
  part('body',0,bottom+depth/2,0,size,depth,['linear','track'].includes(v.light_type)?Math.min(size,.08):size,v.color,round?'cylinder':'box');
  if(v.light_type==='track'){
    for(const dx of [-size*.32,0,size*.32]){
      part('spot',dx,bottom-.035,0,.07,.07,.07,v.color,'cylinder');
      part('diffuser',dx,bottom-.071,0,.055,.004,.055,'#ffffff','cylinder',true,false);
    }
  }else part('diffuser',0,bottom-.002,0,size*.85,.004,v.light_type==='linear'?Math.min(size*.85,.055):size*.85,'#ffffff',round?'cylinder':'box',true,false);
  return result;
}
export function projectedIntersect(a,b,tolerance=.001){
  const polygon=box=>{
    if(box.polygon)return box.polygon;
    const points=Array.from({length:8},(_,bits)=>[0,2].map(j=>box.center[j]+box.axes.reduce((s,axis,i)=>s+axis[j]*box.half[i]*(bits&(1<<i)?1:-1),0))).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
    const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]),half=p=>{const out=[];for(const point of p){while(out.length>=2&&cross(out.at(-2),out.at(-1),point)<=0)out.pop();out.push(point);}out.pop();return out;};
    return [...half(points),...half([...points].reverse())];
  };
  const pa=polygon(a),pb=polygon(b);
  for(const p of [pa,pb])for(let i=0;i<p.length;i++){
    const next=p[(i+1)%p.length],dx=next[0]-p[i][0],dz=next[1]-p[i][1],len=Math.hypot(dx,dz);
    if(len<1e-10)continue;const axis=[-dz/len,dx/len],values=q=>q.map(v=>v[0]*axis[0]+v[1]*axis[1]);
    const aa=values(pa),bb=values(pb);
    if(Math.min(Math.max(...aa),Math.max(...bb))-Math.max(Math.min(...aa),Math.min(...bb))<=tolerance)return false;
  }
  return true;
}
