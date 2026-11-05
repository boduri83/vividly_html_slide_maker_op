import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CommandController} from '../src/controller.js';
import {AUTHORING_SCHEMA,createBlankDocument,normalizeDocument} from '../src/model.js';
import {evaluateCommands} from '../src/commands.js';
import {exportPresentation,parsePresentation} from '../src/format.js';
import {prepareLibraryImport} from '../src/reuse-library.js';
import {componentImpact,compositeIds} from '../src/component-library-model.js';
import {createBusinessTemplate} from '../src/business-templates.js';

const copy=structuredClone;
const target=c=>({instanceId:c.instanceId,editorSessionId:c.editorSessionId,documentId:c.document.id});
const request=(c,commands,extra={})=>({target:target(c),expectedRevision:c.revision,operationId:'component-test',targeting:'id',commands,...extra});
function fixture(activityProvider){
  const c=new CommandController(undefined,{activityProvider}),card=c.addShape('round-rect'),title=c.addText();
  c.setGeometry(card,{x:80,y:100,width:430,height:240});c.setGeometry(title,{x:110,y:125,width:350,height:80});
  c.run('text.set_content',{elementId:title,paragraphs:['card-literal','title-literal']});
  c.selectElements([card,title]);const componentId=c.captureComponent({name:'프로젝트 카드'});
  return{c,card,title,componentId};
}
const instance=(c,id)=>c.document.slides.flatMap(s=>s.componentInstances||[]).find(i=>i.id===id);
const definition=(c,id)=>c.document.componentLibrary.find(d=>d.id===id);
const member=(c,instanceId,type)=>{const i=instance(c,instanceId),d=definition(c,i.componentId),source=d.elements.find(e=>e.type===type);return c.document.slides.flatMap(s=>s.elements).find(e=>e.id===i.elementMap[source.id]);};

test('capture keeps source members unchanged, inserts ordinary selectable groups and fits five canvas ratios',()=>{
  const {c,componentId}=fixture(),source=c.snapshot();assert.equal(source.schemaVersion,AUTHORING_SCHEMA);assert.equal(source.componentLibrary[0].elements.length,2);
  assert.deepEqual(source.componentLibrary[0].elements.find(e=>e.type==='text').text.paragraphs,['card-literal','title-literal']);
  for(const[width,height]of[[1280,720],[1200,900],[1080,1080],[900,1200],[720,1280]]){
    const document=copy(source);document.canvas={width,height,unit:'logical-px'};const editor=new CommandController(document),undo=editor.undoCount,id=editor.insertComponent(componentId),i=instance(editor,id),members=editor.activeSlide.elements.filter(e=>Object.values(i.elementMap).includes(e.id));
    assert.equal(members.length,2);assert.equal(new Set(members.map(e=>e.groupId)).size,1);assert.ok(members.every(e=>e.geometry.x>=0&&e.geometry.y>=0&&e.geometry.x+e.geometry.width<=width+.00001&&e.geometry.y+e.geometry.height<=height+.00001));assert.equal(editor.undoCount,undo+1);
    const inserted=editor.snapshot();editor.undo();assert.deepEqual(editor.snapshot(),document);editor.redo();assert.deepEqual(editor.snapshot(),inserted);assert.deepEqual(parsePresentation(exportPresentation(editor.snapshot())),editor.snapshot());
  }
});

test('source preview is detached; apply propagates visuals once and preserves per-instance text and local styles',()=>{
  const {c,componentId}=fixture(),a=c.insertComponent(componentId,{x:50,y:380}),b=c.insertComponent(componentId,{x:600,y:90});
  const bText=member(c,b,'text'),bCard=member(c,b,'shape'),aCard=member(c,a,'shape');c.run('text.set_content',{elementId:bText.id,paragraphs:['두 번째 프로젝트']});c.setFill(bCard.id,'#fedcba');
  c.setFill(aCard.id,'#5738bb');c.setVisualStyle(aCard.id,{shadow:{x:0,y:9,blur:20,spread:0,color:'#12345644'}});
  const before=c.snapshot(),revision=c.revision,undo=c.undoCount,params={slideId:c.activeSlideId,instanceId:a},preview=c.previewComponentUpdate(componentId,params);
  assert.equal(preview.ok,true);assert.equal(preview.value.changed,true);assert.equal(preview.value.impact.changedElements,1);assert.deepEqual(c.snapshot(),before);assert.equal(c.revision,revision);
  assert.equal(c.updateComponent(componentId,params,{expectedRevision:revision,expectedSessionId:c.sessionId}).ok,true);assert.equal(c.undoCount,undo+1);
  assert.equal(member(c,b,'shape').fill,'#fedcba');assert.equal(member(c,b,'shape').style.shadow.blur,20);assert.deepEqual(member(c,b,'text').text.paragraphs,['두 번째 프로젝트']);
  const after=c.snapshot();c.undo();assert.deepEqual(c.snapshot(),before);c.redo();assert.deepEqual(c.snapshot(),after);
  assert.equal(c.previewComponentUpdate(componentId,params).value.changed,false);assert.deepEqual(componentImpact(after,c.snapshot()),{pages:[],instanceIds:[],changedElements:0});
});

