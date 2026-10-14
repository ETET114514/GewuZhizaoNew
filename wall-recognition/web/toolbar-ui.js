'use strict';
(() => {
  const icons = {
    file:'M6 3h9l4 4v14H6z M14 3v5h5 M10 12h5 M10 16h5',
    save:'M4 3h14l3 3v15H3V3z M7 3v6h10V3 M7 21v-8h10v8',
    undo:'M8 5 3 10l5 5 M3 10h10a7 7 0 0 1 7 7',
    tools:'m14 6 4-4a6 6 0 0 1-7 8L4 20l-3-3 10-8a6 6 0 0 1 7-7 M14 6l3 3',
    plan:'M3 3h18v18H3z M3 12h8V3 M11 12v9 M16 12h5',
    sofa:'M5 12V6a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v6 M4 10a2 2 0 0 0-2 2v7h20v-7a2 2 0 0 0-4 0v3H6v-3a2 2 0 0 0-2-2 M5 19v2 M19 19v2',
    detail:'M3 3h18v18H3z M8 3v18 M15 3v18 M3 9h18 M3 15h18',
    layers:'m12 2 10 6-10 6L2 8z M2 12l10 6 10-6 M2 16l10 6 10-6',
    cube:'m12 2 9 5v10l-9 5-9-5V7z M3 7l9 5 9-5 M12 12v10',
    render:'M3 6h18v14H3z M7 6l2-3h6l2 3 M12 10a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
    ruler:'m2 16 14-14 6 6L8 22z M6 12l3 3 M10 8l3 3 M14 4l3 3',
    eye:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
    fit:'M8 3H3v5 M16 3h5v5 M3 16v5h5 M21 16v5h-5 M8 8h8v8H8z',
    rooms:'M3 3h18v18H3z M3 12h9v9 M12 3v5 M12 12h9',
    tiles:'m12 2 10 6-10 6L2 8z M2 8v8l10 6 10-6V8 M12 14v8 M7 5l10 6 M7 11l10-6',
    cursor:'M5 2v18l5-5 4 7 3-2-4-7h8z',
    bed:'M3 18V5 M3 13h18v8 M3 18h18 M6 13V8h6v5 M12 8h6v5 M3 21v-3',
    table:'M2 8h20v4H2z M5 12v9 M19 12v9',
    chair:'M7 11V3h10v8 M5 11h14v4H5z M7 15v7 M17 15v7',
    cabinet:'M4 3h16v18H4z M12 3v18 M9 10v4 M15 10v4',
    kitchen:'M3 8h18v13H3z M3 12h18 M10 12v9 M15 12v9 M5 5h6 M16 5h3',
    sink:'M3 10h18v8H3z M7 10V6a3 3 0 0 1 6 0v1 M7 18v3 M17 18v3',
    toilet:'M7 2h10v8H7z M5 10h14v5a7 7 0 0 1-14 0z M10 21h4',
    bath:'M2 11h20 M4 11v5a4 4 0 0 0 4 4h8a4 4 0 0 0 4-4v-5 M5 11V5a3 3 0 0 1 6 0 M6 20v2 M18 20v2',
    shower:'M4 22V6a4 4 0 0 1 8 0 M9 6h6 M10 10v2 M14 10v2 M10 16v2 M14 16v2 M4 22h16',
    fridge:'M5 2h14v20H5z M5 9h14 M8 5v2 M8 12v4',
    top:'M3 5h18v14H3z M7 9h10v6H7z',
    move:'M12 2v20 M2 12h20 M9 5l3-3 3 3 M9 19l3 3 3-3 M5 9l-3 3 3 3 M19 9l3 3-3 3'
  };
  const icon = name => `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="${icons[name] || icons.cube}"/></svg>`;
  document.querySelectorAll('[data-icon]').forEach(element=>element.insertAdjacentHTML('afterbegin',icon(element.dataset.icon)));

  // Move the existing controls; their event handlers and unsaved input stay intact.
  for (const [id,label,name] of [['tab-project','方案','file'],['tab-display','图层','layers']]) {
    const tab=$(id);tab.classList.add('rail-command');tab.textContent=label;
    tab.insertAdjacentHTML('afterbegin',icon(name));$('rail-utilities').append(tab);
  }
  $('tab-recognition').textContent='导入识别';$('tab-edit').textContent='户型校核';$('tab-measure').textContent='测量';
  const importGroup=document.createElement('div');importGroup.className='ribbon-group import-shortcuts';
  importGroup.innerHTML='<span class="ribbon-caption">导入户型</span><div class="ribbon-actions"><button class="button" data-command="upload">导入图片</button><button class="button" data-command="open-projects">打开方案</button></div>';
  $('tools-recognition').prepend(importGroup);
  $('material-actions').append($('furniture-tool'));
  $('furniture-tool').textContent='自定义框选家具';
  const entry=$('open-model');entry.className='view-button';entry.textContent='3D';entry.title='查看三维空间';$('canvas-3d-entry').append(entry);
  $('select-tool').textContent='选择墙段';$('region-tool').textContent='框选补墙';
  for(const [id,name] of [['select-tool','cursor'],['region-tool','plan'],['partition-rooms','rooms'],['room-add','detail']]) {
    $(id).insertAdjacentHTML('afterbegin',icon(name));$(id).classList.add('tool-tile');
  }
  const tabs=[...document.querySelectorAll('#workspace-toolbar [role="tab"]')];
  const planTabs=['tab-recognition','tab-edit','tab-measure'];let lastPlanTab=$('tab-recognition');
  const titles={'tab-project':['我的方案','导入与恢复'],'tab-recognition':['画户型','导入 · 校核 · 测量'],'tab-edit':['画户型','导入 · 校核 · 测量'],'tab-measure':['画户型','导入 · 校核 · 测量'],'tab-display':['图层显示','画布可见内容'],'tab-materials':['找素材','家具 · 厨房 · 卫浴'],'tab-detail':['做深化','分区 · 地面 · 三维']};
  function drawer(expanded) {
    $('workspace-toolbar').classList.toggle('drawer-collapsed',!expanded);$('tool-drawer').hidden=!expanded;
    $('drawer-toggle').setAttribute('aria-expanded',String(expanded));
    $('drawer-toggle').setAttribute('aria-label',expanded?'收起工具面板':'展开工具面板');$('drawer-toggle').textContent=expanded?'‹':'›';
  }
  function activate(tab, focus=false) {
    for(const item of tabs) {
      const selected=item===tab;item.setAttribute('aria-selected',String(selected));
      item.tabIndex=selected||!planTabs.includes(item.id)?0:-1;$(item.getAttribute('aria-controls')).hidden=!selected;
    }
    const plan=planTabs.includes(tab.id);if(plan)lastPlanTab=tab;
    $('rail-plan').setAttribute('aria-pressed',String(plan));document.querySelector('.toolbar-tabs').hidden=!plan;
    const [title,subtitle]=titles[tab.id];$('drawer-title').textContent=title;$('drawer-subtitle').textContent=subtitle;
    drawer(true);$('tool-drawer').scrollTop=0;if(focus)tab.focus();
  }
  for(const tab of tabs) {
    tab.addEventListener('click',()=>activate(tab));
    tab.addEventListener('keydown',event=>{
      const group=planTabs.includes(tab.id)?planTabs.map($):tabs.filter(item=>!planTabs.includes(item.id));
      let index=group.indexOf(tab);
      if(['ArrowRight','ArrowDown'].includes(event.key))index=(index+1)%group.length;
      else if(['ArrowLeft','ArrowUp'].includes(event.key))index=(index+group.length-1)%group.length;
      else if(event.key==='Home')index=0;else if(event.key==='End')index=group.length-1;else return;
      event.preventDefault();activate(group[index],true);
    });
  }
  $('rail-plan').addEventListener('click',()=>activate(lastPlanTab));
  $('drawer-toggle').addEventListener('click',()=>drawer($('drawer-toggle').getAttribute('aria-expanded')!=='true'));
  activate($('tab-recognition'));

  const materials=[['bed','床','bed'],['sofa','沙发','sofa'],['table','桌子','table'],['chair','椅子','chair'],['cabinet','柜子','cabinet'],['coffee_table','茶几','table'],['dining_table','餐桌','table'],['shoe_cabinet','鞋柜','cabinet'],['tv_console','电视柜','cabinet'],['kitchen_cabinet','厨房柜台','kitchen'],['kitchen_sink','水槽','sink'],['cooktop','灶台','kitchen'],['refrigerator','冰箱','fridge'],['vanity','浴室柜','sink'],['toilet','马桶','toilet'],['bathtub','浴缸','bath'],['shower','淋浴间','shower']];
  for(const [kind,label,name] of materials) {
    const button=document.createElement('button');button.className='material-tile';button.dataset.furnitureKind=kind;
    button.dataset.label=label;button.title=`拖入或点选添加${label}`;button.setAttribute('aria-pressed','false');
    button.innerHTML=`<span class="material-illustration">${icon(name)}</span><span>${label}</span>`;
    button.addEventListener('pointerdown',event=>furniture2dUI.beginInsert(event,kind,label));
    button.addEventListener('click',event=>{if(event.detail===0)furniture2dUI.arm(kind,label);});
    $('material-grid').append(button);
  }
  $('material-search').addEventListener('input',()=>{
    const query=$('material-search').value.trim();let count=0;
    for(const tile of $('material-grid').children){tile.hidden=!tile.dataset.label.includes(query);if(!tile.hidden)count++;}
    $('material-empty').hidden=count>0;
  });

  const review=document.querySelector('.review-panel'),viewCard=document.createElement('div');viewCard.className='view-card';
  viewCard.innerHTML=`<div class="view-card-tabs"><span class="active">空间预览</span><span>当前户型</span></div><button class="space-preview" data-command="open-model">${icon('cube')}<span>查看三维空间</span><small>沿用当前户型与材质</small></button>`;
  review.prepend(viewCard);
  const propertyHeading=document.createElement('div');propertyHeading.className='property-heading';propertyHeading.textContent='对象属性';viewCard.after($('opening-quick-controls'),propertyHeading);
  for(const [className,label,formId] of [['room-section','房间与地面','room-edit-form'],['furniture-section','家具与设施','furniture-form'],['openings-section','门窗与边界',null],['issues-section','修改记录',null]]) {
    const section=review.querySelector(`.${className}`),details=document.createElement('details');details.className='property-group';details.dataset.inspect=className;
    const summary=document.createElement('summary');summary.textContent=label;section.before(details);details.append(summary,section);
    if(formId)new MutationObserver(()=>{syncInspector();if(!$(formId).hidden&&state.busy!=='furniture-drag')$(formId).scrollIntoView({block:'nearest'});}).observe($(formId),{attributes:true,attributeFilter:['hidden']});
  }
  propertyHeading.after(review.querySelector('.review-heading'),$('empty-selection'),$('issue-form'),$('room-edit-form'),$('furniture-form'),$('opening-form'));
  new MutationObserver(()=>{syncInspector();if(!$('opening-form').hidden&&state.busy!=='opening-drag'&&!state.suppressOpeningInspectorScroll)$('opening-form').scrollIntoView({block:'nearest'});}).observe($('opening-form'),{attributes:true,attributeFilter:['hidden']});
  document.querySelector('.review-heading h2').textContent='墙体属性';
  function syncInspector(){
    const kind=!$('opening-form').hidden?'opening':!$('furniture-form').hidden?'furniture':!$('room-edit-form').hidden?'room':'wall';
    review.dataset.object=kind;propertyHeading.textContent=kind==='opening'?'门窗属性':kind==='furniture'?'家具属性':kind==='room'?'房间属性':'对象属性';
  }
  new MutationObserver(()=>{if(!$('room-draw-tools').hidden)review.querySelector('[data-inspect="room-section"]').open=true;}).observe($('room-draw-tools'),{attributes:true,attributeFilter:['hidden']});

  const modelHeader=document.querySelector('.model-header'),modelTools=document.createElement('div');modelTools.className='model-top-tools';
  for(const [id,name,label] of [['model-save','save','保存'],['model-undo','undo','撤销'],['model-move','move','移动家具'],['model-reset','cube','透视'],['model-top','top','俯视'],['model-person','cube','人视 170 cm']]) {
    const button=$(id);button.className='top-command';button.textContent=label;button.insertAdjacentHTML('afterbegin',icon(name));modelTools.append(button);
  }
  modelTools.append($('model-wall-ghost').closest('label'));modelHeader.insertBefore(modelTools,$('close-model'));
  document.querySelector('.model-view-actions').className='model-view-actions model-status-overlay';
  const modelBar=document.createElement('div');modelBar.className='model-bottom-bar';
  modelBar.innerHTML='<button class="view-button" data-command="close-model">2D</button><span class="view-button active">3D</span><span>点击画面后 WASD 行走 · Shift 升高 / Ctrl 降低 · 鼠标拖动转头</span>';
  document.querySelector('.model-scene').append(modelBar);

  const menus=[...document.querySelectorAll('.top-menu')];
  function closeMenus(returnFocus=false){const open=menus.find(menu=>menu.open);menus.forEach(menu=>menu.open=false);if(returnFocus)open?.querySelector('summary').focus();}
  menus.forEach(menu=>menu.addEventListener('toggle',()=>{if(menu.open)menus.filter(other=>other!==menu).forEach(other=>other.open=false);}));
  document.addEventListener('click',event=>{
    const button=event.target.closest('button[data-command],button[data-open-tab],button[data-inspect]');
    if(button&&!button.disabled){
      if(button.dataset.openTab)activate($(button.dataset.openTab));
      if(button.dataset.command){const target=$(button.dataset.command);if(!target.disabled)target.click();}
      if(button.dataset.inspect){const group=review.querySelector(`[data-inspect="${button.dataset.inspect}"]`);group.open=true;group.scrollIntoView({block:'start'});}
      closeMenus();
    }else if(!event.target.closest('.top-menu'))closeMenus();
  });
  function syncCommands(){
    syncInspector();
    for(const button of document.querySelectorAll('[data-command]')) {
      const target=$(button.dataset.command);button.disabled=target.disabled;
      if(target.hasAttribute('aria-pressed'))button.setAttribute('aria-pressed',target.getAttribute('aria-pressed'));
    }
    for(const tile of $('material-grid').children) {
      tile.disabled=$('furniture-tool').disabled;
      tile.setAttribute('aria-pressed',String(state.mode==='furniture-place'&&state.insertionKind===tile.dataset.furnitureKind));
    }
    $('project-state').textContent=state.busy?'处理中…':state.formDirty?'待应用修改':state.dirty?'有未保存修改':state.run?'方案已就绪':'等待识别';
  }
  const observer=new MutationObserver(syncCommands);
  for(const id of new Set([...document.querySelectorAll('[data-command]')].map(button=>button.dataset.command)))observer.observe($(id),{attributes:true,attributeFilter:['disabled','aria-pressed']});
  window.addEventListener('wall-state-change',()=>queueMicrotask(syncCommands));
  window.addEventListener('wall-mode-change',()=>queueMicrotask(syncCommands));
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'){closeMenus(true);return;}
    if(!(event.ctrlKey||event.metaKey)||event.altKey||event.shiftKey)return;
    const key=event.key.toLowerCase();if(!['s','z'].includes(key))return;
    if(key==='z'&&event.target.closest('input,textarea,select,[contenteditable]'))return;
    const dialogs=[...document.querySelectorAll('dialog[open]')];if(dialogs.some(dialog=>dialog.id!=='model-dialog'))return;
    event.preventDefault();const prefix=$('model-dialog').open?'model-':'';
    const target=$(prefix+(key==='s'?'save':'undo'));if(!target.disabled)target.click();
  });
  syncCommands();
})();
