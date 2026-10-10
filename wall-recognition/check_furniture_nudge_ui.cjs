const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
(async()=>{
  const output=path.join(__dirname,'output/furniture-nudge-v1');fs.mkdirSync(output,{recursive:true});
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(30000);
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(process.env.REVIEW_URL||'http://127.0.0.1:8772/');await page.locator('#detect:not([disabled])').waitFor();
    const image=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1000;c.height=800;const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,1000,800);return c.toDataURL().split(',')[1];});
    await page.locator('#file').setInputFiles({name:'nudge-test.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')});
    await page.locator('#detect').click();await page.waitForFunction(()=>state.run&&!state.busy);
    await page.evaluate(async()=>{
      let r=await api('/api/model-settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({run_id:state.run.run_id,calibration:{points_px:[[0,0],[500,0]],length_mm:5000}})});adoptEdits(r);
      r=await api('/api/edit-furniture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({run_id:state.run.run_id,action:'add',kind:'bed',bbox_px:[400,300,600,500]})});adoptEdits(r);
    });
    const original=await page.evaluate(()=>structuredClone(state.run.document)),id=original.furniture[0].id;
    await page.locator('#tab-display').click();await page.locator('#open-model').click();await page.locator('#model-canvas canvas').waitFor();
    assert(await page.locator('[data-nudge=right]').isDisabled());
    await page.locator('#model-furniture-select').selectOption(id);await page.locator('#model-top').click();
    assert.equal(await page.locator('#mf-x').inputValue(),'500');assert.equal(await page.locator('#mf-width').inputValue(),'200');assert.equal(await page.locator('#mf-height').inputValue(),'100');
    let edits=0;page.on('request',r=>{if(r.url().endsWith('/api/edit-furniture'))edits++;});
    async function press(direction){const b=page.locator(`[data-nudge=${direction}]`);await b.scrollIntoViewIfNeeded();const box=await b.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();}
    async function release(){await page.mouse.up();await page.waitForFunction(()=>!state.busy&&!state.formDirty);}
    async function undo(){const r=page.waitForResponse(r=>r.url().endsWith('/api/undo-edit'));await page.locator('#model-undo').click();await r;await page.waitForFunction(()=>!state.busy);}
    const canvas=await page.locator('#model-canvas canvas').boundingBox();const clip={x:canvas.x+canvas.width/2-100,y:canvas.y+canvas.height/2-100,width:200,height:200};
    const before=await page.screenshot({clip});
    await press('right');
    assert.equal(await page.locator('#mf-x').inputValue(),'510');assert.equal(edits,0);assert.deepEqual(await page.evaluate(()=>state.run.document),original);
    const during=await page.screenshot({clip});assert(!before.equals(during),'furniture moves visually before release');
    await release();assert.equal(edits,1);assert.deepEqual(await page.evaluate(()=>state.run.document.furniture[0].bbox_px),[410,300,610,500]);
    await undo();assert.deepEqual(await page.evaluate(()=>state.run.document),original);
    // Continuous movement previews repeatedly but submits one edit per hold.
    const count=edits;await press('down');await page.waitForTimeout(650);
    assert(Number(await page.locator('#mf-y').inputValue())>=430);assert.equal(edits,count);
    await release();assert.equal(edits,count+1);await undo();
    await press('left');await page.keyboard.press('Escape');await release();assert.deepEqual(await page.evaluate(()=>state.run.document),original);
    const afterCancel=edits;await page.waitForTimeout(400);assert.equal(edits,afterCancel);
    // Keyboard activation, custom step, and invalid-step guard.
    await page.locator('#mf-step').fill('1.5');await page.locator('[data-nudge=right]').press('Enter');await page.waitForFunction(()=>!state.busy&&!state.formDirty);
    assert.equal(Number(await page.locator('#mf-x').inputValue()),501.5);await undo();
    await page.locator('#mf-step').fill('0');await page.locator('[data-nudge=right]').click();assert.equal(edits,afterCancel+1);assert.match(await page.locator('#model-message').innerText(),/步长/);await page.locator('#mf-step').fill('10');
    // Length fields are cm; appearance and placement persist in the existing mm schema.
    await page.locator('#mf-height').fill('123.4');await page.locator('#mf-elevation').fill('12');await page.locator('#mf-width').fill('210.25');
    assert(await page.locator('[data-nudge=right]').isDisabled());
    let r=page.waitForResponse(r=>r.url().endsWith('/api/edit-furniture'));await page.locator('#mf-apply').click();await r;await page.waitForFunction(()=>!state.busy);
    const changed=await page.evaluate(()=>structuredClone(state.run.document));assert.equal(changed.furniture[0].model_3d.height_mm,1234);assert.equal(changed.furniture[0].model_3d.elevation_mm,120);
    assert(Math.abs((changed.furniture[0].bbox_px[2]-changed.furniture[0].bbox_px[0])*10-2102.5)<1e-7);
    await press('right');await release();const final=await page.evaluate(()=>structuredClone(state.run.document));
    assert.deepEqual(final.furniture[0].model_3d,changed.furniture[0].model_3d);assert.deepEqual(final.walls,original.walls);
    await page.screenshot({path:path.join(output,'desktop.png')});
    r=page.waitForResponse(r=>r.url().endsWith('/api/save-project'));await page.locator('#model-save').click();const saved=await(await r).json();await page.waitForFunction(()=>!state.busy);
    await page.locator('#close-model').click();await page.evaluate(async name=>{await openProject(name);},saved.saved_name);
    assert.deepEqual(await page.evaluate(()=>state.run.document.furniture),final.furniture);
    await page.locator('#open-model').click();assert.equal(await page.locator('#mf-height').inputValue(),'123.4');
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(output,'mobile.png')});assert.equal(await page.locator('#model-dialog').evaluate(el=>el.scrollWidth>el.clientWidth),false);
    assert.deepEqual(errors,[]);
    const results={instantVisualPreview:true,singleStep:true,holdRepeat:true,oneEditPerHold:true,cancel:true,keyboard:true,customStep:true,invalidStep:true,cmConversion:true,preciseLengths:true,undo:true,appearancePreserved:true,saveReopen:true,mobileOverflow:false,errors};
    fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
