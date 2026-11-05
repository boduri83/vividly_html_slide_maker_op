import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CommandController} from '../src/controller.js';
import {AUTHORING_SCHEMA,createBlankDocument,normalizeDocument} from '../src/model.js';
import {COMMAND_LIMITS,COMMAND_CONTRACT_VERSION,validateCommand} from '../src/commands.js';
import {prepareLibraryImport} from '../src/reuse-library.js';
import {createPortfolioTemplate} from '../src/portfolio-template.js';
import {exportPresentation,parsePresentation} from '../src/format.js';
import {buildWebFormCommands} from '../src/web-authoring-ui.js';

const copy=structuredClone;
const request=(c,commands,extra={})=>({target:{instanceId:c.instanceId,editorSessionId:c.sessionId,documentId:c.document.id},expectedRevision:c.revision,operationId:'closed-reuse23',targeting:'id',commands,...extra});
function formSource(){
  const c=new CommandController(),prepared=buildWebFormCommands(c.document,c.activeSlideId,{name:'프로필',persistence:'local',modal:true,fields:[{key:'name',label:'이름',type:'text',initial:'저자 이름',required:true},{key:'bio',label:'소개',type:'textarea',initial:'저자 소개'},{key:'email',label:'이메일',type:'email',initial:'author@example.com'},{key:'age',label:'경력',type:'number',initial:3}]});
  assert.equal(c.runBatch(prepared.commands),true);c.selectElements(prepared.elementIds);const componentId=c.captureComponent({name:'프로필 입력 창'});return{c,componentId,formId:c.document.webForms[0].id};
}
function pagesSource(){
  const c=new CommandController(),a=c.activeSlideId,aButton=c.addShape('rectangle'),b=c.addSlide(),bButton=c.addShape('round-rect'),bText=c.addText();c.run('text.set_content',{elementId:bText,paragraphs:['source-target-literal']});
  const third=c.addSlide(),cButton=c.addShape('ellipse'),unrelated=c.addSlide();
  c.setInteractions(a,[{id:'link-to-b',sourceId:aButton,event:'click',actions:[{type:'goToSlide',targetId:b}]}]);
  c.run('behavior.set_rules',{slideId:b,rules:[{id:'navigate-to-c',name:'다음 상세',event:'click',sourceId:bButton,actions:[{type:'navigate',slideId:third}]}]});
  c.setInteractions(third,[{id:'back-to-b',sourceId:cButton,event:'click',actions:[{type:'goToSlide',targetId:b}]}]);
  c.run('element.set_web',{elementId:cButton,web:{kind:'scrollLink',targetId:bText}});
  c.switchSlide(a);c.selectElements([aButton]);const componentId=c.captureComponent({name:'상세 페이지 이동'});return{c,a,b,third,unrelated,aButton,bButton,bText,cButton,componentId};
}

test('a reusable form brings all field settings and author initials, remaps panels and remains editable with one Undo/HTML',()=>{
  const{c:source,componentId,formId}=formSource(),target=new CommandController(),before=target.snapshot(),sourceBefore=source.snapshot();
  const preview=target.previewLibraryImport(source.document,{componentIds:[componentId]});assert.equal(preview.ok,true,JSON.stringify(preview));assert.equal(preview.value.summary.requiredItems.forms.length,1);assert.equal(preview.value.summary.added.forms,1);assert.deepEqual(target.snapshot(),before);
  const result=target.importLibrary(source.document,{componentIds:[componentId]});assert.equal(result.ok,true,JSON.stringify(result));assert.equal(target.undoCount,1);assert.equal(target.document.behavior.variables.length,4);assert.deepEqual(target.document.behavior.variables.map(v=>v.initial),source.document.behavior.variables.map(v=>v.initial));
  const imported=target.snapshot();target.undo();assert.deepEqual(target.snapshot(),before);target.redo();assert.deepEqual(target.snapshot(),imported);
  const id=target.insertComponent(result.value.mapping.components[componentId]),instance=target.activeSlide.componentInstances.find(i=>i.id===id),members=target.activeSlide.elements.filter(e=>Object.values(instance.elementMap).includes(e.id));
  const form=target.document.webForms.find(f=>f.id===result.value.mapping.forms[formId]),save=members.find(e=>e.web?.action==='save'),panel=members.find(e=>e.component?.kind==='panel');assert.equal(save.web.formId,form.id);assert.equal(save.web.closePanelId,panel.id);assert.ok(target.activeSlide.behavior.inputs.every(input=>form.fields.some(field=>field.variableId===input.variableId)));
  target.run('behavior.set_variables',{variables:target.document.behavior.variables.map((v,i)=>i? v:{...v,initial:'사람이 수정한 기본값'})});assert.equal(target.document.behavior.variables[0].initial,'사람이 수정한 기본값');
  assert.deepEqual(parsePresentation(exportPresentation(target.snapshot())),target.snapshot());assert.deepEqual(source.snapshot(),sourceBefore);
});

