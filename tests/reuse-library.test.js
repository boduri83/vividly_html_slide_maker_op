import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {CommandController} from '../src/controller.js';
import {prepareLibraryImport,summarizeLibraryImpact} from '../src/reuse-library.js';
import {evaluateCommands,validateCommand,getCommandCatalog} from '../src/commands.js';
import {exportPresentation,parsePresentation,validateAssetBytes} from '../src/format.js';
import {createBlankDocument} from '../src/model.js';

const fixture=JSON.parse(readFileSync(new URL('../examples/document-contract-v0.1.json',import.meta.url),'utf8'));
const clone=structuredClone,shapeId='element-shape-001',textId='element-title-001';
const handle=c=>({instanceId:c.instanceId,editorSessionId:c.editorSessionId,documentId:c.document.id});
const request=(c,commands,extra={})=>({target:handle(c),expectedRevision:c.revision,operationId:'library-batch',targeting:'id',commands,...extra});
const emptyImport={layoutMasters:[],layouts:[],styleRecipes:[],styleTokens:[],assetIds:[]};
function source(){
  const c=new CommandController(fixture);
  c.setStyleTokens([{id:'accent',name:'브랜드 색',type:'color',value:'#3344dd'},{id:'linked',name:'연결된 색',type:'color',value:'var(--v-accent)'}]);
  c.upsertStyleRecipe({id:'brand-card',name:'공용 카드',appearance:{fill:'#eef2ff',css:{background:'linear-gradient(var(--v-linked),#ffffff)'}},states:{hover:{css:{'box-shadow':'0 0 8px var(--v-accent)'}}}});
  c.applyStyleRecipe([shapeId],'brand-card');
  c.setVariables([{id:'choice',name:'선택',initialValue:'brand-layout',options:[{value:'brand-layout',label:'brand-layout'},{value:'other',label:'다른 값'}]}]);
  c.setBinding(textId,{variableId:'choice',values:[{value:'brand-layout',text:'brand-layout'},{value:'other',text:'다른 값'}],format:'text',prefix:'asset-thumbnail-001 '});
  c.setComponent(shapeId,{kind:'panel',initiallyOpen:true,dim:false,placement:'center',contentIds:[textId]});
  c.setStates(shapeId,[{id:'state-source',name:'state-source',style:{fill:'#ff0000'}}]);
  c.run('text.set_content',{elementId:textId,paragraphs:['brand-card accent brand-layout element-shape-001 var(--v-accent)']});
  const image={...clone(c.document.slides[1].elements.find(e=>e.type==='image')),id:'master-image'};
  c.createLayoutMaster({masterId:'brand-master',name:'공통 원본',canvas:{width:1280,height:720},background:'#ffffff',elements:[image]});
  c.captureLayout(c.activeSlideId,'업무 제목','brand-layout',[textId]);
  const {id,version,...definition}=c.document.layouts[0];
  c.updateLayout(id,{...definition,masterId:'brand-master',inheritBackground:true});
  return c;
}
function addCollisionTargets(sourceDocument){
  const document=clone(sourceDocument);document.id='target-document';
  document.styleTokens[0].value='#ff5533';document.styleRecipes[0].appearance.fill='#ff0000';document.variables[0].initialValue='other';document.layoutMasters[0].background='#222222';document.layouts[0].background='#cccccc';
  const png=readFileSync(new URL('../assets/brand/vividly-icon-64.png',import.meta.url));
  document.assets[0]={id:fixture.assets[0].id,mimeType:'image/png',width:64,height:64,bytes:png.length,sha256:createHash('sha256').update(png).digest('hex'),dataBase64:png.toString('base64')};
  return new CommandController(document);
}

