import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CommandController} from '../src/controller.js';
import {createBlankDocument,normalizeDocument} from '../src/model.js';
import {createBusinessTemplate} from '../src/business-templates.js';
import {exportPresentation,parsePresentation} from '../src/format.js';

const asset=JSON.parse(readFileSync(new URL('../examples/document-contract-v0.1.json',import.meta.url),'utf8')).assets[0];
for(const schema of ['0.4-business.1','0.5-motion.1'])test(`primitive insertion in ${schema} preserves explicit reading order, assets and one shared Undo`,()=>{
 const doc=createBusinessTemplate('results');doc.schemaVersion=schema;doc.slides[0].readingOrder=doc.slides[0].elements.map(e=>e.id).reverse();
 const c=new CommandController(doc);
 for(const create of [()=>c.addText(),()=>c.addShape('rectangle'),()=>c.addShape('ellipse'),()=>c.addImage(asset)]){
  const before=structuredClone(c.document),undo=c.undoCount;const id=create(),after=structuredClone(c.document);
  assert.deepEqual(c.activeSlide.readingOrder,[...before.slides[0].readingOrder,id]);assert.equal(c.undoCount,undo+1);assert.equal(c.selectedId,id);
  assert.equal(new Set(c.activeSlide.readingOrder).size,c.activeSlide.elements.length);c.undo();assert.deepEqual(c.document,before);c.redo();assert.deepEqual(c.document,after);
  assert.deepEqual(parsePresentation(exportPresentation(c.document)),c.document);
 }
 assert.equal(c.document.assets.length,1);assert.equal(c.document.assets[0].dataBase64,asset.dataBase64);assert.equal(c.document.assets[0].sha256,asset.sha256);
 const stable=structuredClone(c.document),undo=c.undoCount;assert.throws(()=>c.addShape('unsupported'));assert.deepEqual(c.document,stable);assert.equal(c.undoCount,undo);
});
test('ordinary blank insertion does not add a reading order; malformed imported reading order remains rejected',()=>{
 const c=new CommandController(createBlankDocument());c.addText();assert.equal(Object.hasOwn(c.activeSlide,'readingOrder'),false);
 const malformed=createBusinessTemplate('results');malformed.slides[0].readingOrder=[];assert.throws(()=>normalizeDocument(malformed),/readingOrder/);
});
