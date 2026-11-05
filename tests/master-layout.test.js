import test from 'node:test';
import assert from 'node:assert/strict';
import { CommandController } from '../src/controller.js';
import { BUSINESS_SCHEMA, cloneDocument, normalizeDocument } from '../src/model.js';
import { evaluateCommand, evaluateCommands, getCommandCatalog } from '../src/commands.js';
import { exportPresentation, parsePresentation } from '../src/format.js';
import { CANVAS_PRESETS } from '../src/master-model.js';

const text = (id,value,extra={})=>({id,type:'text',geometry:{x:60,y:50,width:1100,height:80},text:{paragraphs:[value],textStyle:{fontFamily:'Malgun Gothic',fontSize:40,lineHeight:1.2,color:'#202030',align:'left',verticalAlign:'top'}},...extra});
const shape=(id,extra={})=>({id,type:'shape',shape:'rectangle',geometry:{x:40,y:20,width:1200,height:120},fill:'#2563eb',stroke:{color:'#2563eb',width:0},...extra});
const fixture=()=>({format:'html-slide-document',schemaVersion:BUSINESS_SCHEMA,id:'deck-brand',title:'Master',canvas:{width:1280,height:720,unit:'logical-px'},assets:[],slides:[
  {id:'slide-brand',background:'#fafbff',elements:[shape('brand-bar'),text('brand-title','제목',{semanticRole:'heading'}),text('brand-body','본문',{geometry:{x:60,y:220,width:700,height:350}})]},
  {id:'slide-sales',background:'#ffffff',elements:[text('sales-title','매출 현황',{semanticRole:'heading'}),text('sales-body','일정과 핵심 수치'),shape('local-shape',{geometry:{x:1000,y:600,width:80,height:80},fill:'#11aa88'})]},
  {id:'slide-plans',background:'#ffffff',elements:[text('plans-title','실행 계획',{semanticRole:'heading'}),text('plans-body','2027년 계획')]}
]});
const capture={id:'layout.capture',params:{slideId:'slide-brand',name:'브랜드 기본',layoutId:'layout-brand'}};
const apply=ids=>({id:'layout.apply',params:{slideIds:ids,layoutId:'layout-brand'}});
function request(c,commands,extra={}){const r=c.readCommittedSnapshot().value;return {target:{instanceId:r.instanceId,editorSessionId:r.editorSessionId,documentId:r.documentId},expectedRevision:r.contentRevision,operationId:'layout-check',targeting:'id',commands,...extra};}

test('capture and apply register arbitrary design objects and retain slide content without duplicate placeholders',()=>{
  const c=new CommandController(fixture()),original=cloneDocument(c.document);
  c.captureLayout('slide-brand','브랜드 기본','layout-brand');
  assert.equal(c.document.layouts[0].elements.length,3);assert.deepEqual(c.document.layouts[0].placeholderIds,['brand-title','brand-body']);
  c.applyLayout(['slide-sales','slide-plans'],'layout-brand');
  const sales=c.document.slides[1];assert.equal(sales.elements.length,4);assert.equal(sales.background,'#fafbff');
  assert.deepEqual(sales.elements.filter(e=>e.text).map(e=>e.text.paragraphs[0]),['매출 현황','일정과 핵심 수치']);
  assert.ok(sales.elements.some(e=>e.id==='local-shape'));assert.equal(new Set(c.document.slides.flatMap(s=>s.elements.map(e=>e.id))).size,10);
  const after=cloneDocument(c.document);c.undo();assert.equal(c.document.slides[1].layout,undefined);c.redo();assert.deepEqual(c.document,after);
  assert.equal(original.layouts,undefined);assert.deepEqual(normalizeDocument(c.document),c.document);
});

test('updating the representative master propagates design once, preserves content and local additions, and Undo is shared',()=>{
  const c=new CommandController(fixture());c.execute(capture);c.execute(apply(['slide-sales','slide-plans']));
  c.setFill('brand-bar','#8844bb');c.setGeometry('brand-title',{x:120,width:900});
  const before=cloneDocument(c.document),count=c.undoCount,ids=cloneDocument(c.document.slides[1].layout.elementMap);
  c.captureLayout('slide-brand','브랜드 수정','layout-brand');
  assert.equal(c.undoCount,count+1);assert.equal(c.document.layouts[0].version,2);
  const sales=c.document.slides[1];assert.equal(sales.elements.find(e=>e.id===ids['brand-bar']).fill,'#8844bb');
  assert.equal(sales.elements.find(e=>e.id===ids['brand-title']).geometry.x,120);assert.equal(sales.elements.find(e=>e.id===ids['brand-title']).text.paragraphs[0],'매출 현황');
  assert.deepEqual(sales.layout.elementMap,ids);assert.ok(sales.elements.some(e=>e.id==='local-shape'));
  c.undo();assert.deepEqual(c.document,before);c.redo();assert.equal(c.document.layouts[0].version,2);
});

