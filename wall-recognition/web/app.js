'use strict';
const $ = id => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const TYPES = {too_short:'墙段太短',too_long:'墙段太长',missing_corner:'缺少转角',position:'位置不对',thickness:'厚度不对',false_positive:'不应该是墙',missing_wall:'这里漏了墙',other:'其他问题'};
const DIRECTIONS = {up:'向上',down:'向下',left:'向左',right:'向右'};
const state = {file:null,blobUrl:null,token:null,run:null,selected:null,issues:[],mode:'select',width:745,height:761,zoom:1,fitted:true,busy:false,dirty:false,formDirty:false,regionCount:0,drag:null};
let toastTimer;
function toast(message, error=false) {
  clearTimeout(toastTimer); $('toast').textContent=message; $('toast').classList.toggle('error',error); $('toast').hidden=false;
  toastTimer=setTimeout(()=>{$('toast').hidden=true;},error?6500:4200);
}
function svgElement(tag, attrs={}) {const el=document.createElementNS(NS,tag); for(const [k,v] of Object.entries(attrs))el.setAttribute(k,String(v)); return el;}
function snapshot() {return {run_id:state.run?.run_id||null,wall_count:state.run?.document.walls.length||0,walls:state.run?.document.walls||[],issues:structuredClone(state.issues),selected_id:state.selected?.id||null,unsaved:state.dirty||state.formDirty};}
function refresh() {
  const ready=Boolean(state.run), count=state.run?.document.walls.length||0;
  $('detect').disabled=!state.file||state.busy; $('detect').textContent=ready?'重新识别':'运行墙体识别';
  $('upload').disabled=state.busy; $('sample').disabled=state.busy; $('file').disabled=state.busy;
  $('save').disabled=state.busy||!ready; $('undo').disabled=state.busy||!state.historySize;
  $('region-tool').disabled=!ready||state.busy; $('select-tool').disabled=state.busy; $('add-issue').disabled=state.busy;
  $('wall-count').textContent=ready?`${count} 段候选`:'等待识别'; $('issue-count').textContent=state.issues.length;
  $('step1').className='step '+(ready?'done':'active'); $('step2').className='step '+(ready?'done':state.file?'active':''); $('step3').className='step '+(ready?'active':'');
  $('empty-title').textContent=ready?'选择需要修改的墙段':'从识别开始';
  $('empty-copy').textContent=ready?(count?'点击墙段，指定修改方向、连接目标或数值，页面会直接修改。':'没有提取到候选墙段。可以使用「框选漏墙」记录遗漏区域。'):'点击「运行墙体识别」，然后选择图中需要修改的墙段。';
  $('canvas-hint').textContent=state.mode==='region'?'在图上拖出矩形，圈出漏掉的墙；Esc 取消':ready?'点击墙段直接修改 · 漏掉的墙可框选后补入':'先运行识别，再点击图中有问题的墙段';
  $('loading').hidden=state.busy!=='detect';
}
function setMode(mode) {
  if(state.busy||(mode==='region'&&!state.run))return;
  if(state.formDirty) {toast('请先应用当前修改，或点击 × 取消。');return;}
  state.mode=mode; state.drag=null; $('draft-layer').replaceChildren();
  $('stage').classList.toggle('region-mode',mode==='region'); $('plan').style.touchAction=mode==='region'?'none':'pan-x pan-y';
  for(const [id,name] of [['select-tool','select'],['region-tool','region']]) {$(id).classList.toggle('active',mode===name);$(id).setAttribute('aria-pressed',String(mode===name));}
  if(mode==='region'){$('overlay-toggle').checked=true; renderPlan();}
  refresh();
}
function fit() {
  state.fitted=true; const stage=$('stage'); state.zoom=Math.min((stage.clientWidth-48)/state.width,(stage.clientHeight-48)/state.height,1.25); state.zoom=Math.max(.15,state.zoom); applyZoom();
}
function applyZoom() {$('paper').style.width=`${state.width*state.zoom}px`;$('zoom-label').textContent=`${Math.round(state.zoom*100)}%`;if(state.run)renderPlan();}
function zoom(factor) {state.fitted=false;state.zoom=Math.max(.15,Math.min(4,state.zoom*factor));applyZoom();}
function clearSelection() {state.selected=null;state.formDirty=false;$('issue-form').hidden=true;$('empty-selection').hidden=false;renderPlan();refresh();}
function selectItem(item) {
  if(state.busy)return false;
  if(state.formDirty&&state.selected?.id===item.id)return true;
  if(state.formDirty&&state.selected?.id!==item.id){toast('请先应用当前修改，或点击 × 取消。');return false;}
  const existing=null;
  state.selected=item; state.formDirty=false; $('empty-selection').hidden=true;$('issue-form').hidden=false;
  $('selected-id').textContent=item.id;
  $('selected-kind').textContent=item.kind==='region'?'漏识别区域':item.orientation==='horizontal'?'水平墙段':'垂直墙段';
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
  $('image-meta').textContent=`${state.width} × ${state.height} px · 当前 ${result.document.walls.length} 段墙体`;
  clearSelection();const current=result.document.walls.find(w=>w.id===selectedId);if(current)selectItem(current);
  $('save-status').textContent='墙体已更新，保存项目可保留当前结果';renderIssues();renderPlan();refresh();
}
async function undoEdit() {
  if(state.busy||!state.historySize)return;
  state.busy='undo';refresh();try{const result=await api('/api/undo-edit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({run_id:state.run.run_id})});state.busy=false;adoptEdits(result);toast('已撤销上一步，墙体已恢复');}finally{state.busy=false;refresh();}
}
function renderIssues() {
  const list=$('issue-list');list.replaceChildren();
  if(!state.issues.length){const p=document.createElement('p');p.className='list-empty';p.textContent='执行后的修改会出现在这里';list.append(p);return;}
  for(const issue of state.issues) {
    const card=document.createElement('div');card.className='issue-card';
    const open=document.createElement('button');open.className='issue-open';open.type='button';
    const id=document.createElement('strong');id.textContent=issue.id;const type=document.createElement('span');type.textContent=TYPES[issue.type];
    const note=document.createElement('p');note.textContent=issue.summary||issue.note;open.append(id,type,note);
    open.addEventListener('click',()=>{const wall=state.run.document.walls.find(w=>w.id===issue.wall_id);if(wall)selectItem(wall);else toast('这段墙已删除，可以撤销上一步恢复最近的修改。');});
    const remove=document.createElement('button');remove.className='issue-remove';remove.textContent='×';remove.setAttribute('aria-label',`移除 ${issue.id} 的问题`);
    remove.addEventListener('click',()=>{if(state.busy)return;state.issues=state.issues.filter(i=>i.id!==issue.id);state.dirty=true;if(state.selected?.id===issue.id)clearSelection();$('save-status').textContent='问题清单已修改，需重新保存';renderIssues();renderPlan();refresh();});
    card.append(open);list.append(card);
  }
}
function renderPlan() {
  const layer=$('wall-layer');layer.replaceChildren();const regions=$('region-layer');regions.replaceChildren();
  if(!state.run)return;
  const visible=$('overlay-toggle').checked;
  if(visible) {
    const problemIds=new Set(state.issues.map(i=>i.wall_id));const labels=[],floatingLabels=[];
    const lw=42/state.zoom,lh=19/state.zoom,fs=12/state.zoom;
    for(const wall of state.run.document.walls) {
      const group=svgElement('g',{'class':`wall-hit${problemIds.has(wall.id)?' problem':''}${state.selected?.id===wall.id?' selected':''}`,tabindex:'0',role:'button','aria-label':`${wall.id}，${wall.orientation==='horizontal'?'水平':'垂直'}墙段，长度 ${wall.length_px} 像素`});
      const [x0,y0,x1,y1]=wall.bbox_px;
      group.append(svgElement('rect',{x:x0,y:y0,width:x1-x0,height:y1-y0,class:'wall-shape'}));
      group.append(svgElement('line',{x1:wall.start_px[0],y1:wall.start_px[1],x2:wall.end_px[0],y2:wall.end_px[1],class:'wall-center'}));
      group.append(svgElement('line',{x1:wall.start_px[0],y1:wall.start_px[1],x2:wall.end_px[0],y2:wall.end_px[1],stroke:'transparent','stroke-width':Math.max(13,wall.thickness_px)}));
      let lx=Math.max(0,Math.min(state.width-lw,(x0+x1)/2-lw/2)),ly=Math.max(0,(y0+y1)/2-lh/2);
      for(let tries=0;tries<14&&labels.some(b=>lx<b[0]+lw&&lx+lw>b[0]&&ly<b[1]+lh&&ly+lh>b[1]);tries++)ly=Math.min(state.height-lh,ly+lh+2/state.zoom);
      const labelGroup=svgElement('g',{class:group.getAttribute('class'),'aria-hidden':'true'});
      labels.push([lx,ly]);labelGroup.append(svgElement('line',{x1:(x0+x1)/2,y1:(y0+y1)/2,x2:lx+lw/2,y2:ly+lh/2,stroke:problemIds.has(wall.id)?'#c4611b':'#286be5','stroke-width':.8/state.zoom,'pointer-events':'none'}));labelGroup.append(svgElement('rect',{x:lx,y:ly,width:lw,height:lh,rx:3/state.zoom,class:'wall-label'}));const text=svgElement('text',{x:lx+lw/2,y:ly+13.2/state.zoom,'text-anchor':'middle',class:'wall-text',style:`font-size:${fs}px`});text.textContent=wall.id;labelGroup.append(text);floatingLabels.push(labelGroup);
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
}
function imagePoint(event) {const p=$('plan').createSVGPoint();p.x=event.clientX;p.y=event.clientY;const t=p.matrixTransform($('plan').getScreenCTM().inverse());return [Math.max(0,Math.min(state.width,t.x)),Math.max(0,Math.min(state.height,t.y))];}
function dragBox(a,b){return [Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1])].map(v=>Math.round(v*10)/10);}
$('plan').addEventListener('pointerdown',e=>{if(state.mode!=='region'||state.busy||e.button!==0)return;if(state.formDirty){toast('请先应用当前修改，或点击 × 取消。');return;}e.preventDefault();state.drag={start:imagePoint(e),pointer:e.pointerId};$('plan').setPointerCapture(e.pointerId);});
$('plan').addEventListener('pointermove',e=>{if(!state.drag||e.pointerId!==state.drag.pointer)return;const b=dragBox(state.drag.start,imagePoint(e));$('draft-layer').replaceChildren(svgElement('rect',{x:b[0],y:b[1],width:b[2]-b[0],height:b[3]-b[1],class:'region-box','pointer-events':'none'}));});
$('plan').addEventListener('pointerup',e=>{if(!state.drag||e.pointerId!==state.drag.pointer)return;const b=dragBox(state.drag.start,imagePoint(e));state.drag=null;$('draft-layer').replaceChildren();$('plan').releasePointerCapture(e.pointerId);if(b[2]-b[0]<6||b[3]-b[1]<6){toast('请拖出一个稍大的矩形，圈住漏掉的墙。');return;}setMode('select');selectItem({id:`M${String(++state.regionCount).padStart(3,'0')}`,kind:'region',region_px:b});state.formDirty=true;refresh();});
$('plan').addEventListener('pointercancel',()=>{state.drag=null;$('draft-layer').replaceChildren();});
$('plan').addEventListener('click',e=>{if(e.target.id==='plan-image'&&state.mode==='select'&&!state.formDirty)clearSelection();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){state.drag=null;$('draft-layer').replaceChildren();if(state.mode==='region')setMode('select');}});
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
  state.run=null;state.issues=[];state.selected=null;state.formDirty=false;state.dirty=false;state.regionCount=0;state.historySize=0;
  $('filename').textContent=file.name;$('image-meta').textContent=`${image.width} × ${image.height} px · 等待识别`;
  $('plan').setAttribute('viewBox',`0 0 ${image.width} ${image.height}`);$('plan-image').setAttribute('width',image.width);$('plan-image').setAttribute('height',image.height);$('plan-image').setAttribute('href',url);
  $('save-status').textContent='修改由页面程序直接执行，可撤销';setMode('select');clearSelection();renderIssues();refresh();requestAnimationFrame(fit);return true;
}
async function loadSample(guard=true) {const response=await fetch('/api/sample-image');if(!response.ok)throw new Error('示例图片加载失败。');return loadFile(new File([await response.blob()],'示例户型.png',{type:'image/png'}),guard);}
async function detect() {
  if(state.busy)throw new Error('请等待当前操作完成。');if(!state.file)throw new Error('请先导入图片。');
  if(!(await allowReplacement()))return {cancelled:true};
  state.busy='detect';refresh();
  try {
    const result=await api('/api/detect',{method:'POST',headers:{'Content-Type':state.file.type,'X-Image-Name':encodeURIComponent(state.file.name)},body:state.file});
    state.run=result;state.width=result.document.image.width_px;state.height=result.document.image.height_px;state.issues=[];state.selected=null;state.formDirty=false;state.dirty=false;state.regionCount=0;state.historySize=0;
    $('plan-image').setAttribute('href',result.image_url);$('plan-image').setAttribute('width',state.width);$('plan-image').setAttribute('height',state.height);$('plan').setAttribute('viewBox',`0 0 ${state.width} ${state.height}`);
    $('image-meta').textContent=`${state.width} × ${state.height} px · 本次自动识别 ${result.document.walls.length} 段候选`;
    $('target').replaceChildren(new Option('不指定墙段',''));for(const wall of result.document.walls)$('target').append(new Option(wall.id,wall.id));
    $('overlay-toggle').checked=true;$('save-status').textContent='选择墙段并应用修改，完成后保存项目';clearSelection();renderIssues();fit();
    toast(result.document.walls.length?`识别完成：${result.document.walls.length} 段候选，点击墙段开始校核`:'没有提取到墙段，可用「框选漏墙」标记');
    return {run_id:result.run_id,wall_count:result.document.walls.length};
  } finally {state.busy=false;setMode('select');refresh();}
}
async function saveProject() {
  if(state.busy)throw new Error('请等待当前操作完成。');if(state.formDirty)throw new Error('请先应用当前表单里的修改，或点击 × 取消，再保存项目。');
  if(!state.run)throw new Error('请先运行识别。');
  const signature=JSON.stringify(state.issues), runId=state.run.run_id;state.busy='save';refresh();
  try {const result=await api('/api/save-project',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({run_id:runId})});
    if(state.run?.run_id===runId&&JSON.stringify(state.issues)===signature)state.dirty=false;
    $('save-status').textContent=`项目已保存 · ${result.saved_name}`;toast(`已保存 ${result.count} 段墙体及修改记录。`);return result;
  } finally {state.busy=false;refresh();}
}
function handle(promise) {Promise.resolve(promise).catch(error=>toast(error.message||'操作失败，请重试。',true));}
$('upload').addEventListener('click',()=>{$('file').value='';$('file').click();});
$('file').addEventListener('change',()=>{if($('file').files[0])handle(loadFile($('file').files[0]));});
$('sample').addEventListener('click',()=>handle(loadSample()));$('detect').addEventListener('click',()=>handle(detect()));$('save').addEventListener('click',()=>handle(saveProject()));$('undo').addEventListener('click',()=>handle(undoEdit()));
$('select-tool').addEventListener('click',()=>setMode('select'));$('region-tool').addEventListener('click',()=>setMode('region'));$('overlay-toggle').addEventListener('change',renderPlan);
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
handle(loadSample(false));handle(registerTools());refresh();
