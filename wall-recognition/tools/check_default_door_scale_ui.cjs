const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
async function main(){
  const output=path.resolve('output/default-door-scale-v1');await fs.mkdir(output,{recursive:true});
  const server=spawn(path.resolve('.venv/Scripts/python.exe'),['-u','-c',`
from test_projects import ProjectWorkflowTests
import json
t=ProjectWorkflowTests();t.setUp()
try:
    t.doc['scale_mm_per_px']=None;t.doc.pop('calibration',None)
    name,_=t.save()
    print(json.dumps(dict(origin=t.origin,project=name)),flush=True)
    input()
finally:t.tearDown()
`],{stdio:['pipe','pipe','inherit']});
  let browser;
  try{
    let buffer='';const fixture=await new Promise((resolve,reject)=>{server.stdout.on('data',chunk=>{buffer+=chunk;const end=buffer.indexOf('\n');if(end>=0){try{resolve(JSON.parse(buffer.slice(0,end)))}catch(e){reject(e)}}});server.once('error',reject);server.once('exit',code=>reject(new Error(`Fixture exited ${code}`)));});
    browser=await chromium.launch({headless:true,channel:'msedge',args:['--enable-webgl','--use-angle=swiftshader']});
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
    await page.goto(fixture.origin);await page.waitForFunction(()=>state.file&&!state.busy&&state.furnitureGeometry);
    async function open(name){await page.locator('summary[data-icon="file"]').click();await page.locator('.command-menu [data-command="open-projects"]').click();await page.locator('.project-choice').filter({hasText:name}).click();if(await page.locator('#confirm-dialog').isVisible())await page.locator('#confirm-dialog [value="discard"]').click();await page.waitForFunction(()=>state.run&&!state.busy&&!$('projects-dialog').open);}
    await open(fixture.project);
    await page.locator('#tab-measure').click();assert((await page.locator('#calibration-status').textContent()).includes('默认门洞估算'));
    assert.equal(await page.evaluate(()=>state.historySize),1);assert.equal(await page.evaluate(()=>state.dirty),true);
    const calibrated=await page.evaluate(()=>structuredClone(state.run.document));assert.equal(calibrated.calibration.width_mm,800);
    await page.screenshot({path:path.join(output,'automatic.png')});
    const saveResponse=page.waitForResponse(r=>r.url().endsWith('/api/save-project'));await page.locator('#save').click();const saved=await(await saveResponse).json();await page.waitForFunction(()=>!state.busy);
    await page.locator('#undo').click();await page.waitForFunction(()=>!state.busy&&state.historySize===0);
    assert.equal(await page.evaluate(()=>state.run.document.scale_mm_per_px),null);
    await page.locator('#tab-display').click();await page.locator('#rail-plan').click();await page.locator('#tab-measure').click();assert.equal(await page.evaluate(()=>state.run.document.scale_mm_per_px),null);
    await open(saved.saved_name);assert.deepEqual(await page.evaluate(()=>state.run.document),calibrated);
    assert.equal(await page.evaluate(()=>state.historySize),0);assert.equal(await page.evaluate(()=>state.dirty),false);
    await page.locator('#open-model').click();await page.locator('#model-dialog canvas').waitFor();await page.screenshot({path:path.join(output,'model.png')});await page.locator('#close-model').click();
    // A later manual length calibration takes priority and survives reopening.
    await page.evaluate(async()=>{const result=await api('/api/model-settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({run_id:state.run.run_id,calibration:{points_px:[[0,0],[100,0]],length_mm:2000}})});adoptEdits(result);});
    assert.equal(await page.evaluate(()=>state.run.document.scale_mm_per_px),20);
    const manualResponse=page.waitForResponse(r=>r.url().endsWith('/api/save-project'));await page.locator('#save').click();const manual=await(await manualResponse).json();await page.waitForFunction(()=>!state.busy);await open(manual.saved_name);
    assert.equal(await page.evaluate(()=>state.run.document.scale_mm_per_px),20);assert.equal(await page.evaluate(()=>state.run.document.calibration.automatic||false),false);
    await page.setViewportSize({width:390,height:844});await page.locator('#rail-plan').click();await page.locator('#tab-measure').click();await page.screenshot({path:path.join(output,'narrow.png'),fullPage:true});assert.deepEqual(errors,[]);
    await fs.writeFile(path.join(output,'browser-check.json'),JSON.stringify({passed:true,checks:['automatic on opening unscaled plan','automatic reference status','one-step undo stays unscaled','save and reopen retains estimated scale','3D ready without manual calibration','manual calibration overrides default','390 px screen'],errors},null,2));
    console.log('Default door scale browser checks passed.');
  }finally{await browser?.close();server.stdin.end('\n');if(server.exitCode===null)await once(server,'exit');}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
