// Run with bundled Playwright in NODE_PATH. All projects are temporary.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
async function main(){
  const output=path.resolve('output/ceilings-v1');await fs.mkdir(output,{recursive:true});
  const server=spawn(path.resolve('.venv/Scripts/python.exe'),['-u','-c',`
from test_projects import ProjectWorkflowTests
from test_ceilings import fixture
import hashlib, json
t=ProjectWorkflowTests();t.setUp()
try:
    doc=fixture();doc['image']['sha256']=hashlib.sha256(t.png).hexdigest()
    doc['image']['original_filename']='P35 顶面设计核查.png'
    doc['room_partition']['regions'][0]['name']='客厅'
    t.server.sessions['test'].update(document=doc,png=t.png,changes=[],history=[])
    name,_=t.save()
    print(json.dumps(dict(origin=t.origin,project=name)),flush=True)
    input()
finally:t.tearDown()
`],{stdio:['pipe','pipe','inherit']});
  let browser;
  try{
    let buffer='';const fixture=await new Promise((resolve,reject)=>{server.stdout.on('data',chunk=>{buffer+=chunk;const end=buffer.indexOf('\n');if(end>=0){try{resolve(JSON.parse(buffer.slice(0,end)))}catch(e){reject(e)}}});server.once('error',reject);server.once('exit',code=>reject(new Error(`Fixture exited ${code}`)));});
    browser=await chromium.launch({headless:true,channel:'msedge',args:['--enable-webgl','--use-angle=swiftshader']});
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(fixture.origin);await page.waitForFunction(()=>window.ceilingUI&&state.file&&!state.busy);
    await page.evaluate(name=>openProject(name),fixture.project);await page.locator('#tab-detail').click();
    const read=()=>page.evaluate(()=>structuredClone(state.run.document));
    const before=await read();
    await page.locator('#ceiling-room-apply').click();await page.waitForFunction(()=>!state.busy&&state.historySize===1);
    assert.equal((await read()).ceiling_layout.surfaces.length,1);
    await page.locator('[data-ceiling-setting="style"]').selectOption('stepped');
    await page.locator('[data-ceiling-setting="levels"]').fill('3');
    await page.waitForFunction(()=>state.ceilingPreview?.ceiling_layout.surfaces.filter(s=>s.role==='ceiling').length===4);
    assert.equal((await read()).ceiling_layout.surfaces.length,1);assert.equal(await page.evaluate(()=>state.historySize),1);
    await page.locator('#ceiling-cancel').click();assert.equal(await page.evaluate(()=>state.ceilingPreview),null);
    await page.locator('[data-ceiling-setting="style"]').selectOption('stepped');
    await page.locator('[data-ceiling-setting="levels"]').fill('3');await page.locator('#ceiling-apply').click();
    await page.waitForFunction(()=>!state.busy&&state.historySize===2);assert.equal((await read()).ceiling_layout.surfaces.filter(s=>s.role==='ceiling').length,4);
    await page.locator('#ceiling-component').selectOption('new:cove');await page.locator('#ceiling-host').selectOption('C001');
    await page.locator('#ceiling-apply').click();await page.waitForFunction(()=>!state.busy&&state.historySize===3);
    assert.equal((await read()).ceiling_layout.surfaces.filter(s=>s.role==='strip').length,1);
    await page.locator('#ceiling-component').selectOption('new:light');await page.locator('[data-ceiling-setting="light_type"]').selectOption('pendant');
    await page.locator('[data-ceiling-setting="hanging_mm"]').fill('60');await page.locator('#ceiling-apply').click();
    await page.waitForFunction(()=>!state.busy&&state.historySize===4);assert.equal((await read()).ceiling_layout.lights[0].bottom_mm,2120);
    await page.locator('#ceiling-copy').click();await page.locator('#ceiling-apply').click();await page.waitForFunction(()=>!state.busy&&state.historySize===5);
    assert.equal((await read()).ceiling_layout.lights.length,2);
    // A failed geometry edit does not commit, and cancel releases the global edit lock.
    await page.locator('[data-ceiling-setting="hanging_mm"]').fill('500');await page.locator('#ceiling-apply').click();
    await page.waitForFunction(()=>!state.busy&&$('ceiling-status').textContent.includes('不足'));
    assert.equal(await page.evaluate(()=>state.historySize),5);await page.locator('#ceiling-cancel').click();
    // Draw a local slab in the source-image coordinate system.
    await page.locator('#ceiling-component').selectOption('new:slab');await page.locator('[data-ceiling-setting="style"]').selectOption('local');await page.locator('#ceiling-draw').click();
    async function at(x,y){const p=await page.evaluate(([x,y])=>{const p=$('plan').createSVGPoint();p.x=x;p.y=y;const q=p.matrixTransform($('plan').getScreenCTM());return {x:q.x,y:q.y}},[x,y]);await page.mouse.click(p.x,p.y);}
    for(const p of [[80,80],[180,80],[180,180],[80,180]])await at(...p);
    await page.locator('#ceiling-finish').click();await page.locator('#ceiling-apply').click();await page.waitForFunction(()=>!state.busy&&state.historySize===6);
    assert.equal((await read()).ceiling_design.components.at(-1).settings.points_px.length,4);
    await page.screenshot({path:path.join(output,'plan.png')});
    // Real 3D WebGL scene and shared inspector, including preview, follow and cancellation.
    await page.locator('#open-model').click();await page.locator('#model-canvas canvas').waitFor();await page.locator('#model-ceiling-edit').click();
    await page.locator('#ceiling-roof-toggle').check();await page.screenshot({path:path.join(output,'model-roofs.png')});
    await page.locator('#model-ceiling-view').click();await page.screenshot({path:path.join(output,'model-ceiling-interior.png')});await page.locator('#model-reset').click();
    await page.locator('#model-collision-toggle').uncheck();await page.locator('#model-ceiling-view').click();await page.screenshot({path:path.join(output,'model-ceiling-clean.png')});await page.locator('#model-reset').click();await page.locator('#model-collision-toggle').check();
    await page.locator('#ceiling-roof-toggle').uncheck();await page.locator('#ceiling-component').selectOption('C003');
    for(const type of ['flush','downlight','pendant','spot','track','linear']){
      await page.locator('[data-ceiling-setting="light_type"]').selectOption(type);
      await page.waitForFunction(type=>state.ceilingPreview?.ceiling_layout.lights[0].settings.light_type===type,type);
      await page.locator('#ceiling-cancel').click();
    }
    await page.locator('[data-ceiling-setting="hanging_mm"]').fill('80');await page.waitForFunction(()=>state.ceilingPreview?.ceiling_layout.lights[0].bottom_mm===1920);
    const unchanged=await read();await page.screenshot({path:path.join(output,'model-light-preview.png')});
    await page.locator('#ceiling-cancel').click();assert.deepEqual(await read(),unchanged);
    await page.locator('#cr-height').fill('300');await page.waitForFunction(()=>state.ceilingPreview?.ceiling_layout.lights[0].mount_mm===3000);
    assert.equal(await page.locator('#ceiling-cancel').isEnabled(),true);await page.locator('#ceiling-cancel').click();
    await page.locator('[data-ceiling-setting="hanging_mm"]').fill('80');await page.locator('#ceiling-apply').click();await page.waitForFunction(()=>!state.busy&&state.historySize===7);
    await page.locator('#model-undo').click();await page.waitForFunction(()=>!state.busy&&state.historySize===6);assert.deepEqual(await read(),unchanged);
    const savedResponse=page.waitForResponse(r=>r.url().endsWith('/api/save-project'));await page.locator('#model-save').click();const saved=await (await savedResponse).json();
    await page.waitForFunction(()=>!state.busy);const authored=await read();await page.locator('#close-model').click();
    await page.evaluate(name=>openProject(name),saved.saved_name);assert.deepEqual(await read(),authored);
    // Narrow screen controls fit their container and persist the saved design.
    await page.setViewportSize({width:390,height:844});await page.locator('#tab-detail').click();
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);assert.equal(overflow,false);
    await page.screenshot({path:path.join(output,'narrow.png')});
    await page.locator('#ceiling-component').selectOption('C003');await page.locator('#ceiling-place').click();await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>state.formDirty),false);
    assert.deepEqual(await read(),authored);assert.deepEqual(errors,[]);assert.deepEqual(before.walls,authored.walls);
    await fs.writeFile(path.join(output,'results.json'),JSON.stringify({passed:true,historyChecks:7,components:authored.ceiling_design.components.length,errors},null,2));
    console.log('P35 browser checks passed: preview, steps, cove, lights, copy, local drawing, 3D, undo, save/reopen and narrow layout.');
  }finally{await browser?.close();if(server.exitCode===null){server.stdin.end('\n');await new Promise(resolve=>server.once('exit',resolve));}}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
