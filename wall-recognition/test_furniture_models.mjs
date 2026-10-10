import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildFurniture,furnitureSettings,FURNITURE_DEFAULTS,furniturePreview} from './web/furniture-models.mjs';
import {buildModel} from './web/model-geometry.mjs';
const fixture=(kind='bed')=>({image:{width_px:1000,height_px:800},scale_mm_per_px:10,walls:[],openings:[],furniture:[{id:'F1',kind,bbox_px:[300,200,500,400],rotation_deg:0}]});

test('fit turns rebuild every class inside the same non-square box at every source heading',()=>{
  for(const kind of Object.keys(FURNITURE_DEFAULTS))for(const base of [0,90,180,270]){
    const doc=fixture(kind),f=doc.furniture[0];f.bbox_px=[300,200,370,310];f.rotation_deg=base;
    for(const fit of [0,90,180,270]){
      f.model_3d={fit_rotation_deg:fit};const parts=buildFurniture(doc);
      for(const p of parts){
        const c=Math.abs(Math.cos(p.rotation_y)),s=Math.abs(Math.sin(p.rotation_y));
        const rx=(c*p.size[0]+s*p.size[2])/2,rz=(s*p.size[0]+c*p.size[2])/2;
        assert(p.center[0]-rx>=-2-1e-8&&p.center[0]+rx<=-1.3+1e-8,`${kind} ${base} ${fit} X`);
        assert(p.center[2]-rz>=-2-1e-8&&p.center[2]+rz<=-.9+1e-8,`${kind} ${base} ${fit} Z`);
      }
    }
  }
});
test('fit changes toilet local proportions; subsequent free rotation retains that model size',()=>{
  const doc=fixture('toilet'),f=doc.furniture[0];f.bbox_px=[300,200,370,310];
  const original=buildFurniture(doc);f.model_3d={fit_rotation_deg:90};const fitted=buildFurniture(doc);
  assert.equal(fitted[0].size[0],original[0].size[0]*110/70);
  assert(Math.abs(fitted[0].size[2]-original[0].size[2]*70/110)<1e-9);
  f.model_3d.rotation_deg=90;const free=buildFurniture(doc);
  for(let i=0;i<free.length;i++)assert.deepEqual(free[i].size,fitted[i].size);
  f.model_3d={fit_rotation_deg:0};assert.deepEqual(buildFurniture(doc),original);
});
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
test('whole-object rotation applies consistently to every supported furniture and fixture class',()=>{
  for(const kind of Object.keys(FURNITURE_DEFAULTS)){
    const doc=fixture(kind);doc.furniture[0].bbox_px=[300,200,500,300];
    const before=buildFurniture(doc);doc.furniture[0].model_3d={rotation_deg:90};const after=buildFurniture(doc);
    const cx=-1,cz=-1.5;
    for(let i=0;i<before.length;i++){
      assert(Math.abs(after[i].center[0]-cx+(before[i].center[2]-cz))<1e-9,kind);
      assert(Math.abs(after[i].center[2]-cz-(before[i].center[0]-cx))<1e-9,kind);
    }
  }
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
  for(const kind of ['unclassified','unclassified_area','water_feature'])assert.deepEqual(buildFurniture(fixture(kind)),[]);
  doc.furniture[0].review_status='rejected';assert.deepEqual(buildFurniture(doc),[]);
  doc.furniture[0].review_status='confirmed';doc.model_settings={show_furniture:false};assert.equal(buildModel(doc).furnitureCount,0);
});
test('old wet areas render directly as showers; bath and shower keep distinct components',()=>{
  const wet=fixture('wet_area');wet.furniture[0].review_status='unreviewed';
  assert.deepEqual(buildFurniture(wet),buildFurniture(fixture('shower')));
  assert(buildFurniture(wet).some(p=>p.part_role==='shower-head'));
  const bath=buildFurniture(fixture('bathtub'));
  assert(bath.some(p=>p.part_role==='tub-rim'&&p.shape==='ring'));
  assert(!bath.some(p=>p.part_role==='shower-head'));
  wet.furniture[0].review_status='rejected';assert.deepEqual(buildFurniture(wet),[]);
});
test('shower hardware retains physical size as footprint, height and scale change',()=>{
  const doc=fixture('shower'),before=buildFurniture(doc);
  doc.furniture[0].bbox_px=[250,180,600,270];doc.furniture[0].model_3d={height_mm:2600};
  doc.scale_mm_per_px=17;
  const after=buildFurniture(doc);
  for(const role of ['shower-head','shower-head-face','shower-riser','shower-arm','shower-mixer']){
    const a=before.find(p=>p.part_role===role),b=after.find(p=>p.part_role===role);
    a.size.forEach((v,i)=>assert(Math.abs(v-b.size[i])<1e-9,role));
  }
  assert.deepEqual(after.find(p=>p.part_role==='shower-tray').size,[5.95,.04,1.53]);
  assert(Math.abs(after.find(p=>p.part_role==='shower-head').size[0]-.20)<1e-9);
  doc.furniture[0].model_3d.height_mm=1000;
  const low=buildFurniture(doc);
  for(const role of ['shower-head','shower-riser','shower-arm','shower-mixer']){
    const a=before.find(p=>p.part_role===role),b=low.find(p=>p.part_role===role);
    a.size.forEach((v,i)=>assert(Math.abs(v-b.size[i])<1e-9,role));
    assert(b.center[1]-b.size[1]/2>=0,role);
  }
});
test('cabinet doors and handles use the long edge in either footprint orientation',()=>{
  for(const kind of ['cabinet','shoe_cabinet','tv_console','kitchen_cabinet']){
    for(const [w,d] of [[240,50],[50,240],[100,100]]){
      const doc=fixture(kind);doc.furniture[0].bbox_px=[300,200,300+w,200+d];
      const original=JSON.stringify(doc),parts=buildFurniture(doc);
      const doors=parts.filter(p=>p.part_role==='cabinet-door'),handles=parts.filter(p=>p.part_role==='cabinet-handle');
      assert.equal(doors.length,w===d?2:4);assert.equal(handles.length,doors.length);
      const shortAxis=d>w?0:2,longAxis=2-shortAxis;
      const center=shortAxis===0?(300+w/2-500)*.01:(200+d/2-400)*.01;
      const thickness=Math.min(w,d)*.01;
      for(const p of [...doors,...handles]){
        assert(p.center[shortAxis]>center+thickness*.43,kind);
      }
      for(const p of doors)assert(p.size[longAxis]>p.size[shortAxis],kind);
      assert.equal(JSON.stringify(doc),original);
    }
  }
});
