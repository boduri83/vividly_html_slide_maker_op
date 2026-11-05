import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {SHAPE_DEFINITIONS,SHAPE_KINDS,SHAPE_CATEGORIES,getShapeDefinition,shapeGeometry} from '../src/shapes.js';
import {normalizeDocument,createBlankDocument} from '../src/model.js';
import {CommandController} from '../src/controller.js';
import {getCommandCatalog,validateCommand,evaluateCommands} from '../src/commands.js';
import {createBusinessTemplate} from '../src/business-templates.js';

const fixture=JSON.parse(readFileSync(new URL('../examples/document-contract-v0.1.json',import.meta.url),'utf8'));
const shapeId='element-shape-001';
const find=(c,id)=>c.activeSlide.elements.find(e=>e.id===id);

test('the catalog retains all 187 source presets, Korean labels, stable categories and legacy identifiers',()=>{
 assert.equal(SHAPE_DEFINITIONS.length,187);assert.equal(new Set(SHAPE_KINDS).size,187);
 assert.deepEqual(new Set(SHAPE_CATEGORIES.map(c=>c.id)),new Set(SHAPE_DEFINITIONS.map(d=>d.category)));
 for(const def of SHAPE_DEFINITIONS){assert.match(def.id,/^[a-z][a-z0-9-]+$/);assert.match(def.label,/[가-힣]/);assert.equal(getShapeDefinition(def.id),def);assert.ok(def.defaultWidth>0&&def.defaultHeight>0);assert.ok(Object.isFrozen(def));}
 assert.equal(getShapeDefinition('rectangle').sourcePreset,'rect');assert.equal(getShapeDefinition('ellipse').sourcePreset,'ellipse');
 assert.equal(getShapeDefinition('star-5').sourcePreset,'star5');assert.equal(getShapeDefinition('right-triangle').sourcePreset,'rtTriangle');
 for(const kind of ['__proto__','toString','rect','<svg onload=alert(1)>',undefined])assert.throws(()=>getShapeDefinition(kind));
 const original=readFileSync(new URL('../assets/vendor/shapes/presetShapeDefinitions.xml',import.meta.url)),provenance=JSON.parse(readFileSync(new URL('../assets/vendor/shapes/provenance.json',import.meta.url),'utf8'));
 assert.equal(original.length,provenance.sourceBytes);assert.equal(createHash('sha256').update(original).digest('hex'),provenance.sourceSha256);assert.equal(provenance.presetCount,187);
});

test('every preset computes finite safe geometry and usable text bounds across wide, tall and tiny aspect ratios',()=>{
 for(const def of SHAPE_DEFINITIONS)for(const [width,height]of [[100,100],[600,160],[160,600],[1,1],[16384,100]]){
  const result=shapeGeometry(def.id,width,height);assert.ok(result.paths.length,def.id);assert.ok(Object.isFrozen(result));
  for(const path of result.paths){assert.match(path.d,/^[MLQCAZ0-9+., eE-]+$/,def.id);assert.ok(!/NaN|Infinity|undefined/.test(path.d),def.id);assert.match(path.d,/^M/);assert.ok(path.fillMode===undefined||['darken','darkenLess','lighten','lightenLess'].includes(path.fillMode));}
  const t=result.textRect;for(const n of Object.values(t))assert.ok(Number.isFinite(n)&&n>=0,def.id);
  assert.ok(t.x+t.width<=width+.00002,def.id);assert.ok(t.y+t.height<=height+.00002,def.id);
 }
 for(const dimensions of [[0,100],[-2,100],[NaN,100],[Infinity,100],[100,0]])assert.throws(()=>shapeGeometry('triangle',...dimensions));
});

test('standard geometric reference shapes and full-circle arcs retain their actual topology',()=>{
 assert.equal(shapeGeometry('triangle').paths[0].d,'M0 100 L50 0 L100 100 Z');
 assert.equal(shapeGeometry('diamond').paths[0].d,'M0 50 L50 0 L100 50 L50 100 Z');
 assert.deepEqual(shapeGeometry('triangle').textRect,{x:25,y:50,width:50,height:50});
 const ellipse=shapeGeometry('ellipse',400,200).paths[0].d;
 assert.ok((ellipse.match(/A/g)||[]).length>=4,'full circle must not collapse to the same-endpoint empty SVG arc');
 assert.match(ellipse,/A200 100/);assert.match(ellipse,/Z$/);
 const heart=shapeGeometry('heart').paths[0].d;assert.equal((heart.match(/C/g)||[]).length,2);assert.match(heart,/^M50 25 C/,'Bezier controls outside the box must not shrink the heart into a smaller control-point box');
 const callout=shapeGeometry('accent-border-callout-1');assert.ok(callout.textRect.x>0,'external callout leader is fitted into the logical selection box');
 const cloud=shapeGeometry('cloud',400,200);assert.ok(cloud.paths.length>1);assert.ok(cloud.paths.some(p=>p.fill===false));
 const bevel=shapeGeometry('bevel');assert.ok(bevel.paths.some(p=>p.fillMode==='lighten'||p.fillMode==='darken'));
});

