// Image-space axis alignment. Rotated furniture uses its projected footprint.
export function footprint(item){
  const [x0,y0,x1,y1]=item.bbox_px,x=(x0+x1)/2,y=(y0+y1)/2,w=x1-x0,d=y1-y0;
  const a=(item.model_3d?.rotation_deg||0)*Math.PI/180;
  const rx=(Math.abs(Math.cos(a))*w+Math.abs(Math.sin(a))*d)/2;
  const ry=(Math.abs(Math.sin(a))*w+Math.abs(Math.cos(a))*d)/2;
  return [x-rx,y-ry,x+rx,y+ry];
}
export function snapFurniture(doc,item,{threshold=8,enabled=true,excludeId=item.id}={}){
  const box=footprint(item),center=[(box[0]+box[2])/2,(box[1]+box[3])/2],offset=[0,0],guides=[];
  const walls=(doc.solid_wall_segments??doc.walls.flatMap(w=>w.solid_parts??[w])).filter(w=>w.review_status!=='rejected');
  const targets=[...walls.map(w=>({id:w.id,box:w.bbox_px,wall:true})),
    ...(doc.furniture||[]).filter(f=>f.id!==excludeId&&f.review_status!=='rejected'&&!['unclassified_area','water_feature','unclassified'].includes(f.kind)).map(f=>({id:f.id,box:footprint(f)}))];
  if(enabled)for(const axis of [0,1]){
    let best=null;
    for(const target of targets){
      const b=target.box,other=1-axis;
      if(!b)continue;
      // Walls attract only when the furniture projects onto that wall segment.
      if(target.wall&&Math.min(box[other+2],b[other+2])-Math.max(box[other],b[other])<=0)continue;
      const own=target.wall?[box[axis],box[axis+2]]:[box[axis],center[axis],box[axis+2]];
      const refs=target.wall?[b[axis],b[axis+2]]:[b[axis],(b[axis]+b[axis+2])/2,b[axis+2]];
      for(const from of own)for(const to of refs){
        const delta=to-from;
        // A wall face must leave the footprint outside the wall, not inside it.
        if(target.wall&&!(Math.abs(from-box[axis+2])<1e-7&&to===b[axis]||Math.abs(from-box[axis])<1e-7&&to===b[axis+2]))continue;
        if(Math.abs(delta)<=threshold&&(!best||Math.abs(delta)<Math.abs(best.delta)))best={delta,to,target};
      }
    }
    if(best){offset[axis]=best.delta;guides.push({axis,value:best.to,target:best.target.id});}
  }
  let preview={...item,bbox_px:item.bbox_px.map((v,i)=>v+offset[i%2])};
  // Reject snapping that would put either the source box or rotated footprint outside the image.
  const rotated=footprint(preview),source=preview.bbox_px;
  for(const axis of [0,1])if(Math.min(rotated[axis],source[axis])<0||Math.max(rotated[axis+2],source[axis+2])>doc.image[axis?'height_px':'width_px']){
    offset[axis]=0;guides.splice(0,guides.length,...guides.filter(g=>g.axis!==axis));
  }
  preview={...item,bbox_px:item.bbox_px.map((v,i)=>v+offset[i%2])};
  const moved=footprint(preview),gaps=[];
  for(const axis of [0,1])for(const side of [-1,1]){
    let nearest=null;
    for(const target of targets){
      const b=target.box,other=1-axis;if(!b||Math.min(moved[other+2],b[other+2])-Math.max(moved[other],b[other])<=0)continue;
      const from=moved[axis+(side>0?2:0)],to=b[axis+(side>0?0:2)],distance=(to-from)*side;
      if(distance>=-1e-7&&(!nearest||distance<nearest.distance))nearest={axis,from,to,distance:Math.max(0,distance),cross:(Math.max(moved[other],b[other])+Math.min(moved[other+2],b[other+2]))/2,target:target.id};
    }
    if(nearest)gaps.push(nearest);
  }
  return {item:preview,guides,gaps};
}
