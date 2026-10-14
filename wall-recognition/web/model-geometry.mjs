import {buildFurniture} from './furniture-models.mjs';
import {applyWindowPreset,swingGeometry,leafPose,apertureFrame,windowCornerConnections,windowSpanLayout} from './opening-operation.mjs';
import {flushWallJoints,alignWindowReturns,fillWallCorners,unionWallBoxes} from './wall-joints.mjs';
// Pure geometry: millimetres in settings, metres in the scene, source pixels retained.
export const DEFAULTS = Object.freeze({wall_height_mm:2800,door_height_mm:2100,window_height_mm:1500,
  sill_height_mm:900,door_width_mm:800,opening_width_mm:900,window_width_mm:800,width_mode:'detected',
  wall_color:'#e4ddd3',floor_color:'#ffffff',show_furniture:true,show_plan:false,show_room_floors:true,flush_wall_joints:true});

export function buildModel(doc,{buildMeshes=true}={}) {
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
    const width=o.dimensions_mm?.width_mm/scale||(s.width_mode==='preset'?(o.kind==='door'?s.opening_width_mm:s.window_width_mm)/scale:Math.abs(o.end_px[axis]-o.start_px[axis]));
    const a=center-width/2,b=center+width/2;
    const hosts=walls.filter(w=>w.orientation===o.orientation&&Math.abs(w.start_px[1-axis]-o.start_px[1-axis])<=Math.min(w.thickness_px,o.thickness_px)/2+1&&Math.max(a,w.start_px[axis])<Math.min(b,w.end_px[axis]));
    if(!hosts.length){warnings.push(`${o.id} 未贴合墙体，未生成三维门窗，请在二维中校核。`);continue;}
    const host=hosts.reduce((best,w)=>w.thickness_px>best.thickness_px?w:best);
    const bottom=o.kind==='window'?(o.dimensions_mm?.sill_height_mm??s.sill_height_mm)/1000:0;
    const top=bottom+(o.dimensions_mm?.height_mm??(o.kind==='window'?s.window_height_mm:s.door_height_mm))/1000;
    const segments=hosts.map(w=>[Math.max(a,w.start_px[axis]),Math.min(b,w.end_px[axis])]).sort((x,y)=>x[0]-y[0]);
    const spans=[];for(const [start,end] of segments){const last=spans.at(-1);if(last&&start<=last[1]+.01)last[1]=Math.max(last[1],end);else spans.push([start,end]);}
    if(spans.length>1||spans[0][0]>a+.1||spans[0][1]<b-.1)warnings.push(`${o.id} 宽度超出连续墙段，门窗按可用墙段裁切。`);
    openings.push({id:o.id,kind:o.kind,door_model:o.door_model,axis,a,b,bottom,top,operation:o.operation?applyWindowPreset(doc,o):null,customWidth:Boolean(o.dimensions_mm?.width_mm),hosts:hosts.map(w=>w.id),spans,center:host.start_px[1-axis],thickness:host.thickness_px,
      exteriorFrame:Boolean(o.evidence?.exterior_frame),supportIds:o.jamb_support_ids||[]});
  }
  const corners=s.flush_wall_joints?alignWindowReturns(walls,openings,doc.openings||[]):{walls,adjustments:[]};
  const joints=s.flush_wall_joints?flushWallJoints(corners.walls,openings,scale):{spans:new Map(),adjustments:[]};
  for(const wall of corners.walls){
    const axis=wall.orientation==='horizontal'?0:1;
    const {a,b}=joints.spans.get(wall.id)||{a:wall.start_px[axis],b:wall.end_px[axis]};
    const center=wall.start_px[1-axis],half=wall.thickness_px/2;
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
  const cornerFills=s.flush_wall_joints?fillWallCorners(corners.walls,joints.spans,openings,height):[];
  for(const p of cornerFills){
    box(p.id,'wall',p.x0,p.z0,p.x1,p.z1,p.bottom,p.top,s.wall_color);
    boxes.at(-1).component='wall_corner';
  }
  const windowConnections=windowCornerConnections(doc,openings);
  for(const join of windowConnections){
    box(`window-corner:${join.openingIds.join(':')}`,'frame',join.x0,join.z0,join.x1,join.z1,join.bottom,join.top,'#657e88');
    boxes.at(-1).component='window_corner_frame';boxes.at(-1).openingIds=join.openingIds;
  }
  for(const o of openings){
    const add=(a,b,bottom,top,depth,color,kind)=>{
      const count=boxes.length;
      if(o.axis===0)box(o.id,kind,a,o.center-depth/2,b,o.center+depth/2,bottom,top,color);
      else box(o.id,kind,o.center-depth/2,a,o.center+depth/2,b,bottom,top,color);
      if(boxes.length>count&&o.kind==='window'&&kind==='frame')boxes.at(-1).component='window_fixed_frame';
    };
    const swungPart=(swing,lo,hi,bottom,top,depth,color,kind)=>{
      const distance=(lo+hi)/2;
      boxes.push({id:o.id,kind,size:[(hi-lo)*unit,top-bottom,depth*unit],
        center:[(swing.hinge[0]+swing.dx*distance-W/2)*unit,(bottom+top)/2,(swing.hinge[1]+swing.dy*distance-H/2)*unit],
        rotation_y:swing.rotation_y,color});
    };
    const movingLeaf=(start,end,low,high)=>{
      if(o.operation.pivot_axis||o.operation.pivot_ratio!==undefined){
        const origin=o.axis===0?[(start-W/2)*unit,low,(o.center-H/2)*unit]:[(o.center-W/2)*unit,low,(start-H/2)*unit];
        const pose=leafPose(o.axis,origin,(end-start)*unit,high-low,o.operation);
        return (lo,hi,bottom,top,depth,color,kind)=>boxes.push({id:o.id,kind,
          size:[(hi-lo)*unit,top-bottom,depth*unit],center:pose.transform([(lo+hi)/2*unit,(bottom+top)/2-low,0]),quaternion:pose.quaternion,color});
      }
      const swing=swingGeometry(o,start,end,o.center,o.operation);
      return (...args)=>swungPart(swing,...args);
    };
    for(const [a,b] of o.spans){
      const {frame,available}=apertureFrame(o.kind,b-a,scale),frameH=Math.min(.04,(o.top-o.bottom)/8),color=o.kind==='door'?(o.door_model==='entry'?'#41454b':'#ad8667'):'#657e88';
      const layout=o.kind==='window'?windowSpanLayout(o,a,b,windowConnections,scale):null;
      const clearA=layout?.start??a+frame,clearB=layout?.end??b-frame;
      if(!layout?.startJoin)add(a,a+frame,o.bottom,o.top,o.thickness,color,'frame');
      if(!layout?.endJoin)add(b-frame,b,o.bottom,o.top,o.thickness,color,'frame');
      add(clearA,clearB,o.top-frameH,o.top,o.thickness,color,'frame');
      if(o.kind==='window'){
        add(clearA,clearB,o.bottom,o.bottom+frameH,o.thickness,color,'frame');
        if(o.operation?.type==='hinged'){
          const reveal=layout.reveal,start=clearA+reveal,end=clearB-reveal;
          const length=end-start,edge=Math.min(frame,length/8);
          const low=o.bottom+frameH+.003,high=o.top-frameH-.003;
          const part=movingLeaf(start,end,low,high);
          part(0,edge,low,high,35/scale,color,'frame');
          part(length-edge,length,low,high,35/scale,color,'frame');
          part(edge,length-edge,low,low+frameH,35/scale,color,'frame');
          part(edge,length-edge,high-frameH,high,35/scale,color,'frame');
          part(edge,length-edge,low+frameH,high-frameH,10/scale,'#a7d8e5','glass');
          continue;
        }
        add((clearA+clearB)/2-frame/2,(clearA+clearB)/2+frame/2,o.bottom,o.top,o.thickness,color,'frame');
        boxes.at(-1).component='window_fixed_mullion';
        add(clearA,clearB,o.bottom+frameH,o.top-frameH,10/scale,'#a7d8e5','glass');
      }else{
        // Detected openings own their width; the nominal leaf only applies in preset mode.
        // Door jambs take 50 mm on each side; the leaf fills the resulting clear width.
        const leaf=s.width_mode==='preset'&&!o.customWidth?Math.min(s.door_width_mm/scale,available):available;
        const leafStart=(a+b-leaf)/2;
        const entry=o.door_model==='entry',low=o.bottom+.015,high=o.top-frameH;
        const part=o.operation?movingLeaf(leafStart,leafStart+leaf,low,high):
          (lo,hi,bottom,top,depth,color,kind)=>add(leafStart+lo,leafStart+hi,bottom,top,depth,color,kind);
        part(0,leaf,low,high,(entry?60:35)/scale,entry?'#584235':'#d1ae8b','door');
        if(entry){
          const detail=(name,...args)=>{const first=boxes.length;part(...args);for(const b of boxes.slice(first)){b.door_model='entry';b.component=name;}};
          const height=high-low;
          const panelHalf=Math.min(10/scale,leaf*.08),handleHalf=Math.min(12/scale,leaf*.06),viewerHalf=Math.min(8/scale,leaf*.08);
          for(const ratio of [.2,.8])detail('entry_panel',leaf*ratio-panelHalf,leaf*ratio+panelHalf,low+height*.15,low+height*.85,65/scale,'#745a47','door');
          const handle=leaf*(o.operation?.hinge==='end'?.12:.88);
          detail('entry_handle',handle-handleHalf,handle+handleHalf,low+height*.4,low+height*.57,100/scale,'#b9bcc0','door');
          detail('entry_viewer',leaf*.5-viewerHalf,leaf*.5+viewerHalf,low+height*.75,Math.min(high,low+height*.75+.016),66/scale,'#25272b','door');
        }
      }
    }
  }
  if(s.show_furniture)boxes.push(...buildFurniture(doc));
  const windowFrameMesh=buildMeshes?unionWallBoxes(boxes.filter(b=>['window_fixed_frame','window_fixed_mullion','window_corner_frame'].includes(b.component)).map(b=>({...b,kind:'wall'}))):null;
  return {boxes,wallMesh:buildMeshes?unionWallBoxes(boxes):null,windowFrameMesh,windowConnections,warnings:[...new Set(warnings)],openings,width:W*unit,depth:H*unit,height,settings:s,
    wallJointAdjustments:joints.adjustments,
    wallCornerAdjustments:corners.adjustments,
    wallCornerFills:cornerFills,
    wallCount:walls.length,furnitureCount:new Set(boxes.filter(b=>b.kind==='furniture').map(b=>b.id)).size};
}