test('selected layout closes master, exact asset, recipe, nested CSS token and variable dependencies with collision-safe typed references',async()=>{
  const s=source(),c=addCollisionTargets(s.document),before=clone(c.document),sourceBefore=clone(s.document),prepared=prepareLibraryImport(c.document,s.document,{layoutIds:['brand-layout']}),p=prepared.params,m=prepared.mapping;
  assert.deepEqual(prepared.summary.added,{masters:1,layouts:1,components:0,recipes:1,tokens:2,assets:1,clips:0,behaviorVariables:0});assert.equal(p.variables.length,1);
  for(const category of ['masters','layouts','recipes','tokens','assets'])for(const [old,id] of Object.entries(m[category]))assert.notEqual(old,id);
  assert.equal(p.layouts[0].masterId,m.masters['brand-master']);assert.equal(p.layoutMasters[0].elements[0].assetId,m.assets['asset-thumbnail-001']);
  const shape=p.layouts[0].elements.find(e=>e.type==='shape'),text=p.layouts[0].elements.find(e=>e.type==='text');
  assert.equal(shape.design.recipeId,m.recipes['brand-card']);assert.deepEqual(shape.component.contentIds,[text.id]);assert.deepEqual(p.layouts[0].placeholderIds,[text.id]);assert.equal(p.layouts[0].slots[0].elementId,text.id);
  assert.notEqual(shape.states[0].id,'state-source');assert.equal(shape.states[0].name,'state-source');assert.equal(text.binding.variableId,p.variables[0].id);
  assert.equal(text.binding.values[0].value,'brand-layout');assert.equal(text.binding.values[0].text,'brand-layout');assert.equal(text.binding.prefix,'asset-thumbnail-001 ');assert.deepEqual(text.text.paragraphs,sourceBefore.layouts[0].elements.find(e=>e.id===textId).text.paragraphs);
  assert.match(p.styleRecipes[0].appearance.css.background,new RegExp('--v-'+m.tokens.linked));assert.match(p.styleTokens.find(t=>t.id===m.tokens.linked).value,new RegExp('--v-'+m.tokens.accent));
  assert.equal(prepared.assets[0].dataBase64,sourceBefore.assets[0].dataBase64);assert.equal(prepared.assets[0].sha256,sourceBefore.assets[0].sha256);assert.equal(validateCommand({id:'library.import',params:p}).ok,true);
  assert.doesNotMatch(JSON.stringify(p),/dataBase64/);assert.deepEqual(c.document,before);assert.deepEqual(s.document,sourceBefore);
  const preview=c.previewLibraryImport(s.document,{layoutIds:['brand-layout']});assert.equal(preview.ok,true,JSON.stringify(preview));assert.deepEqual(c.document,before);
  const result=c.importLibrary(s.document,{layoutIds:['brand-layout']},{expectedRevision:preview.value.contentRevision,expectedSessionId:preview.value.editorSessionId});assert.equal(result.ok,true,JSON.stringify(result));
  assert.deepEqual(c.document.slides,before.slides);assert.deepEqual(c.document.layouts[0],before.layouts[0]);assert.equal(c.document.layouts.at(-1).name,'업무 제목 (가져옴 1)');
  assert.deepEqual(await validateAssetBytes(parsePresentation(exportPresentation(c.document))),c.document);
});

test('identical reimport deduplicates despite renamed IDs/names, adds no revision or Undo, and selecting master brings its family',()=>{
  const s=source(),c=addCollisionTargets(s.document),selection={masterIds:['brand-master']},first=c.importLibrary(s.document,selection);assert.equal(first.ok,true,JSON.stringify(first));
  const before=clone(c.document),revision=c.revision,count=c.undoCount,again=c.importLibrary(s.document,selection);
  assert.equal(again.ok,true,JSON.stringify(again));assert.equal(again.value.changed,false);assert.deepEqual(again.value.mapping,first.value.mapping);assert.deepEqual(again.value.summary.added,{masters:0,layouts:0,components:0,recipes:0,tokens:0,assets:0,clips:0,behaviorVariables:0});assert.deepEqual(again.value.summary.reused,{masters:1,layouts:1,components:0,recipes:1,tokens:2,assets:1,clips:0,behaviorVariables:0});assert.equal(c.revision,revision);assert.equal(c.undoCount,count);assert.deepEqual(c.document,before);
});

