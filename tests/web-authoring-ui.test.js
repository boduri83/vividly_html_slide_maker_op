import test from 'node:test';
import assert from 'node:assert/strict';
import {CommandController} from '../src/controller.js';
import {createBlankDocument} from '../src/model.js';
import {buildWebFormCommands,buildWebFormUpdateCommands} from '../src/web-authoring-ui.js';
import {exportPresentation,parsePresentation} from '../src/format.js';

const fields=()=>[
  {key:'name',label:'이름',type:'text',initial:'윤서',required:true,maxLength:120,placeholder:'표시할 이름'},
  {key:'bio',label:'소개',type:'textarea',initial:'사람이 수정하는 소개',maxLength:2048},
  {key:'email',label:'이메일',type:'email',initial:'hello@example.test',maxLength:256},
  {key:'budget',label:'예산',type:'number',initial:1200},
  {key:'consent',label:'동의',type:'checkbox',initial:false},
  {key:'role',label:'역할',type:'select',options:'기획, 디자인, 개발',initial:'디자인'},
];
const definition=(extra={})=>({name:'팀 프로필',persistence:'local',modal:true,fields:fields(),...extra});
const handle=c=>({instanceId:c.instanceId,editorSessionId:c.editorSessionId,documentId:c.document.id});
const request=(c,commands,extra={})=>({target:handle(c),expectedRevision:c.revision,operationId:'form-authoring',targeting:'id',commands,...extra});

test('manual form builder creates native six-type inputs, modal actions and metadata in one shared Undo with exact HTML reopening',()=>{
  const c=new CommandController(),before=c.snapshot(),prepared=buildWebFormCommands(c.document,c.activeSlideId,definition());
  assert.deepEqual(c.snapshot(),before);c.runBatch(prepared.commands,'입력 폼');assert.equal(c.undoCount,1);assert.equal(c.document.schemaVersion,'0.15-authoring.1');
  const form=c.document.webForms[0],slide=c.activeSlide;assert.deepEqual(form.fields.map(field=>field.type),fields().map(field=>field.type));assert.equal(new Set(form.fields.map(field=>field.variableId)).size,6);
  assert.deepEqual(slide.behavior.inputs.map(input=>input.kind),fields().map(field=>field.type));
  for(const field of form.fields){const input=slide.behavior.inputs.find(input=>input.variableId===field.variableId);assert.ok(input);assert.equal(slide.elements.find(element=>element.id===input.targetId).component,undefined);}
  const panel=slide.elements.find(element=>element.id===prepared.panelId);assert.equal(panel.component.placement,'center');assert.equal(panel.component.initiallyOpen,false);assert.equal(panel.component.dim,true);assert.equal(slide.interactions.filter(rule=>rule.actions[0].type==='openPanel').length,1);
  const save=slide.elements.find(element=>element.web?.action==='save');assert.equal(save.web.closePanelId,panel.id);assert.equal(save.web.formId,form.id);
  const after=c.snapshot();c.undo();assert.deepEqual(c.snapshot(),before);c.redo();assert.deepEqual(c.snapshot(),after);assert.deepEqual(parsePresentation(exportPresentation(after)),after);
});

test('forms fit all five document ratios and twelve field layouts without flattening editable elements',()=>{
  for(const[width,height]of[[1280,720],[1200,900],[1080,1080],[900,1200],[720,1280]])for(const modal of[false,true]){
    const doc=createBlankDocument();doc.canvas={width,height,unit:'logical-px'};const c=new CommandController(doc),fieldRows=Array.from({length:12},(_,index)=>({key:'row'+index,label:'입력 '+index,type:index%3===0?'textarea':'text',initial:''})),prepared=buildWebFormCommands(c.document,c.activeSlideId,definition({modal,fields:fieldRows}));c.runBatch(prepared.commands,'폼');
    for(const element of c.activeSlide.elements){const geometry=element.geometry;assert.ok(geometry.x>=0&&geometry.y>=0);assert.ok(geometry.x+geometry.width<=width+1e-6);assert.ok(geometry.y+geometry.height<=height+1e-6);assert.ok(element.type==='shape'||element.type==='text');}
    assert.equal(c.activeSlide.behavior.inputs.length,12);assert.equal(Boolean(c.activeSlide.elements.find(element=>element.component?.kind==='panel')),modal);
  }
});

