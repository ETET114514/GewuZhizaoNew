'use strict';
(() => {
  let geometry=null;
  const options={enabled:true,showAll:false};
  function panel(prefix){
    const section=document.createElement('section');section.className='collision-panel';
    section.innerHTML=`<h3>碰撞箱与摆放校核</h3><label class="visibility"><input id="${prefix}-collision-toggle" type="checkbox" checked> 碰撞提示</label><label class="visibility"><input id="${prefix}-collision-boxes" type="checkbox"> 显示全部碰撞箱</label><p id="${prefix}-collision-status" class="opening-help" role="status"></p><div id="${prefix}-collision-list" class="collision-list"></div><p class="opening-help">红框为冲突，蓝框为选中物件。按占地、高度和当前门窗开合位置检查；允许继续摆放。</p>`;
    return section;
  }
  $('opening-quick-controls').after(panel('plan'));
  $('model-opening-quick-controls').after(panel('model'));
  function report(result,prefix){
    const status=$(`${prefix}-collision-status`),list=$(`${prefix}-collision-list`);list.replaceChildren();
    status.classList.toggle('collision-warning',options.enabled&&Boolean(result?.pairs.length));
    if(!options.enabled){status.textContent='碰撞提示已关闭';return;}
    if(!result){status.textContent=state.run?'标定比例后检查三维碰撞箱':'识别或打开项目后检查碰撞';return;}
    status.textContent=result.pairs.length?`${result.pairs.length} 处碰撞 · 可继续摆放`:'未发现碰撞';
    for(const pair of result.pairs.slice(0,20)){
      const row=document.createElement('div');row.className='collision-pair';row.textContent=pair.ids.join(' ↔ ');list.append(row);
    }
    if(result.pairs.length>20){const p=document.createElement('p');p.textContent=`另有 ${result.pairs.length-20} 处`;list.append(p);}
  }
  function render(){
    let layer=$('collision-layer');
    if(!layer){layer=svgElement('g',{id:'collision-layer','pointer-events':'none'});$('plan').append(layer);}
    layer.replaceChildren();
    const doc=state.ceilingPreview||state.openingPreview||state.run?.document;
    if(!geometry||!doc?.scale_mm_per_px){state.collisionResult=null;report(null,'plan');return;}
    const draft=state.furnitureDraft;
    const result=geometry.checkCollisions(doc,{replacement:draft?.id?draft:null,additional:state.furniture2dPreview||(draft&&!draft.id?{...draft,id:'新增'}:null)});
    state.collisionResult=result;report(result,'plan');if(!options.enabled)return;
    const selected=state.furniture2dPreview?.id||state.focusedFurniture||state.focusedOpening||state.selected?.id;
    for(const box of result.boxes){
      const conflict=result.conflictingIds.has(box.id);
      if(!conflict&&box.id!==selected&&!options.showAll)continue;
      if(box.kind==='furniture'&&!$('furniture-toggle').checked||box.kind==='wall'&&!$('overlay-toggle').checked||['door','window'].includes(box.kind)&&!$('openings-toggle').checked)continue;
      const polygon=svgElement('polygon',{points:geometry.boxFootprint(doc,box).map(p=>p.join(',')).join(' '),
        fill:conflict?'#d43838':'#2676d9','fill-opacity':conflict?.09:.025,stroke:conflict?'#d43838':'#2676d9',
        'stroke-width':(conflict?3:box.id===selected?2:1)/state.zoom,'stroke-dasharray':`${5/state.zoom} ${3/state.zoom}`,'data-collision-id':box.id,'data-conflict':String(conflict)});
      const title=svgElement('title');title.textContent=box.id;polygon.append(title);layer.append(polygon);
    }
  }
  for(const prefix of ['plan','model'])for(const [suffix,key] of [['toggle','enabled'],['boxes','showAll']]){
    $(`${prefix}-collision-${suffix}`).addEventListener('change',event=>{
      options[key]=event.target.checked;
      for(const p of ['plan','model'])$(`${p}-collision-${suffix}`).checked=options[key];
      render();window.dispatchEvent(new Event('collision-options-change'));
    });
  }
  window.collisionUI={render,options,modelReport:result=>report(result,'model')};
  window.addEventListener('wall-plan-rendered',render);
  window.addEventListener('wall-state-change',render);
  window.addEventListener('wall-mode-change',render);
  import('/collision-boxes.mjs').then(module=>{geometry=module;state.collisionGeometry=module;render();}).catch(()=>{
    $('plan-collision-status').textContent='碰撞工具加载失败，请刷新页面。';
  });
})();
