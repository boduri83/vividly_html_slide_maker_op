import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {ICON_DEFINITIONS,ICON_CATEGORIES,ICON_SOURCE,getIconDefinition,createIconSvg} from '../src/icon-catalog.js';
import {normalizeSvgPath} from '../src/svg-path.js';
import {createBlankDocument} from '../src/model.js';
import {CommandController} from '../src/controller.js';
import {exportPresentation,parsePresentation} from '../src/format.js';
import {renderSlideContent} from '../src/render.js';

const svgElement=(iconId,id='icon-test')=>({id,type:'svg',name:getIconDefinition(iconId).label,geometry:{x:120,y:160,width:144,height:144},svg:createIconSvg(iconId)});
const insert=(store,element)=>store.run('elements.insert',{slideId:store.activeSlideId,elements:[element],assets:[]});

test('the icon library contains 60 original Lucide vectors in six Korean-labelled categories with source hashes and licenses',()=>{
  assert.equal(ICON_DEFINITIONS.length,60);assert.equal(ICON_CATEGORIES.length,6);assert.equal(new Set(ICON_DEFINITIONS.map(icon=>icon.id)).size,60);
  assert.equal(ICON_SOURCE.package,'lucide-static');assert.equal(ICON_SOURCE.version,'1.66.0');
  const metadata=JSON.parse(readFileSync(new URL('../assets/vendor/icons/provenance.json',import.meta.url),'utf8'));
  assert.equal(metadata.catalogCount,60);assert.equal(metadata.version,ICON_SOURCE.version);assert.equal(metadata.gitCommit,null);
  for(const icon of ICON_DEFINITIONS){
    assert.match(icon.label,/[가-힣]/);assert.ok(ICON_CATEGORIES.some(category=>category.id===icon.category));assert.ok(Object.isFrozen(icon)&&Object.isFrozen(icon.svg.shapes));
    assert.equal(getIconDefinition(icon.id),icon);assert.deepEqual(icon.svg.viewBox,{width:24,height:24});assert.ok(icon.svg.shapes.length);
    const source=metadata.files.find(file=>file.id===icon.id);assert.ok(source);const bytes=readFileSync(new URL('../'+source.path,import.meta.url));
    assert.equal(bytes.length,source.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),source.sha256);assert.match(bytes.toString(),/@license lucide-static v1\.66\.0/);
  }
  const license=readFileSync(new URL('../assets/vendor/icons/LICENSE.txt',import.meta.url),'utf8');assert.match(license,/ISC License/);assert.match(license,/The MIT License/);
});

test('catalog paths are bounded SVG commands and color variants are detached editable data',()=>{
  for(const icon of ICON_DEFINITIONS)for(const shape of icon.svg.shapes){
    assert.equal(shape.kind,'path');assert.equal(normalizeSvgPath(shape.d),shape.d.trim());assert.equal(shape.fill,'none');assert.equal(shape.strokeLinecap,'round');assert.equal(shape.strokeLinejoin,'round');
  }
  const first=createIconSvg('heart','#ee4488'),second=createIconSvg('heart','#115588');first.shapes[0].stroke='#000000';first.viewBox.width=99;
  assert.equal(second.shapes[0].stroke,'#115588');assert.equal(second.viewBox.width,24);assert.equal(getIconDefinition('heart').svg.shapes[0].stroke,'#253858');
  for(const value of ['__proto__','toString','<script>',undefined])assert.throws(()=>getIconDefinition(value));
  for(const color of ['currentColor','url(https://example.test/icon)','red','#xyz',null])assert.throws(()=>createIconSvg('heart',color));
});

test('all 60 icons insert through public commands, render actual paths and roundtrip with one shared Undo/Redo',()=>{
  for(const icon of ICON_DEFINITIONS){
    const store=new CommandController(createBlankDocument()),before=structuredClone(store.document),element=svgElement(icon.id);
    insert(store,element);assert.equal(store.undoCount,1,icon.id);assert.equal(store.activeSlide.elements[0].svg.title,icon.label);
    const html=exportPresentation(store.document),parsed=parsePresentation(html);assert.deepEqual(parsed,store.document,icon.id);
    const markup=renderSlideContent(store.activeSlide,store.document);assert.match(markup,/<path /,icon.id);assert.match(markup,/stroke-linecap="round"/,icon.id);assert.doesNotMatch(markup,/currentColor|<script|undefined|NaN|Infinity/,icon.id);
    const created=structuredClone(store.document);store.undo();assert.deepEqual(store.document,before,icon.id);store.redo();assert.deepEqual(store.document,created,icon.id);
  }
});

test('changing an icon preserves root layout and appearance and uses the existing SVG command and Undo',()=>{
  const store=new CommandController(createBlankDocument()),element=svgElement('heart');element.geometry={x:47,y:92,width:210,height:180};element.rotation=23;element.style={opacity:.65};
  insert(store,element);const before=structuredClone(store.document),old=store.activeSlide.elements[0],undo=store.undoCount;
  store.setSvg(old.id,createIconSvg('rocket','#8866cc'));assert.equal(store.undoCount,undo+1);const changed=store.activeSlide.elements[0];
  for(const key of ['id','name','geometry','rotation','style'])assert.deepEqual(changed[key],old[key],key);
  assert.equal(changed.svg.title,'로켓');assert.ok(changed.svg.shapes.every(shape=>shape.stroke==='#8866cc'));
  store.undo();assert.deepEqual(store.document,before);store.redo();assert.equal(store.activeSlide.elements[0].svg.title,'로켓');
});

test('malformed icon path batches reject atomically without changing the document, assets or history',()=>{
  const store=new CommandController(createBlankDocument()),before=structuredClone(store.document),first=svgElement('star','icon-valid'),bad=svgElement('heart','icon-invalid');bad.svg.shapes[0].d='M0 0 <script>alert(1)</script>';
  assert.throws(()=>store.runBatch([{id:'elements.insert',params:{slideId:store.activeSlideId,elements:[first],assets:[]}},{id:'elements.insert',params:{slideId:store.activeSlideId,elements:[bad],assets:[]}}],'아이콘 묶음'));
  assert.deepEqual(store.document,before);assert.equal(store.undoCount,0);assert.equal(store.revision,0);
});
