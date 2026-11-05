import test from 'node:test';
import assert from 'node:assert/strict';
import { CommandController } from '../src/controller.js';
import { createMasterDraft,updateLayout,remapMasterFamily } from '../src/master-model.js';
import { normalizeDocument } from '../src/model.js';
import { exportPresentation,parsePresentation } from '../src/format.js';
import { evaluateCommand } from '../src/commands.js';

function fixture(){
  const c=new CommandController();const bar=c.addShape('round-rect'),title=c.addText();c.run('text.set_content',{elementId:title,paragraphs:['원본 자리표시자']});c.captureLayout(c.activeSlideId,'브랜드 마스터','layout-workspace',[title]);const second=c.addSlide();c.applyLayout([second],'layout-workspace');const instance=c.activeSlide.layout.elementMap[title];c.run('text.set_content',{elementId:instance,paragraphs:['실제 장별 제목']});return {c,bar,title,second,instance};
}
function definition(draft,layoutId){const l=draft.document.layouts.find(l=>l.id===layoutId);return{name:draft.document.title,canvas:{width:draft.document.canvas.width,height:draft.document.canvas.height},background:draft.activeSlide.background,elements:structuredClone(draft.activeSlide.elements),placeholderIds:l.placeholderIds.filter(id=>draft.activeSlide.elements.some(e=>e.id===id)),assets:[]};}

test('duplicating a master family preserves literal text while remapping parent and slot references',()=>{
  const c=new CommandController();c.ensureLayoutLibrary();
  const originalMaster=structuredClone(c.document.layoutMasters[0]),originalLayout=structuredClone(c.document.layouts[0]);
  originalMaster.id='master-literal';originalMaster.name='master-literal';
  const text=structuredClone(originalLayout.elements.find(element=>element.text));
  text.id='textStyle';text.text.paragraphs=['master-literal','textStyle','slot-literal'];
  originalMaster.elements=[text];originalLayout.id='layout-literal';originalLayout.masterId=originalMaster.id;
  const child=structuredClone(text);child.id='slot-literal';originalLayout.elements=[child];originalLayout.placeholderIds=[child.id];
  originalLayout.slots=[{elementId:child.id,key:'title',role:'title',prompt:'textStyle'}];
  c.replaceLayoutLibrary({layoutMasters:[originalMaster],layouts:[originalLayout]});
  const before=c.snapshot(),history=c.undoCount;
  const mapping=new Map([['master-literal','master-copy'],['layout-literal','layout-copy'],['textStyle','master-object-copy'],['slot-literal','child-object-copy']]);
  const [master,layout]=remapMasterFamily([originalMaster,originalLayout],mapping);
  assert.equal(master.name,'master-literal');assert.deepEqual(master.elements[0].text.paragraphs,text.text.paragraphs);
  assert.equal(master.elements[0].text.textStyle.fontFamily,text.text.textStyle.fontFamily);
  assert.equal(layout.masterId,master.id);assert.deepEqual(layout.placeholderIds,['child-object-copy']);
  assert.equal(layout.slots[0].elementId,'child-object-copy');assert.equal(layout.slots[0].prompt,'textStyle');
  c.replaceLayoutLibrary({layoutMasters:[originalMaster,master],layouts:[originalLayout,layout]});
  assert.equal(c.undoCount,history+1);const after=c.snapshot();c.undo();assert.deepEqual(c.snapshot(),before);c.redo();assert.deepEqual(c.snapshot(),after);
  c.createSlideFromLayout(layout.id);assert.ok(c.activeSlide.elements.some(element=>element.text?.paragraphs.includes('master-literal')));
  assert.deepEqual(parsePresentation(exportPresentation(c.snapshot())),c.snapshot());
});