test('editing an applied slide retains source keys and supports adding and deleting master objects',()=>{
  const c=new CommandController(fixture());c.execute(capture);c.execute(apply(['slide-sales']));
  const sales=c.document.slides[1],map=cloneDocument(sales.layout.elementMap);
  c.deleteElement(map['brand-body']);c.setGeometry(map['brand-bar'],{height:150});
  c.captureLayout('slide-sales','응용 브랜드','layout-brand');
  const l=c.document.layouts[0];assert.ok(l.elements.some(e=>e.id==='brand-bar'));assert.ok(!l.elements.some(e=>e.id==='brand-body'));
  assert.equal(c.document.slides[0].elements.find(e=>e.id==='brand-bar').geometry.height,150);
  assert.equal(c.document.slides[0].elements.find(e=>e.id==='brand-body').text.paragraphs[0],'본문');assert.equal(c.document.slides[0].layout.elementMap['brand-body'],undefined);assert.equal(c.document.slides[0].elements.find(e=>e.id==='brand-title').text.paragraphs[0],'제목');
});

test('detach and delete retain ordinary slide objects and each can be undone',()=>{
  const c=new CommandController(fixture());c.execute(capture);c.execute(apply(['slide-sales','slide-plans']));
  const elements=cloneDocument(c.document.slides[1].elements);
  c.detachLayout(['slide-sales']);assert.equal(c.document.slides[1].layout,undefined);assert.deepEqual(c.document.slides[1].elements,elements);
  c.deleteLayout('layout-brand');assert.equal(c.document.layouts.length,0);assert.equal(c.document.slides[0].layout,undefined);assert.equal(c.document.slides[2].layout,undefined);
  assert.deepEqual(c.document.slides[1].elements,elements);c.undo();assert.equal(c.document.layouts.length,1);c.undo();assert.equal(c.document.slides[1].layout.layoutId,'layout-brand');
});

test('changing a layout preserves placeholder identity, motion, interaction, state and numeric binding behaviour',()=>{
  const doc=fixture();doc.schemaVersion='0.5-motion.1';doc.variables=[{id:'number-score',name:'점수',kind:'number',initialValue:'0',options:[],minimum:0,maximum:100,step:1}];
  const title=doc.slides[1].elements[0];title.component={kind:'button'};title.binding={variableId:'number-score',source:'variable',values:[],format:'number'};title.states=[{id:'sales-hover',name:'강조',style:{scale:1.1}}];
  doc.slides[1].motions=[{id:'sales-fade',targetId:title.id,preset:'fadeIn',start:'onClick',duration:300,delay:0,easing:'ease',iterations:1}];
  doc.slides[1].interactions=[{id:'sales-increment',sourceId:title.id,event:'click',actions:[{type:'addVariable',variableId:'number-score',amount:1}]},{id:'sales-enter',sourceId:title.id,event:'hover',actions:[{type:'setState',targetId:title.id,stateId:'sales-hover'}]}];
  const c=new CommandController(doc);c.execute(capture);const original=cloneDocument(c.document.slides[1]);c.applyLayout(['slide-sales'],'layout-brand');
  const after=c.document.slides[1];assert.equal(after.layout.elementMap['brand-title'],'sales-title');assert.deepEqual(after.motions,original.motions);assert.deepEqual(after.interactions,original.interactions);assert.deepEqual(after.elements.find(e=>e.id==='sales-title').binding,title.binding);assert.deepEqual(after.elements.find(e=>e.id==='sales-title').states,title.states);assert.deepEqual(normalizeDocument(c.document),c.document);
});

test('layout dryRun and late failure leave document, shared history, IDs and redo untouched',async t=>{
  const c=new CommandController(fixture());c.setTitle('redo');c.undo();const before=cloneDocument(c.document),history=c.readHistory().value.history;let allocations=0;t.mock.method(globalThis.crypto,'randomUUID',()=>`observed-${++allocations}`);
  const preview=await c.applyCommands(request(c,[capture,apply(['slide-sales'])],{dryRun:true}));assert.equal(preview.ok,true);assert.equal(preview.value.wouldChange,true);assert.equal(allocations,0);assert.deepEqual(c.document,before);assert.deepEqual(c.readHistory().value.history,history);
  const failed=await c.applyCommands(request(c,[capture,apply(['slide-sales']),apply(['missing'])]));assert.equal(failed.ok,false);assert.equal(failed.error.commandIndex,2);assert.equal(failed.error.mutated,false);assert.equal(allocations,0);assert.deepEqual(c.document,before);assert.deepEqual(c.readHistory().value.history,history);
  const done=await c.applyCommands(request(c,[capture,apply(['slide-sales'])]));assert.equal(done.ok,true);assert.equal(allocations,1);assert.equal(c.undoCount,1);c.undo();assert.deepEqual(c.document,before);
});

