import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildModel} from './web/model-geometry.mjs';
function fixture(){return {image:{width_px:500,height_px:300},scale_mm_per_px:10,
  walls:[{id:'W1',orientation:'horizontal',start_px:[0,100],end_px:[500,100],thickness_px:20}],
  openings:[{id:'D1',kind:'door',orientation:'horizontal',start_px:[50,100],end_px:[150,100],thickness_px:20},
    {id:'O1',kind:'window',orientation:'horizontal',start_px:[250,100],end_px:[400,100],thickness_px:20}],furniture:[]};}
test('connection pieces fill the 3D crack and retain opening subtraction',()=>{
  const doc=fixture();doc.walls=[{...doc.walls[0],end_px:[200,100]},
    {...doc.walls[0],id:'W2',start_px:[204,100]},
    {...doc.walls[0],id:'W3',source:'assisted_wall_connection',start_px:[200,100],end_px:[204,100]}];
  doc.wall_connection={free_end_count:2};
  const model=buildModel(doc);
  assert.equal(solidAt(model,202,1),true);
  assert.equal(solidAt(model,100,1),false);
  assert.equal(solidAt(model,300,1.5),false);
  assert(model.warnings.some(w=>w.includes('自由端点')));
});
function solidAt(model,x,y,z=100){return model.boxes.filter(b=>b.kind==='wall').some(b=>{
  const p=[(x-250)*.01,y,(z-150)*.01];return p.every((v,i)=>v>b.center[i]-b.size[i]/2+1e-7&&v<b.center[i]+b.size[i]/2-1e-7);
});}
test('doors have headers; windows have sill and header walls, holes remain empty',()=>{
  const model=buildModel(fixture());
  assert.equal(solidAt(model,100,1),false);assert.equal(solidAt(model,100,2.5),true);
  assert.equal(solidAt(model,300,.5),true);assert.equal(solidAt(model,300,1.5),false);assert.equal(solidAt(model,300,2.6),true);
  assert.equal(solidAt(model,200,1.5),true);
});
test('preset widths and overlapping apertures subtract a union, never refill one another',()=>{
  const doc=fixture();doc.model_settings={width_mode:'preset'};
  let model=buildModel(doc);assert.equal(model.openings[0].b-model.openings[0].a,90);
  assert.equal(model.openings[1].b-model.openings[1].a,80);
  doc.openings[1].start_px=[50,100];doc.openings[1].end_px=[150,100];model=buildModel(doc);
  assert.equal(solidAt(model,100,.5),false);assert.equal(solidAt(model,100,2.3),false);assert.equal(solidAt(model,100,2.6),true);
});
test('rejected and uncertain openings do not create holes; moved openings report no host',()=>{
  const doc=fixture();doc.openings[0].review_status='rejected';doc.openings[1].requires_confirmation=true;
  assert.equal(solidAt(buildModel(doc),100,1),true);assert.equal(solidAt(buildModel(doc),300,1.5),true);
  doc.openings[1].review_status='confirmed';doc.walls[0].start_px[1]=30;doc.walls[0].end_px[1]=30;
  assert.equal(buildModel(doc).openings.length,0);assert.match(buildModel(doc).warnings[0],/未贴合/);
});
test('manual gaps, vertical walls and repeated scaling preserve source geometry',()=>{
  const doc=fixture();doc.walls[0].opening_hints=[{start_px:[420,100],end_px:[450,100]}];
  const original=JSON.stringify(doc);assert.equal(solidAt(buildModel(doc),430,1),false);assert.equal(JSON.stringify(doc),original);
  doc.scale_mm_per_px=20;assert.equal(buildModel(doc).width,10);
  const vertical=fixture();for(const item of [...vertical.walls,...vertical.openings]){item.orientation='vertical';item.start_px.reverse();item.end_px.reverse();}
  const model=buildModel(vertical);assert.equal(model.openings.length,2);assert(model.boxes.some(b=>b.kind==='wall'&&b.size[0]===.2));
});
test('no scale is not silently estimated; furniture is grounded and rejected furniture hidden',()=>{
  const doc=fixture();doc.scale_mm_per_px=null;assert.throws(()=>buildModel(doc),/标定/);doc.scale_mm_per_px=10;
  doc.furniture=[{id:'F1',kind:'bed',bbox_px:[20,20,120,220],rotation_deg:90},{id:'F2',kind:'sofa',bbox_px:[0,0,20,20],review_status:'rejected'}];
  let model=buildModel(doc);assert.equal(model.furnitureCount,1);
  assert(model.boxes.filter(b=>b.kind==='furniture').every(b=>b.center[1]-b.size[1]/2>=-1e-9));
  doc.model_settings={show_furniture:false};assert.equal(buildModel(doc).furnitureCount,0);
});

test('detected doors fill the frame in either orientation, across scales, without an 800 mm cap',()=>{
  for(const scale of [10,20])for(const vertical of [false,true]){
    const doc=fixture();doc.scale_mm_per_px=scale;
    doc.model_settings={door_width_mm:600}; // Inactive preset must not limit a detected opening.
    if(vertical)for(const item of [...doc.walls,...doc.openings]){item.orientation='vertical';item.start_px.reverse();item.end_px.reverse();}
    const model=buildModel(doc),leaf=model.boxes.find(b=>b.id==='D1'&&b.kind==='door');
    const axis=vertical?2:0,expected=(100*scale-80-6)/1000;
    assert(Math.abs(leaf.size[axis]-expected)<1e-9);
    const center=(100-(vertical?doc.image.height_px:doc.image.width_px)/2)*scale/1000;
    assert(Math.abs(leaf.center[axis]-center)<1e-9);
    assert(leaf.size[axis]>.8);
  }
});

test('preset doors retain the requested width and are centered within the frame',()=>{
  const doc=fixture();doc.model_settings={width_mode:'preset',door_width_mm:800,opening_width_mm:1200};
  const model=buildModel(doc),leaf=model.boxes.find(b=>b.id==='D1'&&b.kind==='door');
  assert(Math.abs(leaf.size[0]-.8)<1e-9);
  assert(Math.abs(leaf.center[0]-(-1.5))<1e-9);
});

test('clipped door leaves fit the actual frame with equal reveals and do not change source pixels',()=>{
  for(const width_mode of ['detected','preset']){
    const doc=fixture();doc.model_settings={width_mode};doc.walls[0].end_px=[110,100];
    const before=JSON.stringify(doc),model=buildModel(doc),o=model.openings.find(o=>o.id==='D1');
    const leaf=model.boxes.find(b=>b.id==='D1'&&b.kind==='door'),[a,b]=o.spans[0];
    assert(Math.abs(leaf.size[0]-((b-a)*10-80-6)/1000)<1e-9);
    assert(Math.abs(leaf.center[0]-((a+b)/2-250)*.01)<1e-9);
    assert.match(model.warnings.join(' '),/裁切/);assert.equal(JSON.stringify(doc),before);
  }
});
