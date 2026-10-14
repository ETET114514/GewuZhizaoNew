// Use bundled Playwright through NODE_PATH. Fixtures and saved projects are temporary.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');

async function main(){
  const output=path.resolve('output/lighting-groups-v1');await fs.mkdir(output,{recursive:true});
  const server=spawn(path.resolve('.venv/Scripts/python.exe'),['-u','-c',`
from test_projects import ProjectWorkflowTests
from test_lighting_groups import grouped_fixture
import json
t=ProjectWorkflowTests();t.setUp()
try:
    doc=grouped_fixture();doc['image']=t.doc['image']
    doc['room_partition']['regions'][0]['name']='客厅'
    t.server.sessions['test'].update(document=doc,png=t.png,changes=[],history=[])
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
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(fixture.origin);await page.waitForFunction(()=>window.ceilingUI&&state.file&&!state.busy);
    await page.evaluate(name=>openProject(name),fixture.project);await page.locator('#tab-detail').click();
    const read=()=>page.evaluate(()=>structuredClone(state.run.document));
    const initial=await read();const changed=()=>page.waitForFunction(()=>!state.busy&&!state.formDirty);
    const values=doc=>doc.ceiling_design.components.map(c=>c.settings);
    assert.equal(await page.locator('#cl-apply').isEnabled(),false);
    assert.match(await page.locator('#cl-members').textContent(),/3 个可控制/);
    await page.locator('#cl-group').selectOption('name:主灯');
    assert.equal(await page.evaluate(()=>state.formDirty),false);
    await page.locator('#cl-on').selectOption('off');
    await page.waitForFunction(()=>state.ceilingPreview?.ceiling_design.components[0].settings.on===false);
    assert.deepEqual(await read(),initial);assert.equal(await page.evaluate(()=>state.historySize),0);
    assert.equal(await page.locator('#ceiling-apply').isEnabled(),false);
    assert.match(await page.evaluate(async()=>{try{await saveProject();return '';}catch(e){return e.message;}}),/请先应用/);
    await page.locator('#cl-cancel').click();assert.deepEqual(await read(),initial);
    assert.equal(await page.evaluate(()=>state.ceilingPreview),null);
    await page.locator('#cl-on').selectOption('off');await page.locator('#cl-apply').click();await changed();
    assert.equal(await page.evaluate(()=>state.historySize),1);
    assert.deepEqual(values(await read()).map(v=>v.on),[false,false,false,true]);
    assert.equal((await read()).ceiling_layout.surfaces.find(s=>s.role==='strip').emissive,false);
    assert.equal(await page.locator('#cl-intensity').isEnabled(),false);
    assert.equal(await page.locator('#cl-temperature').isEnabled(),false);
    // A repeated operation is a no-op and does not dirty a saved project or add undo history.
    const saveResponse=page.waitForResponse(r=>r.url().endsWith('/api/save-project'));
    await page.locator('#save').click();await saveResponse;await changed();
    assert.equal(await page.evaluate(()=>state.dirty),false);
    await page.locator('#cl-on').selectOption('off');await page.locator('#cl-apply').click();await changed();
    assert.equal(await page.evaluate(()=>state.historySize),1);assert.equal(await page.evaluate(()=>state.dirty),false);
    // The same group across rooms can set only selected parameters.
    await page.locator('#cl-scope').selectOption('project');await page.locator('#cl-group').selectOption('name:主灯');
    await page.locator('#cl-use-intensity').check();await page.locator('#cl-intensity').fill('.6');
    await page.locator('#cl-use-temperature').check();await page.locator('#cl-temperature').fill('4500');
    await page.waitForFunction(()=>state.ceilingPreview?.ceiling_design.components[3].settings.temperature_k===4500);
    assert.deepEqual(values(await read()).map(v=>v.intensity),[1,2,3,1]);
    await page.locator('#cl-apply').click();await changed();
    assert.equal(await page.evaluate(()=>state.historySize),2);
    assert.deepEqual(values(await read()).map(v=>v.intensity),[.6,.6,3,.6]);
    assert.deepEqual(values(await read()).map(v=>v.on),[false,false,false,true]);
    // Ungrouped lights stay individually editable and can join a group with an arbitrary safe name.
    await page.locator('#ceiling-component').selectOption('C003');
    await page.locator('#ceiling-light-group').fill('辅助 <灯>');await page.locator('#ceiling-apply').click();await changed();
    assert.equal(values(await read())[2].light_group,'辅助 <灯>');
    await page.locator('#ceiling-copy').click();await page.locator('#ceiling-apply').click();await changed();
    assert.equal((await read()).ceiling_design.components.at(-1).settings.light_group,'辅助 <灯>');
    assert.equal((await read()).ceiling_design.components.at(-1).id,'C005');
    await page.locator('#cl-group').selectOption('name:辅助 <灯>');await page.locator('#cl-on').selectOption('on');
    await page.waitForFunction(()=>state.ceilingPreview?.ceiling_design.components.at(-1).settings.on===true);
    await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>state.formDirty),false);
    // Actual 3D preview uses the same group controls and cancel/undo path.
    await page.locator('#open-model').click();await page.locator('#model-canvas canvas').waitFor();
    await page.locator('#model-ceiling-edit').click();await page.locator('#cl-group').selectOption('name:主灯');
    const baseline=await read();const history=await page.evaluate(()=>state.historySize);
    await page.locator('#cl-on').selectOption('on');await page.waitForFunction(()=>state.ceilingPreview?.ceiling_layout.surfaces.find(s=>s.role==='strip').emissive===true);
    await page.locator('#model-ceiling-view').click();
    await page.locator('#ceiling-lighting-controls').scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(output,'model-preview.png')});
    assert.deepEqual(await read(),baseline);
    await page.locator('#cl-cancel').click();assert.equal(await page.evaluate(()=>state.ceilingPreview),null);
    await page.locator('#cl-on').selectOption('on');await page.locator('#cl-apply').click();await changed();
    assert.equal(await page.evaluate(()=>state.historySize),history+1);
    await page.locator('#model-undo').click();await changed();assert.deepEqual(await read(),baseline);
    const savedResponse=page.waitForResponse(r=>r.url().endsWith('/api/save-project'));
    await page.locator('#model-save').click();const saved=await (await savedResponse).json();await changed();
    const authored=await read();await page.locator('#close-model').click();
    await page.evaluate(name=>openProject(name),saved.saved_name);assert.deepEqual(await read(),authored);
    await page.locator('#tab-detail').click();await page.locator('#ceiling-lighting-controls').scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(output,'desktop.png')});
    await page.setViewportSize({width:390,height:844});await page.locator('#cl-group').selectOption('name:主灯');
    await page.locator('#cl-on').selectOption('on');await page.waitForFunction(()=>state.ceilingPreview);
    await page.locator('#ceiling-lighting-controls').scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    await page.screenshot({path:path.join(output,'narrow.png')});
    await page.locator('#cl-apply').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,'narrow-controls.png')});
    await page.keyboard.press('Escape');
    assert.deepEqual(await read(),authored);assert.deepEqual(errors,[]);
    assert.deepEqual(initial.walls,authored.walls);assert.deepEqual(initial.room_partition,authored.room_partition);
    await fs.writeFile(path.join(output,'results.json'),JSON.stringify({passed:true,components:authored.ceiling_design.components.length,
      checks:['room/project scopes','cove and lights','partial parameters','preview/cancel','no-op history and dirty state','name escaping',
        'copy membership','3D preview/undo','save/reopen','narrow layout'],errors},null,2));
    console.log('Lighting group browser checks passed: scopes, preview, cove, partial changes, copy, 3D, no-op, undo, save/reopen and narrow layout.');
  }finally{await browser?.close();if(server.exitCode===null){server.stdin.end('\n');await new Promise(resolve=>server.once('exit',resolve));}}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
