// Display-only trimming and corner completion at perpendicular wall joins.
// Source coordinates, opening spans and the 2D document remain unchanged.
import {apertureFrame} from './opening-operation.mjs';

// A thin detected return at the end of an exterior window can be its inner
// frame line, not a full-height partition. Align it with the window jamb when
// a much longer, thicker parallel main wall supplies the actual corner.
export function alignWindowReturns(walls, openings, rawOpenings=[]) {
  const replacements=new Map(),removed=new Set(),adjustments=[];
  for(const opening of openings){
    if(opening.kind!=='window'||!opening.exteriorFrame)continue;
    const axis=opening.axis,cross=1-axis;
    const hosts=walls.filter(w=>opening.hosts.includes(w.id));
    for(const end of ['start','end']){
      const start=end==='start',tip=start?opening.a:opening.b,sign=start?-1:1;
      for(const id of opening.supportIds||[]){
        const arm=walls.find(w=>w.id===id);
        if(!arm||arm.orientation===(axis===0?'horizontal':'vertical')||arm.source!=='automatic'||arm.review_status==='confirmed'||arm.opening_hints?.length)continue;
        const armCenter=arm.start_px[axis],armHalf=arm.thickness_px/2;
        if(Math.abs(armCenter-sign*armHalf-tip)>1||sign*(armCenter-tip)<=0)continue;
        const armLength=arm.end_px[cross]-arm.start_px[cross];
        const candidates=walls.filter(main=>main!==arm&&main.orientation===arm.orientation&&main.review_status!=='rejected'&&
          main.thickness_px>=arm.thickness_px*1.5&&main.end_px[cross]-main.start_px[cross]>=armLength*3&&armLength<=main.thickness_px*6&&
          Math.min(Math.abs(main.start_px[cross]-opening.center),Math.abs(main.end_px[cross]-opening.center))<=opening.thickness/2+1&&
          main.start_px[cross]<=opening.center+opening.thickness/2+1&&main.end_px[cross]>=opening.center-opening.thickness/2-1&&
          sign*(main.start_px[axis]-armCenter)>0&&
          sign*(main.start_px[axis]-sign*main.thickness_px/2-tip)>0&&
          Math.abs(main.start_px[axis]-sign*main.thickness_px/2-tip)<=main.thickness_px*2);
        const main=candidates.sort((a,b)=>Math.abs(a.start_px[axis]-tip)-Math.abs(b.start_px[axis]-tip))[0];
        if(!main)continue;
        const boundary=main.start_px[axis]-sign*main.thickness_px/2;
        const lo=Math.min(tip,boundary),hi=Math.max(tip,boundary);
        // Never extend across a separate door/window or an unresolved boundary.
        if(openings.some(o=>o!==opening&&o.axis===axis&&Math.abs(o.center-opening.center)<=Math.max(o.thickness,opening.thickness)/2&&o.a<hi&&o.b>lo))continue;
        if(rawOpenings.some(o=>o.id!==opening.id&&o.review_status!=='rejected'&&o.orientation===(axis===0?'horizontal':'vertical')&&
          Math.abs(o.start_px[cross]-opening.center)<=Math.max(o.thickness_px,opening.thickness)/2&&o.start_px[axis]<hi&&o.end_px[axis]>lo))continue;
        if(walls.some(w=>w.orientation===(axis===0?'horizontal':'vertical')&&Math.abs(w.start_px[cross]-opening.center)<=Math.max(w.thickness_px,opening.thickness)/2&&
          (w.opening_hints||[]).some(h=>!h.opening_ids?.includes(opening.id)&&h.start_px[axis]<hi&&h.end_px[axis]>lo)))continue;
        const host=hosts.find(w=>Math.abs((start?w.start_px[axis]:w.end_px[axis])-tip)<1e-6&&w.source==='automatic_opening_connection');
        if(!host)continue;
        const updated=structuredClone(replacements.get(host.id)||host);
        (start?updated.start_px:updated.end_px)[axis]=boundary;
        replacements.set(host.id,updated);removed.add(arm.id);
        adjustments.push({id:arm.id,host:host.id,end,from:tip,to:boundary,receiver:main.id});
      }
    }
  }
  return {walls:walls.filter(w=>!removed.has(w.id)).map(w=>replacements.get(w.id)||w),adjustments};
}