test('save/reopen retains editable prototypes; duplicate remaps instance links; cross-document imports retain editable visuals and the remapped source layout',()=>{
  const c=new CommandController(fixture());c.execute(capture);c.execute(apply(['slide-sales']));
  assert.deepEqual(parsePresentation(exportPresentation(c.document)),c.document);
  const ids=c.duplicateSlides(['slide-sales']),dup=c.document.slides.find(s=>s.id===ids[0]);assert.equal(dup.layout.layoutId,'layout-brand');
  for(const target of Object.values(dup.layout.elementMap))assert.ok(dup.elements.some(e=>e.id===target));
  assert.ok(Object.values(dup.layout.elementMap).every(target=>!Object.values(c.document.slides.find(s=>s.id==='slide-sales').layout.elementMap).includes(target)));
  const other=new CommandController({...fixture(),id:'other-deck'});const imported=other.importSlides(c.document,['slide-sales']);const pasted=other.document.slides.find(s=>s.id===imported[0]);assert.ok(other.document.layouts.some(layout=>layout.id===pasted.layout.layoutId));assert.ok(Object.values(pasted.layout.elementMap).every(id=>pasted.elements.some(element=>element.id===id)));assert.equal(pasted.elements.length,4);assert.deepEqual(pasted.elements.filter(e=>e.text).map(e=>e.text.paragraphs),[['매출 현황'],['일정과 핵심 수치']]);
});

test('layout geometry, attached/free connector endpoints and groups scale to all requested canvas ratios',()=>{
  const doc=fixture();doc.slides[0].elements.push({id:'brand-line',type:'connector',geometry:{x:0,y:0,width:1,height:1},connector:{from:{elementId:'brand-bar',anchor:'right'},to:{point:{x:1200,y:650}},route:'curve',control:{x:800,y:300},stroke:{color:'#2266aa',width:3},arrow:'end'}});
  doc.slides[0].elements[0].groupId='brand-group';doc.slides[0].elements[1].groupId='brand-group';
  const c=new CommandController(doc);c.execute(capture);
  assert.deepEqual(CANVAS_PRESETS.map(p=>p.id),['16:9','4:3','1:1','3:4','9:16']);
  c.resizeCanvas(720,1280,'scale');c.applyLayout(['slide-plans'],'layout-brand');
  const s=c.document.slides[2],line=s.elements.find(e=>e.type==='connector');assert.ok(s.elements.some(e=>e.id===line.connector.from.elementId));
  assert.equal(line.connector.to.point.x,1200*720/1280);assert.ok(Math.abs(line.connector.to.point.y-650*1280/720)<1e-8);assert.equal(line.connector.control.x,450);assert.equal(s.elements.filter(e=>e.groupId===s.elements[0].groupId).length,2);
  assert.deepEqual(c.document.layouts[0].canvas,{width:1280,height:720});
});

test('invalid master metadata fails without mutation; font punctuation and bounded CSS effects survive the same command boundary',()=>{
  const doc=fixture();for(const params of [{...capture.params,placeholderIds:['brand-bar']},{...capture.params,layoutId:'brand-title'},{...capture.params,name:' '}]){const r=evaluateCommand(doc,{id:'layout.capture',params});assert.equal(r.ok,false);assert.equal(r.error.code,'INVALID_COMMAND');assert.equal(doc.layouts,undefined);}
  const c=new CommandController(doc);c.execute(capture);const bad=cloneDocument(c.document);bad.layouts[0].placeholderIds=['missing'];assert.throws(()=>normalizeDocument(bad));
  c.setTextStyle('brand-title',{fontFamily:'Font (Display) + Custom'});c.setVisualStyle('brand-bar',{blur:2,backdropBlur:20,blendMode:'screen'});assert.equal(c.document.slides[0].elements[1].text.textStyle.fontFamily,'Font (Display) + Custom');assert.equal(c.document.slides[0].elements[0].style.backdropBlur,20);
  const before=cloneDocument(c.document);assert.equal(c.execute({id:'element.set_style',params:{elementId:'brand-bar',style:{backdropBlur:101}}}).ok,false);assert.deepEqual(c.document,before);
  assert.ok(['layout.capture','layout.apply','layout.detach','layout.delete'].every(id=>getCommandCatalog().some(c=>c.id===id)));
});
