import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CommandController} from '../src/controller.js';
import {normalizeDocument} from '../src/model.js';
import {BUSINESS_SCHEMA,businessSchemas,normalizeBusinessValue,resolveConnectorGeometry,diagnoseDocument} from '../src/business-model.js';
import {BUSINESS_TEMPLATES,createBusinessTemplate} from '../src/business-templates.js';
import {exportPresentation,parsePresentation} from '../src/format.js';

const legacy=JSON.parse(readFileSync(new URL('../examples/workbench-showcase.json',import.meta.url),'utf8'));
const copy=structuredClone;
const style={fontFamily:'Malgun Gothic',fontSize:28,lineHeight:1.3,color:'#182037',align:'left',verticalAlign:'top'};
const shape=(id,x)=>({id,type:'shape',shape:'rectangle',geometry:{x,y:300,width:100,height:80},fill:'#eef2ff',stroke:{color:'#635bff',width:2}});
function fixture(){
 const doc=copy(legacy);doc.schemaVersion=BUSINESS_SCHEMA;doc.id='business-domain-fixture';doc.variables=[{id:'biz-year',name:'연도',initialValue:'2025',options:[{value:'2025',label:'2025년'},{value:'2026',label:'2026년'}]}];
 const elements=[{id:'biz-text',type:'text',geometry:{x:70,y:80,width:500,height:160},semanticRole:'heading',text:{paragraphs:['가👩‍💻é나다','','두 번째 문단\n줄바꿈'],textStyle:style,runs:[{paragraph:0,start:1,end:6,bold:true,href:'https://example.test/info'}],paragraphStyles:[{list:'bullet',level:0,spaceBefore:0,spaceAfter:10},{list:'bullet',level:1,spaceBefore:0,spaceAfter:10},{list:'none',level:0,spaceBefore:10,spaceAfter:0}]}},shape('biz-left',50),shape('biz-right',350),
 {id:'biz-connector',type:'connector',geometry:{x:0,y:0,width:1,height:1},connector:{from:{elementId:'biz-left',anchor:'right'},to:{elementId:'biz-right',anchor:'left'},stroke:{color:'#635bff',width:3},arrow:'end'}},
 {id:'biz-table',type:'table',geometry:{x:620,y:100,width:500,height:180},table:{rows:[[{text:'항목',bold:true},{text:'성과',bold:true}],[{text:'검색'},{text:'128',align:'right'}]],columnWidths:[1.2,1],headerRows:1,fontSize:22}},
 {id:'biz-chart',type:'chart',geometry:{x:620,y:330,width:500,height:230},chart:{kind:'bar',categories:['검색','소셜'],series:[{id:'s1',name:'성과',color:'#635bff',values:[128,180]}],showLegend:true,variants:{variableId:'biz-year',values:[{value:'2025',series:[{seriesId:'s1',values:[128,180]}]},{value:'2026',series:[{seriesId:'s1',values:[155,210]}]}]}}},
 {id:'biz-svg',type:'svg',geometry:{x:70,y:480,width:130,height:130},svg:{viewBox:{width:100,height:100},title:'안전한 벡터',shapes:[{kind:'circle',cx:50,cy:50,r:40,fill:'#635bff'}]}}];
 doc.slides[0].elements.push(...elements);doc.slides[0].notes='발표자에게만 보이는 설명';doc.slides[0].readingOrder=doc.slides[0].elements.map(e=>e.id);doc.slides[0].template={id:'vividly.domain-test',version:1,slots:[{elementId:'biz-text',role:'title'},{elementId:'biz-table',role:'table'}]};
 doc.master={enabled:true,footer:'공통 설명',logoText:'Vividly',accentColor:'#635bff',showPageNumber:true};
 return normalizeDocument(doc);
}
const e=(c,id)=>c.document.slides.flatMap(s=>s.elements).find(e=>e.id===id);
const state=c=>copy({document:c.document,revision:c.revision,history:c.readHistory().value.history,selected:c.selectedIds,textSession:c.textSession});