test('mixed navigation closes only required complete pages, handles cycles, scroll destinations and preserves literal content',()=>{
  const source=pagesSource(),target=new CommandController(),result=target.importLibrary(source.c.document,{componentIds:[source.componentId]});assert.equal(result.ok,true,JSON.stringify(result));const mapping=result.value.mapping;
  assert.deepEqual(Object.keys(mapping.slides).sort(),[source.b,source.third].sort());assert.equal(target.document.slides.length,3);assert.equal(mapping.slides[source.unrelated],undefined);
  const b=target.document.slides.find(s=>s.id===mapping.slides[source.b]),third=target.document.slides.find(s=>s.id===mapping.slides[source.third]),definition=target.document.componentLibrary.find(d=>d.id===mapping.components[source.componentId]);
  assert.equal(b.elements.length,source.c.document.slides.find(s=>s.id===source.b).elements.length);assert.equal(definition.interactions[0].actions[0].targetId,b.id);assert.equal(b.behavior.rules[0].actions[0].slideId,third.id);assert.equal(third.interactions[0].actions[0].targetId,b.id);assert.equal(third.elements.find(e=>e.web).web.targetId,mapping.elements[source.bText]);assert.equal(b.elements.find(e=>e.id===mapping.elements[source.bText]).text.paragraphs[0],'source-target-literal');
  assert.deepEqual(normalizeDocument(target.snapshot()),target.snapshot());assert.deepEqual(parsePresentation(exportPresentation(target.snapshot())),target.snapshot());
});

test('a colliding source page ID never binds to an unrelated destination page or overwrites it',()=>{
  const source=pagesSource(),document=createBlankDocument();document.slides[0].id=source.b;const target=new CommandController(document),old=copy(target.document.slides[0]),result=target.importLibrary(source.c.document,{componentIds:[source.componentId]});assert.equal(result.ok,true,JSON.stringify(result));
  assert.notEqual(result.value.mapping.slides[source.b],source.b);assert.deepEqual(target.document.slides[0],old);assert.equal(target.document.componentLibrary[0].interactions[0].actions[0].targetId,result.value.mapping.slides[source.b]);
});

test('reimport reuses a complete graph and preserves locally edited pages by adding a fresh graph on source reimport',()=>{
  const source=pagesSource(),target=new CommandController(),selection={componentIds:[source.componentId]},first=target.importLibrary(source.c.document,selection);assert.equal(first.ok,true,JSON.stringify(first));const after=target.snapshot(),revision=target.revision,undo=target.undoCount;
  const repeated=target.importLibrary(source.c.document,selection);assert.equal(repeated.ok,true,JSON.stringify(repeated));assert.equal(repeated.value.changed,false);assert.deepEqual(target.snapshot(),after);assert.equal(target.revision,revision);assert.equal(target.undoCount,undo);
  const oldPage=first.value.mapping.slides[source.b],oldText=first.value.mapping.elements[source.bText];target.run('text.set_content',{elementId:oldText,paragraphs:['대상에서 수정한 내용']});const locallyEdited=copy(target.document.slides.find(s=>s.id===oldPage));const fresh=target.importLibrary(source.c.document,selection);assert.equal(fresh.ok,true,JSON.stringify(fresh));assert.notEqual(fresh.value.mapping.slides[source.b],oldPage);assert.deepEqual(target.document.slides.find(s=>s.id===oldPage),locallyEdited);
  const again=target.importLibrary(source.c.document,selection);assert.equal(again.ok,true,JSON.stringify(again));assert.equal(again.value.changed,false);assert.deepEqual(again.value.mapping,fresh.value.mapping);
});

test('form variables with identical initials stay isolated from unrelated target variables and other forms',()=>{
  const source=new CommandController();source.run('behavior.set_variables',{variables:[{id:'a-value',name:'공유 이름',type:'text',initial:'같은 값'},{id:'b-value',name:'공유 이름',type:'text',initial:'같은 값'}]});
  source.run('document.set_web_forms',{forms:['a','b'].map(key=>({id:key+'-form',name:'프로필',persistence:'local',fields:[{key:'name',variableId:key+'-value',label:'이름',type:'text'}]}))});
  const target=new CommandController();target.run('behavior.set_variables',{variables:[{id:'unrelated-value',name:'공유 이름',type:'text',initial:'같은 값'}]});const result=target.importLibrary(source.document,{formIds:['a-form','b-form']});assert.equal(result.ok,true,JSON.stringify(result));assert.equal(target.document.behavior.variables.length,3);const ids=target.document.webForms.map(f=>f.fields[0].variableId);assert.equal(new Set(ids).size,2);assert.ok(ids.every(id=>id!=='unrelated-value'));assert.equal(target.importLibrary(source.document,{formIds:['a-form','b-form']}).value.changed,false);
});

