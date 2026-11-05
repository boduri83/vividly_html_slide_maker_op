import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCommandPreview} from '../src/preview-diff.js';
import {summarizeChanges,changedTargetIds} from '../src/document-diff.js';
import {CommandController} from '../src/controller.js';
import {buildWebFormCommands} from '../src/web-authoring-ui.js';

test('verified preview includes form settings, library sources and responsive changes within existing bounded document scope',()=>{
  const before={id:'review-doc',title:'Review',slides:[],assets:[],webForms:[{id:'contact',name:'연락처',persistence:'none',fields:[{key:'name',label:'이름',variableId:'name-value',type:'text'}]}],componentLibrary:[{id:'card',name:'카드',version:1,elements:[]}],responsive:{enabled:true,minWidth:320,maxWidth:1600}},after=structuredClone(before);
  after.webForms[0].fields[0].label='담당자';after.webForms[0].persistence='local';after.componentLibrary[0].name='연락 카드';after.responsive.maxWidth=1440;
  const preview=buildCommandPreview(before,after,{baseRevision:7});
  for(const prefix of ['webForms','componentLibrary','responsive'])assert(preview.entries.some(entry=>entry.scope==='document'&&entry.id===before.id&&entry.path.startsWith(prefix)),prefix);
  assert(preview.entries.some(entry=>entry.path==='webForms[0].fields[0].label'&&entry.after==='담당자'));
  const summary=summarizeChanges(before,after);for(const field of ['webFormsChanged','componentLibraryChanged','responsiveChanged'])assert.equal(summary[field],true);
  assert.deepEqual(changedTargetIds(before,after),[before.id]);assert.equal(preview.baseRevision,7);
  const unchanged=summarizeChanges({id:'legacy',title:'기존',slides:[],assets:[]},{id:'legacy',title:'기존',slides:[],assets:[]});
  for(const key of ['webFormsChanged','componentLibraryChanged','responsiveChanged'])assert(!Object.hasOwn(unchanged,key));
});

test('import preview reports newly added pages/forms without navigating, and editing entry is view-only with one shared import Undo',()=>{
  const source=new CommandController(),sourceSlide=source.activeSlideId;
  const form=buildWebFormCommands(source.document,sourceSlide,{name:'연락처',persistence:'local',modal:false,fields:[{key:'name',label:'이름',type:'text',initial:'원본 담당자',required:true,maxLength:120},{key:'email',label:'이메일',type:'email',initial:'',maxLength:256}]});
  source.runBatch(form.commands,'연락처 제작');
  const target=new CommandController(),before=structuredClone(target.document),active=target.activeSlideId,selection={slideIds:[sourceSlide]},preview=target.previewLibraryImport(source.document,selection);
  assert.equal(preview.ok,true,JSON.stringify(preview));assert.equal(preview.value.addedSlideIds.length,1);assert.equal(preview.value.addedFormIds.length,1);
  assert.equal(target.activeSlideId,active);assert.deepEqual(target.document,before);assert.equal(target.undoCount,0);
  const applied=target.importLibrary(source.document,selection,{expectedRevision:preview.value.contentRevision,expectedSessionId:preview.value.editorSessionId});
  assert.equal(applied.ok,true,JSON.stringify(applied));assert.deepEqual(applied.value.addedSlideIds,preview.value.addedSlideIds);assert.deepEqual(applied.value.addedFormIds,preview.value.addedFormIds);assert.equal(target.activeSlideId,active);
  const revision=target.revision,after=structuredClone(target.document);target.switchSlide(applied.value.addedSlideIds[0]);assert.equal(target.revision,revision);assert.equal(target.undoCount,1);assert.deepEqual(target.document,after);
  target.undo();assert.deepEqual(target.document,before);assert.equal(target.activeSlideId,active);target.redo();assert.deepEqual(target.document,after);
});
