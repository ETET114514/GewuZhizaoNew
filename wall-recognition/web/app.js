'use strict';
const $ = id => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const TYPES = {too_short:'墙段太短',too_long:'墙段太长',missing_corner:'缺少转角',position:'位置不对',thickness:'厚度不对',false_positive:'不应该是墙',missing_wall:'这里漏了墙',other:'其他问题',opening_review:'门窗校核',furniture_edit:'家具修改',model_settings:'三维设置'};
const FURNITURE_COLORS = {table:'#3264b5',chair:'#19854c',bed:'#a12bba',sofa:'#19854c',cabinet:'#b76a12',shoe_cabinet:'#b76a12',tv_console:'#b76a12',kitchen_cabinet:'#b76a12',coffee_table:'#3264b5',dining_table:'#3264b5',wet_area:'#737080',unclassified:'#737080'};
const furnitureDisplayLabel=f=>f.kind==='wet_area'?'洗浴区（淋浴）':f.label||'家具';
const DIRECTIONS = {up:'向上',down:'向下',left:'向左',right:'向右'};
TYPES.wall_connection='墙体连接修复';
TYPES.room_partition='区域分割';
TYPES.room_edit='区域与地面修改';
TYPES.opening_batch='门窗快捷开启';
TYPES.opening_add='新增门窗';
TYPES.ceiling_edit='顶面与灯具修改';
const state = {file:null,blobUrl:null,token:null,run:null,selected:null,issues:[],mode:'select',width:745,height:761,zoom:1,fitted:true,busy:false,dirty:false,formDirty:false,regionCount:0,drag:null};
let toastTimer;
let roomMeasurements=null;
state.wallColors=[];
FURNITURE_COLORS.unclassified_area='#737080';
FURNITURE_COLORS.water_feature='#168187';
function toast(message, error=false) {
  clearTimeout(toastTimer); $('toast').textContent=message; $('toast').classList.toggle('error',error); $('toast').hidden=false;
  toastTimer=setTimeout(()=>{$('toast').hidden=true;},error?6500:4200);
}
function svgElement(tag, attrs={}) {const el=document.createElementNS(NS,tag); for(const [k,v] of Object.entries(attrs))el.setAttribute(k,String(v)); return el;}
function snapshot() {return {run_id:state.run?.run_id||null,wall_count:state.run?.document.walls.length||0,walls:state.run?.document.walls||[],openings:state.run?.document.openings||[],furniture:state.run?.document.furniture||[],issues:structuredClone(state.issues),selected_id:state.selected?.id||null,unsaved:state.dirty||state.formDirty};}
function geometryDescription(doc) {
  const r=doc.refinement_summary,items=(doc.furniture||[]).filter(f=>f.review_status!=='rejected');
  const areas=items.filter(f=>['unclassified_area','water_feature'].includes(f.kind)).length;
  const furniture=` · ${items.length-areas} 件家具与设施${areas?` · ${areas} 处区域`:''}`;
  return (r?`${r.solid_segment_count} 段实墙 · ${r.active_opening_count} 处洞口${r.uncertain_boundary_count?` · ${r.uncertain_boundary_count} 处边界待确认`:''}`:`${doc.walls.length} 段候选`)+furniture;
}
function refresh() {
  window.dispatchEvent(new Event('wall-state-change'));
  const ready=Boolean(state.run), count=state.run?.document.walls.length||0;
  $('detect').disabled=!state.file||state.busy; $('detect').textContent=ready?'重新识别':'识别墙体、门窗与家具';
  $('upload').disabled=state.busy; $('sample').disabled=state.busy; $('file').disabled=state.busy;
  $('open-projects').disabled=Boolean(state.busy);
  for(const field of $('recognition-settings').querySelectorAll('input,button'))field.disabled=Boolean(state.busy);
  $('wall-color-pick').disabled=!state.file||Boolean(state.busy);
  $('save').disabled=state.busy||!ready; $('undo').disabled=state.busy||!state.historySize;
  $('connect-walls').disabled=Boolean(state.busy)||!ready;
  const connection=state.run?.document.wall_connection;
  $('connection-status').textContent=connection?`橙色补接 ${connection.repair_wall_count} 段 · ${connection.free_end_count} 个自由端点待校核（含正常墙端）`:'补接短缝与转角，保留门窗；支持撤销。';
  $('region-tool').disabled=!ready||state.busy; $('select-tool').disabled=state.busy; $('add-issue').disabled=state.busy;
  $('wall-count').textContent=ready?`${state.run.document.solid_wall_segments?.length??count} 段实墙`:'等待识别'; $('issue-count').textContent=state.issues.length;
  $('pipeline-status').textContent=ready?`粗墙 → 门窗 → 实墙整理：${geometryDescription(state.run.document)}`:'识别流程：粗识别墙体 → 识别门窗 → 保留洞口并整理墙体';
  $('step1').className='step '+(ready?'done':'active'); $('step2').className='step '+(ready?'done':state.file?'active':''); $('step3').className='step '+(ready?'active':'');
  $('empty-title').textContent=ready?'选择需要修改的墙段':'从识别开始';
  $('empty-copy').textContent=ready?(count?'点击墙段，指定修改方向、连接目标或数值，页面会直接修改。':'没有提取到候选墙段。可以使用「框选漏墙」记录遗漏区域。'):'点击「运行墙体识别」，然后选择图中需要修改的墙段。';
  $('canvas-hint').textContent=['region','furniture'].includes(state.mode)?'在图上拖出矩形，圈出漏掉的墙；Esc 取消':ready?'点击墙段直接修改 · 漏掉的墙可框选后补入':'先运行识别，再点击图中有问题的墙段';
  $('loading').hidden=state.busy!=='detect';
  renderOpeningList();renderFurnitureList();
  renderRoomList();
  $('furniture-tool').disabled=!ready||Boolean(state.busy);$('furniture-apply').disabled=Boolean(state.busy);
  $('furniture-sample').disabled=Boolean(state.busy);
  for(const field of $('furniture-form').querySelectorAll('input,select,button'))field.disabled=Boolean(state.busy)||(state.mode==='furniture-copy'&&field.id!=='furniture-cancel');
  for(const id of ['furniture-turn-left','furniture-turn-right'])$(id).disabled=Boolean(state.busy)||state.mode==='furniture-copy'||!state.furnitureDraft?.id;
  $('furniture-copy').disabled=Boolean(state.busy)||state.formDirty||state.mode==='furniture-copy'||!state.furnitureGeometry?.canCopyFurniture(state.furnitureDraft);
  if(state.mode==='furniture')$('canvas-hint').textContent='拖框圈出一件家具，再选择类别并应用；Esc 取消';
  if(state.mode==='furniture-place')$('canvas-hint').textContent='点击图上放置家具 · Esc 取消';
  if(state.mode==='furniture-copy')$('canvas-hint').textContent=`复制 ${state.furnitureCopy?.item.id||'家具'} · 点击图上放置 · Esc 或 × 取消`;
  if(state.mode==='wall-color')$('canvas-hint').textContent='点击原图中的墙线取色（忽略识别覆盖层）；Esc 取消';
}
function setMode(mode) {
  if(state.busy||(['region','furniture'].includes(mode)&&!state.run))return;
  if(state.formDirty) {toast('请先应用当前修改，或点击 × 取消。');return;}
  const wasCopy=state.mode==='furniture-copy';
  state.mode=mode; state.drag=null; $('draft-layer').replaceChildren();
  if(mode!=='furniture-copy'){state.furnitureCopy=null;state.furniture2dPreview=null;}
  if(mode!=='calibrate')window.dispatchEvent(new Event('wall-mode-change'));
  $('wall-color-pick').setAttribute('aria-pressed',String(mode==='wall-color'));
  $('plan').style.cursor=['wall-color','furniture-place','furniture-copy'].includes(mode)?'crosshair':'';
  if(['furniture','furniture-place','furniture-copy'].includes(mode))$('furniture-toggle').checked=true;
  $('stage').classList.toggle('region-mode',['region','furniture'].includes(mode)); $('plan').style.touchAction=['region','furniture'].includes(mode)?'none':'pan-x pan-y';
  for(const [id,name] of [['select-tool','select'],['region-tool','region'],['furniture-tool','furniture']]) {$(id).classList.toggle('active',mode===name);$(id).setAttribute('aria-pressed',String(mode===name));}
  if(['region','furniture'].includes(mode)){$('overlay-toggle').checked=true; renderPlan();}
  else if(wasCopy&&state.run)renderPlan();
  refresh();
}
function fit() {
  state.fitted=true; const stage=$('stage'),padding=getComputedStyle(stage);
  const width=stage.clientWidth-parseFloat(padding.paddingLeft)-parseFloat(padding.paddingRight);
  const height=stage.clientHeight-parseFloat(padding.paddingTop)-parseFloat(padding.paddingBottom);
  state.zoom=Math.min(width/state.width,height/state.height,1.25); state.zoom=Math.max(.15,state.zoom); applyZoom();
}
function applyZoom() {$('paper').style.width=`${state.width*state.zoom}px`;$('zoom-label').textContent=`${Math.round(state.zoom*100)}%`;if(state.run)renderPlan();}
function zoom(factor) {state.fitted=false;state.zoom=Math.max(.15,Math.min(4,state.zoom*factor));applyZoom();}
function clearSelection() {
  window.openingEditor?.clear();state.focusedOpening=null;state.focusedFurniture=null;state.furnitureDraft=null;
  $('furniture-form').hidden=true;state.selected=null;state.formDirty=false;$('issue-form').hidden=true;$('empty-selection').hidden=false;
  if(state.mode==='furniture-copy')setMode('select');
  renderPlan();refresh();
}
function selectItem(item) {
  if(state.busy)return false;
  if(state.formDirty&&state.selected?.id===item.id)return true;
  if(state.formDirty&&state.selected?.id!==item.id){toast('请先应用当前修改，或点击 × 取消。');return false;}
  state.furnitureDraft=null;$('furniture-form').hidden=true;
  window.openingEditor?.clear();state.focusedOpening=null;
  const existing=null;
  state.selected=item; state.formDirty=false; $('empty-selection').hidden=true;$('issue-form').hidden=false;
  $('selected-id').textContent=item.id;
  $('selected-kind').textContent=item.kind==='region'?'漏识别区域':item.solid_parts?.length===0?'洞口连接':item.orientation==='horizontal'?'水平墙段':'垂直墙段';
  $('wall-measures').hidden=item.kind==='region';
  if(item.kind!=='region') {$('wall-length').textContent=item.length_px;$('wall-thickness').textContent=item.thickness_px;}
  $('issue-type').value=existing?.type||(item.kind==='region'?'missing_wall':'too_short');
  $('issue-type').disabled=item.kind==='region'; $('issue-type').querySelector('[value="missing_wall"]').hidden=item.kind!=='region';
  $('direction').value=existing?.direction||''; $('target').value=existing?.target_wall_id||''; $('note').value=existing?.note||'';
  $('amount').value=50;$('anchor').value='end';
  $('add-issue').textContent='应用修改，立即更新墙体';
  renderPlan();refresh();return true;
}
async function submitCurrent() {
  if(!state.selected)throw new Error('请先选择墙段或框选漏墙。');
  const selected=state.selected;
  const input={id:selected.id,wall_id:selected.kind==='region'?undefined:selected.id,region_px:selected.region_px,type:$('issue-type').value,direction:$('direction').value,target_wall_id:$('target').value,note:$('note').value.trim()};
  input.amount_px=Number($('amount').value);input.anchor=$('anchor').value;input.run_id=state.run.run_id;
  if(state.busy)throw new Error('请等待当前操作完成。');state.busy='edit';refresh();
  try {const result=await api('/api/apply-edit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});state.busy=false;adoptEdits(result);toast(result.changes.at(-1)?.summary||'墙体已更新');return result;}
  finally{state.busy=false;refresh();}
}
function adoptEdits(result) {
  state.run.document=result.document;state.issues=result.changes;state.historySize=result.history_size;state.dirty=true;state.formDirty=false;
  const selectedId=result.changes.at(-1)?.wall_id||state.selected?.id;
  $('target').replaceChildren(new Option('不指定墙段',''));for(const wall of result.document.walls)$('target').append(new Option(wall.id,wall.id));
  $('image-meta').textContent=`${state.width} × ${state.height} px · ${geometryDescription(result.document)}`;
  clearSelection();const current=result.document.walls.find(w=>w.id===selectedId);if(current)selectItem(current);
  $('save-status').textContent='构件已更新，保存项目可保留当前结果';renderIssues();renderPlan();refresh();
}
async function undoEdit() {
  if(state.busy||!state.historySize)return;
  if(state.formDirty){toast('请先应用当前修改，或点击 × 取消。');return;}
  state.busy='undo';refresh();try{const result=await api('/api/undo-edit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({run_id:state.run.run_id})});state.busy=false;adoptEdits(result);toast('已撤销上一步，构件已恢复');}finally{state.busy=false;refresh();}
}
async function connectWalls() {
  if(state.busy||!state.run)return;
  if(state.formDirty){toast('请先应用当前修改，或点击 × 取消。');return;}
  state.busy='connect';refresh();
  try {
    const result=await api('/api/connect-walls',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({run_id:state.run.run_id})});
    state.busy=false;adoptEdits(result);toast(result.changes.at(-1).summary);
  }finally{state.busy=false;refresh();}
}
async function partitionRooms() {
  if(state.busy||!state.run)return;
  if(state.formDirty){toast('请先应用当前修改，或点击 × 取消。');return;}
  state.busy='partition';refresh();
  try {
    const result=await api('/api/partition-rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({run_id:state.run.run_id})});
    state.busy=false;state.focusedRoom=null;$('rooms-toggle').checked=true;adoptEdits(result);
    toast(result.changes.at(-1).summary);
  }finally{state.busy=false;refresh();}
}
function focusRoom(room) {
  if(state.busy||state.mode!=='select')return;
  if(state.formDirty){toast('请先应用当前修改，或点击 × 取消。');return;}
  clearSelection();state.focusedRoom=room.id;$('rooms-toggle').checked=true;renderPlan();renderRoomList();
  $('room-layer').querySelector(`[data-room-id="${room.id}"]`)?.scrollIntoView({block:'nearest',inline:'nearest'});
  window.dispatchEvent(new Event('room-focus-change'));
}
function renderRoomList() {
  const doc=state.run?.document,partition=doc?.room_partition;
  const rooms=partition?.regions||[],scaled=Number.isFinite(doc?.scale_mm_per_px)&&doc.scale_mm_per_px>0;
  const areas=rooms.map(room=>roomMeasurements?.roomAreaM2(room,doc.scale_mm_per_px)??null);
  $('room-areas-toggle').disabled=Boolean(state.busy)||!rooms.length;
  $('room-area-total').textContent=rooms.length&&areas.every(a=>a!==null)?roomMeasurements.formatRoomArea(areas.reduce((a,b)=>a+b,0)):'—';
  $('room-area-hint').textContent=!rooms.length?'先分割或手绘房间区域，再标定比例。':!scaled?'请在“测量”中标定比例，才能计算实际面积。':!roomMeasurements?'正在加载面积工具…':areas.some(a=>a===null)?'部分区域轮廓无效，暂不合计。请重新检查区域。':'参考地面面积：扣除实墙与轮廓孔洞；家具不扣除，门槛按分区边界归属。仅合计已划区域，请校核轮廓。';
  const selectedIndex=rooms.findIndex(room=>room.id===state.focusedRoom);
  $('room-selected-area').textContent=selectedIndex<0?'':`参考面积 · ${scaled?roomMeasurements?.formatRoomArea(areas[selectedIndex])??'—':'未标定'}`;
  $('partition-rooms').disabled=Boolean(state.busy)||!state.run;
  $('partition-rooms').textContent=partition?'重新分割区域':'分割区域';
  $('rooms-toggle').disabled=Boolean(state.busy)||!partition;
  $('room-count').textContent=partition?`${partition.region_count} 个候选`:'未分析';
  $('room-status').textContent=partition?partition.warnings.join(' '):'识别并校核墙体、门窗后，可尝试分割。无需比例标定。';
  $('room-list').replaceChildren();
  for(const [index,room] of rooms.entries()){
    const button=document.createElement('button');button.className='button room-choice';button.textContent=`${room.id} · ${room.name&&room.name!==room.id?room.name:'区域待校核'} · ${scaled?roomMeasurements?.formatRoomArea(areas[index])??'—':'未标定'}`;
    button.setAttribute('aria-pressed',String(state.focusedRoom===room.id));button.disabled=Boolean(state.busy);
    button.addEventListener('click',()=>focusRoom(room));$('room-list').append(button);
  }
}
function renderRooms() {
  let layer=$('room-layer');
  if(!layer){layer=svgElement('g',{id:'room-layer'});$('plan-image').after(layer);}
  let labels=$('room-label-layer');
  if(!labels){labels=svgElement('g',{id:'room-label-layer','pointer-events':'none'});}
  $('draft-layer').before(labels);labels.replaceChildren();
  layer.replaceChildren();
  if(!$('rooms-toggle').checked)return;
  const partition=state.run?.document.room_partition;
  for(const [index,room] of (partition?.regions||[]).entries()){
    const color=['#23a59a','#9b77d3','#e5a43c','#5b94df','#dd819a','#83a93c'][index%6];
    const group=svgElement('g',{role:'button',tabindex:0,'aria-label':`${room.id} 区域待校核`,'data-room-id':room.id});
    const d=room.rings_px.map(ring=>'M'+ring.map(p=>p.join(',')).join('L')+'Z').join(' ');
    group.append(svgElement('path',{d,fill:color,'fill-opacity':state.focusedRoom===room.id ? 0.4 : 0.2,stroke:color,'stroke-width':1.5/state.zoom,'fill-rule':'evenodd'}));
    const area=roomMeasurements?.roomAreaM2(room,state.run.document.scale_mm_per_px);
    const areaText=roomMeasurements?.formatRoomArea(area)??'—';
    group.setAttribute('aria-label',`${room.id} ${room.name||'区域待校核'}，参考面积 ${areaText}`);
    const label=svgElement('text',{x:room.label_px[0],y:room.label_px[1],'text-anchor':'middle',fill:color,stroke:'white','stroke-width':3/state.zoom,'paint-order':'stroke',style:`font-size:${13/state.zoom}px;font-weight:700`});label.textContent=room.id;
    if($('room-areas-toggle').checked&&area!=null){
      const areaLabel=svgElement('tspan',{x:room.label_px[0],dy:17/state.zoom,class:'room-area-label',style:`font-size:${12/state.zoom}px`});areaLabel.textContent=areaText;label.append(areaLabel);
    }
    labels.append(label);
    group.addEventListener('click',event=>{event.stopPropagation();focusRoom(room);});
    group.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();focusRoom(room);}});layer.append(group);
  }
  for(const boundary of partition?.virtual_boundaries||[]){
    const line=svgElement('line',{x1:boundary.start_px[0],y1:boundary.start_px[1],x2:boundary.end_px[0],y2:boundary.end_px[1],stroke:'#b054a1','stroke-width':2/state.zoom,'stroke-dasharray':`${4/state.zoom} ${3/state.zoom}`,'pointer-events':'none'});
    const title=svgElement('title');title.textContent=`${boundary.id} 分区虚拟边界`;line.append(title);layer.append(line);
  }
}
function renderIssues() {
  const list=$('issue-list');list.replaceChildren();
  if(!state.issues.length){const p=document.createElement('p');p.className='list-empty';p.textContent='执行后的修改会出现在这里';list.append(p);return;}
  for(const issue of state.issues) {
    const card=document.createElement('div');card.className='issue-card';
    const open=document.createElement('button');open.className='issue-open';open.type='button';
    const id=document.createElement('strong');id.textContent=issue.id;const type=document.createElement('span');type.textContent=TYPES[issue.type];
    const note=document.createElement('p');note.textContent=issue.summary||issue.note;open.append(id,type,note);
    if(issue.type==='room_edit')open.addEventListener('click',event=>{event.stopImmediatePropagation();const room=state.run.document.room_partition?.regions.find(r=>r.id===issue.room_id);if(room)focusRoom(room);else toast('该区域已变化，可撤销恢复。');});
    if(issue.type==='opening_batch'&&!issue.opening_id)open.addEventListener('click',event=>{event.stopImmediatePropagation();$('opening-quick-controls').scrollIntoView({block:'nearest'});$('quick-opening-select').focus();});
    if(issue.type==='room_partition')open.addEventListener('click',event=>{event.stopImmediatePropagation();$('room-list').scrollIntoView({block:'nearest'});});
    if(issue.type==='gap_review')open.addEventListener('click',event=>{event.stopImmediatePropagation();$('diagnose-closure').click();});
    if(issue.type==='wall_connection')open.addEventListener('click',event=>{
      event.stopImmediatePropagation();
      const wall=state.run.document.walls.find(w=>issue.wall_ids?.includes(w.id));
      if(wall)selectItem(wall);else toast('本次没有保留的补接墙段。');
    });
    open.addEventListener('click',()=>{const furniture=state.run.document.furniture?.find(f=>f.id===issue.furniture_id);if(furniture){focusFurniture(furniture);return;}const opening=state.run.document.openings?.find(o=>o.id===issue.opening_id);if(opening){focusOpening(opening);return;}const wall=state.run.document.walls.find(w=>w.id===issue.wall_id);if(wall)selectItem(wall);else toast('这段墙已删除，可以撤销上一步恢复最近的修改。');});
    const remove=document.createElement('button');remove.className='issue-remove';remove.textContent='×';remove.setAttribute('aria-label',`移除 ${issue.id} 的问题`);
    remove.addEventListener('click',()=>{if(state.busy)return;state.issues=state.issues.filter(i=>i.id!==issue.id);state.dirty=true;if(state.selected?.id===issue.id)clearSelection();$('save-status').textContent='问题清单已修改，需重新保存';renderIssues();renderPlan();refresh();});
    card.append(open);list.append(card);
  }
}
function renderPlan() {
  if(!state.run)return renderPlanContent();
  const original=state.run.document;
  try{if(state.openingPreview)state.run.document=state.openingPreview;renderPlanContent();}
  finally{state.run.document=original;}
}
function renderPlanContent() {
  // Derived display layers also refresh on zoom, selection and geometry edits.
  window.dispatchEvent(new Event('wall-plan-rendered'));
  const layer=$('wall-layer');layer.replaceChildren();const regions=$('region-layer');regions.replaceChildren();
  $('furniture-layer').replaceChildren();
  renderRooms();
  if(!state.run)return;
  renderFurniture();
  const visible=$('overlay-toggle').checked;
  if(visible) {
    const problemIds=new Set(state.issues.map(i=>i.wall_id));const labels=[],floatingLabels=[];
    const lw=42/state.zoom,lh=19/state.zoom,fs=12/state.zoom;
    for(const wall of state.run.document.walls) {
      const group=svgElement('g',{'class':`wall-hit${problemIds.has(wall.id)?' problem':''}${state.selected?.id===wall.id?' selected':''}`,tabindex:'0',role:'button','aria-label':`${wall.id}，${wall.orientation==='horizontal'?'水平':'垂直'}墙段，长度 ${wall.length_px} 像素`});
      const [x0,y0,x1,y1]=wall.bbox_px;
      const solidParts=wall.solid_parts??[wall];
      for(const part of solidParts) {
        const [a,b,c,d]=part.bbox_px;
        group.append(svgElement('rect',{x:a,y:b,width:c-a,height:d-b,class:wall.source==='assisted_wall_connection'?'wall-shape connection-shape':'wall-shape','data-solid-id':part.id}));
        group.append(svgElement('line',{x1:part.start_px[0],y1:part.start_px[1],x2:part.end_px[0],y2:part.end_px[1],class:'wall-center'}));
      }
      for(const hint of wall.opening_hints||[])group.append(svgElement('line',{x1:hint.start_px[0],y1:hint.start_px[1],x2:hint.end_px[0],y2:hint.end_px[1],class:'opening-gap',stroke:'#087e8b','stroke-width':1,'stroke-dasharray':'4 4'}));
      group.append(svgElement('line',{x1:wall.start_px[0],y1:wall.start_px[1],x2:wall.end_px[0],y2:wall.end_px[1],stroke:'transparent','stroke-width':Math.max(13,wall.thickness_px)}));
      let lx=Math.max(0,Math.min(state.width-lw,(x0+x1)/2-lw/2)),ly=Math.max(0,(y0+y1)/2-lh/2);
      for(let tries=0;tries<14&&labels.some(b=>lx<b[0]+lw&&lx+lw>b[0]&&ly<b[1]+lh&&ly+lh>b[1]);tries++)ly=Math.min(state.height-lh,ly+lh+2/state.zoom);
      const labelGroup=svgElement('g',{class:group.getAttribute('class'),'aria-hidden':'true'});
      labels.push([lx,ly]);labelGroup.append(svgElement('line',{x1:(x0+x1)/2,y1:(y0+y1)/2,x2:lx+lw/2,y2:ly+lh/2,stroke:problemIds.has(wall.id)?'#c4611b':'#286be5','stroke-width':.8/state.zoom,'pointer-events':'none'}));labelGroup.append(svgElement('rect',{x:lx,y:ly,width:lw,height:lh,rx:3/state.zoom,class:'wall-label'}));const text=svgElement('text',{x:lx+lw/2,y:ly+13.2/state.zoom,'text-anchor':'middle',class:'wall-text',style:`font-size:${fs}px`});text.textContent=wall.id;labelGroup.append(text);if((state.zoom>=.6&&solidParts.some(p=>p.length_px>15)&&!$('wall-lengths-toggle').checked)||state.selected?.id===wall.id)floatingLabels.push(labelGroup);
      group.addEventListener('click',e=>{if(state.mode==='select'){e.stopPropagation();selectItem(wall);}});
      labelGroup.addEventListener('click',e=>{if(state.mode==='select'){e.stopPropagation();selectItem(wall);}});
      group.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectItem(wall);}});layer.append(group);
    }
    for(const label of floatingLabels)layer.append(label);
  }
  const allRegions=state.issues.filter(i=>i.region_px).map(i=>({id:i.id,region_px:i.region_px}));
  if(state.selected?.kind==='region'&&!allRegions.some(i=>i.id===state.selected.id))allRegions.push(state.selected);
  for(const item of allRegions) {
    const [x0,y0,x1,y1]=item.region_px;const group=svgElement('g',{role:'button',tabindex:'0','aria-label':`${item.id} 漏识别区域`});
    group.append(svgElement('rect',{x:x0,y:y0,width:x1-x0,height:y1-y0,class:'region-box'}));const text=svgElement('text',{x:x0+4,y:Math.max(12,y0-5),class:'region-text'});text.textContent=item.id;group.append(text);
    group.addEventListener('click',e=>{if(state.mode==='select'){e.stopPropagation();selectItem({...item,kind:'region'});}});
    group.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectItem({...item,kind:'region'});}});regions.append(group);
  }
  renderOpenings(regions);
}