test('asset-only approval keeps an unused exact bitmap in the gallery, one shared Undo/Redo and HTML reopening',async()=>{
  const s=source(),c=new CommandController(),before=clone(c.document),preview=c.previewLibraryImport(s.document,{assetIds:['asset-thumbnail-001']});
  assert.equal(preview.ok,true);assert.equal(preview.value.summary.added.assets,1);assert.equal(c.undoCount,0);
  const applied=c.importLibrary(s.document,{assetIds:['asset-thumbnail-001']});assert.equal(applied.ok,true,JSON.stringify(applied));assert.equal(c.undoCount,1);assert.deepEqual(c.document.slides,before.slides);assert.equal(c.document.assets.length,1);assert.equal(c.document.assets[0].dataBase64,s.document.assets[0].dataBase64);
  const after=clone(c.document);c.undo();assert.deepEqual(c.document,before);c.redo();assert.deepEqual(c.document,after);assert.deepEqual(await validateAssetBytes(parsePresentation(exportPresentation(after))),after);
});

test('source theme references materialize original design and target theme stays untouched',()=>{
  const s=source();s.setTheme({colors:{primary:'#123abc',secondary:'#abcdef',background:'#ffffff',text:'#101010'},fontFamily:'Arial',headingFontFamily:'Georgia'});s.setThemeRefs(shapeId,{fill:'primary'});s.setThemeRefs(textId,{textColor:'primary',fontFamily:true});
  const sourceDocument=clone(s.document);sourceDocument.layouts[0].elements.find(e=>e.id===shapeId).themeRefs={fill:'primary'};sourceDocument.layouts[0].elements.find(e=>e.id===textId).themeRefs={textColor:'primary',fontFamily:true};sourceDocument.layouts[0].elements.find(e=>e.id===textId).semanticRole='heading';const c=new CommandController(),targetTheme=clone(c.document.theme),result=c.importLibrary(sourceDocument,{layoutIds:['brand-layout']});assert.equal(result.ok,true,JSON.stringify(result));const layout=c.document.layouts[0];assert.equal(layout.elements.find(e=>e.type==='shape').fill,'#123abc');assert.equal(layout.elements.find(e=>e.type==='text').text.textStyle.fontFamily,'Georgia');assert.equal(layout.elements.find(e=>e.type==='text').text.textStyle.color,'#123abc');assert.ok(layout.elements.every(e=>e.themeRefs===undefined));assert.deepEqual(c.document.theme,targetTheme);
});

test('local preview/import preserve human drafts; only owning library modal reason is exempt and external batch remains busy',async()=>{
  const s=source();let activity={libraryImport:true};const c=new CommandController(fixture,{activityProvider:()=>activity,agentPreparationGate:()=>Promise.resolve()});
  const before=clone(c.document),revision=c.revision;assert.equal(c.readEditorState().value.state.busy.reasons[0].kind,'libraryImport');
  const command={id:'library.import',params:prepareLibraryImport(c.document,s.document,{recipeIds:['brand-card']}).params};assert.equal((await c.applyCommands(request(c,[command]))).error.code,'EDITOR_BUSY');
  assert.equal(c.previewLibraryImport(s.document,{recipeIds:['brand-card']}).ok,true);
  activity.controls=[{fieldId:'property-fill'}];assert.equal(c.importLibrary(s.document,{recipeIds:['brand-card']}).error.code,'EDITOR_BUSY');activity={libraryImport:true};
  c.beginText(textId);c.updateText(['미확정 사람 입력']);const draft=c.textSession;assert.equal(c.previewLibraryImport(s.document,{recipeIds:['brand-card']}).error.code,'EDITOR_BUSY');assert.equal(c.importLibrary(s.document,{recipeIds:['brand-card']}).error.code,'EDITOR_BUSY');assert.equal(c.textSession,draft);assert.deepEqual(c.document,before);assert.equal(c.revision,revision);assert.equal(c.undoCount,0);
});

