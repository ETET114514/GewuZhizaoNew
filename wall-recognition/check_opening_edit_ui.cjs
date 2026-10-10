const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
(async()=>{
  const output=path.join(__dirname,'output/opening-edit-v1');fs.mkdirSync(output,{recursive:true});
  const calibrationDoc=JSON.parse(fs.readFileSync('projects/20261010-170459-db1b6c/walls.json','utf8'));
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(30000);
    await page.goto(process.env.REVIEW_URL||'http://127.0.0.1:8776/');
    await page.waitForFunction(()=>window.openingEditor&&state.file);
    await page.evaluate(()=>openProject('20261010-182626-464b5f'));
    await page.evaluate(()=>focusOpening(state.run.document.openings.find(o=>o.id==='O014')));
    assert(await page.locator('#opening-width').isDisabled());
    assert((await page.locator('#opening-edit-status').textContent()).includes('标定'));
    const originalHash=await page.evaluate(()=>state.run.document.image.sha256);assert.equal(originalHash,calibrationDoc.image.sha256);
    await page.evaluate(async calibration=>{
      const result=await api('/api/model-settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({run_id:state.run.run_id,calibration})});adoptEdits(result);
    },{points_px:calibrationDoc.calibration.points_px,length_mm:calibrationDoc.calibration.length_mm});
    // Save a calibrated baseline using an already saved calibration of this exact
    // image. Browser QA edits run in a separate session and never touch old tabs.
    const baseline=await page.evaluate(()=>saveProject());
    const original=await page.evaluate(()=>structuredClone(state.run.document));
    // Every full-span exterior window can use the height preset without the
    // rounded cm display accidentally widening it beyond its own host wall.
    const windowIds=original.openings.filter(o=>o.kind==='window').map(o=>o.id);
    for(const id of windowIds){
      await page.evaluate(id=>focusOpening(state.run.document.openings.find(o=>o.id===id)),id);
      await page.locator('#opening-floor-glass').click();assert(!(await page.locator('#opening-apply').isDisabled()));
      const o=original.openings.find(o=>o.id===id),axis=o.orientation==='horizontal'?0:1;
      assert.deepEqual(await page.evaluate(({id,axis})=>{const o=state.openingPreview.openings.find(o=>o.id===id);return [o.start_px[axis],o.end_px[axis]];},{id,axis}),[o.start_px[axis],o.end_px[axis]]);
      await page.locator('#opening-discard').click();
    }
    await page.evaluate(()=>focusOpening(state.run.document.openings.find(o=>o.id==='O014')));
    assert(!(await page.locator('#opening-width').isDisabled()));
    let edits=0;page.on('request',r=>{if(r.url().endsWith('/api/edit-opening'))edits++;});
    await page.locator('#opening-width').fill('220');await page.locator('#opening-height').fill('140');await page.locator('#opening-sill').fill('80');
    assert.deepEqual(await page.evaluate(()=>state.run.document),original);assert.equal(edits,0);
    assert.equal(await page.evaluate(()=>state.openingPreview.openings.find(o=>o.id==='O014').dimensions_mm.width_mm),2200);
    await page.locator('#opening-apply').click();await page.waitForFunction(()=>!state.busy&&!state.formDirty);
    assert.equal(edits,1);
    const resized=await page.evaluate(()=>structuredClone(state.run.document));
    async function position(id){await page.locator('#plan').scrollIntoViewIfNeeded();return page.evaluate(id=>{
      const o=state.run.document.openings.find(o=>o.id===id),p=document.querySelector('#plan').createSVGPoint();
      p.x=(o.start_px[0]+o.end_px[0])/2;p.y=(o.start_px[1]+o.end_px[1])/2;const t=p.matrixTransform(document.querySelector('#plan').getScreenCTM());return {x:t.x,y:t.y};
    },id);}
    let p=await position('O014'),count=edits;
    await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+30,p.y-35,{steps:6});
    assert.equal(edits,count);assert.deepEqual(await page.evaluate(()=>state.run.document),resized);
    assert.equal(await page.evaluate(()=>state.openingPreview.openings.find(o=>o.id==='O014').start_px[1]),resized.openings.find(o=>o.id==='O014').start_px[1]);
    await page.mouse.up();await page.waitForFunction(()=>!state.busy&&!state.formDirty);assert.equal(edits,count+1);
    const moved=await page.evaluate(()=>structuredClone(state.run.document));
    assert(moved.openings.find(o=>o.id==='O014').start_px[0]>resized.openings.find(o=>o.id==='O014').start_px[0]);
    await page.locator('#undo').click();await page.waitForFunction(()=>!state.busy);assert.deepEqual(await page.evaluate(()=>state.run.document),resized);
    await page.evaluate(()=>focusOpening(state.run.document.openings.find(o=>o.id==='O014')));
    p=await position('O014');count=edits;await page.mouse.click(p.x,p.y);assert.equal(edits,count);
    await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+20,p.y,{steps:4});await page.keyboard.press('Escape');await page.mouse.up();
    assert.equal(edits,count);assert.deepEqual(await page.evaluate(()=>state.run.document),resized);
    await page.locator('#opening-floor-glass').click();assert.equal(await page.locator('#opening-height').inputValue(),'280');assert.equal(await page.locator('#opening-sill').inputValue(),'0');
    assert.deepEqual(await page.evaluate(()=>state.run.document),resized);
    await page.locator('#opening-apply').click();await page.waitForFunction(()=>!state.busy&&!state.formDirty);
    const floorGlass=await page.evaluate(()=>structuredClone(state.run.document));
    await page.screenshot({path:path.join(output,'desktop.png')});
    await page.evaluate(()=>document.getElementById('open-model').click());await page.locator('#model-canvas canvas').waitFor();
    const model=await page.evaluate(async()=>{const {buildModel}=await import('/model-geometry.mjs');return buildModel(state.run.document).openings;});
    const glass=model.find(o=>o.id==='O014');assert.equal(glass.bottom,0);assert.equal(glass.top,2.8);assert(Math.abs((glass.b-glass.a)*floorGlass.scale_mm_per_px-2200)<1e-6);
    await page.locator('#model-top').click();await page.screenshot({path:path.join(output,'model.png')});await page.locator('#close-model').click();
    const saved=await page.evaluate(()=>saveProject());await page.evaluate(id=>openProject(id),saved.saved_name);assert.deepEqual(await page.evaluate(()=>state.run.document),floorGlass);
    const doorId=await page.evaluate(()=>state.run.document.openings.find(o=>o.kind==='door'&&(!o.requires_confirmation||o.review_status==='confirmed')).id);
    await page.evaluate(id=>focusOpening(state.run.document.openings.find(o=>o.id===id)),doorId);
    assert(await page.locator('#opening-sill').isDisabled());assert(await page.locator('#opening-floor-glass').isHidden());
    await page.locator('#opening-height').fill('200');await page.locator('#opening-apply').click();await page.waitForFunction(()=>!state.busy&&!state.formDirty);
    assert.equal(await page.evaluate(id=>state.run.document.openings.find(o=>o.id===id).dimensions_mm.height_mm,doorId),2000);
    await page.locator('#undo').click();await page.waitForFunction(()=>!state.busy);assert.deepEqual(await page.evaluate(()=>state.run.document),floorGlass);
    await page.evaluate(()=>focusOpening(state.run.document.openings.find(o=>o.id==='O014')));
    await page.locator('#opening-width').fill('2000');assert(await page.locator('#opening-apply').isDisabled());await page.locator('#opening-discard').click();
    await page.route('**/api/edit-opening',route=>route.abort());await page.locator('#opening-width').fill('210');await page.locator('#opening-apply').click();
    await page.waitForFunction(()=>!state.busy);assert.deepEqual(await page.evaluate(()=>state.run.document),floorGlass);
    assert((await page.locator('#opening-edit-status').textContent()).includes('未应用'));await page.unroute('**/api/edit-opening');await page.locator('#opening-discard').click();
    await page.setViewportSize({width:390,height:844});await page.evaluate(()=>focusOpening(state.run.document.openings.find(o=>o.id==='O014')));
    await page.locator('#opening-width').fill('210');await page.locator('#opening-apply').click();await page.waitForFunction(()=>!state.busy&&!state.formDirty);
    await page.screenshot({path:path.join(output,'mobile.png')});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({baseline_project:baseline.saved_name,test_project:saved.saved_name,page_errors:errors,checks:['unscaled guard','cm preview/apply','wall constrained drag','one edit per gesture','undo','click without move','Esc cancel','floor glass','3D sync','save/reopen','door grounding','oversize rejection','network failure','mobile cm edit and layout']},null,2));
    console.log(JSON.stringify({ok:true,baseline_project:baseline.saved_name,checks:14,page_errors:errors}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
