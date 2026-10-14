// NODE_PATH must contain playwright. Uses an isolated temporary project server.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
async function main(){
  const output=path.resolve(process.env.CHECK_OUTPUT_DIR||'output/snap-opening-add-v1');await fs.mkdir(output,{recursive:true});
  const server=spawn(path.resolve('.venv/Scripts/python.exe'),['-u','-c',`
from test_projects import ProjectWorkflowTests
from test_opening_edit import fixture
import json
t=ProjectWorkflowTests();t.setUp()
try:
    doc,png=fixture()
    doc['image']['original_filename']='吸附与门窗核查.png'
    doc['furniture']=[dict(id='F001',kind='chair',label='椅子',bbox_px=[250,60,290,100],rotation_deg=None,review_status='confirmed'),dict(id='F002',kind='chair',label='椅子',bbox_px=[380,300,420,340],rotation_deg=None,review_status='confirmed')]
    t.server.sessions['test'].update(document=doc,png=png,changes=[],history=[])
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
    async function openSaved(name){await page.locator('summary[data-icon="file"]').click();await page.locator('.command-menu [data-command="open-projects"]').click();await page.locator('.project-choice').filter({hasText:name}).click();await page.waitForFunction(()=>state.run&&!state.busy&&!$('projects-dialog').open);}
    async function point(x,y){return page.evaluate(([x,y])=>{const p=$('plan').createSVGPoint();p.x=x;p.y=y;const q=p.matrixTransform($('plan').getScreenCTM());return {x:q.x,y:q.y}},[x,y]);}
    async function at(x,y){const p=await point(x,y);await page.mouse.move(p.x,p.y);return p;}
    async function clickAt(x,y){const p=await at(x,y);await page.mouse.click(p.x,p.y);await page.waitForFunction(()=>!state.busy);}
    async function arm(kind){await page.locator('#rail-plan').click();await page.locator('#tab-edit').click();await page.locator(`#add-${kind}`).click();await page.waitForFunction(()=>state.mode==='opening-place');}
    await openSaved(fixture.project);const original=await page.evaluate(()=>structuredClone(state.run.document));
    // Actual pointer gesture, alignment guide, single history entry and undo.
    let start=await at(270,80);await page.mouse.down();await at(397,80);
    await page.waitForFunction(()=>$('furniture-snap-layer')?.querySelector('line'));
    assert.equal(await page.evaluate(()=>state.furnitureDraft.bbox_px[0]),380);
    await page.screenshot({path:path.join(output,'snap-preview.png')});
    await page.mouse.up();await page.waitForFunction(()=>!state.busy&&state.historySize===1);
    assert.equal(await page.evaluate(()=>state.run.document.furniture[0].bbox_px[0]),380);
    await page.locator('#undo').click();await page.waitForFunction(()=>!state.busy&&state.historySize===0);
    await page.keyboard.down('Alt');start=await at(270,80);await page.mouse.down();await at(397,80);await page.mouse.up();await page.keyboard.up('Alt');
    await page.waitForFunction(()=>!state.busy&&state.historySize===1);assert.equal(await page.evaluate(()=>state.run.document.furniture[0].bbox_px[0]),377);
    await page.locator('#undo').click();await page.waitForFunction(()=>!state.busy&&state.historySize===0);
    await page.locator('#tab-materials').click();await page.locator('#furniture-snap-toggle').uncheck();
    start=await at(270,80);await page.mouse.down();await at(397,80);await page.mouse.up();await page.waitForFunction(()=>!state.busy&&state.historySize===1);
    assert.equal(await page.evaluate(()=>state.run.document.furniture[0].bbox_px[0]),377);
    await page.locator('#undo').click();await page.waitForFunction(()=>!state.busy&&state.historySize===0);await page.locator('#furniture-snap-toggle').check();
    // Door placement preview is immutable; Esc, overlap and failure are atomic.
    await page.locator('#rail-plan').click();await page.locator('#tab-edit').click();await page.locator('#add-entry-door').click();
    assert.equal(await page.locator('#new-opening-width').inputValue(),'120');assert.equal(await page.locator('#new-opening-height').inputValue(),'210');
    await at(320,200);await page.waitForFunction(()=>state.openingPreview?.openings.at(-1)?.door_model==='entry');await page.keyboard.press('Escape');
    await arm('door');
    for(const width of [120,90,80]){
      await page.locator('#new-door-preset').selectOption(String(width));await at(320,200);
      await page.waitForFunction(width=>state.openingPreview?.openings.at(-1)?.dimensions_mm.width_mm===width*10,width);
      assert.equal(await page.evaluate(()=>state.openingPreview.openings.at(-1).door_model),width===120?'entry':'standard');
      assert.equal(await page.locator('#new-opening-width').inputValue(),String(width));
    }
    await page.locator('#new-door-preset').selectOption('90');await at(320,200);await page.waitForFunction(()=>state.openingPreview?.openings.some(o=>o.id==='待新增'));
    assert.deepEqual(await page.evaluate(()=>state.run.document),original);
    await page.screenshot({path:path.join(output,'door-preview.png')});await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>state.openingPreview),null);
    await arm('door');await clickAt(150,200);assert.equal(await page.evaluate(()=>state.run.document.openings.length),1);assert.equal(await page.evaluate(()=>state.historySize),0);
    await clickAt(320,200);await page.waitForFunction(()=>state.run.document.openings.length===2);
    assert.equal(await page.evaluate(()=>state.run.document.openings.at(-1).kind),'door');assert.equal(await page.evaluate(()=>state.historySize),1);
    for(const [id,width] of [['opening-entry-door',120],['opening-bedroom-door',90],['opening-ordinary-door',80]]){
      await page.locator('#'+id).click();await page.waitForFunction(width=>state.openingPreview?.openings.at(-1)?.dimensions_mm.width_mm===width*10,width);
      assert.equal(await page.locator('#opening-width').inputValue(),String(width));
      await page.screenshot({path:path.join(output,id+'.png')});await page.locator('#opening-discard').click();
    }
    await page.locator('#opening-entry-door').click();await page.locator('#opening-apply').click();await page.waitForFunction(()=>!state.busy&&state.historySize===2);
    assert.equal(await page.evaluate(()=>state.run.document.openings.at(-1).dimensions_mm.width_mm),1200);
    assert.equal(await page.evaluate(()=>state.run.document.openings.at(-1).door_model),'entry');
    await page.locator('#open-model').click();await page.locator('#model-dialog canvas').waitFor();await page.screenshot({path:path.join(output,'entry-model.png')});await page.locator('#close-model').click();
    const doorSaveResponse=page.waitForResponse(r=>r.url().endsWith('/api/save-project'));await page.locator('#save').click();const doorSaved=await (await doorSaveResponse).json();await page.waitForFunction(()=>!state.busy);
    const reopenedDoor=await page.evaluate(name=>api('/api/open-project',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project_id:name})}),doorSaved.saved_name);
    assert.equal(reopenedDoor.document.openings.at(-1).dimensions_mm.width_mm,1200);
    assert.equal(reopenedDoor.document.openings.at(-1).door_model,'entry');
    await page.locator('#undo').click();await page.waitForFunction(()=>!state.busy&&state.historySize===1);
    assert.equal(await page.evaluate(()=>state.run.document.openings.at(-1).dimensions_mm.width_mm),900);
    await page.locator('#undo').click();await page.waitForFunction(()=>!state.busy&&state.historySize===0);
    await arm('window');await page.route('**/api/edit-opening',r=>r.abort('failed'));await clickAt(340,200);
    assert.equal(await page.evaluate(()=>state.run.document.openings.length),1);assert.equal(await page.evaluate(()=>state.historySize),0);
    await page.unroute('**/api/edit-opening');await page.locator('#new-opening-width').fill('100');await clickAt(350,200);await page.waitForFunction(()=>state.run.document.openings.length===2);
    const edited=await page.evaluate(()=>structuredClone(state.run.document));assert.equal(edited.openings.at(-1).dimensions_mm.width_mm,1000);
    await page.locator('#tab-display').click();await page.locator('#open-model').click();await page.locator('#model-dialog canvas').waitFor();
    await page.screenshot({path:path.join(output,'model.png')});
    await page.locator('#model-furniture-select').selectOption('F001');await page.locator('#model-top').click();await page.locator('#mf-focus').click();await page.locator('#model-move').click();
    const canvas=await page.locator('#model-canvas canvas').boundingBox(),cx=canvas.x+canvas.width/2,cy=canvas.y+canvas.height/2;
    await page.mouse.move(cx,cy);await page.mouse.down();await page.mouse.move(cx+25,cy+15,{steps:8});
    await page.waitForFunction(()=>$('model-move-status').textContent.includes('间距'));
    await page.screenshot({path:path.join(output,'model-move.png')});await page.keyboard.press('Escape');await page.mouse.up();
    assert.deepEqual(await page.evaluate(()=>state.run.document),edited);
    await page.mouse.move(cx,cy);await page.mouse.down();await page.mouse.move(cx+25,cy+15,{steps:8});await page.mouse.up();
    await page.waitForFunction(()=>!state.busy&&!state.formDirty&&state.historySize===2);
    await page.locator('#model-undo').click();await page.waitForFunction(()=>!state.busy&&state.historySize===1);
    assert.deepEqual(await page.evaluate(()=>state.run.document),edited);
    await page.locator('#close-model').click();
    const response=page.waitForResponse(r=>r.url().endsWith('/api/save-project'));await page.locator('#save').click();const saved=await (await response).json();
    await page.waitForFunction(()=>!state.busy);await openSaved(saved.saved_name);assert.deepEqual(await page.evaluate(()=>state.run.document),edited);
    await page.setViewportSize({width:390,height:844});await arm('door');await page.screenshot({path:path.join(output,'narrow.png'),fullPage:true});await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(()=>state.mode),'select');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    assert.deepEqual(errors,[]);await fs.writeFile(path.join(output,'browser-check.json'),JSON.stringify({passed:true,checks:['snap guide and commit','Alt bypass','toggle bypass','single undo','new door 120/90/80 cm presets','existing door 120/90/80 cm preview','entry preset apply/save/undo','new door preview and Esc','overlap rejection','new window dimensions','network failure recovery','3D display','3D movement distances, cancel, commit and undo','save reopen','390px screen'],errors},null,2));
    console.log('Furniture snap and opening creation browser checks passed.');
  }finally{await browser?.close();server.stdin.write('\n');await Promise.race([once(server,'exit'),new Promise(resolve=>setTimeout(resolve,4000))]);server.kill();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
