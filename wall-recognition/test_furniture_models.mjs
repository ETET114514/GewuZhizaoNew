import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildFurniture,furnitureSettings,FURNITURE_DEFAULTS,furniturePreview} from './web/furniture-models.mjs';
import {buildModel} from './web/model-geometry.mjs';
const fixture=(kind='bed')=>({image:{width_px:1000,height_px:800},scale_mm_per_px:10,walls:[],openings:[],furniture:[{id:'F1',kind,bbox_px:[300,200,500,400],rotation_deg:0}]});
test('all known classes have multiple structural parts bounded by their edited height',()=>{
  for(const kind of Object.keys(FURNITURE_DEFAULTS)){
    const doc=fixture(kind);doc.furniture[0].model_3d={height_mm:1700,elevation_mm:200};
    const parts=buildFurniture(doc);assert(parts.length>=4,kind);
    for(const p of parts){assert(p.size.every(v=>v>0&&Number.isFinite(v)),kind);assert(p.center[1]-p.size[1]/2>=.2-1e-9,kind);assert(p.center[1]+p.size[1]/2<=1.9+1e-9,kind);}
  }
});
test('orientation and arbitrary extra rotation transform the complete model around its center',()=>{
  const doc=fixture();doc.furniture[0].bbox_px=[300,200,400,400];
  const a=buildFurniture(doc);doc.furniture[0].model_3d={rotation_deg:90};const b=buildFurniture(doc);
  const cx=-1.5,cz=-1;
  for(let i=0;i<a.length;i++){assert(Math.abs(b[i].center[0]-cx+(a[i].center[2]-cz))<1e-9);assert(Math.abs(b[i].center[2]-cz-(a[i].center[0]-cx))<1e-9);}
  doc.furniture[0].rotation_deg=90;const c=buildFurniture(doc);assert(c.some(p=>p.rotation_y===-Math.PI));
});
test('preview changes only selected furniture, recalibration scales footprint but not height',()=>{
  const doc=fixture(),before=JSON.stringify(doc);
  const preview=furniturePreview(doc,'F1',{center_x_mm:5000,center_y_mm:4000,width_mm:1200,depth_mm:2000},{height_mm:900,color:'#123456'});
  assert.deepEqual(preview.furniture[0].bbox_px,[440,300,560,500]);assert.equal(JSON.stringify(doc),before);
  const first=buildFurniture(preview);preview.scale_mm_per_px=20;const next=buildFurniture(preview);
  for(let i=0;i<first.length;i++){assert.equal(next[i].size[0],first[i].size[0]*2);assert.equal(next[i].size[1],first[i].size[1]);}
  assert(first.some(p=>p.color==='#123456'));
});
test('unknown, pending and rejected furniture stays omitted; old documents get defaults',()=>{
  const doc=fixture();assert.equal(furnitureSettings(doc.furniture[0]).height_mm,1000);
  for(const kind of ['unclassified','unclassified_area','wet_area','water_feature'])assert.deepEqual(buildFurniture(fixture(kind)),[]);
  doc.furniture[0].review_status='rejected';assert.deepEqual(buildFurniture(doc),[]);
  doc.furniture[0].review_status='confirmed';doc.model_settings={show_furniture:false};assert.equal(buildModel(doc).furnitureCount,0);
});
