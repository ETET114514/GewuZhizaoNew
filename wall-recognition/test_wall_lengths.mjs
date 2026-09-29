import {test} from 'node:test';
import assert from 'node:assert/strict';
import {wallDimensions,formatWallLength} from './web/wall-lengths.mjs';

function wall(id,axis,a,b,c){return {id,orientation:axis===0?'horizontal':'vertical',start_px:axis===0?[a,c]:[c,a],end_px:axis===0?[b,c]:[c,b],thickness_px:10};}
const doc=walls=>({scale_mm_per_px:20,walls});
const total=dimensions=>dimensions.reduce((sum,d)=>sum+d.length_mm,0);

test('merges overlapping collinear axes, does not bridge a real gap or merge parallel walls',()=>{
  const input=doc([wall('A',0,0,100,50),wall('B',0,80,160,50),wall('C',0,160,300,50),wall('D',0,301,400,50),wall('E',0,0,300,60)]);
  const dims=wallDimensions(input,{splitCorners:false});
  assert.deepEqual(dims.map(d=>d.length_mm),[6000,1980,6000]);
  assert.deepEqual(dims[0].wall_ids,['A','B','C']);
});

test('T and cross intersections split axis lengths without changing the document or total',()=>{
  const input=doc([wall('A',0,0,300,100),wall('B',1,100,250,100),wall('C',1,0,250,200)]),before=structuredClone(input);
  const whole=wallDimensions(input,{splitCorners:false}),parts=wallDimensions(input);
  assert.equal(whole.length,3);assert.equal(parts.length,6);
  assert.deepEqual(parts.filter(d=>d.axis===0).map(d=>d.length_mm),[2000,2000,2000]);
  assert.equal(total(parts),total(whole));assert.deepEqual(input,before);
});

test('L corner retains separate directions; face-touching T splits but a nearby unconnected wall does not',()=>{
  const base=wall('A',0,0,300,100);
  assert.equal(wallDimensions(doc([base,wall('L',1,100,200,300)])).length,2);
  assert.equal(wallDimensions(doc([base,wall('T',1,105,200,150)])).length,3);
  assert.equal(wallDimensions(doc([base,wall('gap',1,106,200,150)])).length,2);
});

test('opening widths stay included; no junction is invented in the middle of an opening',()=>{
  const base=wall('A',0,0,300,100);base.solid_parts=[wall('A1',0,0,100,100),wall('A2',0,200,300,100)];
  const input=doc([base,wall('B',1,105,200,150)]);
  const dims=wallDimensions(input);
  assert.equal(dims.filter(d=>d.axis===0).length,1);assert.equal(dims[0].length_mm,6000);
});

test('opening-only connector joins a real run, rejected and standalone empty axes are ignored',()=>{
  const gap={...wall('door',0,100,200,100),solid_parts:[]};
  const rejected={...wall('bad',1,0,200,150),review_status:'rejected'};
  const input=doc([wall('A',0,0,100,100),gap,wall('B',0,200,300,100),rejected,{...wall('empty',0,0,300,200),solid_parts:[]}]);
  const dims=wallDimensions(input);assert.equal(dims.length,1);assert.equal(dims[0].length_mm,6000);
});

test('missing scale produces no real-world dimensions; recalibration and edits update lengths',()=>{
  const input=doc([wall('A',0,0,300,100)]);
  assert.equal(wallDimensions(input)[0].length_mm,6000);
  input.scale_mm_per_px=10;assert.equal(wallDimensions(input)[0].length_mm,3000);
  input.walls[0].end_px[0]=400;assert.equal(wallDimensions(input)[0].length_mm,4000);
  for(const scale of [null,0,-1,NaN,Infinity,'20'])assert.deepEqual(wallDimensions({...input,scale_mm_per_px:scale}),[]);
});

test('formats metres to millimetre precision without suggesting zero length',()=>{
  assert.equal(formatWallLength(6000),'6 m');assert.equal(formatWallLength(1234),'1.234 m');
  assert.equal(formatWallLength(.1),'<0.001 m');
});
