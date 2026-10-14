// Legacy explicit sides remain readable; new auto directions use room context.
export function operationOf(o,values=o.operation??{}) {
  if(!values||typeof values!=='object'||Array.isArray(values)||Object.keys(values).some(k=>!['type','hinge','side','angle_deg','pivot_axis','pivot_ratio','direction_mode','interior_room_id','axis_mode'].includes(k)))throw new Error('门窗开启参数格式不正确。');
  const op={type:'hinged',hinge:'start',side:'negative',angle_deg:0,...values};
  if(!['fixed','hinged'].includes(op.type)||o.kind==='door'&&op.type!=='hinged')throw new Error('门支持单扇平开；窗支持固定玻璃或单扇平开。');
  const axis=op.pivot_axis||'vertical';
  if(!['vertical','horizontal'].includes(axis)||o.kind==='door'&&axis!=='vertical')throw new Error('门使用左右竖轴；窗支持侧开竖轴或上下横轴。');
  if(!(axis==='vertical'?['start','end']:['top','bottom']).includes(op.hinge)||!['negative','positive'].includes(op.side))throw new Error('请选择有效的铰链端和开启侧。');
  if(op.pivot_ratio!==undefined&&(!Number.isFinite(op.pivot_ratio)||op.pivot_ratio<0||op.pivot_ratio>1))throw new Error('转轴位置需在 0～100% 之间。');
  if(op.axis_mode!==undefined&&(o.kind!=='window'||!['width','manual'].includes(op.axis_mode)))throw new Error('窗转轴预设需选择按宽度或手动。');
  if(!['auto','manual'].includes(op.direction_mode||'manual'))throw new Error('请选择自动内外判断或手动开启侧。');
  if(op.interior_room_id!==undefined&&(typeof op.interior_room_id!=='string'||op.interior_room_id.length>100))throw new Error('归属房间编号不正确。');
  if(!Number.isFinite(op.angle_deg)||op.angle_deg<0||op.angle_deg>90)throw new Error('开启角度需在 0～90° 之间。');
  if(op.type==='fixed'&&op.angle_deg!==0)throw new Error('固定玻璃的开启角度需为 0。');
  return op;
}
export const WINDOW_FLIP_THRESHOLD_MM=1800;
export function windowWidthMm(doc,o){
  const s=doc.model_settings||{},axis=o.orientation==='horizontal'?0:1;
  const width=o.dimensions_mm?.width_mm??(s.width_mode==='preset'?(s.window_width_mm??800):Number.isFinite(doc.scale_mm_per_px)&&doc.scale_mm_per_px>0?Math.abs(o.end_px[axis]-o.start_px[axis])*doc.scale_mm_per_px:null);
  return Number.isFinite(width)&&width>0?width:null;
}
export function applyWindowPreset(doc,o,values=operationOf(o)){
  if(o.kind!=='window'||values.type==='fixed')return values;
  const mode=values.axis_mode??'manual';
  if(mode==='manual')return values;
  const wide=(windowWidthMm(doc,o)??0)>=WINDOW_FLIP_THRESHOLD_MM;
  return {...values,axis_mode:'width',pivot_axis:wide?'horizontal':'vertical',hinge:wide?'top':'start',pivot_ratio:wide?1:0};
}
export function resolveOperation(o,values,context,allowUnresolved=false){
  const op=operationOf(o,values);
  if(op.direction_mode!=='auto'||op.type==='fixed')return op;
  if(!context){if(allowUnresolved&&!op.interior_room_id)return op;throw new Error('正在判断房间内外，请稍后。');}
  let inside=context.interior_side;
  if(op.interior_room_id){
    const sides=['negative','positive'].filter(s=>context[s].some(r=>r.id===op.interior_room_id));
    if(sides.length!==1)throw new Error('归属房间不在单一邻侧，请重新选择房间或手动开启侧。');
    inside=sides[0];
  }
  if(!inside){if(allowUnresolved&&!op.interior_room_id)return op;throw new Error(context.reason);}
  return {...op,side:o.kind==='door'?inside:inside==='negative'?'positive':'negative'};
}
export const pivotRatio=op=>op.pivot_ratio??(['end','top'].includes(op.hinge)?1:0);
export function apertureFrame(kind,width,scale){
  const scaled=Number.isFinite(scale)&&scale>0;
  const frame=Math.min(scaled?(kind==='door'?50:40)/scale:0,width/8);
  const clear=width-2*frame,reveal=kind==='door'?0:Math.min(scaled?3/scale:0,clear/20);
  return {frame,reveal,available:clear-2*reveal};
}

