'use strict';
(() => {
  const panel=document.createElement('section');panel.id='ceiling-panel';panel.className='ceiling-panel';
  const anchor=document.createElement('div');anchor.id='ceiling-anchor';$('tools-detail').append(anchor,panel);
  panel.innerHTML=`<h3>天花板 · 吊顶 · 灯具</h3>
    <p class="ribbon-note">有效房间默认都有天花板，可逐房间修改。先校核房间并标定比例；长度单位为 cm。</p>
    <div id="ceiling-setup"><p id="ceiling-setup-reason" class="opening-help" role="status"></p><div class="ribbon-actions"><button id="ceiling-build-rooms" class="button primary" type="button">建立房间分区，启用顶面编辑</button><button id="ceiling-calibrate" class="button" type="button">前往比例标定</button></div></div>
    <label class="field">所属房间<select id="ceiling-room"></select></label>
    <p id="ceiling-room-location" class="opening-help" role="status"></p>
    <svg id="ceiling-room-map" class="ceiling-room-map" aria-label="房间定位图，紫色为所选区域，黄色为灯具" role="group"></svg>
    <p class="ribbon-note">紫色为所选区域，黄色圆点为灯具。点击区域切换；R 编号是自动分区编号，可在二维房间设置中命名。</p>
    <div class="ribbon-actions"><button id="ceiling-room-plan" class="button" type="button">在二维定位此房间</button><button id="ceiling-room-view" class="button" type="button">进入此房间仰视</button><button id="ceiling-new-light" class="button primary" type="button">＋ 添加灯具</button></div>
    <label class="visibility"><input id="ceiling-layer-toggle" type="checkbox" checked> 显示二维天花布置</label>
    <label class="visibility"><input id="ceiling-roof-toggle" type="checkbox"> 显示三维顶面与吊顶</label>
    <form id="ceiling-room-form"><div class="field-row"><label class="field">顶面底标高（cm）<input id="cr-height" type="number" min="30" max="2000" step="any" value="280" required></label><label class="field">顶板厚度（cm）<input id="cr-thickness" type="number" min="1" max="200" step="any" value="10" required></label></div>
    <div class="field-row"><label class="field">顶面颜色<input id="cr-color" type="color" value="#f5f2ec"></label><label class="visibility"><input id="cr-visible" type="checkbox" checked> 此房间顶面可见</label></div>
    <button class="button full" id="ceiling-room-apply" type="submit">建立 / 更新房间天花板</button></form>
    <label class="field">顶面组件<select id="ceiling-component"></select></label>
    <button id="ceiling-light-view" class="button full" type="button">查看此灯具</button>
    <div id="ceiling-obstruction" hidden><p id="ceiling-obstruction-text" class="opening-help error" role="status"></p><button id="ceiling-fix-host" class="button" type="button">改装到下方吊顶（预览）</button></div>
    <form id="ceiling-component-form">
      <label class="field" data-ceiling-group="slab">吊顶样式<select data-ceiling-setting="style"><option value="flat">整房平吊顶</option><option value="local">手绘局部吊顶</option><option value="border">四周边吊</option><option value="stepped">多级跌级边吊</option></select></label>
      <label class="field" data-ceiling-group="light">灯具类型<select data-ceiling-setting="light_type"><option value="flush">吸顶灯</option><option value="downlight">筒灯</option><option value="pendant">吊灯</option><option value="spot">射灯</option><option value="track">轨道灯</option><option value="linear">线性灯</option></select></label>
      <label class="field" data-ceiling-group="attached">安装面<select data-ceiling-setting="host_id" id="ceiling-host"></select></label>
      <label class="field" data-ceiling-group="attached">灯组名称<input data-ceiling-setting="light_group" id="ceiling-light-group" list="ceiling-group-names" maxlength="40" placeholder="例如：客厅主灯；留空为未分组"><datalist id="ceiling-group-names"></datalist></label>
      <div id="ceiling-fields"></div>
      <label class="field">组件颜色<input data-ceiling-setting="color" type="color" value="#f5f2ec"></label>
      <label class="visibility" data-ceiling-group="attached"><input data-ceiling-setting="on" type="checkbox" checked> 灯具 / 灯带开启</label>
      <div class="ribbon-actions"><button id="ceiling-draw" class="button" type="button">手绘局部轮廓</button><button id="ceiling-place" class="button" type="button">图上定位灯具</button><button id="ceiling-finish" class="button" type="button" hidden>完成轮廓</button></div>
      <p id="ceiling-status" class="opening-help" role="status"></p>
      <div class="ribbon-actions"><button id="ceiling-apply" class="button primary" type="submit">应用组件</button><button id="ceiling-cancel" class="button" type="button">取消预览</button><button id="ceiling-copy" class="button" type="button">复制</button><button id="ceiling-delete" class="button danger" type="button">删除</button></div>
    </form><button id="ceiling-rebind" class="button" hidden>将失效顶面恢复到此房间</button><p id="ceiling-warnings" class="opening-help" role="status"></p>
    <details id="ceiling-lighting-controls" open><summary>灯组统一控制</summary>
    <form id="ceiling-lighting-form">
      <div class="field-row"><label class="field">控制范围<select id="cl-scope"><option value="room">当前房间</option><option value="project">整个项目</option></select></label><label class="field">灯组<select id="cl-group"></select></label></div>
      <p id="cl-members" class="opening-help" role="status"></p>
      <label class="field">开关<select id="cl-on"><option value="keep">保留各灯开关</option><option value="on">全部开启</option><option value="off">全部关闭</option></select></label>
      <div class="field-row"><div class="field"><label class="lighting-option"><input id="cl-use-intensity" type="checkbox"> 统一亮度</label><input id="cl-intensity" aria-label="灯组统一亮度" type="number" min="0" max="20" step="any" value="1" required></div><div class="field"><label class="lighting-option"><input id="cl-use-temperature" type="checkbox"> 统一色温（K）</label><input id="cl-temperature" aria-label="灯组统一色温（K）" type="number" min="2000" max="10000" step="any" value="3000" required></div></div>
      <p class="ribbon-note">灯具与灯槽共用灯组；未勾选的参数保持各灯原值。复制保留灯组，失效安装面自动跳过。</p>
      <p id="cl-status" class="opening-help" role="status"></p>
      <div class="ribbon-actions"><button id="cl-apply" class="button primary" type="submit">应用灯组</button><button id="cl-cancel" class="button" type="button">取消预览</button></div>
    </form></details>`;
  const fields=[['drop_mm','下吊距离（cm）','slab',0,2000,20],['thickness_mm','吊顶厚度（cm）','slab',1,200,8],
    ['inset_mm','距安装面边缘（cm）','slab cove',0,2000,0],['width_mm','每级边吊宽度（cm）','band',1,2000,40],
    ['levels','跌级数','stepped',1,5,2],['step_mm','每级下吊增加（cm）','stepped',1,200,10],
    ['channel_width_mm','灯槽宽度（cm）','cove',2,200,12],['channel_height_mm','灯槽高度（cm）','cove',3,200,6],
    ['center_x','中心 X（cm）','light',0,200000,0],['center_y','中心 Y（cm）','light',0,200000,0],
    ['size_mm','灯具直径 / 长度（cm）','light',1,2000,30],['depth_mm','灯体高度（cm）','light',1,200,8],
    ['hanging_mm','离安装面下挂（cm）','light',0,2000,0],['rotation_deg','旋转 / 射灯方位（°）','light',0,360,0],
    ['tilt_deg','射灯倾角（°）','light',0,85,0],['intensity','灯具 / 灯带亮度','light cove',0,20,1],['temperature_k','色温（K）','light cove',2000,10000,3000]];
  for(const [key,label,group,min,max,value] of fields){const labelEl=document.createElement('label');labelEl.className='field';labelEl.dataset.ceilingGroup=group;
    labelEl.innerHTML=`${label}<input data-ceiling-setting="${key}" type="number" min="${min}" max="${max}" step="${key==='levels'?'1':'any'}" value="${value}" required>`;$('ceiling-fields').append(labelEl);}
  const form=$('ceiling-component-form'),roomForm=$('ceiling-room-form'),lightingForm=$('ceiling-lighting-form'),roomSelect=$('ceiling-room'),componentSelect=$('ceiling-component');
  let lastDoc=null,selected='new:slab',copying=false,dirty=false,roomDirty=false,lightingDirty=false,timer=null,ticket=0,drawPoints=null,points=null,placing=false;
  let navigation=null;
  import('/ceiling-geometry.mjs').then(module=>{navigation=module;if(!dirty)fill();render();}).catch(()=>status('定位工具加载失败，请刷新页面。',true));
  const lightNames={flush:'吸顶灯',downlight:'筒灯',pendant:'吊灯',spot:'射灯',track:'轨道灯',linear:'线性灯'};
  const key=r=>r.style_key||'id:'+r.id;
  function location(r){const p=r.label_px||[0,0],image=doc()?.image||{};
    return (p[1]<image.height_px/3?'上方':p[1]>image.height_px*2/3?'下方':'中部')+(p[0]<image.width_px/3?'偏左':p[0]>image.width_px*2/3?'偏右':'居中');}
  async function view(componentId){if(!$('model-dialog').open){await window.modelUI?.open();if(!$('model-dialog').open)return;moveToModel();}
    $('ceiling-roof-toggle').checked=true;window.dispatchEvent(new CustomEvent('ceiling-view',{detail:{room_id:roomSelect.value,component_id:componentId}}));}
  function obstruction(){const source=state.ceilingPreview||doc(),light=source?.ceiling_layout?.lights?.find(l=>l.id===selected);
    return light&&navigation?.lightObstruction(source,light);}
  function navigationInfo(){const r=room(),area=r&&roomMeasurements?.roomAreaM2(r,doc()?.scale_mm_per_px);
    $('ceiling-room-location').textContent=r?`${r.id} · 图上${location(r)} · ${roomMeasurements?.formatRoomArea(area)||'—'} · 下图紫色区域`:'';
    $('ceiling-light-view').hidden=kind()!=='light'||!current();
    const blocked=obstruction();$('ceiling-obstruction').hidden=!blocked;
    const light=(state.ceilingPreview||doc())?.ceiling_layout?.lights?.find(l=>l.id===selected);
    $('ceiling-obstruction-text').textContent=blocked?`${selected} 当前装在 ${(light.mount_mm/10).toFixed(0)} cm 安装面；下方 ${blocked.id}（${(blocked.bottom_mm/10).toFixed(0)} cm）遮住了灯具。可更换安装面后点击“应用组件”。`:'';
    $('ceiling-fix-host').disabled=Boolean(state.busy)||dirty;
  }
  const doc=()=>state.run?.document;
  const room=()=>doc()?.room_partition?.regions.find(r=>r.id===roomSelect.value);
  const current=()=>doc()?.ceiling_design?.components.find(c=>c.id===selected);
  const kind=()=>current()?.settings.kind||selected.split(':')[1]||'slab';
  const input=k=>form.querySelector(`[data-ceiling-setting="${k}"]`);
  const mm=k=>k.endsWith('_mm');
  function status(text,error=false){const el=$(lightingDirty?'cl-status':'ceiling-status');el.textContent=text;el.classList.toggle('error',error);}
  function previewChanged(){render();window.dispatchEvent(new Event('ceiling-preview-change'));window.collisionUI?.render();}
  function stopDrawing(){drawPoints=null;placing=false;if(state.mode.startsWith('ceiling-'))state.mode='select';$('plan').style.cursor='';$('ceiling-finish').hidden=true;render();}
  function discard(){clearTimeout(timer);ticket++;dirty=false;roomDirty=false;lightingDirty=false;state.ceilingPreview=null;state.formDirty=false;copying=false;stopDrawing();fill();fillLighting();previewChanged();refresh();}
  function lightingMembers(){
    const scope=$('cl-scope').value,choice=$('cl-group').value;
    return (doc()?.ceiling_design?.components||[]).filter(c=>['light','cove'].includes(c.settings.kind)
      &&(scope==='project'||c.room_key===key(room()||{id:''}))
      &&(choice==='all'||(c.settings.light_group||'')===(choice==='ungrouped'?'':choice.slice(5))));
  }
  function lightingList(){
    const choice=$('cl-group'),old=choice.value,names=[...new Set((doc()?.ceiling_design?.components||[])
      .filter(c=>['light','cove'].includes(c.settings.kind)&&($('cl-scope').value==='project'||c.room_key===key(room()||{id:''})))
      .map(c=>c.settings.light_group).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh'));
    choice.replaceChildren(new Option('所有灯具与灯槽','all'),new Option('未分组','ungrouped'),...names.map(n=>new Option(n,'name:'+n)));
    choice.value=Array.from(choice.options).some(o=>o.value===old)?old:'all';
    const allNames=[...new Set((doc()?.ceiling_design?.components||[]).map(c=>c.settings.light_group).filter(Boolean))];
    $('ceiling-group-names').replaceChildren(...allNames.map(n=>new Option(n,n)));lightingCount();
  }
  function lightingCount(){
    const members=lightingMembers(),layout=doc()?.ceiling_layout;
    const active=new Set([...(layout?.lights||[]).map(l=>l.id),...(layout?.surfaces||[]).filter(s=>s.role==='strip').map(s=>s.id)]);
    const count=members.filter(c=>active.has(c.id)).length,skipped=members.length-count;
    $('cl-members').textContent=`${count} 个可控制 · ${members.map(c=>c.id).join('、')||'尚无灯具或灯槽'}${skipped?`；${skipped} 个失效组件将跳过`:''}`;
    $('cl-apply').disabled=!count||!Object.keys(lightingRequest().settings).length||Boolean(state.busy)||(state.formDirty&&!lightingDirty);
  }
  function fillLighting(){
    lightingList();$('cl-on').value='keep';$('cl-use-intensity').checked=false;$('cl-use-temperature').checked=false;
    $('cl-intensity').value=1;$('cl-temperature').value=3000;$('cl-status').textContent='选择灯组和要统一的参数；先预览，再应用。';$('cl-status').classList.remove('error');
  }
  function lightingRequest(){
    const values={};if($('cl-on').value!=='keep')values.on=$('cl-on').value==='on';
    if($('cl-use-intensity').checked)values.intensity=Number($('cl-intensity').value);
    if($('cl-use-temperature').checked)values.temperature_k=Number($('cl-temperature').value);
    const choice=$('cl-group').value;
    return {action:'lighting',scope:$('cl-scope').value,room_id:roomSelect.value,
      group_name:choice==='all'?null:choice==='ungrouped'?'':choice.slice(5),settings:values};
  }
  function hosts(){
    const choice=input('host_id'),old=choice.value;choice.replaceChildren(new Option(`原天花板 · ${$('cr-height').value} cm`,''));
    for(const surface of doc()?.ceiling_layout?.surfaces||[])if(surface.role==='ceiling'&&surface.room_key===key(room()||{id:''})&&!surface.id.startsWith('room:'))choice.append(new Option(`${surface.id} 吊顶底面 · 底标高 ${(surface.bottom_mm/10).toFixed(1)} cm`,surface.id));
    if(old&&!Array.from(choice.options).some(o=>o.value===old))choice.append(new Option(`${old} · 安装面失效，请更换`,old));choice.value=old;
  }
  function groups(){const k=kind(),style=input('style').value;
    for(const el of panel.querySelectorAll('[data-ceiling-group]')){const groups=el.dataset.ceilingGroup.split(' ');
      el.hidden=!groups.includes(k)&&!(groups.includes('attached')&&k!=='slab')&&!(groups.includes('band')&&k==='slab'&&['border','stepped'].includes(style))&&!(groups.includes('stepped')&&k==='slab'&&style==='stepped');
      for(const field of el.querySelectorAll('input,select'))field.disabled=el.hidden||Boolean(state.busy)||(state.formDirty&&!dirty);}
    $('ceiling-draw').hidden=k!=='slab'||style!=='local';$('ceiling-place').hidden=k!=='light';
    $('ceiling-copy').disabled=!current()||dirty||Boolean(state.busy);$('ceiling-delete').disabled=!current()||dirty||Boolean(state.busy);
  }
  function fill(){
    const r=room();const opts=doc()?.ceiling_design?.rooms[key(r||{id:''})]||{};
    $('cr-height').value=(opts.height_mm??doc()?.model_settings?.wall_height_mm??2800)/10;
    $('cr-thickness').value=(opts.thickness_mm??100)/10;$('cr-color').value=opts.color||'#f5f2ec';$('cr-visible').checked=opts.visible!==false;
    const c=current(),values=c?.settings||{},center=values.center_px||r?.label_px||[0,0];points=values.points_px?structuredClone(values.points_px):null;
    for(const [k,,,,,v] of fields)input(k).value=k.startsWith('center_')?center[k==='center_x'?0:1]*(doc()?.scale_mm_per_px||1)/10:values[k]??(mm(k)?v*10:v);
    for(const [k] of fields)if(mm(k))input(k).value=Number(input(k).value)/10;
    input('style').value=values.style||'flat';input('light_type').value=values.light_type||'flush';input('color').value=values.color||(kind()==='light'?'#dedede':'#f5f2ec');input('on').checked=values.on!==false;
    input('light_group').value=values.light_group||'';
    hosts();const suggested=!c&&kind()==='light'?navigation?.mountingSurfaces(doc(),key(r),center.map(v=>v*doc().scale_mm_per_px))[0]:null;
    input('host_id').value=values.host_id||(suggested&&!suggested.id.startsWith('room:')?suggested.id:'');groups();navigationInfo();status('应用后可撤销并随项目保存。灯槽为可编辑槽体与发光带示意。');
  }
  function list(){
    const oldRoom=roomSelect.value;roomSelect.replaceChildren();for(const r of doc()?.room_partition?.regions||[])if(r.review_status!=='rejected')roomSelect.append(new Option(`${r.id} · ${r.name&&r.name!==r.id?r.name:location(r)}`,r.id));
    roomSelect.value=Array.from(roomSelect.options).some(o=>o.value===oldRoom)?oldRoom:roomSelect.options[0]?.value||'';
    componentSelect.replaceChildren(new Option('新增吊顶','new:slab'),new Option('新增灯槽','new:cove'),new Option('新增灯具','new:light'));
    const activeKeys=new Set((doc()?.room_partition?.regions||[]).map(key));
    for(const c of doc()?.ceiling_design?.components||[])if(c.room_key===key(room()||{id:''})||!activeKeys.has(c.room_key))componentSelect.append(new Option(`${c.id} · ${{slab:'吊顶',cove:'灯槽',light:lightNames[c.settings.light_type]||'灯具'}[c.settings.kind]}${!activeKeys.has(c.room_key)?' · 原房间失效':''}`,c.id));
    if(!Array.from(componentSelect.options).some(o=>o.value===selected))selected='new:slab';componentSelect.value=selected;
  }
  function read(){
    const values={kind:kind()};for(const field of form.querySelectorAll('[data-ceiling-setting]')){const k=field.dataset.ceilingSetting;if(k.startsWith('center_'))continue;
      values[k]=field.type==='checkbox'?field.checked:field.type==='number'?Number(field.value)*(mm(k)?10:1):field.value;}
    values.light_group=kind()==='slab'?'':values.light_group.trim();
    if(kind()==='light')values.center_px=[Number(input('center_x').value),Number(input('center_y').value)].map(v=>v*10/doc().scale_mm_per_px);
    if(kind()==='slab'&&values.style==='local')values.points_px=points;
    return values;
  }
  function request(){return lightingDirty?lightingRequest():roomDirty?{action:'room',room_id:roomSelect.value,settings:{height_mm:Number($('cr-height').value)*10,thickness_mm:Number($('cr-thickness').value)*10,color:$('cr-color').value,visible:$('cr-visible').checked}}:
    {action:copying?'copy':current()?'update':'add',room_id:roomSelect.value,component_id:current()?.id,settings:read()};}
  async function preview(){const id=++ticket;state.ceilingPreview=null;
    if(!room()||!(lightingDirty?lightingForm:roomDirty?roomForm:form).checkValidity())return;
    try{const result=await api('/api/preview-ceiling',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({run_id:state.run.run_id,...request()})});
      if(id!==ticket||!dirty)return;state.ceilingPreview=result.document;previewChanged();status(`预览中 · 尚未应用${copying?' · 新副本':''}${lightingDirty?' · '+result.operation.summary:''}`);
    }catch(error){if(id===ticket){state.ceilingPreview=null;previewChanged();status(error.message,true);}}
  }
  function changed(isRoom=false,isLighting=false){dirty=true;roomDirty=isRoom;lightingDirty=isLighting;state.formDirty=true;clearTimeout(timer);ticket++;state.ceilingPreview=null;groups();previewChanged();timer=setTimeout(preview,250);refresh();}
  async function commit(payload=request()){
    if(state.busy||!room())return;clearTimeout(timer);ticket++;state.busy='ceiling';refresh();
    try{const result=await api('/api/edit-ceiling',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({run_id:state.run.run_id,...payload})});
      dirty=false;roomDirty=false;lightingDirty=false;state.ceilingPreview=null;copying=false;stopDrawing();state.busy=false;state.formDirty=false;
      const operation=result.operation||result.changes.at(-1),id=operation.id;if(id!=='lighting'&&!id.startsWith('room:'))selected=payload.action==='delete'?'new:slab':id;
      if(operation.changed_count!==0)adoptEdits(result);list();fill();fillLighting();previewChanged();toast(operation.summary);
    }catch(error){status(error.message,true);}finally{state.busy=false;refresh();}
  }
  function sync(){const source=doc();if(source!==lastDoc){lastDoc=source;if(!dirty){list();fill();fillLighting();}}
    const enabled=Boolean(source?.scale_mm_per_px&&room());
    for(const field of panel.querySelectorAll('input,select,button'))field.disabled=!enabled||Boolean(state.busy)||(state.formDirty&&!dirty);
    // Room selection must stay usable even before the first room is chosen.
    roomSelect.disabled=!source?.scale_mm_per_px||!roomSelect.options.length||Boolean(state.busy)||dirty;
    groups();if(!enabled)for(const field of panel.querySelectorAll('input,select,button'))field.disabled=true;
    if(dirty){roomForm.querySelectorAll('input,button').forEach(el=>el.disabled=!roomDirty||Boolean(state.busy));form.querySelectorAll('input,select,button').forEach(el=>{if(roomDirty||lightingDirty)el.disabled=true;});componentSelect.disabled=true;}
    for(const el of lightingForm.querySelectorAll('input,select,button'))el.disabled=!enabled||Boolean(state.busy)||(state.formDirty&&!lightingDirty);
    $('cl-intensity').disabled=$('cl-intensity').disabled||!$('cl-use-intensity').checked;
    $('cl-temperature').disabled=$('cl-temperature').disabled||!$('cl-use-temperature').checked;
    lightingCount();if(!enabled)$('cl-apply').disabled=true;
    $('cl-cancel').disabled=Boolean(state.busy)||!lightingDirty;
    $('ceiling-cancel').disabled=Boolean(state.busy)||!dirty||lightingDirty;
    $('ceiling-rebind').hidden=!current()||(source?.room_partition?.regions||[]).some(r=>key(r)===current().room_key);
    $('ceiling-rebind').disabled=!enabled||Boolean(state.busy)||state.formDirty;
    const hasRooms=roomSelect.options.length>0,blocked=state.formDirty&&!dirty;
    const reasons=[];
    if(!source)reasons.push('请先识别户型或打开已保存方案。');
    else{
      if(!source.scale_mm_per_px)reasons.push('当前未标定实际比例，请先完成比例标定。');
      if(!hasRooms)reasons.push('当前没有可编辑的房间分区。三维自动补出的顶面仅供预览；建立房间后即可编辑天花板、吊顶和灯具。');
      if(blocked)reasons.push('另有尚未应用的修改，请先应用或取消，再编辑顶面。');
    }
    $('ceiling-setup').hidden=!reasons.length;
    $('ceiling-setup-reason').textContent=reasons.join(' ');
    $('ceiling-build-rooms').hidden=!source||hasRooms;
    $('ceiling-build-rooms').disabled=!source||Boolean(state.busy)||state.formDirty;
    $('ceiling-calibrate').hidden=!source||Boolean(source.scale_mm_per_px);
    $('ceiling-calibrate').disabled=!source||Boolean(state.busy)||state.formDirty;
    $('ceiling-warnings').textContent=(source?.ceiling_layout?.warnings||[]).join('；');render();
  }
  form.addEventListener('input',()=>{if(!roomDirty)changed();});form.addEventListener('change',groups);
  roomForm.addEventListener('input',()=>{if(!dirty||roomDirty)changed(true);});
  lightingForm.addEventListener('input',e=>{if(e.target.id==='cl-scope')lightingList();else lightingCount();
    if(!dirty||lightingDirty){if(lightingDirty||Object.keys(lightingRequest().settings).length)changed(false,true);else refresh();}});
  lightingForm.addEventListener('submit',e=>{e.preventDefault();lightingDirty=true;handle(commit());});
  $('cl-cancel').addEventListener('click',discard);
  form.addEventListener('submit',e=>{e.preventDefault();handle(commit());});roomForm.addEventListener('submit',e=>{e.preventDefault();roomDirty=true;handle(commit());});
  $('ceiling-cancel').addEventListener('click',discard);
  $('ceiling-build-rooms').addEventListener('click',()=>handle(partitionRooms()));
  $('ceiling-calibrate').addEventListener('click',()=>{if($('model-dialog').open)$('close-model').click();$('tab-measure').click();});
  componentSelect.addEventListener('change',()=>{if(state.formDirty){componentSelect.value=selected;toast('请先应用或取消当前修改。');return;}selected=componentSelect.value;copying=false;fill();render();});
  function chooseRoom(id){if(state.busy||state.formDirty){toast('请先应用或取消当前修改。');return;}roomSelect.value=id;selected='new:slab';list();fill();fillLighting();render();}
  roomSelect.addEventListener('change',()=>chooseRoom(roomSelect.value));
  $('ceiling-new-light').addEventListener('click',()=>{if(state.formDirty)return;selected='new:light';copying=false;list();fill();render();});
  $('ceiling-room-view').addEventListener('click',()=>view());
  $('ceiling-light-view').addEventListener('click',()=>view(selected));
  $('ceiling-room-plan').addEventListener('click',()=>{if(state.formDirty){toast('请先应用或取消当前修改。');return;}if($('model-dialog').open)$('close-model').click();$('tab-detail').click();focusRoom(room());panel.scrollIntoView({block:'nearest'});});
  $('ceiling-fix-host').addEventListener('click',()=>{const blocked=obstruction();if(!blocked||state.formDirty)return;input('host_id').value=blocked.id;changed();});
  $('ceiling-delete').addEventListener('click',()=>handle(commit({action:'delete',component_id:selected})));
  $('ceiling-rebind').addEventListener('click',()=>handle(commit({action:'rebind',component_id:selected,room_id:roomSelect.value})));
  $('ceiling-copy').addEventListener('click',()=>{copying=true;if(kind()==='light')input('center_x').value=Number(input('center_x').value)+30;changed();});
  function arm(mode){if(state.busy||state.formDirty&&!dirty)return;state.mode=mode;state.formDirty=true;dirty=true;placing=mode==='ceiling-place';if(!placing){drawPoints=[];$('ceiling-finish').hidden=false;}status(placing?'点击房间内定位灯具 · Esc 取消':'依次点击局部吊顶拐点，再点击完成轮廓 · Esc 取消');$('plan').style.cursor='crosshair';}
  $('ceiling-draw').addEventListener('click',()=>{if($('model-dialog').open){status('请先应用或取消预览并返回二维，再手绘轮廓。',true);return;}arm('ceiling-draw');});
  $('ceiling-place').addEventListener('click',()=>{if($('model-dialog').open){status('请在中心 X/Y 输入位置，或返回二维点击定位。',true);return;}arm('ceiling-place');});
  $('ceiling-finish').addEventListener('click',()=>{if(drawPoints?.length<3){status('至少选择三个拐点。',true);return;}points=drawPoints;stopDrawing();changed();});
  $('plan').addEventListener('pointerdown',e=>{if(!state.mode.startsWith('ceiling-'))return;e.preventDefault();e.stopImmediatePropagation();},true);
  $('plan').addEventListener('pointerup',e=>{if(!state.mode.startsWith('ceiling-')||state.busy||e.button!==0)return;e.preventDefault();e.stopImmediatePropagation();const p=imagePoint(e);
    if(placing){input('center_x').value=(p[0]*doc().scale_mm_per_px/10).toFixed(2);input('center_y').value=(p[1]*doc().scale_mm_per_px/10).toFixed(2);stopDrawing();changed();}
    else {drawPoints.push(p);status(`已选 ${drawPoints.length} 个拐点，点击完成轮廓。`);render();}},true);
  $('plan').addEventListener('click',e=>{if(state.mode.startsWith('ceiling-')){e.preventDefault();e.stopImmediatePropagation();}},true);
  window.addEventListener('keydown',e=>{if(e.key==='Escape'&&dirty){e.preventDefault();discard();}},true);
  window.addEventListener('blur',()=>{if(drawPoints||placing)discard();});
  function render(){let layer=$('ceiling-layer');if(!layer){layer=svgElement('g',{id:'ceiling-layer'});$('plan').append(layer);}layer.replaceChildren();
    const source=state.ceilingPreview||doc();renderMap(source);navigationInfo();if(!source||!$('ceiling-layer-toggle').checked)return;
    const scale=source.scale_mm_per_px,path=polygons=>polygons.map(rings=>rings.map(r=>'M'+r.map(([x,y])=>`${x/scale},${y/scale}`).join('L')+'Z').join('')).join('');
    for(const s of source.ceiling_layout?.surfaces||[]){if(s.role==='strip'||s.id.startsWith('room:'))continue;
      const p=svgElement('path',{d:path(s.polygons_mm),fill:s.role==='cove'?'#dfa744':'#7775c2','fill-opacity':.08,stroke:s.role==='cove'?'#b87918':'#7775c2','stroke-width':(s.id.split(':')[0]===selected?3:1)/state.zoom,'fill-rule':'evenodd','data-ceiling-id':s.id});
      p.style.pointerEvents='none';layer.append(p);}
    for(const light of source.ceiling_layout?.lights||[]){const [x,y]=light.center_mm.map(v=>v/scale),g=svgElement('g',{'data-ceiling-id':light.id,role:'button',tabindex:0,'aria-label':`${light.id} 灯具`});
      const attrs={fill:light.settings.on&&light.settings.intensity>0?'#f1c95a':'#9ba3ae','fill-opacity':.35,stroke:light.id===selected?'#7558bd':'#9a7626','stroke-width':2/state.zoom};
      if(['track','linear'].includes(light.settings.light_type)){const w=light.settings.size_mm/scale,h=Math.min(light.settings.size_mm,80)/scale;
        g.append(svgElement('rect',{...attrs,x:x-w/2,y:y-h/2,width:w,height:h,transform:`rotate(${light.settings.rotation_deg} ${x} ${y})`}));}
      else g.append(svgElement('circle',{...attrs,cx:x,cy:y,r:light.settings.size_mm/scale/2}));
      const label=svgElement('text',{x:x+5/state.zoom,y:y-5/state.zoom,fill:'#8a671a',style:`font-size:${12/state.zoom}px`});label.textContent=light.id+(light.settings.light_group?' · '+light.settings.light_group:'');g.append(label);
      g.addEventListener('click',e=>{e.stopPropagation();select(light.id);});g.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();select(light.id);}});layer.append(g);}
    if(drawPoints?.length)layer.append(svgElement('polyline',{points:drawPoints.map(p=>p.join(',')).join(' '),fill:'none',stroke:'#a951ae','stroke-width':3/state.zoom,'pointer-events':'none'}));
  }
  function renderMap(source){const map=$('ceiling-room-map');map.replaceChildren();if(!source?.image)return;
    map.setAttribute('viewBox',`0 0 ${source.image.width_px} ${source.image.height_px}`);
    map.append(svgElement('image',{href:state.run.image_url,width:source.image.width_px,height:source.image.height_px,opacity:.45}));
    for(const r of source.room_partition?.regions||[]){if(r.review_status==='rejected')continue;
      const active=r.id===roomSelect.value,g=svgElement('g',{role:'button',tabindex:0,'aria-label':`${r.id} ${r.name&&r.name!==r.id?r.name:location(r)}`,'aria-pressed':String(active)});
      const d=(r.polygons_px||(r.rings_px?[r.rings_px]:[])).map(rings=>rings.map(ring=>'M'+ring.map(p=>p.join(',')).join('L')+'Z').join('')).join('');
      g.append(svgElement('path',{d,fill:active?'#8b5cf6':'#cbd5e1','fill-opacity':active?.35:.18,stroke:active?'#6d28d9':'#64748b','stroke-width':active?5:2,'fill-rule':'evenodd'}));
      if(r.label_px){const [x,y]=r.label_px,label=svgElement('text',{x,y:y-22,'text-anchor':'middle',fill:active?'#5b21b6':'#334155','font-size':34,'font-weight':700,stroke:'#ffffff','stroke-width':5,'paint-order':'stroke'});label.textContent=r.id;g.append(label);}
      g.addEventListener('click',()=>chooseRoom(r.id));g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();chooseRoom(r.id);}});map.append(g);
    }
    for(const l of source.ceiling_layout?.lights||[]){const [x,y]=l.center_mm.map(v=>v/source.scale_mm_per_px),g=svgElement('g',{role:'button',tabindex:0,'aria-label':`${l.id} ${lightNames[l.settings.light_type]||'灯具'}`});
      g.append(svgElement('circle',{cx:x,cy:y,r:l.id===selected?14:10,fill:'#facc15',stroke:l.id===selected?'#6d28d9':'#854d0e','stroke-width':4}));
      const label=svgElement('text',{x:x+19,y:y+11,fill:'#854d0e','font-size':28,stroke:'white','stroke-width':4,'paint-order':'stroke'});label.textContent=l.id;g.append(label);
      g.addEventListener('click',()=>{select(l.id);});g.addEventListener('keydown',e=>{if(e.key==='Enter'){select(l.id);}});map.append(g);
    }
  }
  function select(id){if(state.formDirty){toast('请先应用或取消当前修改。');return;}const c=doc()?.ceiling_design?.components.find(c=>c.id===id.split(':')[0]);if(!c)return;
    const r=doc().room_partition.regions.find(r=>key(r)===c.room_key);if(r)roomSelect.value=r.id;selected=c.id;list();fill();fillLighting();render();
    if($('model-dialog').open)moveToModel();else $('tab-detail').click();panel.scrollIntoView({block:'nearest'});}
  function moveToModel(){document.querySelector('#model-dialog .model-controls').prepend(panel);panel.scrollIntoView({block:'nearest'});}
  const modelButton=document.createElement('button');modelButton.id='model-ceiling-edit';modelButton.className='button';modelButton.textContent='编辑顶面与灯具';document.querySelector('.model-view-actions').append(modelButton);
  modelButton.addEventListener('click',()=>{if(state.formDirty&&!dirty){toast('请先应用或取消当前修改。');return;}moveToModel();});
  const ceilingView=document.createElement('button');ceilingView.id='model-ceiling-view';ceilingView.className='button';ceilingView.textContent='仰视顶面';modelButton.after(ceilingView);
  ceilingView.addEventListener('click',()=>{$('ceiling-roof-toggle').checked=true;view(current()?.settings.kind==='light'?selected:undefined);});
  $('model-dialog').addEventListener('close',()=>anchor.after(panel));
  $('ceiling-layer-toggle').addEventListener('change',render);
  $('ceiling-roof-toggle').addEventListener('change',()=>window.dispatchEvent(new Event('ceiling-visibility-change')));
  window.addEventListener('ceiling-select',e=>select(e.detail));window.addEventListener('wall-plan-rendered',render);window.addEventListener('wall-state-change',sync);
  window.addEventListener('project-replacing',()=>{discard();lastDoc=null;selected='new:slab';});
  window.ceilingUI={get dirty(){return dirty;},get roomId(){return roomSelect.value;},get roofVisible(){return $('ceiling-roof-toggle').checked;},select,discard};sync();
})();
