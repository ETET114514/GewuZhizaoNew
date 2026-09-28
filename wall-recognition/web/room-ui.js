'use strict';
(() => {
  let lastDoc=null,lastId=null,drawing=null,dirty=false;
  const form=$('room-edit-form');
  const selected=()=>state.run?.document.room_partition?.regions.find(r=>r.id===state.focusedRoom);
  function materialControls(){const plain=$('room-material').value==='solid';for(const id of ['room-width','room-length','room-angle'])$(id).disabled=Boolean(state.busy)||plain;}
  function fill(){
    const room=selected();form.hidden=!room||Boolean(drawing);if(!room)return;
    $('room-edit-id').textContent=`${room.id} · 区域与地面`;
    $('room-name').value=room.name||room.id;
    const f={material:'solid',color:'#e5d7be',width_mm:600,length_mm:600,angle_deg:0,...room.floor};
    for(const [id,key] of [['room-material','material'],['room-color','color'],['room-width','width_mm'],['room-length','length_mm'],['room-angle','angle_deg']])$(id).value=f[key];
    $('room-merge-target').replaceChildren(new Option('选择另一个区域',''));
    for(const other of state.run.document.room_partition.regions)if(other.id!==room.id)$('room-merge-target').append(new Option(`${other.id} · ${other.name||'区域'}`,other.id));
    materialControls();
  }
  function sync(){
    const doc=state.run?.document;
    $('room-add').disabled=!doc||Boolean(state.busy);
    for(const el of form.querySelectorAll('input,select,button'))el.disabled=Boolean(state.busy);
    for(const el of $('room-draw-tools').querySelectorAll('button'))el.disabled=Boolean(state.busy);
    if(doc!==lastDoc||state.focusedRoom!==lastId){dirty=false;lastDoc=doc;lastId=state.focusedRoom;fill();}
    materialControls();
  }
  async function edit(input,fromForm=false){
    if(state.busy||!state.run)return;
    if(state.formDirty&&!fromForm)throw new Error('请先应用或取消当前修改。');
    const prior=state.formDirty;state.busy='room-edit';refresh();
    try{
      const result=await api('/api/edit-room',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({run_id:state.run.run_id,...input})});
      state.busy=false;state.focusedRoom=result.changes.at(-1).room_id;dirty=false;
      if(drawing)cancelDraw();
      adoptEdits(result);fill();toast(result.changes.at(-1).summary);
    }catch(error){state.formDirty=prior;throw error;}finally{state.busy=false;refresh();}
  }
  function draw(){
    const layer=$('draft-layer');layer.replaceChildren();if(!drawing)return;
    if(drawing.points.length){
      layer.append(svgElement('polyline',{points:drawing.points.map(p=>p.join(',')).join(' '),fill:'none',stroke:'#c14ca0','stroke-width':2/state.zoom,'pointer-events':'none'}));
      for(const p of drawing.points)layer.append(svgElement('circle',{cx:p[0],cy:p[1],r:4/state.zoom,fill:'#c14ca0','pointer-events':'none'}));
    }
    $('room-draw-hint').textContent=drawing.action==='split'?`在区域两侧外部各点一下，再点完成切分。已选 ${drawing.points.length}/2 点。`:`依次点击轮廓拐点，最后点“完成轮廓”闭合。已选 ${drawing.points.length} 点。`;
    $('room-draw-finish').textContent=drawing.action==='split'?'完成切分':'完成轮廓';
  }
  function start(action){
    if(!state.run||state.busy)return;
    if(state.formDirty){toast('请先应用或取消当前修改。');return;}
    const room=selected();if(action!=='add'&&!room)return;
    setMode('room-outline');drawing={action,room_id:action==='add'?undefined:room?.id,points:[]};
    form.hidden=true;$('room-draw-tools').hidden=false;$('plan').style.cursor='crosshair';state.formDirty=true;draw();
  }
  function cancelDraw(){
    if(!drawing)return;drawing=null;state.formDirty=false;$('room-draw-tools').hidden=true;
    $('draft-layer').replaceChildren();$('plan').style.cursor='';setMode('select');fill();
  }
  $('plan').addEventListener('click',e=>{
    if(!drawing||state.busy)return;e.preventDefault();e.stopImmediatePropagation();
    if(drawing.points.length >= (drawing.action==='split'?2:128)){toast('已达到本次轮廓点数上限。');return;}
    drawing.points.push(imagePoint(e));draw();
  },true);
  $('room-add').addEventListener('click',()=>start('add'));
  $('room-redraw').addEventListener('click',()=>start('reshape'));
  $('room-split').addEventListener('click',()=>start('split'));
  $('room-draw-back').addEventListener('click',()=>{drawing?.points.pop();draw();});
  $('room-draw-cancel').addEventListener('click',cancelDraw);
  $('room-draw-finish').addEventListener('click',()=>{if(drawing)handle(edit({action:drawing.action,room_id:drawing.room_id,points_px:drawing.points},true));});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&drawing)cancelDraw();});
  form.addEventListener('input',e=>{if(e.target.id==='room-merge-target')return;dirty=true;state.formDirty=true;materialControls();});
  $('room-material').addEventListener('change',()=>{
    const wood=$('room-material').value==='wood';$('room-width').value=wood?180:600;$('room-length').value=wood?1200:600;
    $('room-color').value=wood?'#b78b5e':'#ddd8cd';materialControls();
  });
  $('room-cancel-edit').addEventListener('click',()=>{if(dirty){dirty=false;state.formDirty=false;fill();}});
  form.addEventListener('submit',e=>{e.preventDefault();handle(edit({action:'settings',room_id:state.focusedRoom,name:$('room-name').value,
    floor:{material:$('room-material').value,color:$('room-color').value,width_mm:Number($('room-width').value),length_mm:Number($('room-length').value),angle_deg:Number($('room-angle').value)}},true));});
  $('room-delete').addEventListener('click',()=>handle(edit({action:'delete',room_id:state.focusedRoom})));
  $('room-merge').addEventListener('click',()=>handle(edit({action:'merge',room_id:state.focusedRoom,target_room_id:$('room-merge-target').value})));
  window.addEventListener('wall-state-change',sync);window.addEventListener('room-focus-change',sync);sync();
})();
