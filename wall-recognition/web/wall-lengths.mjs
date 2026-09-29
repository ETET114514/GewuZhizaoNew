// Display-only axis dimensions. Source walls and opening geometry are never edited.
const EPS=1e-5;
const point=(axis,along,across)=>axis===0?[along,across]:[across,along];

export function wallDimensions(doc,{splitCorners=true}={}) {
  const scale=doc?.scale_mm_per_px;
  if(typeof scale!=='number'||!Number.isFinite(scale)||scale<=0)return [];
  const source=(doc.walls||[]).filter(w=>w.review_status!=='rejected').map(w=>{
    const axis=w.orientation==='horizontal'?0:w.orientation==='vertical'?1:null;
    if(axis===null||!w.start_px||!w.end_px)return null;
    const a=Math.min(w.start_px[axis],w.end_px[axis]),b=Math.max(w.start_px[axis],w.end_px[axis]),c=w.start_px[1-axis];
    if(![a,b,c,w.thickness_px].every(Number.isFinite)||w.thickness_px<=0||b-a<=EPS||Math.abs(c-w.end_px[1-axis])>EPS)return null;
    return {axis,a,b,c,thickness:w.thickness_px,wall:w};
  }).filter(Boolean).sort((a,b)=>a.axis-b.axis||a.c-b.c||a.a-b.a||a.b-b.b);
  const runs=[];
  for(const segment of source){
    const last=runs.at(-1);
    if(last&&last.axis===segment.axis&&last.c===segment.c&&segment.a<=last.b+EPS){
      last.b=Math.max(last.b,segment.b);last.thickness=Math.max(last.thickness,segment.thickness);last.members.push(segment.wall);
    }else runs.push({...segment,members:[segment.wall]});
  }
  // Opening-only connectors can join a real wall run, but cannot fabricate a standalone wall.
  const active=runs.filter(r=>r.members.some(w=>(w.solid_parts??[w]).length));
  const result=[];
  for(const run of active){
    const cuts=[run.a,run.b];
    if(splitCorners)for(const other of active){
      if(run.axis===other.axis||other.c<=run.a+EPS||other.c>=run.b-EPS)continue;
      // A perpendicular end touching the wall face counts as a junction. Gaps do not.
      const supported=other.members.some(w=>(w.solid_parts??[w]).some(p=>{
        const a=Math.min(p.start_px[other.axis],p.end_px[other.axis]);
        const b=Math.max(p.start_px[other.axis],p.end_px[other.axis]);
        return run.c>=a-run.thickness/2-EPS&&run.c<=b+run.thickness/2+EPS;
      }));
      const hostSolid=run.members.some(w=>(w.solid_parts??[w]).some(p=>{
        const a=Math.min(p.start_px[run.axis],p.end_px[run.axis]),b=Math.max(p.start_px[run.axis],p.end_px[run.axis]);
        return other.c>=a-other.thickness/2-EPS&&other.c<=b+other.thickness/2+EPS;
      }));
      if(supported&&hostSolid)cuts.push(other.c);
    }
    const ordered=cuts.sort((a,b)=>a-b).filter((v,i,a)=>!i||v-a[i-1]>EPS);
    for(let i=1;i<ordered.length;i++){
      const a=ordered[i-1],b=ordered[i];
      result.push({axis:run.axis,start_px:point(run.axis,a,run.c),end_px:point(run.axis,b,run.c),
        thickness_px:run.thickness,length_mm:(b-a)*scale,
        wall_ids:run.members.filter(w=>Math.max(w.start_px[run.axis],w.end_px[run.axis])>a+EPS&&Math.min(w.start_px[run.axis],w.end_px[run.axis])<b-EPS).map(w=>w.id)});
    }
  }
  return result;
}

export function formatWallLength(mm){
  if(mm<1)return '<0.001 m';
  return `${Number((mm/1000).toFixed(3))} m`;
}
