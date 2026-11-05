import test from 'node:test';
import assert from 'node:assert/strict';
import {BUSINESS_TEMPLATE_SLIDE_COUNT,BUSINESS_TEMPLATES,getBusinessTemplates,createBusinessTemplate} from '../src/business-templates.js';
import {CommandController} from '../src/controller.js';
import {createBlankDocument,normalizeDocument} from '../src/model.js';
import {diagnoseDocument} from '../src/business-model.js';
import {exportPresentation,parsePresentation} from '../src/format.js';

const firstPages={campaign:['cover','journey','budget'],results:['overview','trend','insight'],proposal:['value','compare','process']};
const elements=doc=>doc.slides.flatMap(slide=>slide.elements);
const byId=(doc,id)=>elements(doc).find(element=>element.id===id);
const content=slide=>slide.elements.flatMap(element=>element.text?.paragraphs??[]).join('\n');
const copy=structuredClone;

test('three expanded business kits expose detached page counts and preserve the original entry pages',()=>{
 assert.equal(BUSINESS_TEMPLATE_SLIDE_COUNT,12);
 assert.equal(BUSINESS_TEMPLATES.length,3);
 assert.equal(BUSINESS_TEMPLATES.reduce((total,kit)=>total+kit.slideCount,0),36);
 const descriptions=getBusinessTemplates();descriptions[0].slideCount=1;descriptions[0].name='changed';
 assert.equal(getBusinessTemplates()[0].slideCount,12);assert.equal(getBusinessTemplates()[0].name,'캠페인 제안');
 for(const kit of BUSINESS_TEMPLATES){
  const doc=createBusinessTemplate(kit.id);
  assert.equal(doc.slides.length,kit.slideCount);assert.equal(kit.version,2);
  assert.deepEqual(doc.slides.slice(0,3).map(slide=>slide.id),firstPages[kit.id].map(key=>`template-${kit.id}-${key}`));
  assert.deepEqual(normalizeDocument(doc),doc);
  assert.equal(new Set(doc.slides.map(slide=>slide.id)).size,12);
  assert.equal(new Set(elements(doc).map(element=>element.id)).size,elements(doc).length);
 }
 assert.throws(()=>createBusinessTemplate('unknown'),/업무 템플릿/);
});

test('all 36 pages are editable semantic content with reading order, layout slots and actionable presenter notes',()=>{
 for(const kit of BUSINESS_TEMPLATES){
  const doc=createBusinessTemplate(kit.id);
  for(const [index,slide] of doc.slides.entries()){
   assert.ok(content(slide).length>45,`${slide.id}: meaningful editable text`);
   assert.ok(!/lorem|ipsum|placeholder/i.test(content(slide)));
   assert.ok(slide.notes.length>12,`${slide.id}: presenter guidance`);
   assert.deepEqual(slide.readingOrder,slide.elements.map(element=>element.id));
   assert.deepEqual(slide.template.slots.map(slot=>slot.elementId),slide.readingOrder);
   assert.ok(slide.template.slots.some(slot=>slot.role==='title'));
   assert.ok(slide.elements.every(element=>element.type!=='image'));
   assert.ok(slide.elements.filter(element=>element.text).every(element=>element.themeRefs.fontFamily===true));
   if(index>=3)assert.match(slide.notes,/제작 예시이며 실제 조사 결과가 아닙니다/);
  }
  assert.ok(elements(doc).some(element=>element.table?.rows.length>=4));
  assert.ok(elements(doc).some(element=>element.chart)||elements(doc).some(element=>element.connector));
  for(const element of elements(doc).filter(element=>element.chart)){
   assert.ok(element.chart.categories.length>=3);
   assert.ok(element.chart.series.every(series=>series.values.length===element.chart.categories.length));
   assert.ok(element.chart.series.some(series=>series.values.some(value=>value>0)));
  }
 }
});

test('all expanded pages round-trip through standalone HTML and retain charts, tables, notes and variable bindings',()=>{
 for(const kit of BUSINESS_TEMPLATES){
  const doc=createBusinessTemplate(kit.id),html=exportPresentation(doc),reopened=parsePresentation(html);
  assert.deepEqual(reopened,doc);assert.equal(reopened.slides.length,12);
  assert.ok(html.includes('<script type="application/json"'));
 }
 const results=createBusinessTemplate('results'),trend=results.slides[1];
 const tabs=trend.elements.find(element=>element.component),chart=trend.elements.find(element=>element.chart),kpi=trend.elements.find(element=>element.binding);
 assert.equal(tabs.component.variableId,results.variables[0].id);
 assert.equal(chart.chart.variants.variableId,tabs.component.variableId);
 assert.equal(kpi.binding.variableId,tabs.component.variableId);
 assert.deepEqual(chart.chart.variants.values.map(row=>row.value),['2024','2025','2026']);
});

