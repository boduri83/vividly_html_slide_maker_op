import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SHAPE_DEFINITIONS,SHAPE_ADJUSTMENT_NAMES,normalizeShapeAdjustments,shapeGeometry,shapeAdjustmentHandles,solveShapeHandle} from '../src/shapes.js';
import {renderSlideContent,presetShapeTextInsets,presetShapeEditorBackground} from '../src/render.js';
import {exportPresentation,parsePresentation} from '../src/format.js';

const fixture=()=>JSON.parse(readFileSync(new URL('../examples/document-contract-v0.1.json',import.meta.url),'utf8'));
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const handle=(kind,index=0,adjustments={})=>shapeAdjustmentHandles(kind,320,220,adjustments)[index];

test('actual source handles cover 120 presets, 243 positions and both XY and polar controls',()=>{
  let presets=0,handles=0,polar=0;
  for(const definition of SHAPE_DEFINITIONS){
    const {id,defaultWidth:w,defaultHeight:h}=definition;
    const list=shapeAdjustmentHandles(id,w,h);if(list.length)presets++;handles+=list.length;
    assert.deepEqual(shapeGeometry(id,w,h),shapeGeometry(id,w,h,{}),id+' default changed');
    for(const point of list){
      assert.ok(Object.isFrozen(point));assert.ok(Number.isFinite(point.x)&&Number.isFinite(point.y),id);
      assert.ok(point.refs.length>=1&&point.refs.length<=2,id);
      if(point.type==='polar')polar++;else assert.equal(point.type,'xy');
      for(const ref of point.refs){assert.ok(SHAPE_ADJUSTMENT_NAMES.includes(ref));const b=point.bounds[ref];assert.ok(Number.isFinite(b.min)&&Number.isFinite(b.max)&&b.min<=b.max,id);}
    }
  }
  assert.deepEqual({presets,handles,polar},{presets:120,handles:243,polar:23});
  assert.deepEqual(shapeAdjustmentHandles('freeform',100,100),[]);
});

test('adjustments accept only bundled names and finite values, with actual aspect-dependent limits',()=>{
  for(const bad of [null,[],{script:'alert(1)'},{adj:NaN},{adj:Infinity},{adj:'4'},{adj:1000000001},JSON.parse('{"__proto__":3}')])assert.throws(()=>normalizeShapeAdjustments('round-rect',bad));
  assert.throws(()=>normalizeShapeAdjustments('rectangle',{adj:3}));
  assert.deepEqual(normalizeShapeAdjustments('round-rect',{adj:-20},320,220),{adj:0});
  assert.deepEqual(normalizeShapeAdjustments('round-rect',{adj:90000},320,220),{adj:50000});
  assert.deepEqual(normalizeShapeAdjustments('right-arrow',{adj2:200000},400,100),{adj2:200000});
  assert.equal(normalizeShapeAdjustments('right-arrow',{adj2:200000},100,400).adj2,100000);
});

test('rounding and arrow handles invert the authored guide while preserving unrelated parameters',()=>{
  for(const [kind,index,expected]of [['round-rect',0,{adj:35000}],['right-arrow',0,{adj1:30000}],['right-arrow',1,{adj2:25000}],['star-5',0,{adj:32000}]]){
    const target=handle(kind,index,expected),original=shapeGeometry(kind,320,220),next=solveShapeHandle(kind,320,220,{},target.id,target);
    assert.ok(distance(handle(kind,index,next),target)<.001,kind);
    assert.notDeepEqual(shapeGeometry(kind,320,220,next).paths,original.paths,kind);
    assert.ok(Object.keys(next).every(key=>target.refs.includes(key)),kind+' changed another adjustment');
  }
});

test('polar radius and angle handles track reachable points across the angular seam',()=>{
  for(const [kind,index,expected]of [['donut',0,{adj:40000}],['pie',0,{adj1:1000000}],['pie',0,{adj1:20800000}],['arc',1,{adj2:14000000}]]){
    const target=handle(kind,index,expected),next=solveShapeHandle(kind,320,220,{},target.id,target);
    assert.ok(distance(handle(kind,index,next),target)<.005,kind+' '+JSON.stringify(next));
    for(const point of shapeAdjustmentHandles(kind,320,220,next))for(const ref of point.refs){const b=point.bounds[ref],v=next[ref]??b.value;assert.ok(v>=b.min-.01&&v<=b.max+.01);}
  }
});

