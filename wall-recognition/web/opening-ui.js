'use strict';
(() => {
  const form=$('opening-form');let geometry=null,current=null,gesture=null,frame=0,suppressUntil=0,valid=true,initial=null;
  let operationModule=null,doorModel='standard';
  let contextDocument=null,contextTicket=0;
  Promise.all([import('./opening-edit.mjs'),import('./opening-operation.mjs')]).then(([module,operations])=>{geometry=module;operationModule=operations;state.openingOperation=operations;if(item())fill(item());renderPlan();sync();}).catch(error=>toast(`门窗编辑加载失败：${error.message}`,true));
  const item=()=>state.run?.document.openings.find(o=>o.id===current);
  const status=(text,error=false)=>{const el=$('opening-edit-status');el.textContent=text;el.style.color=error?'#b34735':'';};
  function clear(){current=null;initial=null;state.openingPreview=null;form.hidden=true;}
  function sync(){
    const doc=state.run?.document;
    if(doc&&doc!==contextDocument){
      contextDocument=doc;state.openingContexts=null;
      const ticket=++contextTicket,runId=state.run.run_id;
      api('/api/opening-context',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({run_id:runId})}).then(result=>{
        if(ticket!==contextTicket||state.run?.document!==doc)return;
        state.openingContexts=result.contexts;
        if(item()){if(!state.formDirty)fill(item());else{updateContext();preview();}}
        sync();
      }).catch(error=>{if(ticket===contextTicket){state.openingContexts={};$('opening-context-status').textContent=`内外判断失败，可改为手动：${error.message}`;}});
    }
    if(current&&!item()){clear();return;}
    const o=item(),enabled=Boolean(geometry&&o&&['door','window'].includes(o.kind)&&o.review_status!=='rejected'&&(!o.requires_confirmation||o.review_status==='confirmed')),scaled=Boolean(state.run?.document.scale_mm_per_px);
    for(const field of form.querySelectorAll('input,select,button'))field.disabled=Boolean(state.busy)||!enabled;
    for(const name of ['width','height','sill','position'])$('opening-'+name).disabled=Boolean(state.busy)||!enabled||!scaled||!initial?.hostValid;
    $('opening-close').disabled=Boolean(state.busy);
    $('opening-sill').disabled=Boolean(state.busy)||!enabled||!scaled||!initial?.hostValid||o?.kind==='door';
    $('opening-floor-glass').hidden=o?.kind!=='window';
    $('opening-floor-glass').disabled=Boolean(state.busy)||!enabled||!scaled||!initial?.hostValid;
    $('opening-door-presets').hidden=o?.kind!=='door';
    $('opening-ordinary-door-help').hidden=o?.kind!=='door';
    for(const button of form.querySelectorAll('[data-door-width]'))button.disabled=Boolean(state.busy)||!enabled||!scaled||!initial?.hostValid;
    $('opening-door-scale').hidden=o?.kind!=='door';
    $('opening-door-scale-help').hidden=o?.kind!=='door';
    $('opening-door-scale').disabled=Boolean(state.busy)||!enabled||state.formDirty;
    $('opening-type-field').hidden=o?.kind!=='window';
    const fixed=o?.kind==='window'&&$('opening-type').value==='fixed';
    $('opening-swing-fields').hidden=fixed;
    for(const name of ['hinge','side','angle','axis','axis-mode','pivot','direction-mode','owner'])$('opening-'+name).disabled=Boolean(state.busy)||!enabled||fixed;
    $('opening-axis-field').hidden=o?.kind==='door';
    $('opening-axis-mode-field').hidden=o?.kind==='door';
    $('opening-side').disabled=Boolean(state.busy)||!enabled||fixed||$('opening-direction-mode').value==='auto';
    $('opening-apply').disabled=Boolean(state.busy)||!enabled||!valid;
  }
  function fill(o){
    if(!geometry)return;
    valid=true;doorModel=o.door_model||'standard';const scale=state.run.document.scale_mm_per_px;
    const values=geometry.openingValues(state.run.document,o);
    for(const [key,name] of [['width_mm','width'],['height_mm','height'],['sill_height_mm','sill']])$('opening-'+name).value=scale?Number((values[key]/10).toFixed(4)):'';
    $('opening-position').value='';
    initial={values,hostValid:false,display:{...Object.fromEntries(['width','height','sill'].map(name=>[name,$('opening-'+name).value])),position:''}};
    const preset=operationModule.applyWindowPreset(state.run.document,o,{...operationModule.operationOf(o),...(!o.operation&&o.kind==='window'?{axis_mode:'width'}:{})});
    const op={...preset,pivot_axis:preset.pivot_axis||'vertical',direction_mode:o.operation?.direction_mode||'auto'};
    if(op.pivot_ratio===undefined)op.pivot_ratio=operationModule.pivotRatio(op);
    for(const [key,name] of [['type','type'],['hinge','hinge'],['side','side'],['angle_deg','angle']])$('opening-'+name).value=op[key];
    initial.operation=op;
    $('opening-axis').value=op.pivot_axis;$('opening-direction-mode').value=op.direction_mode;
    $('opening-axis-mode').value=op.axis_mode||'manual';
    updateAxis(o,op.hinge);$('opening-pivot').value=Number((op.pivot_ratio*100).toFixed(4));
    updateWidthPreset();
    updateContext(op.interior_room_id||'');
    const horizontal=o.orientation==='horizontal';
    $('opening-side').options[0].textContent=horizontal?'向图上开':'向图左开';$('opening-side').options[1].textContent=horizontal?'向图下开':'向图右开';
    try{
      const host=geometry.openingHost(state.run.document,o),center=(o.start_px[host.axis]+o.end_px[host.axis])/2;
      $('opening-position').value=scale?Number(((center-host.a)*scale/10).toFixed(4)):'';
      initial.center=center;initial.display.position=$('opening-position').value;
      initial.hostValid=true;
      $('opening-position').max=scale?(host.b-host.a)*scale/10:'';
      $('opening-host').textContent=`所属墙段 ${host.walls.map(w=>w.id).join(' / ')}${scale?` · 可用长度 ${((host.b-host.a)*scale/10).toFixed(1)} cm`:''}`;
      status(scale?'可沿墙拖动 · 开启设置预览后点应用 · Esc 取消':'可设置开启方向；尺寸与移动请先标定比例。');
    }catch(error){$('opening-host').textContent='需要校核所属墙体';status(`${error.message} 开启方向仍可单独设置。`,true);}
  }
  function updateAxis(o,hinge){
    const horizontal=$('opening-axis').value==='horizontal',select=$('opening-hinge');select.replaceChildren();
    if(horizontal){select.append(new Option('上方转轴','top'),new Option('下方转轴','bottom'));$('opening-pivot-help').textContent='0% 底边，100% 顶边；可上下移动转轴。';}
    else{select.append(new Option(o.orientation==='horizontal'?'左端铰链':'起端铰链（底图上端）','start'),new Option(o.orientation==='horizontal'?'右端铰链':'末端铰链（底图下端）','end'));$('opening-pivot-help').textContent='0% 起端，100% 末端；可沿扇宽左右移动转轴。';}
    select.value=[...select.options].some(x=>x.value===hinge)?hinge:horizontal?'top':'start';
  }
  function updateWidthPreset(){
    const o=item();if(!o||o.kind!=='window')return;
    const doc=state.run.document,edited={...o};
    if($('opening-width').value!==initial.display.width&&doc.scale_mm_per_px)edited.dimensions_mm={...o.dimensions_mm,width_mm:Number($('opening-width').value)*10};
    const width=operationModule.windowWidthMm(doc,edited),automatic=$('opening-axis-mode').value==='width';
    if(automatic){
      const op=operationModule.applyWindowPreset(doc,edited,{type:'hinged',axis_mode:'width'});
      $('opening-axis').value=op.pivot_axis;updateAxis(o,op.hinge);$('opening-pivot').value=op.pivot_ratio*100;
    }
    $('opening-width-preset-status').textContent=width===null?'尚未标定比例：暂用侧开，标定后自动按实际宽度判断。':`实际窗宽 ${(width/10).toFixed(1)} cm · ${automatic?(width>=1800?'上方横轴，向上翻开':'侧面竖轴，左右开启'):'手动转轴'}`;
  }
  function updateContext(owner=$('opening-owner').value){
    const o=item();if(!o)return;
    const context=state.openingContexts?.[o.id],select=$('opening-owner');select.replaceChildren(new Option('自动判断室内侧',''));
    const rooms=new Map([...(context?.negative||[]),...(context?.positive||[])].map(r=>[r.id,r]));
    for(const r of rooms.values())select.append(new Option(`${r.id} · ${r.name}`,r.id));
    if(owner&&!rooms.has(owner))select.append(new Option(`${owner}（需校核）`,owner));select.value=owner;
    const mode=$('opening-direction-mode').value,el=$('opening-context-status');
    if(mode==='manual'){el.textContent='按底图手动选择开启侧。';return;}
    try{
      const op=operationModule.resolveOperation(o,{type:o.kind==='door'?'hinged':$('opening-type').value,hinge:$('opening-hinge').value,
        pivot_axis:$('opening-axis').value,side:$('opening-side').value,angle_deg:0,direction_mode:'auto',interior_room_id:owner},context);
      $('opening-side').value=op.side;el.textContent=`${owner?'以所选房间为室内侧':context?.reason||''} · ${o.kind==='door'?'门向内开':'窗向外开'}`;
    }catch(error){el.textContent=`${error.message}；仍可打开，沿用当前开启侧。`;}
  }
  function select(o){current=o.id;state.focusedRoom=null;state.openingPreview=null;form.hidden=false;$('empty-selection').hidden=true;$('room-edit-form').hidden=true;$('opening-selected-id').textContent=`${o.id} · ${o.kind==='window'?'窗':o.kind==='door'?(o.door_model==='entry'?'大入户门':'门'):'待定边界'}`;fill(o);sync();window.dispatchEvent(new CustomEvent('opening-selected',{detail:o.id}));}
  function input(){
    if(!form.checkValidity())throw new Error('请检查门窗尺寸与沿墙位置。');
    const o=item(),scale=state.run.document.scale_mm_per_px;
    const operation=operationModule.resolveOperation(o,{type:o.kind==='door'?'hinged':$('opening-type').value,hinge:$('opening-hinge').value,side:$('opening-side').value,angle_deg:Number($('opening-angle').value),
      pivot_axis:o.kind==='door'?'vertical':$('opening-axis').value,pivot_ratio:Number($('opening-pivot').value)/100,
      ...(o.kind==='window'?{axis_mode:$('opening-axis-mode').value}:{}),
      direction_mode:$('opening-direction-mode').value,interior_room_id:$('opening-owner').value},state.openingContexts?.[current],true);
    const changed=['width','height','sill','position'].some(name=>$('opening-'+name).value!==initial.display[name]);
    if(!scale||!initial.hostValid||!changed)return {opening_id:current,operation,...(o.kind==='door'?{door_model:doorModel}:{})};
    const host=geometry.openingHost(state.run.document,o);
    const length=(name,key)=>$('opening-'+name).value===initial?.display[name]?initial.values[key]:Number($('opening-'+name).value)*10;
    return {opening_id:current,...(o.kind==='door'?{door_model:doorModel}:{}),...(o.operation||JSON.stringify(operation)!==JSON.stringify(initial.operation)?{operation}:{}),dimensions_mm:{width_mm:length('width','width_mm'),height_mm:length('height','height_mm'),sill_height_mm:o.kind==='door'?0:length('sill','sill_height_mm')},center_px:$('opening-position').value===initial?.display.position?initial.center:host.a+Number($('opening-position').value)*10/scale};
  }
  function preview(){
    if(!item()||state.busy)return;
    state.formDirty=true;
    try{const data=input();state.openingPreview=geometry.openingPreview(state.run.document,current,data.dimensions_mm,data.center_px,data.operation,data.door_model);valid=true;status('预览中 · 应用后可撤销、保存');}
    catch(error){state.openingPreview=null;valid=false;status(error.message,true);}
    renderPlan();refresh();window.dispatchEvent(new Event('opening-preview-change'));
  }
  async function commit(data,fromDrag=false){
    const id=current;state.busy='opening-edit';refresh();
    try{
      const result=await api('/api/edit-opening',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({run_id:state.run.run_id,...data})});
      state.busy=false;adoptEdits(result);const o=result.document.openings.find(o=>o.id===id);if(o)focusOpening(o);
      toast(result.changes.at(-1).summary+(result.document.room_partition?.opening_geometry_changed?'；已有房间轮廓已保留，请核对门窗处边界。':''));
    }catch(error){
      state.openingPreview=null;state.formDirty=!fromDrag;if(fromDrag&&item())fill(item());renderPlan();status(`修改未应用，${fromDrag?'已恢复原位：':''}${error.message}`,true);
    }finally{state.busy=false;refresh();window.dispatchEvent(new Event('opening-preview-change'));}
  }
  form.addEventListener('input',event=>{
    if(item()?.kind==='window'&&['opening-axis','opening-hinge','opening-pivot'].includes(event.target.id))$('opening-axis-mode').value='manual';
    if(event.target.id==='opening-type')$('opening-angle').value=$('opening-type').value==='fixed'?0:45;
    if(event.target.id==='opening-axis'){updateAxis(item(),null);$('opening-pivot').value=$('opening-hinge').value==='top'?100:0;}
    if(event.target.id==='opening-hinge')$('opening-pivot').value=['end','top'].includes($('opening-hinge').value)?100:0;
    if(event.target.id==='opening-pivot')$('opening-hinge').value=$('opening-axis').value==='horizontal'?(Number($('opening-pivot').value)>50?'top':'bottom'):(Number($('opening-pivot').value)>50?'end':'start');
    if(['opening-hinge','opening-side','opening-axis','opening-owner','opening-pivot'].includes(event.target.id)&&!item()?.operation&&Number($('opening-angle').value)===0)$('opening-angle').value=item()?.kind==='door'?90:45;
    if(event.target.id==='opening-axis-mode'&&$('opening-axis-mode').value==='width')$('opening-angle').value=45;
    updateWidthPreset();
    updateContext();
    preview();
  });
  form.addEventListener('submit',event=>{event.preventDefault();if(!state.busy&&valid)handle(commit(input()));});
  $('opening-floor-glass').addEventListener('click',()=>{
    $('opening-height').value=(state.run.document.model_settings?.wall_height_mm??2800)/10;$('opening-sill').value=0;preview();
  });
  for(const button of form.querySelectorAll('[data-door-width]'))button.addEventListener('click',()=>{
    $('opening-width').value=button.dataset.doorWidth;doorModel=button.id==='opening-entry-door'?'entry':'standard';if(doorModel==='entry')$('opening-height').value=210;preview();
  });
  $('opening-door-scale').addEventListener('click',()=>handle((async()=>{
    if(state.busy||state.formDirty||item()?.kind!=='door')return;
    const id=current;state.busy='door-scale';refresh();
    try{
      const result=await api('/api/model-settings',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({run_id:state.run.run_id,door_calibration:{opening_id:id,width_mm:800}})});
      state.busy=false;adoptEdits(result);
      const o=result.document.openings.find(o=>o.id===id);if(o)focusOpening(o,{scroll:false});
      toast(`已按 ${id} 门洞 80 cm 估算全图比例，可查看三维、撤销或重新标定。`);
    }finally{state.busy=false;refresh();}
  })()));
  function discard(){state.openingPreview=null;state.formDirty=false;if(item())fill(item());renderPlan();refresh();window.dispatchEvent(new Event('opening-preview-change'));}
  $('opening-discard').addEventListener('click',discard);
  $('opening-close').addEventListener('click',()=>{if(state.busy)return;clearSelection();window.dispatchEvent(new Event('opening-preview-change'));});
  function point(event){const p=$('plan').createSVGPoint();p.x=event.clientX;p.y=event.clientY;const t=p.matrixTransform($('plan').getScreenCTM().inverse());return [t.x,t.y];}
  function update(event){
    const g=gesture;if(!g)return;
    const p=point(event),moved=Math.hypot(event.clientX-g.client[0],event.clientY-g.client[1])>4;
    g.moved ||= moved;if(!g.moved)return;
    const desired=g.center+p[g.axis]-g.start[g.axis];
    try{
      state.openingPreview=geometry.openingPreview(state.run.document,current,g.dimensions,desired);valid=true;g.valid=true;
      const o=state.openingPreview.openings.find(o=>o.id===current),actual=(o.start_px[g.axis]+o.end_px[g.axis])/2;
      g.data={opening_id:current,dimensions_mm:g.dimensions,center_px:actual};
      $('opening-position').value=Number(((actual-g.host.a)*state.run.document.scale_mm_per_px/10).toFixed(4));
      status('沿墙移动中 · 松手应用 · Esc 取消');
    }catch(error){g.valid=false;status(error.message,true);}
    renderPlan();window.dispatchEvent(new Event('opening-preview-change'));
  }
  function release(){const g=gesture;gesture=null;cancelAnimationFrame(frame);frame=0;if(g&&$('stage').hasPointerCapture(g.pointer))$('stage').releasePointerCapture(g.pointer);state.busy=false;state.formDirty=false;return g;}
  function cancel(){if(!gesture)return;release();discard();}
  $('plan').addEventListener('pointerdown',event=>{
    const id=event.target.closest('[data-opening-id]')?.dataset.openingId;
    if(!id||event.button!==0||state.mode!=='select'||state.busy||state.formDirty||!geometry)return;
    const o=state.run.document.openings.find(o=>o.id===id);if(!o)return;
    // Unscaled and unclassified candidates still support ordinary selection.
    if(!state.run.document.scale_mm_per_px||!['door','window'].includes(o.kind)||o.requires_confirmation&&o.review_status!=='confirmed')return;
    let host;try{host=geometry.openingHost(state.run.document,o);}catch{return;}
    event.preventDefault();event.stopImmediatePropagation();focusOpening(o,{scroll:false});
    gesture={pointer:event.pointerId,start:point(event),client:[event.clientX,event.clientY],host,axis:host.axis,center:(o.start_px[host.axis]+o.end_px[host.axis])/2,dimensions:geometry.openingValues(state.run.document,o),moved:false,valid:true};
    $('stage').setPointerCapture(event.pointerId);state.busy='opening-drag';state.formDirty=true;refresh();
  },true);
  document.addEventListener('pointermove',event=>{if(!gesture||gesture.pointer!==event.pointerId)return;event.preventDefault();cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>update(event));},{capture:true,passive:false});
  document.addEventListener('pointerup',event=>{
    if(!gesture||gesture.pointer!==event.pointerId)return;
    event.preventDefault();event.stopImmediatePropagation();update(event);const g=release();suppressUntil=performance.now()+350;
    if(!g.moved||!g.valid||!g.data||Math.abs(g.data.center_px-g.center)<1e-7){discard();return;}
    handle(commit(g.data,true));
  },true);
  document.addEventListener('pointercancel',event=>{if(gesture?.pointer===event.pointerId)cancel();},true);
  $('stage').addEventListener('lostpointercapture',()=>{if(gesture)cancel();});
  document.addEventListener('click',event=>{if(performance.now()<suppressUntil&&event.target.closest('#stage')){event.preventDefault();event.stopImmediatePropagation();}},true);
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&(gesture||current&&state.formDirty)){event.preventDefault();event.stopImmediatePropagation();if(gesture)cancel();else if(!state.busy)discard();}},true);
  window.addEventListener('blur',()=>{if(gesture)cancel();});
  window.addEventListener('wall-state-change',sync);
  window.openingEditor={clear,select};
})();
