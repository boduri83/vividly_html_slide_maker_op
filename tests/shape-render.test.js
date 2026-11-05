import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SHAPE_DEFINITIONS} from '../src/shapes.js';
import {normalizeDocument} from '../src/model.js';
import {renderSlideContent,isPresetShape,presetShapeTextInsets,presetShapeEditorBackground,updatePresetShapeAppearance,resolveElementAppearance} from '../src/render.js';
import {presetShapeMarkup} from '../src/shape-render.js';
import {exportPresentation,parsePresentation,createStaticExport} from '../src/format.js';

const fixture=()=>JSON.parse(readFileSync(new URL('../examples/document-contract-v0.1.json',import.meta.url),'utf8'));
const shapeOf=doc=>doc.slides[0].elements.find(e=>e.type==='shape');
const styled=()=>{const doc=fixture();doc.schemaVersion='0.5-motion.1';const shape=shapeOf(doc);shape.shape='cube';shape.style={opacity:.7,gradient:{type:'linear',angle:135,stops:[{offset:0,color:'#6722bb'},{offset:.4,color:'#bb44cc'},{offset:1,color:'#22aabb'}]},shadow:{x:4,y:8,blur:12,spread:2,color:'#16223f66'}};shape.rotation=15;shape.text.paragraphs=['Quarterly <growth> & next steps'];return doc;};

test('all 187 presets render deterministic scalable paths shared by editor and presentation',()=>{
  assert.equal(SHAPE_DEFINITIONS.length,187);
  for(const definition of SHAPE_DEFINITIONS){
    const doc=fixture(),shape=shapeOf(doc);shape.shape=definition.id;
    const normal=renderSlideContent(doc.slides[0],doc),interactive=renderSlideContent(doc.slides[0],doc,{interactive:true});
    assert.equal(interactive.replaceAll(' data-interactive="true"',''),normal,definition.id);
    if(isPresetShape(definition.id)){assert.match(normal,/data-preset-shape="true"/);assert.match(normal,/<svg class="element-shape-geometry"/);assert.match(normal,/class="element-shape-text"/);assert.doesNotMatch(normal,/NaN|Infinity|<foreignObject|<script/);}
    else{assert.doesNotMatch(normal,/data-preset-shape/);assert.match(normal,/background:#16a34a/);assert.match(normal,/border:2px solid/);}
  }
  assert.equal(isPresetShape(undefined),false);assert.equal(isPresetShape('not-a-shape'),false);
});

test('preset fill gradients, shaded faces and outline-aware shadows retain independent editable text',()=>{
  const doc=styled(),shape=shapeOf(doc),html=renderSlideContent(doc.slides[0],doc);
  for(const match of [/linearGradient/,/<stop offset="40%"/,/feComponentTransfer/,/feMorphology/,/feGaussianBlur/,/stroke-width="var\(--vividly-shape-stroke-width,2\)"/,/transform:rotate\(15deg\)/,/opacity:0.7/,/Quarterly &lt;growth&gt; &amp; next steps/])assert.match(html,match);
  assert.doesNotMatch(html,/box-shadow:/,'a preset shadow follows its contour rather than its rectangular box');
  shape.style.gradient.type='radial';assert.match(renderSlideContent(doc.slides[0],doc),/<radialGradient/);
  const before=structuredClone(doc);assert.match(createStaticExport(doc).html,/element-shape-geometry/);assert.deepEqual(doc,before);
});

test('all preset metadata and offline geometry survive editable HTML roundtrip without fetching assets',()=>{
  const doc=styled(),base=shapeOf(doc);doc.slides[0].elements=SHAPE_DEFINITIONS.map((definition,index)=>({...structuredClone(base),id:'preset-'+index,shape:definition.id}));
  const checked=normalizeDocument(doc),before=structuredClone(checked),html=exportPresentation(checked);
  assert.deepEqual(parsePresentation(html),before);assert.deepEqual(checked,before);
  assert.equal((html.match(/data-preset-shape="true"/g)||[]).length,185);
  assert.doesNotMatch(html,/<script[^>]+src=|<link[^>]+href=|<image[^>]+href=/);
  assert.match(html,/--vividly-shape-fill/);
});

test('preset text editing backdrop uses the same geometry and bounded text box for every preset',()=>{
  for(const definition of SHAPE_DEFINITIONS.filter(d=>isPresetShape(d.id))){
    const doc=fixture(),shape=shapeOf(doc);shape.shape=definition.id;
    const insets=presetShapeTextInsets(shape),{width,height}=shape.geometry;
    assert.ok(Object.values(insets).every(value=>Number.isFinite(value)&&value>=0),definition.id);
    assert.ok(insets.left+insets.right<=width+.0001,definition.id);assert.ok(insets.top+insets.bottom<=height+.0001,definition.id);
    const background=presetShapeEditorBackground(shape,doc),svg=decodeURIComponent(background.slice('url("data:image/svg+xml,'.length,-2));
    assert.equal(svg,presetShapeMarkup(shape,resolveElementAppearance(shape,doc)),definition.id);
  }
});

test('native paint confirmation changes SVG paint without replacing its geometry or adding rectangular fill',()=>{
  const doc=styled(),shape=shapeOf(doc);delete shape.style.gradient;shape.fill='#12ab34';shape.stroke={color:'#9044cc',width:6};
  const values=new Map(),node={style:{setProperty:(key,value)=>values.set(key,value)},innerHTML:'PRESERVED_GEOMETRY'};
  assert.equal(updatePresetShapeAppearance(node,shape,doc),true);assert.equal(node.innerHTML,'PRESERVED_GEOMETRY');
  assert.equal(values.get('--vividly-shape-fill'),'#12ab34');assert.equal(values.get('--vividly-shape-stroke'),'#9044cc');assert.equal(values.get('--vividly-shape-stroke-width'),'6');assert.equal(node.style.background,'transparent');assert.equal(node.style.border,'0');
});

test('marker outlines remain above later background fill planes',()=>{
  for(const kind of ['chart-x','chart-plus','chart-star']){
    const doc=fixture(),shape=shapeOf(doc);shape.shape=kind;
    const html=presetShapeMarkup(shape,resolveElementAppearance(shape,doc));
    const fill=html.indexOf('fill="var(--vividly-shape-fill,'),outline=html.indexOf('stroke="var(--vividly-shape-stroke,');
    assert.ok(fill>=0&&outline>fill,kind+' visible outline after its background plane');
  }
});

test('preset rendering rejects invalid paint, coordinates and unrecognized kinds before HTML emission',()=>{
  for(const mutate of [e=>e.fill='url(https://bad.invalid)',e=>e.stroke.color='#fff;background:red',e=>e.stroke.width=-1,e=>e.geometry.width=NaN,e=>e.shape='<svg onload=alert(1)>']){
    const doc=styled(),shape=shapeOf(doc);delete shape.style.gradient;mutate(shape);assert.throws(()=>renderSlideContent(doc.slides[0],doc));
  }
  const doc=styled(),shape=shapeOf(doc);shape.id='id"><script>bad</script>';const html=renderSlideContent(doc.slides[0],doc);assert.doesNotMatch(html,/<script>/);assert.match(html,/data-element-id="id&quot;&gt;&lt;script&gt;/);
});
