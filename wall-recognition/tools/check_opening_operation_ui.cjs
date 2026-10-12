// Isolated fixture, temporary projects; requires Playwright and installed Edge.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
async function main(){
  const output=path.resolve('output/opening-operation-v1');await fs.mkdir(output,{recursive:true});
  const server=spawn(path.resolve('.venv/Scripts/python.exe'),['-u','-c',`
from test_projects import ProjectWorkflowTests
from refine_walls import segment,refresh_refinement
from copy import deepcopy
import json
t=ProjectWorkflowTests();t.setUp()
try:
    t.doc['image']['original_filename']='门窗开启核查.png'
    t.doc['openings'].append(dict(id='O002',kind='window',label='窗',review_status='confirmed',**segment(0,270,340,30,10)))
    t.doc=refresh_refinement(t.doc);t.server.sessions['test']['document']=t.doc
    name,_=t.save()
    unscaled=deepcopy(t.doc);unscaled['scale_mm_per_px']=None;unscaled['image']['original_filename']='未标定开启核查.png'
    t.server.sessions['test']['document']=unscaled;other,_=t.save()
    print(json.dumps(dict(origin=t.origin,project=name,unscaled=other)),flush=True)
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
    async function openSaved(id){
      await page.locator('summary[data-icon="file"]').click();await page.locator('.command-menu [data-command="open-projects"]').click();
      await page.locator('.project-choice').filter({hasText:id}).click();await page.waitForFunction(()=>state.run&&!state.busy&&!$('projects-dialog').open);
    }
    async function select(id){await page.locator(`[data-opening-id="${id}"] rect`).click();await page.waitForFunction(()=>!state.busy&&!$('opening-form').hidden);}
    async function apply(){await page.locator('#opening-apply').click();await page.waitForFunction(()=>!state.busy&&!state.formDirty);}
    await openSaved(fixture.project);const original=await doc();
    await select('O001');
    assert((await page.locator('#opening-hinge option[value="start"]').textContent()).includes('底图上端'));
    await page.locator('#opening-direction-mode').selectOption('manual');
    await page.locator('#opening-hinge').selectOption('end');await page.locator('#opening-side').selectOption('positive');await page.locator('#opening-angle').fill('35');
    assert.deepEqual(await doc(),original);assert.equal(await page.locator('[data-opening-swing="O001"] path').count(),1);
    await page.screenshot({path:path.join(output,'door-preview.png')});
    await page.keyboard.press('Escape');assert.equal(await page.locator('[data-opening-swing="O001"]').count(),0);assert.deepEqual(await doc(),original);
    await page.locator('#opening-direction-mode').selectOption('manual');
    await page.locator('#opening-hinge').selectOption('end');await page.locator('#opening-side').selectOption('positive');await page.locator('#opening-angle').fill('35');await apply();
    const door=await doc();assert.deepEqual(door.openings[0].operation,{type:'hinged',hinge:'end',side:'positive',angle_deg:35,pivot_axis:'vertical',pivot_ratio:1,direction_mode:'manual',interior_room_id:''});
    assert.deepEqual(door.walls,original.walls);assert.deepEqual(door.room_partition,original.room_partition);assert.equal(await page.evaluate(()=>state.historySize),1);
    await page.locator('#open-model').click();await page.locator('#model-dialog').waitFor({state:'visible'});
    await page.locator('#model-top').click();await page.locator('#model-wall-ghost').check();await page.screenshot({path:path.join(output,'door-model.png')});await page.locator('#close-model').click();
    await page.locator('#undo').click();await page.waitForFunction(()=>!state.busy&&state.historySize===0);assert.deepEqual(await doc(),original);
    await select('O002');assert.equal(await page.locator('#opening-hinge option[value="start"]').textContent(),'左端铰链');
    await page.locator('#opening-direction-mode').selectOption('manual');
    await page.locator('#opening-type').selectOption('hinged');await page.locator('#opening-hinge').selectOption('end');await page.locator('#opening-side').selectOption('positive');await page.locator('#opening-angle').fill('60');await apply();
    const windowOp={type:'hinged',hinge:'end',side:'positive',angle_deg:60,pivot_axis:'vertical',pivot_ratio:1,axis_mode:'manual',direction_mode:'manual',interior_room_id:''};assert.deepEqual((await doc()).openings[1].operation,windowOp);
    await page.locator('#opening-width').fill('80');await apply();assert.deepEqual((await doc()).openings[1].operation,windowOp);
    await page.locator('#open-model').click();await page.locator('#model-dialog').waitFor({state:'visible'});await page.locator('#model-top').click();
    await page.screenshot({path:path.join(output,'window-model.png')});await page.locator('#close-model').click();
    // Failed commit keeps authoritative geometry and history; discard clears preview.
    const beforeFailure=await doc(),history=await page.evaluate(()=>state.historySize);
    await page.locator('#opening-angle').fill('45');await page.route('**/api/edit-opening',route=>route.abort('failed'));
    await page.locator('#opening-apply').click();await page.waitForFunction(()=>!state.busy&&$('opening-edit-status').textContent.includes('修改未应用'));
    assert.deepEqual(await doc(),beforeFailure);assert.equal(await page.evaluate(()=>state.historySize),history);
    await page.unroute('**/api/edit-opening');await page.locator('#opening-discard').click();
    // Fixed conversion replaces the open sash, and cancellation restores its angle.
    await page.locator('#opening-type').selectOption('fixed');assert.equal(await page.locator('#opening-angle').inputValue(),'0');await page.keyboard.press('Escape');
    assert.equal(await page.locator('#opening-angle').inputValue(),'60');
    await page.locator('#save').click();await page.waitForFunction(()=>!state.busy&&!state.dirty);
    const savedName=(await page.locator('#save-status').textContent()).split(' · ').at(-1),saved=await doc();
    await openSaved(savedName);assert.deepEqual(await doc(),saved);
    await openSaved(fixture.unscaled);const unscaled=await doc();await select('O001');
    await page.locator('#opening-direction-mode').selectOption('manual');
    assert(await page.locator('#opening-width').isDisabled());assert(await page.locator('#opening-hinge').isEnabled());
    await page.locator('#opening-side').selectOption('negative');await page.locator('#opening-angle').fill('90');await apply();
    const unscaledEdited=await doc();assert.equal(unscaledEdited.scale_mm_per_px,null);assert.deepEqual(unscaledEdited.walls,unscaled.walls);
    await page.setViewportSize({width:390,height:844});await select('O001');await page.locator('#opening-angle').fill('45');await apply();
    await page.screenshot({path:path.join(output,'narrow.png'),fullPage:true});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
    const result={door_preview_cancel:'passed',door_direction_apply:'passed',one_step_undo:'passed',window_sash:'passed',resize_preserves_direction:'passed',failure_atomicity:'passed',fixed_preview_cancel:'passed',save_reopen:'passed',unscaled_direction:'passed',narrow:'passed',page_errors:errors};
    await fs.writeFile(path.join(output,'results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
  }finally{await browser?.close();server.stdin.end('\n');if(server.exitCode===null)await once(server,'exit');}
}
main().catch(error=>{console.error(error);process.exitCode=1});