test('business schema is closed, preserves all legacy field shapes, and validates semantic data',()=>{
 assert.deepEqual(normalizeDocument(legacy),legacy);const doc=fixture();assert.deepEqual(normalizeDocument(doc),doc);
 for(const mutate of [d=>{d.slides[0].elements.find(e=>e.id==='biz-table').table.script='alert(1)';},d=>{d.slides[0].elements.find(e=>e.id==='biz-chart').chart.series[0].values.pop();},d=>{d.slides[0].readingOrder.pop();},d=>{d.slides[0].elements.find(e=>e.id==='biz-connector').connector.to.elementId='absent';}]){const bad=copy(doc);mutate(bad);assert.throws(()=>normalizeDocument(bad));}
 const future=copy(doc);future.schemaVersion='0.5-unknown';assert.throws(()=>normalizeDocument(future));
});
test('rich draft, composition, committed read and one text Undo retain distinct boundaries',()=>{
 const c=new CommandController(legacy),id=c.activeSlide.elements.find(e=>e.text).id,original=copy(c.document);c.beginText(id);c.updateRichText({paragraphs:['한글 👩‍💻 제목'],runs:[{paragraph:0,start:0,end:2,bold:true}]});
 assert.deepEqual(c.readCommittedSnapshot().value.document,original);assert.equal(c.snapshot().schemaVersion,BUSINESS_SCHEMA);assert.equal(c.undoCount,0);
 c.setComposing(true);assert.throws(()=>c.finishText());assert.throws(()=>c.snapshot());c.setComposing(false);c.finishText();assert.equal(c.undoCount,1);assert.equal(c.document.schemaVersion,BUSINESS_SCHEMA);assert.equal(e(c,id).text.runs[0].bold,true);c.undo();assert.deepEqual(c.document,original);c.redo();assert.equal(e(c,id).text.paragraphs[0],'한글 👩‍💻 제목');
});
test('range formatting preserves unselected marks and rejects emoji/combining splits before mutation',()=>{
 const c=new CommandController(fixture()),before=state(c);for(const range of [{paragraph:0,start:2,end:6},{paragraph:0,start:6,end:7},{paragraph:0,start:0,end:99}]){assert.throws(()=>c.formatTextRange('biz-text',range,{italic:true}));assert.deepEqual(state(c),before);}
 c.formatTextRange('biz-text',{paragraph:0,start:6,end:8},{color:'#ff0000',italic:true});const runs=e(c,'biz-text').text.runs;assert.equal(runs[0].href,'https://example.test/info');assert.equal(runs[1].start,6);assert.equal(runs[1].end,8);assert.equal(c.undoCount,1);c.undo();assert.deepEqual(state(c).document,before.document);
 assert.throws(()=>c.formatTextRange('biz-text',{paragraph:0,start:0,end:1},{href:'javascript:alert(1)'}));assert.throws(()=>c.formatTextRange('biz-text',{paragraph:0,start:0,end:1},{href:'https://user:secret@example.test'}));
});
test('table cell/row/column and chart data edits are atomic, reversible and retain unrelated assets',()=>{
 const c=new CommandController(fixture()),before=copy(c.document),table=copy(e(c,'biz-table').table),chart=copy(e(c,'biz-chart').chart);table.rows[1][1].text='256';table.rows.push([{text:'직접'},{text:'76'}]);chart.kind='line';chart.series[0].values=[256,null];
 c.runBatch([{id:'table.set_data',params:{elementId:'biz-table',table}},{id:'chart.set_data',params:{elementId:'biz-chart',chart}}],'표·차트 편집');assert.equal(c.undoCount,1);assert.equal(e(c,'biz-table').table.rows.length,3);assert.equal(e(c,'biz-chart').chart.kind,'line');assert.deepEqual(c.document.assets,before.assets);c.undo();assert.deepEqual(c.document,before);c.redo();assert.equal(e(c,'biz-table').table.rows[1][1].text,'256');
 const stable=state(c),bad=copy(table);bad.rows[0].pop();assert.throws(()=>c.setTable('biz-table',bad));assert.deepEqual(state(c),stable);
});
test('connected anchors follow geometry and rotation; target deletion removes only dependent references',()=>{
 const c=new CommandController(fixture()),before=copy(c.document),initial=e(c,'biz-connector').geometry;c.setGeometry('biz-left',{x:100});assert.notDeepEqual(e(c,'biz-connector').geometry,initial);
 c.setRotation('biz-right',90);const points=resolveConnectorGeometry(e(c,'biz-connector'),c.activeSlide);assert.ok(Math.abs(points.to.x-400)<1e-8);assert.ok(Math.abs(points.to.y-290)<1e-8);
 assert.throws(()=>c.setGeometry('biz-connector',{x:10}));c.deleteElement('biz-right');assert.equal(e(c,'biz-connector'),undefined);assert.ok(!c.activeSlide.readingOrder.includes('biz-connector'));c.undo();assert.ok(e(c,'biz-connector'));while(c.canUndo)c.undo();assert.deepEqual(c.document,before);
 const rotated=copy(before);rotated.slides[0].elements.find(e=>e.id==='biz-connector').rotation=90;assert.throws(()=>normalizeDocument(rotated),/connector/);
});
test('safe SVG primitives reject executable or external markup fields and remain semantic data',()=>{
 const c=new CommandController(fixture()),svg=copy(e(c,'biz-svg').svg);svg.shapes[0].fill='#16a8a0';c.setSvg('biz-svg',svg);assert.equal(e(c,'biz-svg').svg.shapes[0].fill,'#16a8a0');
 for(const mutation of [v=>v.shapes.push({kind:'script',code:'alert(1)'}),v=>{v.shapes[0].onload='alert(1)';},v=>{v.shapes[0].fill='url(https://example.test/a)';},v=>{v.shapes[0].href='file:///secret';}]){const bad=copy(svg);mutation(bad);const before=state(c);assert.throws(()=>c.setSvg('biz-svg',bad));assert.deepEqual(state(c),before);}
});
test('master, local exceptions, notes and reading order share commands and committed diagnostics',()=>{
 const c=new CommandController(fixture()),before=copy(c.document),master={...c.document.master,footer:'새 공통 설명'};c.setMaster(master);assert.equal(c.undoCount,1);c.setSlideBusiness(c.activeSlideId,{notes:'수정한 발표 노트',hideMaster:true,masterOverride:{logoText:'예외 로고'},readingOrder:[...c.activeSlide.readingOrder].reverse()});
 assert.equal(c.activeSlide.notes,'수정한 발표 노트');assert.equal(c.activeSlide.hideMaster,true);assert.equal(c.readCommittedSnapshot().value.diagnostics instanceof Array,true);const diagnostics=c.readDiagnostics();assert.equal(diagnostics.value.contentRevision,c.revision);diagnostics.value.diagnostics.push({code:'fake'});assert.ok(!c.readDiagnostics().value.diagnostics.some(i=>i.code==='fake'));c.undo();c.undo();assert.deepEqual(c.document,before);
});
test('chart variable options cascade variant tables and deleting a variable removes the binding',()=>{
 const c=new CommandController(fixture()),variables=copy(c.document.variables);variables[0].options.push({value:'2027',label:'2027년'});c.setVariables(variables);const variants=e(c,'biz-chart').chart.variants;assert.deepEqual(variants.values[2].series,[{seriesId:'s1',values:[128,180]}]);c.setVariables([]);assert.equal(e(c,'biz-chart').chart.variants,undefined);c.undo();assert.equal(e(c,'biz-chart').chart.variants.values.length,3);
});
test('business clipboard and slide import remap connector, template, reading and variable references',()=>{
 const c=new CommandController(fixture()),payload=c.copyElements(['biz-left','biz-right','biz-connector','biz-chart']),created=c.pasteElements(payload),copies=created.map(id=>e(c,id)),connector=copies.find(e=>e.connector);assert.ok(created.includes(connector.connector.from.elementId));assert.ok(created.includes(connector.connector.to.elementId));assert.equal(copies.find(e=>e.chart).chart.variants.variableId,'biz-year');c.undo();
 const other=new CommandController(legacy),ids=other.importSlides(c.document,[c.activeSlideId]);const imported=other.document.slides.find(s=>s.id===ids[0]),importedIds=new Set(imported.elements.map(e=>e.id));assert.ok(imported.readingOrder.every(id=>importedIds.has(id)));assert.ok(imported.template.slots.every(slot=>importedIds.has(slot.elementId)));assert.notEqual(imported.elements.find(e=>e.chart?.variants).chart.variants.variableId,'biz-year');
 const only=c.copyElements(['biz-connector']);assert.throws(()=>other.pasteElements(only));
});
test('three business kits have editable content, semantic charts/tables/connectors and stable template relations',()=>{
 assert.equal(BUSINESS_TEMPLATES.length,3);
 for(const kit of BUSINESS_TEMPLATES){const doc=createBusinessTemplate(kit.id);assert.equal(doc.slides.length,kit.slideCount);assert.deepEqual(normalizeDocument(doc),doc);assert.ok(doc.slides.every(s=>s.template.slots.length===s.elements.length));assert.ok(doc.slides.some(s=>s.elements.some(e=>e.table||e.chart)));assert.deepEqual(parsePresentation(exportPresentation(doc)),doc);}
 const compact=createBusinessTemplate('campaign',{canvas:{width:720,height:1280,unit:'logical-px'}});assert.equal(compact.canvas.width,720);assert.ok(!diagnoseDocument(compact).some(issue=>issue.code==='OUTSIDE_CANVAS'));
});
test('business guarded batches preserve CAS, dryRun, human property protection and one shared Undo',async()=>{
 let activity={};const c=new CommandController(fixture(),{activityProvider:()=>activity}),before=state(c),snapshot=c.readCommittedSnapshot().value,target={instanceId:snapshot.instanceId,editorSessionId:snapshot.editorSessionId,documentId:snapshot.documentId};
 const table=copy(e(c,'biz-table').table);table.rows[1][1].text='999';
 const request={target,expectedRevision:0,operationId:crypto.randomUUID(),targeting:'id',label:'업무 자료 묶음',commands:[{id:'table.set_data',params:{elementId:'biz-table',table}},{id:'document.set_master',params:{master:{...c.document.master,footer:'팀 공유 버전'}}},{id:'slide.set_business',params:{slideId:c.activeSlideId,properties:{notes:'검토할 발표 노트'}}}]};
 const dry=await c.applyCommands({...request,dryRun:true});assert.equal(dry.ok,true);assert.equal(dry.value.summary.masterChanged,true);assert.deepEqual(state(c),before);
 activity={controls:[{fieldId:'business-properties',elementId:'biz-table'}],pendingChanges:true};const blocked=await c.applyCommands(request);assert.equal(blocked.ok,false);assert.equal(blocked.error.code,'EDITOR_BUSY');assert.equal(blocked.error.mutated,false);assert.deepEqual(state(c),before);activity={};
 const applied=await c.applyCommands(request);assert.equal(applied.ok,true);assert.equal(c.undoCount,1);assert.equal(c.revision,1);assert.equal(e(c,'biz-table').table.rows[1][1].text,'999');const stale=await c.applyCommands({...request,operationId:crypto.randomUUID()});assert.equal(stale.error.code,'REVISION_CONFLICT');assert.equal(c.undoCount,1);c.undo();assert.deepEqual(c.document,before.document);c.redo();assert.equal(e(c,'biz-table').table.rows[1][1].text,'999');
});
test('a late invalid business command preserves the complete rich human draft and diagnostics stay committed',()=>{
 const c=new CommandController(fixture());c.beginText('biz-text');c.updateRichText({paragraphs:['사람이 수정 중인 한글 👩‍💻'],runs:[{paragraph:0,start:0,end:3,underline:true}]});const before=state(c),table=copy(e(c,'biz-table').table);table.rows[1][1].text='256';
 assert.throws(()=>c.runBatch([{id:'table.set_data',params:{elementId:'biz-table',table}},{id:'connector.set_data',params:{elementId:'biz-connector',connector:{...e(c,'biz-connector').connector,to:{elementId:'missing',anchor:'left'}}}}],'실패할 묶음'));assert.deepEqual(state(c),before);assert.notEqual(c.readCommittedSnapshot().value.document.slides[0].elements.find(e=>e.id==='biz-text').text.paragraphs[0],c.textSession.draft.paragraphs[0]);
 const diagnostic=copy(c.document);const textElement=diagnostic.slides[0].elements.find(e=>e.id==='biz-text');textElement.text.textStyle.color=diagnostic.slides[0].background;delete textElement.themeRefs;const issues=diagnoseDocument(diagnostic,{availableFonts:['Arial']});assert.ok(issues.some(i=>i.code==='LOW_CONTRAST'&&i.elementId==='biz-text'&&i.contrastRatio===1));assert.ok(issues.some(i=>i.code==='MISSING_FONT'));
});
