// Pure geometry: millimetres in settings, metres in the scene, source pixels retained.
export const DEFAULTS = Object.freeze({wall_height_mm:2800,door_height_mm:2100,window_height_mm:1500,
  sill_height_mm:900,door_width_mm:800,opening_width_mm:900,window_width_mm:800,width_mode:'detected',
  wall_color:'#e4ddd3',floor_color:'#ffffff',show_furniture:true,show_plan:false,show_room_floors:true});

export function buildModel(doc) {
  const s={...DEFAULTS,...doc.model_settings},scale=doc.scale_mm_per_px;
  if(!Number.isFinite(scale)||scale<=0)throw new Error('请先在二维图上标定一段已知长度。');
  const unit=scale/1000,W=doc.image.width_px,H=doc.image.height_px,height=s.wall_height_mm/1000;
  const boxes=[],warnings=[],openings=[];
  if(doc.wall_connection?.free_end_count)warnings.push(`墙体仍有 ${doc.wall_connection.free_end_count} 个自由端点（含正常墙端），请核对连接后再确认模型。`);
  const box=(id,kind,x0,z0,x1,z1,bottom,top,color)=>{
    if(x1-x0<1e-6||z1-z0<1e-6||top-bottom<1e-6)return;
    boxes.push({id,kind,size:[(x1-x0)*unit,top-bottom,(z1-z0)*unit],
      center:[((x0+x1)/2-W/2)*unit,(bottom+top)/2,((z0+z1)/2-H/2)*unit],color});
  };
  const walls=(doc.walls||[]).filter(w=>w.review_status!=='rejected');
  const active=(doc.openings||[]).filter(o=>o.review_status!=='rejected'&&['door','window'].includes(o.kind)&&(!o.requires_confirmation||o.review_status==='confirmed'));
  for(const o of active){
    const axis=o.orientation==='horizontal'?0:1,center=(o.start_px[axis]+o.end_px[axis])/2;
    const width=s.width_mode==='preset'?(o.kind==='door'?s.opening_width_mm:s.window_width_mm)/scale:Math.abs(o.end_px[axis]-o.start_px[axis]);
    const a=center-width/2,b=center+width/2;
    const hosts=walls.filter(w=>w.orientation===o.orientation&&Math.abs(w.start_px[1-axis]-o.start_px[1-axis])<=Math.min(w.thickness_px,o.thickness_px)/2+1&&Math.max(a,w.start_px[axis])<Math.min(b,w.end_px[axis]));
    if(!hosts.length){warnings.push(`${o.id} 未贴合墙体，未生成三维门窗，请在二维中校核。`);continue;}
    const host=hosts.reduce((best,w)=>w.thickness_px>best.thickness_px?w:best);
    const bottom=o.kind==='window'?s.sill_height_mm/1000:0;
    const top=bottom+(o.kind==='window'?s.window_height_mm:s.door_height_mm)/1000;
    const segments=hosts.map(w=>[Math.max(a,w.start_px[axis]),Math.min(b,w.end_px[axis])]).sort((x,y)=>x[0]-y[0]);
    const spans=[];for(const [start,end] of segments){const last=spans.at(-1);if(last&&start<=last[1]+.01)last[1]=Math.max(last[1],end);else spans.push([start,end]);}
    if(spans.length>1||spans[0][0]>a+.1||spans[0][1]<b-.1)warnings.push(`${o.id} 宽度超出连续墙段，门窗按可用墙段裁切。`);
    openings.push({id:o.id,kind:o.kind,axis,a,b,bottom,top,hosts:hosts.map(w=>w.id),spans,center:host.start_px[1-axis],thickness:host.thickness_px});
  }
  for(const wall of walls){
    const axis=wall.orientation==='horizontal'?0:1,a=wall.start_px[axis],b=wall.end_px[axis],center=wall.start_px[1-axis],half=wall.thickness_px/2;
    const holes=openings.filter(o=>o.hosts.includes(wall.id)).map(o=>({a:Math.max(a,o.a),b:Math.min(b,o.b),bottom:o.bottom,top:o.top}));
    // Unknown/manual gaps stay open: never silently turn an unclassified boundary into a wall.
    for(const hint of wall.opening_hints||[]){
      if(hint.opening_ids?.some(id=>openings.some(o=>o.id===id)))continue;
      const ha=Math.max(a,hint.start_px[axis]),hb=Math.min(b,hint.end_px[axis]);
      if(hb>ha){holes.push({a:ha,b:hb,bottom:0,top:height});warnings.push(`${wall.id} 有未定类型洞口，暂保留通高缺口。`);}
    }
    const cuts=[...new Set([a,b,...holes.flatMap(h=>[h.a,h.b])])].sort((x,y)=>x-y);
    for(let i=0;i<cuts.length-1;i++){
      const left=cuts[i],right=cuts[i+1],mid=(left+right)/2;
      const covered=holes.filter(h=>h.a<mid&&h.b>mid);
      const levels=[...new Set([0,height,...covered.flatMap(h=>[h.bottom,h.top])])].sort((x,y)=>x-y);
      for(let j=0;j<levels.length-1;j++){
        const lo=levels[j],hi=levels[j+1],middle=(lo+hi)/2;
        if(covered.some(h=>h.bottom<middle&&h.top>middle))continue;
        if(axis===0)box(wall.id,'wall',left,center-half,right,center+half,lo,hi,s.wall_color);
        else box(wall.id,'wall',center-half,left,center+half,right,lo,hi,s.wall_color);
      }
    }
  }
  for(const o of openings){
    const add=(a,b,bottom,top,depth,color,kind)=>o.axis===0?
      box(o.id,kind,a,o.center-depth/2,b,o.center+depth/2,bottom,top,color):
      box(o.id,kind,o.center-depth/2,a,o.center+depth/2,b,bottom,top,color);
    for(const [a,b] of o.spans){
      const frame=Math.min(40/scale,(b-a)/8),frameH=Math.min(.04,(o.top-o.bottom)/8),color=o.kind==='door'?'#ad8667':'#657e88';
      add(a,a+frame,o.bottom,o.top,o.thickness,color,'frame');add(b-frame,b,o.bottom,o.top,o.thickness,color,'frame');
      add(a+frame,b-frame,o.top-frameH,o.top,o.thickness,color,'frame');
      if(o.kind==='window'){
        add(a+frame,b-frame,o.bottom,o.bottom+frameH,o.thickness,color,'frame');
        add((a+b)/2-frame/2,(a+b)/2+frame/2,o.bottom,o.top,o.thickness,color,'frame');
        add(a+frame,b-frame,o.bottom+frameH,o.top-frameH,10/scale,'#a7d8e5','glass');
      }else{
        // Detected openings own their width; the nominal leaf only applies in preset mode.
        // Fit within the actual clipped frame, with a small reveal on both sides.
        const clearWidth=b-a-2*frame,reveal=Math.min(3/scale,clearWidth/20);
        const available=clearWidth-2*reveal;
        const leaf=s.width_mode==='preset'?Math.min(s.door_width_mm/scale,available):available;
        const leafStart=(a+b-leaf)/2;
        add(leafStart,leafStart+leaf,o.bottom+.015,o.top-frameH,35/scale,'#d1ae8b','door');
      }
    }
  }
  const furniture=(doc.furniture||[]).filter(f=>f.review_status!=='rejected');
  if(s.show_furniture)for(const f of furniture){
    if(['unclassified','unclassified_area','wet_area','water_feature'].includes(f.kind))continue;
    const [x0,z0,x1,z1]=f.bbox_px,w=x1-x0,d=z1-z0;
    const add=(rx,rz,rw,rd,lo,hi,color)=>box(f.id,'furniture',x0+w*rx,z0+d*rz,x0+w*(rx+rw),z0+d*(rz+rd),lo,hi,color);
    const back=(lo,hi,color)=>{
      if(f.rotation_deg===90)add(.9,0,.1,1,lo,hi,color);
      else if(f.rotation_deg===180)add(0,.9,1,.1,lo,hi,color);
      else if(f.rotation_deg===270)add(0,0,.1,1,lo,hi,color);
      else add(0,0,1,.1,lo,hi,color);
    };
    if(f.kind==='bed'){add(0,0,1,1,.08,.32,'#b69c84');add(.025,.025,.95,.95,.32,.55,'#eeeae4');back(.32,1,'#aa9380');}
    else if(['sofa','chair'].includes(f.kind)){add(0,0,1,1,.12,.44,'#9dada8');back(.44,.85,'#899e97');}
    else if(['table','dining_table','coffee_table'].includes(f.kind)){
      const h=f.kind==='coffee_table'?.4:.75;add(0,0,1,1,h-.06,h,'#c6b294');
      for(const x of [.08,.84])for(const z of [.08,.84])add(x,z,.08,.08,0,h-.06,'#8d806f');
    }else{
      const h={cabinet:2,shoe_cabinet:1.1,tv_console:.5,kitchen_cabinet:.85,kitchen_sink:.86,cooktop:.9,refrigerator:1.8,vanity:.8,toilet:.65,bathtub:.55,shower:.08}[f.kind]??.7;
      add(0,0,1,1,0,h,['toilet','bathtub','vanity','kitchen_sink'].includes(f.kind)?'#f3f5f3':'#bec4c1');
    }
  }
  return {boxes,warnings:[...new Set(warnings)],openings,width:W*unit,depth:H*unit,height,settings:s,
    wallCount:walls.length,furnitureCount:new Set(boxes.filter(b=>b.kind==='furniture').map(b=>b.id)).size};
}
