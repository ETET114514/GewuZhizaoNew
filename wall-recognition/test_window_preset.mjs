import test from 'node:test';
import assert from 'node:assert/strict';
import {applyWindowPreset,windowWidthMm,leafPose,openingSymbol} from './web/opening-operation.mjs';
import {openingPreview} from './web/opening-edit.mjs';
import {buildModel} from './web/model-geometry.mjs';

const fixture=vertical=>{
  const start=vertical?[200,100]:[100,200],end=vertical?[200,200]:[200,200],orientation=vertical?'vertical':'horizontal';
  const o={id:'O1',kind:'window',orientation,start_px:start,end_px:end,thickness_px:20,review_status:'confirmed',operation:{type:'hinged',hinge:'start',side:'positive',angle_deg:45,axis_mode:'width'}};
  return {image:{width_px:500,height_px:500},scale_mm_per_px:18,walls:[{id:'W1',orientation,start_px:vertical?[200,20]:[20,200],end_px:vertical?[200,480]:[480,200],thickness_px:20,length_px:460}],openings:[o],furniture:[]};
};
test('width threshold uses real along-wall width, overrides, and calibrated scale',()=>{
  for(const vertical of [false,true]){
    const doc=fixture(vertical),o=doc.openings[0];
    for(const [scale,axis] of [[17.999,'vertical'],[18,'horizontal'],[18.001,'horizontal']]){
      doc.scale_mm_per_px=scale;assert.equal(applyWindowPreset(doc,o).pivot_axis,axis);
    }
    doc.scale_mm_per_px=null;assert.equal(windowWidthMm(doc,o),null);assert.equal(applyWindowPreset(doc,o).pivot_axis,'vertical');
    doc.model_settings={width_mode:'preset',window_width_mm:2500};assert.equal(applyWindowPreset(doc,o).pivot_axis,'horizontal');
    o.dimensions_mm={width_mm:900};assert.equal(applyWindowPreset(doc,o).pivot_axis,'vertical');
  }
});
test('wide preset lifts the lower edge around a fixed upper edge in both orientations and sides',()=>{
  for(const vertical of [false,true])for(const side of ['negative','positive']){
    const doc=fixture(vertical),o=doc.openings[0];o.operation.side=side;
    const op=applyWindowPreset(doc,o),pose=leafPose(vertical?1:0,[0,0,0],1.8,1.5,op);
    assert.equal(op.hinge,'top');assert.equal(op.pivot_ratio,1);
    assert.ok(pose.transform([0,0,0])[1]>0);
    assert.ok(Math.abs(pose.transform([0,1.5,0])[1]-1.5)<1e-8);
    assert.equal(openingSymbol(doc,o).flip,true);
    assert.ok(buildModel(doc).boxes.some(b=>b.quaternion));
  }
});
test('resize preview matches preset; manual pivot and fixed panes remain intact',()=>{
  const doc=fixture(false),o=doc.openings[0],before=structuredClone(doc);
  const preview=openingPreview(doc,'O1',{width_mm:900});
  assert.equal(preview.openings[0].operation.pivot_axis,'vertical');assert.deepEqual(doc,before);
  o.operation={...o.operation,axis_mode:'manual',pivot_axis:'vertical',hinge:'end',pivot_ratio:.8};
  assert.deepEqual(applyWindowPreset(doc,o),o.operation);
  o.operation={type:'fixed',hinge:'start',side:'negative',angle_deg:0,axis_mode:'width'};
  assert.deepEqual(applyWindowPreset(doc,o),o.operation);
});
