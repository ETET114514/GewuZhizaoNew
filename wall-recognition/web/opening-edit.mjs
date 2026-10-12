import {operationOf,applyWindowPreset} from './opening-operation.mjs';
const axisOf=o=>o.orientation==='horizontal'?0:1;
const aligned=(w,o)=>w.orientation===o.orientation&&Math.abs(w.start_px[1-axisOf(o)]-o.start_px[1-axisOf(o)])<=Math.min(w.thickness_px,o.thickness_px)/2+1;
const active=o=>o.review_status!=='rejected'&&!['rejected','wall'].includes(o.kind)&&(!o.requires_confirmation||o.review_status==='confirmed');
export function openingHost(doc,o){
  const axis=axisOf(o),groups=[];
  for(const w of doc.walls.filter(w=>w.review_status!=='rejected'&&aligned(w,o)).sort((a,b)=>a.start_px[axis]-b.start_px[axis])){
    const a=w.start_px[axis],b=w.end_px[axis],last=groups.at(-1);
    if(last&&a<=last.b+.01){last.b=Math.max(last.b,b);last.walls.push(w);}else groups.push({a,b,walls:[w]});
  }
  const group=groups.find(g=>g.a<=o.start_px[axis]+.1&&g.b>=o.end_px[axis]-.1);
  if(!group)throw new Error('门窗未贴合连续墙段，请先校核墙体或确认门窗类型。');
  const host=group.walls.find(w=>w.id===o.host_wall_id)||[...group.walls].sort((a,b)=>(b.source!=='automatic_opening_connection')-(a.source!=='automatic_opening_connection')||b.length_px-a.length_px)[0];
  return {...group,axis,center:host.start_px[1-axis],thickness:host.thickness_px,id:host.id};
}
export function openingValues(doc,o){
  const axis=axisOf(o),s=doc.model_settings||{},d=o.dimensions_mm||{};
  return {width_mm:d.width_mm??(s.width_mode==='preset'?(o.kind==='door'?(s.opening_width_mm??800):(s.window_width_mm??800)):(o.end_px[axis]-o.start_px[axis])*doc.scale_mm_per_px),
    height_mm:d.height_mm??(o.kind==='window'?(s.window_height_mm??1500):(s.door_height_mm??2100)),
    sill_height_mm:o.kind==='window'?(d.sill_height_mm??s.sill_height_mm??900):0};
}
function geometry(axis,a,b,center,thickness){
  return {orientation:axis===0?'horizontal':'vertical',start_px:axis===0?[a,center]:[center,a],end_px:axis===0?[b,center]:[center,b],
    bbox_px:axis===0?[a,center-thickness/2,b,center+thickness/2]:[center-thickness/2,a,center+thickness/2,b],length_px:b-a,thickness_px:thickness};
}
export function openingPreview(doc,id,dimensions,centerPx,operation){
  const o=doc.openings.find(o=>o.id===id);
  if(!o||!['door','window'].includes(o.kind)||!active(o))throw new Error('请选择有效的门或窗；待定边界需先确认为门窗。');
  if(operation!==undefined&&dimensions===undefined&&centerPx===undefined){
    const result=structuredClone(doc),edited=result.openings.find(o=>o.id===id);
    if(operation===null)delete edited.operation;else edited.operation=applyWindowPreset(result,edited,operationOf(o,operation));
    return result;
  }
  if(!Number.isFinite(doc.scale_mm_per_px)||doc.scale_mm_per_px<=0)throw new Error('请先标定比例，再按厘米编辑门窗。');
  const values={...openingValues(doc,o),...dimensions},host=openingHost(doc,o),axis=host.axis,width=values.width_mm/doc.scale_mm_per_px;
  for(const [key,value] of Object.entries(values))if(!Number.isFinite(value)||value<(key==='sill_height_mm'?0:100)||value>20000)throw new Error('门窗尺寸超出范围，请检查输入。');
  if(o.kind==='door'&&values.sill_height_mm!==0)throw new Error('门洞需从地面开始。');
  if(values.height_mm+values.sill_height_mm>(doc.model_settings?.wall_height_mm??2800)+1e-6)throw new Error('离地高度加洞口高度不能超过墙高。');
  if(width>host.b-host.a+1e-6)throw new Error('门窗宽度不能超过所属连续墙段。');
  const requested=centerPx??(o.start_px[axis]+o.end_px[axis])/2;
  if(!Number.isFinite(requested))throw new Error('沿墙位置无效。');
  const center=Math.max(host.a+width/2,Math.min(host.b-width/2,requested)),a=center-width/2,b=center+width/2;
  if(doc.openings.some(other=>other.id!==id&&active(other)&&aligned(other,o)&&Math.min(b,other.end_px[axis])-Math.max(a,other.start_px[axis])>.01))throw new Error('这个位置与其他门窗重叠，请缩小宽度或沿墙移动。');
  const result=structuredClone(doc),edited=result.openings.find(o=>o.id===id);
  if(operation!==undefined){if(operation===null)delete edited.operation;else edited.operation=operationOf(o,operation);}
  Object.assign(edited,geometry(axis,a,b,host.center,host.thickness),{dimensions_mm:values,host_wall_id:host.id,review_status:'confirmed'});
  if(edited.operation)edited.operation=applyWindowPreset(result,edited,edited.operation);
  edited.connection_span=geometry(axis,a,b,host.center,host.thickness);
  const hostIds=new Set(host.walls.map(w=>w.id));
  for(const w of result.walls){
    if(hostIds.has(w.id)&&w.source==='automatic_opening_connection')w.source='assisted_opening_host';
    // Mirror aperture subtraction for the immediate 2D preview. The server owns
    // the authoritative refinement, derived IDs and persisted change history.
    const ax=axisOf(w),lo=w.start_px[ax],hi=w.end_px[ax],holes=[];
    for(const hint of w.manual_opening_hints||w.opening_hints?.filter(h=>h.source!=='opening_constraint')||[])holes.push([hint.start_px[ax],hint.end_px[ax]]);
    for(const hole of result.openings.filter(h=>active(h)&&aligned(w,h)))holes.push([hole.start_px[ax],hole.end_px[ax]]);
    const intervals=holes.map(([a,b])=>[Math.max(lo,a),Math.min(hi,b)]).filter(([a,b])=>b>a).sort((a,b)=>a[0]-b[0]);
    const parts=[];let cursor=lo;
    for(const [a,b] of intervals){if(a>cursor)parts.push(geometry(ax,cursor,a,w.start_px[1-ax],w.thickness_px));cursor=Math.max(cursor,b);}
    if(cursor<hi)parts.push(geometry(ax,cursor,hi,w.start_px[1-ax],w.thickness_px));
    w.solid_parts=parts.map((p,i)=>({...p,id:`${w.id}:preview${i}`}));
    w.opening_hints=intervals.map(([a,b])=>geometry(ax,a,b,w.start_px[1-ax],w.thickness_px));
  }
  return result;
}
