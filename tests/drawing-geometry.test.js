import test from 'node:test';
import assert from 'node:assert/strict';
import {simplifyDrawnPoints,normalizeDrawnPath,elementLocalPoint,elementWorldPoint,reboxFreeform,nearestPathSegment} from '../src/drawing-geometry.js';
test('freehand simplification keeps endpoints and deliberate corners while bounding stored points',()=>{
  const line=Array.from({length:2000},(_,i)=>({x:i/10,y:0}));assert.deepEqual(simplifyDrawnPoints(line),[line[0],line.at(-1)]);
  const corner=[{x:0,y:0},{x:10,y:0},{x:20,y:0},{x:20,y:10},{x:20,y:20}];assert.deepEqual(simplifyDrawnPoints(corner),[corner[0],corner[2],corner[4]]);
  const zigzag=Array.from({length:2000},(_,i)=>({x:i,y:i%2*10})),simple=simplifyDrawnPoints(zigzag,0,512);assert.equal(simple.length,512);assert.deepEqual(simple[0],zigzag[0]);assert.deepEqual(simple.at(-1),zigzag.at(-1));
});
test('drawn horizontal and vertical strokes normalize without zero-sized geometry or source mutation',()=>{
  const input=[{x:20,y:50},{x:80,y:50}],result=normalizeDrawnPath(input);assert.deepEqual(result,{geometry:{x:20,y:50,width:60,height:1},path:{closed:false,points:[{x:0,y:0},{x:1,y:0}]}});assert.deepEqual(input,[{x:20,y:50},{x:80,y:50}]);
  assert.equal(normalizeDrawnPath([{x:7,y:2},{x:7,y:99}]).geometry.width,1);
});
test('rotated freeform reboxing keeps untouched vertices at their original world positions',()=>{
  const element={geometry:{x:100,y:200,width:80,height:60},rotation:37,path:{closed:true,points:[{x:0,y:0},{x:1,y:0},{x:1,y:1}]}};
  const points=element.path.points.map(p=>({x:p.x*80,y:p.y*60})),old=points.map(p=>elementWorldPoint(element,p));points[0]={x:-30,y:15};const changed=reboxFreeform(element,points),updated={...element,...changed};
  for(let i=1;i<3;i++){const actual=elementWorldPoint(updated,{x:changed.path.points[i].x*changed.geometry.width,y:changed.path.points[i].y*changed.geometry.height});assert.ok(Math.hypot(actual.x-old[i].x,actual.y-old[i].y)<.0001);}
  const local=elementLocalPoint(element,old[1]);assert.ok(Math.abs(local.x-80)<.00001&&Math.abs(local.y)<.00001);
});
test('closed path segment lookup includes the closing edge and returns the nearest projected insertion point',()=>{
  const p=[{x:0,y:0},{x:100,y:0},{x:100,y:100}],result=nearestPathSegment(p,{x:45,y:48},true);assert.equal(result.index,2);assert.deepEqual(result.point,{x:46.5,y:46.5});assert.equal(nearestPathSegment(p,{x:50,y:-10},false).index,0);
});
