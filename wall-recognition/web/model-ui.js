'use strict';
(() => {
  let points=null,drag=null,viewer=null,defaults=null,lastDocument=null,modelDirty=false;
  const dialog=$('model-dialog'),form=$('model-form'),furnitureForm=$('model-furniture-form');
  let furnitureModule=null,furnitureMoveModule=null,furnitureId=null,furnitureDirty=false,furnitureMoving=false,nudge=null,furnitureValues=null;
  const lengths=new Set(['x','y','width','depth','height','elevation']);
  const displayValue=(key,value)=>typeof value==='number'?Math.round(value/(lengths.has(key)?10:1)*1000)/1000:value;
  const item=()=>state.run?.document.furniture?.find(f=>f.id===furnitureId);
  const pending=()=>modelDirty||furnitureDirty||furnitureMoving||Boolean(window.ceilingUI?.dirty);
  function syncWidthControls(){
    const preset=form.querySelector('[data-setting="width_mode"]').value==='preset';
    for(const key of ['door_width_mm','opening_width_mm','window_width_mm'])form.querySelector(`[data-setting="${key}"]`).disabled=Boolean(state.busy)||furnitureDirty||furnitureMoving||window.ceilingUI?.dirty||!preset;
  }
  function message(text,error=false){$('model-message').textContent=text;$('model-message').style.color=error?'#b34735':'';}
  function drawLine(){
    if(!points)return;
    const [a,b]=points,layer=$('draft-layer');layer.replaceChildren(svgElement('line',{x1:a[0],y1:a[1],x2:b[0],y2:b[1],class:'calibration-line'}));
    for(const p of points)layer.append(svgElement('circle',{cx:p[0],cy:p[1],r:5/state.zoom,class:'calibration-point'}));
  }
  function cancelCalibration(){points=null;drag=null;$('calibration-form').hidden=true;if(state.mode==='calibrate'){state.formDirty=false;setMode('select');}}
  function sync(){
    const doc=state.run?.document,ready=Boolean(doc);
    $('calibrate').disabled=!ready||Boolean(state.busy);
    $('open-model').disabled=!ready||Boolean(state.busy);
    $('calibration-status').textContent=doc?.scale_mm_per_px?`${doc.calibration?.method==='door_width'?`${doc.calibration.automatic?'默认门洞估算':'门洞估算'} · ${doc.calibration.opening_id} / ${doc.calibration.width_mm/10} cm`:doc.calibration?.method==='wall_thickness'?'墙厚估算':'长度标定'} · ${doc.scale_mm_per_px.toFixed(3)} mm/px · 可重新标定`:'默认按合适的普通门洞 80 cm 估算比例；无合适门时可拉线标定。';
    const scaleChoice=$('scale-wall').value;
    $('scale-wall').replaceChildren();for(const w of doc?.walls||[])if(w.review_status!=='rejected'&&(w.solid_parts??[w]).length)$('scale-wall').append(new Option(`${w.id} · 图上厚 ${w.thickness_px.toFixed(1)} px`,w.id));
    if([...$('scale-wall').options].some(o=>o.value===scaleChoice))$('scale-wall').value=scaleChoice;
    for(const el of $('wall-calibration-form').querySelectorAll('input,select,button'))el.disabled=Boolean(state.busy)||!$('scale-wall').options.length;
    for(const el of $('calibration-form').querySelectorAll('input,button'))el.disabled=Boolean(state.busy);
    for(const el of form.querySelectorAll('input,select,button'))el.disabled=Boolean(state.busy)||furnitureDirty||furnitureMoving||window.ceilingUI?.dirty;
    for(const el of furnitureForm.querySelectorAll('input,button'))el.disabled=Boolean(state.busy)||modelDirty||furnitureMoving||window.ceilingUI?.dirty;
    $('model-furniture-select').disabled=Boolean(state.busy)||pending();
    $('model-save').disabled=Boolean(state.busy)||pending();$('model-undo').disabled=Boolean(state.busy)||!state.historySize||pending();
    $('close-model').disabled=Boolean(state.busy)||furnitureMoving;
    $('model-move').disabled=Boolean(state.busy)||pending()||!item()||doc?.model_settings?.show_furniture===false;
    for(const id of ['model-reset','model-top','model-wall-ghost'])$(id).disabled=Boolean(state.busy)||furnitureMoving;
    viewer?.setInteractionEnabled(!state.busy&&!pending());
    $('mf-step').disabled=Boolean(state.busy)||pending()||!item();
    for(const id of ['mf-fit-left','mf-fit-right','mf-turn-left','mf-turn-right'])$(id).disabled=Boolean(state.busy)||pending()||!item();
    $('mf-copy').disabled=Boolean(state.busy)||pending()||!furnitureMoveModule?.canCopyFurniture(item());
    for(const button of document.querySelectorAll('[data-nudge]'))button.disabled=Boolean(state.busy)||modelDirty||furnitureDirty||!item()||doc?.model_settings?.show_furniture===false||(furnitureMoving&&!nudge);
    if(doc!==lastDocument){lastDocument=doc;
      if(dialog.open&&doc?.scale_mm_per_px&&viewer){fillSettings();fillFurniture();renderModel(false);}
      else if(dialog.open&&!doc?.scale_mm_per_px){dialog.close();toast('比例标定已撤销，请重新标定后查看三维。');}
    }
    syncWidthControls();
  }
  function moveFurniture(event){
    if(event.phase==='start'){
      if(state.busy||pending()||event.id!==furnitureId)return false;
      furnitureMoving=true;state.formDirty=true;sync();$('mf-status').textContent='移动中 · 松手应用，Esc 取消';return true;
    }
    if(event.phase==='preview'){
      showPosition(event.placement);
      const gapText=(event.gaps||[]).map(g=>`${g.target} ${(g.distance*state.run.document.scale_mm_per_px/10).toFixed(1)} cm`).join(' · ');
      $('model-move-status').textContent+=(event.guides?.length?' · 已吸附':'')+(gapText?` · 间距 ${gapText}`:'');
      return;
    }
    furnitureMoving=false;state.formDirty=false;
    if(event.phase==='cancel'){fillFurniture();sync();$('model-move-status').textContent='移动已取消';return;}
    commitFurnitureMove(event);
  }
  function showPosition(placement){
    $('mf-x').value=displayValue('x',placement.center_x_mm);$('mf-y').value=displayValue('y',placement.center_y_mm);
    $('model-move-status').textContent=`X ${(placement.center_x_mm/10).toFixed(2)} · Y ${(placement.center_y_mm/10).toFixed(2)} cm`;
  }
  function stepNudge(){
    if(!nudge)return;
    const p=nudge.placement,step=nudge.step;
    const next=furnitureMoveModule.movePlacement(state.run.document,item(),p.center_x_mm+nudge.dx*step,p.center_y_mm+nudge.dy*step);
    if(!next)return;
    nudge.placement=next;viewer.previewFurniturePosition(furnitureId,next);showPosition(next);
    $('mf-status').textContent='即时移动中 · 松手应用，Esc 取消';
  }
  function startNudge(button,pointerId=null){
    if(state.busy||pending()||!item()||!furnitureMoveModule)return false;
    const step=Number($('mf-step').value);
    if(!$('mf-step').checkValidity()||!Number.isFinite(step)||step<=0){message('移动步长需在 0.1～100 cm 之间。',true);return false;}
    const directions={up:[0,-1],down:[0,1],left:[-1,0],right:[1,0]},[dx,dy]=directions[button.dataset.nudge];
    const f=item(),s=state.run.document.scale_mm_per_px,b=f.bbox_px;
    const initial=furnitureMoveModule.movePlacement(state.run.document,f,(b[0]+b[2])/2*s,(b[1]+b[3])/2*s);if(!initial)return false;
    nudge={button,pointerId,dx,dy,step:step*10,placement:initial,startX:(b[0]+b[2])/2*s,startY:(b[1]+b[3])/2*s,timer:null};
    furnitureMoving=true;state.formDirty=true;sync();stepNudge();
    return true;
  }
  function finishNudge(cancelled=false){
    if(!nudge)return;const move=nudge;nudge=null;clearTimeout(move.timer);
    if(move.pointerId!==null&&move.button.hasPointerCapture(move.pointerId))move.button.releasePointerCapture(move.pointerId);
    furnitureMoving=false;state.formDirty=false;
    const changed=Math.hypot(move.placement.center_x_mm-move.startX,move.placement.center_y_mm-move.startY)>.1;
    if(cancelled||!changed){viewer.restoreFurniturePosition();fillFurniture();sync();$('model-move-status').textContent=cancelled?'移动已取消':'已到达底图边界';return;}
    commitFurnitureMove({id:furnitureId,placement:move.placement});
  }
  for(const button of document.querySelectorAll('[data-nudge]')){
    button.addEventListener('pointerdown',event=>{
      if(event.button!==0||!startNudge(button,event.pointerId))return;
      event.preventDefault();button.setPointerCapture(event.pointerId);
      const repeat=()=>{if(!nudge||nudge.button!==button)return;stepNudge();nudge.timer=setTimeout(repeat,100);};
      nudge.timer=setTimeout(repeat,300);
    });
    button.addEventListener('pointerup',event=>{if(nudge?.button===button&&nudge.pointerId===event.pointerId)finishNudge();});
    button.addEventListener('pointercancel',()=>{if(nudge?.button===button)finishNudge(true);});
    button.addEventListener('lostpointercapture',()=>{if(nudge?.button===button)finishNudge(true);});
    button.addEventListener('click',event=>{if(event.detail===0&&startNudge(button))finishNudge();});
  }
  window.addEventListener('blur',()=>finishNudge(true));
  window.addEventListener('keydown',event=>{if(event.key==='Escape'&&nudge){event.preventDefault();event.stopImmediatePropagation();finishNudge(true);}},true);
  async function commitFurnitureMove(event){
    state.busy='furniture-move';refresh();
    try{
      const result=await api('/api/edit-furniture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({run_id:state.run.run_id,action:'update',furniture_id:event.id,placement_mm:event.placement})});
      state.busy=false;adoptEdits(result);$('model-move-status').textContent='位置已应用 · 可撤销';message('家具位置已同步二维，可保存项目。');
    }catch(error){fillFurniture();renderModel();$('model-move-status').textContent='移动未应用，已恢复原位';message(error.message,true);}
    finally{state.busy=false;refresh();}
  }
  $('model-move').addEventListener('click',()=>{
    const enabled=$('model-move').getAttribute('aria-pressed')!=='true';
    $('model-move').setAttribute('aria-pressed',String(enabled));viewer?.setMoveEnabled(enabled);
    $('model-gesture').textContent=enabled?'拖动选中家具移动 · 松手应用 · Esc 取消 · 空白处拖动旋转':'拖动旋转 · 滚轮缩放 · 右键平移';
    $('model-move-status').textContent=enabled?'拖动高亮家具，或先俯视 / 淡化墙体':'浏览模式';
  });
  function fillSettings(){
    const settings={...defaults,...state.run.document.model_settings};
    for(const el of form.querySelectorAll('[data-setting]')){const value=settings[el.dataset.setting];if(el.type==='checkbox')el.checked=value;else el.value=value;}
    modelDirty=false;$('model-draft-status').textContent='参数随项目保存，可在应用后撤销。';
    syncWidthControls();
  }
  function readSettings(){
    const result={};for(const el of form.querySelectorAll('[data-setting]'))result[el.dataset.setting]=el.type==='checkbox'?el.checked:el.type==='number'?Number(el.value):el.value;
    if(!form.checkValidity())throw new Error('请检查尺寸输入范围。');
    if(result.door_height_mm>result.wall_height_mm)throw new Error('门洞高度不能大于墙高。');
    if(result.sill_height_mm+result.window_height_mm>result.wall_height_mm)throw new Error('窗台与窗洞高度之和不能大于墙高。');
    if(result.door_width_mm>result.opening_width_mm)throw new Error('预设门扇宽不能大于门洞宽。');
    return result;
  }
  function renderModel(fit=false,draft=false){
    const source=state.ceilingPreview||state.openingPreview||state.run.document;
    let doc=draft?{...source,model_settings:readSettings()}:source;
    if(furnitureDirty){const input=readFurniture();doc=furnitureModule.furniturePreview(doc,furnitureId,input.placement_mm,input.model_3d);}
    const model=viewer.update(doc,state.run.image_url,fit);
    const ceilingSummary=`${model.ceilingRoomCount-model.ceilingSupplementalCount} 个房间顶面${model.ceilingSupplementalCount?` · ${model.ceilingSupplementalCount} 个默认预览顶面`:''}`;
    $('model-summary').textContent=`${model.wallCount} 段墙 · ${model.openings.length} 处门窗 · ${model.furnitureCount} 件家具 · ${ceilingSummary} · 墙高 ${(model.height*1000).toFixed(0)} mm`;
    const warnings=[...model.warnings,...(doc.ceiling_layout?.warnings||[])];
    $('model-warning-list').replaceChildren();for(const warning of warnings){const li=document.createElement('li');li.textContent=warning;$('model-warning-list').append(li);}
    $('model-warnings').hidden=!warnings.length;
    viewer.setCeilingVisible(window.ceilingUI?.roofVisible||false);
  }
  async function applySettings(payload){
    if(state.busy)throw new Error('请等待当前操作完成。');
    const priorDirty=state.formDirty;state.busy='model';refresh();
    try{
      const result=await api('/api/model-settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({run_id:state.run.run_id,...payload})});
      state.busy=false;modelDirty=false;adoptEdits(result);message('已应用，可保存项目保留设置。');
    }catch(error){state.formDirty=priorDirty;throw error;}
    finally{state.busy=false;refresh();}
  }
  function fillFurniture(){
    if(!furnitureModule)return;
    const items=(state.run?.document.furniture||[]).filter(f=>f.review_status!=='rejected'&&furnitureModule.furnitureSettings(f));
    $('model-furniture-select').replaceChildren(new Option(items.length?'选择家具':'没有已确认类别的家具',''));
    for(const f of items)$('model-furniture-select').append(new Option(`${f.id} · ${furnitureModule.furnitureLabel(f)}`,f.id));
    if(!items.some(f=>f.id===furnitureId))furnitureId=null;
    $('model-furniture-select').value=furnitureId||'';furnitureForm.hidden=!furnitureId;
    furnitureDirty=false;viewer?.selectFurniture(furnitureId);
    const f=item();furnitureValues=null;if(!f)return;
    const scale=state.run.document.scale_mm_per_px,b=f.bbox_px,options=furnitureModule.furnitureSettings(f);
    const values={x:(b[0]+b[2])/2*scale,y:(b[1]+b[3])/2*scale,width:(b[2]-b[0])*scale,depth:(b[3]-b[1])*scale,height:options.height_mm,elevation:options.elevation_mm,rotation:options.rotation_deg,color:options.color};
    furnitureValues=values;
    for(const [key,value] of Object.entries(values))$('mf-'+key).value=displayValue(key,value);
    $('mf-x').max=state.run.document.image.width_px*scale/10;$('mf-y').max=state.run.document.image.height_px*scale/10;
    $('mf-fit-status').textContent=`框内转向 ${options.fit_rotation_deg}° · 修正方向后仍贴合当前识别框`;
    $('mf-status').textContent=['shower','wet_area'].includes(f.kind)?'围挡与底盘随长宽贴合；喷头组件保持固定厘米尺寸。应用后可撤销、保存。':'应用后同步二维，可撤销并随项目保存。';
  }
  function selectFurniture(id){
    if(state.busy||pending()){message('请先应用或放弃当前修改，再选择家具。',true);return;}
    furnitureId=id;fillFurniture();$('model-furniture-select').scrollIntoView({block:'nearest'});sync();
    if(state.run.document.model_settings?.show_furniture===false)message('家具图层当前隐藏，可在全局显示设置中开启。');
  }
  function readFurniture(){
    if(!furnitureForm.checkValidity())throw new Error('请检查家具尺寸、位置和角度的输入范围。');
    // Preserve untouched dimensions at full precision, especially at rotated image edges.
    const val=key=>{const value=Number($('mf-'+key).value);return furnitureValues&&value===displayValue(key,furnitureValues[key])?furnitureValues[key]:value*(lengths.has(key)?10:1);};
    const placement_mm={center_x_mm:val('x'),center_y_mm:val('y'),width_mm:val('width'),depth_mm:val('depth')};
    const model_3d={height_mm:val('height'),elevation_mm:val('elevation'),rotation_deg:val('rotation'),fit_rotation_deg:item().model_3d?.fit_rotation_deg||0,color:$('mf-color').value};
    const angle=model_3d.rotation_deg*Math.PI/180,w=placement_mm.width_mm,d=placement_mm.depth_mm;
    const rx=(Math.abs(Math.cos(angle))*w+Math.abs(Math.sin(angle))*d)/2,ry=(Math.abs(Math.sin(angle))*w+Math.abs(Math.cos(angle))*d)/2;
    const doc=state.run.document,s=doc.scale_mm_per_px;
    if(val('x')-rx<-.0001||val('y')-ry<-.0001||val('x')+rx>doc.image.width_px*s+.0001||val('y')+ry>doc.image.height_px*s+.0001)throw new Error('旋转后的家具超出底图，请调整中心位置或尺寸。');
    return {placement_mm,model_3d};
  }
  function previewFurniture(){
    furnitureDirty=true;state.formDirty=true;sync();
    try{const input=readFurniture();viewer.previewFurniture(furnitureModule.furniturePreview(state.run.document,furnitureId,input.placement_mm,input.model_3d),furnitureId);$('mf-status').textContent='即时预览 · 尚未应用';}
    catch(error){$('mf-status').textContent=error.message;}
  }
  $('model-furniture-select').addEventListener('change',()=>selectFurniture($('model-furniture-select').value||null));
  furnitureForm.addEventListener('input',previewFurniture);
  $('mf-focus').addEventListener('click',()=>{$('model-wall-ghost').checked=true;viewer?.setWallGhost(true);viewer?.focusFurniture(furnitureId);});
  $('model-wall-ghost').addEventListener('change',()=>viewer?.setWallGhost($('model-wall-ghost').checked));
  $('mf-reset').addEventListener('click',()=>{
    const f=item();if(!f)return;const options=furnitureModule.furnitureSettings({...f,model_3d:undefined});
    for(const [key,value] of Object.entries({height:options.height_mm,elevation:0,rotation:0,color:options.color}))$('mf-'+key).value=displayValue(key,value);
    previewFurniture();
  });
  $('mf-discard').addEventListener('click',()=>{state.formDirty=false;fillFurniture();renderModel();sync();});
  async function turn(delta,fit=false){
    if(state.busy||pending()||!item()||!furnitureMoveModule)return;
    try{
      const preview=(fit?furnitureMoveModule.fitTurnFurniture:furnitureMoveModule.turnFurniture)(state.run.document,item(),delta);
      viewer.previewFurniture({...state.run.document,furniture:state.run.document.furniture.map(f=>f.id===furnitureId?preview:f)},furnitureId);
      state.busy='furniture-turn';refresh();
      const result=await api('/api/edit-furniture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({run_id:state.run.run_id,action:'update',furniture_id:furnitureId,model_3d:{rotation_deg:preview.model_3d.rotation_deg,...(fit?{fit_rotation_deg:preview.model_3d.fit_rotation_deg}:{})}})});
      state.busy=false;adoptEdits(result);message(fit?'已框内旋转，识别框保持不变，可撤销。':'已自由旋转，模型尺寸保持不变，可撤销。');
    }catch(error){fillFurniture();renderModel();message(error.message,true);}
    finally{state.busy=false;refresh();}
  }
  $('mf-fit-left').addEventListener('click',()=>turn(-90,true));
  $('mf-fit-right').addEventListener('click',()=>turn(90,true));
  $('mf-turn-left').addEventListener('click',()=>turn(-90));
  $('mf-turn-right').addEventListener('click',()=>turn(90));
  $('mf-copy').addEventListener('click',()=>{
    if(state.busy||pending()||!item())return;
    const source=item();
    dialog.close();
    if(furniture2dUI.armCopy(source))toast('已切到二维 · 点击图上放置复制家具，Esc 取消');
  });
  furnitureForm.addEventListener('submit',event=>{event.preventDefault();(async()=>{
    if(state.busy||!item())return;
    try{
      const input=readFurniture();state.busy='furniture-model';refresh();
      const result=await api('/api/edit-furniture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({run_id:state.run.run_id,action:'update',furniture_id:furnitureId,...input})});
      furnitureDirty=false;state.busy=false;adoptEdits(result);message('家具已应用，二维占地已同步，可撤销。');
    }catch(error){$('mf-status').textContent=error.message;}finally{state.busy=false;refresh();}
  })();});
  async function openModel(){
    if(state.busy||!state.run)return;
    if(state.formDirty){toast('请先应用或取消当前修改。');return;}
    if(!state.run.document.scale_mm_per_px){toast('先选普通门按 80 cm 估算比例，或点击“拉线标定”。');return;}
    if(state.mode==='furniture-copy')setMode('select');
    try{
      const geometry=await import('/model-geometry.mjs');defaults=geometry.DEFAULTS;
      const module=await import('/model-viewer.js');
      furnitureModule=await import('/furniture-models.mjs');
      furnitureMoveModule=await import('/furniture-move.mjs');
      dialog.showModal();if(!viewer)viewer=module.createViewer($('model-canvas'),selectFurniture,moveFurniture,result=>window.collisionUI?.modelReport(result));
      viewer.setCollisionOptions(window.collisionUI?.options||{});
      furnitureId=state.focusedFurniture||furnitureId;fillFurniture();
      fillSettings();lastDocument=state.run.document;renderModel(true);message('候选模型需校核；修改参数后点击应用。');sync();
    }catch(error){if(dialog.open)dialog.close();toast(`三维预览未能打开：${error.message}`,true);}
  }
  $('calibrate').addEventListener('click',()=>{
    if(state.formDirty){toast('请先应用或取消当前修改。');return;}
    clearSelection();setMode('calibrate');$('plan').style.cursor='crosshair';$('plan').style.touchAction='none';
    $('canvas-hint').textContent='拖出一段已知长度，或依次点击两个端点；Esc 取消';
    points=null;drag=null;$('calibration-form').hidden=true;
  });
  $('plan').addEventListener('pointerdown',e=>{
    if(state.mode!=='calibrate'||state.busy||e.button!==0)return;
    e.preventDefault();e.stopImmediatePropagation();const p=imagePoint(e);
    drag={start:p,id:e.pointerId,second:points&&Math.hypot(points[1][0]-points[0][0],points[1][1]-points[0][1])<5};
    if(!drag.second)points=[p,p];else points[1]=p;
    $('plan').setPointerCapture(e.pointerId);drawLine();
  },true);
  $('plan').addEventListener('pointermove',e=>{if(!drag||e.pointerId!==drag.id)return;e.preventDefault();e.stopImmediatePropagation();points[1]=imagePoint(e);drawLine();},true);
  $('plan').addEventListener('pointerup',e=>{
    if(!drag||e.pointerId!==drag.id)return;e.preventDefault();e.stopImmediatePropagation();
    points[1]=imagePoint(e);drag=null;$('plan').releasePointerCapture(e.pointerId);drawLine();
    const distance=Math.hypot(points[1][0]-points[0][0],points[1][1]-points[0][1]);
    if(distance<5){toast('请选择另一端，或拉出更长的标定线。');return;}
    state.formDirty=true;$('calibration-form').hidden=false;$('calibration-distance').textContent=`图上线段 ${distance.toFixed(1)} px，请输入对应的实际长度。`;
    $('calibration-form').scrollIntoView({block:'nearest'});$('calibration-length').focus();
  },true);
  $('plan').addEventListener('click',e=>{if(state.mode==='calibrate'){e.preventDefault();e.stopImmediatePropagation();}},true);
  $('plan').addEventListener('pointercancel',()=>{if(state.mode==='calibrate')cancelCalibration();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&state.mode==='calibrate')cancelCalibration();});
  $('cancel-calibration').addEventListener('click',cancelCalibration);
  $('calibration-form').addEventListener('submit',e=>{e.preventDefault();handle((async()=>{
    if(!points)throw new Error('请先选择两个标定端点。');
    await applySettings({calibration:{points_px:points,length_mm:Number($('calibration-length').value)}});
    cancelCalibration();toast('比例已标定，可以查看三维模型。');
  })());});
  $('wall-calibration-form').addEventListener('submit',e=>{e.preventDefault();handle((async()=>{
    if(state.formDirty)throw new Error('请先应用或取消当前修改。');
    await applySettings({wall_calibration:{wall_id:$('scale-wall').value,thickness_mm:Number($('scale-thickness').value)}});
    toast('已按墙厚估算比例，可撤销或重新拉线标定。');
  })());});
  window.addEventListener('wall-mode-change',()=>{points=null;drag=null;$('calibration-form').hidden=true;});
  window.addEventListener('wall-state-change',sync);
  window.addEventListener('collision-options-change',()=>viewer?.setCollisionOptions(window.collisionUI?.options||{}));
  window.addEventListener('opening-preview-change',()=>{if(dialog.open&&viewer)try{renderModel();}catch(error){message(error.message,true);}});
  window.addEventListener('ceiling-preview-change',()=>{if(dialog.open&&viewer){renderModel();sync();}});
  window.addEventListener('ceiling-visibility-change',()=>viewer?.setCeilingVisible(window.ceilingUI?.roofVisible||false));
  const ceilingCaption=document.createElement('div');ceilingCaption.className='ceiling-view-caption';ceilingCaption.hidden=true;document.querySelector('.model-scene').append(ceilingCaption);
  window.addEventListener('ceiling-view',e=>{if(!dialog.open||!viewer)return;const roomId=e.detail?.room_id||window.ceilingUI?.roomId,id=e.detail?.component_id;
    viewer.setCeilingVisible(true);viewer.viewCeiling(roomId,id);ceilingCaption.hidden=false;ceilingCaption.textContent=id?`${roomId} · ${id} · 灯下仰视，紫色圈为所选灯具`:`${roomId} · 房间内仰视`;});
  for(const id of ['model-reset','model-top'])$(id).addEventListener('click',()=>{ceilingCaption.hidden=true;});
  window.addEventListener('project-replacing',()=>{ceilingCaption.hidden=true;});
  $('open-model').addEventListener('click',openModel);
  function close(){if(state.busy)return;if(pending()){message('有未应用的设置，请先应用，或点击“放弃未应用”。',true);return;}dialog.close();}
  $('close-model').addEventListener('click',close);
  dialog.addEventListener('cancel',e=>{if(pending()||state.busy){e.preventDefault();close();}});
  $('model-reset').addEventListener('click',()=>viewer?.reset());$('model-top').addEventListener('click',()=>viewer?.reset(true));
  form.addEventListener('input',()=>{if(furnitureDirty)return;modelDirty=true;state.formDirty=true;$('model-draft-status').textContent='预览中 · 尚未应用或保存';$('model-undo').disabled=true;
    sync();
    try{renderModel(false,true);message('');}catch(error){message(error.message,true);}
  });
  form.addEventListener('submit',e=>{e.preventDefault();(async()=>{try{await applySettings({settings:readSettings()});}catch(error){message(error.message,true);}})();});
  const discard=document.createElement('button');discard.type='button';discard.id='model-discard';discard.className='button full';discard.textContent='放弃未应用';
  discard.addEventListener('click',()=>{fillSettings();state.formDirty=false;renderModel();sync();message('已恢复上次应用的参数。');});form.append(discard);
  $('model-save').addEventListener('click',async()=>{try{if(pending())throw new Error('请先应用或放弃修改，再保存项目。');const result=await saveProject();message(`已保存：${result.saved_name}`);}catch(error){message(error.message,true);}});
  $('model-undo').addEventListener('click',async()=>{try{await undoEdit();message('已撤销上一步。');}catch(error){message(error.message,true);}});
  window.modelUI={open:openModel};
  sync();
})();