test('master reference draft has independent content/history and keeps real author slides untouched',()=>{
  const {c,bar,title}=fixture(),before=c.snapshot(),history=c.undoCount,draft=new CommandController(createMasterDraft(c.document,'layout-workspace'));
  assert.equal(draft.document.slides.length,1);assert.equal(draft.activeSlide.elements.find(e=>e.id===title).text.paragraphs[0],'원본 자리표시자');
  draft.setFill(bar,'#a855f7');draft.setGeometry(bar,{x:360,width:440});draft.run('text.set_content',{elementId:title,paragraphs:['새 원본 안내']});
  assert.deepEqual(c.snapshot(),before);assert.equal(c.undoCount,history);assert.equal(draft.undoCount,3);draft.undo();assert.equal(draft.activeSlide.elements.find(e=>e.id===title).text.paragraphs[0],'원본 자리표시자');assert.deepEqual(normalizeDocument(draft.document),draft.document);
});
test('Apply replaces the source definition and propagates visuals once while retaining local content and IDs',()=>{
  const {c,bar,title,second,instance}=fixture(),draft=new CommandController(createMasterDraft(c.document,'layout-workspace')),before=c.snapshot(),history=c.undoCount;
  draft.setFill(bar,'#a855f7');draft.setGeometry(title,{x:220,width:900});draft.setTitle('수정된 원본');draft.run('text.set_content',{elementId:title,paragraphs:['새 원본 안내']});
  c.updateLayout('layout-workspace',definition(draft,'layout-workspace'));assert.equal(c.undoCount,history+1);assert.equal(c.document.layouts[0].name,'수정된 원본');assert.equal(c.document.layouts[0].version,2);
  const slide=c.document.slides.find(s=>s.id===second);assert.equal(slide.layout.elementMap[title],instance);assert.equal(slide.elements.find(e=>e.id===instance).text.paragraphs[0],'실제 장별 제목');assert.equal(slide.elements.find(e=>e.id===instance).geometry.x,220);assert.equal(slide.elements.find(e=>e.id===slide.layout.elementMap[bar]).fill,'#a855f7');
  const after=c.snapshot();c.undo();assert.deepEqual(c.snapshot(),before);c.redo();assert.deepEqual(c.snapshot(),after);assert.deepEqual(parsePresentation(exportPresentation(after)),after);
});
test('placeholder selection and new source objects use the draft controller Undo without a second authority',()=>{
  const {c,bar,title}=fixture(),draft=new CommandController(createMasterDraft(c.document,'layout-workspace')),added=draft.addText(),before=draft.snapshot();
  draft.captureLayout(draft.activeSlideId,draft.document.title,'layout-workspace',[title,added]);assert.deepEqual(draft.document.layouts[0].placeholderIds,[title,added]);draft.undo();assert.deepEqual(draft.snapshot(),before);draft.redo();
  draft.deleteElement(bar);const result=definition(draft,'layout-workspace');c.updateLayout('layout-workspace',result);assert.ok(!c.document.layouts[0].elements.some(e=>e.id===bar));assert.ok(c.document.layouts[0].elements.some(e=>e.id===added));assert.deepEqual(c.document.layouts[0].placeholderIds,[title,added]);
});
test('invalid isolated master application fails without a main-document or history change',()=>{
  const {c,title}=fixture(),before=c.snapshot(),history=c.undoCount,draft=new CommandController(createMasterDraft(c.document,'layout-workspace')),invalid=definition(draft,'layout-workspace');invalid.placeholderIds=[title,'missing'];assert.throws(()=>c.updateLayout('layout-workspace',invalid));assert.deepEqual(c.snapshot(),before);assert.equal(c.undoCount,history);
});
test('identical public master updates ignore object key and placeholder set order without versions or Undo changes',()=>{
  const {c}=fixture(),draft=new CommandController(createMasterDraft(c.document,'layout-workspace')),before=c.snapshot(),history=c.undoCount,revision=c.revision,source=definition(draft,'layout-workspace');
  source.elements=source.elements.map(element=>Object.fromEntries(Object.entries(element).reverse()));source.placeholderIds.reverse();assert.equal(c.updateLayout('layout-workspace',source),false);assert.deepEqual(c.snapshot(),before);assert.equal(c.undoCount,history);assert.equal(c.revision,revision);
  const publicResult=evaluateCommand(before,{id:'layout.update',params:{layoutId:'layout-workspace',...source}});assert.equal(publicResult.ok,true);assert.equal(publicResult.value.changed,false);assert.deepEqual(publicResult.value.document,before);
});
test('empty reusable reference retains typed validation boundaries',()=>{
  const {c}=fixture(),copy=c.snapshot(),old=structuredClone(copy);assert.throws(()=>updateLayout(copy,{layoutId:'layout-workspace',name:'',canvas:{width:1280,height:720},background:'#ffffff',elements:[],placeholderIds:[]}));assert.deepEqual(copy,old);
  const originalContents=c.document.slides.map(s=>s.elements.filter(e=>e.text?.paragraphs.some(Boolean)).map(e=>e.text.paragraphs));c.updateLayout('layout-workspace',{name:'빈 마스터',canvas:{width:1280,height:720},background:'#ffffff',elements:[],placeholderIds:[],assets:[]});assert.deepEqual(c.document.layouts[0].elements,[]);assert.deepEqual(c.document.slides.map(s=>s.elements.filter(e=>e.text?.paragraphs.some(Boolean)).map(e=>e.text.paragraphs)),originalContents);assert.equal(c.document.slides.every(s=>Object.keys(s.layout.elementMap).length===0),true);
});
