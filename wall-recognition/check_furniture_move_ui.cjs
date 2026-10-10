// Deterministic browser workflow: creates its own simple plan and manual furniture.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
(async()=>{
  const output=path.join(__dirname,'output/furniture-move-v1');fs.mkdirSync(output,{recursive:true});
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(30000);
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(process.env.REVIEW_URL||'http://127.0.0.1:8772/');
    await page.locator('#detect:not([disabled])').waitFor();
    const image=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1000;c.height=800;const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,1000,800);ctx.strokeStyle='black';ctx.lineWidth=14;ctx.strokeRect(80,80,840,640);return c.toDataURL().split(',')[1];});
    await page.locator('#file').setInputFiles({name:'move-test.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')});
    await page.locator('#detect').click();await page.waitForFunction(()=>state.run&&!state.busy);
    await page.evaluate(async()=>{
      let result=await api('/api/model-settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({run_id:state.run.run_id,calibration:{points_px:[[0,0],[500,0]],length_mm:5000}})});adoptEdits(result);
      result=await api('/api/edit-furniture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({run_id:state.run.run_id,action:'add',kind:'bed',bbox_px:[400,300,600,500]})});adoptEdits(result);
    });
    const original=await page.evaluate(()=>structuredClone(state.run.document));assert(original.walls.length>0);assert.equal(original.furniture.length,1);const id=original.furniture[0].id;
    await page.locator('#tab-display').click();await page.locator('#open-model').click();
    await page.locator('#model-canvas canvas').waitFor();
    assert(await page.locator('#model-move').isDisabled());
    await page.locator('#model-furniture-select').selectOption(id);
    await page.locator('#model-top').click();await page.locator('#model-move').click();
    const canvas=await page.locator('#model-canvas canvas').boundingBox();const center={x:canvas.x+canvas.width/2,y:canvas.y+canvas.height/2};
    let edits=0;page.on('request',r=>{if(r.url().endsWith('/api/edit-furniture'))edits++;});
    async function drag(dx,dy,cancel=false){
      await page.mouse.move(center.x,center.y);await page.mouse.down();await page.mouse.move(center.x+dx,center.y+dy,{steps:10});
      assert(await page.locator('#model-save').isDisabled());assert(await page.locator('#close-model').isDisabled());
      if(cancel)await page.keyboard.press('Escape');
      await page.mouse.up();await page.waitForFunction(()=>!state.busy&&!state.formDirty);
    }
    await drag(70,35,true);assert.equal(edits,0);assert.deepEqual(await page.evaluate(()=>state.run.document),original);
    assert.equal(await page.locator('#model-dialog').isVisible(),true);
    await drag(70,35);assert.equal(edits,1);
    const moved=await page.evaluate(()=>structuredClone(state.run.document));const box=moved.furniture[0].bbox_px;
    assert(box[0]>400&&box[1]>300);assert(Math.abs(box[2]-box[0]-200)<1e-8);assert(Math.abs(box[3]-box[1]-200)<1e-8);
    assert.deepEqual(moved.walls,original.walls);assert.deepEqual(moved.openings,original.openings);
    assert.equal(Number(await page.locator('#mf-x').inputValue()),Math.round((box[0]+box[2])/2*1000)/1000);
    const undoResponse=page.waitForResponse(r=>r.url().endsWith('/api/undo-edit'));await page.locator('#model-undo').click();await undoResponse;await page.waitForFunction(()=>!state.busy);
    assert.deepEqual(await page.evaluate(()=>state.run.document),original);
    // A click without movement must not submit an edit.
    await page.mouse.click(center.x,center.y);assert.equal(edits,1);
    // With an arbitrary rotation, moving to the image edge must keep the whole footprint inside.
    await page.locator('#mf-rotation').fill('37');
    const rotateResponse=page.waitForResponse(r=>r.url().endsWith('/api/edit-furniture'));
    await page.locator('#mf-apply').click();await rotateResponse;await page.waitForFunction(()=>!state.busy);
    await drag(canvas.width/2-4,canvas.height/2-4);
    const bounded=await page.evaluate(()=>state.run.document.furniture[0]);const theta=37*Math.PI/180;
    const extent=100*(Math.cos(theta)+Math.sin(theta)),cx=(bounded.bbox_px[0]+bounded.bbox_px[2])/2,cy=(bounded.bbox_px[1]+bounded.bbox_px[3])/2;
    assert(cx+extent<=1000+1e-7);assert(cy+extent<=800+1e-7);assert(cx-extent>=-1e-7);assert(cy-extent>=-1e-7);
    // Rounded cm display must not change untouched exact boundary coordinates.
    await page.locator('#mf-height').fill('75');
    const heightResponse=page.waitForResponse(r=>r.url().endsWith('/api/edit-furniture'));await page.locator('#mf-apply').click();assert.equal((await heightResponse).status(),200);await page.waitForFunction(()=>!state.busy);
    assert.deepEqual(await page.evaluate(()=>state.run.document.furniture[0].bbox_px),bounded.bbox_px);
    const heightUndo=page.waitForResponse(r=>r.url().endsWith('/api/undo-edit'));await page.locator('#model-undo').click();await heightUndo;await page.waitForFunction(()=>!state.busy);
    for(let i=0;i<2;i++){const response=page.waitForResponse(r=>r.url().endsWith('/api/undo-edit'));await page.locator('#model-undo').click();await response;await page.waitForFunction(()=>!state.busy);}
    assert.deepEqual(await page.evaluate(()=>state.run.document),original);
    // Reject a move at the server: visual and property rollback must be atomic.
    await page.route('**/api/edit-furniture',route=>route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'测试拒绝移动'})}));
    await drag(70,35);assert.deepEqual(await page.evaluate(()=>state.run.document),original);
    assert.equal(Number(await page.locator('#mf-x').inputValue()),500);assert.match(await page.locator('#model-message').innerText(),/测试拒绝/);
    await page.unroute('**/api/edit-furniture');
    await drag(70,35);const final=await page.evaluate(()=>structuredClone(state.run.document));
    await page.screenshot({path:path.join(output,'desktop.png')});
    const savedResponse=page.waitForResponse(r=>r.url().endsWith('/api/save-project'));await page.locator('#model-save').click();const saved=await (await savedResponse).json();await page.waitForFunction(()=>!state.busy);
    await page.locator('#close-model').click();
    await page.evaluate(async savedName=>{await openProject(savedName);},saved.saved_name);
    assert.deepEqual(await page.evaluate(()=>state.run.document.furniture),final.furniture);
    await page.locator('#open-model').click();await page.locator('#model-top').click();
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(output,'mobile.png')});
    assert.equal(await page.locator('#model-dialog').evaluate(el=>el.scrollWidth>el.clientWidth),false);
    assert.deepEqual(errors,[]);
    const report={move:true,cancel:true,oneEditPerDrag:true,noOp:true,rotatedBounds:true,undo:true,serverFailureRollback:true,saveReopen:true,mobileOverflow:false,errors,savedProject:saved.saved_name};
    fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
