// Isolated UI regression; temporary project data, Playwright + installed Edge.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
async function main(){
  const output=path.resolve('output/opening-quick-v1');await fs.mkdir(output,{recursive:true});
  const server=spawn(path.resolve('.venv/Scripts/python.exe'),['-u','-c',`
from test_projects import ProjectWorkflowTests
from refine_walls import segment,refresh_refinement
import json
t=ProjectWorkflowTests();t.setUp()
try:
    t.doc['image']['original_filename']='快捷打开门窗核查.png'
    t.doc['openings'][0]['operation']=dict(type='hinged',hinge='end',side='positive',angle_deg=0,direction_mode='manual')
    t.doc['openings'].extend([
        dict(id='O002',kind='window',review_status='confirmed',**segment(0,270,340,30,10)),
        dict(id='O003',kind='window',review_status='confirmed',**segment(0,270,340,280,10),operation=dict(type='fixed',hinge='start',side='negative',angle_deg=0)),
        dict(id='O004',kind='door',review_status='confirmed',**segment(1,70,105,20,10))])
    t.doc=refresh_refinement(t.doc);t.server.sessions['test']['document']=t.doc
    for o in t.doc['openings']:
        if o['id'] in ('O002','O004'):
            o['operation']=dict(type='hinged',hinge='start',side='negative',angle_deg=0,direction_mode='manual')
    name,_=t.save();print(json.dumps(dict(origin=t.origin,project=name)),flush=True)
    input()
finally:
    t.tearDown()
`],{stdio:['pipe','pipe','inherit']});
  let browser;
  try{
    let buffer='';const fixture=await new Promise((resolve,reject)=>{
      server.stdout.on('data',chunk=>{buffer+=chunk;const end=buffer.indexOf('\n');if(end>=0)try{resolve(JSON.parse(buffer.slice(0,end)))}catch(error){reject(error)}});
      server.once('error',reject);server.once('exit',code=>reject(new Error(`Fixture exited ${code}`)));
    });
    browser=await chromium.launch({headless:true,channel:process.env.OPENING_TEST_BROWSER||'msedge',args:['--enable-webgl','--use-angle=swiftshader']});
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
    await page.goto(fixture.origin);await page.waitForFunction(()=>state.file&&state.openingOperation&&!state.busy);
    const doc=()=>page.evaluate(()=>structuredClone(state.run.document));
    async function openSaved(id){await page.locator('summary[data-icon="file"]').click();await page.locator('.command-menu [data-command="open-projects"]').click();await page.locator('.project-choice').filter({hasText:id}).click();await page.waitForFunction(()=>state.run&&!state.busy&&!$('projects-dialog').open);}
    async function click(id){await page.locator('#'+id).click();await page.waitForFunction(()=>!state.busy);}
    async function undo(model=false){await click(model?'model-undo':'undo');}
    const opened=(doc,ids)=>{for(const o of doc.openings){if(ids.includes(o.id)){assert.equal(o.operation.angle_deg,o.kind==='door'?90:45);assert.equal(o.operation.type,'hinged')}else assert(o.operation?.angle_deg!==(o.kind==='door'?90:45))}};
    await openSaved(fixture.project);const original=await doc();
    assert(await page.locator('#quick-open-door').isDisabled());assert(await page.locator('#quick-open-window').isDisabled());
    await page.locator('#quick-opening-select').selectOption('O001');await click('quick-open-door');
    opened(await doc(),['O001']);assert.equal(await page.evaluate(()=>state.historySize),1);
    assert.deepEqual((await doc()).openings[0].operation,{type:'hinged',hinge:'end',side:'positive',angle_deg:90,direction_mode:'manual'});
    await click('quick-open-door');assert.equal(await page.evaluate(()=>state.historySize),1);await undo();assert.deepEqual(await doc(),original);
    await page.locator('#quick-opening-select').selectOption('O002');await click('quick-open-window');opened(await doc(),['O002']);await undo();
    await click('quick-open-doors');opened(await doc(),['O001','O004']);assert.equal(await page.evaluate(()=>state.historySize),1);await undo();
    await click('quick-open-windows');opened(await doc(),['O002']);assert.equal(await page.locator('#opening-quick-controls [role="status"]').textContent(),'已打开 0 扇门、1 扇窗；跳过 1 扇固定玻璃窗');await undo();
    await click('quick-open-all');opened(await doc(),['O001','O002','O004']);
    assert.deepEqual((await doc()).walls,original.walls);assert.deepEqual((await doc()).room_partition,original.room_partition);
    await page.locator('#opening-quick-controls').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,'desktop.png')});
    await click('save');const savedName=(await page.locator('#save-status').textContent()).split(' · ').at(-1),saved=await doc();
    await openSaved(savedName);assert.deepEqual(await doc(),saved);await openSaved(fixture.project);
    // The 3D dropdown must retain its selection independently of the 2D inspector.
    await page.locator('#quick-opening-select').selectOption('O001');await click('open-model');await page.locator('#model-dialog').waitFor({state:'visible'});
    await page.locator('#model-quick-opening-select').selectOption('O002');assert.equal(await page.locator('#model-quick-opening-select').inputValue(),'O002');
    await click('model-quick-open-window');opened(await doc(),['O002']);assert.equal(await page.locator('#model-quick-opening-select').inputValue(),'O002');
    await click('model-quick-open-all');opened(await doc(),['O001','O002','O004']);
    await click('model-top');await page.locator('#model-opening-quick-controls').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,'model.png')});
    await undo(true);opened(await doc(),['O002']);await undo(true);assert.deepEqual(await doc(),original);await click('close-model');
    await page.locator('#quick-opening-select').selectOption('O003');assert(await page.locator('#quick-open-window').isDisabled());
    // Network failure is atomic; controls recover without discarding unrelated state.
    await page.route('**/api/open-openings',route=>route.abort('failed'));await click('quick-open-all');
    assert.deepEqual(await doc(),original);assert.equal(await page.evaluate(()=>state.historySize),0);assert(await page.locator('#quick-open-all').isEnabled());await page.unroute('**/api/open-openings');
    await page.locator('#quick-opening-select').selectOption('O001');await page.locator('#opening-angle').fill('25');assert(await page.locator('#quick-open-all').isDisabled());await page.locator('#opening-discard').click();
    await page.setViewportSize({width:390,height:844});await click('quick-open-all');opened(await doc(),['O001','O002','O004']);
    await page.locator('#opening-quick-controls').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,'narrow.png'),fullPage:true});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
    const result={five_buttons:'passed',single_selection:'passed',preserve_hinge_side:'passed',fixed_skip:'passed',one_step_batch_undo:'passed',repeat_no_history:'passed',model_controls:'passed',save_reopen:'passed',failure_atomicity:'passed',draft_guard:'passed',narrow:'passed',page_errors:errors};
    await fs.writeFile(path.join(output,'results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
  }finally{await browser?.close();server.stdin.end('\n');if(server.exitCode===null)await once(server,'exit');}
}
main().catch(error=>{console.error(error);process.exitCode=1});
