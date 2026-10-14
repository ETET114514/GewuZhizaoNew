import {buildModel} from './model-geometry.mjs';
import {furnitureSettings} from './furniture-models.mjs';
import {ceilingCollisionParts,projectedIntersect} from './ceiling-geometry.mjs';

// Scene metres, matching model-geometry. Touching faces are allowed; a 1 mm
// tolerance absorbs numerical noise without replacing the actual oriented box.
const dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0);
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const identity=[0,0,0,1];
const componentId=id=>id?.startsWith('room:')?id:id?.split(':')[0];
function axesOf(q){
  const length=Math.hypot(...q),[x,y,z,w]=q.map(v=>v/length);
  return [[1-2*(y*y+z*z),2*(x*y+z*w),2*(x*z-y*w)],
    [2*(x*y-z*w),1-2*(x*x+z*z),2*(y*z+x*w)],
    [2*(x*z+y*w),2*(y*z-x*w),1-2*(x*x+y*y)]];
}
export function collisionBox(part){
  const q=part.quaternion??(part.rotation_y?[0,Math.sin(part.rotation_y/2),0,Math.cos(part.rotation_y/2)]:identity);
  const axes=axesOf(q),half=part.size.map(v=>v/2);
  const radius=[0,1,2].map(i=>axes.reduce((r,a,j)=>r+Math.abs(a[i])*half[j],0));
  return {...part,quaternion:[...q],axes,half,min:part.center.map((v,i)=>v-radius[i]),max:part.center.map((v,i)=>v+radius[i])};
}
export function boxesIntersect(a,b,tolerance=.001){
  if([0,1,2].some(i=>Math.min(a.max[i],b.max[i])-Math.max(a.min[i],b.min[i])<=tolerance))return false;
  if((a.polygon||b.polygon)&&!projectedIntersect(a,b,tolerance))return false;
  const delta=sub(b.center,a.center);
  // SAT: 3 face normals per box and 9 cross-products. Normalize cross axes
  // so the contact tolerance remains a physical distance at any angle.
  for(const vector of [...a.axes,...b.axes,...a.axes.flatMap(x=>b.axes.map(y=>cross(x,y)))]){
    const length=Math.hypot(...vector);if(length<1e-8)continue;
    const axis=vector.map(v=>v/length);
    const radius=box=>box.axes.reduce((sum,v,i)=>sum+Math.abs(dot(v,axis))*box.half[i],0);
    if(radius(a)+radius(b)-Math.abs(dot(delta,axis))<=tolerance)return false;
  }
  return true;
}
export function boxCorners(box){
  return Array.from({length:8},(_,bits)=>box.center.map((v,j)=>v+box.axes.reduce((s,a,i)=>s+a[j]*box.half[i]*(bits&(1<<i)?1:-1),0)));
}
export function furnitureCollisionBox(doc,item){
  const settings=furnitureSettings(item),scale=doc.scale_mm_per_px/1000,b=item.bbox_px;
  if(!settings||item.review_status==='rejected'||!b?.every(Number.isFinite)||!Number.isFinite(scale)||scale<=0)return null;
  const size=[(b[2]-b[0])*scale,settings.height_mm/1000,(b[3]-b[1])*scale];
  if(size.some(v=>!Number.isFinite(v)||v<=0))return null;
  return collisionBox({id:item.id,kind:'furniture',furnitureKind:item.kind,size,
    center:[((b[0]+b[2]-doc.image.width_px)/2)*scale,(settings.elevation_mm+settings.height_mm/2)/1000,((b[1]+b[3]-doc.image.height_px)/2)*scale],
    rotation_y:-(settings.rotation_deg||0)*Math.PI/180});
}
const structureCache=new WeakMap();
export function buildCollisionBoxes(doc){
  if(!Number.isFinite(doc?.scale_mm_per_px)||doc.scale_mm_per_px<=0)return [];
  let structure=structureCache.get(doc);
  if(!structure){
    const model=buildModel({...doc,model_settings:{...doc.model_settings,show_furniture:false}},{buildMeshes:false});
    structure=model.boxes.filter(b=>b.kind==='wall'||b.kind==='door'||b.kind==='glass'||
      b.kind==='frame'&&(b.quaternion||b.rotation_y!==undefined)).map(b=>collisionBox({...b,kind:b.kind==='wall'?'wall':b.kind==='door'?'door':'window'}));
    structure.push(...ceilingCollisionParts(doc).map(collisionBox));
    structureCache.set(doc,structure);
  }
  return [...structure,...(doc.furniture||[]).map(f=>furnitureCollisionBox(doc,f)).filter(Boolean)];
}
function embeddedPair(a,b){
  const cabinet=a.furnitureKind==='kitchen_cabinet'?a:b.furnitureKind==='kitchen_cabinet'?b:null;
  const fixture=cabinet===a?b:a;
  return cabinet&&['kitchen_sink','cooktop'].includes(fixture.furnitureKind)&&
    boxCorners(fixture).every(p=>[0,2].every(i=>Math.abs(dot(sub(p,cabinet.center),cabinet.axes[i]))<=cabinet.half[i]+.001));
}
export function checkCollisions(doc,{replacement=null,additional=null}={}){
  let boxes=buildCollisionBoxes(doc);
  if(replacement){boxes=boxes.filter(b=>b.id!==replacement.id);const box=furnitureCollisionBox(doc,replacement);if(box)boxes.push(box);}
  if(additional){const box=furnitureCollisionBox(doc,additional);if(box)boxes.push(box);}
  const pairs=new Map(),conflictingIds=new Set();
  for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
    const a=boxes[i],b=boxes[j];
    if(a.id===b.id||a.kind==='wall'&&b.kind==='wall'||a.kind==='ceiling'&&b.kind==='ceiling'&&
      (componentId(a.id)===componentId(b.id)||componentId(a.host_id)===componentId(b.id)||componentId(b.host_id)===componentId(a.id))||
      a.host_id===b.id||b.host_id===a.id||embeddedPair(a,b)||!boxesIntersect(a,b))continue;
    const key=[a.id,b.id].sort().join('\0');
    if(!pairs.has(key))pairs.set(key,{ids:[a.id,b.id],kinds:[a.kind,b.kind]});
    conflictingIds.add(a.id);conflictingIds.add(b.id);
  }
  return {boxes,pairs:[...pairs.values()],conflictingIds};
}
export function collisionMessage(result,id=null){
  const pairs=id?result.pairs.filter(p=>p.ids.includes(id)):result.pairs;
  return pairs.length?`${pairs.length} 处碰撞 · ${pairs.slice(0,4).map(p=>p.ids.join(' ↔ ')).join('；')}${pairs.length>4?'…':''} · 可继续摆放`:'未发现碰撞';
}
export function boxFootprint(doc,box){
  const scale=doc.scale_mm_per_px/1000;
  const points=boxCorners(box).map(p=>[p[0]/scale+doc.image.width_px/2,p[2]/scale+doc.image.height_px/2]);
  const sorted=points.sort((a,b)=>a[0]-b[0]||a[1]-b[1]).filter((p,i,a)=>!i||Math.hypot(p[0]-a[i-1][0],p[1]-a[i-1][1])>1e-7);
  const turn=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const half=list=>{const hull=[];for(const p of list){while(hull.length>1&&turn(hull.at(-2),hull.at(-1),p)<=0)hull.pop();hull.push(p);}return hull.slice(0,-1);};
  return [...half(sorted),...half([...sorted].reverse())];
}