test('the five supported canvas ratios letterbox every page without clipped geometry or newly reduced text sizes',()=>{
 for(const [width,height] of [[1280,720],[1200,900],[1080,1080],[900,1200],[720,1280]])for(const kit of BUSINESS_TEMPLATES){
  const canvas={width,height,unit:'logical-px'},doc=createBusinessTemplate(kit.id,{canvas}),scale=Math.min(width/1280,height/720);
  assert.deepEqual(doc.canvas,canvas);
  assert.deepEqual(diagnoseDocument(doc).filter(issue=>issue.code==='OUTSIDE_CANVAS'),[],`${kit.id} ${width}x${height}`);
  for(const element of elements(doc)){
   if(element.text)assert.ok(element.text.textStyle.fontSize>=17*scale,`${element.id}: no micro type added`);
   if(element.table)assert.ok(element.table.fontSize>=21*scale);
  }
 }
});

test('a selected three-page subset imports with fresh IDs, semantic data and one shared Undo/Redo',()=>{
 for(const kit of BUSINESS_TEMPLATES){
  const source=createBusinessTemplate(kit.id),controller=new CommandController(createBlankDocument()),before=copy(controller.document);
  const indexes=kit.id==='results'?[1,4,11]:[1,6,11],selected=indexes.map(index=>source.slides[index]),ids=controller.importSlides(source,selected.map(slide=>slide.id));
  assert.equal(ids.length,3);assert.equal(controller.document.slides.length,4);assert.equal(controller.undoCount,1);
  const imported=ids.map(id=>controller.document.slides.find(slide=>slide.id===id));
  for(const [index,slide] of imported.entries()){
   assert.notEqual(slide.id,selected[index].id);assert.equal(content(slide),content(selected[index]));assert.equal(slide.notes,selected[index].notes);
   assert.equal(slide.elements.length,selected[index].elements.length);
   assert.ok(slide.elements.every(element=>!elements(source).some(original=>original.id===element.id)));
   assert.deepEqual(slide.readingOrder,slide.elements.map(element=>element.id));
   assert.deepEqual(slide.template.slots.map(slot=>slot.elementId),slide.readingOrder);
   const localIds=new Set(slide.elements.map(element=>element.id));
   for(const element of slide.elements.filter(element=>element.connector)){
    assert.ok(localIds.has(element.connector.from.elementId));assert.ok(localIds.has(element.connector.to.elementId));
   }
  }
  if(kit.id==='results'){
   const chart=imported[0].elements.find(element=>element.chart),variable=controller.document.variables.find(value=>value.id===chart.chart.variants.variableId);
   assert.ok(variable);assert.notEqual(variable.id,source.variables[0].id);assert.equal(variable.initialValue,'2025');
  }
  const after=copy(controller.document);assert.deepEqual(parsePresentation(exportPresentation(after)),after);
  controller.undo();assert.deepEqual(controller.document,before);controller.redo();assert.deepEqual(controller.document,after);
  const second=controller.importSlides(source,[source.slides[11].id]);assert.equal(second.length,1);assert.ok(!ids.includes(second[0]));
  controller.undo();assert.deepEqual(controller.document,after);
 }
});

test('people can change new-page text, table and chart data as a single reversible edit after reopening',()=>{
 const original=parsePresentation(exportPresentation(createBusinessTemplate('results'))),controller=new CommandController(original),before=copy(controller.document);
 const text=original.slides[3].elements.find(element=>element.text),table=original.slides[4].elements.find(element=>element.table),chart=original.slides[5].elements.find(element=>element.chart);
 const nextTable=copy(table.table);nextTable.rows[1][1].text='우리 팀 집계 정의';
 const nextChart=copy(chart.chart);nextChart.series[1].values=[101,118,109];
 controller.runBatch([{id:'text.set_content',params:{elementId:text.id,paragraphs:['우리 팀 성과 요약']}},{id:'table.set_data',params:{elementId:table.id,table:nextTable}},{id:'chart.set_data',params:{elementId:chart.id,chart:nextChart}}],'성과 자료 재편집');
 assert.equal(controller.undoCount,1);assert.equal(byId(controller.document,text.id).text.paragraphs[0],'우리 팀 성과 요약');
 assert.equal(byId(controller.document,table.id).table.rows[1][1].text,'우리 팀 집계 정의');assert.deepEqual(byId(controller.document,chart.id).chart.series[1].values,[101,118,109]);
 const edited=copy(controller.document);assert.deepEqual(parsePresentation(exportPresentation(edited)),edited);
 controller.undo();assert.deepEqual(controller.document,before);controller.redo();assert.deepEqual(controller.document,edited);
});

test('invalid kit data and missing-page selections leave the target and shared history untouched',()=>{
 const controller=new CommandController(createBlankDocument()),source=createBusinessTemplate('campaign'),before=copy(controller.document);
 const bad=copy(source);bad.slides[2].elements.find(element=>element.table).table.rows[1].pop();
 assert.throws(()=>controller.importSlides(bad,[bad.slides[2].id]));assert.deepEqual(controller.document,before);assert.equal(controller.undoCount,0);
 assert.throws(()=>controller.importSlides(source,['missing-slide']));assert.deepEqual(controller.document,before);assert.equal(controller.undoCount,0);
});