// Stationary corner frames own the intersection of two aperture depth bands.
// Sash clear bounds use the same layout in the 2D symbol and the 3D model.
export function windowCornerConnections(doc,normalized){
  const scale=doc.scale_mm_per_px,s=doc.model_settings||{},walls=(doc.walls||[]).filter(w=>w.review_status!=='rejected');
  if(!Number.isFinite(scale)||scale<=0)return [];
  const all=normalized??(doc.openings||[]).filter(o=>o.review_status!=='rejected'&&['door','window'].includes(o.kind)&&(!o.requires_confirmation||o.review_status==='confirmed')).flatMap(o=>{
    const axis=o.orientation==='horizontal'?0:1,mid=(o.start_px[axis]+o.end_px[axis])/2;
    const width=o.dimensions_mm?.width_mm/scale||(s.width_mode==='preset'?(o.kind==='door'?(s.opening_width_mm??900):(s.window_width_mm??800))/scale:o.end_px[axis]-o.start_px[axis]);
    const a=mid-width/2,b=mid+width/2;
    const hosts=walls.filter(w=>(w.orientation==='horizontal'?0:1)===axis&&Math.abs(w.start_px[1-axis]-o.start_px[1-axis])<=Math.min(w.thickness_px,o.thickness_px)/2+1&&Math.max(a,w.start_px[axis])<Math.min(b,w.end_px[axis]));
    if(!hosts.length)return [];
    const host=hosts.reduce((best,w)=>w.thickness_px>best.thickness_px?w:best),spans=[];
    for(const [lo,hi] of hosts.map(w=>[Math.max(a,w.start_px[axis]),Math.min(b,w.end_px[axis])]).sort((x,y)=>x[0]-y[0])){
      const last=spans.at(-1);if(last&&lo<=last[1]+.01)last[1]=Math.max(last[1],hi);else spans.push([lo,hi]);
    }
    const bottom=o.kind==='window'?(o.dimensions_mm?.sill_height_mm??s.sill_height_mm??900)/1000:0;
    return [{id:o.id,kind:o.kind,axis,a,b,spans,center:host.start_px[1-axis],thickness:host.thickness_px,hosts:hosts.map(w=>w.id),bottom,
      top:bottom+(o.dimensions_mm?.height_mm??(o.kind==='window'?(s.window_height_mm??1500):(s.door_height_mm??2100)))/1000}];
  });
  const eps=1e-6,joins=[];
  const rect=o=>o.axis===0?{x0:o.spans[0][0],x1:o.spans[0][1],z0:o.center-o.thickness/2,z1:o.center+o.thickness/2}:
    {x0:o.center-o.thickness/2,x1:o.center+o.thickness/2,z0:o.spans[0][0],z1:o.spans[0][1]};
  const overlap=(a,b)=>a.x0<b.x1-eps&&a.x1>b.x0+eps&&a.z0<b.z1-eps&&a.z1>b.z0+eps;
  function blocked(join,h,v){
    if((doc.openings||[]).some(o=>o.id!==h.id&&o.id!==v.id&&o.review_status!=='rejected'&&(o.requires_confirmation&&o.review_status!=='confirmed'||!['door','window'].includes(o.kind))&&
      overlap(rect({axis:o.orientation==='horizontal'?0:1,spans:[[o.start_px[o.orientation==='horizontal'?0:1],o.end_px[o.orientation==='horizontal'?0:1]]],center:o.start_px[o.orientation==='horizontal'?1:0],thickness:o.thickness_px}),join)))return true;
    if(all.some(o=>o!==h&&o!==v&&o.spans.length===1&&overlap(rect(o),join)&&o.bottom<h.top-eps&&o.top>h.bottom+eps))return true;
    for(const w of walls){
      const axis=w.orientation==='horizontal'?0:1,c=w.start_px[1-axis],half=w.thickness_px/2;
      const r=axis===0?{x0:w.start_px[0],x1:w.end_px[0],z0:c-half,z1:c+half}:{x0:c-half,x1:c+half,z0:w.start_px[1],z1:w.end_px[1]};
      if(!overlap(r,join))continue;
      const lo=Math.max(axis===0?r.x0:r.z0,axis===0?join.x0:join.z0),hi=Math.min(axis===0?r.x1:r.z1,axis===0?join.x1:join.z1);
      const hosted=all.filter(o=>o.hosts.includes(w.id));
      if((w.opening_hints||[]).some(hint=>!hint.opening_ids?.some(id=>hosted.some(o=>o.id===id))&&hint.start_px[axis]<hi-eps&&hint.end_px[axis]>lo+eps))return true;
      const xs=[...new Set([lo,hi,...hosted.flatMap(o=>[o.a,o.b]).filter(x=>x>lo&&x<hi)])].sort((a,b)=>a-b);
      const ys=[...new Set([h.bottom,h.top,...hosted.flatMap(o=>[o.bottom,o.top]).filter(y=>y>h.bottom&&y<h.top)])].sort((a,b)=>a-b);
      for(let i=1;i<xs.length;i++)for(let j=1;j<ys.length;j++){
        const x=(xs[i-1]+xs[i])/2,y=(ys[j-1]+ys[j])/2;
        if(!hosted.some(o=>o.a<x&&o.b>x&&o.bottom<y&&o.top>y))return true;
      }
    }
    return false;
  }
  const windows=all.filter(o=>o.kind==='window'&&o.spans.length===1);
  for(const h of windows.filter(o=>o.axis===0))for(const v of windows.filter(o=>o.axis===1)){
    if(Math.abs(h.bottom-v.bottom)>eps||Math.abs(h.top-v.top)>eps)continue;
    const hr=rect(h),vr=rect(v);
    if(hr.x1<vr.x0-eps||hr.x0>vr.x1+eps||vr.z1<hr.z0-eps||vr.z0>hr.z1+eps)continue;
    for(const hEnd of ['start','end'])for(const vEnd of ['start','end']){
      const hx=h.spans[0][hEnd==='start'?0:1],vz=v.spans[0][vEnd==='start'?0:1];
      if(Math.abs(hx-v.center)>v.thickness/2+eps||Math.abs(vz-h.center)>h.thickness/2+eps)continue;
      const join={x0:vr.x0,x1:vr.x1,z0:hr.z0,z1:hr.z1,bottom:h.bottom,top:h.top,openingIds:[h.id,v.id],ends:[hEnd,vEnd],spans:[h.spans[0],v.spans[0]]};
      if(!blocked(join,h,v))joins.push(join);
    }
  }
  // An endpoint with multiple possible partners is not an unambiguous L corner.
  const unique=joins.filter(j=>j.openingIds.every((id,i)=>joins.filter(k=>k.openingIds.some((other,n)=>other===id&&k.ends[n]===j.ends[i])).length===1));
  return unique.filter(j=>j.openingIds.every(id=>{
    const o=windows.find(o=>o.id===id),[a,b]=o.spans[0],layout=windowSpanLayout(o,a,b,unique,scale);
    return layout.end-layout.start>Math.min(80/scale,(b-a)/4);
  }));
}

