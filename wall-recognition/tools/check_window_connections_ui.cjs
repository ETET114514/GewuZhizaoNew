// Exercise a saved-plan copy on an isolated server; never change the source project.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process'),{once}=require('node:events');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
async function main(){
  const output=path.resolve('output/window-connections-v1');await fs.mkdir(output,{recursive:true});
  const source=path.resolve(process.env.WINDOW_CONNECTION_PROJECT||'projects/20261013-183746-c546b2');
  const server=spawn(path.resolve('.venv/Scripts/python.exe'),['-u','-c',`
from test_projects import ProjectWorkflowTests
from pathlib import Path
import json,os
t=ProjectWorkflowTests();t.setUp()
try:
    root=Path(os.environ['WINDOW_CONNECTION_PROJECT'])
    t.doc=json.loads((root/'walls.json').read_text(encoding='utf-8'))
    t.png=(root/'floorplan.png').read_bytes()
    t.server.sessions['test'].update(document=t.doc,png=t.png,changes=[],history=[])
    name,_=t.save();print(json.dumps(dict(origin=t.origin,project=name)),flush=True)
    input()
finally:
    t.tearDown()
`],{env:{...process.env,WINDOW_CONNECTION_PROJECT:source},stdio:['pipe','pipe','inherit']});
  let browser;
  try{
    let buffer='';const fixture=await new Promise((resolve,reject)=>{
      server.stdout.on('data',chunk=>{buffer+=chunk;const end=buffer.indexOf('\n');if(end>=0)try{resolve(JSON.parse(buffer.slice(0,end)))}catch(e){reject(e)}});
      server.once('error',reject);server.once('exit',code=>reject(new Error(`Fixture exited ${code}`)));
    });
    browser=await chromium.launch({headless:true,channel:'msedge',args:['--enable-webgl','--use-angle=swiftshader']});
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
    await page.goto(fixture.origin);await page.waitForFunction(()=>state.file&&state.openingOperation&&!state.busy);
    await page.evaluate(async()=>{
      const THREE=await import('/vendor/three.module.min.js'),add=THREE.Object3D.prototype.add;
      THREE.Object3D.prototype.add=function(...objects){const result=add.apply(this,objects);if(objects.some(o=>o.userData.id==='window-frames'))window.testFrameGroup=this;return result;};
    });
    const doc=()=>page.evaluate(()=>structuredClone(state.run.document));
    const geometry=()=>page.evaluate(async()=>{const {buildModel}=await import('/model-geometry.mjs');const m=buildModel(state.run.document);return {joins:m.windowConnections,frame:m.boxes.filter(b=>['window_fixed_frame','window_corner_frame'].includes(b.component)),wall:m.wallMesh};});
    async function click(id){await page.locator('#'+id).click();await page.waitForFunction(()=>!state.busy);}
    async function openSaved(id){await page.locator('summary[data-icon="file"]').click();await page.locator('.command-menu [data-command="open-projects"]').click();await page.locator('.project-choice').filter({hasText:id}).click();await page.waitForFunction(()=>state.run&&!state.busy&&!$('projects-dialog').open);}
    async function model(){await click('open-model');await page.locator('#model-dialog').waitFor({state:'visible'});}
    const frameStats=()=>page.evaluate(()=>window.testFrameGroup.children.filter(o=>o.userData.id==='window-frames').map(o=>({indexed:Boolean(o.geometry.index),opacity:o.material.opacity,triangles:o.geometry.index.count/3})));
    await openSaved(fixture.project);const original=await doc();await model();const initial=await geometry();
    assert.equal(initial.joins.length,3);assert.equal((await frameStats()).length,1);assert((await frameStats())[0].indexed);
    await click('model-wall-ghost');assert.equal((await frameStats())[0].opacity,.12);await click('model-wall-ghost');assert.equal((await frameStats())[0].opacity,1);
    await page.screenshot({path:path.join(output,'closed.png')});
    const baseline=await browser.newPage();
    await baseline.route('**/opening-operation.mjs',async route=>{
      const response=await route.fetch(),body=(await response.text()).replace('export function windowCornerConnections(doc,normalized){','export function windowCornerConnections(doc,normalized){ return [];');
      await route.fulfill({response,body});
    });
    await baseline.goto(fixture.origin);
    const detail=await browser.newPage({viewport:{width:1000,height:660}});await detail.goto(fixture.origin);
    const shots=[
      {name:'window-right',ids:['W037','W038'],point:[643.25,681.5],direction:[1,1]},
      {name:'window-middle',ids:['W039','W041'],point:[431,740.25],direction:[1,1]},
      {name:'window-left',ids:['W040','W041'],point:[115.5,740.25],direction:[-1,1]}];
    async function renderDetails(document,shots,suffix=''){
      const reference=await baseline.evaluate(async doc=>{const {buildModel}=await import('/model-geometry.mjs');return buildModel(doc).boxes;},document);
      for(const shot of shots){
        await detail.evaluate(async({doc,reference,shot})=>{
          const THREE=await import('/vendor/three.module.min.js'),{buildModel}=await import('/model-geometry.mjs'),{unionWallBoxes}=await import('/wall-joints.mjs');
          const m=buildModel(doc),unit=doc.scale_mm_per_px/1000,ids=[...shot.ids,...m.openings.filter(o=>o.hosts.some(id=>shot.ids.includes(id))).map(o=>o.id)];
          document.body.replaceChildren();document.body.style.cssText='margin:0;display:flex;flex-direction:row;width:1000px;height:660px;background:#edf1f3;font:16px sans-serif';
          const target=new THREE.Vector3((shot.point[0]-doc.image.width_px/2)*unit,1.4,(shot.point[1]-doc.image.height_px/2)*unit);
          for(const after of [false,true]){
            const panel=document.createElement('div');panel.style.cssText='width:500px;flex:none;position:relative';document.body.append(panel);
            const title=document.createElement('div');title.textContent=after?'共用转角框':'原来的独立端框';title.style.cssText='position:absolute;top:16px;left:18px;color:#29465b';panel.append(title);
            const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(500,660);renderer.setClearColor('#edf1f3');renderer.outputColorSpace=THREE.SRGBColorSpace;panel.append(renderer.domElement);
            const scene=new THREE.Scene();scene.add(new THREE.HemisphereLight(0xffffff,0x86929e,2.3));const light=new THREE.DirectionalLight(0xffffff,2.5);light.position.set(-8,15,10);scene.add(light);
            const camera=new THREE.OrthographicCamera(-1.8,1.8,2.376,-2.376,.01,100);camera.position.copy(target).add(new THREE.Vector3(shot.direction[0]*6,4,shot.direction[1]*6));camera.lookAt(target);
            const parts=(after?m.boxes:reference).filter(b=>ids.includes(b.id)||b.openingIds?.some(id=>ids.includes(id)));
            function merged(boxes,color){
              const data=unionWallBoxes(boxes.map(b=>({...b,kind:'wall'})));if(!data.indices.length)return;
              const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(data.positions,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(data.normals,3));g.setIndex(data.indices);
              scene.add(new THREE.Mesh(g,new THREE.MeshStandardMaterial({color,roughness:.65})));
            }
            merged(parts.filter(b=>b.kind==='wall'),m.settings.wall_color);
            const fixed=b=>['window_fixed_frame','window_fixed_mullion','window_corner_frame'].includes(b.component);
            merged(parts.filter(fixed),'#657e88');
            for(const b of parts.filter(b=>b.kind!=='wall'&&!fixed(b))){
              const opacity=b.kind==='glass'?.38:1,mesh=new THREE.Mesh(new THREE.BoxGeometry(...b.size),new THREE.MeshStandardMaterial({color:b.color,roughness:.65,transparent:opacity<1,opacity,depthWrite:opacity===1}));
              mesh.position.set(...b.center);if(b.quaternion)mesh.quaternion.fromArray(b.quaternion);else mesh.rotation.y=b.rotation_y||0;scene.add(mesh);
            }
            renderer.render(scene,camera);
          }
        },{doc:document,reference,shot});
        await detail.screenshot({path:path.join(output,shot.name+suffix+'.png')});
      }
    }
    await renderDetails(original,shots);
    for(const id of ['O015','O013']){
      await page.locator('#model-quick-opening-select').selectOption(id);await click('model-quick-toggle');
      assert.equal((await doc()).openings.find(o=>o.id===id).operation.angle_deg,45);
      assert.deepEqual((await geometry()).frame,initial.frame);assert.deepEqual((await geometry()).wall,initial.wall);
    }
    const opened=await doc();await page.screenshot({path:path.join(output,'opened.png')});await renderDetails(opened,[shots[1]],'-opened');
    await click('model-save');const saved=(await page.locator('#model-message').textContent()).replace('已保存：','');await click('close-model');await openSaved(saved);assert.deepEqual(await doc(),opened);await model();assert.deepEqual((await geometry()).frame,initial.frame);
    // Test closing and undo on the reopened copy.
    await page.locator('#model-quick-opening-select').selectOption('O013');await click('model-quick-toggle');assert.equal((await doc()).openings.find(o=>o.id==='O013').operation.angle_deg,0);
    await click('model-undo');assert.deepEqual(await doc(),opened);
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(output,'narrow.png')});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    for(const key of ['walls','furniture','room_partition','scale_mm_per_px'])assert.deepEqual(opened[key],original[key]);
    for(const o of original.openings){const copy=structuredClone(opened.openings.find(x=>x.id===o.id));if(['O015','O013'].includes(o.id)){if(o.operation)copy.operation=o.operation;else delete copy.operation;}assert.deepEqual(copy,o);}
    assert.deepEqual(errors,[]);
    const result={joins:initial.joins,frame_mesh:(await frameStats())[0],shared_three_corners:'passed',ghost:'passed',independent_open_close:'passed',stationary_frame_and_wall:'passed',opening_dimensions_and_source:'passed',undo:'passed',save_reopen:'passed',narrow:'passed',page_errors:errors};
    await fs.writeFile(path.join(output,'results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));await detail.close();await baseline.close();
  }finally{await browser?.close();server.stdin.end('\n');if(server.exitCode===null)await once(server,'exit');}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
