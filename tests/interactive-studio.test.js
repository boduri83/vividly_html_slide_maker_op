import test from 'node:test';
import assert from 'node:assert/strict';
import {CommandController} from '../src/controller.js';
import {normalizeDocument} from '../src/model.js';
import {evaluateCommands} from '../src/commands.js';
import {exportPresentation,parsePresentation} from '../src/format.js';
import {numericVariableValue,validVariableValue} from '../src/motion-model.js';
import {createInteractiveGame} from '../src/interactive-examples.js';
const prefix='vividly-click-game-',id=s=>prefix+s;
const request=(c,commands,extra={})=>{const r=c.readCommittedSnapshot().value;return{target:{instanceId:r.instanceId,editorSessionId:r.editorSessionId,documentId:r.documentId},expectedRevision:r.contentRevision,operationId:crypto.randomUUID(),targeting:'id',commands,...extra};};

test('editable game keeps numeric data, CSS states and interaction-only routes through HTML save/reopen',()=>{
  const doc=createInteractiveGame(),html=exportPresentation(doc);assert.deepEqual(parsePresentation(html),doc);assert.deepEqual(normalizeDocument(doc),doc);assert.equal(doc.slides.length,3);assert.ok(doc.slides.every(s=>s.transition.navigation==='interaction'));
  assert.equal(doc.variables[0].kind,'number');assert.deepEqual(doc.variables[0].options,[]);assert.ok(doc.slides[1].interactions.some(r=>r.condition?.operator==='greaterOrEqual'));assert.match(html,/function createPresentationRuntime/);
});
test('numeric values reject executable, nonfinite, off-grid and invalid range data before mutation',()=>{
  const initial=createInteractiveGame();for(const change of [v=>v.initialValue='NaN',v=>v.initialValue='fetch()',v=>v.minimum=101,v=>v.step=0,v=>v.initialValue='.5',v=>v.options.push({value:'1',label:'one'}),v=>v.eval='x']){const doc=structuredClone(initial);change(doc.variables[0]);assert.throws(()=>normalizeDocument(doc));}
  const v={...initial.variables[0],minimum:-2,maximum:2,step:.1};assert.equal(validVariableValue(v,'-.5'),true);assert.equal(validVariableValue(v,'-.55'),false);assert.equal(numericVariableValue(v,10),'2');assert.equal(numericVariableValue(v,-10),'-2');assert.equal(numericVariableValue(v,.26),'.3'.replace(/^\./,'0.'));
});
test('counter binding, increments and numeric conditions validate closed references and single terminal routes',()=>{
  const seed=createInteractiveGame();for(const change of [d=>d.slides[1].interactions[0].actions[0].variableId='missing',d=>d.slides[1].interactions[0].actions[0].amount=Infinity,d=>d.slides[1].interactions[3].condition.value='javascript:1',d=>d.slides[1].elements.find(e=>e.binding).binding.values.push({value:'1',text:'one'}),d=>d.slides[0].interactions[0].actions.push({type:'addVariable',variableId:id('score'),amount:1})]){const d=structuredClone(seed);change(d);assert.throws(()=>normalizeDocument(d));}
  const c=new CommandController(seed),before=structuredClone(c.document),out=evaluateCommands(c.document,[{id:'document.set_title',params:{title:'changed'}},{id:'slide.set_interactions',params:{slideId:c.activeSlideId,interactions:[{id:'bad',sourceId:id('start'),event:'click',actions:[{type:'addVariable',variableId:'missing',amount:1}]}]}}]);assert.equal(out.ok,false);assert.deepEqual(c.document,before);
});
test('shared numeric edits support guarded dryRun, one Undo/Redo and preserve the author initial value',async()=>{
  const c=new CommandController(createInteractiveGame()),before=structuredClone(c.document),variables=structuredClone(c.document.variables);variables[0].maximum=200;
  const commands=[{id:'document.set_variables',params:{variables}},{id:'slide.set_transition',params:{slideId:c.activeSlideId,transition:{type:'fade',duration:200,easing:'ease',navigation:'sequential'}}}];
  assert.equal((await c.applyCommands(request(c,commands,{dryRun:true}))).ok,true);assert.deepEqual(c.document,before);assert.equal(c.undoCount,0);
  assert.equal((await c.applyCommands(request(c,commands))).ok,true);assert.equal(c.undoCount,1);const after=structuredClone(c.document);assert.equal(after.variables[0].initialValue,'0');c.undo();assert.deepEqual(c.document,before);c.redo();assert.deepEqual(c.document,after);
});
test('copy and cross-document import remap increment/condition variables and all game navigation',()=>{
  const c=new CommandController(createInteractiveGame());c.switchSlide(id('play'));const payload=c.copyElements([id('target'),id('score-text')]);assert.equal(payload.variables.length,1);
  const fresh=new CommandController(),created=fresh.pasteElements(payload),counter=fresh.activeSlide.elements.find(e=>e.binding);assert.ok(created.includes(counter.id));const r=fresh.activeSlide.interactions.find(r=>r.actions.some(a=>a.type==='addVariable'));assert.equal(r.actions[0].variableId,fresh.document.variables[0].id);assert.notEqual(r.actions[0].variableId,id('score'));assert.deepEqual(normalizeDocument(fresh.document),fresh.document);
  const destination=new CommandController(),source=createInteractiveGame();const ids=destination.importSlides(source,source.slides.map(s=>s.id),1);const imported=destination.document.slides.filter(s=>ids.includes(s.id));assert.equal(imported.length,3);for(const s of imported)for(const a of s.interactions.flatMap(r=>r.actions))if(a.type==='goToSlide')assert.ok(ids.includes(a.targetId));
});
test('numeric deletion cleans only affected links and retains CSS behavior with Undo restoration',()=>{
  const c=new CommandController(createInteractiveGame()),before=structuredClone(c.document);c.setVariables([]);assert.equal(c.document.slides[1].elements.some(e=>e.binding),false);assert.ok(c.document.slides[1].interactions.some(r=>r.actions.some(a=>a.type==='setState')));assert.equal(c.document.slides[1].interactions.some(r=>r.condition),false);assert.equal(c.document.slides[1].interactions.some(r=>r.actions.some(a=>a.type==='addVariable')),false);c.undo();assert.deepEqual(c.document,before);
});
