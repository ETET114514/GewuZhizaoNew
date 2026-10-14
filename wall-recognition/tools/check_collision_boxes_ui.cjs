// NODE_PATH contains Playwright. The fixture uses a temporary project directory.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
async function main(){
  const output=path.resolve('output/collision-boxes-v1');await fs.mkdir(output,{recursive:true});
  const server=spawn(path.resolve('.venv/Scripts/python.exe'),['-u','-c',`
from test_projects import ProjectWorkflowTests
from test_opening_edit import fixture
import json
t=ProjectWorkflowTests();t.setUp()
try:
    doc,png=fixture()
    doc['image']['original_filename']='碰撞箱核查.png'
    doc['furniture']=[dict(id='F001',kind='chair',label='椅子',bbox_px=[250,60,290,100],rotation_deg=None,review_status='confirmed'),dict(id='F002',kind='chair',label='椅子',bbox_px=[380,60,420,100],rotation_deg=None,review_status='confirmed')]
    t.server.sessions['test'].update(document=doc,png=png,changes=[],history=[])
    name,_=t.save()
    print(json.dumps(dict(origin=t.origin,project=name)),flush=True)
    input()
finally:t.tearDown()
`],{stdio:['pipe','pipe','inherit']});
  let browser;
  try{
    let buffer='';const fixture=await new Promise((resolve,reject)=>{
      server.stdout.on('data',chunk=>{buffer+=chunk;const end=buffer.indexOf('\n');if(end>=0){try{resolve(JSON.parse(buffer.slice(0,end)))}catch(e){reject(e)}}});
      server.once('error',reject);server.once('exit',code=>reject(new Error(`Fixture exited ${code}`)));
    });
    browser=await chromium.launch({headless:true,channel:'msedge',args:['--enable-webgl','--use-angle=swiftshader']});
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
    await page.goto(fixture.origin);await page.waitForFunction(()=>state.file&&!state.busy&&state.collisionGeometry);
    async function openSaved(name){
      await page.locator('summary[data-icon="file"]').click();await page.locator('.command-menu [data-command="open-projects"]').click();
      await page.locator('.project-choice').filter({hasText:name}).click();
      await page.waitForFunction(()=>$('confirm-dialog').open||state.run&&!state.busy&&!$('projects-dialog').open);
      if(await page.locator('#confirm-dialog').isVisible())await page.locator('#confirm-dialog button[value="discard"]').click();
      await page.waitForFunction(()=>state.run&&!state.busy&&!$('projects-dialog').open);
    }
    const pairs=()=>page.evaluate(()=>state.collisionResult.pairs);
    const document=()=>page.evaluate(()=>structuredClone(state.run.document));
    async function at(x,y){const p=await page.evaluate(([x,y])=>{const p=$('plan').createSVGPoint();p.x=x;p.y=y;const q=p.matrixTransform($('plan').getScreenCTM());return {x:q.x,y:q.y}},[x,y]);await page.mouse.move(p.x,p.y);return p;}
    await openSaved(fixture.project);const original=await document();assert.equal((await pairs()).length,0);
    await page.locator('#plan-collision-boxes').check();assert.equal(await page.locator('#collision-layer polygon').count(),await page.evaluate(()=>state.collisionResult.boxes.length));
    assert.ok(await page.locator('#collision-layer [data-collision-id="W002"]').count()>0);
    assert.deepEqual(await document(),original);assert.equal(await page.evaluate(()=>state.historySize),0);
    // Pointer preview, cancellation and warning-only commit.
    await at(270,80);await page.mouse.down();await at(400,80);
    await page.waitForFunction(()=>state.collisionResult.pairs.some(p=>p.ids.includes('F001')&&p.ids.includes('F002')));
    assert.ok(await page.locator('#collision-layer [data-conflict="true"]').count()>=2);
    assert.deepEqual(await document(),original);
    await page.screenshot({path:path.join(output,'overlap-preview.png')});
    await page.keyboard.press('Escape');await page.mouse.up();await page.waitForFunction(()=>state.collisionResult.pairs.length===0);
    assert.deepEqual(await document(),original);
    await at(270,80);await page.mouse.down();await at(400,80);await page.mouse.up();
    await page.waitForFunction(()=>!state.busy&&state.historySize===1);assert.equal((await pairs()).length,1);
    await page.locator('#undo').click();await page.waitForFunction(()=>!state.busy&&state.historySize===0&&state.collisionResult.pairs.length===0);
    // Wall penetration preview and cancel.
    await at(270,80);await page.mouse.down();await at(270,200);
    await page.waitForFunction(()=>state.collisionResult.pairs.some(p=>p.kinds.includes('wall')));
    await page.screenshot({path:path.join(output,'wall-preview.png')});await page.keyboard.press('Escape');await page.mouse.up();
    // Copy preview retains independent collision identity.
    await page.waitForFunction(()=>!state.formDirty);const selectedPoint=await at(270,80);await page.mouse.click(selectedPoint.x,selectedPoint.y);
    await page.locator('#furniture-copy').click();await at(400,80);
    await page.waitForFunction(()=>state.collisionResult.pairs.some(p=>p.ids.includes('待复制')));
    await page.keyboard.press('Escape');assert.deepEqual(await document(),original);
    await page.locator('#plan-collision-boxes').uncheck();
    // Numeric 3D preview, height separation, cancel, shared controls and save/undo.
    await page.locator('#open-model').click();await page.locator('#model-dialog canvas').waitFor();
    await page.locator('#model-furniture-select').selectOption('F001');await page.locator('#model-top').click();
    await page.locator('#mf-x').fill('400');
    await page.waitForFunction(()=>$('model-collision-status').textContent.includes('1 处碰撞'));
    await page.screenshot({path:path.join(output,'model-overlap.png')});assert.deepEqual(await document(),original);
    await page.locator('#mf-elevation').fill('100');
    await page.waitForFunction(()=>$('model-collision-status').textContent==='未发现碰撞');
    await page.screenshot({path:path.join(output,'height-separated.png')});
    await page.locator('#mf-discard').click();assert.deepEqual(await document(),original);
    // Direction buttons and real 3D pointer previews update the same boxes.
    await page.locator('#mf-step').fill('100');await page.locator('[data-nudge="right"]').click();
    await page.waitForFunction(()=>!state.busy&&!state.formDirty&&state.historySize===1);
    assert.ok(await page.evaluate(()=>state.run.document.furniture[0].bbox_px[0]>250));
    await page.locator('#model-undo').click();await page.waitForFunction(()=>!state.busy&&state.historySize===0);
    await page.locator('#mf-focus').click();await page.locator('#model-move').click();
    const canvas=await page.locator('#model-canvas canvas').boundingBox(),cx=canvas.x+canvas.width/2,cy=canvas.y+canvas.height/2;
    await page.mouse.move(cx,cy);await page.mouse.down();await page.mouse.move(cx+12,cy+12,{steps:4});
    await page.waitForFunction(()=>state.formDirty);
    await page.screenshot({path:path.join(output,'model-drag.png')});await page.keyboard.press('Escape');await page.mouse.up();
    await page.waitForFunction(()=>!state.formDirty);assert.deepEqual(await document(),original);
    await page.locator('#model-move').click();await page.locator('#model-top').click();
    await page.locator('#model-collision-toggle').uncheck();assert.equal(await page.locator('#plan-collision-toggle').isChecked(),false);
    assert.equal(await page.locator('#model-collision-status').textContent(),'碰撞提示已关闭');
    await page.locator('#model-collision-toggle').check();await page.locator('#model-collision-boxes').check();
    assert.equal(await page.locator('#plan-collision-boxes').isChecked(),true);
    await page.locator('#mf-x').fill('400');await page.locator('#mf-apply').click();
    await page.waitForFunction(()=>!state.busy&&!state.formDirty&&state.historySize===1);
    const edited=await document();assert.equal((await pairs()).length,1);
    const savedResponse=page.waitForResponse(r=>r.url().endsWith('/api/save-project'));await page.locator('#model-save').click();
    const saved=await (await savedResponse).json();await page.waitForFunction(()=>!state.busy);
    await page.locator('#model-undo').click();await page.waitForFunction(()=>!state.busy&&state.historySize===0);
    await page.locator('#close-model').click();await openSaved(saved.saved_name);
    assert.deepEqual(await document(),edited);assert.equal((await pairs()).length,1);
    await page.setViewportSize({width:620,height:880});await page.locator('#plan-collision-status').scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(output,'narrow.png')});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
    assert.deepEqual(errors,[]);
    await fs.writeFile(path.join(output,'results.json'),JSON.stringify({checks:['oriented boxes','2D move preview/cancel/commit/undo','wall collision','copy collision','3D numeric preview/cancel','3D nudge and undo','3D pointer drag and Esc','height separation','shared visibility controls','save/reopen','narrow layout'],pageErrors:errors},null,2));
    console.log('Collision UI checks passed');
  }finally{await browser?.close();server.stdin.end('\n');await once(server,'exit');}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
