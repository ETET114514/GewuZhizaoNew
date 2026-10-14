import {test} from 'node:test';
import assert from 'node:assert/strict';
import {newOpeningPreview} from './web/opening-edit.mjs';
import {buildModel} from './web/model-geometry.mjs';
const doc={image:{width_px:500,height_px:500},scale_mm_per_px:10,walls:[{id:'W1',orientation:'horizontal',start_px:[20,30],end_px:[480,30],bbox_px:[20,20,480,40],length_px:460,thickness_px:20}],openings:[],furniture:[]};
test('entry preview owns 1200x2100 opening and distinct model, moving details share leaf transform',()=>{
  const preview=newOpeningPreview(doc,'W1','door',{width_mm:1200,height_mm:2100,sill_height_mm:0},250,'entry');
  assert.equal(preview.openings[0].door_model,'entry');assert.equal(doc.openings.length,0);
  const closed=buildModel(preview),parts=closed.boxes.filter(b=>b.kind==='door');
  assert.equal(parts[0].size[0],1.1);assert.equal(parts[0].size[2],.06);
  for(const name of ['entry_panel','entry_handle','entry_viewer'])assert(parts.some(b=>b.component===name));
  preview.openings[0].operation={...preview.openings[0].operation,angle_deg:90,pivot_axis:'vertical',pivot_ratio:0};
  const opened=buildModel(preview).boxes.filter(b=>b.kind==='door');
  assert(opened.every(b=>JSON.stringify(b.quaternion)===JSON.stringify(opened[0].quaternion)));
  const standard=newOpeningPreview(doc,'W1','door',{width_mm:1200,height_mm:2100,sill_height_mm:0},250,'standard');
  assert.equal(buildModel(standard).boxes.filter(b=>b.kind==='door').length,1);
});