test('preview target CAS/session guards and invalid selections/final library limit fail without partial additions or history',()=>{
  const s=source(),c=new CommandController(),selection={layoutIds:['brand-layout']},preview=c.previewLibraryImport(s.document,selection);c.setTitle('사람의 새 제목');const before=clone(c.document),count=c.undoCount;
  assert.equal(c.importLibrary(s.document,selection,{expectedRevision:preview.value.contentRevision,expectedSessionId:preview.value.editorSessionId}).error.code,'REVISION_CONFLICT');
  c.loadDocument(createBlankDocument());const replaced=clone(c.document);assert.equal(c.importLibrary(s.document,selection,{expectedRevision:c.revision,expectedSessionId:preview.value.editorSessionId}).error.code,'STALE_EDITOR_SESSION');assert.deepEqual(c.document,replaced);
  assert.equal(c.importLibrary(s.document,{layoutIds:['missing']}).ok,false);assert.deepEqual(c.document,replaced);
  const full=clone(c.document);full.schemaVersion='0.12-design.1';full.styleRecipes=Array.from({length:128},(_,i)=>({id:'existing-'+i,name:'기존 '+i,appearance:{fill:'#000000'}}));const limited=new CommandController(full),initial=clone(limited.document);assert.equal(limited.importLibrary(s.document,selection).ok,false);assert.deepEqual(limited.document,initial);assert.equal(limited.undoCount,0);
  assert.equal(before.title,'사람의 새 제목');assert.equal(count,1);
});

test('public import uses metadata only and late failure/dryRun are atomic in the common batch',async()=>{
  const s=source(),c=new CommandController(),prepared=prepareLibraryImport(c.document,s.document,{recipeIds:['brand-card']}),command={id:'library.import',params:prepared.params},before=clone(c.document);
  assert.equal(getCommandCatalog().find(c=>c.id==='library.import').inputSchema.additionalProperties,false);assert.equal(validateCommand({...command,params:{...command.params,assets:s.document.assets}}).ok,false);
  const dry=await c.applyCommands(request(c,[command],{dryRun:true}));assert.equal(dry.ok,true,JSON.stringify(dry));assert.deepEqual(c.document,before);assert.equal(c.undoCount,0);
  const failure=await c.applyCommands(request(c,[command,{id:'element.set_geometry',params:{elementId:'missing',geometry:{x:3}}}]));assert.equal(failure.ok,false);assert.deepEqual(c.document,before);assert.equal(c.undoCount,0);
  assert.equal((await c.applyCommands(request(c,[command]))).ok,true);assert.equal(c.undoCount,1);const after=clone(c.document);c.undo();assert.deepEqual(c.document,before);c.redo();assert.deepEqual(c.document,after);
  const collision=evaluateCommands(c.document,[command]);assert.equal(collision.ok,false);assert.deepEqual(c.document,after);
});

test('approved external PNG can be deliberately retained by library import; unrelated staged assets stay forbidden',async()=>{
  const c=new CommandController(undefined,{agentPreparationGate:()=>Promise.resolve()}),asset={...fixture.assets[0],id:'approved-gallery'};c.setAgentGrant('library-agent');c.setIOGrant('library-io');const commands=[{id:'library.import',params:{...emptyImport,assetIds:[asset.id]}}],before=clone(c.document),options={grantId:'library-agent',ioGrantId:'library-io',stagedAssets:[{asset}]};
  const preview=await c.applyCommands(request(c,commands,{dryRun:true}),options);assert.equal(preview.ok,true,JSON.stringify(preview));assert.deepEqual(c.document,before);
  assert.equal((await c.applyCommands(request(c,commands),options)).ok,true);assert.equal(c.document.assets[0].dataBase64,asset.dataBase64);assert.equal(c.undoCount,1);c.undo();assert.deepEqual(c.document,before);
  const unrelated=await c.applyCommands(request(c,[{id:'library.import',params:emptyImport}]),options);assert.equal(unrelated.error.code,'UNUSED_STAGED_ASSET');assert.deepEqual(c.document,before);
});