test('closed imports support common dryRun/late-failure atomicity, exact one Undo and CAS/human draft protection',async()=>{
  const{c:source,componentId}=formSource(),target=new CommandController(),plan=prepareLibraryImport(target.document,source.document,{componentIds:[componentId]}),command={id:'library.import',params:plan.params},before=target.snapshot();
  const dry=await target.applyCommands(request(target,[command],{dryRun:true}));assert.equal(dry.ok,true,JSON.stringify(dry));assert.deepEqual(target.snapshot(),before);assert.equal(target.undoCount,0);
  const bad=await target.applyCommands(request(target,[command,{id:'element.set_fill',params:{elementId:'missing',fill:'#ff0000'}}]));assert.equal(bad.ok,false);assert.deepEqual(target.snapshot(),before);assert.equal(target.undoCount,0);
  const applied=await target.applyCommands(request(target,[command]));assert.equal(applied.ok,true,JSON.stringify(applied));assert.equal(target.undoCount,1);target.undo();assert.deepEqual(target.snapshot(),before);
  const local=target.addText();target.beginText(local);target.updateText(['미확정 사람 입력']);const unchanged=target.snapshot();assert.equal(target.importLibrary(source.document,{componentIds:[componentId]}).error.code,'EDITOR_BUSY');assert.deepEqual(target.snapshot(),unchanged);target.finishText();
  assert.equal(target.importLibrary(source.document,{componentIds:[componentId]},{expectedRevision:0,expectedSessionId:target.sessionId}).error.code,'REVISION_CONFLICT');
});

test('external slide import uses the same complete graph and retains links; same-document duplication keeps ordinary behavior',()=>{
  const source=pagesSource(),target=new CommandController(),before=target.snapshot(),created=target.importSlides(source.c.document,[source.a],0);assert.equal(created.length,3);assert.equal(target.undoCount,1);assert.equal(target.document.slides[0].id,created[0]);const imported=target.snapshot();
  for(const page of target.document.slides.filter(s=>created.includes(s.id)))for(const interaction of page.interactions||[])for(const action of interaction.actions)if(action.type==='goToSlide')assert.ok(created.includes(action.targetId));
  target.undo();assert.deepEqual(target.snapshot(),before);target.redo();assert.deepEqual(target.snapshot(),imported);const duplicated=target.duplicateSlides([created[0]]);assert.equal(duplicated.length,1);assert.deepEqual(normalizeDocument(target.snapshot()),target.snapshot());
});

test('untrusted imported form fields, web controls and instance maps reject atomically instead of being cleaned away',async()=>{
  const{c:source,componentId}=formSource(),target=new CommandController(),plan=prepareLibraryImport(target.document,source.document,{slideIds:[source.activeSlideId],componentIds:[componentId]}),before=target.snapshot();
  const mutations=[p=>p.webForms[0].fields[0].variableId='missing-variable',p=>p.webForms[0].fields[0].type='number',p=>p.slides[0].elements.find(e=>e.web).web.formId='missing-form',p=>p.slides[0].interactions[0].actions=[{type:'goToSlide',targetId:'missing-page'}],p=>p.slides[0].behavior.inputs[0].targetId='missing-input-host',p=>p.slides[0].behavior.rules=[{id:'bad-import-nav',name:'누락 목적지',event:'click',sourceId:p.slides[0].elements[0].id,actions:[{type:'navigate',slideId:'missing-page'}]}]];
  const withInstance=source.insertComponent(componentId);assert.ok(withInstance);const linked=prepareLibraryImport(target.document,source.document,{slideIds:[source.activeSlideId]});
  for(const mutate of mutations){const params=copy(plan.params);mutate(params);const result=await target.applyCommands(request(target,[{id:'library.import',params}]));assert.equal(result.ok,false);assert.deepEqual(target.snapshot(),before);assert.equal(target.undoCount,0);}
  const malformed=copy(linked.params),instance=malformed.slides[0].componentInstances[0],key=Object.keys(instance.elementMap)[0];instance.elementMap[key]='missing-member';
  const result=await target.applyCommands(request(target,[{id:'library.import',params:malformed}]));assert.equal(result.ok,false);assert.deepEqual(target.snapshot(),before);assert.equal(target.undoCount,0);
  const invalidSource=source.snapshot(),sourceInstance=invalidSource.slides[0].componentInstances[0];sourceInstance.elementMap[Object.keys(sourceInstance.elementMap)[0]]='missing-source-member';assert.equal(target.importLibrary(invalidSource,{slideIds:[source.activeSlideId]}).ok,false);assert.deepEqual(target.snapshot(),before);
});