test('normal group transform keeps the instance frame; individual geometry overrides survive later source changes',()=>{
  const {c,componentId}=fixture(),a=c.insertComponent(componentId,{x:30,y:30}),b=c.insertComponent(componentId,{x:600,y:350});
  const ids=Object.values(instance(c,b).elementMap),old=copy(instance(c,b).frame);c.transformElements(ids,{dx:90,dy:35});
  assert.equal(instance(c,b).frame.x,old.x+90);assert.equal(instance(c,b).frame.y,old.y+35);
  const bText=member(c,b,'text'),movedX=bText.geometry.x+18;c.setGeometry(bText.id,{x:movedX});
  const aCard=member(c,a,'shape');c.setStroke(aCard.id,{color:'#991122',width:4});assert.equal(c.updateComponent(componentId,{slideId:c.activeSlideId,instanceId:a}).ok,true);
  assert.equal(member(c,b,'text').geometry.x,movedX);assert.equal(member(c,b,'shape').stroke.width,4);assert.deepEqual(normalizeDocument(c.snapshot()),c.snapshot());
});

test('same-document copies and cross-document page reuse retain editable linked instances with fresh identities',()=>{
  const {c,componentId}=fixture(),a=c.insertComponent(componentId);c.selectElements(Object.values(instance(c,a).elementMap));const payload=c.copyElements();
  c.pasteElements(payload,{offsetX:35,offsetY:20});assert.equal(c.activeSlide.componentInstances.length,2);assert.notEqual(c.activeSlide.componentInstances[0].id,c.activeSlide.componentInstances[1].id);
  const source=c.activeSlideId;c.duplicateSlides([source]);assert.equal(c.activeSlide.componentInstances.length,2);assert.equal(new Set(c.document.slides.flatMap(s=>(s.componentInstances||[]).map(i=>i.id))).size,4);
  const d=new CommandController();d.importSlides(c.document,[c.activeSlideId]);assert.equal(d.activeSlide.componentInstances.length,2);assert.ok(d.activeSlide.componentInstances.every(item=>d.document.componentLibrary.some(source=>source.id===item.componentId)));assert.deepEqual(d.activeSlide.elements.filter(e=>e.type==='text').map(e=>e.text.paragraphs),c.activeSlide.elements.filter(e=>e.type==='text').map(e=>e.text.paragraphs));
  assert.deepEqual(parsePresentation(exportPresentation(c.snapshot())),c.snapshot());assert.deepEqual(parsePresentation(exportPresentation(d.snapshot())),d.snapshot());
});

test('detach and remove preserve all rendered members; a deleted instance member is not resurrected by source updates',()=>{
  const {c,componentId}=fixture(),a=c.insertComponent(componentId),b=c.insertComponent(componentId),cId=c.insertComponent(componentId),bText=member(c,b,'text');
  c.deleteElement(bText.id);assert.ok(!Object.values(instance(c,b).elementMap).includes(bText.id));c.setFill(member(c,a,'shape').id,'#9955aa');c.updateComponent(componentId,{slideId:c.activeSlideId,instanceId:a});assert.ok(!c.activeSlide.elements.some(e=>e.id===bText.id));
  const elements=copy(c.activeSlide.elements);c.detachComponent(c.activeSlideId,cId);assert.deepEqual(c.activeSlide.elements,elements);assert.equal(instance(c,cId),undefined);
  const before=c.snapshot(),undo=c.undoCount;c.removeComponent(componentId);assert.deepEqual(c.activeSlide.elements,before.slides[0].elements);assert.equal(c.activeSlide.componentInstances,undefined);assert.equal(c.undoCount,undo+1);c.undo();assert.deepEqual(c.snapshot(),before);
});

