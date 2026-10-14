// Offline analysis only: export the model's repaired wall footprint at wall top.
import fs from 'node:fs';
import {buildModel} from '../../web/model-geometry.mjs';
const doc=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const model=buildModel(doc,{buildMeshes:false});
const scale=doc.scale_mm_per_px;
const W=doc.image.width_px,H=doc.image.height_px;
const boxes=model.boxes.filter(b=>b.kind==='wall'&&b.center[1]+b.size[1]/2>=model.height-.0001);
const rects=boxes.map(b=>[
  (b.center[0]-b.size[0]/2)*1000/scale+W/2,
  (b.center[2]-b.size[2]/2)*1000/scale+H/2,
  (b.center[0]+b.size[0]/2)*1000/scale+W/2,
  (b.center[2]+b.size[2]/2)*1000/scale+H/2,
].map(v=>Math.round(v*10000)/10000));
fs.writeFileSync(process.argv[3],JSON.stringify({rects,height_mm:model.height*1000},null,2));