test('all new presets can be inserted, selected, undone once and redone through the existing Controller',()=>{
 const c=new CommandController(createBlankDocument());
 for(const def of SHAPE_DEFINITIONS){
  const before=structuredClone(c.document),undo=c.undoCount,id=c.addShape(def.id),after=structuredClone(c.document);
  assert.equal(c.selectedId,id);assert.equal(find(c,id).shape,def.id);assert.equal(c.undoCount,undo+1);
  assert.equal(find(c,id).geometry.width,def.defaultWidth);assert.equal(find(c,id).geometry.height,def.defaultHeight);
  assert.deepEqual(normalizeDocument(after),after);c.undo();assert.deepEqual(c.document,before);c.redo();assert.deepEqual(c.document,after);c.undo();
 }
 for(const kind of ['rectangle','ellipse']){c.addShape(kind);assert.equal(c.selectedElement.geometry.width,400);assert.equal(c.selectedElement.geometry.height,220);c.undo();}
});

test('kind changes preserve shape content, styling and logical geometry and keep the shared command contract strict',()=>{
 const c=new CommandController(fixture),original=structuredClone(find(c,shapeId));
 for(const kind of SHAPE_KINDS){
  const checked=validateCommand({id:'shape.set_kind',params:{elementId:shapeId,shape:kind}});assert.equal(checked.ok,true,kind);
  c.setShapeKind(shapeId,kind);assert.deepEqual({...find(c,shapeId),shape:original.shape},original,kind);
 }
 const stable=structuredClone(c.document),undo=c.undoCount;
 assert.equal(validateCommand({id:'shape.set_kind',params:{elementId:shapeId,shape:'future-freeform'}}).ok,false);
 const malformed=structuredClone(stable);find({activeSlide:malformed.slides[0]},shapeId).shape='future-freeform';assert.throws(()=>normalizeDocument(malformed));
 assert.throws(()=>c.addShape('future-freeform'));assert.deepEqual(c.document,stable);assert.equal(c.undoCount,undo);
 const catalog=getCommandCatalog(),entry=catalog.find(item=>item.id==='shape.set_kind');assert.ok(entry);assert.equal(catalog.length,106);
 const capabilities=c.readCapabilities().value;assert.deepEqual(capabilities.shapes.presets,SHAPE_KINDS);assert.equal(capabilities.shapes.adjustableHandles,true);assert.equal(capabilities.shapes.freeform,true);
});

test('structured insertion and atomic batches accept known shape presets and reject a late unknown kind without mutation',()=>{
 const c=new CommandController(createBlankDocument()),slideId=c.activeSlideId;
 c.addShape('star-5');const example=structuredClone(c.selectedElement);c.undo();
 const insert={id:'elements.insert',params:{slideId,elements:[example],assets:[]}};
 assert.equal(validateCommand(insert).ok,true);c.runBatch([insert,{id:'shape.set_kind',params:{elementId:example.id,shape:'heart'}}],'기호 배치');
 const after=structuredClone(c.document);assert.equal(c.activeSlide.elements[0].shape,'heart');c.undo();assert.equal(c.activeSlide.elements.length,0);c.redo();assert.deepEqual(c.document,after);
 const before=structuredClone(c.document),undo=c.undoCount;
 const evaluated=evaluateCommands(before,[{id:'shape.set_kind',params:{elementId:example.id,shape:'right-arrow'}},{id:'shape.set_kind',params:{elementId:example.id,shape:'<path>'}}]);assert.equal(evaluated.ok,false);assert.deepEqual(c.document,before);assert.equal(c.undoCount,undo);
 const bad=structuredClone(insert);bad.params.elements[0].shape='<svg>';assert.equal(validateCommand(bad).ok,false);
});

test('new shapes append to existing business reading order and locked kind changes remain protected',()=>{
 const c=new CommandController(createBusinessTemplate('results'));const order=[...c.activeSlide.readingOrder],id=c.addShape('flow-chart-decision');assert.deepEqual(c.activeSlide.readingOrder,[...order,id]);
 c.setElementFlags(id,{locked:true});const before=structuredClone(c.document),undo=c.undoCount;assert.throws(()=>c.setShapeKind(id,'hexagon'));assert.deepEqual(c.document,before);assert.equal(c.undoCount,undo);
});