test('private source operations respect CAS, sessions and actual human drafts while only their own dialog lease is exempt',async()=>{
  let activity={};const{c,componentId}=fixture(()=>activity),a=c.insertComponent(componentId),params={slideId:c.activeSlideId,instanceId:a};
  activity={componentLibrary:true};c.setFill(member(c,a,'shape').id,'#1100ff');assert.equal(c.previewComponentUpdate(componentId,params).ok,true);
  const before=c.snapshot(),revision=c.revision;activity={componentLibrary:true,controls:[{fieldId:'property-fill',elementId:member(c,a,'shape').id}]};assert.equal(c.previewComponentUpdate(componentId,params).error.code,'EDITOR_BUSY');assert.equal(c.updateComponent(componentId,params).error.code,'EDITOR_BUSY');assert.deepEqual(c.snapshot(),before);
  activity={};c.beginText(member(c,a,'text').id);c.updateText(['사람의 아직 확정하지 않은 입력']);assert.equal(c.updateComponent(componentId,params).error.code,'EDITOR_BUSY');assert.equal(c.revision,revision);c.finishText();
  c.setTitle('다른 확정 변경');assert.equal(c.updateComponent(componentId,params,{expectedRevision:revision,expectedSessionId:c.sessionId}).error.code,'REVISION_CONFLICT');assert.equal(c.updateComponent(componentId,params,{expectedRevision:c.revision,expectedSessionId:'old-session'}).error.code,'STALE_EDITOR_SESSION');
  activity={componentLibrary:true};const external=await c.applyCommands(request(c,[{id:'document.set_title',params:{title:'거절할 외부 쓰기'}}]));assert.equal(external.error.code,'EDITOR_BUSY');
});

test('component creation and insertion share atomic batch/dryRun and stable metadata without another Undo owner',async()=>{
  const c=new CommandController(),element=c.addShape('rectangle'),before=c.snapshot(),undo=c.undoCount,commands=[{id:'component.capture',params:{componentId:'batch-component',slideId:c.activeSlideId,elementIds:[element],name:'묶음 카드'}},{id:'component.insert',params:{componentId:'batch-component',instanceId:'batch-instance',slideId:c.activeSlideId,x:500,y:100}}];
  const dry=await c.applyCommands(request(c,commands,{dryRun:true}));assert.equal(dry.ok,true);assert.deepEqual(c.snapshot(),before);assert.equal(c.undoCount,undo);
  assert.equal(evaluateCommands(before,[...commands,{id:'shape.set_fill',params:{elementId:'missing',fill:'#ffffff'}}]).ok,false);assert.deepEqual(c.snapshot(),before);
  assert.equal((await c.applyCommands(request(c,commands,{operationId:'actual-component'}))).ok,true);assert.equal(c.undoCount,undo+1);const after=c.snapshot();c.undo();assert.deepEqual(c.snapshot(),before);c.redo();assert.deepEqual(c.snapshot(),after);
});

test('cross-document component import closes asset/style/token dependencies and semantically deduplicates renamed source IDs',()=>{
  const source=new CommandController(JSON.parse(readFileSync(new URL('../examples/document-contract-v0.1.json',import.meta.url),'utf8'))),shape='element-shape-001';source.setStyleTokens([{id:'brand',name:'브랜드 색',type:'color',value:'#8844cc'}]);source.upsertStyleRecipe({id:'brand-card',name:'브랜드 카드',appearance:{css:{background:'var(--v-brand)'}}});source.applyStyleRecipe([shape],'brand-card');
  const image=copy(source.document.slides[1].elements.find(e=>e.type==='image'));image.id='component-image';source.run('elements.insert',{slideId:source.activeSlideId,elements:[image],assets:[]});source.selectElements([shape,image.id]);const componentId=source.captureComponent({name:'브랜드 구성'});
  const d=new CommandController(),before=d.snapshot(),undo=d.undoCount,plan=prepareLibraryImport(d.document,source.document,{componentIds:[componentId]});assert.equal(plan.params.componentLibrary.length,1);assert.equal(plan.assets.length,1);assert.equal(plan.params.styleRecipes.length,1);assert.equal(plan.params.styleTokens.length,1);assert.ok(!JSON.stringify(plan.params).includes('dataBase64'));
  const result=d.importLibrary(source.document,{componentIds:[componentId]});assert.equal(result.ok,true);assert.equal(d.undoCount,undo+1);const imported=d.snapshot();d.undo();assert.deepEqual(d.snapshot(),before);d.redo();assert.deepEqual(d.snapshot(),imported);assert.equal(d.importLibrary(source.document,{componentIds:[componentId]}).value.changed,false);
  const id=result.value.mapping.components[componentId];d.insertComponent(id);assert.equal(d.activeSlide.elements.filter(e=>e.type==='image').length,1);assert.equal(d.document.assets[0].dataBase64,source.document.assets[0].dataBase64);assert.deepEqual(parsePresentation(exportPresentation(d.snapshot())),d.snapshot());
});