function focusOpening(opening,{scroll=true}={}) {
  if(state.busy||state.mode!=='select')return;
  if(state.formDirty){toast('请先应用当前墙体修改，或点击 × 取消。');return;}
  clearSelection();state.focusedOpening=opening.id;renderPlan();renderOpeningList();
  window.openingEditor?.select(opening);
  if(scroll)document.getElementById(`opening-${opening.id}`)?.scrollIntoView({block:'nearest'});
}
function renderOpenings(layer) {
  if(!$('openings-toggle').checked)return;
  for(const o of state.run.document.openings||[]) {
    if(o.review_status==='rejected'||o.kind==='wall')continue;
    const color=o.kind==='window'?'#087e8b':o.kind==='door'?'#b74915':'#737080';
    const g=svgElement('g',{class:'opening-hit','data-opening-id':o.id,style:`cursor:${o.orientation==='horizontal'?'ew':'ns'}-resize`,tabindex:0,role:'button','aria-label':`${o.id} ${o.label} ${o.review_status==='confirmed'?'已确认':'待校核'}`});
    const [x0,y0,x1,y1]=o.bbox_px,active=state.focusedOpening===o.id;
    if(o.id==='待新增'){g.setAttribute('tabindex','-1');g.style.pointerEvents='none';}
    g.append(svgElement('rect',{x:x0,y:y0,width:x1-x0,height:y1-y0,fill:color,'fill-opacity':active?.35:.16,stroke:color,'stroke-width':active?3:1}));
    g.append(svgElement('line',{x1:o.start_px[0],y1:o.start_px[1],x2:o.end_px[0],y2:o.end_px[1],stroke:color,'stroke-width':2,'stroke-dasharray':o.review_status==='confirmed'?'none':'5 3'}));
    const swing=['door','window'].includes(o.kind)&&(!o.requires_confirmation||o.review_status==='confirmed')?state.openingOperation?.openingSymbol(state.run.document,o):null;
    if(swing){
      const symbol=svgElement('g',{'data-opening-swing':o.id,'pointer-events':'none'});
      if(swing.flip){
        symbol.append(svgElement('polygon',{points:swing.corners.map(p=>p.join(',')).join(' '),fill:color,'fill-opacity':.12,stroke:color,'stroke-width':1.5/state.zoom}));
        symbol.append(svgElement('line',{x1:swing.hingeStart[0],y1:swing.hingeStart[1],x2:swing.hingeEnd[0],y2:swing.hingeEnd[1],stroke:color,'stroke-width':3/state.zoom}));
      }else{
        symbol.append(svgElement('line',{x1:swing.leafStart[0],y1:swing.leafStart[1],x2:swing.leafEnd[0],y2:swing.leafEnd[1],stroke:color,'stroke-width':2/state.zoom}));
        if(swing.arc)symbol.append(svgElement('path',{d:swing.arc,fill:'none',stroke:color,'stroke-width':1.5/state.zoom,'stroke-dasharray':`${4/state.zoom} ${3/state.zoom}`}));
        symbol.append(svgElement('circle',{cx:swing.hinge[0],cy:swing.hinge[1],r:3/state.zoom,fill:color}));
      }
      g.append(symbol);
    }
    const x=Math.max(2,Math.min(state.width-38/state.zoom,(x0+x1)/2+7/state.zoom)),y=Math.max(14/state.zoom,Math.min(state.height-3,(y0+y1)/2));
    const label=svgElement('text',{x,y,fill:color,stroke:'white','stroke-width':3/state.zoom,'paint-order':'stroke',style:`font-size:${12/state.zoom}px;font-weight:700`});label.textContent=o.id;g.append(label);
    g.addEventListener('click',e=>{e.stopPropagation();focusOpening(o);});
    g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();focusOpening(o);}});layer.append(g);
  }
}
function renderOpeningList() {
  const list=$('opening-list');list.replaceChildren();
  const openings=state.run?.document.openings||[];
  $('opening-count').textContent=openings.filter(o=>o.review_status!=='rejected').length;
  if(!openings.length){const p=document.createElement('p');p.className='list-empty';p.textContent=state.run?'未找到门窗候选，可能仍有漏检。':'运行识别后显示门窗候选';list.append(p);return;}
  for(const o of openings) {
    const row=document.createElement('div');row.className='opening-row'+(state.focusedOpening===o.id?' focused':'');row.id=`opening-${o.id}`;
    const button=document.createElement('button');button.className='text-button';button.type='button';button.textContent=`${o.id} · ${o.label}`;button.disabled=Boolean(state.busy);button.addEventListener('click',()=>focusOpening(o));
    const status=document.createElement('small');status.textContent=o.review_status==='confirmed'?'已确认':o.review_status==='rejected'?'已排除':o.requires_confirmation?'待确认，暂不扣墙':'待校核';
    const select=document.createElement('select');select.setAttribute('aria-label',`${o.id} 校核类别`);select.append(new Option('校核…',''),new Option('确认为墙','wall'),new Option('确认为窗','window'),new Option('确认为门','door'),new Option('类别待定','unclassified'),new Option('标为误报','rejected'));select.disabled=Boolean(state.busy);
    select.addEventListener('change',()=>{if(select.value)handle(reviewOpening(o.id,select.value));});row.append(button,status,select);list.append(row);
  }
}
async function reviewOpening(id,kind) {
  if(state.busy)return;if(state.formDirty){renderOpeningList();throw new Error('请先应用当前墙体修改，或点击 × 取消。');}
  state.busy='edit';refresh();
  try {const result=await api('/api/review-opening',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({run_id:state.run.run_id,opening_id:id,kind})});state.busy=false;adoptEdits(result);state.focusedOpening=id;renderPlan();toast(result.changes.at(-1).summary);}
  finally{state.busy=false;refresh();}
}
function imagePoint(event) {const p=$('plan').createSVGPoint();p.x=event.clientX;p.y=event.clientY;const t=p.matrixTransform($('plan').getScreenCTM().inverse());return [Math.max(0,Math.min(state.width,t.x)),Math.max(0,Math.min(state.height,t.y))];}
function updateFurnitureDirection() {
  $('furniture-bathing-help').hidden=!['wet_area','shower','bathtub'].includes($('furniture-kind').value);
  const directional=['bed','sofa'].includes($('furniture-kind').value);
  $('furniture-direction-field').hidden=!directional;$('furniture-direction-help').hidden=!directional;
  if(!directional)$('furniture-rotation').value='';
}
function focusFurniture(item,{scroll=true}={}) {
  if(state.busy||state.mode!=='select')return;
  if(state.formDirty){toast('请先应用当前修改，或点击 × 取消。');return;}
  clearSelection();state.furnitureDraft=structuredClone(item);state.focusedFurniture=item.id||null;
  $('furniture-form').hidden=false;$('furniture-selected-id').textContent=item.id||'新增家具';
  $('furniture-kind').value=item.kind;$('furniture-rotation').value=item.rotation_deg??'';updateFurnitureDirection();
  for(const [i,key] of ['x0','y0','x1','y1'].entries())$('furniture-'+key).value=item.bbox_px[i];
  furniture2dUI.fill(item);
  renderPlan();renderFurnitureList();if(scroll)$('furniture-form').scrollIntoView({block:'nearest'});
}
function renderFurniture() {
  if(!$('furniture-toggle').checked)return;
  const items=(state.run.document.furniture||[]).map(f=>state.furnitureDraft?.id===f.id?state.furnitureDraft:f);
  if(state.furnitureDraft&&!state.furnitureDraft.id)items.push({...state.furnitureDraft,id:'新增',review_status:'unreviewed'});
  if(state.furniture2dPreview)items.push(state.furniture2dPreview);
  // Embedded sinks/hobs must receive clicks above their enclosing counter.
  const area=f=>(f.bbox_px[2]-f.bbox_px[0])*(f.bbox_px[3]-f.bbox_px[1]);
  items.sort((a,b)=>area(b)-area(a));
  const labels=[];
  for(const f of items) {
    if(f.review_status==='rejected')continue;
    const [x0,y0,x1,y1]=f.bbox_px,color=FURNITURE_COLORS[f.kind]||'#168187';
    const active=f.id===state.focusedFurniture;
    const group=svgElement('g',{class:'furniture-hit',role:'button',tabindex:0,'data-furniture-id':f.id,'aria-label':`${f.id} ${furnitureDisplayLabel(f)}`});
    group.append(svgElement('rect',{transform:`rotate(${f.model_3d?.rotation_deg||0} ${(x0+x1)/2} ${(y0+y1)/2})`,x:x0,y:y0,width:x1-x0,height:y1-y0,fill:color,'fill-opacity':active||f.id==='待复制'?.16:.05,stroke:color,'stroke-width':(active?3:2)/state.zoom,'stroke-dasharray':f.review_status==='confirmed'&&f.id!=='待复制'?'none':`${5/state.zoom} ${3/state.zoom}`}));
    const text=`${f.id} ${furnitureDisplayLabel(f)}`,fontSize=12/state.zoom;
    const labelWidth=Array.from(text).reduce((n,c)=>n+(c.charCodeAt(0)>255?1:.65),0)*fontSize;
    const lx=Math.max(2,Math.min(state.width-labelWidth-2,x0+3/state.zoom));
    let ly=Math.max(15/state.zoom,y0-4/state.zoom);
    for(let offset=0;offset<12;offset++) {
      const candidate=Math.max(fontSize+2,Math.min(state.height-3,ly+(offset%2?-1:1)*Math.ceil(offset/2)*16/state.zoom));
      const box=[lx,candidate-fontSize,lx+labelWidth,candidate+3/state.zoom];
      if(!labels.some(b=>box[0]<b[2]&&box[2]>b[0]&&box[1]<b[3]&&box[3]>b[1])){ly=candidate;labels.push(box);break;}
    }
    if(Math.abs(ly-(y0-4/state.zoom))>8/state.zoom)group.append(svgElement('line',{x1:lx,y1:ly,x2:x0,y2:y0,stroke:color,'stroke-width':1/state.zoom,'pointer-events':'none'}));
    const label=svgElement('text',{x:lx,y:ly,fill:color,stroke:'white','stroke-width':3/state.zoom,'paint-order':'stroke',style:`font-size:${fontSize}px;font-weight:700`});
    label.textContent=text;group.append(label);
    if(!['unclassified_area','water_feature'].includes(f.kind)){const cx=(x0+x1)/2,cy=(y0+y1)/2;
      const arrow=svgElement('text',{x:cx,y:cy,fill:color,'text-anchor':'middle',style:`font-size:${20/state.zoom}px`,transform:`rotate(${(f.rotation_deg||0)+(f.model_3d?.fit_rotation_deg||0)+(f.model_3d?.rotation_deg||0)} ${cx} ${cy})`,'pointer-events':'none'});arrow.textContent='↑';group.append(arrow);}
    group.addEventListener('click',e=>{e.stopPropagation();focusFurniture(f);});
    group.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();focusFurniture(f);}});
    $('furniture-layer').append(group);
  }
}
function renderFurnitureList() {
  const list=$('furniture-list');list.replaceChildren();const items=state.run?.document.furniture||[];
  $('furniture-count').textContent=items.filter(f=>f.review_status!=='rejected').length;
  if(!items.length){const p=document.createElement('p');p.className='list-empty';p.textContent=state.run?'未找到家具或设施候选，可框选补入。':'运行识别后显示家具候选';list.append(p);}
  for(const f of items){
    const row=document.createElement('div');row.className='furniture-row'+(state.focusedFurniture===f.id?' focused':'');row.id=`furniture-${f.id}`;
    const select=document.createElement('button');select.type='button';select.className='text-button';select.textContent=`${f.id} · ${furnitureDisplayLabel(f)}`;select.disabled=Boolean(state.busy);select.addEventListener('click',()=>focusFurniture(f));
    const status=document.createElement('small');status.textContent=f.review_status==='rejected'?'已排除':f.kind==='wet_area'?'默认淋浴':f.review_status==='confirmed'?'已确认':'待校核';
    const reject=document.createElement('button');reject.type='button';reject.className='text-button';reject.textContent='排除';reject.disabled=Boolean(state.busy)||f.review_status==='rejected';reject.addEventListener('click',()=>handle(editFurniture({action:'reject',furniture_id:f.id})));
    row.append(select,status,reject);list.append(row);
  }
}
async function submitFurniture() {
  const draft=state.furnitureDraft;if(!draft)throw new Error('请先选择或框选家具。');
  const rotation=$('furniture-rotation').value;
  return editFurniture({action:draft.id?'update':'add',furniture_id:draft.id,kind:$('furniture-kind').value,
    ...furniture2dUI.input(),rotation_deg:rotation===''?null:Number(rotation)},true);
}
async function editFurniture(input,fromForm=false) {
  if(state.busy)return;
  if(state.formDirty&&!fromForm)throw new Error('请先应用当前修改，或点击 × 取消。');
  state.busy='edit';refresh();
  try{const result=await api('/api/edit-furniture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({run_id:state.run.run_id,...input})});state.busy=false;adoptEdits(result);
    if(fromForm){const item=result.document.furniture.find(f=>f.id===result.changes.at(-1)?.furniture_id);if(item)focusFurniture(item);}
    toast(result.changes.at(-1).summary);}
  finally{state.busy=false;refresh();}
}
function dragBox(a,b){return [Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1])].map(v=>Math.round(v*10)/10);}
$('plan').addEventListener('pointerdown',e=>{if(!['region','furniture'].includes(state.mode)||state.busy||e.button!==0)return;if(state.formDirty){toast('请先应用当前修改，或点击 × 取消。');return;}e.preventDefault();state.drag={start:imagePoint(e),pointer:e.pointerId};$('plan').setPointerCapture(e.pointerId);});
$('plan').addEventListener('pointermove',e=>{if(!state.drag||e.pointerId!==state.drag.pointer)return;const b=dragBox(state.drag.start,imagePoint(e));$('draft-layer').replaceChildren(svgElement('rect',{x:b[0],y:b[1],width:b[2]-b[0],height:b[3]-b[1],class:'region-box','pointer-events':'none'}));});
$('plan').addEventListener('pointerup',e=>{if(!state.drag||e.pointerId!==state.drag.pointer)return;const b=dragBox(state.drag.start,imagePoint(e));state.drag=null;$('draft-layer').replaceChildren();$('plan').releasePointerCapture(e.pointerId);if(b[2]-b[0]<6||b[3]-b[1]<6){toast('请拖出一个稍大的矩形，圈住需要补入的构件。');return;}if(state.mode==='furniture'){setMode('select');focusFurniture({bbox_px:b,kind:state.insertionKind||'unclassified',rotation_deg:null});state.formDirty=true;return;}setMode('select');selectItem({id:`M${String(++state.regionCount).padStart(3,'0')}`,kind:'region',region_px:b});state.formDirty=true;refresh();});
$('plan').addEventListener('pointercancel',()=>{state.drag=null;$('draft-layer').replaceChildren();});
$('plan').addEventListener('click',e=>{if(e.target.id==='plan-image'&&state.mode==='select'&&!state.formDirty)clearSelection();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){state.drag=null;$('draft-layer').replaceChildren();if(['region','furniture','wall-color'].includes(state.mode))setMode('select');}});
async function api(path, options={}) {
  if(!state.token){const config=await fetch('/api/config');if(!config.ok)throw new Error('无法连接本地程序。');state.token=(await config.json()).token;}
  const response=await fetch(path,{...options,headers:{...(options.headers||{}),'X-Wall-Token':state.token}});
  const data=await response.json();if(!response.ok)throw new Error(data.error||'操作未完成，请重试。');return data;
}
async function allowReplacement() {
  if(!state.dirty&&!state.formDirty)return true;
  const dialog=$('confirm-dialog');dialog.returnValue='cancel';dialog.showModal();return new Promise(resolve=>dialog.addEventListener('close',()=>resolve(dialog.returnValue==='discard'),{once:true}));
}
async function loadFile(file, guard=true) {
  if(state.busy)return false;if(guard&&!(await allowReplacement()))return false;
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>12*1024*1024)throw new Error('请选择 12 MB 以内的 PNG、JPG 或 WebP 图片。');
  const url=URL.createObjectURL(file);const image=new Image();
  try {await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('无法读取这张图片，请换一张。'));image.src=url;});if(image.width*image.height>4000000)throw new Error('本步支持最多 400 万像素，请先缩小图片。');}
  catch(error){URL.revokeObjectURL(url);throw error;}
  if(state.blobUrl)URL.revokeObjectURL(state.blobUrl);state.blobUrl=url;state.file=file;state.width=image.width;state.height=image.height;
  state.wallColors=[];renderPalette();$('wall-color-tolerance').value='8';
  state.run=null;state.issues=[];state.selected=null;state.formDirty=false;state.dirty=false;state.regionCount=0;state.historySize=0;
  state.focusedOpening=null;state.furnitureDraft=null;state.focusedFurniture=null;$('furniture-form').hidden=true;
  $('filename').textContent=file.name;$('image-meta').textContent=`${image.width} × ${image.height} px · 等待识别`;
  $('plan').setAttribute('viewBox',`0 0 ${image.width} ${image.height}`);$('plan-image').setAttribute('width',image.width);$('plan-image').setAttribute('height',image.height);$('plan-image').setAttribute('href',url);
  $('save-status').textContent='修改由页面程序直接执行，可撤销';setMode('select');clearSelection();renderIssues();refresh();requestAnimationFrame(fit);return true;
}
async function loadSample(guard=true) {const response=await fetch('/api/sample-image');if(!response.ok)throw new Error('示例图片加载失败。');return loadFile(new File([await response.blob()],'示例户型.png',{type:'image/png'}),guard);}
async function loadFurnitureSample(guard=true) {const response=await fetch('/api/furniture-sample-image');if(!response.ok)throw new Error('家具示例图片加载失败。');return loadFile(new File([await response.blob()],'家具示例图.jpg',{type:'image/jpeg'}),guard);}
async function detect() {
  if(state.busy)throw new Error('请等待当前操作完成。');if(!state.file)throw new Error('请先导入图片。');
  if(!(await allowReplacement()))return {cancelled:true};
  state.busy='detect';refresh();
  try {
    const tolerance=Number($('wall-color-tolerance').value);
    if(!Number.isInteger(tolerance)||tolerance<1||tolerance>24)throw new Error('颜色容差需为 1–24 的整数。');
    const result=await api('/api/detect',{method:'POST',headers:{'Content-Type':state.file.type,'X-Image-Name':encodeURIComponent(state.file.name),'X-Wall-Options':JSON.stringify({wall_colors:state.wallColors,color_tolerance:tolerance})},body:state.file});
    state.run=result;state.width=result.document.image.width_px;state.height=result.document.image.height_px;state.issues=result.changes||[];state.selected=null;state.formDirty=false;state.dirty=Boolean(result.default_scale_applied);state.regionCount=0;state.historySize=result.history_size||0;
    state.focusedOpening=null;state.furnitureDraft=null;state.focusedFurniture=null;$('furniture-form').hidden=true;
    $('plan-image').setAttribute('href',result.image_url);$('plan-image').setAttribute('width',state.width);$('plan-image').setAttribute('height',state.height);$('plan').setAttribute('viewBox',`0 0 ${state.width} ${state.height}`);
    const timing=result.elapsed_ms==null?'':` · ${(result.elapsed_ms/1000).toFixed(1)} 秒${result.cache_hit?'（复用识别）':''}`;
    $('image-meta').textContent=`${state.width} × ${state.height} px · ${geometryDescription(result.document)}${timing}`;
    $('target').replaceChildren(new Option('不指定墙段',''));for(const wall of result.document.walls)$('target').append(new Option(wall.id,wall.id));
    $('overlay-toggle').checked=true;$('save-status').textContent='选择墙段并应用修改，完成后保存项目';clearSelection();renderIssues();fit();
    toast(`识别完成：${geometryDescription(result.document)}，门窗洞口已从实墙中扣除，仍需校核${result.default_scale_applied?`；已默认按 ${result.document.calibration.opening_id} 门洞 80 cm 估算比例`:''}`);
    return {run_id:result.run_id,wall_count:result.document.walls.length};
  } finally {state.busy=false;setMode('select');refresh();}
}
async function saveProject() {
  if(state.busy)throw new Error('请等待当前操作完成。');if(state.formDirty)throw new Error('请先应用当前表单里的修改，或点击 × 取消，再保存项目。');
  if(!state.run)throw new Error('请先运行识别。');
  const signature=JSON.stringify(state.issues), runId=state.run.run_id;state.busy='save';refresh();
  try {const result=await api('/api/save-project',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({run_id:runId})});
    if(state.run?.run_id===runId&&JSON.stringify(state.issues)===signature)state.dirty=false;
    $('save-status').textContent=`项目已保存 · ${result.saved_name}`;toast(`已保存 ${result.solid_count??state.run.document.solid_wall_segments?.length??result.count} 段实墙、${result.furniture_count??0} 件家具与设施及门窗、修改记录。`);return result;
  } finally {state.busy=false;refresh();}
}
async function showProjects(){
  if(state.busy)return;
  const dialog=$('projects-dialog'),list=$('projects-list');
  if(!dialog.open)dialog.showModal();
  $('projects-message').textContent='正在读取本机保存的项目…';list.replaceChildren();
  $('refresh-projects').disabled=true;
  try{
    const result=await api('/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    for(const project of result.projects){
      const button=document.createElement('button');button.className='button project-choice';
      const title=document.createElement('strong');title.textContent=project.filename||project.id;
      const detail=document.createElement('span');detail.textContent=project.error||`${project.wall_count} 段墙 · ${project.room_count} 个区域 · ${project.calibrated?'已标定':'未标定'}`;
      const version=document.createElement('small');version.textContent=project.id;
      button.append(title,detail,version);button.disabled=Boolean(project.error);button.dataset.invalid=String(Boolean(project.error));
      button.addEventListener('click',()=>handle(openProject(project.id)));list.append(button);
    }
    $('projects-message').textContent=result.projects.length?`按保存时间从新到旧${result.truncated?'，显示最近 100 个项目':''}。`:'还没有保存的项目。识别并编辑后，点击“保存项目”即可。';
  }catch(error){$('projects-message').textContent=error.message;}finally{$('refresh-projects').disabled=false;}
}
async function openProject(id){
  if(state.busy)return;
  if(!(await allowReplacement()))return;
  state.busy='open-project';refresh();
  for(const button of $('projects-dialog').querySelectorAll('button'))button.disabled=true;
  $('projects-message').textContent='正在恢复项目…';
  try{
    const result=await api('/api/open-project',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project_id:id})});
    const response=await fetch(result.image_url);if(!response.ok)throw new Error('项目底图读取失败。');
    const blob=await response.blob(), image=new Image(),url=URL.createObjectURL(blob);
    try{await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('项目底图无法显示。'));image.src=url;});}
    finally{URL.revokeObjectURL(url);}
    // Replace only after both document and image are ready, preserving the old draft on failure.
    window.dispatchEvent(new Event('project-replacing'));
    if(state.blobUrl)URL.revokeObjectURL(state.blobUrl);state.blobUrl=null;
    const doc=result.document;state.file=new File([blob],doc.image.original_filename||'floorplan.png',{type:'image/png'});
    state.run=result;state.width=doc.image.width_px;state.height=doc.image.height_px;
    state.issues=result.changes;state.historySize=result.history_size;state.regionCount=0;
    state.formDirty=false;state.dirty=Boolean(result.default_scale_applied);state.focusedRoom=null;state.focusedOpening=null;state.focusedFurniture=null;state.furnitureDraft=null;
    state.wallColors=[...(doc.parameters?.wall_colors||[])];renderPalette();$('wall-color-tolerance').value=doc.parameters?.color_tolerance??8;
    $('filename').textContent=state.file.name;$('image-meta').textContent=`${state.width} × ${state.height} px · ${geometryDescription(doc)}`;
    $('plan').setAttribute('viewBox',`0 0 ${state.width} ${state.height}`);
    for(const key of ['width','height'])$('plan-image').setAttribute(key,state[key]);$('plan-image').setAttribute('href',result.image_url);
    $('target').replaceChildren(new Option('不指定墙段',''));for(const wall of doc.walls)$('target').append(new Option(wall.id,wall.id));
    for(const key of ['overlay-toggle','openings-toggle','furniture-toggle','rooms-toggle'])$(key).checked=true;
    state.busy=false;setMode('select');clearSelection();renderIssues();fit();
    $('save-status').textContent=`已打开 ${id} · 修改后保存为新版本`;$('projects-dialog').close();
    toast(result.default_scale_applied?`项目已恢复；已默认按 ${doc.calibration.opening_id} 门洞 80 cm 估算比例，可撤销或重新标定。`:'项目已恢复，可继续编辑；撤销从本次打开后开始。');
  }catch(error){$('projects-message').textContent=error.message;}
  finally{state.busy=false;refresh();$('close-projects').disabled=false;$('refresh-projects').disabled=false;
    for(const button of $('projects-list').querySelectorAll('button'))button.disabled=button.dataset.invalid==='true';
  }
}
$('open-projects').addEventListener('click',()=>handle(showProjects()));
$('refresh-projects').addEventListener('click',()=>handle(showProjects()));
$('close-projects').addEventListener('click',()=>{if(!state.busy)$('projects-dialog').close();});
$('projects-dialog').addEventListener('cancel',e=>{if(state.busy)e.preventDefault();});
function handle(promise) {Promise.resolve(promise).catch(error=>toast(error.message||'操作失败，请重试。',true));}
$('upload').addEventListener('click',()=>{$('file').value='';$('file').click();});
$('file').addEventListener('change',()=>{if($('file').files[0])handle(loadFile($('file').files[0]));});
$('sample').addEventListener('click',()=>handle(loadSample()));$('detect').addEventListener('click',()=>handle(detect()));$('save').addEventListener('click',()=>handle(saveProject()));$('undo').addEventListener('click',()=>handle(undoEdit()));
$('connect-walls').addEventListener('click',()=>handle(connectWalls()));
$('partition-rooms').addEventListener('click',()=>handle(partitionRooms()));
$('rooms-toggle').addEventListener('change',renderPlan);
$('select-tool').addEventListener('click',()=>setMode('select'));$('region-tool').addEventListener('click',()=>setMode('region'));$('overlay-toggle').addEventListener('change',renderPlan);
$('openings-toggle').addEventListener('change',renderPlan);
$('furniture-toggle').addEventListener('change',renderPlan);
$('furniture-tool').addEventListener('click',()=>{state.insertionKind='unclassified';setMode('furniture');});
$('furniture-sample').addEventListener('click',()=>handle(loadFurnitureSample()));
$('furniture-cancel').addEventListener('click',clearSelection);
function renderPalette() {
  $('wall-palette').replaceChildren();
  for(const color of state.wallColors){
    const button=document.createElement('button');button.type='button';button.className='palette-chip';button.disabled=Boolean(state.busy);
    const swatch=document.createElement('span');swatch.style.backgroundColor=color;
    button.append(swatch,document.createTextNode(`${color} ×`));button.setAttribute('aria-label',`删除墙色 ${color}`);
    button.addEventListener('click',()=>{state.wallColors=state.wallColors.filter(c=>c!==color);renderPalette();});$('wall-palette').append(button);
  }
  $('wall-color-hint').textContent=state.wallColors.length?`已添加 ${state.wallColors.length} 种墙色；重新识别后生效。`:'尚未添加额外墙色。浅色外围线会另列为待确认边界，可确认为墙或窗。';
}
function addWallColor(color) {
  if(state.wallColors.includes(color)){toast('这个颜色已经添加。');return;}
  if(state.wallColors.length>=6)throw new Error('最多添加 6 种墙色，请先删除不需要的颜色。');
  const tolerance=Number($('wall-color-tolerance').value);
  if(Math.min(...[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)))+tolerance>=253)throw new Error('颜色范围包含白色背景，请选墙线颜色或减小容差。');
  state.wallColors.push(color);renderPalette();toast(`已添加墙色 ${color}，重新识别后生效。`);
}
$('wall-color-add').addEventListener('click',()=>handle(Promise.resolve().then(()=>addWallColor($('wall-color').value))));
$('wall-color-pick').addEventListener('click',()=>setMode(state.mode==='wall-color'?'select':'wall-color'));
$('plan').addEventListener('click',e=>{
  if(state.mode!=='wall-color'||state.busy)return;
  e.preventDefault();e.stopImmediatePropagation();const point=imagePoint(e);
  handle((async()=>{
    const bitmap=await createImageBitmap(state.file);const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
    const context=canvas.getContext('2d',{willReadFrequently:true});context.fillStyle='white';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0);bitmap.close();
    const rgb=context.getImageData(Math.max(0,Math.min(canvas.width-1,Math.round(point[0]))),Math.max(0,Math.min(canvas.height-1,Math.round(point[1]))),1,1).data;
    const color='#'+[...rgb].slice(0,3).map(v=>v.toString(16).padStart(2,'0')).join('');$('wall-color').value=color;addWallColor(color);setMode('select');
  })());
},true);
$('furniture-kind').addEventListener('change',updateFurnitureDirection);
$('furniture-form').addEventListener('submit',e=>{e.preventDefault();handle(submitFurniture());});
for(const input of $('furniture-form').querySelectorAll('input,select'))input.addEventListener('input',()=>{state.formDirty=true;furniture2dUI.previewFields();refresh();});
$('clear-selection').addEventListener('click',clearSelection);$('zoom-out').addEventListener('click',()=>zoom(1/1.25));$('zoom-in').addEventListener('click',()=>zoom(1.25));$('fit').addEventListener('click',fit);
$('issue-form').addEventListener('submit',e=>{e.preventDefault();handle(submitCurrent());});
for(const id of ['issue-type','direction','target','note','amount','anchor'])$(id).addEventListener('input',()=>{state.formDirty=true;refresh();});
window.addEventListener('beforeunload',event=>{if(state.dirty||state.formDirty){event.preventDefault();event.returnValue='';}});
new ResizeObserver(()=>{if(state.fitted)fit();}).observe($('stage'));
async function registerTools() {
  if(!document.modelContext?.registerTool)return;
  const lifecycle=new AbortController();window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
  const definitions=[
    {name:'read_wall_review',title:'读取墙体校核状态',description:'Read the current candidate walls and staged issues without changing them.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute:()=>snapshot()},
    {name:'run_wall_detection',title:'运行当前图片的墙体识别',description:'Run the Python detector for the currently loaded image. Unsaved feedback requires the same confirmation as the visible button.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:false},execute:()=>detect()},
    {name:'apply_current_wall_edit',title:'应用当前墙体修改',description:'Execute the currently selected wall edit using the visible direction, target, amount and note. This immediately changes geometry and can be undone.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:false},execute:async()=>{await submitCurrent();return snapshot();}},
    {name:'undo_wall_edit',title:'撤销最近墙体修改',description:'Restore the previous wall geometry.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:false},execute:async()=>{await undoEdit();return snapshot();}},
    {name:'save_wall_project',title:'保存当前墙体项目',description:'Save the current wall geometry, source image and executed changes locally.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:false},execute:()=>saveProject()}
  ];
  for(const definition of definitions){try{await document.modelContext.registerTool(definition,{signal:lifecycle.signal});}catch{/* Optional browser capability; manual workflow remains available. */}}
}
$('room-areas-toggle').addEventListener('change',()=>{if($('room-areas-toggle').checked)$('rooms-toggle').checked=true;renderPlan();});
import('/room-areas.mjs').then(module=>{roomMeasurements=module;renderPlan();renderRoomList();}).catch(()=>{$('room-area-hint').textContent='面积工具加载失败，请刷新页面。';});
handle(new URLSearchParams(location.search).get('sample')==='furniture'?loadFurnitureSample(false):loadSample(false));handle(registerTools());refresh();

// Preview locally during a gesture; commit one shared document edit on release.
const furniture2dUI=(() => {
  let geometry=null,snapping=null,snapResult=null,baseline={},gesture=null,frame=0,suppressClickUntil=0;
  const fields={center_x_mm:'furniture-center-x',center_y_mm:'furniture-center-y',width_mm:'furniture-width',depth_mm:'furniture-depth'};
  const scaled=()=>Number.isFinite(state.run?.document.scale_mm_per_px)&&state.run.document.scale_mm_per_px>0;
  const paint=()=>{if(state.run){$('furniture-layer').replaceChildren();renderFurniture();drawSnap();window.collisionUI?.render();}};
  function drawSnap(){
    let layer=$('furniture-snap-layer');
    if(!layer){layer=svgElement('g',{id:'furniture-snap-layer','pointer-events':'none'});$('plan').append(layer);}
    layer.replaceChildren();if(!snapResult)return;
    const z=state.zoom,scale=state.run.document.scale_mm_per_px;
    for(const guide of snapResult.guides){
      const a=guide.axis===0?[guide.value,0]:[0,guide.value],b=guide.axis===0?[guide.value,state.height]:[state.width,guide.value];
      layer.append(svgElement('line',{x1:a[0],y1:a[1],x2:b[0],y2:b[1],stroke:'#d46722','stroke-width':1.5/z,'stroke-dasharray':`${5/z} ${4/z}`}));
    }
    for(const gap of snapResult.gaps){
      const a=gap.axis===0?[gap.from,gap.cross]:[gap.cross,gap.from],b=gap.axis===0?[gap.to,gap.cross]:[gap.cross,gap.to];
      layer.append(svgElement('line',{x1:a[0],y1:a[1],x2:b[0],y2:b[1],stroke:'#197c91','stroke-width':1/z}));
      const label=svgElement('text',{x:(a[0]+b[0])/2+4/z,y:(a[1]+b[1])/2-4/z,fill:'#126477','font-size':11/z,'paint-order':'stroke',stroke:'#fff','stroke-width':3/z});
      label.textContent=scale?`${(gap.distance*scale/10).toFixed(1)} cm`:`${gap.distance.toFixed(1)} px`;layer.append(label);
    }
  }
  function snap(item,event,excludeId=item.id){
    if(!snapping)return item;
    snapResult=snapping.snapFurniture(state.run.document,item,{threshold:8/state.zoom,enabled:$('furniture-snap-toggle').checked&&!event.altKey,excludeId});
    return snapResult.item;
  }
  import('/furniture-snap.mjs').then(module=>snapping=module).catch(()=>toast('家具吸附加载失败，请刷新页面。',true));
  $('furniture-snap-toggle').addEventListener('change',()=>{snapResult=null;drawSnap();});
  import('/furniture-move.mjs').then(module=>{
    geometry=module;state.furnitureGeometry=module;if(state.furnitureDraft)fill(state.furnitureDraft);refresh();
  }).catch(()=>toast('家具摆放工具加载失败，请保存项目后刷新页面。',true));
  function fill(item) {
    $('furniture-copy').disabled=Boolean(state.busy)||state.formDirty||!geometry?.canCopyFurniture(item);
    $('furniture-angle').value=item.model_3d?.rotation_deg||0;
    for(const id of ['furniture-turn-left','furniture-turn-right','furniture-fit-left','furniture-fit-right'])$(id).disabled=Boolean(state.busy)||!item.id;
    $('furniture-fit-status').textContent=`框内转向 ${item.model_3d?.fit_rotation_deg||0}° · 当前框的位置和横纵占地保持不变`;
    const cm=scaled()&&Boolean(geometry);
    $('furniture-cm-fields').hidden=!cm;$('furniture-pixel-fields').hidden=cm;
    for(const id of Object.values(fields))$(id).required=cm;
    for(const key of ['x0','y0','x1','y1'])$('furniture-'+key).required=!cm;
    if(cm){
      baseline=geometry.placementOf(state.run.document,item);
      for(const [key,id] of Object.entries(fields))$(id).value=Number((baseline[key]/10).toFixed(3));
    }
    for(const [i,key] of ['x0','y0','x1','y1'].entries())$('furniture-'+key).value=item.bbox_px[i];
    $('furniture-position-status').textContent=cm?'位置与占地以厘米输入；修改后点应用。':'尚未标定比例，暂按像素校核；标定后显示厘米。';
  }
  function input() {
    if(!geometry)throw new Error('家具工具正在加载，请稍后重试。');
    const value=$('furniture-angle').value;
    if(value.trim()==='')throw new Error('请填写旋转角度。');
    const angle=Number(value),model_3d={rotation_deg:angle};
    if(!scaled()){
      const bbox_px=['x0','y0','x1','y1'].map(key=>Number($('furniture-'+key).value));
      geometry.validateFurnitureRotation(state.run.document,bbox_px,angle);return {bbox_px,model_3d};
    }
    const placement=geometry.placementFromCm(Object.fromEntries(Object.entries(fields).map(([key,id])=>[key,$(id).value])),baseline);
    const box=geometry.placementBox(state.run.document,placement,angle);
    geometry.validateFurnitureRotation(state.run.document,box,angle);
    return {placement_mm:placement,model_3d};
  }
  function previewFields() {
    if(!state.furnitureDraft||state.busy)return;
    try{
      const values=input(),draft=state.furnitureDraft;
      draft.bbox_px=values.bbox_px||geometry.placementBox(state.run.document,values.placement_mm,values.model_3d.rotation_deg);
      draft.model_3d={...draft.model_3d,...values.model_3d};
      draft.kind=$('furniture-kind').value;draft.label=$('furniture-kind').selectedOptions[0].textContent;
      draft.rotation_deg=['bed','sofa'].includes(draft.kind)&&$('furniture-rotation').value!==''?Number($('furniture-rotation').value):null;
      paint();$('furniture-position-status').textContent='即时预览 · 点应用保存修改，× 取消';
    }catch(error){$('furniture-position-status').textContent=error.message;}
  }
  function ready(insert=false) {
    if(state.busy||!state.run)return false;
    if(state.formDirty){toast('请先应用当前修改，或点击 × 取消。');return false;}
    if(!geometry){toast('家具工具正在加载，请稍后重试。');return false;}
    if(insert&&!scaled()){toast('请先在测量面板标定已知长度，再摆放预设家具。');$('tab-measure').click();return false;}
    return true;
  }
  async function turn(delta,fit=false) {
    if(!ready()||!state.furnitureDraft?.id)return;
    const original=structuredClone(state.furnitureDraft),preview=(fit?geometry.fitTurnFurniture:geometry.turnFurniture)(state.run.document,original,delta);
    state.furnitureDraft=preview;fill(preview);paint();
    try{
      await editFurniture({action:'update',furniture_id:original.id,model_3d:{rotation_deg:preview.model_3d.rotation_deg,...(fit?{fit_rotation_deg:preview.model_3d.fit_rotation_deg}:{})}});
      focusFurniture(state.run.document.furniture.find(f=>f.id===original.id));
    }catch(error){state.furnitureDraft=original;fill(original);paint();
      if(/fetch|network/i.test(error.message))throw new Error('无法连接本地服务，旋转未保存，家具已恢复原方向。');
      throw error;
    }
  }
  $('furniture-turn-left').addEventListener('click',()=>handle(turn(-90)));
  $('furniture-turn-right').addEventListener('click',()=>handle(turn(90)));
  $('furniture-fit-left').addEventListener('click',()=>handle(turn(-90,true)));
  $('furniture-fit-right').addEventListener('click',()=>handle(turn(90,true)));
  function arm(kind,label) {
    if(!ready(true))return;
    clearSelection();state.insertionKind=kind;state.insertionLabel=label;setMode('furniture-place');
  }
  function armCopy(item) {
    if(!ready()||!geometry.canCopyFurniture(item))return false;
    const source=state.run.document.furniture.find(f=>f.id===item.id);
    if(!geometry.canCopyFurniture(source))return false;
    setMode('select');focusFurniture(source,{scroll:false});
    state.furnitureCopy={runId:state.run.run_id,item:structuredClone(source)};
    setMode('furniture-copy');
    $('furniture-position-status').textContent='复制保留尺寸、颜色和朝向 · 点击图上放置，Esc 或 × 取消';
    return true;
  }
  $('furniture-copy').addEventListener('click',()=>armCopy(state.furnitureDraft));
  function point(event) {
    const p=$('plan').createSVGPoint();p.x=event.clientX;p.y=event.clientY;
    const t=p.matrixTransform($('plan').getScreenCTM().inverse());return [t.x,t.y];
  }
  function inside(event,p) {
    const r=$('stage').getBoundingClientRect();
    return event.clientX>=r.left&&event.clientX<=r.right&&event.clientY>=r.top&&event.clientY<=r.bottom&&p[0]>=0&&p[1]>=0&&p[0]<=state.width&&p[1]<=state.height;
  }
  function start(event,options) {
    event.preventDefault();event.stopImmediatePropagation();
    gesture={...options,pointer:event.pointerId,startClient:[event.clientX,event.clientY],startPoint:point(event),moved:false,placement:null,preview:null};
    // Capture on the stable stage: preview rendering replaces furniture SVG nodes.
    $('stage').setPointerCapture(event.pointerId);
    state.busy='furniture-drag';state.formDirty=true;refresh();
    if(['place','copy'].includes(options.type))update(event);
  }
  function beginInsert(event,kind,label) {
    if(event.button!==0||!ready(true))return;
    clearSelection();setMode('select');$('furniture-toggle').checked=true;
    start(event,{type:'insert',kind,label});
  }
  function update(event) {
    const g=gesture;if(!g)return;
    const p=point(event),distance=Math.hypot(event.clientX-g.startClient[0],event.clientY-g.startClient[1]);
    if(distance>4)g.moved=true;
    if(g.type==='move') {
      if(!g.moved)return;
      const doc=state.run.document,scale=scaled()?doc.scale_mm_per_px:1,effective={...doc,scale_mm_per_px:scale};
      const original=geometry.placementOf(effective,g.item);
      const dx=p[0]-g.startPoint[0],dy=p[1]-g.startPoint[1];
      const placement=Math.abs(dx)<1e-8&&Math.abs(dy)<1e-8?original:geometry.movePlacement(effective,g.item,original.center_x_mm+dx*scale,original.center_y_mm+dy*scale);
      if(!placement)return;
      const {center_x_mm:x,center_y_mm:y,width_mm:w,depth_mm:d}=placement;
      g.placement=placement;g.preview={...g.item,bbox_px:[(x-w/2)/scale,(y-d/2)/scale,(x+w/2)/scale,(y+d/2)/scale]};
      g.preview=snap(g.preview,event);g.placement=geometry.placementOf(effective,g.preview);
      state.furnitureDraft=g.preview;fill(g.preview);
      $('furniture-position-status').textContent='拖动中 · 松手应用一次修改，Esc 取消';
    }else if(g.type==='copy'){
      g.preview=inside(event,p)?geometry.copyFurnitureAt(state.run.document,g.item,...p):null;
      if(g.preview)g.preview=snap(g.preview,event);else snapResult=null;
      g.placement=g.preview?[(g.preview.bbox_px[0]+g.preview.bbox_px[2])/2,(g.preview.bbox_px[1]+g.preview.bbox_px[3])/2]:null;
      state.furniture2dPreview=g.preview;
      $('canvas-hint').textContent=g.preview?`复制 ${g.item.id} · 松手放置 · Esc 取消`:'请在能容纳家具的底图内放置 · Esc 取消';
    }else{
      g.placement=inside(event,p)?geometry.presetPlacement(state.run.document,g.kind,...p):null;
      const placement=g.placement;
      g.preview=placement?{id:'待放置',kind:g.kind,label:g.label,rotation_deg:['bed','sofa'].includes(g.kind)?0:null,bbox_px:geometry.placementBox(state.run.document,placement),review_status:'confirmed'}:null;
      if(g.preview){g.preview=snap(g.preview,event);g.placement=geometry.placementOf(state.run.document,g.preview);}else snapResult=null;
      state.furniture2dPreview=g.preview;
      $('canvas-hint').textContent=placement?`${g.label} · ${placement.width_mm/10} × ${placement.depth_mm/10} cm · 松手放置`:'拖入底图放置 · Esc 取消';
    }
    paint();
  }
  function release() {
    const g=gesture;gesture=null;cancelAnimationFrame(frame);frame=0;
    if(g&&$('stage').hasPointerCapture(g.pointer))$('stage').releasePointerCapture(g.pointer);
    state.furniture2dPreview=null;snapResult=null;drawSnap();state.busy=false;state.formDirty=false;
    return g;
  }
  function restore(g) {
    if(g?.type==='move'){state.furnitureDraft=structuredClone(g.item);fill(g.item);}
    paint();refresh();
  }
  function cancel() {
    if(gesture)restore(release());
    if(['furniture-place','furniture-copy'].includes(state.mode))setMode('select');
    if(state.furnitureDraft)fill(state.furnitureDraft);
    state.furniture2dPreview=null;snapResult=null;paint();refresh();
  }
  async function finish(event) {
    if(!gesture||event.pointerId!==gesture.pointer)return;
    event.preventDefault();event.stopImmediatePropagation();update(event);
    const g=release();suppressClickUntil=performance.now()+350;
    if(g.type==='insert'&&!g.moved){restore(g);arm(g.kind,g.label);return;}
    if(!g.placement||(g.type==='move'&&g.preview.bbox_px.every((v,i)=>Math.abs(v-g.item.bbox_px[i])<1e-7))){restore(g);if(g.type!=='move'&&g.moved)toast('请把家具拖到可容纳预设尺寸的底图内。');return;}
    setMode('select');
    const input=g.type==='copy'?{action:'copy',furniture_id:g.item.id,center_px:g.placement}:g.type==='move'?{action:'update',furniture_id:g.item.id,...(scaled()?{placement_mm:g.placement}:{bbox_px:g.preview.bbox_px})}:{action:'add',kind:g.kind,placement_mm:g.placement,rotation_deg:g.preview.rotation_deg};
    state.busy='furniture-placement';state.formDirty=true;
    if(g.type!=='move')state.furniture2dPreview=g.preview;
    refresh();
    try{
      const result=await api('/api/edit-furniture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({run_id:state.run.run_id,...input})});
      state.furniture2dPreview=null;state.busy=false;state.formDirty=false;adoptEdits(result);
      const item=result.document.furniture.find(f=>f.id===result.changes.at(-1)?.furniture_id);
      if(item)focusFurniture(item);toast(result.changes.at(-1)?.summary||'家具已放置');
    }catch(error){
      state.furniture2dPreview=null;state.busy=false;state.formDirty=false;restore(g);
      const message=/fetch|network/i.test(error.message)?'无法连接本地服务，本次摆放未保存；已有家具已恢复原位。':error.message;
      toast(message,true);
    }
    finally{state.busy=false;refresh();window.dispatchEvent(new Event('wall-mode-change'));}
  }
  $('plan').addEventListener('pointerdown',event=>{
    if(event.button!==0)return;
    if(state.mode==='furniture-copy'&&ready()){
      const copy=state.furnitureCopy;
      if(copy?.runId===state.run.run_id){start(event,{type:'copy',item:copy.item});return;}
      cancel();return;
    }
    if(state.mode==='furniture-place'&&ready(true)){start(event,{type:'place',kind:state.insertionKind,label:state.insertionLabel});return;}
    const id=event.target.closest('[data-furniture-id]')?.dataset.furnitureId;
    const item=state.run?.document.furniture.find(f=>f.id===id&&f.review_status!=='rejected');
    if(state.mode==='select'&&item&&ready()){focusFurniture(item,{scroll:false});start(event,{type:'move',item:structuredClone(item)});}
  },true);
  document.addEventListener('pointermove',event=>{
    if(!gesture){
      if(state.mode==='furniture-copy'&&!state.busy&&state.furnitureCopy){
        const p=point(event);
        state.furniture2dPreview=inside(event,p)?geometry.copyFurnitureAt(state.run.document,state.furnitureCopy.item,...p):null;
        if(state.furniture2dPreview)state.furniture2dPreview=snap(state.furniture2dPreview,event);else snapResult=null;
        paint();
      }
      return;
    }
    if(gesture.pointer!==event.pointerId)return;
    event.preventDefault();cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>update(event));
  },{capture:true,passive:false});
  document.addEventListener('pointerup',event=>{if(gesture)handle(finish(event));},true);
  document.addEventListener('pointercancel',event=>{if(gesture?.pointer===event.pointerId)cancel();},true);
  $('stage').addEventListener('lostpointercapture',()=>{if(gesture)cancel();});
  document.addEventListener('click',event=>{
    if(performance.now()<suppressClickUntil&&event.target.closest('#stage,#material-grid')){event.preventDefault();event.stopImmediatePropagation();}
  },true);
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&(gesture||['furniture-place','furniture-copy'].includes(state.mode))){event.preventDefault();event.stopImmediatePropagation();cancel();}
  },true);
  window.addEventListener('blur',()=>{if(gesture||state.mode==='furniture-copy')cancel();});
  window.addEventListener('wall-mode-change',()=>{if(!gesture){snapResult=null;drawSnap();}});
  window.addEventListener('wall-state-change',()=>{
    $('furniture-placement-hint').textContent=scaled()?'拖入或点选放置 · 预设占地可按厘米修改':'请先识别并在测量中标定比例，再摆放预设家具。';
  });
  return {beginInsert,arm,armCopy,fill,input,previewFields};
})();
