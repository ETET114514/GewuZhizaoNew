// Run from wall-recognition. Set NODE_PATH to a directory containing playwright.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');

async function main(){
  const output=path.resolve('output/furniture-copy-v1');
  await fs.mkdir(output,{recursive:true});
  const server=spawn(path.resolve('.venv/Scripts/python.exe'),['-u','-c',`
from test_projects import ProjectWorkflowTests
import json
t=ProjectWorkflowTests(); t.setUp()
try:
    t.doc['image']['original_filename']='家具复制核查.png'
    t.doc['furniture']=[dict(id='F001',kind='chair',label='椅子',bbox_px=[100,100,140,160],rotation_deg=None,
        review_status='confirmed',source='manual',model_3d=dict(height_mm=800,elevation_mm=20,
        color='#abcdef',rotation_deg=30,fit_rotation_deg=90))]
    name,_=t.save()
    print(json.dumps(dict(origin=t.origin,project=name)),flush=True)
    input()
finally:
    t.tearDown()
`],{stdio:['pipe','pipe','inherit']});
  let browser;
  try{
    let buffer='';
    const fixture=await new Promise((resolve,reject)=>{
      server.stdout.on('data',chunk=>{buffer+=chunk;const end=buffer.indexOf('\n');if(end>=0){try{resolve(JSON.parse(buffer.slice(0,end)))}catch(e){reject(e)}}});
      server.once('error',reject);server.once('exit',code=>reject(new Error(`Fixture exited: ${code}`)));
    });
    browser=await chromium.launch({headless:true,channel:process.env.COPY_TEST_BROWSER||'msedge',args:['--enable-webgl','--use-angle=swiftshader']});
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('dialog',dialog=>dialog.accept());
    await page.goto(fixture.origin);
    await page.waitForFunction(()=>state.file&&!state.busy&&state.furnitureGeometry);
    async function openSaved(project){
      await page.locator('summary[data-icon="file"]').click();
      await page.locator('.command-menu [data-command="open-projects"]').click();
      await page.locator('.project-choice').filter({hasText:project}).click();
      await page.waitForFunction(()=>state.run&&!state.busy&&!document.getElementById('projects-dialog').open);
    }
    async function point(x,y){
      return page.evaluate(([x,y])=>{const p=$('plan').createSVGPoint();p.x=x;p.y=y;const q=p.matrixTransform($('plan').getScreenCTM());return {x:q.x,y:q.y}},[x,y]);
    }
    async function select(id){await page.locator(`#furniture-layer [data-furniture-id="${id}"] rect`).click();}
    async function arm(id='F001'){await select(id);await page.locator('#furniture-copy').click();await page.waitForFunction(()=>state.mode==='furniture-copy');}
    async function place(x=250,y=200){const p=await point(x,y);await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.up();await page.waitForFunction(()=>!state.busy);}
    await openSaved(fixture.project);
    const original=await page.evaluate(()=>structuredClone(state.run.document));
    await arm();const p=await point(250,200);await page.mouse.move(p.x,p.y);
    await page.waitForFunction(()=>state.furniture2dPreview);
    assert.deepEqual(await page.evaluate(()=>state.run.document),original);
    await page.screenshot({path:path.join(output,'preview.png')});
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(()=>state.mode),'select');
    assert.equal(await page.evaluate(()=>state.furniture2dPreview),null);
    assert.equal(await page.evaluate(()=>state.historySize),0);
    await arm();await page.mouse.move(p.x,p.y);
    await page.locator('summary[data-icon="tools"]').click();
    await page.locator('.command-menu [data-command="select-tool"]').click();
    assert.equal(await page.locator('[data-furniture-id="待复制"]').count(),0);
    await arm();await place();
    const copied=await page.evaluate(()=>structuredClone(state.run.document));
    assert.equal(copied.furniture.length,2);assert.equal(await page.evaluate(()=>state.historySize),1);
    assert.deepEqual(copied.furniture[0],original.furniture[0]);
    assert.deepEqual(copied.furniture[1].model_3d,original.furniture[0].model_3d);
    assert.deepEqual(copied.furniture[1].bbox_px,[230,170,270,230]);
    await page.screenshot({path:path.join(output,'placed.png')});
    await page.locator('#open-model').click();await page.locator('#model-dialog').waitFor({state:'visible'});
    await page.locator('#model-furniture-select').selectOption('F002');
    assert.equal(await page.locator('#mf-height').inputValue(),'80');
    assert.equal(await page.locator('#mf-rotation').inputValue(),'30');
    await page.locator('#mf-focus').click();
    await page.screenshot({path:path.join(output,'model.png')});
    await page.locator('#mf-copy').click();
    assert.equal(await page.evaluate(()=>$('model-dialog').open),false);
    assert.equal(await page.evaluate(()=>state.mode),'furniture-copy');
    await page.keyboard.press('Escape');
    await page.locator('#undo').click();await page.waitForFunction(()=>!state.busy&&state.historySize===0);
    assert.deepEqual(await page.evaluate(()=>state.run.document),original);
    await arm();await page.route('**/api/edit-furniture',route=>route.abort('failed'));await place();
    await page.waitForFunction(()=>!$('toast').hidden&&$('toast').classList.contains('error'));
    assert.deepEqual(await page.evaluate(()=>state.run.document),original);
    assert.equal(await page.evaluate(()=>state.historySize),0);
    assert.equal(await page.evaluate(()=>state.furniture2dPreview),null);
    await page.unroute('**/api/edit-furniture');
    await arm();const outside=await point(380,280);await page.mouse.move(outside.x,outside.y);await page.mouse.down();
    await page.mouse.move(5,5);await page.mouse.up();
    assert.deepEqual(await page.evaluate(()=>state.run.document),original);
    await page.keyboard.press('Escape');
    // Cancellation through the property panel and a pointer-cancel must also be atomic.
    await arm();await page.locator('#furniture-cancel').click();
    assert.equal(await page.evaluate(()=>state.mode),'select');
    await arm();const pos=await point(250,200);await page.mouse.move(pos.x,pos.y);await page.mouse.down();
    await page.evaluate(()=>$('stage').dispatchEvent(new PointerEvent('pointercancel',{pointerId:1,bubbles:true})));
    await page.mouse.up();assert.deepEqual(await page.evaluate(()=>state.run.document),original);
    await arm();await place(5,5);
    const edge=await page.evaluate(()=>state.run.document.furniture.at(-1).bbox_px);
    assert(edge[0]>=0&&edge[1]>=0);
    await page.locator('#save').click();await page.waitForFunction(()=>!state.busy&&!state.dirty);
    const saved=await page.locator('#save-status').textContent(),name=saved.split(' · ').at(-1);
    const savedDoc=await page.evaluate(()=>structuredClone(state.run.document));
    await openSaved(name);assert.deepEqual(await page.evaluate(()=>state.run.document),savedDoc);
    // Narrow screen: browser mouse/keyboard QA, not a physical touch-device claim.
    await page.setViewportSize({width:390,height:844});
    await arm();await page.locator('#stage').scrollIntoViewIfNeeded();await place(250,200);
    assert.equal(await page.evaluate(()=>state.run.document.furniture.length),3);
    await page.screenshot({path:path.join(output,'narrow.png'),fullPage:true});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.deepEqual(errors,[]);
    const result={desktop:'passed',preview_cancel:'passed',one_step_undo:'passed',failure_atomicity:'passed',
      outside_release:'passed',pointer_cancel:'passed',edge_clamp:'passed',model_entry:'passed',save_reopen:'passed',narrow:'passed',page_errors:errors};
    await fs.writeFile(path.join(output,'results.json'),JSON.stringify(result,null,2)+'\n');
    console.log(JSON.stringify(result));
  }finally{
    await browser?.close();server.stdin.end('\n');if(server.exitCode===null)await once(server,'exit');
  }
}
main().catch(error=>{console.error(error);process.exitCode=1});