test('callout adjustment keeps its default frame while the tail moves beyond the authored box',()=>{
  const kind='wedge-round-rect-callout',before=shapeGeometry(kind,320,220),start=handle(kind),target={x:start.x+45,y:280};
  const next=solveShapeHandle(kind,320,220,{},start.id,target),point=handle(kind,0,next),after=shapeGeometry(kind,320,220,next);
  assert.ok(point.y>220);assert.ok(distance(point,target)<.001);
  assert.deepEqual(after.textRect,before.textRect,'moving tail must not shrink the text body');
  assert.notDeepEqual(after.paths,before.paths);assert.ok(after.paths.some(path=>path.d.includes('280')));
});

test('the inverse solver never worsens a pointer target and cannot escape source limits',()=>{
  for(const definition of SHAPE_DEFINITIONS){
    const w=definition.defaultWidth,h=definition.defaultHeight;
    for(const original of shapeAdjustmentHandles(definition.id,w,h)){
      const target={x:original.x+8,y:original.y+9},next=solveShapeHandle(definition.id,w,h,{},original.id,target),changed=shapeAdjustmentHandles(definition.id,w,h,next).find(point=>point.id===original.id);
      assert.ok(distance(changed,target)<=distance(original,target)+.005,definition.id+' '+original.id);
      for(const [ref,value]of Object.entries(next)){assert.ok(Number.isFinite(value)&&Math.abs(value)<=1e9);const b=changed.bounds[ref];if(b)assert.ok(value>=b.min-.01&&value<=b.max+.01,definition.id);}
    }
  }
  assert.throws(()=>solveShapeHandle('round-rect',100,100,{},'wrong',{x:0,y:0}));
  assert.throws(()=>solveShapeHandle('round-rect',100,100,{},'handle-0',{x:NaN,y:0}));
});

test('adjusted paths, text layout and editing backdrop use the same geometry and survive HTML roundtrip',()=>{
  const doc=fixture(),shape=doc.slides[0].elements.find(element=>element.type==='shape');shape.shape='round-rect';shape.adjustments={adj:42000};
  const modified=renderSlideContent(doc.slides[0],doc),defaults=structuredClone(doc);delete defaults.slides[0].elements.find(element=>element.id===shape.id).adjustments;
  assert.notEqual(modified,renderSlideContent(defaults.slides[0],defaults));
  assert.match(modified,/data-preset-shape="true"/);assert.doesNotMatch(modified,/NaN|Infinity/);
  const insets=presetShapeTextInsets(shape);assert.ok(insets.left>0&&insets.top>0);
  const backdrop=decodeURIComponent(presetShapeEditorBackground(shape,doc));assert.match(backdrop,/element-shape-geometry/);
  const parsed=parsePresentation(exportPresentation(doc));assert.deepEqual(parsed.slides[0].elements.find(element=>element.id===shape.id).adjustments,shape.adjustments);
  assert.equal(renderSlideContent(parsed.slides[0],parsed),modified);
});

test('closed and open freeforms share real SVG stroke, fill, text bounds and editor backdrop',()=>{
  for(const closed of [false,true]){
    const doc=fixture(),shape=doc.slides[0].elements.find(element=>element.type==='shape');shape.shape='freeform';shape.path={closed,points:[{x:0,y:.9},{x:.4,y:0},{x:1,y:1}]};
    const rendered=renderSlideContent(doc.slides[0],doc);assert.match(rendered,/data-preset-shape="true"/);assert.match(rendered,/element-shape-geometry/);assert.match(rendered,/element-shape-text/);
    assert.equal(/fill="var\(--vividly-shape-fill/.test(rendered),closed);
    assert.deepEqual(presetShapeTextInsets(shape),{top:0,right:0,bottom:0,left:0},'freeform nodes use the exact outer geometry frame');
    assert.match(rendered,/transform="translate\(0 0\)"/,'freeform points must not shift by half the stroke');
    assert.match(decodeURIComponent(presetShapeEditorBackground(shape,doc)),/M /);assert.doesNotMatch(rendered,/NaN|Infinity/);
    const parsed=parsePresentation(exportPresentation(doc));assert.deepEqual(parsed.slides[0].elements.find(element=>element.id===shape.id).path,shape.path);
  }
});
