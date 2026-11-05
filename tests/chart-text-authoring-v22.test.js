import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {CommandController} from '../src/controller.js';
import {normalizeDocument} from '../src/model.js';
import {chartGraphic,renderRichParagraphs} from '../src/business-render.js';
import {createChartRuntime} from '../src/chart-runtime.js';
import {chartValueDomain,formatChartNumber} from '../src/business-model.js';
import {pasteChartTable} from '../src/business-data-editing.js';
import {textToRichDocument,richDocumentToText} from '../src/rich-text-conversion.js';
import {exportPresentation,parsePresentation} from '../src/format.js';

const chart=()=>({kind:'bar',categories:['검색','소셜'],series:[{id:'actual',name:'실적',color:'#5066d8',values:[120,-40]},{id:'goal',name:'목표',color:'#14a58f',values:[160,20]}],showLegend:true});
const axes=()=>({direction:'horizontal',minimum:-100,maximum:300,step:100,showGrid:false,showCategoryLabels:true,categoryTitle:'채널',valueTitle:'매출'});
const labels=()=>({show:true,decimals:1,prefix:'₩',suffix:' 만원',grouping:true});
function fixture(value=chart()){
  const c=new CommandController(),source=c.snapshot();source.schemaVersion=value.axes||value.labels?'0.15-authoring.1':'0.4-business.1';source.slides=[{id:'slide-chart',background:'#ffffff',elements:[{id:'chart-live',type:'chart',name:'매출 <보고>',geometry:{x:70,y:70,width:700,height:400},chart:value}]}];return normalizeDocument(source);
}

test('optional chart axes and units keep old documents byte-equivalent and reject invalid domains without history',()=>{
  const source=fixture();assert.equal(source.slides[0].elements[0].chart.axes,undefined);assert.deepEqual(parsePresentation(exportPresentation(source)),source);
  const c=new CommandController(source),before=c.snapshot(),history=c.undoCount;
  const good={...chart(),axes:axes(),labels:labels()};c.setChart('chart-live',good);const after=c.snapshot();assert.equal(c.undoCount,history+1);assert.deepEqual(chartValueDomain(good),{minimum:-100,maximum:300});
  c.undo();assert.deepEqual(c.snapshot(),before);c.redo();assert.deepEqual(c.snapshot(),after);assert.deepEqual(parsePresentation(exportPresentation(after)),after);
  for(const mutate of [v=>v.axes.minimum=300,v=>v.axes.step=.001,v=>v.axes.maximum=Infinity,v=>v.axes.callback='unsafe',v=>v.labels.decimals=7,v=>v.labels.prefix='x'.repeat(33)]){const invalid=structuredClone(good);mutate(invalid);const current=c.snapshot(),count=c.undoCount;assert.throws(()=>c.setChart('chart-live',invalid));assert.deepEqual(c.snapshot(),current);assert.equal(c.undoCount,count);}
  assert.equal(formatChartNumber(1234.25,labels()),'₩1,234.3 만원');assert.equal(formatChartNumber(.125),'0.13');
});

test('Chart.js author settings survive self-contained runtime serialization and preserve raw numerical data',()=>{
  const doc=fixture({...chart(),axes:axes(),labels:labels()}),configs=[],canvases=[];
  const output={innerHTML:'fallback',isConnected:true,querySelector:()=>null,replaceChildren(canvas){canvases.push(canvas);this.canvas=canvas;},contains(canvas){return this.canvas===canvas;},ownerDocument:{createElement(){return{className:'',dataset:{},style:{},isConnected:true,setAttribute(){}};}}};
  const figure={querySelector:()=>output,dataset:{}},host={dataset:{elementId:'chart-live'},querySelector:()=>figure,contains:canvas=>output.contains(canvas)},root={querySelectorAll:()=>[host]};
  class Chart{constructor(_canvas,config){configs.push(config);this.data=config.data;this.options=config.options;}destroy(){}update(){}}
  const factory=vm.runInNewContext('('+createChartRuntime.toString()+')',{Intl,Map,Number});
  const runtime=factory({root,document:doc,Chart,interactive:true,animate:false});runtime.sync();
  const config=configs[0];assert.equal(config.options.indexAxis,'y');assert.equal(config.options.scales.x.min,-100);assert.equal(config.options.scales.x.max,300);assert.equal(config.options.scales.x.ticks.stepSize,100);assert.equal(config.options.scales.x.grid.display,false);assert.equal(config.options.scales.y.title.text,'채널');assert.equal(config.options.scales.x.title.text,'매출');
  assert.equal(config.options.scales.x.ticks.callback(120),'₩120.0 만원');assert.equal(config.options.plugins.tooltip.callbacks.label({dataset:{label:'실적'},raw:-40}),'실적: ₩-40.0 만원');assert.deepEqual([...config.data.datasets[0].data],[120,-40]);assert.equal(config.plugins[0].id,'vividlyValueLabels');assert.equal(config.options.plugins.vividlyValueLabels.show,true);runtime.destroy();
});

