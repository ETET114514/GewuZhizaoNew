'use strict';
(() => {
  let report=null, preview=null, chosen=null, lastDoc=null, active=false, queued=false;
  const names={collinear:'直线缺口',corner:'转角缺口',junction:'交接缺口'};
  TYPES.gap_review='缺口校核';
  const selected=()=>report?.candidates.find(c=>c.id===chosen);
  const post=(path,body={})=>api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({run_id:state.run.run_id,...body})});
  function allowed(){if(state.busy||!state.run)return false;if(state.formDirty){toast('请先应用或取消当前修改。');return false;}return true;}
  function locate(box){
    const stage=$('stage');state.fitted=false;
    state.zoom=Math.min(4,Math.max(1,Math.min((stage.clientWidth-80)/Math.max(100,box[2]-box[0]),(stage.clientHeight-80)/Math.max(100,box[3]-box[1]))));
    applyZoom();
    const paper=$('paper').getBoundingClientRect(), bounds=stage.getBoundingClientRect();
    stage.scrollTo({left:stage.scrollLeft+paper.left-bounds.left+(box[0]+box[2])/2*state.zoom-stage.clientWidth/2,
      top:stage.scrollTop+paper.top-bounds.top+(box[1]+box[3])/2*state.zoom-stage.clientHeight/2,behavior:'smooth'});
  }
  function draw(){
    let layer=$('closure-layer');if(!layer){layer=svgElement('g',{id:'closure-layer'});$('plan').append(layer);}
    layer.replaceChildren();if(!$('closure-visible').checked||!report)return;
    if(preview)for(const room of preview.regions){
      const d=room.rings_px.map(r=>`M${r.map(p=>p.join(',')).join('L')}Z`).join('');
      layer.append(svgElement('path',{d,fill:'#168d79','fill-opacity':.09,stroke:'#168d79','stroke-width':1/state.zoom,'stroke-dasharray':`${5/state.zoom} ${4/state.zoom}`,'fill-rule':'evenodd','pointer-events':'none'}));
    }
    for(const end of report.free_ends)layer.append(svgElement('circle',{cx:end.point_px[0],cy:end.point_px[1],r:3/state.zoom,fill:'white',stroke:'#7c8492','stroke-width':1/state.zoom,'pointer-events':'none'}));
    report.candidates.forEach((c,i)=>{
      if(c.ignored)return;
      const current=c.id===chosen;
      if(current)for(const p of c.pieces){const b=p.bbox_px;layer.append(svgElement('rect',{x:b[0],y:b[1],width:b[2]-b[0],height:b[3]-b[1],fill:'#e38a24','fill-opacity':.65,stroke:'#a75408','stroke-width':1.5/state.zoom,'stroke-dasharray':`${4/state.zoom} ${2/state.zoom}`,'pointer-events':'none'}));}
      const x=(c.bbox_px[0]+c.bbox_px[2])/2,y=(c.bbox_px[1]+c.bbox_px[3])/2;
      const g=svgElement('g',{role:'button',tabindex:0,'aria-label':`缺口 ${i+1}，定位并预览`,'data-gap-id':c.id});
      g.append(svgElement('circle',{cx:x,cy:y,r:11/state.zoom,fill:current?'#a75408':'#fff4de',stroke:'#a75408','stroke-width':1.5/state.zoom}));
      const label=svgElement('text',{x,y,dy:4/state.zoom,'text-anchor':'middle',fill:current?'white':'#87460c',style:`font-size:${11/state.zoom}px;font-weight:700`});label.textContent=String(i+1);g.append(label);
      g.addEventListener('click',e=>{e.stopPropagation();handle(choose(c));});
      g.addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();e.stopPropagation();handle(choose(c));}});layer.append(g);
    });
  }
  function render(){
    const busy=Boolean(state.busy), c=selected();
    $('diagnose-closure').disabled=busy||!state.run;
    $('closure-panel').hidden=!active;
    $('closure-preview').hidden=!c;
    $('gap-confirm').disabled=busy||!preview||Boolean(c?.ignored);
    $('gap-ignore').disabled=busy||!c;
    $('gap-ignore').textContent=c?.ignored?'恢复此疑点':'忽略此疑点';
    $('gap-dismiss').disabled=busy;
    $('closure-list').replaceChildren();$('closure-boundaries').replaceChildren();
    if(report){
      const count=report.candidates.filter(c=>!c.ignored).length;
      $('closure-status').textContent=`自动闭合区域 ${report.automatic_region_count} 个 · ${count} 处缺口疑点 · ${report.free_ends.length} 个自由端点。${report.truncated?'结果已达扫描上限，请分批整理后重查。':''}${!count?'未找到可建议补接的缺口，不代表墙体已全部闭合。':''}`;
      report.candidates.forEach((item,i)=>{
        const b=document.createElement('button');b.className='button room-choice';b.disabled=busy;
        b.setAttribute('aria-pressed',String(chosen===item.id));
        const scale=state.run.document.scale_mm_per_px;
        const length=scale?`${(item.length_px*scale/1000).toFixed(2)} m`:`${item.length_px.toFixed(1)} px`;
        b.textContent=`${i+1} · ${names[item.kind]} · ${length}${item.ignored?' · 已忽略':''}`;
        b.addEventListener('click',()=>handle(choose(item)));$('closure-list').append(b);
      });
      for(const [ids,reason] of [[report.skipped_opening_ids,'门窗两端未接齐'],[report.pending_opening_ids,'边界类型待确认']])for(const id of ids){
        const b=document.createElement('button');b.className='button room-choice';b.disabled=busy;b.textContent=`${id} · ${reason}`;
        b.addEventListener('click',()=>{if(!allowed())return;const o=state.run.document.openings.find(o=>o.id===id);if(o){setMode('select');focusOpening(o);locate(o.bbox_px);}});$('closure-boundaries').append(b);
      }
    }
    if(c){
      $('gap-title').textContent=`${names[c.kind]} · ${c.wall_ids.join(' / ')}`;
      $('gap-impact').textContent=preview?`预计自动闭合区域：${preview.before_count} → ${preview.after_count} 个。${preview.after_count===preview.before_count?'单独补这一处未改变数量，可能仍有其他缺口，也可能是正常开口。':''}`:c.ignored?'此疑点已忽略，恢复后可重新预览。':'正在计算补墙后的分区…';
    }
    draw();
  }
  async function diagnose(){
    if(!allowed())return;active=true;state.busy='closure';report=null;preview=null;chosen=null;
    $('closure-status').textContent='正在检查墙端、门窗边界和闭合区域…';refresh();
    const doc=state.run.document;lastDoc=doc;
    try{const result=await post('/api/diagnose-closure');if(state.run?.document===doc)report=result;}
    catch(error){$('closure-status').textContent='诊断未完成，请点击“闭合诊断”重试。';throw error;}
    finally{state.busy=false;refresh();}
  }
  async function choose(c){
    if(!allowed())return;setMode('select');chosen=c.id;preview=null;$('closure-visible').checked=true;locate(c.bbox_px);
    if(c.ignored){render();return;}
    state.busy='gap-preview';refresh();
    try{preview=await post('/api/preview-gap',{revision:report.revision,candidate_id:c.id});}
    catch(error){chosen=null;throw error;}
    finally{state.busy=false;refresh();}
  }
  async function resolve(action){
    if(!allowed()||!selected()||(action==='confirm'&&!preview))return;
    const input={revision:report.revision,candidate_id:chosen,action};state.busy='gap-edit';refresh();
    try{const result=await post('/api/resolve-gap',input);state.busy=false;adoptEdits(result);toast(result.changes.at(-1).summary);}
    finally{state.busy=false;refresh();}
  }
  function sync(){
    const doc=state.run?.document;
    if(doc!==lastDoc){report=null;preview=null;chosen=null;$('closure-status').textContent='项目已变化，正在重新诊断…';
      if(active&&doc&&!state.busy&&!state.formDirty&&!queued){queued=true;queueMicrotask(()=>{queued=false;if(active&&state.run?.document!==lastDoc)handle(diagnose());});}
    }
    render();
  }
  $('diagnose-closure').addEventListener('click',()=>{if(!allowed())return;handle(diagnose());$('closure-panel').scrollIntoView({block:'nearest'});});
  $('gap-confirm').addEventListener('click',()=>handle(resolve('confirm')));
  $('gap-ignore').addEventListener('click',()=>handle(resolve(selected()?.ignored?'restore':'ignore')));
  $('gap-dismiss').addEventListener('click',()=>{chosen=null;preview=null;render();});
  $('closure-visible').addEventListener('change',draw);
  window.addEventListener('wall-state-change',sync);window.addEventListener('wall-plan-rendered',draw);
  window.addEventListener('project-replacing',()=>{active=false;report=null;preview=null;chosen=null;lastDoc=null;render();});
  sync();
})();