test('master replacement preview reports actual propagation, preserves local overrides and shares exact apply candidate with CAS',()=>{
  const c=new CommandController();const shape=c.addShape('rectangle'),title=c.addText();c.captureLayout(c.activeSlideId,'업무 제목','original',[title]);const second=c.addSlide();c.applyLayout([second],'original');const linkedShape=c.activeSlide.layout.elementMap[shape];c.setFill(linkedShape,'#ff0000');
  const before=clone(c.document),definition={layoutMasters:clone(c.document.layoutMasters||[]),layouts:clone(c.document.layouts)};definition.layouts[0].elements.find(e=>e.id===shape).geometry.x+=100;definition.layouts[0].elements.find(e=>e.id===title).text.textStyle.fontSize=51;
  const preview=c.previewLayoutLibrary(definition);assert.equal(preview.ok,true,JSON.stringify(preview));assert.deepEqual(c.document,before);assert.ok(preview.value.impact.slideIds.includes(second));assert.ok(preview.value.impact.overrideCount>=1);
  const count=c.undoCount;c.replaceLayoutLibrary(definition,{expectedRevision:preview.value.contentRevision,expectedSessionId:preview.value.editorSessionId});assert.equal(c.undoCount,count+1);assert.equal(c.document.slides.find(s=>s.id===second).elements.find(e=>e.id===linkedShape).fill,'#ff0000');assert.deepEqual(summarizeLibraryImpact(before,c.document),preview.value.impact);
  const after=clone(c.document);assert.throws(()=>c.replaceLayoutLibrary(definition,{expectedRevision:preview.value.contentRevision,expectedSessionId:preview.value.editorSessionId}),{code:'REVISION_CONFLICT'});assert.deepEqual(c.document,after);
});

test('recapturing an applied child keeps parent furniture inherited, stable links and content with one shared Undo/Redo',()=>{
  const c=new CommandController();c.ensureLayoutLibrary();c.createSlideFromLayout('vividly-layout-title');const layoutId='vividly-layout-title',layout=c.document.layouts.find(item=>item.id===layoutId),parent=c.document.layoutMasters.find(item=>item.id===layout.masterId),parentSource=parent.elements[0].id,parentTarget=c.activeSlide.layout.elementMap[parentSource],childSource=layout.placeholderIds[0],childTarget=c.activeSlide.layout.elementMap[childSource];
  c.run('text.set_content',{elementId:childTarget,paragraphs:['다시 사용할 업무 제목']});c.setGeometry(childTarget,{x:222});const firstSlide=c.activeSlideId,secondSlide=c.addSlide();c.applyLayout([secondSlide],layoutId);const secondTitle=c.activeSlide.layout.elementMap[childSource];c.run('text.set_content',{elementId:secondTitle,paragraphs:['다른 페이지 내용']});
  const before=clone(c.document),count=c.undoCount;c.captureLayout(firstSlide,'다시 등록한 제목',layoutId);
  assert.equal(c.undoCount,count+1);const recaptured=c.document.layouts.find(item=>item.id===layoutId);assert.equal(recaptured.masterId,parent.id);assert.ok(recaptured.elements.every(item=>!parent.elements.some(original=>original.id===item.id)));assert.equal(c.document.slides.find(s=>s.id===firstSlide).layout.elementMap[parentSource],parentTarget);assert.equal(c.document.slides.find(s=>s.id===firstSlide).layout.elementMap[childSource],childTarget);assert.equal(c.document.slides.find(s=>s.id===secondSlide).elements.find(e=>e.id===secondTitle).text.paragraphs[0],'다른 페이지 내용');assert.equal(c.document.slides.find(s=>s.id===secondSlide).elements.find(e=>e.id===secondTitle).geometry.x,222);
  const after=clone(c.document);c.undo();assert.deepEqual(c.document,before);c.redo();assert.deepEqual(c.document,after);
  const parentDefinition=clone(c.document.layoutMasters.find(item=>item.id===parent.id));parentDefinition.elements[0].geometry.y+=11;const {id,version,...fields}=parentDefinition;c.updateLayoutMaster(id,fields);for(const slideId of [firstSlide,secondSlide]){const slide=c.document.slides.find(item=>item.id===slideId),target=slide.layout.elementMap[parentSource];assert.equal(slide.elements.find(item=>item.id===target).geometry.y,parentDefinition.elements[0].geometry.y);assert.equal(slide.elements.filter(item=>item.id===target).length,1);}
  assert.deepEqual(parsePresentation(exportPresentation(c.document)),c.document);
  const initial=clone(c.document);assert.throws(()=>c.captureLayout(firstSlide,'잘못된 입력 자리',layoutId,[parentTarget]),/공통 마스터/);assert.deepEqual(c.document,initial);
});

