import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {CommandController} from '../src/controller.js';
import {cloneDocument,normalizeDocument} from '../src/model.js';
import {exportPresentation,parsePresentation} from '../src/format.js';
import {getLayoutSlots} from '../src/master-model.js';
const request=(c,commands,extra={})=>{const r=c.readCommittedSnapshot().value;return{target:{instanceId:r.instanceId,editorSessionId:r.editorSessionId,documentId:r.documentId},expectedRevision:r.contentRevision,operationId:'layout-flow',targeting:'id',commands,...extra};};

test('creating from a built-in type installs its family and creates an empty linked slide in one shared Undo',()=>{
  const c=new CommandController(),before=cloneDocument(c.document),oldSlide=c.activeSlideId;
  const id=c.createSlideFromLayout('vividly-layout-body',{preset:true});assert.equal(c.activeSlideId,id);assert.equal(c.undoCount,1);assert.equal(c.document.layoutMasters.length,1);assert.equal(c.document.layouts.length,10);
  const layout=c.document.layouts.find(l=>l.id===c.activeSlide.layout.layoutId),slots=getLayoutSlots(layout);assert.equal(slots.length,2);
  for(const slot of slots)assert.deepEqual(c.activeSlide.elements.find(e=>e.id===c.activeSlide.layout.elementMap[slot.elementId]).text.paragraphs,['']);
  const after=cloneDocument(c.document);c.undo();assert.deepEqual(c.document,before);assert.equal(c.activeSlideId,oldSlide);c.redo();assert.deepEqual(c.document,after);assert.equal(c.activeSlideId,id);
  assert.deepEqual(parsePresentation(exportPresentation(c.snapshot())),after);
});

test('new layout commands retain guarded batch dryRun, rollback, CAS and one history entry',async()=>{
  const c=new CommandController(),before=cloneDocument(c.document),commands=[{id:'slide.create_from_layout',params:{layoutId:'vividly-layout-body',slideId:'batch-layout-slide',afterSlideId:c.activeSlideId,preset:true}},{id:'document.set_title',params:{title:'레이아웃 기반 자료'}}];
  const input=request(c,commands),dry=await c.applyCommands({...input,dryRun:true});assert.equal(dry.ok,true);assert.deepEqual(c.document,before);assert.equal(c.undoCount,0);
  const failed=await c.applyCommands(request(c,[commands[0],{id:'layout.apply',params:{slideIds:['missing-slide'],layoutId:'vividly-layout-body'}}]));assert.equal(failed.ok,false);assert.deepEqual(c.document,before);assert.equal(c.undoCount,0);
  const done=await c.applyCommands(request(c,commands));assert.equal(done.ok,true);assert.equal(c.undoCount,1);assert.equal(c.document.title,'레이아웃 기반 자료');const after=cloneDocument(c.document);
  const stale=await c.applyCommands({...input,operationId:'stale-layout-flow'});assert.equal(stale.ok,false);assert.deepEqual(c.document,after);
  c.undo();assert.deepEqual(c.document,before);c.redo();assert.deepEqual(c.document,after);
});

test('staged image fills retain slot identity, reuse bytes, and survive reset, Undo and HTML roundtrip',()=>{
  const c=new CommandController();c.createSlideFromLayout('vividly-layout-image',{preset:true});const slideId=c.activeSlideId,slot=c.document.layouts.find(l=>l.id==='vividly-layout-image').slots.find(s=>s.role==='image'),id=c.activeSlide.layout.elementMap[slot.elementId],geometry=cloneDocument(c.activeSlide.elements.find(e=>e.id===id).geometry);
  const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7a8AAAAASUVORK5CYII=','base64'),asset={id:'owned-image',mimeType:'image/png',width:1,height:1,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),dataBase64:bytes.toString('base64')},image={id:'temporary-image-id',type:'image',geometry:{x:0,y:0,width:1,height:1},assetId:asset.id,fit:'cover',alt:'도표 이미지'};
  const before=cloneDocument(c.document),undo=c.undoCount;c.fillLayoutSlot(slideId,slot.key,image,[asset]);assert.equal(c.undoCount,undo+1);assert.equal(c.selectedId,id);assert.equal(c.selectedElement.type,'image');assert.deepEqual(c.selectedElement.geometry,geometry);assert.equal(c.document.assets.length,1);
  const filled=cloneDocument(c.document);c.undo();assert.deepEqual(c.document,before);c.redo();assert.deepEqual(c.document,filled);
  c.resetLayout([slideId]);assert.equal(c.activeSlide.elements.find(e=>e.id===id).assetId,asset.id);assert.deepEqual(parsePresentation(exportPresentation(c.snapshot())),c.document);
  c.fillLayoutSlot(slideId,slot.key,{...image,assetId:'duplicate-image'},[{...asset,id:'duplicate-image'}]);assert.equal(c.document.assets.length,1);assert.deepEqual(normalizeDocument(c.document),c.document);
});

test('whole-library no-op leaves revision/history untouched and inherited design can only be edited in the master',()=>{
  const c=new CommandController();c.createSlideFromLayout('vividly-layout-body',{preset:true});const undo=c.undoCount,revision=c.revision;
  c.replaceLayoutLibrary({layoutMasters:cloneDocument(c.document.layoutMasters),layouts:cloneDocument(c.document.layouts)});assert.equal(c.undoCount,undo);assert.equal(c.revision,revision);
  const inherited=c.activeSlide.elements.find(e=>e.locked),before=cloneDocument(c.document);assert.ok(inherited);
  assert.throws(()=>c.run('element.set_properties',{elementId:inherited.id,properties:{locked:false}}),/마스터/);assert.deepEqual(c.document,before);
  c.detachLayout([c.activeSlideId]);assert.equal(c.activeSlide.layout,undefined);assert.equal(Boolean(c.activeSlide.elements.find(e=>e.id===inherited.id).locked),false);
});
