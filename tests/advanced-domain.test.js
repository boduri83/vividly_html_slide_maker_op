import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CommandController} from '../src/controller.js';
import {normalizeDocument,ADVANCED_SCHEMA,SCENE_SCHEMA} from '../src/model.js';
import {evaluateCommand,evaluateCommands,getCommandCatalog} from '../src/commands.js';
import {planMotionTimeline,motionSegmentCount,formulaValue} from '../src/advanced-motion-model.js';
const legacy=JSON.parse(readFileSync(new URL('../examples/document-contract-v0.1.json',import.meta.url),'utf8'));
const copy=structuredClone,target='element-title-001',shape='element-shape-001';
const track=(extra={})=>({id:'advanced-track',targetId:target,preset:'keyframes',start:'withPrevious',duration:1000,delay:100,easing:'linear',iterations:1,keyframes:[{offset:0,x:0,opacity:0},{offset:1,x:160,opacity:1}],...extra});
const state=(id='state-emphasis')=>({id,name:'강조',style:{fill:'#635bff',color:'#fff',scale:1.05}});
const variable={id:'advanced-choice',name:'연도',initialValue:'a',options:[{value:'a',label:'2025'},{value:'b',label:'2026'}]};
const fixture=()=>{const doc=copy(legacy);doc.schemaVersion=ADVANCED_SCHEMA;doc.variables=[copy(variable)];doc.slides[0].motions=[track()];doc.slides[0].elements.find(e=>e.id===shape).states=[state()];doc.slides[0].interactions=[{id:'advanced-rule',sourceId:target,event:'key',trigger:{key:'a',once:false},condition:{variableId:variable.id,operator:'equals',value:'b'},actions:[{type:'setState',targetId:shape,stateId:'state-emphasis'}]}];return normalizeDocument(doc);};
const get=(c,id)=>c.document.slides.flatMap(s=>s.elements).find(e=>e.id===id);
const request=(c,commands,extra={})=>{const r=c.readCommittedSnapshot().value;return {target:{instanceId:r.instanceId,editorSessionId:r.editorSessionId,documentId:r.documentId},expectedRevision:r.contentRevision,operationId:crypto.randomUUID(),targeting:'id',commands,...extra};};
test('new author features require v5, preserve legacy document shapes, and expose typed capabilities',()=>{
 assert.deepEqual(normalizeDocument(legacy),legacy);const doc=fixture();assert.deepEqual(normalizeDocument(doc),doc);
 const bad=copy(doc);bad.schemaVersion='0.4-business.1';assert.throws(()=>normalizeDocument(bad));
 const plain=copy(legacy);plain.schemaVersion='0.3-motion.1';plain.slides[0].motions=[track()];assert.throws(()=>normalizeDocument(plain));
 const c=new CommandController(legacy);c.setMotions(c.activeSlideId,[track()]);assert.equal(c.document.schemaVersion,ADVANCED_SCHEMA);assert.equal(c.readCapabilities().value.extendedSchemaVersion,'0.15-authoring.1');
 assert.equal(getCommandCatalog().length,106);assert.equal(getCommandCatalog({includeReserved:true}).length,106);
});
test('custom keyframes reject unordered, duplicate, incomplete, nonfinite and executable fields before mutation',()=>{
 for(const change of [m=>m.keyframes[0].offset=.1,m=>m.keyframes[1].offset=.9,m=>m.keyframes.splice(1,0,{offset:0,x:1,opacity:.5}),m=>delete m.keyframes[1].x,m=>m.keyframes[0].scale=Infinity,m=>m.keyframes[0].transform='url(x)',m=>m.preset='fadeIn']){
  const doc=fixture(),before=copy(doc),motion=track();change(motion);const result=evaluateCommand(doc,{id:'slide.set_motions',params:{slideId:doc.slides[0].id,motions:[motion]}});assert.equal(result.ok,false);assert.deepEqual(doc,before);
 }
});
test('absolute group positions, sequential effects and grapheme stagger share a deterministic timeline',()=>{
 const slide={elements:[{id:target,text:{paragraphs:['가👩‍💻é']}}],motions:[track({at:200,stagger:{by:'character',delay:40}}),track({id:'next',preset:'fadeOut',keyframes:undefined,start:'afterPrevious',duration:100,delay:20}),track({id:'clicked',start:'onClick',at:0,delay:0})]};delete slide.motions[1].keyframes;
 const groups=planMotionTimeline(slide);assert.equal(motionSegmentCount(slide.elements[0],slide.motions[0].stagger),3);assert.equal(groups[0].items[0].start,300);assert.equal(groups[0].items[1].start,1400);assert.equal(groups[0].duration,1500);assert.equal(groups[1].items[0].start,0);
 const doc=fixture();doc.slides[0].motions[0].stagger={by:'character',delay:10};doc.slides[0].motions[0].targetId=shape;delete doc.slides[0].elements.find(e=>e.id===shape).text;assert.throws(()=>normalizeDocument(doc),/텍스트/);
 doc.slides[0].motions[0].targetId=target;doc.slides[0].elements.find(e=>e.id===target).text.paragraphs=['가'.repeat(1001)];assert.throws(()=>normalizeDocument(doc),/1000/);
});
test('states and reusable clips commit in one guarded batch with dryRun and shared Undo protection',async()=>{
 const c=new CommandController(legacy),before=copy(c.document),commands=[{id:'element.set_states',params:{elementId:shape,states:[state()]}},{id:'document.set_motion_clips',params:{clips:[{id:'clip-first',name:'첫 씬',tracks:[{slot:0,...(({id,targetId,...rest})=>rest)(track())}]}]}}];
 const preview=await c.applyCommands(request(c,commands,{dryRun:true}));assert.equal(preview.ok,true);assert.deepEqual(c.document,before);assert.equal(c.undoCount,0);
 const result=await c.applyCommands(request(c,commands));assert.equal(result.ok,true);assert.equal(c.undoCount,1);const after=copy(c.document);assert.equal(after.motionClips[0].tracks[0].slot,0);
 c.undo();assert.deepEqual(c.document,before);c.redo();assert.deepEqual(c.document,after);
 const stale=await c.applyCommands({...request(c,commands),expectedRevision:0});assert.equal(stale.ok,false);assert.deepEqual(c.document,after);
});
test('late invalid state reference fails atomically and does not disturb an active human draft',async()=>{
 const c=new CommandController(fixture());c.beginText(target);c.updateText(['미확정']);const before=copy({doc:c.document,text:c.textSession,undo:c.undoCount});
 const denied=await c.applyCommands(request(c,[{id:'element.set_states',params:{elementId:shape,states:[state()]}}]));assert.equal(denied.ok,false);assert.equal(denied.error.code,'EDITOR_BUSY');assert.deepEqual({doc:c.document,text:c.textSession,undo:c.undoCount},before);
 const failed=evaluateCommands(c.document,[{id:'document.set_title',params:{title:'changed'}},{id:'slide.set_interactions',params:{slideId:c.activeSlideId,interactions:[{id:'bad',sourceId:target,event:'click',actions:[{type:'setState',targetId:shape,stateId:'missing'}]}]}}]);assert.equal(failed.ok,false);assert.deepEqual({doc:c.document,text:c.textSession,undo:c.undoCount},before);
});
test('copy, cross-document paste and slide duplication remap state and condition variable references',()=>{
 const c=new CommandController(fixture()),payload=c.copyElements([target,shape]);const ids=c.pasteElements(payload),copies=c.activeSlide.elements.filter(e=>ids.includes(e.id));const copiedShape=copies.find(e=>e.type==='shape'),copiedText=copies.find(e=>e.type==='text');
 const rule=c.activeSlide.interactions.find(i=>i.sourceId===copiedText.id);assert.equal(rule.actions[0].targetId,copiedShape.id);assert.equal(rule.actions[0].stateId,copiedShape.states[0].id);assert.notEqual(rule.actions[0].stateId,'state-emphasis');assert.equal(rule.condition.variableId,variable.id);
 const other=new CommandController(legacy);other.pasteElements(payload);const copiedRule=other.activeSlide.interactions[0];assert.notEqual(copiedRule.condition.variableId,variable.id);assert.equal(copiedRule.condition.variableId,other.document.variables[0].id);assert.deepEqual(normalizeDocument(other.document),other.document);
 const slideId=c.duplicateSlide(c.activeSlideId);const duplicate=c.document.slides.find(s=>s.id===slideId);assert.ok(duplicate.interactions.some(i=>i.actions.some(a=>a.type==='setState')));assert.deepEqual(normalizeDocument(c.document),c.document);
});
test('same-slide copying a source alone retains external state targets and cross-document copying removes them',()=>{
 const c=new CommandController(fixture()),payload=c.copyElements([target]);const [id]=c.pasteElements(payload);assert.equal(c.activeSlide.interactions.find(i=>i.sourceId===id).actions[0].stateId,'state-emphasis');
 const external=copy(legacy);external.id='another-document';const other=new CommandController(external);other.pasteElements(payload);assert.deepEqual(other.activeSlide.interactions||[],[]);
});
test('deleting a state or target cleans only affected actions and Undo restores complete named state rules',()=>{
 const c=new CommandController(fixture()),before=copy(c.document);c.setStates(shape,[]);assert.deepEqual(c.activeSlide.interactions,[]);c.undo();assert.deepEqual(c.document,before);
 c.deleteElement(shape);assert.deepEqual(c.activeSlide.interactions,[]);c.undo();assert.deepEqual(c.document,before);
});
test('safe conditional triggers validate event-specific settings and references',()=>{
 for(const rule of [{event:'key',trigger:{}},{event:'key',trigger:{key:'Escape'}},{event:'click',trigger:{key:'a'}},{event:'inView',trigger:{direction:'down'}},{event:'scroll',trigger:{threshold:2}},{event:'click',condition:{variableId:variable.id,operator:'equals',value:'missing'}}]){
  const doc=fixture();doc.slides[0].interactions[0]={id:'test-trigger',sourceId:target,actions:[{type:'resetState',targetId:shape}],...rule};assert.throws(()=>normalizeDocument(doc));
 }
 const doc=fixture();doc.slides[0].interactions[0].event='scroll';doc.slides[0].interactions[0].trigger={direction:'down',threshold:.25,once:false};assert.deepEqual(normalizeDocument(doc),doc);
 doc.slides[0].interactions[0].event='leave';delete doc.slides[0].interactions[0].trigger;assert.deepEqual(normalizeDocument(doc),doc);
});
test('finite sliders and single-operation formula bindings preserve author choices and explicit failure fallback',()=>{
 const c=new CommandController(fixture());c.setComponent(target,{kind:'slider',variableId:variable.id});const binding={variableId:variable.id,values:[{value:'a',text:'4'},{value:'b',text:'bad'}],format:'number',formula:{operation:'divide',operand:0,fallback:'자료 없음'}};
 c.setBinding(target,binding);assert.deepEqual(formulaValue(binding,'4'),{text:'자료 없음',valid:false});assert.deepEqual(formulaValue({...binding,formula:{operation:'multiply',operand:3,fallback:'?'}},'4'),{text:'12',valid:true});assert.equal(formulaValue(binding,'bad').valid,false);
 assert.ok(c.readDiagnostics().value.diagnostics.some(row=>row.code==='FORMULA_DIVIDE_ZERO'));
 const bad=copy(c.document);bad.slides[0].elements.find(e=>e.id===target).binding.formula.expression='fetch()';assert.throws(()=>normalizeDocument(bad));assert.equal(c.document.variables[0].initialValue,'a');
});
test('rich text save snapshots and ordinary edits never downgrade a v5 document or remove motion/state metadata',()=>{
 const c=new CommandController(fixture());c.beginText(target);c.updateRichText({paragraphs:['한글 제목'],runs:[{paragraph:0,start:0,end:2,bold:true}]});assert.equal(c.snapshot().schemaVersion,ADVANCED_SCHEMA);c.finishText();assert.equal(c.document.schemaVersion,ADVANCED_SCHEMA);c.setFill(shape,'#aabbcc');c.setSlideBusiness(c.activeSlideId,{notes:'노트'});assert.equal(c.document.schemaVersion,ADVANCED_SCHEMA);assert.ok(get(c,shape).states.length);
});
test('clip and state IDs participate in the document-global collision boundary',()=>{
 for(const collision of [target,'advanced-track','advanced-choice','state-emphasis']){const doc=fixture();doc.motionClips=[{id:collision,name:'duplicate',tracks:[{slot:0,...(({id,targetId,...rest})=>rest)(track())}]}];assert.throws(()=>normalizeDocument(doc),/중복/);}
 const doc=fixture();doc.slides[1].elements.find(e=>e.text).states=[state()];assert.throws(()=>normalizeDocument(doc),/중복/);
});