export function flushWallJoints(walls, openings, scale) {
  const epsilon=1e-6;
  const spans=walls.map(w=>{
    const axis=w.orientation==='horizontal'?0:1;
    const a=w.start_px[axis],b=w.end_px[axis],center=w.start_px[1-axis],half=w.thickness_px/2;
    const hosted=openings.filter(o=>o.hosts.includes(w.id));
    const holes=hosted.map(o=>[Math.max(a,o.a),Math.min(b,o.b)]);
    for(const hint of w.opening_hints||[]){
      if(hint.opening_ids?.some(id=>openings.some(o=>o.id===id)))continue;
      holes.push([Math.max(a,hint.start_px[axis]),Math.min(b,hint.end_px[axis])]);
    }
    const validHoles=holes.filter(([lo,hi])=>hi>lo);
    const cuts=[...new Set([a,b,...validHoles.flat()])].sort((x,y)=>x-y),solid=[];
    for(let i=1;i<cuts.length;i++){
      const mid=(cuts[i-1]+cuts[i])/2;
      if(!validHoles.some(([lo,hi])=>lo<mid&&hi>mid))solid.push([cuts[i-1],cuts[i]]);
    }
    // Aperture end frames support a corner join; the glass/door interior does not.
    // Use the same clipped spans and physical frame widths as the rendered model.
    for(const opening of hosted)for(const [lo,hi] of opening.spans){
      const frame=apertureFrame(opening.kind,hi-lo,scale).frame;
      for(const [left,right] of [[lo,lo+frame],[hi-frame,hi]]){
        const start=Math.max(a,left),end=Math.min(b,right);
        if(end>start+epsilon)solid.push([start,end]);
      }
    }
    return {id:w.id,axis,a,b,center,half,holes:validHoles,solid};
  });
  const adjustments=[];
  const result=new Map();
  for(const wall of spans){
    let {a,b}=wall;
    for(const end of ['start','end']){
      const start=end==='start',tip=start?wall.a:wall.b;
      // A split in an ongoing wall is not a terminal end.
      if(spans.some(other=>other!==wall&&other.axis===wall.axis&&Math.abs(other.center-wall.center)<epsilon&&
        (start?other.a<tip-epsilon&&other.b>=tip-epsilon:other.b>tip+epsilon&&other.a<=tip+epsilon)))continue;
      const candidates=[];
      for(const other of spans){
        if(other.axis===wall.axis)continue;
        const boundary=other.center+(start?-other.half:other.half);
        const excess=start?boundary-tip:tip-boundary;
        // A narrow return can overhang a thicker receiving wall by more than its
        // own thickness. Use the receiving wall's face as the local allowance.
        if(excess<=epsilon||excess>2*Math.max(wall.half,other.half)+epsilon)continue;
        if(start?other.center>=wall.b-wall.half:other.center<=wall.a+wall.half)continue;
        if(!other.solid.some(([lo,hi])=>lo<=wall.center+wall.half+epsilon&&hi>=wall.center-wall.half-epsilon))continue;
        const lo=Math.min(tip,boundary),hi=Math.max(tip,boundary);
        if(wall.holes.some(([hlo,hhi])=>hlo<hi-epsilon&&hhi>lo+epsilon))continue;
        candidates.push({boundary,excess,receiver:other.id});
      }
      const candidate=candidates.sort((x,y)=>x.excess-y.excess)[0];
      if(!candidate)continue;
      const nextA=start?candidate.boundary:a,nextB=start?b:candidate.boundary;
      if(nextB-nextA<2*wall.half-epsilon)continue;
      a=nextA;b=nextB;
      adjustments.push({id:wall.id,end,from:tip,to:candidate.boundary,receiver:candidate.receiver});
    }
    result.set(wall.id,{a,b});
  }
  return {spans:result,adjustments};
}