test('captured inputs retain their H2 variable and binding semantics across instances and cross-document component import',()=>{
  const c=new CommandController(),field=c.addShape('round-rect');c.run('behavior.set_variables',{variables:[{id:'profile-name',name:'이름',type:'text',initial:'김비비'}]});c.run('behavior.set_inputs',{slideId:c.activeSlideId,inputs:[{id:'name-input',targetId:field,variableId:'profile-name',kind:'text'}]});const componentId=c.captureComponent({name:'입력 필드'}),a=c.insertComponent(componentId);
  const instanceInput=c.activeSlide.behavior.inputs.find(i=>i.targetId===Object.values(instance(c,a).elementMap)[0]);assert.ok(instanceInput);assert.equal(instanceInput.variableId,'profile-name');assert.equal(compositeIds(c.document.componentLibrary[0].behavior).has('profile-name'),false);
  const d=new CommandController(),result=d.importLibrary(c.document,{componentIds:[componentId]});assert.equal(result.ok,true);assert.equal(d.document.behavior.variables.length,1);d.insertComponent(result.value.mapping.components[componentId]);assert.equal(d.activeSlide.behavior.inputs[0].variableId,d.document.behavior.variables[0].id);assert.deepEqual(parsePresentation(exportPresentation(d.snapshot())),d.snapshot());
});

test('old documents open without a schema change and new authored fields survive ordinary edits and normalization',()=>{
  const original=createBlankDocument(),c=new CommandController(original);assert.deepEqual(c.snapshot(),original);const e=c.addShape('rectangle');c.run('document.set_responsive',{responsive:{enabled:true,minWidth:320,maxWidth:1440}});assert.equal(c.document.schemaVersion,AUTHORING_SCHEMA);c.setFill(e,'#112233');c.setGeometry(e,{x:250});c.setTitle('새 형식 자료');c.setVariables([{id:'legacy-number',name:'진행 값',kind:'number',initialValue:'3',options:[],minimum:0,maximum:100,step:1}]);assert.equal(c.document.schemaVersion,AUTHORING_SCHEMA);assert.equal(c.document.responsive.enabled,true);assert.deepEqual(normalizeDocument(c.snapshot()),c.snapshot());
});

test('nested chart-series and state identities survive repeated source updates, clipboard copies and cross-document import',()=>{
  const c=new CommandController(createBusinessTemplate('results')),slide=c.document.slides.find(s=>s.elements.some(e=>e.chart?.variants)),chart=slide.elements.find(e=>e.chart?.variants);c.switchSlide(slide.id);
  c.setStates(chart.id,[{id:'literal-state',name:'literal-state',style:{opacity:.6}}]);c.setMotions(slide.id,[{id:'literal-motion',targetId:chart.id,preset:'fadeIn',start:'onClick',duration:400,delay:0,easing:'linear',iterations:1}]);
  c.setInteractions(slide.id,[{id:'literal-interaction',sourceId:chart.id,event:'click',actions:[{type:'setState',targetId:chart.id,stateId:'literal-state'},{type:'playMotion',motionId:'literal-motion'}]}]);c.selectElements([chart.id]);const componentId=c.captureComponent({name:'연도별 차트'}),a=c.insertComponent(componentId),b=c.insertComponent(componentId),ids=[member(c,a,'chart').states[0].id,member(c,b,'chart').states[0].id];assert.notEqual(ids[0],ids[1]);
  c.setVisualStyle(member(c,a,'chart').id,{opacity:.85});assert.equal(c.updateComponent(componentId,{slideId:c.activeSlideId,instanceId:a}).ok,true);
  assert.equal(member(c,a,'chart').states[0].id,ids[0]);assert.equal(member(c,b,'chart').states[0].id,ids[1]);
  for(const id of[a,b]){const item=instance(c,id),element=member(c,id,'chart'),rule=c.activeSlide.interactions.find(rule=>Object.values(item.interactionMap).includes(rule.id));assert.equal(rule.actions[0].stateId,element.states[0].id);assert.equal(rule.actions[1].motionId,Object.values(item.motionMap)[0]);assert.ok(element.chart.variants.values.every(variant=>variant.series.every(row=>element.chart.series.some(series=>series.id===row.seriesId))));}
  assert.equal(c.previewComponentUpdate(componentId,{slideId:c.activeSlideId,instanceId:a}).value.changed,false);
  const removed=Object.values(instance(c,b).interactionMap)[0];c.setInteractions(c.activeSlideId,c.activeSlide.interactions.filter(rule=>rule.id!==removed));c.setVisualStyle(member(c,a,'chart').id,{opacity:.75});assert.equal(c.updateComponent(componentId,{slideId:c.activeSlideId,instanceId:a}).ok,true);assert.ok(!c.activeSlide.interactions.some(rule=>rule.id===removed));
  c.selectElements(Object.values(instance(c,a).elementMap));c.pasteElements(c.copyElements());assert.equal(c.activeSlide.componentInstances.length,3);assert.deepEqual(parsePresentation(exportPresentation(c.snapshot())),c.snapshot());
  const d=new CommandController(),imported=d.importLibrary(c.document,{componentIds:[componentId]});assert.equal(imported.ok,true);d.insertComponent(imported.value.mapping.components[componentId]);assert.equal(d.importLibrary(c.document,{componentIds:[componentId]}).value.changed,false);assert.deepEqual(normalizeDocument(d.snapshot()),d.snapshot());
});

