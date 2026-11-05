/** Safe JSON-to-business-snapshot mapping; the Controller remains the author-data validator. */
import{DataError,DATA_LIMITS,clone,exact}from'./data-common.mjs';
const unsafeKey=key=>['__proto__','prototype','constructor'].includes(key);
const privateKey=key=>/(?:authorization|password|passwd|secret|credential|(?:^|[_-])(?:token|api[_-]?key|service[_-]?key|access[_-]?key)(?:$|[_-]))/i.test(key)||/^(?:accessToken|refreshToken)$/i.test(key);
function field(value,label='필드'){
 if(typeof value!=='string'||!value||value.length>256||unsafeKey(value)||privateKey(value))throw new DataError('INVALID_MAPPING',label+' 이름을 확인하세요. 인증 필드는 가져올 수 없습니다.');
 return value;
}
function text(value,max,label){
 if(typeof value!=='string'||!value.trim()||value.length>max)throw new DataError('INVALID_MAPPING',label+'을 확인하세요.');
 return value;
}
export function normalizeRowsPath(value=[]){
 if(!Array.isArray(value)||value.length>DATA_LIMITS.pathDepth)throw new DataError('INVALID_MAPPING','배열 경로는 최대 8개의 키로 지정하세요.');
 return value.map(key=>field(key,'경로'));
}
export function normalizeMapping(input){
 exact(input,['type','rowsPath','rowRange','labelField','series','gapPolicy','columns','includeHeader']);
 const type=input.type;if(!['chart','table'].includes(type))throw new DataError('INVALID_MAPPING','차트 또는 표 매핑을 선택하세요.');
 const rowsPath=normalizeRowsPath(input.rowsPath);exact(input.rowRange,['start','count'],'가져올 행 범위를 지정하세요.');
 const {start,count}=input.rowRange;if(!Number.isSafeInteger(start)||start<0||!Number.isSafeInteger(count)||count<1||count>DATA_LIMITS.chartRows)throw new DataError('INVALID_MAPPING','0부터 시작하는 첫 행과 1–128개의 행 수를 지정하세요.');
 if(type==='chart'){
  if(input.columns!==undefined||input.includeHeader!==undefined)throw new DataError('INVALID_MAPPING','차트 매핑에는 차트 필드만 사용하세요.');
  if(!Array.isArray(input.series)||!input.series.length||input.series.length>DATA_LIMITS.chartSeries)throw new DataError('INVALID_MAPPING','차트 수치 필드는 1–12개를 선택하세요.');
  const series=input.series.map(item=>{exact(item,['field','name']);return{field:field(item.field),...(item.name!==undefined?{name:text(item.name,256,'계열 이름')}:{})};});
  if(new Set(series.map(item=>item.field)).size!==series.length)throw new DataError('INVALID_MAPPING','중복 없는 수치 필드를 선택하세요.');
  const gapPolicy=input.gapPolicy??'reject';if(!['reject','null'].includes(gapPolicy))throw new DataError('INVALID_MAPPING','누락된 수치의 처리 방법을 선택하세요.');
  return{type,rowsPath,rowRange:{start,count},labelField:field(input.labelField),series,gapPolicy};
 }
 if(input.labelField!==undefined||input.series!==undefined)throw new DataError('INVALID_MAPPING','표 매핑에는 표 열만 사용하세요.');
 if(!Array.isArray(input.columns)||!input.columns.length||input.columns.length>DATA_LIMITS.tableColumns)throw new DataError('INVALID_MAPPING','표 열은 1–30개를 선택하세요.');
 const columns=input.columns.map(item=>{exact(item,['field','label']);return{field:field(item.field),...(item.label!==undefined?{label:text(item.label,256,'열 이름')}:{})};});
 if(new Set(columns.map(item=>item.field)).size!==columns.length)throw new DataError('INVALID_MAPPING','중복 없는 표 열을 선택하세요.');
 const includeHeader=input.includeHeader??true;if(typeof includeHeader!=='boolean')throw new DataError('INVALID_MAPPING','머리글 포함 여부를 선택하세요.');
 if(count+(includeHeader?1:0)>DATA_LIMITS.tableRows||(count+(includeHeader?1:0))*columns.length>DATA_LIMITS.tableCells)throw new DataError('INVALID_MAPPING','표는 머리글 포함 100행, 30열, 2000칸 이내로 범위를 줄이세요.');
 const gapPolicy=input.gapPolicy??'reject';if(!['reject','empty'].includes(gapPolicy))throw new DataError('INVALID_MAPPING','누락된 표 값의 처리 방법을 선택하세요.');
 return{type,rowsPath,rowRange:{start,count},columns,includeHeader,gapPolicy};
}
export function rowsAt(data,path){
 let value=data;for(const key of normalizeRowsPath(path)){if(!value||typeof value!=='object'||Array.isArray(value)&&(!/^(?:0|[1-9]\d*)$/.test(key)||!Number.isSafeInteger(Number(key)))||!Object.hasOwn(value,key))throw new DataError('PATH_NOT_FOUND','선택한 JSON 배열 경로를 찾을 수 없습니다.');value=value[key];}
 if(!Array.isArray(value))throw new DataError('EXPECTED_ARRAY','선택한 경로는 JSON 행 배열이어야 합니다.');
 return value;
}
function cellValue(row,key){
 if(!row||typeof row!=='object'||Array.isArray(row))throw new DataError('INVALID_ROW','각 행은 필드가 있는 JSON 객체여야 합니다.');
 return Object.hasOwn(row,key)?row[key]:undefined;
}
function scalar(value,label,max=65536){
 if(!['string','number','boolean'].includes(typeof value)||typeof value==='number'&&!Number.isFinite(value))throw new DataError('INVALID_VALUE',label+'에는 문자열·유한 수·참/거짓 값이 필요합니다.');
 const output=String(value);if(output.length>max)throw new DataError('VALUE_LIMIT',label+'이 표시 길이를 초과했습니다.');return output;
}
export function buildSnapshotCommands(element,input,data){
 const mapping=normalizeMapping(input);if(!element||element.type!==mapping.type)throw new DataError('TARGET_TYPE_MISMATCH','선택한 차트 또는 표에 맞는 매핑을 사용하세요.');
 const all=rowsAt(data,mapping.rowsPath),{start,count}=mapping.rowRange;if(start+count>all.length)throw new DataError('ROW_RANGE','선택한 행 범위가 응답 행 수를 벗어났습니다. 범위를 다시 확인하세요.');
 const rows=all.slice(start,start+count);let snapshot,summary;
 if(mapping.type==='chart'){
  if(element.chart.variants)throw new DataError('VARIANT_CHART_UNSUPPORTED','선택 값별 데이터를 가진 차트입니다. 일반 차트를 선택하거나 기존 선택 데이터 설정을 먼저 정리하세요.');
  const categories=rows.map(row=>scalar(cellValue(row,mapping.labelField),'분류',256));
  const palette=['#2563eb','#16a34a','#f97316','#9333ea','#0891b2','#e11d48','#ca8a04','#4f46e5','#0d9488','#db2777','#64748b','#65a30d'];
  const series=mapping.series.map((item,index)=>{const previous=element.chart.series[index];return{id:previous?.id||element.id+'-data-series-'+(index+1),name:item.name||previous?.name||item.field,color:previous?.color||palette[index],values:rows.map(row=>{const value=cellValue(row,item.field);if(value===undefined||value===null){if(mapping.gapPolicy==='null')return null;throw new DataError('MISSING_VALUE','선택한 수치 필드에 누락된 값이 있습니다. 빈 점으로 표시하거나 데이터를 정리하세요.');}if(typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>1e15)throw new DataError('INVALID_NUMBER','차트 수치는 ±10¹⁵ 이내의 유한 JSON 숫자여야 합니다. 숫자 문자열은 자동 변환하지 않습니다.');return value;})};});
  snapshot={...clone(element.chart),categories,series};summary={rowCount:count,seriesCount:series.length};
 }else{
  const matrix=[...(mapping.includeHeader?[mapping.columns.map(item=>item.label||item.field)]:[]),...rows.map(row=>mapping.columns.map(item=>{const value=cellValue(row,item.field);if(value===undefined||value===null){if(mapping.gapPolicy==='empty')return'';throw new DataError('MISSING_VALUE','표 필드에 누락된 값이 있습니다. 빈 칸 처리를 선택하거나 데이터를 정리하세요.');}return scalar(value,'표 값');}))];
  const previous=element.table,sameWidth=previous.columnWidths.length===mapping.columns.length;
  snapshot={...clone(previous),rows:matrix.map((row,r)=>row.map((value,c)=>({...clone(previous.rows[r]?.[c]||{}),text:value}))),columnWidths:sameWidth?[...previous.columnWidths]:mapping.columns.map(()=>1),headerRows:mapping.includeHeader?1:0};summary={rowCount:count,columnCount:mapping.columns.length,includesHeader:mapping.includeHeader};
 }
 return{mapping,snapshot,summary,commands:[{id:mapping.type+'.set_data',params:{elementId:element.id,[mapping.type]:snapshot}}]};
}
export function projectSample(data,{rowsPath,secret=''}={}){
 const paths=[];let visits=0;
 function find(value,path,depth){if(++visits>1000||paths.length>=32||depth>4)return;if(Array.isArray(value)){if(value.length===0||value.slice(0,10).every(row=>row&&typeof row==='object'&&!Array.isArray(row))){paths.push(path);return;}for(let i=0;i<Math.min(value.length,100);i++)find(value[i],[...path,String(i)],depth+1);return;}if(value&&typeof value==='object')for(const key of Object.keys(value).slice(0,100)){if(!unsafeKey(key)&&!privateKey(key)&&key.length<=256)find(value[key],[...path,key],depth+1);}}
 find(data,[],0);const selected=rowsPath===undefined?paths[0]:normalizeRowsPath(rowsPath),rootKeys=data&&typeof data==='object'&&!Array.isArray(data)?Object.keys(data).filter(key=>!privateKey(key)&&!unsafeKey(key)).slice(0,30):[];
 if(selected===undefined)return{rootKeys,arrayPaths:paths,fields:[],rows:[],totalRows:0,truncated:false};
 const all=rowsAt(data,selected),first=all.slice(0,DATA_LIMITS.sampleRows),fields=[...new Set(first.flatMap(row=>row&&typeof row==='object'&&!Array.isArray(row)?Object.keys(row):[]))].filter(key=>!privateKey(key)&&!unsafeKey(key)&&key.length<=256).slice(0,DATA_LIMITS.sampleColumns);
 const clean=value=>{if(value===null||typeof value==='boolean')return value;if(typeof value==='number')return Number.isFinite(value)?value:'[유효하지 않은 수]';if(typeof value==='string')return(secret?value.replaceAll(secret,'[보호된 인증 정보]'):value).slice(0,256);return value===undefined?'':'[중첩 데이터]';};
 const rows=first.map(row=>Object.fromEntries(fields.map(key=>[key,clean(cellValue(row,key))])));
 return{rootKeys,arrayPaths:paths,rowsPath:selected,fields,rows,totalRows:all.length,truncated:all.length>first.length};
}