export function windowSpanLayout(o,a,b,joins,scale){
  const {frame}=apertureFrame('window',b-a,scale);
  const at=end=>joins.find(j=>j.openingIds.some((id,i)=>id===o.id&&j.ends[i]===end));
  const startJoin=at('start'),endJoin=at('end');
  const start=startJoin?(o.axis===0?startJoin.x1:startJoin.z1):a+frame;
  const end=endJoin?(o.axis===0?endJoin.x0:endJoin.z0):b-frame;
  return {start,end,startJoin,endJoin,frame,reveal:Math.min(3/scale,(end-start)/20)};
}
export function canQuickOpen(o) {
  return Boolean(o&&['door','window'].includes(o.kind)&&o.review_status!=='rejected'&&
    (!o.requires_confirmation||o.review_status==='confirmed')&&
    !(o.kind==='window'&&o.operation?.type==='fixed'));
}
export function swingGeometry(o,a,b,center,values=operationOf(o)) {
  const axis=o.axis??(o.orientation==='horizontal'?0:1),sign=values.hinge==='start'?1:-1,side=values.side==='negative'?-1:1;
  const theta=values.angle_deg*Math.PI/180,length=b-a;
  const anchor=a+pivotRatio(values)*length,hinge=axis===0?[anchor,center]:[center,anchor],free=values.hinge==='start'?b:a,lever=free-anchor;
  const at=(coordinate,angle)=>{const point=[...hinge],offset=coordinate-anchor;point[axis]+=offset*Math.cos(angle);point[1-axis]+=side*sign*offset*Math.sin(angle);return point;};
  const closed=at(free,0),tip=at(free,theta),dx=sign*Math.cos(theta),dy=side*Math.sin(theta);
  const direction=axis===0?[dx,dy]:[dy,dx];
  const sweep=axis===0?(sign*side>0?1:0):(sign*side<0?1:0);
  return {hinge,closed,tip,leafStart:at(a,theta),leafEnd:at(b,theta),dx:direction[0],dy:direction[1],length,rotation_y:-Math.atan2(direction[1],direction[0]),
    arc:values.angle_deg>0&&Math.abs(lever)>1e-8?`M ${closed[0]} ${closed[1]} A ${Math.abs(lever)} ${Math.abs(lever)} 0 0 ${sweep} ${tip[0]} ${tip[1]}`:null};
}
export function openingSymbol(doc,o) {
  if(!o.operation||operationOf(o).type!=='hinged')return null;
  const axis=o.orientation==='horizontal'?0:1,s=doc.model_settings||{},scale=doc.scale_mm_per_px;
  const scaled=Number.isFinite(scale)&&scale>0,center=(o.start_px[axis]+o.end_px[axis])/2;
  const width=scaled?(o.dimensions_mm?.width_mm/scale||(s.width_mode==='preset'?(o.kind==='door'?(s.opening_width_mm??900):(s.window_width_mm??800))/scale:o.end_px[axis]-o.start_px[axis])):o.end_px[axis]-o.start_px[axis];
  const {available}=apertureFrame(o.kind,width,scale);
  let leaf=scaled&&o.kind==='door'&&s.width_mode==='preset'&&!o.dimensions_mm?.width_mm?Math.min((s.door_width_mm??800)/scale,available):available,leafCenter=center,leafCross=o.start_px[1-axis];
  const op=applyWindowPreset(doc,o);
  if(scaled&&o.kind==='window'){
    const joins=windowCornerConnections(doc),join=joins.find(j=>j.openingIds.includes(o.id));
    if(join){
      const [a,b]=join.spans[join.openingIds.indexOf(o.id)],layout=windowSpanLayout({id:o.id,axis},a,b,joins,scale);
      leaf=layout.end-layout.start-2*layout.reveal;leafCenter=(layout.start+layout.end)/2;
      leafCross=axis===0?(join.z0+join.z1)/2:(join.x0+join.x1)/2;
    }
  }
  if(op.pivot_axis==='horizontal'){
    const height=scaled?(o.dimensions_mm?.height_mm??s.window_height_mm??1500)/scale:leaf,ratio=pivotRatio(op),side=op.side==='negative'?-1:1;
    const rotation=side*(op.hinge==='top'?-1:1)*Math.sin(op.angle_deg*Math.PI/180);
    const point=(position,cross)=>axis===0?[position,cross]:[cross,position];
    const cross=leafCross,a=leafCenter-leaf/2,b=leafCenter+leaf/2;
    return {flip:true,hingeStart:point(a,cross),hingeEnd:point(b,cross),
      corners:[point(a,cross-ratio*height*rotation),point(b,cross-ratio*height*rotation),point(b,cross+(1-ratio)*height*rotation),point(a,cross+(1-ratio)*height*rotation)]};
  }
  return swingGeometry(o,leafCenter-leaf/2,leafCenter+leaf/2,leafCross,op);
}
function multiply(a,b){const [x,y,z,w]=a,[X,Y,Z,W]=b;return [w*X+x*W+y*Z-z*Y,w*Y-x*Z+y*W+z*X,w*Z+x*Y-y*X+z*W,w*W-x*X-y*Y-z*Z];}
export function rotateVector(q,v){const r=multiply(multiply(q,[...v,0]),[-q[0],-q[1],-q[2],q[3]]);return r.slice(0,3);}
export function leafPose(axis,origin,width,height,op){
  const ratio=pivotRatio(op),horizontal=op.pivot_axis==='horizontal',side=op.side==='negative'?-1:1;
  const sign=horizontal?(op.hinge==='top'?-1:1):(op.hinge==='end'?-1:1);
  const angle=(axis===0?(horizontal?1:-1):(horizontal?-1:1))*side*sign*op.angle_deg*Math.PI/180;
  const spinAxis=horizontal?(axis===0?[1,0,0]:[0,0,1]):[0,1,0];
  const spin=[...spinAxis.map(v=>v*Math.sin(angle/2)),Math.cos(angle/2)],base=axis===0?[0,0,0,1]:[0,-Math.SQRT1_2,0,Math.SQRT1_2];
  const quaternion=multiply(spin,base),pivot=horizontal?[0,ratio*height,0]:[ratio*width,0,0];
  const anchored=rotateVector(base,pivot).map((v,i)=>v+origin[i]);
  return {quaternion,transform:local=>rotateVector(quaternion,local.map((v,i)=>v-pivot[i])).map((v,i)=>v+anchored[i])};
}
