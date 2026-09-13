// Run with NODE_PATH pointing to a Playwright installation and a local server.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(process.env.REVIEW_URL||'http://127.0.0.1:8771/');
    await page.locator('#detect:not([disabled])').waitFor();
    await page.locator('#file').setInputFiles(path.join(__dirname,'input/furniture-references/06.jpg'));
    await page.locator('#filename').filter({hasText:'06.jpg'}).waitFor();
    const detection=page.waitForResponse(r=>r.url().endsWith('/api/detect'),{timeout:180000});
    await page.locator('#detect').click();await detection;await page.waitForFunction(()=>state.run&&!state.busy);const initial=await page.evaluate(()=>structuredClone(state.run));
    assert(initial.document.furniture.some(f=>f.kind==='bed'));
    assert(initial.document.furniture.some(f=>f.kind==='sofa'));
    await page.locator('.furniture-row').first().waitFor();
    const first=initial.document.furniture[0];
    await page.locator(`#furniture-${first.id} button`).first().click();
    await page.locator('#furniture-kind').selectOption('sofa');
    await page.locator('#furniture-x0').fill(String(first.bbox_px[0]+2));
    await page.locator('#furniture-rotation').selectOption('180');
    let response=page.waitForResponse(r=>r.url().endsWith('/api/edit-furniture'));
    await page.locator('#furniture-apply').click();await response;await page.waitForFunction(()=>!state.busy);let doc=await page.evaluate(()=>structuredClone(state.run.document));
    assert.equal(doc.furniture[0].kind,'sofa');assert.equal(doc.furniture[0].bbox_px[0],first.bbox_px[0]+2);
    assert.deepEqual(doc.walls,initial.document.walls);
    response=page.waitForResponse(r=>r.url().endsWith('/api/undo-edit'));
    await page.locator('#undo').click();await response;await page.waitForFunction(()=>!state.busy);assert.deepEqual(await page.evaluate(()=>structuredClone(state.run.document)),initial.document);
    await page.locator('#furniture-toggle').uncheck();assert.equal(await page.locator('.furniture-hit').count(),0);
    await page.locator('#furniture-toggle').check();
    // Pointer drawing exercises the new manual furniture path, including form dirtiness.
    await page.locator('#furniture-tool').click();
    const plan=await page.locator('#plan').boundingBox();
    await page.mouse.move(plan.x+plan.width*.35,plan.y+plan.height*.38);
    await page.mouse.down();await page.mouse.move(plan.x+plan.width*.45,plan.y+plan.height*.49,{steps:5});await page.mouse.up();
    await page.locator('#furniture-form:not([hidden])').waitFor();
    await page.locator('#furniture-kind').selectOption('bed');
    response=page.waitForResponse(r=>r.url().endsWith('/api/edit-furniture'));
    await page.locator('#furniture-apply').click();await response;await page.waitForFunction(()=>!state.busy);doc=await page.evaluate(()=>structuredClone(state.run.document));
    const added=doc.furniture.at(-1);assert.equal(added.source,'manual');assert.equal(added.rotation_deg,null);
    response=page.waitForResponse(r=>r.url().endsWith('/api/edit-furniture'));
    await page.locator(`#furniture-${added.id} button`).last().click();
    await response;await page.waitForFunction(()=>!state.busy);assert.equal(await page.evaluate(()=>state.run.document.furniture.at(-1).review_status),'rejected');
    for(let i=0;i<2;i++){
      response=page.waitForResponse(r=>r.url().endsWith('/api/undo-edit'));
      await page.locator('#undo').click();await response;await page.waitForFunction(()=>!state.busy);doc=await page.evaluate(()=>structuredClone(state.run.document));
    }
    assert.deepEqual(doc,initial.document);
    response=page.waitForResponse(r=>r.url().endsWith('/api/save-project'));
    await page.locator('#save').click();assert.equal((await response).status(),200);await page.waitForFunction(()=>!state.busy);assert.equal(await page.locator('#save-status').textContent().then(t=>t.includes('项目已保存')),true);
    await page.locator('#overlay-toggle').uncheck();await page.locator('#openings-toggle').uncheck();
    await page.locator(`#furniture-${first.id} button`).first().click();
    await page.locator('#toast').waitFor({state:'hidden'});
    await page.screenshot({path:path.join(__dirname,'output/furniture-v1/page-desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await page.locator('.furniture-section').scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(__dirname,'output/furniture-v1/page-mobile.png'),fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({furniture_count:initial.document.furniture.length,edit_add_reject_undo_save:true,mobile_overflow:false,errors}));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
