'use strict';
(() => {
  let geometry=null,loadError=false;
  const layer=svgElement('g',{id:'wall-length-layer','pointer-events':'none'});
  $('draft-layer').before(layer);
  function render(){
    layer.replaceChildren();
    const doc=state.run?.document,shown=$('wall-lengths-toggle').checked,scaled=Number.isFinite(doc?.scale_mm_per_px)&&doc.scale_mm_per_px>0;
    $('wall-lengths-toggle').disabled=!doc||Boolean(state.busy);
    $('wall-corners-toggle').disabled=!doc||Boolean(state.busy);
    const hint=$('wall-lengths-hint');
    hint.textContent=!doc?'识别后可显示墙长。':!scaled?'先在“测量”中标定比例，再显示实际墙长。':'轴线长度 · 含门窗洞口 · 单位 m';
    if(!shown||!doc||!scaled)return;
    if(!geometry){hint.textContent=loadError?'墙长工具加载失败，请刷新页面。':'正在准备墙长标注…';return;}
    const dimensions=geometry.wallDimensions(doc,{splitCorners:$('wall-corners-toggle').checked});
    const zoom=state.zoom,placed=[];let hidden=0;
    for(const d of dimensions.sort((a,b)=>b.length_mm-a.length_mm)){
      const text=geometry.formatWallLength(d.length_mm),width=(text.length*6.6+10)/zoom,height=18/zoom;
      const [x0,y0]=d.start_px,[x1,y1]=d.end_px,mx=(x0+x1)/2,my=(y0+y1)/2;
      const span=Math.hypot(x1-x0,y1-y0),labelSpan=d.axis===0?width:height;
      if(span*zoom<18||span<labelSpan){hidden++;continue;}
      let label=null;
      for(const sign of [-1,1])for(let lane=0;lane<3&&!label;lane++){
        const offset=sign*(d.thickness_px/2+(14+lane*21)/zoom);
        const x=d.axis===0?mx:mx+offset,y=d.axis===0?my+offset:my;
        const box=[x-width/2,y-height/2,x+width/2,y+height/2];
        if(box[0]<0||box[1]<0||box[2]>state.width||box[3]>state.height)continue;
        if(placed.some(b=>box[0]<b[2]+2/zoom&&box[2]>b[0]-2/zoom&&box[1]<b[3]+2/zoom&&box[3]>b[1]-2/zoom))continue;
        label={x,y,box};
      }
      if(!label){hidden++;continue;}placed.push(label.box);
      const color=d.wall_ids.includes(state.selected?.id)?'#245ee5':'#43586c';
      const group=svgElement('g',{'data-length-mm':d.length_mm,'data-wall-ids':d.wall_ids.join(' '),'aria-label':`墙轴线 ${text}`});
      const line=(a,b,c,e,extra={})=>svgElement('line',{x1:a,y1:b,x2:c,y2:e,stroke:color,'stroke-width':1/zoom,...extra});
      const dx=d.axis===0?0:label.x-mx,dy=d.axis===0?label.y-my:0,tick=3/zoom;
      group.append(line(x0,y0,x0+dx,y0+dy,{'stroke-opacity':.45}),line(x1,y1,x1+dx,y1+dy,{'stroke-opacity':.45}),line(x0+dx,y0+dy,x1+dx,y1+dy));
      for(const [x,y] of [[x0+dx,y0+dy],[x1+dx,y1+dy]])group.append(line(x-tick,y+tick,x+tick,y-tick));
      group.append(svgElement('rect',{x:label.box[0],y:label.box[1],width,height,rx:3/zoom,fill:'#fffffff2',stroke:'#ccd8e3','stroke-width':.7/zoom}));
      const number=svgElement('text',{x:label.x,y:label.y,'text-anchor':'middle','dominant-baseline':'central',fill:color,style:`font-size:${12/zoom}px;font-weight:600`});
      number.textContent=text;group.append(number);layer.append(group);
    }
    if(hidden)hint.textContent+=` · ${hidden} 处短段或密集标注需放大查看`;
  }
  $('wall-lengths-toggle').addEventListener('change',()=>renderPlan());
  $('wall-corners-toggle').addEventListener('change',render);
  window.addEventListener('wall-plan-rendered',render);
  window.addEventListener('wall-state-change',render);
  import('/wall-lengths.mjs').then(module=>{geometry=module;render();}).catch(()=>{loadError=true;render();});
  render();
})();