test('a same-ID fork is an external source while an exact current snapshot still duplicates locally',()=>{
  const source=pagesSource(),targetDocument=source.c.snapshot(),oldDestination=targetDocument.slides.find(page=>page.id===source.b);oldDestination.elements.find(element=>element.id===source.bText).text.paragraphs=['무관한 분기 페이지'];const target=new CommandController(targetDocument),old=copy(target.document.slides);
  const ids=target.importSlides(source.c.document,[source.a]);assert.equal(ids.length,3);assert.ok(ids.every(id=>!old.some(page=>page.id===id)));assert.deepEqual(target.document.slides.filter(page=>old.some(previous=>previous.id===page.id)),old);
  const duplicated=target.duplicateSlides([ids[0]]);assert.equal(duplicated.length,1);assert.deepEqual(normalizeDocument(target.snapshot()),target.snapshot());
});

test('the actual 0.22 portfolio fits one bounded metadata command and retains 176 editable elements, six instances and one form',async()=>{
  const source=createPortfolioTemplate(),target=new CommandController(),before=target.snapshot(),plan=prepareLibraryImport(target.document,source,{slideIds:[source.slides[0].id]}),command={id:'library.import',params:plan.params};
  assert.equal(COMMAND_CONTRACT_VERSION,'vividly.commands/0.23');assert.ok(Buffer.byteLength(JSON.stringify(command))<COMMAND_LIMITS.bytes);assert.equal(validateCommand(command).ok,true);assert.ok(!JSON.stringify(command).includes('dataBase64'));
  const preview=target.previewLibraryImport(source,{slideIds:[source.slides[0].id]});assert.equal(preview.ok,true,JSON.stringify({error:preview.error}));assert.deepEqual(target.snapshot(),before);const applied=await target.applyCommands(request(target,[command]));assert.equal(applied.ok,true,JSON.stringify({error:applied.error}));assert.equal(target.undoCount,1);const page=target.document.slides.find(s=>s.id===plan.mapping.slides[source.slides[0].id]);assert.equal(page.elements.length,176);assert.equal(page.componentInstances.length,6);assert.equal(target.document.webForms.length,1);assert.equal(target.document.behavior.variables.length,4);assert.equal(target.document.schemaVersion,AUTHORING_SCHEMA);
  const after=target.snapshot();target.undo();assert.deepEqual(target.snapshot(),before);target.redo();assert.deepEqual(target.snapshot(),after);assert.deepEqual(parsePresentation(exportPresentation(after)),after);
});

test('complete linked scene pages retain following bodies, initial sprite clips, HUD, typed behavior and exact audio bytes',()=>{
  const source=JSON.parse(readFileSync(new URL('../examples/scene-showcase.json',import.meta.url),'utf8')),target=new CommandController(),result=target.importLibrary(source,{slideIds:[source.slides[1].id]});assert.equal(result.ok,true,JSON.stringify({error:result.error}));
  for(const original of source.slides){const mapped=result.value.mapping.slides[original.id];if(!mapped)continue;const page=target.document.slides.find(p=>p.id===mapped),ids=new Set(page.elements.map(e=>e.id));
    assert.equal(page.scene.bodies.length,original.scene.bodies.length);for(const body of page.scene.bodies){assert.ok(ids.has(body.targetId));if(body.followTargetId)assert.ok(page.scene.bodies.some(other=>other.targetId===body.followTargetId));}
    for(const sprite of page.scene.sprites){assert.ok(ids.has(sprite.targetId));assert.ok(sprite.clips.some(clip=>clip.id===sprite.initialClipId));}
    assert.ok(page.scene.hudIds.every(id=>ids.has(id)));for(const audio of page.scene.audio){const incoming=target.document.assets.find(a=>a.id===audio.assetId),old=source.assets.find(a=>a.id===original.scene.audio.find(a=>a.name===audio.name).assetId);assert.equal(incoming.dataBase64,old.dataBase64);assert.equal(incoming.sha256,old.sha256);}
  }
  assert.deepEqual(normalizeDocument(target.snapshot()),target.snapshot());assert.deepEqual(parsePresentation(exportPresentation(target.snapshot())),target.snapshot());
});
