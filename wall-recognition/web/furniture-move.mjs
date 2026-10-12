// Ground-plane movement in mm. Keep the rotated footprint inside the source image.
export function movePlacement(doc, item, centerX, centerY) {
  const scale=doc.scale_mm_per_px,box=item.bbox_px;
  if(!Number.isFinite(scale)||scale<=0||![centerX,centerY,...box].every(Number.isFinite))return null;
  const width=(box[2]-box[0])*scale,depth=(box[3]-box[1])*scale;
  const angle=(item.model_3d?.rotation_deg||0)*Math.PI/180;
  // The API requires both the source box and its rotated footprint to fit.
  const rx=Math.max(width/2,(Math.abs(Math.cos(angle))*width+Math.abs(Math.sin(angle))*depth)/2);
  const ry=Math.max(depth/2,(Math.abs(Math.sin(angle))*width+Math.abs(Math.cos(angle))*depth)/2);
  const limitX=doc.image.width_px*scale,limitY=doc.image.height_px*scale;
  if(width<=0||depth<=0||2*rx>limitX+1e-7||2*ry>limitY+1e-7)return null;
  const clamp=(value,half,limit)=>Math.max(half,Math.min(limit-half,Math.round(value*10)/10));
  return {center_x_mm:clamp(centerX,rx,limitX),center_y_mm:clamp(centerY,ry,limitY),width_mm:width,depth_mm:depth};
}

// Editable starting footprints in mm; these are presets, not detected dimensions.
export const PLACEMENT_PRESETS=Object.freeze({
  bed:[1800,2000],sofa:[2200,900],table:[1200,800],chair:[500,500],cabinet:[1200,600],
  coffee_table:[1000,600],dining_table:[1600,800],shoe_cabinet:[1000,350],tv_console:[1800,400],
  kitchen_cabinet:[1200,600],kitchen_sink:[800,600],cooktop:[750,500],refrigerator:[700,700],
  vanity:[900,550],toilet:[400,700],bathtub:[800,1700],shower:[900,900]
});
export function placementOf(doc,item) {
  const scale=doc.scale_mm_per_px,[x0,y0,x1,y1]=item.bbox_px;
  return {center_x_mm:(x0+x1)/2*scale,center_y_mm:(y0+y1)/2*scale,width_mm:(x1-x0)*scale,depth_mm:(y1-y0)*scale};
}
export function canCopyFurniture(item) {
  return Boolean(item?.id && item.review_status!=='rejected' &&
    (Object.hasOwn(PLACEMENT_PRESETS,item.kind)||item.kind==='wet_area'));
}
// Translate the original box without changing dimensions, even without scale.
export function copyFurnitureAt(doc,item,x,y) {
  const b=item.bbox_px,w=b[2]-b[0],d=b[3]-b[1],limitX=doc.image.width_px,limitY=doc.image.height_px;
  if(!canCopyFurniture(item)||![x,y,...b].every(Number.isFinite)||w<=0||d<=0||x<0||y<0||x>limitX||y>limitY)return null;
  const a=(item.model_3d?.rotation_deg||0)*Math.PI/180;
  const rx=Math.max(w/2,(Math.abs(Math.cos(a))*w+Math.abs(Math.sin(a))*d)/2);
  const ry=Math.max(d/2,(Math.abs(Math.sin(a))*w+Math.abs(Math.cos(a))*d)/2);
  if(2*rx>limitX+1e-7||2*ry>limitY+1e-7)return null;
  const cx=Math.max(rx,Math.min(limitX-rx,x)),cy=Math.max(ry,Math.min(limitY-ry,y));
  const preview={...structuredClone(item),id:'待复制',bbox_px:[cx-w/2,cy-d/2,cx+w/2,cy+d/2]};
  validateFurnitureRotation(doc,preview.bbox_px,item.model_3d?.rotation_deg||0);
  return preview;
}
export function placementBox(doc,p,rotation=0) {
  const scale=doc.scale_mm_per_px;
  if(!Number.isFinite(scale)||scale<=0)throw new Error('请先标定比例，再使用厘米尺寸。');
  const {center_x_mm:x,center_y_mm:y,width_mm:w,depth_mm:d}=p;
  if(![x,y,w,d,rotation].every(Number.isFinite))throw new Error('请填写有效的位置与尺寸。');
  if(w<20||w>50000||d<20||d>50000)throw new Error('占地尺寸需在 2～5000 cm 之间。');
  const theta=rotation*Math.PI/180,rx=Math.max(w/2,(Math.abs(Math.cos(theta))*w+Math.abs(Math.sin(theta))*d)/2);
  const ry=Math.max(d/2,(Math.abs(Math.sin(theta))*w+Math.abs(Math.cos(theta))*d)/2);
  if(x-rx<-1e-7||y-ry<-1e-7||x+rx>doc.image.width_px*scale+1e-7||y+ry>doc.image.height_px*scale+1e-7)throw new Error('家具超出底图，请调整中心位置或尺寸。');
  return [(x-w/2)/scale,(y-d/2)/scale,(x+w/2)/scale,(y+d/2)/scale];
}
export function presetPlacement(doc,kind,x,y) {
  const size=PLACEMENT_PRESETS[kind],scale=doc.scale_mm_per_px;
  if(!size||!Number.isFinite(scale)||scale<=0)return null;
  return movePlacement(doc,{bbox_px:[0,0,size[0]/scale,size[1]/scale]},x*scale,y*scale);
}
export function placementFromCm(values,baseline={}) {
  const result={};
  for(const key of ['center_x_mm','center_y_mm','width_mm','depth_mm']) {
    const value=values[key];
    if(value==null||String(value).trim()===''||!Number.isFinite(Number(value)))throw new Error('请完整填写家具位置与占地尺寸。');
    const original=baseline[key];
    // Do not round untouched legacy dimensions when applying another field.
    result[key]=Number.isFinite(original)&&Number(value)===Number((original/10).toFixed(3))?original:Number(value)*10;
  }
  return result;
}

