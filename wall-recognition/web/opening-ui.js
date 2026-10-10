'use strict';
(() => {
  const form=$('opening-form');let geometry=null,current=null,gesture=null,frame=0,suppressUntil=0,valid=true,initial=null;
  import('./opening-edit.mjs').then(module=>{geometry=module;if(item())fill(item());sync();}).catch(error=>toast(`门窗编辑加载失败：${error.message}`,true));
  const item=()=>state.run?.document.openings.find(o=>o.id===current);
  const status=(text,error=false)=>{const el=$('opening-edit-status');el.textContent=text;el.style.color=error?'#b34735':'';};
  function clear(){current=null;initial=null;state.openingPreview=null;form.hidden=true;}
  function sync(){
    if(current&&!item()){clear();return;}
    const o=item(),enabled=Boolean(geometry&&o&&state.run?.document.scale_mm_per_px&&['door','window'].includes(o.kind)&&o.review_status!=='rejected'&&(!o.requires_confirmation||o.review_status==='confirmed'));
    for(const field of form.querySelectorAll('input,button'))field.disabled=Boolean(state.busy)||!enabled;
    $('opening-close').disabled=Boolean(state.busy);
    $('opening-sill').disabled=Boolean(state.busy)||!enabled||o?.kind==='door';
    $('opening-floor-glass').hidden=o?.kind!=='window';
    $('opening-apply').disabled=Boolean(state.busy)||!enabled||!valid;
  }
  function fill(o){
    if(!geometry)return;
    valid=true;const scale=state.run.document.scale_mm_per_px;
    const values=geometry.openingValues(state.run.document,o);
    for(const [key,name] of [['width_mm','width'],['height_mm','height'],['sill_height_mm','sill']])$('opening-'+name).value=scale?Number((values[key]/10).toFixed(4)):'';
    initial={values,display:Object.fromEntries(['width','height','sill'].map(name=>[name,$('opening-'+name).value]))};
    try{
      const host=geometry.openingHost(state.run.document,o),center=(o.start_px[host.axis]+o.end_px[host.axis])/2;
      $('opening-position').value=scale?Number(((center-host.a)*scale/10).toFixed(4)):'';
      initial.center=center;initial.display.position=$('opening-position').value;
      $('opening-position').max=scale?(host.b-host.a)*scale/10:'';
      $('opening-host').textContent=`所属墙段 ${host.walls.map(w=>w.id).join(' / ')}${scale?` · 可用长度 ${((host.b-host.a)*scale/10).toFixed(1)} cm`:''}`;
      status(scale?'可沿墙拖动 · 松手应用 · Esc 取消':'请先在「测量」中标定比例，再按厘米编辑。');
    }catch(error){valid=false;$('opening-host').textContent='需要校核所属墙体';status(error.message,true);}
  }
  function select(o){current=o.id;state.focusedRoom=null;state.openingPreview=null;form.hidden=false;$('empty-selection').hidden=true;$('room-edit-form').hidden=true;$('opening-selected-id').textContent=`${o.id} · ${o.kind==='window'?'窗':o.kind==='door'?'门':'待定边界'}`;fill(o);sync();}
  function input(){
    if(!form.checkValidity())throw new Error('请检查门窗尺寸与沿墙位置。');
    const o=item(),host=geometry.openingHost(state.run.document,o),scale=state.run.document.scale_mm_per_px;
    const length=(name,key)=>$('opening-'+name).value===initial?.display[name]?initial.values[key]:Number($('opening-'+name).value)*10;
    return {opening_id:current,dimensions_mm:{width_mm:length('width','width_mm'),height_mm:length('height','height_mm'),sill_height_mm:o.kind==='door'?0:length('sill','sill_height_mm')},center_px:$('opening-position').value===initial?.display.position?initial.center:host.a+Number($('opening-position').value)*10/scale};
  }
  function preview(){
    if(!item()||state.busy)return;
    state.formDirty=true;
    try{const data=input();state.openingPreview=geometry.openingPreview(state.run.document,current,data.dimensions_mm,data.center_px);valid=true;status('预览中 · 应用后可撤销、保存');}
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
  form.addEventListener('input',preview);
  form.addEventListener('submit',event=>{event.preventDefault();if(!state.busy&&valid)handle(commit(input()));});
  $('opening-floor-glass').addEventListener('click',()=>{
    $('opening-height').value=(state.run.document.model_settings?.wall_height_mm??2800)/10;$('opening-sill').value=0;preview();
  });
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
