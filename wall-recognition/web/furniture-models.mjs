// Local procedural models. Footprints use source pixels; vertical dimensions use mm.
export const FURNITURE_DEFAULTS = Object.freeze({
  bed:[1000,'#b69c84'],sofa:[850,'#879d97'],chair:[850,'#b49b7c'],table:[750,'#c6b294'],
  dining_table:[750,'#c6b294'],coffee_table:[400,'#bca58a'],cabinet:[2000,'#c4b49c'],
  shoe_cabinet:[1100,'#c4b49c'],tv_console:[500,'#a9957c'],kitchen_cabinet:[850,'#c2c9bf'],
  kitchen_sink:[860,'#c3ccc8'],cooktop:[900,'#474c50'],refrigerator:[1800,'#cbd3d4'],
  vanity:[800,'#b4bcb2'],toilet:[650,'#f1f3f1'],bathtub:[550,'#f1f3f1'],shower:[2100,'#91b6bb']
});
export function furnitureSettings(item) {
  const defaults=FURNITURE_DEFAULTS[item.kind];
  return defaults?{height_mm:defaults[0],color:defaults[1],elevation_mm:0,rotation_deg:0,...item.model_3d}:null;
}
export function furniturePreview(doc,id,placement,options) {
  const s=doc.scale_mm_per_px,[x,y,w,d]=['center_x_mm','center_y_mm','width_mm','depth_mm'].map(k=>placement[k]/s);
  return {...doc,furniture:doc.furniture.map(f=>f.id===id?{...f,bbox_px:[x-w/2,y-d/2,x+w/2,y+d/2],model_3d:options}:f)};
}
export function buildFurniture(doc) {
  const pieces=[],unit=doc.scale_mm_per_px/1000;
  for(const f of doc.furniture||[]) {
    const settings=furnitureSettings(f);
    if(!settings||f.review_status==='rejected')continue;
    const [x0,z0,x1,z1]=f.bbox_px,base=f.rotation_deg??0,quarter=base/90;
    const width=(quarter%2?z1-z0:x1-x0)*unit,depth=(quarter%2?x1-x0:z1-z0)*unit;
    const cx=((x0+x1-doc.image.width_px)/2)*unit,cz=((z0+z1-doc.image.height_px)/2)*unit;
    const angle=(base+settings.rotation_deg)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
    const h=settings.height_mm/1000,e=settings.elevation_mm/1000,color=settings.color;
    const add=(x,z,w,d,lo,hi,tint=color,shape='box',opacity=1)=>{
      const px=(x+w/2-.5)*width,pz=(z+d/2-.5)*depth;
      pieces.push({id:f.id,kind:'furniture',part:pieces.length,shape,color:tint,opacity,
        size:[w*width,(hi-lo)*h,d*depth],center:[cx+c*px-s*pz,e+(lo+hi)/2*h,cz+s*px+c*pz],rotation_y:-angle});
    };
    const legs=(top=.25)=>{for(const x of [.07,.86])for(const z of [.07,.86])add(x,z,.07,.07,0,top,'#655b4f');};
    const handles=(count=2,y=.52)=>{for(let i=0;i<count;i++)add((i+.5)/count-.014,.94,.028,.028,y,y+.10,'#666f70');};
    if(f.kind==='bed') {
      legs(.14);add(0,0,1,1,.12,.32);add(.025,.04,.95,.94,.32,.55,'#eeeae4');
      add(0,0,1,.055,.15,1);add(.035,.015,.93,.045,.6,.95,'#cdb9a5');
      for(const x of [.07,.53])add(x,.12,.4,.19,.55,.64,'#faf8f2','ellipsoid');
      add(.035,.38,.93,.57,.55,.59,'#8eaaa7');add(.035,.8,.93,.14,.59,.61,'#c7d7cd');
    } else if(f.kind==='sofa'||f.kind==='chair') {
      legs(.22);add(.04,.04,.92,.9,.2,.45);add(.03,0,.94,.16,.38,1);
      if(f.kind==='sofa'){add(0,.04,.1,.92,.28,.8);add(.9,.04,.1,.92,.28,.8);}
      const n=f.kind==='chair'?1:width>2?3:2;
      for(let i=0;i<n;i++){add(.11+i*.78/n,.19,.75/n,.72,.45,.57,'#c0cec6');add(.11+i*.78/n,.14,.75/n,.13,.59,.9,color);}
    } else if(['table','dining_table','coffee_table'].includes(f.kind)) {
      legs(.91);add(0,0,1,1,.9,1);add(.08,.08,.84,.84,.8,.9,'#8e7b64');
    } else if(['cabinet','shoe_cabinet','tv_console','kitchen_cabinet','refrigerator'].includes(f.kind)) {
      add(.035,.035,.93,.9,0,.07,'#6d706a');add(0,0,1,.94,.07,1);
      if(f.kind==='refrigerator') {add(.02,.94,.96,.06,.08,.68,'#dce2e0');add(.02,.94,.96,.06,.7,.99,'#dce2e0');handles(1,.52);handles(1,.78);}
      else {const n=Math.max(2,Math.min(4,Math.round(width/.6)));for(let i=0;i<n;i++)add(i/n+.012,.94,1/n-.024,.06,.1,.94,'#e1d8c8');handles(n);}
    } else if(f.kind==='kitchen_sink'||f.kind==='vanity') {
      add(0,0,1,1,0,.87);add(0,0,1,.22,.87,.94,'#eef0ea');add(0,.84,1,.16,.87,.94,'#eef0ea');
      add(0,.22,.13,.62,.87,.94,'#eef0ea');add(.87,.22,.13,.62,.87,.94,'#eef0ea');
      add(.13,.22,.74,.62,.72,.74,'#8fa6a8');add(.45,.1,.035,.05,.94,1,'#718a8e','cylinder');
      add(.45,.1,.035,.22,.975,1,'#718a8e');handles();
    } else if(f.kind==='cooktop') {
      add(0,0,1,1,.95,1);for(const x of [.12,.59])for(const z of [.12,.59]){add(x,z,.28,.28,.98,.99,'#909b9a','cylinder');add(x+.04,z+.04,.2,.2,.99,1,'#292f32','cylinder');}
    } else if(f.kind==='toilet') {
      add(.24,.25,.52,.62,0,.55,color,'ellipsoid');add(.08,.28,.84,.67,.35,.72,color,'ellipsoid');
      add(.18,.34,.64,.55,.70,.75,'#bbcaca','ellipsoid');add(.1,.3,.8,.64,.70,.78,color,'ring');
      add(.08,0,.84,.25,.05,.95);add(.06,0,.88,.27,.95,1,'#ffffff');
    } else if(f.kind==='bathtub') {
      add(.04,.04,.92,.92,0,.18,'#ccd6d2');add(0,0,1,.12,.08,1);add(0,.88,1,.12,.08,1);
      add(0,.12,.1,.76,.08,1);add(.9,.12,.1,.76,.08,1);add(.13,.16,.74,.68,.18,.22,'#c7dbd8');
      add(.45,.03,.1,.17,.85,1,'#829996');
    } else if(f.kind==='shower') {
      add(0,0,1,1,0,.035,'#e7e8df');add(0,0,1,.025,.035,1,color,'box',.25);
      add(0,0,.025,1,.035,1,color,'box',.25);add(.97,0,.03,1,.035,1,color,'box',.25);
      add(.47,.08,.025,.025,.25,.91,'#687d83','cylinder');add(.36,.07,.24,.24,.9,.925,'#bbc9c9','cylinder');
    }
  }
  return pieces;
}
