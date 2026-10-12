'use strict';
(() => {
  let operations=null,selected=null,lastRun=null,lastFocused=null;
  const panels=[];
  const actions=[['door','打开门','door',true],['window','打开窗','window',true],
    ['doors','打开所有门','door',false],['windows','打开所有窗','window',false],['all','打开所有门窗','all',false]];
  for(const [id,prefix] of [['opening-quick-controls','quick'],['model-opening-quick-controls','model-quick']]){
    const root=$(id),heading=document.createElement('h3');heading.textContent='快捷打开门窗';root.append(heading);
    const label=document.createElement('label');label.className='field';label.append('选择门窗');
    const select=document.createElement('select');select.id=prefix+'-opening-select';label.append(select);root.append(label);
    const edit=document.createElement('button');edit.type='button';edit.id=prefix+'-edit-pivot';edit.className='button full';edit.textContent='调整方向与转轴';root.append(edit);
    edit.addEventListener('click',()=>{
      if(state.busy||state.formDirty)return;
      const o=state.run?.document.openings.find(o=>o.id===selected);if(!o)return;
      if($('model-dialog').open)$('close-model').click();
      if($('model-dialog').open)return;
      if(state.mode!=='select')setMode('select');focusFromQuick(o);
      requestAnimationFrame(()=>$('opening-form').scrollIntoView({block:'start'}));
    });
    const buttons=document.createElement('div');buttons.className='opening-quick-grid';root.append(buttons);
    for(const [name,text,kind,single] of actions){
      const button=document.createElement('button');button.id=prefix+'-open-'+name;button.type='button';button.className='button';
      button.textContent=text;button.dataset.targetKind=kind;button.dataset.single=String(single);
      if(name==='all')button.classList.add('full');buttons.append(button);
      button.addEventListener('click',()=>handle(open(kind,single)));
    }
    const help=document.createElement('p');help.className='opening-help';help.textContent='门 90°、窗 45°。窗宽 ≥ 180 cm 向上翻开，较窄侧开；手动转轴保留。内外不明也可打开，固定玻璃跳过。';root.append(help);
    const status=document.createElement('p');status.className='opening-help';status.setAttribute('role','status');status.textContent='点击立即应用，可撤销、保存。';root.append(status);
    panels.push({root,select,status,buttons,edit});
    select.addEventListener('change',()=>{
      if(state.busy||state.formDirty)return;
      selected=select.value||null;
      if(prefix==='quick'){
        if(state.mode!=='select')setMode('select');
        const o=state.run?.document.openings.find(o=>o.id===selected);if(o)focusFromQuick(o);else clearSelection();
      }
      sync();
    });
  }
  function sync(){
    const run=state.run?.run_id||null,doc=state.run?.document;
    if(run!==lastRun){lastRun=run;selected=null;lastFocused=null;for(const panel of panels)panel.status.textContent='点击立即应用，可撤销、保存。';}
    if(state.focusedOpening!==lastFocused){lastFocused=state.focusedOpening;if(lastFocused)selected=lastFocused;}
    const items=(doc?.openings||[]).filter(o=>['door','window'].includes(o.kind)&&o.review_status!=='rejected'&&(!o.requires_confirmation||o.review_status==='confirmed'));
    if(!items.some(o=>o.id===selected))selected=null;
    const locked=Boolean(state.busy)||state.formDirty||!operations||!doc;
    for(const panel of panels){
      panel.select.replaceChildren(new Option(items.length?'选择一扇门或窗':'没有可用门窗',''));
      for(const o of items)panel.select.append(new Option(`${o.id} · ${o.kind==='door'?'门':'窗'}${o.operation?.type==='fixed'?'（固定玻璃）':''}`,o.id));
      panel.select.value=selected||'';panel.select.disabled=locked;
      panel.edit.disabled=locked||!selected;
      for(const button of panel.buttons.children){
        const kind=button.dataset.targetKind,single=button.dataset.single==='true';
        const candidates=single?items.filter(o=>o.id===selected):items;
        const possible=candidates.some(o=>(kind==='all'||o.kind===kind)&&operations?.canQuickOpen(o));
        button.disabled=locked||!possible;
        button.title=state.formDirty?'请先应用或取消当前修改':single?'门打开 90°；窗打开 45°':'一次应用，支持一次撤销';
      }
    }
  }
  function focusFromQuick(o){
    state.suppressOpeningInspectorScroll=true;
    try{focusOpening(o,{scroll:false});}
    finally{queueMicrotask(()=>{state.suppressOpeningInspectorScroll=false;});}
  }
  async function open(kind,single){
    if(state.busy||state.formDirty||!state.run||!operations)return;
    const id=selected;
    if(single&&!operations.canQuickOpen(state.run.document.openings.find(o=>o.id===id)))return;
    if(state.mode==='furniture-copy')setMode('select');
    state.busy='opening-quick';refresh();
    try{
      const result=await api('/api/open-openings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({run_id:state.run.run_id,target_kind:kind,...(single?{opening_id:id}:{})})});
      state.busy=false;
      if(result.changed_count){
        adoptEdits(result);
        if(!$('model-dialog').open&&id){const o=result.document.openings.find(o=>o.id===id);if(o)focusFromQuick(o);}
      }
      for(const panel of panels)panel.status.textContent=result.message;
      toast(result.message);
    }catch(error){
      const message=`门窗未打开：${error.message}`;
      for(const panel of panels)panel.status.textContent=message;
      toast(message,true);
    }finally{state.busy=false;refresh();}
  }
  import('./opening-operation.mjs').then(module=>{operations=module;sync();}).catch(error=>toast(`门窗快捷按钮加载失败：${error.message}`,true));
  window.addEventListener('wall-state-change',sync);
  window.addEventListener('opening-selected',event=>{selected=event.detail;lastFocused=state.focusedOpening;sync();});
  sync();
})();