test('same-document web controls retain H2 inputs and cross-document reuse includes the whole form with one shared Undo',()=>{
  const c=new CommandController(),field=c.addShape('round-rect'),save=c.addShape('round-rect');c.run('behavior.set_variables',{variables:[{id:'profile-field',name:'소개',type:'text',initial:'디자이너'}]});c.run('behavior.set_inputs',{slideId:c.activeSlideId,inputs:[{id:'profile-input',targetId:field,variableId:'profile-field',kind:'textarea'}]});
  c.run('document.set_web_forms',{forms:[{id:'profile-form',name:'프로필',persistence:'local',fields:[{key:'bio',variableId:'profile-field',label:'소개',type:'textarea'}]}]});c.run('element.set_web',{elementId:save,web:{kind:'formAction',formId:'profile-form',action:'save'}});c.selectElements([field,save]);const componentId=c.captureComponent({name:'프로필 폼'}),inserted=c.insertComponent(componentId),ids=Object.values(instance(c,inserted).elementMap);assert.equal(c.activeSlide.elements.filter(e=>ids.includes(e.id)&&e.web?.formId==='profile-form').length,1);assert.equal(c.activeSlide.behavior.inputs.filter(i=>ids.includes(i.targetId)).length,1);
  const d=new CommandController(),before=d.snapshot(),result=d.importLibrary(c.document,{componentIds:[componentId]});assert.equal(result.ok,true,JSON.stringify(result));assert.equal(d.document.webForms.length,1);assert.equal(d.undoCount,1);const imported=d.snapshot();d.undo();assert.deepEqual(d.snapshot(),before);d.redo();assert.deepEqual(d.snapshot(),imported);d.insertComponent(result.value.mapping.components[componentId]);assert.equal(d.activeSlide.behavior.inputs.length,1);assert.equal(d.activeSlide.elements.find(e=>e.web).web.formId,d.document.webForms[0].id);assert.deepEqual(parsePresentation(exportPresentation(d.snapshot())),d.snapshot());
});

test('removing a shared recipe, form or variable cleans reusable sources and keeps their rendered instances valid and undoable',()=>{
  const c=new CommandController(),field=c.addShape('round-rect');c.upsertStyleRecipe({id:'shared-style',name:'공유',appearance:{fill:'#ddccff'}});c.applyStyleRecipe([field],'shared-style');c.run('behavior.set_variables',{variables:[{id:'field-value',name:'입력',type:'text',initial:'내용'}]});c.run('behavior.set_inputs',{slideId:c.activeSlideId,inputs:[{id:'field-input',targetId:field,variableId:'field-value',kind:'text'}]});c.run('document.set_web_forms',{forms:[{id:'field-form',name:'폼',persistence:'none',fields:[{key:'value',variableId:'field-value',label:'입력',type:'text'}]}]});c.run('element.set_web',{elementId:field,web:{kind:'formAction',formId:'field-form',action:'save'}});const componentId=c.captureComponent({name:'입력 카드'});c.insertComponent(componentId);
  const before=c.snapshot(),undo=c.undoCount;c.removeStyleRecipe('shared-style');assert.equal(c.undoCount,undo+1);assert.ok(definition(c,componentId).elements.every(e=>!e.design?.recipeId));c.undo();assert.deepEqual(c.snapshot(),before);c.redo();
  c.run('document.set_web_forms',{forms:[]});assert.ok(definition(c,componentId).elements.every(e=>!e.web));c.run('behavior.set_variables',{variables:[]});assert.equal(definition(c,componentId).behavior?.inputs?.length||0,0);assert.equal(c.activeSlide.behavior?.inputs?.length||0,0);assert.deepEqual(parsePresentation(exportPresentation(c.snapshot())),c.snapshot());
});