test('static charts respect signed horizontal geometry, units, selected bounds, titles and accessible original values',()=>{
  const value={...chart(),axes:axes(),labels:labels()},before=structuredClone(value),svg=chartGraphic(value,700,400,'<단위>');
  assert.match(svg,/data-chart-axis-title/);assert.match(svg,/채널/);assert.match(svg,/₩120\.0 만원/);assert.match(svg,/<td>-40<\/td>/);assert.match(svg,/&lt;단위&gt;/);assert.doesNotMatch(svg,/NaN|Infinity|stroke="#dce3ef"/);
  const bars=[...svg.matchAll(/<rect data-series-id="actual" data-category-index="(\d)" x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/g)];assert.equal(bars.length,2);assert.ok(Number(bars[0][2])>Number(bars[1][2]));assert.ok(Number(bars[0][4])>Number(bars[0][5]));assert.deepEqual(value,before);
  for(const kind of ['line','pie','doughnut','radar','polarArea']){const data={...chart(),kind,axes:axes(),labels:labels()};if(kind!=='line')data.series.forEach(series=>series.values=[100,null]);const markup=chartGraphic(data,700,400);assert.match(markup,/data-chart-value-label/);assert.doesNotMatch(markup,/NaN|Infinity/);}
});

test('whole spreadsheet paste keeps semantic series IDs and other variant values while replacing selected data',()=>{
  const source=chart();source.categories=['검색','소셜'];source.variants={variableId:'year',values:[{value:'2026',series:[{seriesId:'actual',values:[10,20]},{seriesId:'goal',values:[30,40]}]},{value:'2027',series:[{seriesId:'goal',values:[300,400]},{seriesId:'actual',values:[100,200]}]}]};const before=structuredClone(source);
  const next=pasteChartTable(source,{text:'채널\t목표\t실적\t추가\n소셜\t1,200\t\t9\n검색\t500\t300\t8',choice:'value:2027',createSeriesId:()=> 'third'});
  assert.deepEqual(next.categories,['소셜','검색']);assert.deepEqual(next.series.map(series=>series.id),['goal','actual','third']);assert.deepEqual(next.series[0].values,[20,160]);assert.deepEqual(next.variants.values[0].series.map(series=>series.values),[[40,30],[20,10],[null,null]]);assert.deepEqual(next.variants.values[1].series.map(series=>series.values),[[1200,500],[null,300],[9,8]]);assert.deepEqual(source,before);
  for(const text of ['bad','채널\t실적\n검색\tbad','채널\t실적\n검색\tInfinity','채널\t실적\n검색\t1\n소셜'])assert.throws(()=>pasteChartTable(source,{text}));assert.deepEqual(source,before);
});

test('variant chart tick limits include every selected data table and reject huge hidden ranges atomically',()=>{
  const value=chart();value.axes={...axes(),minimum:null,maximum:null,step:1};value.series.forEach(series=>series.values=[1,2]);value.variants={variableId:'year',values:[{value:'large',series:value.series.map(series=>({seriesId:series.id,values:[1,10000]}))}]};
  assert.throws(()=>fixture(value),/눈금 간격/);
});

test('font-family character marks preserve local false styles, grapheme ranges and escaped HTML through shared Undo and reopen',()=>{
  const c=new CommandController(),id=c.addText();c.run('text.set_content',{elementId:id,paragraphs:['업무 👨‍👩‍👧‍👦 제안서']});c.setTextStyle(id,{italic:true});c.setRuns(id,[{paragraph:0,start:0,end:2,italic:false,href:'https://example.test'}]);
  const before=c.snapshot(),history=c.undoCount;c.run('text.format_range',{elementId:id,range:{paragraph:0,start:0,end:2},marks:{fontFamily:'Georgia, serif'}});const after=c.snapshot();assert.equal(c.undoCount,history+1);const text=c.selectedElement.text;
  assert.equal(text.runs[0].fontFamily,'Georgia, serif');assert.equal(text.runs[0].italic,false);assert.deepEqual(richDocumentToText(textToRichDocument(text),text),text);assert.match(renderRichParagraphs(text),/font-family:&quot;Georgia&quot;,serif/);
  c.undo();assert.deepEqual(c.snapshot(),before);c.redo();assert.deepEqual(c.snapshot(),after);assert.deepEqual(parsePresentation(exportPresentation(after)),after);
  const current=c.snapshot(),count=c.undoCount;for(const family of ['', ' ', 'Arial\nunsafe'])assert.throws(()=>c.run('text.format_range',{elementId:id,range:{paragraph:0,start:0,end:2},marks:{fontFamily:family}}));assert.deepEqual(c.snapshot(),current);assert.equal(c.undoCount,count);
  const hostile=structuredClone(text);hostile.runs[0].fontFamily='Arial";color:red;/*';assert.match(renderRichParagraphs(hostile),/font-family:/);assert.doesNotMatch(renderRichParagraphs(hostile),/<script/);
});
