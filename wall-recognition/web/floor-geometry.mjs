import * as THREE from './vendor/three.module.min.js';

export function buildFloors(doc) {
  const unit=doc.scale_mm_per_px/1000;
  if(!Number.isFinite(unit)||unit<=0)return [];
  const W=doc.image.width_px,H=doc.image.height_px;
  return (doc.room_partition?.regions||[]).filter(r=>r.review_status!=='rejected').map(r=>({
    id:r.id,name:r.name||r.id,
    settings:{material:'solid',color:'#e5d7be',width_mm:600,length_mm:600,angle_deg:0,...r.floor},
    polygons:(r.polygons_px||[r.rings_px]).map(rings=>rings.map(ring=>ring.map(([x,y])=>[(x-W/2)*unit,(y-H/2)*unit])))
  }));
}

export function floorGeometry(polygons, settings) {
  const shapes=polygons.map(rings=>{
    const vectors=ring=>ring.map(([x,z])=>new THREE.Vector2(x,-z));
    const shape=new THREE.Shape(vectors(rings[0]));
    shape.holes=rings.slice(1).map(ring=>new THREE.Path(vectors(ring)));return shape;
  });
  const geometry=new THREE.ShapeGeometry(shapes),position=geometry.getAttribute('position'),uv=geometry.getAttribute('uv');
  const angle=settings.angle_deg*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
  for(let i=0;i<position.count;i++){
    const x=position.getX(i),z=-position.getY(i);
    uv.setXY(i,(x*c+z*s)/(settings.width_mm/1000),(-x*s+z*c)/(settings.length_mm/1000));
  }
  uv.needsUpdate=true;geometry.rotateX(-Math.PI/2);return geometry;
}

export function floorTexture(settings) {
  if(settings.material==='solid')return null;
  const canvas=document.createElement('canvas');canvas.width=256;canvas.height=settings.material==='wood'?1024:256;
  const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;
  ctx.fillStyle=settings.color;ctx.fillRect(0,0,w,h);
  if(settings.material==='wood'){
    // Deterministic procedural wood grain, repeated at the chosen board dimensions.
    let seed=173;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
    for(let i=0;i<190;i++){
      const x=random()*w,phase=random()*6.28;ctx.strokeStyle=`rgba(65,35,12,${.035+random()*.08})`;
      ctx.lineWidth=.4+random()*1.3;ctx.beginPath();
      for(let y=0;y<=h;y+=16){const xx=x+Math.sin(y/h*6.28+phase)*(2+Math.sin(y/h*3.14)*4);if(!y)ctx.moveTo(xx,y);else ctx.lineTo(xx,y);}ctx.stroke();
    }
  }
  ctx.strokeStyle=settings.material==='tile'?'rgba(90,86,79,.38)':'rgba(64,38,21,.45)';
  ctx.lineWidth=settings.material==='tile'?2:1.5;ctx.strokeRect(0,0,w,h);
  const texture=new THREE.CanvasTexture(canvas);texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
  texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;return texture;
}
