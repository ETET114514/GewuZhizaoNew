import {Vector3} from './vendor/three.module.min.js';
import {buildCollisionBoxes,boxCorners} from './collision-boxes.mjs';

export const EYE_HEIGHT=1.7;
const RADIUS=.18,HEAD_HEIGHT=1.85;
function hull(points){
  const sorted=points.sort((a,b)=>a[0]-b[0]||a[1]-b[1]),cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const half=list=>{const result=[];for(const p of list){while(result.length>1&&cross(result.at(-2),result.at(-1),p)<=0)result.pop();result.push(p);}return result.slice(0,-1);};
  return [...half(sorted),...half([...sorted].reverse())];
}
function nearPolygon(polygon,x,z,radius){
  let inside=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const a=polygon[j],b=polygon[i],dx=b[0]-a[0],dz=b[1]-a[1];
    if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])inside=!inside;
    const t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1)));
    if(Math.hypot(x-a[0]-t*dx,z-a[1]-t*dz)<radius)return true;
  }
  return inside;
}
export function createWalkingSpace(doc,boxes=buildCollisionBoxes(doc)){
  const width=doc.image.width_px*doc.scale_mm_per_px/1000,depth=doc.image.height_px*doc.scale_mm_per_px/1000;
  // Actual opening-aware walls, current door/window leaves, room ceilings and furniture.
  // Ceiling triangles retain holes; objects above the head or below the floor are excluded.
  const obstacles=boxes.filter(b=>b.min[1]<HEAD_HEIGHT-.001&&b.max[1]>.05).map(b=>({
    min:b.min,max:b.max,polygon:b.polygon||hull(boxCorners(b).map(p=>[p[0],p[2]]))}));
  function valid(p){return p.toArray().every(Number.isFinite)&&Math.abs(p.y-EYE_HEIGHT)<1e-6
    &&Math.abs(p.x)<=width/2-RADIUS&&Math.abs(p.z)<=depth/2-RADIUS
    &&!obstacles.some(b=>p.x>b.min[0]-RADIUS&&p.x<b.max[0]+RADIUS&&p.z>b.min[2]-RADIUS&&p.z<b.max[2]+RADIUS&&nearPolygon(b.polygon,p.x,p.z,RADIUS));}
  function move(start,delta){
    if(!valid(start))return start.clone();const result=start.clone(),steps=Math.max(1,Math.ceil(Math.hypot(delta.x,delta.z)/.04));
    for(let i=0;i<steps;i++){
      const candidate=result.clone().add(new Vector3(delta.x/steps,0,delta.z/steps));
      if(valid(candidate)){result.copy(candidate);continue;}
      const x=result.clone();x.x+=delta.x/steps;if(valid(x))result.copy(x);
      const z=result.clone();z.z+=delta.z/steps;if(valid(z))result.copy(z);
    }
    return result;
  }
  function find(preferred,allowed=()=>true){
    const p=new Vector3(preferred.x,EYE_HEIGHT,preferred.z);if(valid(p)&&allowed(p))return p;
    for(let r=.25;r<=5;r+=.25)for(let n=0;n<32;n++){
      const p=new Vector3(preferred.x+Math.cos(n*Math.PI/16)*r,EYE_HEIGHT,preferred.z+Math.sin(n*Math.PI/16)*r);
      if(valid(p)&&allowed(p))return p;
    }
    return null;
  }
  return {valid,move,find};
}
