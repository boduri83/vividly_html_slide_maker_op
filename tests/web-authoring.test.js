import test from 'node:test';
import assert from 'node:assert/strict';
import {CommandController} from '../src/controller.js';
import {normalizeDocument} from '../src/model.js';
import {createBehaviorRuntime} from '../src/behavior-runtime.js';
import {createBehaviorEvaluator} from '../src/behavior-model.js';
import {buildWebFormCommands} from '../src/web-authoring-ui.js';
import {normalizeWebControl,normalizeWebForms} from '../src/web-authoring-model.js';
import {exportPresentation,parsePresentation} from '../src/format.js';

function fixture(){
  const c=new CommandController();let seq=0;
  const prepared=buildWebFormCommands(c.snapshot(),c.activeSlideId,{name:'프로필',persistence:'local',modal:false,fields:[{key:'name',label:'이름',type:'text',initial:'기획자',required:true,maxLength:30},{key:'bio',label:'소개',type:'textarea',initial:'두 줄\n소개',maxLength:500},{key:'email',label:'이메일',type:'email',initial:'',maxLength:150}]},{createId:prefix=>prefix+'-web-'+(++seq)});
  c.runBatch(prepared.commands,'입력 폼 만들기');return{c,form:c.document.webForms[0]};
}
test('web form groups use existing typed behavior variables and editable inputs with one shared Undo and exact HTML',()=>{
  const {c,form}=fixture();assert.equal(c.undoCount,1);assert.equal(c.document.schemaVersion,'0.15-authoring.1');
  const source=c.snapshot();assert.equal(form.fields.length,3);assert.deepEqual(c.activeSlide.behavior.inputs.map(i=>i.kind),['text','textarea','email']);
  assert.equal(c.activeSlide.elements.filter(e=>e.web?.kind==='formAction').length,3);
  assert.deepEqual(normalizeDocument(source),source);assert.deepEqual(parsePresentation(exportPresentation(source)),source);
  c.undo();assert.equal(c.document.webForms,undefined);assert.equal(c.activeSlide.elements.length,0);c.redo();assert.deepEqual(c.snapshot(),source);
});
test('runtime form restoration validates the whole patch atomically and does not alter author data or fire input change rules',()=>{
  const {c,form}=fixture(),source=c.snapshot(),runtime=createBehaviorRuntime({document:source,createEvaluator:createBehaviorEvaluator});runtime.enterSlide(c.activeSlideId);
  const [name,bio,email]=form.fields.map(f=>f.variableId),initial=runtime.getState().variables;
  assert.equal(runtime.setRuntimeValues({[name]:'수정됨',[bio]:42}),false);assert.deepEqual(runtime.getState().variables,initial);
  assert.equal(runtime.setRuntimeValues({[name]:'새 이름',[bio]:'새 소개',[email]:'hello@example.com'}),true);
  assert.equal(runtime.getState().variables[name],'새 이름');assert.deepEqual(c.snapshot(),source);assert.equal(c.undoCount,1);
  assert.equal(runtime.setRuntimeValues({unknown:'bad'}),false);assert.equal(runtime.setRuntimeValues({[name]:'x'.repeat(4097)}),false);
  runtime.destroy();assert.equal(runtime.setRuntimeValues({[name]:'종료 뒤 변경'}),false);
});
test('closed web metadata rejects executable or ambiguous settings and invalid key/type combinations',()=>{
  assert.throws(()=>normalizeWebControl({kind:'scrollLink',targetId:'target',code:'alert(1)'}));
  assert.throws(()=>normalizeWebForms([{id:'form',name:'폼',persistence:'cloud',fields:[]} ]));
  const {c,form}=fixture(),before=c.snapshot(),count=c.undoCount;
  assert.throws(()=>c.run('element.set_web',{elementId:c.activeSlide.elements[0].id,web:{kind:'scrollLink',targetId:'missing'}}));
  assert.deepEqual(c.snapshot(),before);assert.equal(c.undoCount,count);
  assert.throws(()=>c.run('document.set_web_forms',{forms:[{...form,fields:[{...form.fields[0],variableId:'missing'}]}]}));
  assert.deepEqual(c.snapshot(),before);assert.equal(c.undoCount,count);
  assert.throws(()=>normalizeDocument({...before,webForms:[{...form,fields:[form.fields[0],form.fields[0]]}]}));
});