test('variant chart series references survive library import, semantic dedup, layout apply/recapture/duplicate and editable Undo/HTML',()=>{
  const source=new CommandController(),variable={id:'chart-choice',name:'차트 선택',initialValue:'base-series',options:[{value:'base-series',label:'base-series'},{value:'other',label:'다른 수치'}]},chart={kind:'line',categories:['base-series','분기 2'],series:[{id:'base-series',name:'base-series',color:'#3355dd',values:[20,30]},{id:'other-series',name:'other-series',color:'#16a18b',values:[10,40]}],showLegend:true};
  chart.variants={variableId:variable.id,values:variable.options.map((option,index)=>({value:option.value,series:chart.series.map(series=>({seriesId:series.id,values:series.values.map(value=>value+index*10)}))}))};
  source.setVariables([variable]);source.run('elements.insert',{slideId:source.activeSlideId,elements:[{id:'source-chart',type:'chart',name:'업무 성과 차트',geometry:{x:100,y:100,width:700,height:400},chart}],assets:[]});source.captureLayout(source.activeSlideId,'인터랙티브 차트','chart-layout',[]);
  const target=new CommandController(),before=clone(target.document),selection={layoutIds:['chart-layout']},preview=target.previewLibraryImport(source.document,selection);assert.equal(preview.ok,true,JSON.stringify(preview));assert.deepEqual(target.document,before);
  const imported=target.importLibrary(source.document,selection);assert.equal(imported.ok,true,JSON.stringify(imported));const layoutId=imported.value.mapping.layouts['chart-layout'],layout=target.document.layouts.find(item=>item.id===layoutId),importedChart=layout.elements.find(item=>item.type==='chart').chart;
  const consistent=chart=>{for(const variant of chart.variants.values)assert.deepEqual(variant.series.map(series=>series.seriesId),chart.series.map(series=>series.id));};consistent(importedChart);assert.notEqual(importedChart.series[0].id,'base-series');assert.equal(importedChart.series[0].name,'base-series');assert.equal(importedChart.categories[0],'base-series');assert.equal(importedChart.variants.values[0].value,'base-series');
  const importedState=clone(target.document),count=target.undoCount;assert.equal(target.importLibrary(source.document,selection).value.changed,false);assert.deepEqual(target.document,importedState);assert.equal(target.undoCount,count);
  target.applyLayout([target.activeSlideId],layoutId);let instance=target.activeSlide.elements.find(item=>item.type==='chart');assert.ok(instance);consistent(instance.chart);assert.notEqual(instance.chart.series[0].id,importedChart.series[0].id);const prior=clone(target.document),changed=clone(instance.chart);changed.series[0].values[0]=777;target.setChart(instance.id,changed);assert.equal(target.activeSlide.elements.find(item=>item.id===instance.id).chart.series[0].values[0],777);target.undo();assert.deepEqual(target.document,prior);target.redo();
  target.captureLayout(target.activeSlideId,'수정한 차트 원본',layoutId,[]);consistent(target.document.layouts.find(item=>item.id===layoutId).elements.find(item=>item.type==='chart').chart);
  const duplicateId=target.duplicateLayout(layoutId,'duplicate-chart-layout','차트 복사');target.createSlideFromLayout(duplicateId);instance=target.activeSlide.elements.find(item=>item.type==='chart');consistent(instance.chart);assert.equal(instance.chart.series[0].values[0],777);
  assert.deepEqual(parsePresentation(exportPresentation(target.document)),target.document);
});
