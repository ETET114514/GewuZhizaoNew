// Isolated server and project directory; optionally render a saved project copy.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process'),{once}=require('node:events');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
async function main(){
  const output=path.resolve(process.env.WALL_JOINT_OUTPUT||'output/wall-joints-v1');await fs.mkdir(output,{recursive:true});
  const unionCompare=process.env.WALL_UNION_COMPARE==='1';
  const server=spawn(path.resolve('.venv/Scripts/python.exe'),['-u','-c',`
from test_projects import ProjectWorkflowTests
from refine_walls import segment,refresh_refinement
from pathlib import Path
import os,json
t=ProjectWorkflowTests();t.setUp()
try:
    source=os.environ.get('WALL_JOINT_PROJECT')
    if source:
        root=Path(source)
        t.doc=json.loads((root/'walls.json').read_text(encoding='utf-8'))
        t.png=(root/'floorplan.png').read_bytes()
    else:
        t.doc['walls']=[dict(id='branch',**segment(0,85,260,100,10)),dict(id='receiver',**segment(1,40,250,100,20))]
        t.doc['openings']=[];t.doc['furniture']=[];t.doc.pop('room_partition',None)
        t.doc=refresh_refinement(t.doc)
    t.doc.setdefault('model_settings',{}).pop('flush_wall_joints',None)
    t.server.sessions['test'].update(document=t.doc,png=t.png,changes=[],history=[])
    name,_=t.save();print(json.dumps(dict(origin=t.origin,project=name,sample=bool(source))),flush=True)
    input()
finally:
    t.tearDown()
`],{stdio:['pipe','pipe','inherit']});
  let browser;
  try{
    let buffer='';const fixture=await new Promise((resolve,reject)=>{
      server.stdout.on('data',chunk=>{buffer+=chunk;const end=buffer.indexOf('\n');if(end>=0)try{resolve(JSON.parse(buffer.slice(0,end)))}catch(e){reject(e)}});
      server.once('error',reject);server.once('exit',code=>reject(new Error(`Fixture exited ${code}`)));
    });
    browser=await chromium.launch({headless:true,channel:'msedge',args:['--enable-webgl','--use-angle=swiftshader']});
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
    await page.goto(fixture.origin);await page.waitForFunction(()=>state.file&&state.openingOperation&&!state.busy);
    await page.evaluate(async()=>{
      const THREE=await import('/vendor/three.module.min.js'),add=THREE.Object3D.prototype.add;
      THREE.Object3D.prototype.add=function(...objects){
        const result=add.apply(this,objects);if(objects.some(o=>o.userData.kind==='wall'))window.testWallGroup=this;
        return result;
      };
    });
    const renderedWalls=()=>page.evaluate(()=>window.testWallGroup.children.filter(o=>o.userData.kind==='wall').map(o=>({id:o.userData.id,indexed:Boolean(o.geometry.index),opacity:o.material.opacity,triangles:o.geometry.index?.count/3})));
    const doc=()=>page.evaluate(()=>structuredClone(state.run.document));
    const geometry=()=>page.evaluate(async()=>{const {buildModel}=await import('/model-geometry.mjs');return buildModel(state.run.document).wallJointAdjustments;});
    const corners=()=>page.evaluate(async()=>{const {buildModel}=await import('/model-geometry.mjs');return buildModel(state.run.document).wallCornerAdjustments;});
    const fills=()=>page.evaluate(async()=>{const {buildModel}=await import('/model-geometry.mjs');return buildModel(state.run.document).wallCornerFills;});
    async function click(id){await page.locator('#'+id).click();await page.waitForFunction(()=>!state.busy);}
    async function openSaved(id){await page.locator('summary[data-icon="file"]').click();await page.locator('.command-menu [data-command="open-projects"]').click();await page.locator('.project-choice').filter({hasText:id}).click();await page.waitForFunction(()=>state.run&&!state.busy&&!$('projects-dialog').open);}
    async function model(){await click('open-model');await page.locator('#model-dialog').waitFor({state:'visible'});if(!await page.locator('.model-global-settings').evaluate(el=>el.open))await page.locator('.model-global-settings summary').click();}
    await openSaved(fixture.project);const original=await doc();await model();
    let rendered=await renderedWalls();assert.equal(rendered.length,1);assert.equal(rendered[0].id,'walls');assert(rendered[0].indexed);
    await click('model-wall-ghost');assert.equal((await renderedWalls())[0].opacity,.12);
    await click('model-wall-ghost');assert.equal((await renderedWalls())[0].opacity,1);
    const setting=page.locator('[data-setting="flush_wall_joints"]');assert(await setting.isChecked());
    const adjustments=await geometry();assert(adjustments.length>0);
    const cornerChanges=await corners();
    const cornerFills=await fills();
    if(fixture.sample){
      assert(adjustments.some(t=>t.id==='W004'&&t.to===187));assert(adjustments.some(t=>t.id==='W005'&&t.to===264));
      assert(adjustments.some(t=>t.id==='W002'&&t.to===204.5));assert(adjustments.some(t=>t.id==='W025'&&t.to===439));
      assert(cornerChanges.some(c=>c.id==='W008'&&c.host==='W030'&&c.to===202));
      assert(cornerChanges.some(c=>c.id==='W016'&&c.host==='W033'&&c.to===379));
      for(const ids of [['W038','W037'],['W041','W039'],['W041','W040'],['W001','W027'],['W017','W035']]){
        assert(cornerFills.some(p=>ids.every(id=>p.wallIds.includes(id))),`Missing corner ${ids.join('/')}`);
      }
      for(const p of cornerFills.filter(p=>['W038','W041'].includes(p.id)))assert(p.top<=.9||p.bottom>=2.4);
    }
    await setting.uncheck();assert.deepEqual(await doc(),original);assert(await page.locator('#model-save').isDisabled());
    await page.screenshot({path:path.join(output,'before.png')});
    await click('model-discard');assert(await setting.isChecked());assert.deepEqual(await doc(),original);
    await setting.uncheck();await click('apply-model');assert.equal((await doc()).model_settings.flush_wall_joints,false);assert.equal((await geometry()).length,0);assert.equal((await corners()).length,0);assert.equal((await fills()).length,0);
    await click('model-undo');assert.deepEqual(await doc(),original);assert(await setting.isChecked());
    await setting.uncheck();await click('apply-model');await setting.check();await click('apply-model');
    const applied=await doc();assert.equal(applied.model_settings.flush_wall_joints,true);
    for(const key of ['walls','openings','furniture','room_partition','scale_mm_per_px'])assert.deepEqual(applied[key],original[key]);
    await page.screenshot({path:path.join(output,'after.png')});
    if(fixture.sample){
      // Same geometry/materials and camera on both sides; the baseline retains
      // earlier trimming, omitting only the new corner masonry.
      const shots=[
        {name:'window-right',ids:['W037','W038'],point:[643.25,681.5],direction:[1,1]},
        {name:'window-middle',ids:['W039','W041'],point:[431,740.25],direction:[1,1]},
        {name:'window-left',ids:['W040','W041'],point:[115.5,740.25],direction:[-1,1]},
        {name:'entry-corner',ids:['W001','W027'],point:[197,22.5],direction:[-1,-1]},
        {name:'door-corner',ids:['W017','W035'],point:[493.5,471],direction:[-1,1]}];
      const detail=await browser.newPage({viewport:{width:1000,height:660}});await detail.goto(fixture.origin);
      for(const shot of shots){
        await detail.evaluate(async({doc,shot,unionCompare})=>{
          const THREE=await import('/vendor/three.module.min.js'),{buildModel}=await import('/model-geometry.mjs');
          const {unionWallBoxes}=await import('/wall-joints.mjs');
          const model=buildModel(doc),unit=doc.scale_mm_per_px/1000;
          document.body.replaceChildren();document.body.style.cssText='margin:0;display:flex;flex-direction:row;width:1000px;height:660px;background:#edf1f3;font:16px sans-serif;';
          const ids=[...shot.ids,...model.openings.filter(o=>o.hosts.some(id=>shot.ids.includes(id))).map(o=>o.id)];
          const target=new THREE.Vector3((shot.point[0]-doc.image.width_px/2)*unit,1.4,(shot.point[1]-doc.image.height_px/2)*unit);
          for(const after of [false,true]){
            const panel=document.createElement('div');panel.style.cssText='width:500px;flex:none;position:relative';document.body.append(panel);
            const title=document.createElement('div');title.textContent=unionCompare?(after?'一体墙体':'补角后（分段墙体）'):(after?'补齐后':'补齐前（保留原收齐规则）');title.style.cssText='position:absolute;top:16px;left:18px;color:#29465b';panel.append(title);
            const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(500,660);renderer.setClearColor('#edf1f3');renderer.outputColorSpace=THREE.SRGBColorSpace;panel.append(renderer.domElement);
            const scene=new THREE.Scene();scene.add(new THREE.HemisphereLight(0xffffff,0x86929e,2.3));const light=new THREE.DirectionalLight(0xffffff,2.5);light.position.set(-8,15,10);scene.add(light);
            const camera=new THREE.OrthographicCamera(-1.8,1.8,2.376,-2.376,.01,100);
            camera.position.copy(target).add(new THREE.Vector3(shot.direction[0]*6,4,shot.direction[1]*6));camera.lookAt(target);
            const parts=model.boxes.filter(b=>ids.includes(b.id)&&(unionCompare||after||b.component!=='wall_corner'));
            if(unionCompare&&after){
              const data=unionWallBoxes(parts),geometry=new THREE.BufferGeometry();
              geometry.setAttribute('position',new THREE.Float32BufferAttribute(data.positions,3));
              geometry.setAttribute('normal',new THREE.Float32BufferAttribute(data.normals,3));geometry.setIndex(data.indices);
              scene.add(new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:model.settings.wall_color,roughness:.65})));
            }
            for(const b of parts.filter(b=>!unionCompare||!after||b.kind!=='wall')){
              const opacity=b.opacity??(b.kind==='glass'?.38:1),material=new THREE.MeshStandardMaterial({color:b.color,roughness:.65,transparent:opacity<1,opacity,depthWrite:opacity===1});
              const mesh=new THREE.Mesh(new THREE.BoxGeometry(...b.size),material);mesh.position.set(...b.center);if(b.quaternion)mesh.quaternion.fromArray(b.quaternion);else mesh.rotation.y=b.rotation_y||0;scene.add(mesh);
            }
            renderer.render(scene,camera);
          }
        },{doc:applied,shot,unionCompare});
        await detail.screenshot({path:path.join(output,`${shot.name}.png`)});
      }
      await detail.close();
    }
    await click('model-save');const saved=(await page.locator('#model-message').textContent()).replace('已保存：','');
    await click('close-model');await openSaved(saved);assert.deepEqual(await doc(),applied);await model();assert(await setting.isChecked());
    assert.equal((await renderedWalls()).length,1);
    await page.setViewportSize({width:390,height:844});await setting.uncheck();await click('model-discard');assert(await setting.isChecked());
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
    const result={default_enabled:'passed',unified_wall_mesh:'passed',wall_mesh_stats:rendered[0],ghost_walls:'passed',tips:adjustments,window_corner_changes:cornerChanges,corner_fills:cornerFills,four_reported_locations:'passed',five_corner_fills:fixture.sample?'passed':'not applicable',preview_discard:'passed',disable:'passed',undo:'passed',source_openings_furniture_unchanged:'passed',save_reopen:'passed',narrow:'passed',page_errors:errors};
    await fs.writeFile(path.join(output,'results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
  }finally{await browser?.close();server.stdin.end('\n');if(server.exitCode===null)await once(server,'exit');}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
