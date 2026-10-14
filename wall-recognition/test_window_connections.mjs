import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildModel} from './web/model-geometry.mjs';
import {windowCornerConnections,windowSpanLayout,openingSymbol} from './web/opening-operation.mjs';

function fixture(){return {image:{width_px:300,height_px:300},scale_mm_per_px:10,furniture:[],walls:[
  {id:'WH',orientation:'horizontal',start_px:[20,100],end_px:[100,100],thickness_px:10},
  {id:'WV',orientation:'vertical',start_px:[100,100],end_px:[100,200],thickness_px:20}],openings:[
  {id:'H',kind:'window',orientation:'horizontal',start_px:[20,100],end_px:[100,100],thickness_px:10},
  {id:'V',kind:'window',orientation:'vertical',start_px:[100,100],end_px:[100,200],thickness_px:20}]};}
const bounds=b=>({lo:b.center.map((v,i)=>v-b.size[i]/2),hi:b.center.map((v,i)=>v+b.size[i]/2)});
const intersects=(a,b)=>a.lo.every((v,i)=>v<b.hi[i]-1e-8&&a.hi[i]>b.lo[i]+1e-8);

test('perpendicular windows share one fixed corner post; glass never penetrates it',()=>{
  const doc=fixture(),before=JSON.stringify(doc),model=buildModel(doc);
  assert.equal(model.windowConnections.length,1);
  const posts=model.boxes.filter(b=>b.component==='window_corner_frame');assert.equal(posts.length,1);
  assert.deepEqual(posts[0].openingIds,['H','V']);assert.deepEqual(posts[0].size,[.2,1.5,.1]);
  for(const glass of model.boxes.filter(b=>b.kind==='glass'))assert(!intersects(bounds(glass),bounds(posts[0])));
  assert(model.windowFrameMesh.indices.length>0);assert.equal(JSON.stringify(doc),before);
  assert.deepEqual(windowCornerConnections(doc),model.windowConnections);
});

test('sill/header and wall openings are unchanged by window join layout',()=>{
  const doc=fixture(),model=buildModel(doc),before=JSON.stringify(doc);
  for(const o of model.openings){assert.equal(o.bottom,.9);assert.equal(o.top,2.4);assert.deepEqual(o.spans,[[o.a,o.b]]);}
  for(const post of model.boxes.filter(b=>b.component==='window_corner_frame')){
    for(const wall of model.boxes.filter(b=>b.kind==='wall'))assert(!intersects(bounds(post),bounds(wall)));
  }
  assert.equal(JSON.stringify(doc),before);
});

test('mirror, axis rotation and scale changes retain the same shared corner rule',()=>{
  for(const mirror of [false,true])for(const rotate of [false,true])for(const scale of [10,20]){
    const doc=fixture();doc.scale_mm_per_px=scale;
    if(mirror)for(const item of [...doc.walls,...doc.openings]){
      item.start_px[0]=300-item.start_px[0];item.end_px[0]=300-item.end_px[0];
      if(item.orientation==='horizontal')[item.start_px,item.end_px]=[item.end_px,item.start_px];
    }
    if(rotate)for(const item of [...doc.walls,...doc.openings]){
      item.start_px.reverse();item.end_px.reverse();item.orientation=item.orientation==='horizontal'?'vertical':'horizontal';
    }
    const model=buildModel(doc);assert.equal(model.windowConnections.length,1);
    for(const glass of model.boxes.filter(b=>b.kind==='glass'))assert(!intersects(bounds(glass),bounds(model.boxes.find(b=>b.component==='window_corner_frame'))));
  }
});

test('independent side and top pivots preserve stationary frames; 2D and 3D clear leaf widths match',()=>{
  for(const index of [0,1])for(const pivot_axis of ['vertical','horizontal'])for(const side of ['negative','positive']){
    const doc=fixture(),o=doc.openings[index];o.operation={type:'hinged',pivot_axis,hinge:pivot_axis==='horizontal'?'top':'start',pivot_ratio:pivot_axis==='horizontal'?1:0,side,angle_deg:0,axis_mode:'manual'};
    const closed=buildModel(doc),symbol=openingSymbol(doc,o),opening=closed.openings[index],join=closed.windowConnections;
    const layout=windowSpanLayout(opening,...opening.spans[0],join,10),leafWidth=(layout.end-layout.start-2*layout.reveal)*.01;
    const moving=closed.boxes.filter(b=>b.id===o.id&&b.quaternion),glass=moving.find(b=>b.kind==='glass');
    assert(Math.abs(glass.size[0]+moving[0].size[0]*2-leafWidth)<1e-8);
    if(pivot_axis==='horizontal')assert(Math.abs((symbol.hingeEnd[index]-symbol.hingeStart[index])*.01-leafWidth)<1e-8);
    else assert(Math.abs(symbol.length*.01-leafWidth)<1e-8);
    o.operation.angle_deg=45;const opened=buildModel(doc);
    assert.deepEqual(opened.windowFrameMesh,closed.windowFrameMesh);
    assert.deepEqual(opened.wallMesh,closed.wallMesh);
    assert.deepEqual(opened.boxes.filter(b=>b.id===doc.openings[1-index].id),closed.boxes.filter(b=>b.id===doc.openings[1-index].id));
    assert.notDeepEqual(opened.boxes.filter(b=>b.id===o.id&&b.quaternion),moving);
  }
});

test('real gaps, masonry, unknown hints, different heights and excluded/pending windows are not joined',()=>{
  for(const alter of [
    d=>{d.walls[0].end_px[0]=d.openings[0].end_px[0]=89.999;},
    d=>{d.openings[0].end_px[0]=95;},
    d=>{d.walls.push({id:'POST',orientation:'vertical',start_px:[100,95],end_px:[100,105],thickness_px:4});},
    d=>{d.walls[0].opening_hints=[{start_px:[95,100],end_px:[100,100]}];},
    d=>{d.openings[1].dimensions_mm={height_mm:1200,sill_height_mm:900};},
    d=>{d.openings[1].review_status='rejected';},
    d=>{d.openings[1].requires_confirmation=true;},
    d=>{d.openings.push({id:'UNKNOWN',kind:'unclassified',orientation:'vertical',start_px:[100,100],end_px:[100,105],thickness_px:20,requires_confirmation:true});},
    d=>{d.openings[1].kind='door';},
    d=>{d.openings.push({...structuredClone(d.openings[1]),id:'AMBIGUOUS'});},
    d=>{d.openings[0].dimensions_mm={width_mm:400};}
  ]){const doc=fixture();alter(doc);assert.equal(buildModel(doc).windowConnections.length,0);}
});

test('a continuous window run can share both corner ends without duplicate posts',()=>{
  const doc=fixture();doc.walls.push({id:'WL',orientation:'vertical',start_px:[20,100],end_px:[20,200],thickness_px:10});
  doc.openings.push({id:'L',kind:'window',orientation:'vertical',start_px:[20,100],end_px:[20,200],thickness_px:10});
  const model=buildModel(doc);assert.equal(model.windowConnections.length,2);
  const layout=windowSpanLayout(model.openings[0],20,100,model.windowConnections,10);
  assert.equal(layout.start,25);assert.equal(layout.end,90);
  assert.equal(model.boxes.filter(b=>b.component==='window_corner_frame').length,2);
});
