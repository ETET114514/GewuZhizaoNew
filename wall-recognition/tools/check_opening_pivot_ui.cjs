const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
async function main(){
  const output=path.resolve('output/opening-pivot-v1');await fs.mkdir(output,{recursive:true});
  const server=spawn(path.resolve('.venv/Scripts/python.exe'),['-u','-c',`
from test_projects import ProjectWorkflowTests
from refine_walls import segment,refresh_refinement
import json
t=ProjectWorkflowTests();t.setUp()
try:
    t.doc['image']['original_filename']='内外方向与转轴核查.png'
    t.doc['openings'].append(dict(id='O002',kind='window',label='窗',review_status='confirmed',**segment(0,270,340,30,10)))
    t.doc=refresh_refinement(t.doc);t.server.sessions['test']['document']=t.doc
    name,_=t.save();print(json.dumps(dict(origin=t.origin,project=name)),flush=True)
    input()
finally:
    t.tearDown()
`],{stdio:['pipe','pipe','inherit']});
  let browser;
  try{
    let buffer='';const fixture=await new Promise((resolve,reject)=>{server.stdout.on('data',chunk=>{buffer+=chunk;const end=buffer.indexOf('\n');if(end>=0)try{resolve(JSON.parse(buffer.slice(0,end)))}catch(e){reject(e)}});server.once('error',reject);server.once('exit',code=>reject(new Error(`Fixture exited ${code}`)));});
    browser=await chromium.launch({headless:true,channel:'msedge',args:['--enable-webgl','--use-angle=swiftshader']});
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
    await page.goto(fixture.origin);await page.waitForFunction(()=>state.file&&state.openingOperation&&!state.busy);
    const doc=()=>page.evaluate(()=>structuredClone(state.run.document));
    const ready=()=>page.waitForFunction(()=>!state.busy&&state.openingContexts);
    async function click(id){await page.locator('#'+id).click();await ready();}
    async function select(id){await page.locator('#quick-opening-select').selectOption(id);await ready();}
    async function apply(){await click('opening-apply');await page.waitForFunction(()=>!state.formDirty);}
    async function openSaved(id){await page.locator('summary[data-icon="file"]').click();await page.locator('.command-menu [data-command="open-projects"]').click();await page.locator('.project-choice').filter({hasText:id}).click();await page.waitForFunction(()=>state.run&&!state.busy&&!$('projects-dialog').open);await ready();}
    async function model(name){await click('open-model');await page.locator('#model-dialog').waitFor({state:'visible'});await page.locator('#model-wall-ghost').check();await page.screenshot({path:path.join(output,name)});await click('model-quick-edit-pivot');assert.equal(await page.evaluate(()=>$('model-dialog').open),false);}
    await openSaved(fixture.project);const original=await doc();
    await select('O001');assert((await page.locator('#opening-context-status').textContent()).includes('两侧都有房间'));
    await click('quick-toggle');assert.equal((await doc()).openings[0].operation.angle_deg,90);assert((await page.locator('#opening-quick-controls [role="status"]').textContent()).includes('沿用当前开启侧'));
    await click('undo');assert.deepEqual(await doc(),original);
    await select('O001');
    const owner=await page.evaluate(()=>state.openingContexts.O001.positive[0].id);
    await page.locator('#opening-owner').selectOption(owner);await page.locator('#opening-hinge').selectOption('end');await page.locator('#opening-pivot').fill('80');await page.locator('#opening-angle').fill('90');await apply();
    let op=(await doc()).openings[0].operation;assert.equal(op.side,'positive');assert.equal(op.pivot_ratio,.8);assert.equal(op.interior_room_id,owner);
    assert.deepEqual((await doc()).walls,original.walls);await page.screenshot({path:path.join(output,'door-room-pivot.png')});await model('door-model.png');
    await click('undo');assert.deepEqual(await doc(),original);
    await select('O002');assert.equal(await page.locator('#opening-axis').inputValue(),'vertical');assert.equal(await page.locator('#opening-type').inputValue(),'hinged');
    await click('quick-toggle');op=(await doc()).openings[1].operation;assert.equal(op.angle_deg,45);assert.equal(op.side,'negative');await model('window-side.png');
    await select('O002');await page.locator('#opening-axis').selectOption('horizontal');await apply();
    op=(await doc()).openings[1].operation;assert.equal(op.hinge,'top');assert.equal(op.pivot_ratio,1);assert.equal(op.pivot_axis,'horizontal');assert.equal(op.side,'negative');
    assert.equal(await page.locator('[data-opening-swing="O002"] polygon').count(),1);await model('window-top.png');
    await page.locator('#opening-hinge').selectOption('bottom');await page.locator('#opening-pivot').fill('20');await apply();
    op=(await doc()).openings[1].operation;assert.equal(op.hinge,'bottom');assert.equal(op.pivot_ratio,.2);await model('window-bottom.png');
    const beforeBad=await doc();await page.locator('#opening-pivot').fill('-1');assert(await page.locator('#opening-apply').isDisabled());assert.deepEqual(await doc(),beforeBad);await page.keyboard.press('Escape');
    await select('O002');
    await page.locator('#opening-direction-mode').selectOption('manual');await page.locator('#opening-side').selectOption('positive');await apply();assert.equal((await doc()).openings[1].operation.side,'positive');
    await click('save');const saved=(await page.locator('#save-status').textContent()).split(' · ').at(-1),savedDoc=await doc();await openSaved(saved);assert.deepEqual(await doc(),savedDoc);
    await select('O002');await page.locator('#opening-angle').fill('30');await page.route('**/api/edit-opening',route=>route.abort('failed'));await click('opening-apply');assert.deepEqual(await doc(),savedDoc);await page.unroute('**/api/edit-opening');await page.locator('#opening-discard').click();
    await page.setViewportSize({width:390,height:844});await page.locator('#opening-axis').selectOption('vertical');await page.locator('#opening-pivot').fill('75');await page.locator('#opening-direction-mode').selectOption('auto');await apply();
    assert.equal((await doc()).openings[1].operation.side,'negative');assert.equal((await doc()).openings[1].operation.pivot_ratio,.75);
    await page.screenshot({path:path.join(output,'narrow.png'),fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
    const result={ambiguous_door_can_open:'passed',room_inward_door:'passed',outward_window_45:'passed',default_side_open:'passed',top_bottom_pivot:'passed',axis_position:'passed',manual_override:'passed',invalid_atomicity:'passed',save_reopen:'passed',request_failure:'passed',narrow:'passed',page_errors:errors};
    await fs.writeFile(path.join(output,'results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
  }finally{await browser?.close();server.stdin.end('\n');if(server.exitCode===null)await once(server,'exit');}
}
main().catch(error=>{console.error(error);process.exitCode=1});
