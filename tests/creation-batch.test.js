import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {CommandController} from '../src/controller.js';
import {createBlankDocument,normalizeDocument} from '../src/model.js';
import {getCommandCatalog,evaluateCommands,COMMAND_CONTRACT_VERSION} from '../src/commands.js';
import {exportPresentation,parsePresentation,validateAssetBytes} from '../src/format.js';
import {creationRequestSeed} from '../src/creation-context.js';

const fixture=JSON.parse(await fs.readFile(new URL('../examples/document-contract-v0.1.json',import.meta.url),'utf8'));
const clone=structuredClone,ref=$ref=>({$ref}),command=(id,params)=>({id,params}),box={x:50,y:60,width:500,height:90};
const target=c=>{const r=c.readEditorState().value;return{instanceId:r.instanceId,editorSessionId:r.editorSessionId,documentId:r.documentId};};
const request=(c,commands,operationId='create-flow')=>({target:target(c),expectedRevision:c.revision,operationId,targeting:'id',commands});
const setup=(document=createBlankDocument(),options={})=>{const c=new CommandController(document,{agentPreparationGate:()=>Promise.resolve(),...options});c.setAgentGrant('generation-agent');c.setIOGrant('generation-io');return c;};
const options=entries=>({grantId:'generation-agent',ioGrantId:'generation-io',...(entries?{stagedAssets:entries}:{})});
function threePages(c,assetId){return[
  command('document.set_title',{title:'함께 만드는 제안서'}),
  command('slide.create',{clientRef:'cover',name:'소개',background:'#f4f7ff'}),
  command('element.create_text',{clientRef:'title',slideId:ref('cover'),geometry:box,paragraphs:['한국어 제안서'],textStyle:{bold:true,fontSize:48}}),
  command('element.create_shape',{clientRef:'badge',slideId:ref('cover'),geometry:{...box,y:200,width:220,height:100},fill:'#3456ef'}),
  command('slide.create',{clientRef:'body',afterSlideId:ref('cover'),name:'핵심 내용'}),
  command('element.create_text',{clientRef:'body-title',slideId:ref('body'),geometry:box,paragraphs:['사람이 개체별로 수정합니다.']}),
  command('element.duplicate',{clientRef:'body-badge',elementId:ref('badge'),slideId:ref('body'),offsetX:40,offsetY:0}),
  command('shape.set_fill',{elementId:ref('body-badge'),fill:'#e45678'}),
  command('slide.create',{clientRef:'closing',afterSlideId:ref('body'),name:'다음 단계'}),
  command('element.create_image',{clientRef:'logo',slideId:ref('closing'),geometry:{x:80,y:90,width:120,height:120},assetId,alt:'승인한 이미지'}),
  command('element.create_text',{clientRef:'closing-title',slideId:ref('closing'),geometry:{...box,y:280},paragraphs:['저장하고 다시 편집하세요.']}),
  command('slide.delete',{slideId:c.activeSlideId}),
];}
test('six creation commands are executable closed schemas in v20 with explicit typed references',()=>{
 const catalog=getCommandCatalog();assert.equal(catalog.length,106);assert.equal(getCommandCatalog({includeReserved:true}).filter(c=>c.availability==='reserved').length,0);assert.equal(COMMAND_CONTRACT_VERSION,'vividly.commands/0.23');
 const schema=catalog.find(c=>c.id==='element.create_text').inputSchema;assert.equal(schema.additionalProperties,false);assert.equal(schema.properties.slideId.anyOf[1].properties.$ref.type,'string');assert.equal(schema.properties.paragraphs.items.type,'string');
});
test('three editable pages with staged PNG, aliases and duplicate commit in one shared Undo after an unchanged preview',async()=>{
 const c=setup(),original=clone(c.document),entries=[{asset:{...fixture.assets[0],id:'approved-logo'}}],input=request(c,threePages(c,'approved-logo'));
 const preview=await c.previewCommands(input,options(entries));assert.equal(preview.ok,true,JSON.stringify(preview));assert.deepEqual(c.document,original);assert.equal(c.undoCount,0);
 const applied=await c.invokeOperation('applyCommands',input,options(entries));assert.equal(applied.ok,true,JSON.stringify(applied));assert.deepEqual(applied.value.createdIds,preview.value.createdIds);assert.equal(c.document.slides.length,3);assert.equal(c.document.assets.length,1);assert.equal(c.undoCount,1);
 const ids=applied.value.createdIds;assert.equal(c.document.slides[0].id,ids.cover);assert.equal(c.document.slides[1].elements.find(e=>e.id===ids['body-badge']).fill,'#e45678');assert.equal(c.document.slides[2].elements.find(e=>e.id===ids.logo).assetId,'approved-logo');
 const after=clone(c.document);c.undo();assert.deepEqual(c.document,original);c.redo();assert.deepEqual(c.document,after);
 const replay=await c.invokeOperation('applyCommands',input,options(entries));assert.equal(replay.ok,true);assert.equal(replay.receipt.replayed,true);assert.deepEqual(replay.value.createdIds,ids);assert.equal(c.undoCount,1);
 assert.deepEqual(await validateAssetBytes(parsePresentation(exportPresentation(c.snapshot()))),after);
 c.selectElements([ids.title],{expandGroups:false});c.beginText(ids.title);c.updateText(['사람이 고친 제목']);c.finishText();c.setFill(ids.badge,'#102030');c.setGeometry(ids.logo,{x:400});assert.equal(c.document.slides[0].elements.find(e=>e.id===ids.title).text.paragraphs[0],'사람이 고친 제목');assert.equal(c.document.slides[0].elements.find(e=>e.id===ids.badge).fill,'#102030');assert.equal(c.document.slides[2].elements.find(e=>e.id===ids.logo).geometry.x,400);
 assert.deepEqual(parsePresentation(exportPresentation(c.snapshot())),c.snapshot());
});
test('canonical request keys, labels and dryRun flags cannot change a verified creation ID map',async()=>{
 const c=setup(),input=request(c,[command('slide.create',{clientRef:'page',name:'키 순서'}),command('element.create_text',{clientRef:'text',slideId:ref('page'),geometry:box,paragraphs:['고정된 ID']})]);
 const reordered={commands:input.commands.map(c=>({params:Object.fromEntries(Object.entries(c.params).reverse()),id:c.id})),targeting:'id',operationId:input.operationId,expectedRevision:input.expectedRevision,target:Object.fromEntries(Object.entries(input.target).reverse()),label:'다른 표시 설명',dryRun:false};
 assert.equal(await creationRequestSeed(input),await creationRequestSeed(reordered));const before=await c.previewCommands(input),after=await c.applyCommands(reordered);assert.equal(after.ok,true,JSON.stringify(after));assert.deepEqual(after.value.createdIds,before.value.createdIds);
});
test('forward, unknown, duplicate and misplaced references reject the whole batch without allocating author state',async()=>{
 const c=setup(),before=clone(c.document),create=command('slide.create',{clientRef:'page'});
 for(const commands of[
  [command('element.create_text',{clientRef:'x',slideId:ref('page'),geometry:box,paragraphs:['앞 참조']}),create],
  [create,command('slide.create',{clientRef:'page'})],
  [create,command('element.create_shape',{clientRef:'x',slideId:ref('missing'),geometry:box})],
  [create,command('element.create_text',{clientRef:'x',slideId:ref('page'),geometry:box,paragraphs:[ref('page')]})],
  [create,command('element.create_image',{clientRef:'x',slideId:ref('page'),geometry:box,assetId:ref('page')})],
 ]){const result=await c.applyCommands(request(c,commands));assert.equal(result.ok,false);assert.deepEqual(c.document,before);assert.equal(c.undoCount,0);assert.equal(c.revision,0);assert.equal(result.value,undefined);}
});
test('prototype-looking clientRef values and literal reference text remain inert data',async()=>{
 const c=setup(),input=request(c,[command('slide.create',{clientRef:'__proto__'}),command('element.create_text',{clientRef:'constructor',slideId:ref('__proto__'),geometry:box,paragraphs:['$ref:__proto__','{"$ref":"constructor"}']})]),result=await c.applyCommands(input);assert.equal(result.ok,true,JSON.stringify(result));assert.equal(Object.hasOwn(result.value.createdIds,'__proto__'),true);assert.equal(typeof result.value.createdIds.__proto__,'string');assert.equal(Object.prototype.polluted,undefined);assert.deepEqual(c.document.slides.at(-1).elements[0].text.paragraphs,['$ref:__proto__','{"$ref":"constructor"}']);
});
test('a late malformed command never leaks staged PNGs or generated IDs into the author document',async()=>{
 const c=setup(),before=clone(c.document),entries=[{asset:{...fixture.assets[0],id:'approved-logo'}}],commands=[...threePages(c,'approved-logo'),command('element.set_geometry',{elementId:ref('logo'),geometry:{width:-1}})],result=await c.applyCommands(request(c,commands),options(entries));assert.equal(result.ok,false);assert.deepEqual(c.document,before);assert.equal(c.undoCount,0);assert.equal(c.document.assets.length,0);
});
test('slide duplication reuses existing behavior, scene, camera and asset remapping',async()=>{
 const c=setup(fixture),slide=c.activeSlideId,actor='element-shape-001',title='element-title-001';
 c.setScene(slide,{world:{width:2560,height:720},bodies:[{targetId:actor}],camera:{mode:'follow',targetId:actor},hudIds:[title]});
 c.setBehaviorRules(slide,[{id:'move-on-click',name:'이동',event:'click',sourceId:actor,actions:[{type:'setBodyVelocity',targetId:actor,x:{type:'literal',value:100}}]}]);
 const before=clone(c.document),undo=c.undoCount,input=request(c,[command('slide.duplicate',{clientRef:'copy',slideId:slide,name:'복제한 페이지'})]),preview=await c.previewCommands(input),result=await c.applyCommands(input);assert.equal(result.ok,true,JSON.stringify(result));assert.deepEqual(result.value.createdIds,preview.value.createdIds);assert.equal(c.undoCount,undo+1);
 const copied=c.document.slides.find(s=>s.id===result.value.createdIds.copy),newActor=copied.elements.find(e=>e.type==='shape').id,newTitle=copied.elements.find(e=>e.type==='text').id;assert.notEqual(newActor,actor);assert.notEqual(newTitle,title);assert.equal(copied.scene.bodies[0].targetId,newActor);assert.equal(copied.scene.camera.targetId,newActor);assert.deepEqual(copied.scene.hudIds,[newTitle]);assert.equal(copied.behavior.rules[0].sourceId,newActor);assert.equal(copied.behavior.rules[0].actions[0].targetId,newActor);assert.notEqual(copied.behavior.rules[0].id,before.slides[0].behavior.rules[0].id);assert.deepEqual(c.document.assets,before.assets);
 c.undo();assert.deepEqual(c.document,before);c.redo();assert.deepEqual(parsePresentation(exportPresentation(c.snapshot())),c.snapshot());
});
test('duplicate group closure uses the existing preparation without changing the source',async()=>{
 const c=setup(fixture),source=c.activeSlideId,actor='element-shape-001',title='element-title-001';c.groupElements([actor,title]);const before=clone(c.document),group=c.document.slides[0].elements.find(e=>e.id===actor).groupId,commands=[command('element.duplicate',{clientRef:'copy',elementId:actor,offsetX:40,offsetY:50})],result=await c.applyCommands(request(c,commands));assert.equal(result.ok,true,JSON.stringify(result));const copied=c.document.slides[0].elements.find(e=>e.id===result.value.createdIds.copy);assert.notEqual(copied.groupId,group);const siblings=c.document.slides[0].elements.filter(e=>e.groupId===copied.groupId);assert.equal(siblings.length,2);assert.equal(copied.geometry.x,before.slides[0].elements.find(e=>e.id===actor).geometry.x+40);assert.deepEqual(c.document.slides[0].elements.filter(e=>before.slides[0].elements.some(old=>old.id===e.id)),before.slides[0].elements);assert.equal(c.activeSlideId,source);
});
test('advanced slide duplication remaps named states, motions, interaction targets and self navigation without rewriting text',async()=>{
 const source=JSON.parse(await fs.readFile(new URL('../examples/advanced-showcase.json',import.meta.url),'utf8')),c=setup(source),original=clone(c.document),slide=original.slides[0],result=await c.applyCommands(request(c,[command('slide.duplicate',{clientRef:'advanced-copy',slideId:slide.id})]));assert.equal(result.ok,true,JSON.stringify(result));const copy=c.document.slides.find(s=>s.id===result.value.createdIds['advanced-copy']),elementMap=new Map(slide.elements.map((e,i)=>[e.id,copy.elements[i].id])),motionMap=new Map(slide.motions.map((m,i)=>[m.id,copy.motions[i].id]));
 for(let i=0;i<slide.elements.length;i++){const before=slide.elements[i],after=copy.elements[i];assert.notEqual(before.id,after.id);if(before.text)assert.deepEqual(after.text,before.text);if(before.states)for(let j=0;j<before.states.length;j++)assert.notEqual(before.states[j].id,after.states[j].id);if(before.component?.contentIds)assert.deepEqual(after.component.contentIds,before.component.contentIds.map(id=>elementMap.get(id)));}
 for(let i=0;i<slide.motions.length;i++){assert.notEqual(copy.motions[i].id,slide.motions[i].id);assert.equal(copy.motions[i].targetId,elementMap.get(slide.motions[i].targetId));}
 for(let i=0;i<slide.interactions.length;i++){const before=slide.interactions[i],after=copy.interactions[i];assert.notEqual(after.id,before.id);assert.equal(after.sourceId,elementMap.get(before.sourceId));for(let j=0;j<before.actions.length;j++){const a=before.actions[j],b=after.actions[j];if(a.type==='goToSlide')assert.equal(b.targetId,a.targetId===slide.id?copy.id:a.targetId);else if(a.type==='playMotion')assert.equal(b.motionId,motionMap.get(a.motionId)||a.motionId);else if(elementMap.has(a.targetId))assert.equal(b.targetId,elementMap.get(a.targetId));}}
 assert.deepEqual(c.document.slides.find(s=>s.id===slide.id),slide);assert.deepEqual(c.document.assets,original.assets);assert.deepEqual(parsePresentation(exportPresentation(c.snapshot())),c.snapshot());
});
test('public slide duplication preserves a linked master family and remaps every placeholder target',async()=>{
 const c=setup(),source=c.createSlideFromLayout('vividly-layout-body',{preset:true}),original=clone(c.document),sourceSlide=original.slides.find(s=>s.id===source),count=c.undoCount,result=await c.applyCommands(request(c,[command('slide.duplicate',{clientRef:'layout-copy',slideId:source})]));assert.equal(result.ok,true,JSON.stringify(result));const copy=c.document.slides.find(s=>s.id===result.value.createdIds['layout-copy']);assert.equal(copy.layout.layoutId,sourceSlide.layout.layoutId);assert.equal(copy.layout.version,sourceSlide.layout.version);for(const[key,id]of Object.entries(copy.layout.elementMap)){assert.ok(copy.elements.some(e=>e.id===id));assert.notEqual(id,sourceSlide.layout.elementMap[key]);}assert.deepEqual(c.document.layouts,original.layouts);assert.deepEqual(c.document.layoutMasters,original.layoutMasters);assert.equal(c.undoCount,count+1);c.undo();assert.deepEqual(c.document,original);
});
test('CAS, human drafts, revoke and cancellation still guard generated candidates before their one swap',async()=>{
 const pending=()=>{let enter,release;const entered=new Promise(r=>enter=r),gate=new Promise(r=>release=r);return{entered,release,wait:async()=>{enter();await gate;}};};
 for(const mode of['revision','draft','revoke','cancel']){const g=pending(),c=setup(createBlankDocument(),{agentPreparationGate:g.wait}),before=clone(c.document),input=request(c,[command('slide.create',{clientRef:'page'})]),job=c.invokeOperation('applyCommands',input,options());await g.entered;if(mode==='revision')c.setTitle('사람의 새 제목');if(mode==='draft'){const id=c.addText();c.beginText(id);c.updateText(['미확정 초안']);}if(mode==='revoke')c.setIOGrant(null);if(mode==='cancel')c.cancelOperation({target:target(c),operationId:input.operationId},options());g.release();const result=await job;assert.equal(result.ok,false,mode);assert.equal(c.document.slides.length,before.slides.length);assert.equal(c.document.slides.some(s=>s.name==='page'),false);if(mode==='draft')assert.ok(c.textSession);if(mode==='cancel'||mode==='revoke')assert.deepEqual(c.document,before);}
});
