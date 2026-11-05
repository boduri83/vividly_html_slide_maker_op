import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeDocument} from '../src/model.js';
import {CommandController} from '../src/controller.js';
import {businessSchemas,normalizeBusinessValue} from '../src/business-model.js';
import {chartGraphic,staticDocument} from '../src/business-render.js';
import {exportPresentation,parsePresentation,createStaticExport} from '../src/format.js';
import {installChartJs} from '../src/chart-vendor.js';
import {createChartRuntime} from '../src/chart-runtime.js';

const seed=JSON.parse(readFileSync(new URL('../examples/document-contract-v0.1.json',import.meta.url),'utf8'));
const presentation={animated:true,duration:900,showTooltip:true,legendPosition:'bottom',stacked:false,smooth:true,fill:false};
const kinds=['bar','line','doughnut','pie','radar','polarArea'];
const chart=(kind='bar')=>({kind,categories:['검색','소셜','이메일'],series:[{id:'actual',name:'성과',color:'#5066d8',values:[120,null,240]},{id:'target',name:'목표',color:'#16a18b',values:[180,210,260]}],showLegend:true,presentation:{...presentation}});
function fixture(kind='bar'){const doc=structuredClone(seed);doc.schemaVersion='0.5-motion.1';doc.slides=[doc.slides[0]];delete doc.slides[0].readingOrder;doc.slides[0].elements=[{id:'live-chart',type:'chart',name:'성과 <비교>',geometry:{x:100,y:100,width:700,height:400},chart:chart(kind)}];return normalizeDocument(doc);}

test('six semantic chart kinds and closed presentation settings roundtrip without author changes',()=>{
 for(const kind of kinds){const doc=fixture(kind),copy=structuredClone(doc);assert.deepEqual(normalizeDocument(doc),doc);assert.deepEqual(parsePresentation(exportPresentation(doc)),doc);const graphic=chartGraphic(doc.slides[0].elements[0].chart,700,400,'<성과>');assert.match(graphic,/<svg/);assert.match(graphic,/business-chart-data/);assert.match(graphic,/&lt;성과&gt;/);assert.doesNotMatch(graphic,/NaN|Infinity/);assert.deepEqual(doc,copy);assert.match(createStaticExport(doc).html,/<svg/);}
 const old=chart();delete old.presentation;assert.equal(normalizeBusinessValue(old,businessSchemas.chart).presentation,undefined);
});

test('chart options reject callbacks, open fields, invalid timings and negative radial variants',()=>{
 for(const mutate of [c=>c.presentation.duration=5001,c=>c.presentation.duration=.5,c=>c.presentation.easing='eval',c=>c.presentation.onClick='x()',c=>c.kind='script',c=>c.presentation.legendPosition='outside']){const value=chart();mutate(value);assert.throws(()=>normalizeBusinessValue(value,businessSchemas.chart));}
 for(const kind of kinds.slice(2)){const doc=fixture(kind);doc.slides[0].elements[0].chart.series[0].values[0]=-1;assert.throws(()=>normalizeDocument(doc),/0 이상/);}
 const signed=fixture('line');signed.slides[0].elements[0].chart.series[0].values[0]=-30;assert.equal(normalizeDocument(signed).slides[0].elements[0].chart.series[0].values[0],-30);
});

test('manual chart update is one shared Undo and failed radial edit preserves document',()=>{
 const store=new CommandController(fixture()),before=structuredClone(store.document),next=chart('doughnut');
 store.setChart('live-chart',next);assert.equal(store.undoCount,1);assert.equal(store.document.slides[0].elements[0].chart.kind,'doughnut');store.undo();assert.deepEqual(store.document,before);store.redo();assert.equal(store.document.slides[0].elements[0].chart.presentation.duration,900);
 const committed=structuredClone(store.document),count=store.undoCount;next.series[0].values[0]=-9;assert.throws(()=>store.setChart('live-chart',next));assert.deepEqual(store.document,committed);assert.equal(store.undoCount,count);
});

test('static bound chart selects data but keeps source authoring variant tables',()=>{
 const doc=fixture('pie');doc.variables=[{id:'year',name:'연도',initialValue:'2026',options:[{value:'2026',label:'2026'},{value:'2027',label:'2027'}]}];
 doc.slides[0].elements[0].chart.variants={variableId:'year',values:['2026','2027'].map((value,i)=>({value,series:doc.slides[0].elements[0].chart.series.map(s=>({seriesId:s.id,values:s.values.map(v=>v===null?null:v+i*100)}))}))};
 const normalized=normalizeDocument(doc),before=structuredClone(normalized),snapshot=staticDocument(normalized,{state:{variables:{year:'2027'}}});assert.equal(snapshot.slides[0].elements[0].chart.series[0].values[0],220);assert.equal(snapshot.slides[0].elements[0].chart.variants,undefined);assert.deepEqual(normalized,before);
});

test('static stacked signed bars and filled smooth lines preserve original accessible values',()=>{
 const data=chart('bar');data.series[0].values=[120,-40,0];data.series[1].values=[160,-80,0];data.presentation.stacked=true;
 const svg=chartGraphic(data,700,400);assert.doesNotMatch(svg,/NaN|Infinity/);assert.match(svg,/<td>-40<\/td>/);assert.match(svg,/<td>-80<\/td>/);
 const rects=[...svg.matchAll(/<rect data-series-id="([^"]+)" data-category-index="0" x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/g)];assert.equal(rects.length,2);assert.equal(rects[0][2],rects[1][2]);assert.equal(rects[0][4],rects[1][4]);assert.notEqual(rects[0][3],rects[1][3]);
 data.kind='line';data.presentation.fill=true;data.presentation.smooth=true;assert.match(chartGraphic(data,700,400),/ C /);assert.match(chartGraphic(data,700,400),/fill-opacity=".25"/);
 for(const kind of ['pie','doughnut','radar','polarArea']){const empty=chart(kind);empty.series.forEach(s=>s.values=[null,0,0]);assert.doesNotMatch(chartGraphic(empty,700,400),/NaN|Infinity/);}
});

test('pinned Chart.js installer and runtime are ordinary self-contained serializable functions',()=>{
 assert.equal(installChartJs().version,'4.6.1');assert.equal(installChartJs(),globalThis.Chart);assert.doesNotMatch(installChartJs.toString(),/sourceMappingURL|new Function|eval\(/);assert.match(createChartRuntime.toString(),/function configuration/);
 const inert=createChartRuntime({root:{querySelectorAll:()=>[]},document:fixture(),Chart:null});assert.doesNotThrow(()=>inert.sync());assert.equal(inert.instances.length,0);inert.destroy();
});