// Complete the thickness-band intersection of walls that already touch. A
// butt-ended L join otherwise leaves an exposed notch at the outer corner.
// Subtract existing masonry and every aperture volume before adding material;
// in particular, window sills/headers must not become full-height corner posts.
export function fillWallCorners(walls, spans, openings, height) {
  const epsilon=1e-6,patches=[];
  const rects=walls.map(w=>{
    const axis=w.orientation==='horizontal'?0:1;
    const {a,b}=spans.get(w.id)||{a:w.start_px[axis],b:w.end_px[axis]};
    const center=w.start_px[1-axis],half=w.thickness_px/2;
    return {id:w.id,axis,a,b,center,half,
      x0:axis===0?a:center-half,x1:axis===0?b:center+half,
      z0:axis===0?center-half:a,z1:axis===0?center+half:b,bottom:0,top:height};
  });
  const voids=[];
  for(const w of walls){
    const axis=w.orientation==='horizontal'?0:1,center=w.start_px[1-axis],half=w.thickness_px/2;
    const add=(a,b,bottom,top)=>voids.push(axis===0?
      {id:w.id,x0:a,x1:b,z0:center-half,z1:center+half,bottom,top}:
      {id:w.id,x0:center-half,x1:center+half,z0:a,z1:b,bottom,top});
    for(const o of openings.filter(o=>o.hosts.includes(w.id)))for(const [a,b] of o.spans)add(a,b,o.bottom,o.top);
    for(const hint of w.opening_hints||[]){
      if(hint.opening_ids?.some(id=>openings.some(o=>o.id===id)))continue;
      add(hint.start_px[axis],hint.end_px[axis],0,height);
    }
  }
  const overlaps=(a,b)=>a.x0<b.x1-epsilon&&a.x1>b.x0+epsilon&&a.z0<b.z1-epsilon&&a.z1>b.z0+epsilon;
  const contains=(r,x,z,y)=>x>r.x0-epsilon&&x<r.x1+epsilon&&z>r.z0-epsilon&&z<r.z1+epsilon&&y>r.bottom-epsilon&&y<r.top+epsilon;
  const cuts=(lo,hi,items,key0,key1)=>[...new Set([lo,hi,...items.flatMap(r=>[r[key0],r[key1]]).filter(v=>v>lo+epsilon&&v<hi-epsilon)])].sort((a,b)=>a-b);
  for(const h of rects.filter(r=>r.axis===0))for(const v of rects.filter(r=>r.axis===1)){
    // No tolerance that could connect a real gap, even a subpixel one.
    if(h.x1<v.x0-epsilon||h.x0>v.x1+epsilon||v.z1<h.z0-epsilon||v.z0>h.z1+epsilon)continue;
    const join={x0:v.x0,x1:v.x1,z0:h.z0,z1:h.z1};
    const nearby=rects.filter(r=>overlaps(r,join)),holes=voids.filter(r=>overlaps(r,join));
    const previous=patches.filter(r=>overlaps(r,join)),bounds=[...nearby,...holes,...previous];
    const xs=cuts(join.x0,join.x1,bounds,'x0','x1'),zs=cuts(join.z0,join.z1,bounds,'z0','z1');
    const ys=cuts(0,height,[...holes,...previous],'bottom','top');
    for(let i=1;i<xs.length;i++)for(let j=1;j<zs.length;j++)for(let k=1;k<ys.length;k++){
      const x=(xs[i-1]+xs[i])/2,z=(zs[j-1]+zs[j])/2,y=(ys[k-1]+ys[k])/2;
      // Two apertures meeting at a corner need continuous glazing, not a new
      // masonry post just beyond the original butt-ended window spans.
      if([h,v].every(w=>holes.some(r=>r.id===w.id&&y>r.bottom-epsilon&&y<r.top+epsilon)))continue;
      if(nearby.some(r=>contains(r,x,z,y))||holes.some(r=>contains(r,x,z,y))||previous.some(r=>contains(r,x,z,y)))continue;
      patches.push({id:h.id,wallIds:[h.id,v.id],x0:xs[i-1],x1:xs[i],z0:zs[j-1],z1:zs[j],bottom:ys[k-1],top:ys[k]});
    }
  }
  return patches;
}

