/** Closed, semantic author data for editable business presentations. */
import { normalizeMotionValue } from './motion-model.js';
import { formulaValue } from './advanced-motion-model.js';
import { normalizeSvgPath } from './svg-path.js';
import { isFontFamily } from './font-names.js';

export const BUSINESS_SCHEMA='0.4-business.1';
const object=(properties,required=Object.keys(properties),extra={})=>({type:'object',properties,required,additionalProperties:false,...extra});
const string=(maxLength=65536)=>({type:'string',maxLength});
const id={...string(256),minLength:1,pattern:'\\S'};
const integer=(minimum,maximum)=>({type:'integer',minimum,maximum});
const number=(minimum=-1000000,maximum=1000000)=>({type:'number',minimum,maximum});
const enumeration=(...values)=>({type:'string',enum:values});
const array=(items,maxItems,minItems=0)=>({type:'array',items,maxItems,minItems});
const nullable=schema=>({anyOf:[{type:'null'},schema]});
const color={...string(9),pattern:'^#(?:[\\da-fA-F]{3}|[\\da-fA-F]{4}|[\\da-fA-F]{6}|[\\da-fA-F]{8})$'};
const paint={anyOf:[color,enumeration('none')]};
const boolean={type:'boolean'};
const cell=object({text:string(),fill:color,color,bold:boolean,align:enumeration('left','center','right')},['text']);
const values=array(nullable(number(-1e15,1e15)),128,1);
const markFields={bold:boolean,italic:boolean,underline:boolean,strike:boolean,fontSize:number(.1,1000),fontFamily:string(256),color,href:string(4096)};
const masterFields={enabled:boolean,footer:string(1024),logoText:string(256),accentColor:color,showPageNumber:boolean};
const svgPaint={fill:paint,stroke:paint,strokeWidth:number(0,10000)};
const connectorPoint=object({x:number(),y:number()});
const connectorEndpoint={anyOf:[object({elementId:id,anchor:enumeration('top','right','bottom','left','center')}),object({elementId:id,anchor:enumeration('custom'),position:object({x:number(0,1),y:number(0,1)})}),object({point:connectorPoint})]};
const svgShapes={anyOf:[
 object({kind:enumeration('rect'),x:number(),y:number(),width:number(.001),height:number(.001),rx:number(0),...svgPaint},['kind','x','y','width','height','fill']),
 object({kind:enumeration('circle'),cx:number(),cy:number(),r:number(.001),...svgPaint},['kind','cx','cy','r','fill']),
 object({kind:enumeration('ellipse'),cx:number(),cy:number(),rx:number(.001),ry:number(.001),...svgPaint},['kind','cx','cy','rx','ry','fill']),
 object({kind:enumeration('line'),x1:number(),y1:number(),x2:number(),y2:number(),stroke:paint,strokeWidth:number(0,10000)},['kind','x1','y1','x2','y2','stroke','strokeWidth']),
 object({kind:enumeration('polygon','polyline'),points:array(object({x:number(),y:number()}),1024,2),...svgPaint},['kind','points','fill']),
 object({kind:enumeration('path'),d:{...string(32768),minLength:1},...svgPaint,fillRule:enumeration('nonzero','evenodd'),strokeLinecap:enumeration('butt','round','square'),strokeLinejoin:enumeration('miter','round','bevel')},['kind','d']),
]};
export const businessSchemas={
 runs:array(object({paragraph:integer(0,4095),start:integer(0,131072),end:integer(0,131072),...markFields},['paragraph','start','end']),8192),
 paragraphStyles:array(object({list:enumeration('none','bullet','number'),level:integer(0,4),spaceBefore:number(0,1000),spaceAfter:number(0,1000)}),4096),
 range:object({paragraph:integer(0,4095),start:integer(0,131072),end:integer(0,131072)}),
 marks:object({...markFields,fontSize:nullable(markFields.fontSize),fontFamily:nullable(markFields.fontFamily),color:nullable(color),href:nullable(markFields.href)},[],{minProperties:1}),
 table:object({rows:array(array(cell,30,1),100,1),columnWidths:array(number(.001,100000),30,1),headerRows:integer(0,10),fontSize:number(6,240)}),
 chart:object({kind:enumeration('bar','line','doughnut','pie','radar','polarArea'),categories:array(string(256),128,1),series:array(object({id,name:string(256),color,values}),12,1),showLegend:boolean,
   axes:object({direction:enumeration('vertical','horizontal'),minimum:nullable(number(-1e15,1e15)),maximum:nullable(number(-1e15,1e15)),step:nullable(number(.000000001,1e15)),showGrid:boolean,showCategoryLabels:boolean,categoryTitle:string(256),valueTitle:string(256)}),
   labels:object({show:boolean,decimals:nullable(integer(0,6)),prefix:string(32),suffix:string(32),grouping:boolean}),
   presentation:object({animated:boolean,duration:integer(0,5000),showTooltip:boolean,legendPosition:enumeration('top','bottom','left','right'),stacked:boolean,smooth:boolean,fill:boolean}),
   variants:object({variableId:id,values:array(object({value:string(256),series:array(object({seriesId:id,values}),12,1)}),128,1)})},['kind','categories','series','showLegend']),
 connector:object({from:connectorEndpoint,to:connectorEndpoint,stroke:object({color,width:number(.1,100)}),arrow:enumeration('none','end','both'),route:enumeration('straight','elbow','curve','polyline'),control:connectorPoint,waypoints:array(connectorPoint,32)},['from','to','stroke','arrow']),
 svg:object({viewBox:object({width:number(.001),height:number(.001)}),shapes:array(svgShapes,256,1),title:string(512)},['viewBox','shapes']),
 master:object(masterFields),masterOverride:object(masterFields,[]),
 template:object({id,version:integer(1,100000),slots:array(object({elementId:id,role:enumeration('title','body','image','metric','table','chart','decoration')}),1000)}),
 semanticRole:enumeration('auto','heading','body','decorative'),
 spacing:object({xs:number(0,1000),sm:number(0,1000),md:number(0,1000),lg:number(0,1000),xl:number(0,1000)}),
};
export function normalizeBusinessValue(value,schema,label='business'){return normalizeMotionValue(value,schema,label);}
export function isBusinessElement(element){return ['table','chart','connector','svg','video'].includes(element.type)||element.semanticRole!==undefined||element.text?.runs!==undefined||element.text?.paragraphStyles!==undefined;}
export function isBusinessDocument(document){return document.master!==undefined||document.theme?.headingFontFamily!==undefined||document.theme?.spacing!==undefined||document.slides.some(s=>s.notes!==undefined||s.readingOrder!==undefined||s.hideMaster!==undefined||s.masterOverride!==undefined||s.template!==undefined||s.elements.some(isBusinessElement));}
export function safeHref(value){
 if(typeof value!=='string'||/[\u0000-\u0020\u007f]/u.test(value))throw new Error('href: 공백 없는 지원 URL이 필요합니다.');
 let parsed;try{parsed=new URL(value);}catch{throw new Error('href: 올바른 URL이 필요합니다.');}
 if(!['http:','https:','mailto:'].includes(parsed.protocol)||parsed.username||parsed.password)throw new Error('href: http/https/mailto URL만 사용할 수 있습니다.');
 return value;
}
export function graphemeBoundaries(text){
 const result=new Set([0,text.length]);
 if(globalThis.Intl?.Segmenter)for(const part of new Intl.Segmenter('ko',{granularity:'grapheme'}).segment(text))result.add(part.index);
 else for(let i=0;i<text.length;){result.add(i);i+=text.codePointAt(i)>65535?2:1;}
 return result;
}
export function validateTextRange(paragraphs,range){
 const {paragraph,start,end}=range,text=paragraphs[paragraph];
 if(typeof text!=='string'||start>=end||end>text.length||!graphemeBoundaries(text).has(start)||!graphemeBoundaries(text).has(end))throw new Error('문자 범위는 같은 문단의 완전한 문자 경계여야 합니다.');
 return range;
}
export function normalizeBusinessText(value,result){
 if(value.runs!==undefined){
  result.runs=normalizeBusinessValue(value.runs,businessSchemas.runs,'text.runs');
  let paragraph=-1,end=-1;
  for(const run of result.runs){validateTextRange(result.paragraphs,run);if(run.paragraph<paragraph||run.paragraph===paragraph&&run.start<end)throw new Error('text.runs: 문단/시작 순서의 겹치지 않는 범위가 필요합니다.');paragraph=run.paragraph;end=run.end;
   if(Object.keys(run).length===3)throw new Error('text.runs: 한 개 이상의 서식이 필요합니다.');if(run.href!==undefined)safeHref(run.href);if(run.fontFamily!==undefined&&!isFontFamily(run.fontFamily))throw Error('text.runs: 유효한 글꼴 이름이 필요합니다.');
  }
 }
 if(value.paragraphStyles!==undefined){result.paragraphStyles=normalizeBusinessValue(value.paragraphStyles,businessSchemas.paragraphStyles,'paragraphStyles');if(result.paragraphStyles.length!==result.paragraphs.length)throw new Error('paragraphStyles: 문단 수와 같은 배열이 필요합니다.');}
 return result;
}
export function applyTextRange(text,range,marks){
 validateTextRange(text.paragraphs,range);if(marks.href!==undefined&&marks.href!==null)safeHref(marks.href);
 const old=text.runs||[],bounds=new Set([range.start,range.end]);
 for(const run of old)if(run.paragraph===range.paragraph){bounds.add(run.start);bounds.add(run.end);}
 const sorted=[...bounds].sort((a,b)=>a-b),result=old.filter(r=>r.paragraph!==range.paragraph).map(r=>({...r}));
 for(let i=0;i<sorted.length-1;i++){
  const start=sorted[i],end=sorted[i+1],prior=old.find(r=>r.paragraph===range.paragraph&&r.start<=start&&r.end>=end),style=prior?Object.fromEntries(Object.entries(prior).filter(([k])=>!['paragraph','start','end'].includes(k))):{};
  if(start>=range.start&&end<=range.end)for(const [key,value]of Object.entries(marks)){if(value===null)delete style[key];else style[key]=value;}
  if(Object.keys(style).length)result.push({paragraph:range.paragraph,start,end,...style});
 }
 result.sort((a,b)=>a.paragraph-b.paragraph||a.start-b.start);
 const merged=[];for(const run of result){const previous=merged.at(-1),style=r=>Object.fromEntries(Object.entries(r).filter(([k])=>!['paragraph','start','end'].includes(k)));if(previous&&previous.paragraph===run.paragraph&&previous.end===run.start&&JSON.stringify(style(previous))===JSON.stringify(style(run)))previous.end=run.end;else merged.push(run);}
 return {...text,runs:merged};
}
export function validateBusinessElement(element){
 if(element.connector&&(element.rotation??0)!==0)throw new Error('connector: 회전은 연결 대상의 기하에서 계산합니다.');
 if(element.table){const table=element.table,columns=table.rows[0].length;if(table.rows.some(row=>row.length!==columns)||table.columnWidths.length!==columns||table.headerRows>table.rows.length||columns*table.rows.length>2000)throw new Error('table: 같은 열 수·너비와 유효한 머리글 행이 필요합니다.');}
 if(element.chart){const chart=element.chart;if(new Set(chart.series.map(s=>s.id)).size!==chart.series.length||chart.series.some(s=>s.values.length!==chart.categories.length))throw new Error('chart: 중복 없는 series ID와 category 수에 맞는 값이 필요합니다.');
  if(chart.axes?.minimum!==null&&chart.axes?.minimum!==undefined&&chart.axes?.maximum!==null&&chart.axes?.maximum!==undefined&&chart.axes.minimum>=chart.axes.maximum)throw Error('chart.axes: 최솟값은 최댓값보다 작아야 합니다.');
  if(chart.axes?.step!==null&&chart.axes?.step!==undefined){const states=[chart,...(chart.variants?.values||[]).map(variant=>({...chart,series:chart.series.map(series=>({...series,values:variant.series.find(row=>row.seriesId===series.id)?.values||series.values}))}))];if(states.some(state=>{const range=chartValueDomain(state);return(range.maximum-range.minimum)/chart.axes.step>1000;}))throw Error('chart.axes: 눈금 간격을 늘리세요. 눈금은 1000개 이하로 설정합니다.');}
  if(['doughnut','pie','radar','polarArea'].includes(chart.kind)&&[...chart.series,...(chart.variants?.values.flatMap(v=>v.series)||[])].some(s=>s.values.some(v=>v!==null&&v<0)))throw new Error('chart: 원형·방사형 차트는 0 이상의 수치가 필요합니다. 음수는 막대·선 차트를 사용하세요.');
 }
 if(element.svg)for(const shape of element.svg.shapes)if(shape.kind==='path')shape.d=normalizeSvgPath(shape.d);
}
export function chartValueDomain(chart){
 const totals=chart.categories.map(()=>({positive:0,negative:0})),values=[];
 for(const series of chart.series)series.values.forEach((value,index)=>{if(value===null)return;if(chart.presentation?.stacked){const key=value>=0?'positive':'negative';totals[index][key]+=value;values.push(totals[index][key]);}else values.push(value);});
 let minimum=chart.axes?.minimum??Math.min(0,...values),maximum=chart.axes?.maximum??Math.max(0,...values);
 if(maximum<=minimum){if(chart.axes?.maximum!==null&&chart.axes?.maximum!==undefined)minimum=maximum-1;else maximum=minimum+1;}
 return{minimum,maximum};
}
export function formatChartNumber(value,labels={}){return (labels.prefix||'')+new Intl.NumberFormat('ko-KR',{minimumFractionDigits:labels.decimals??0,maximumFractionDigits:labels.decimals??2,useGrouping:labels.grouping??true}).format(value)+(labels.suffix||'');}
export function anchorPoint(element,anchor,position){
 const g=element.geometry,cx=g.x+g.width/2,cy=g.y+g.height/2,offset=anchor==='custom'?[(position.x-.5)*g.width,(position.y-.5)*g.height]:{top:[0,-g.height/2],right:[g.width/2,0],bottom:[0,g.height/2],left:[-g.width/2,0],center:[0,0]}[anchor],r=(element.rotation||0)*Math.PI/180;
 return {x:cx+offset[0]*Math.cos(r)-offset[1]*Math.sin(r),y:cy+offset[0]*Math.sin(r)+offset[1]*Math.cos(r)};
}
export function resolveConnectorEndpoint(endpoint,slide){
 if(endpoint.point)return{x:endpoint.point.x,y:endpoint.point.y};
 const element=slide.elements.find(e=>e.id===endpoint.elementId);
 if(!element||element.type==='connector')throw new Error('connector: 연결할 도형이 없습니다.');
 return anchorPoint(element,endpoint.anchor,endpoint.position);
}
export function resolveConnectorGeometry(element,slide){
 const {connector}=element,a=resolveConnectorEndpoint(connector.from,slide),b=resolveConnectorEndpoint(connector.to,slide),route=connector.route||'straight',control=connector.control||(route==='curve'?{x:(a.x+b.x)/2,y:Math.min(a.y,b.y)-Math.max(40,Math.abs(b.x-a.x)*.2)}:{x:(a.x+b.x)/2,y:(a.y+b.y)/2});
 const points=route==='polyline'?[a,...(connector.waypoints||[]),b]:route==='elbow'?[a,{x:control.x,y:a.y},{x:control.x,y:b.y},b]:[a,b],bounds=route==='curve'?[a,b,control]:points,pad=Math.max(4,connector.stroke.width*3),x=Math.min(...bounds.map(p=>p.x))-pad,y=Math.min(...bounds.map(p=>p.y))-pad;
 const geometry={x,y,width:Math.max(1,Math.max(...bounds.map(p=>p.x))-x-pad)+2*pad,height:Math.max(1,Math.max(...bounds.map(p=>p.y))-y-pad)+2*pad};
 const n=v=>Number(v.toFixed(7)),pair=p=>`${n(p.x-x)} ${n(p.y-y)}`;
 const path=route==='curve'?`M ${pair(a)} Q ${pair(control)} ${pair(b)}`:points.map((p,i)=>`${i?'L':'M'} ${pair(p)}`).join(' ');
 return{from:a,to:b,geometry,points,path,control};
}
export function validateBusinessReferences(document){
 const variables=new Map((document.variables||[]).map(v=>[v.id,v]));
 for(const slide of document.slides){
  const ids=new Set(slide.elements.map(e=>e.id));
  if(slide.readingOrder!==undefined&&(slide.readingOrder.length!==ids.size||new Set(slide.readingOrder).size!==ids.size||slide.readingOrder.some(id=>!ids.has(id))))throw new Error('readingOrder: 모든 개체를 한 번씩 포함해야 합니다.');
  if(slide.template){if(new Set(slide.template.slots.map(s=>s.elementId)).size!==slide.template.slots.length||slide.template.slots.some(s=>!ids.has(s.elementId)))throw new Error('template.slots: 같은 장의 중복 없는 개체 참조가 필요합니다.');}
  for(const element of slide.elements){
   validateBusinessElement(element);
   if(element.connector){for(const endpoint of [element.connector.from,element.connector.to])if(endpoint.elementId&&(!ids.has(endpoint.elementId)||endpoint.elementId===element.id))throw new Error('connector: 같은 장의 유효한 endpoint가 필요합니다.');element.geometry=resolveConnectorGeometry(element,slide).geometry;}
   const variants=element.chart?.variants;if(variants){const variable=variables.get(variants.variableId),choices=variants.values.map(v=>v.value),series=element.chart.series;if(!variable||variable.kind==='number'||new Set(choices).size!==choices.length||choices.length!==variable.options.length||variable.options.some(o=>!choices.includes(o.value)))throw new Error('chart.variants: 모든 변수 선택 값의 표가 필요합니다.');
    for(const row of variants.values)if(row.series.length!==series.length||new Set(row.series.map(s=>s.seriesId)).size!==series.length||row.series.some(s=>!series.some(base=>base.id===s.seriesId)||s.values.length!==element.chart.categories.length))throw new Error('chart.variants: 원래 series/category와 같은 표가 필요합니다.');
   }
  }
 }
}
export function cleanBusinessReferences(document){
 const variableIds=new Set((document.variables||[]).map(v=>v.id));
 for(const slide of document.slides){let ids=new Set(slide.elements.filter(e=>e.type!=='connector').map(e=>e.id));slide.elements=slide.elements.filter(e=>!e.connector||[e.connector.from,e.connector.to].every(endpoint=>endpoint.point||ids.has(endpoint.elementId)));ids=new Set(slide.elements.map(e=>e.id));
  if(slide.readingOrder)slide.readingOrder=[...slide.readingOrder.filter(id=>ids.has(id)),...slide.elements.filter(e=>!slide.readingOrder.includes(e.id)).map(e=>e.id)];
  if(slide.template)slide.template.slots=slide.template.slots.filter(s=>ids.has(s.elementId));
  for(const e of slide.elements)if(e.chart?.variants&&!variableIds.has(e.chart.variants.variableId))delete e.chart.variants;
 }
}
export function diagnoseDocument(document,{availableFonts}={}){
 const issues=[],fonts=availableFonts?new Set(availableFonts.map(f=>f.toLowerCase())):null;
 const issue=(code,severity,slideId,elementId,message,details={})=>issues.push({code,severity,slideId,elementId,message,...details});
 for(const slide of document.slides){
  for(const e of slide.elements){const g=e.geometry;if(g.x<0||g.y<0||g.x+g.width>document.canvas.width||g.y+g.height>document.canvas.height)issue('OUTSIDE_CANVAS','warning',slide.id,e.id,'개체가 자료 영역 밖에 있습니다.');
   if(e.type==='image'&&!e.alt.trim())issue('MISSING_ALT','warning',slide.id,e.id,'이미지의 대체 텍스트가 비어 있습니다.');
   if(e.text&&e.text.textStyle.fontSize<14)issue('SMALL_TEXT','warning',slide.id,e.id,'작은 글자는 발표 화면에서 읽기 어려울 수 있습니다.');
   const font=e.themeRefs?.fontFamily?(e.semanticRole==='heading'?document.theme?.headingFontFamily||document.theme?.fontFamily:document.theme?.fontFamily):e.text?.textStyle.fontFamily;if(font&&fonts&&!font.split(',').some(name=>fonts.has(name.trim().toLowerCase())))issue('MISSING_FONT','warning',slide.id,e.id,'이 PC의 설치 목록에 없는 글꼴입니다.',{fontFamily:font});
   if(e.text&&!e.style?.gradient&&(e.style?.opacity??1)===1&&e.semanticRole!=='decorative'){
    const fg=e.themeRefs?.textColor?document.theme?.colors[e.themeRefs.textColor]:e.text.textStyle.color;
    const bg=e.type==='shape'?(e.themeRefs?.fill?document.theme?.colors[e.themeRefs.fill]:e.fill):slide.background;
    const rgb=value=>{let hex=value.slice(1);if(hex.length<=4)hex=[...hex].map(c=>c+c).join('');return[parseInt(hex.slice(0,2),16)/255,parseInt(hex.slice(2,4),16)/255,parseInt(hex.slice(4,6),16)/255,hex.length===8?parseInt(hex.slice(6),16)/255:1];};
    const blend=(a,b)=>a.slice(0,3).map((v,i)=>v*a[3]+b[i]*(1-a[3]));
    const background=blend(rgb(bg),blend(rgb(slide.background),[1,1,1])),foreground=blend(rgb(fg),background);
    const luminance=values=>values.map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0),a=luminance(foreground),b=luminance(background),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05),minimum=e.text.textStyle.fontSize>=24||e.text.textStyle.bold&&e.text.textStyle.fontSize>=18.67?3:4.5;
    if(ratio<minimum)issue('LOW_CONTRAST','warning',slide.id,e.id,'단색 기준 글자와 배경의 대비가 낮습니다.',{contrastRatio:Math.round(ratio*100)/100,minimum,foreground:fg,background:bg});
   }
   if(e.chart){if(e.chart.categories.some(label=>label.length>24))issue('CHART_LONG_LABEL','warning',slide.id,e.id,'긴 차트 이름이 잘릴 수 있습니다.');if(e.chart.series.every(s=>s.values.every(v=>v===null)))issue('CHART_EMPTY','warning',slide.id,e.id,'차트에 표시할 숫자가 없습니다.');}
   if(e.binding?.formula){const fallbackValues=e.binding.values.filter(row=>!formulaValue(e.binding,row.text).valid).map(row=>row.value);if(fallbackValues.length)issue(e.binding.formula.operation==='divide'&&e.binding.formula.operand===0?'FORMULA_DIVIDE_ZERO':'FORMULA_FALLBACK','warning',slide.id,e.id,'계산할 수 없는 선택 값에는 지정한 대체 문구를 표시합니다.',{values:fallbackValues});}
   if(e.semanticRole==='decorative'&&e.text?.paragraphs.some(Boolean))issue('DECORATIVE_TEXT','info',slide.id,e.id,'장식으로 지정한 텍스트는 보조기기 읽기에서 제외됩니다.');
  }
 }
 return issues;
}