test('public preview and late form-action failure leave no partial variables, elements, forms or Undo',async()=>{
  const c=new CommandController(),before=c.snapshot(),prepared=buildWebFormCommands(c.document,c.activeSlideId,definition());
  const dry=await c.applyCommands(request(c,prepared.commands,{dryRun:true}));assert.equal(dry.ok,true,JSON.stringify(dry));assert.deepEqual(c.snapshot(),before);assert.equal(c.undoCount,0);
  const late=await c.applyCommands(request(c,[...prepared.commands,{id:'element.set_web',params:{elementId:prepared.elementIds[0],web:{kind:'formAction',formId:'missing-form',action:'save'}}}]));assert.equal(late.ok,false);assert.deepEqual(c.snapshot(),before);assert.equal(c.undoCount,0);
  const applied=await c.applyCommands(request(c,prepared.commands));assert.equal(applied.ok,true,JSON.stringify(applied));assert.equal(c.undoCount,1);const after=c.snapshot();c.undo();assert.deepEqual(c.snapshot(),before);c.redo();assert.deepEqual(c.snapshot(),after);
});

test('revisiting form settings retains variable/key/type references and updates metadata and initial values together',()=>{
  const c=new CommandController(),prepared=buildWebFormCommands(c.document,c.activeSlideId,definition());c.runBatch(prepared.commands,'폼');
  const before=c.snapshot(),count=c.undoCount,original=c.document.webForms[0],ids=original.fields.map(field=>field.variableId),draft=definition({name:'새 팀 프로필',persistence:'session'});draft.fields[0]={...draft.fields[0],label:'표시 이름',initial:'수정한 이름',required:false,maxLength:80,placeholder:'새 안내'};
  const updated=buildWebFormUpdateCommands(c.document,original.id,draft);assert.deepEqual(c.snapshot(),before);c.runBatch(updated.commands,'폼 설정');
  assert.equal(c.undoCount,count+1);assert.equal(c.document.webForms[0].id,original.id);assert.deepEqual(c.document.webForms[0].fields.map(field=>field.variableId),ids);assert.equal(c.document.webForms[0].fields[0].label,'표시 이름');assert.equal(c.document.behavior.variables.find(variable=>variable.id===ids[0]).initial,'수정한 이름');assert.deepEqual(c.activeSlide.elements,before.slides[0].elements);assert.deepEqual(c.activeSlide.behavior,before.slides[0].behavior);
  const after=c.snapshot();c.undo();assert.deepEqual(c.snapshot(),before);c.redo();assert.deepEqual(c.snapshot(),after);assert.deepEqual(parsePresentation(exportPresentation(after)),after);
});

test('invalid manual form input is rejected before document mutation and existing settings cannot retarget or change field types',()=>{
  const c=new CommandController(),before=c.snapshot();for(const change of [draft=>draft.fields=[],draft=>draft.name='',draft=>draft.fields[1].key='name',draft=>draft.fields[0].maxLength=1,draft=>draft.fields[3].initial=Infinity,draft=>draft.fields[5].options='개발, 개발']){const draft=definition();change(draft);assert.throws(()=>buildWebFormCommands(c.document,c.activeSlideId,draft));assert.deepEqual(c.snapshot(),before);assert.equal(c.undoCount,0);}
  const prepared=buildWebFormCommands(c.document,c.activeSlideId,definition());c.runBatch(prepared.commands,'폼');const current=c.snapshot(),draft=definition();draft.fields[0].type='number';assert.throws(()=>buildWebFormUpdateCommands(c.document,prepared.form.id,draft));assert.deepEqual(c.snapshot(),current);
});