// Boundary of the union of axis-aligned masonry boxes. Coordinate compression
// keeps the exact wall/opening faces without sampling or filling real gaps.
export function unionWallBoxes(boxes) {
  const walls=boxes.filter(b=>b.kind==='wall');
  const mesh={positions:[],normals:[],indices:[],sourceIds:[...new Set(walls.map(b=>b.id))],boxCount:walls.length};
  if(!walls.length)return mesh;
  const rects=walls.map(b=>({lo:b.center.map((v,i)=>v-b.size[i]/2),hi:b.center.map((v,i)=>v+b.size[i]/2)}));
  // Only coalesce roundoff from converting the same pixel face to metres.
  const axes=[0,1,2].map(axis=>{
    const values=rects.flatMap(r=>[r.lo[axis],r.hi[axis]]).sort((a,b)=>a-b),unique=[];
    for(const v of values)if(!unique.length||v-unique.at(-1)>1e-10)unique.push(v);
    return unique;
  });
  const [nx,ny,nz]=axes.map(a=>a.length-1),cells=new Uint8Array(nx*ny*nz);
  const index=(x,y,z)=>(y*nz+z)*nx+x;
  const coordinate=(axis,v)=>{
    const values=axes[axis];let lo=0,hi=values.length;
    while(lo<hi){const mid=(lo+hi)>>1;if(values[mid]<v-1e-10)lo=mid+1;else hi=mid;}
    return lo;
  };
  for(const r of rects){
    const lo=r.lo.map((v,i)=>coordinate(i,v)),hi=r.hi.map((v,i)=>coordinate(i,v));
    for(let y=lo[1];y<hi[1];y++)for(let z=lo[2];z<hi[2];z++)cells.fill(1,index(lo[0],y,z),index(hi[0],y,z));
  }
  const occupied=(x,y,z)=>x>=0&&x<nx&&y>=0&&y<ny&&z>=0&&z<nz&&cells[index(x,y,z)]===1;
  const vertices=new Map();
  const vertex=(p,axis,sign)=>{
    // Shared vertices within a planar face, separate normals at sharp corners.
    const key=`${p.join(',')}:${axis}:${sign}`;let id=vertices.get(key);
    if(id===undefined){id=mesh.positions.length/3;vertices.set(key,id);mesh.positions.push(...p.map((v,i)=>axes[i][v]));mesh.normals.push(...[0,1,2].map(i=>i===axis?sign:0));}
    return id;
  };
  for(let y=0;y<ny;y++)for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){
    if(!occupied(x,y,z))continue;
    const cell=[x,y,z];
    for(let axis=0;axis<3;axis++)for(const sign of [-1,1]){
      const next=[...cell];next[axis]+=sign;if(occupied(...next))continue;
      const u=(axis+1)%3,v=(axis+2)%3,p=[...cell];if(sign>0)p[axis]++;
      const corners=[[...p],[...p],[...p],[...p]];
      corners[1][u]++;corners[2][u]++;corners[2][v]++;corners[3][v]++;
      const ids=corners.map(p=>vertex(p,axis,sign));
      if(sign>0)mesh.indices.push(ids[0],ids[1],ids[2],ids[0],ids[2],ids[3]);
      else mesh.indices.push(ids[0],ids[2],ids[1],ids[0],ids[3],ids[2]);
    }
  }
  return mesh;
}