export function validateFurnitureRotation(doc,box,angle) {
  if(!Number.isFinite(angle)||angle<0||angle>360)throw new Error('旋转角度需在 0～360° 之间。');
  const [x0,y0,x1,y1]=box,w=x1-x0,d=y1-y0,x=(x0+x1)/2,y=(y0+y1)/2;
  if(!box.every(Number.isFinite)||w<=0||d<=0)throw new Error('请填写有效的家具占地。');
  const theta=angle*Math.PI/180,rx=Math.max(w/2,(Math.abs(Math.cos(theta))*w+Math.abs(Math.sin(theta))*d)/2),ry=Math.max(d/2,(Math.abs(Math.sin(theta))*w+Math.abs(Math.cos(theta))*d)/2);
  if(x-rx<-1e-7||y-ry<-1e-7||x+rx>doc.image.width_px+1e-7||y+ry>doc.image.height_px+1e-7)throw new Error('旋转后的家具超出底图，请先向内移动家具或调整尺寸。');
}
export function turnFurniture(doc,item,delta) {
  const angle=((item.model_3d?.rotation_deg||0)+delta)%360;
  const normalized=(angle+360)%360;
  validateFurnitureRotation(doc,item.bbox_px,normalized);
  return {...item,model_3d:{...item.model_3d,rotation_deg:normalized}};
}
export function fitTurnFurniture(doc,item,delta) {
  const free=item.model_3d?.rotation_deg||0,fit=item.model_3d?.fit_rotation_deg||0;
  if(![free,fit,delta].every(Number.isFinite)||free%90||fit%90||![90,-90].includes(delta))
    throw new Error('框内旋转支持左右 90°；请先将自由旋转角度调整为 90° 的整数倍。');
  const angle=((fit+free+delta)%360+360)%360;
  // Absorb existing quarter free turns, restoring the unrotated source box.
  validateFurnitureRotation(doc,item.bbox_px,0);
  return {...item,model_3d:{...item.model_3d,fit_rotation_deg:angle,rotation_deg:0}};
}
