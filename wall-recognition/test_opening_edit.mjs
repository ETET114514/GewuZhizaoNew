import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openingHost,openingPreview,newOpeningPreview} from './web/opening-edit.mjs';
import {buildModel} from './web/model-geometry.mjs';
function fixture(vertical=false){
  const g=(a,b)=>({orientation:vertical?'vertical':'horizontal',start_px:vertical?[100,a]:[a,100],end_px:vertical?[100,b]:[b,100],thickness_px:20,length_px:b-a});
  return {image:{width_px:500,height_px:500},scale_mm_per_px:10,walls:[{id:'W1',...g(20,100)},{id:'W2',...g(200,480)},{id:'W3',source:'automatic_opening_connection',...g(100,200)}],openings:[{id:'O1',kind:'window',review_status:'confirmed',...g(100,200)}],furniture:[]};
}
test('new aperture preview subtracts wall solids, generates matching 3D opening and rejects overlaps',()=>{
  for(const vertical of [false,true]){
    const doc=fixture(vertical),before=structuredClone(doc),axis=vertical?1:0;
    const result=newOpeningPreview(doc,'W2','door',{width_mm:800,height_mm:2100,sill_height_mm:0},320);
    assert.deepEqual(doc,before);
    const o=result.openings.at(-1);assert.equal(o.start_px[axis],280);assert.equal(o.end_px[axis],360);
    assert(!result.walls.some(w=>w.solid_parts.some(p=>p.start_px[axis]<320&&p.end_px[axis]>320)));
    const model=buildModel(result);assert(model.openings.some(o=>o.id==='待新增'));
    assert.throws(()=>newOpeningPreview(doc,'W2','window',{width_mm:800},150),/重叠/);
  }
});
test('preview fills old gap, subtracts new aperture, and keeps source immutable in either orientation',()=>{
  for(const vertical of [false,true]){
    const doc=fixture(vertical),before=JSON.stringify(doc),axis=vertical?1:0;
    const preview=openingPreview(doc,'O1',{width_mm:800,height_mm:2800,sill_height_mm:0},300);
    assert.equal(JSON.stringify(doc),before);assert.equal(openingHost(doc,doc.openings[0]).id,'W2');
    assert(preview.walls.some(w=>w.solid_parts.some(p=>p.start_px[axis]<150&&p.end_px[axis]>150)));
    assert(!preview.walls.some(w=>w.solid_parts.some(p=>p.start_px[axis]<300&&p.end_px[axis]>300)));
    const model=buildModel(preview),o=model.openings[0];assert.equal(o.bottom,0);assert.equal(o.top,2.8);assert.equal(o.b-o.a,80);
    assert(model.boxes.filter(b=>b.id==='O1'&&b.kind==='glass').every(b=>b.center[1]-b.size[1]/2<.05));
  }
});
test('individual dimensions override global preset widths and preserve other windows',()=>{
  const doc=fixture();doc.model_settings={width_mode:'preset',window_width_mm:800};
  doc.openings.push({...doc.openings[0],id:'O2',start_px:[350,100],end_px:[450,100]});
  const preview=openingPreview(doc,'O1',{width_mm:1200,height_mm:1600,sill_height_mm:400},150),model=buildModel(preview);
  assert.equal(model.openings[0].b-model.openings[0].a,120);assert.equal(model.openings[1].b-model.openings[1].a,80);
  assert.equal(model.openings[0].bottom,.4);assert.equal(model.openings[1].bottom,.9);
});
test('endpoint clamping, overlaps, oversize, bad heights and missing scale are handled',()=>{
  const doc=fixture();let p=openingPreview(doc,'O1',{},500);assert.equal(p.openings[0].end_px[0],480);
  assert.throws(()=>openingPreview(doc,'O1',{width_mm:5000},150),/连续墙段/);
  assert.throws(()=>openingPreview(doc,'O1',{height_mm:2500},150),/墙高/);
  doc.openings.push({...doc.openings[0],id:'O2',start_px:[300,100],end_px:[400,100]});
  assert.throws(()=>openingPreview(doc,'O1',{},350),/重叠/);
  doc.scale_mm_per_px=null;assert.throws(()=>openingPreview(doc,'O1',{},350),/标定/);
});
