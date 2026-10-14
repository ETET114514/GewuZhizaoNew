'use strict';
(() => {
  let geometry=null,kind=null,preview=null,pointer=null,suppressUntil=0,frame=0,lastDocument=null,doorModel='standard';
  import('./opening-edit.mjs').then(module=>{geometry=module;sync();}).catch(error=>toast(error.message,true));
  const panel=document.createElement('div');panel.className='ribbon-group';
  panel.innerHTML='<span class="ribbon-caption">新增门窗</span><div class="ribbon-actions"><button id="add-door" class="button" disabled>新增门</button><button id="add-entry-door" class="button" disabled>新增大入户门</button><button id="add-window" class="button" disabled>新增窗</button></div><form id="opening-place-form" hidden><label class="field" id="new-door-preset-field">门洞预设<select id="new-door-preset"><option value="120">大入户门 · 120 × 210 cm</option><option value="90" selected>卧室门 · 90 cm</option><option value="80">卫生间门 · 80 cm</option><option value="custom">自定义</option></select><span class="opening-help">左右门套各 5 cm，合计 10 cm</span></label><label class="field">洞口宽（cm）<input id="new-opening-width" type="number" min="10" max="2000" step="any" value="80" required></label><label class="field">洞口高（cm）<input id="new-opening-height" type="number" min="10" max="2000" step="any" value="210" required></label><label class="field" id="new-opening-sill-field">窗台高（cm）<input id="new-opening-sill" type="number" min="0" max="2000" step="any" value="90" required></label><button id="cancel-opening-place" class="button" type="button">取消放置</button></form><p id="opening-place-status" class="ribbon-note" role="status">先识别并标定比例，再在墙上新增门窗。</p>';
  $('tools-edit').append(panel);
  function sync(){
    const doc=state.run?.document;
    if(kind&&lastDocument!==doc)cancel();lastDocument=doc;
    const ready=Boolean(geometry&&state.run?.document.scale_mm_per_px&&!state.busy&&!state.formDirty);
    for(const id of ['add-door','add-entry-door','add-window'])$(id).disabled=!ready;
    for(const el of $('opening-place-form').querySelectorAll('input,select,button'))el.disabled=Boolean(state.busy);
  }
  function cancel(){
    kind=null;preview=null;state.openingPreview=null;cancelAnimationFrame(frame);
    if(pointer!==null&&$('stage').hasPointerCapture(pointer))$('stage').releasePointerCapture(pointer);pointer=null;
    $('opening-place-form').hidden=true;if(state.mode==='opening-place')setMode('select');
    $('opening-place-status').textContent='先标定比例，再选择门窗预设并沿墙放置。';
    if(state.run)renderPlan();
  }
  function arm(value,entry=false){
    if(!geometry||!state.run||state.busy||state.formDirty)return;
    clearSelection();kind=value;doorModel='standard';setMode('opening-place');$('openings-toggle').checked=true;$('overlay-toggle').checked=true;
    const settings=state.run.document.model_settings||{};
    $('new-door-preset-field').hidden=value!=='door';$('new-door-preset').value='90';
    $('new-opening-width').value=value==='door'?90:(settings.window_width_mm??800)/10;
    $('new-opening-height').value=(value==='door'?(settings.door_height_mm??2100):(settings.window_height_mm??1500))/10;
    if(entry){doorModel='entry';$('new-door-preset').value='120';$('new-opening-width').value=120;$('new-opening-height').value=210;}
    $('new-opening-sill').value=(settings.sill_height_mm??900)/10;
    $('new-opening-sill-field').hidden=value==='door';$('opening-place-form').hidden=false;
    $('opening-place-status').textContent=`移动到墙上预览${value==='door'?'门':'窗'}，点击放置 · Esc 取消`;
    $('plan').style.cursor='crosshair';
  }
  function update(event){
    if(!kind||state.busy)return;preview=null;state.openingPreview=null;
    const p=imagePoint(event),doc=state.run.document;
    const rect=$('plan').getBoundingClientRect();
    if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom){renderPlan();return;}
    const candidates=doc.walls.filter(w=>w.review_status!=='rejected').map(w=>{
      const axis=w.orientation==='horizontal'?0:1,along=p[axis],cross=Math.abs(p[1-axis]-w.start_px[1-axis]);
      return {w,axis,along,distance:cross,valid:along>=w.start_px[axis]&&along<=w.end_px[axis]&&cross<=w.thickness_px/2+12/state.zoom};
    }).filter(t=>t.valid).sort((a,b)=>a.distance-b.distance);
    try{
      if(!candidates.length)throw new Error('请移动到墙段上放置。');
      const target=candidates[0],dimensions={width_mm:Number($('new-opening-width').value)*10,height_mm:Number($('new-opening-height').value)*10,sill_height_mm:kind==='door'?0:Number($('new-opening-sill').value)*10};
      for(const id of ['new-opening-width','new-opening-height',...(kind==='window'?['new-opening-sill']:[])])if(!$(id).value.trim())throw new Error('请完整填写门窗尺寸。');
      state.openingPreview=geometry.newOpeningPreview(doc,target.w.id,kind,dimensions,target.along,doorModel);
      const o=state.openingPreview.openings.find(o=>o.id==='待新增');
      preview={action:'add',kind,...(kind==='door'?{door_model:doorModel}:{}),wall_id:target.w.id,dimensions_mm:dimensions,center_px:(o.start_px[target.axis]+o.end_px[target.axis])/2};
      $('opening-place-status').textContent=`${target.w.id} · ${kind==='door'?'门':'窗'} ${dimensions.width_mm/10} × ${dimensions.height_mm/10} cm · 点击放置`;
    }catch(error){$('opening-place-status').textContent=error.message;}
    renderPlan();
  }
  async function finish(event){
    if(pointer!==event.pointerId)return;
    event.preventDefault();event.stopImmediatePropagation();update(event);
    const id=pointer;pointer=null;if($('stage').hasPointerCapture(id))$('stage').releasePointerCapture(id);
    suppressUntil=performance.now()+350;if(!preview)return;
    const input=preview;state.busy='opening-add';refresh();
    try{
      const result=await api('/api/edit-opening',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({run_id:state.run.run_id,...input})});
      state.busy=false;cancel();adoptEdits(result);
      focusOpening(result.document.openings.find(o=>o.id===result.changes.at(-1).opening_id),{scroll:false});
      toast(result.changes.at(-1).summary);
    }catch(error){state.openingPreview=null;preview=null;renderPlan();toast(`门窗未放置：${error.message}`,true);}
    finally{state.busy=false;refresh();}
  }
  $('add-door').addEventListener('click',()=>arm('door'));$('add-entry-door').addEventListener('click',()=>arm('door',true));$('add-window').addEventListener('click',()=>arm('window'));
  $('cancel-opening-place').addEventListener('click',cancel);
  $('opening-place-form').addEventListener('submit',event=>event.preventDefault());
  $('opening-place-form').addEventListener('input',event=>{
    if(event.target.id==='new-door-preset'&&event.target.value!=='custom'){$('new-opening-width').value=event.target.value;doorModel=event.target.value==='120'?'entry':'standard';if(doorModel==='entry')$('new-opening-height').value=210;}
    if(event.target.id==='new-opening-width')$('new-door-preset').value='custom';
    preview=null;state.openingPreview=null;renderPlan();$('opening-place-status').textContent='尺寸已修改，请移动到墙上重新预览。';});
  $('plan').addEventListener('pointerdown',event=>{
    if(state.mode!=='opening-place'||state.busy||event.button!==0)return;
    event.preventDefault();event.stopImmediatePropagation();pointer=event.pointerId;$('stage').setPointerCapture(pointer);update(event);
  },true);
  document.addEventListener('pointermove',event=>{if(state.mode!=='opening-place'||state.busy)return;cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>update(event));},true);
  document.addEventListener('pointerup',event=>{if(pointer===event.pointerId)handle(finish(event));},true);
  document.addEventListener('click',event=>{if((state.mode==='opening-place'||performance.now()<suppressUntil)&&event.target.closest('#stage')){event.preventDefault();event.stopImmediatePropagation();}},true);
  document.addEventListener('pointercancel',event=>{if(pointer===event.pointerId)cancel();},true);
  $('stage').addEventListener('lostpointercapture',()=>{if(pointer!==null)cancel();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&kind&&!state.busy){event.preventDefault();cancel();}},true);
  window.addEventListener('blur',()=>{if(kind&&!state.busy)cancel();});
  window.addEventListener('wall-state-change',sync);
  window.addEventListener('opening-selected',()=>{if(kind&&!state.busy)cancel();});
  window.addEventListener('wall-mode-change',()=>{if(kind&&state.mode!=='opening-place')cancel();});
})();
