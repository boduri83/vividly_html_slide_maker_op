/** Renderer-side current-grant authority. No transport, file path, DOM, or credentials in receipts. */
import{cloneProjection}from'./read-projection.js';
export const operationFailure=(code,message,extra={})=>({ok:false,error:{code,message,mutated:false,...extra}});
export function canonicalOperation(value){let nodes=0;const ancestors=new Set();function encode(v,depth){if(++nodes>10000||depth>24)throw Error('작업 JSON 구조가 너무 큽니다.');if(v===null||typeof v==='string'||typeof v==='boolean')return JSON.stringify(v);if(typeof v==='number'&&Number.isFinite(v))return JSON.stringify(v);if(!v||typeof v!=='object'||ancestors.has(v)||!Array.isArray(v)&&![Object.prototype,null].includes(Object.getPrototypeOf(v)))throw Error('유한 수의 순환 없는 JSON이 필요합니다.');const keys=Reflect.ownKeys(v),array=Array.isArray(v),fields=array?Array.from({length:v.length},(_,i)=>String(i)):keys.sort();if(array&&(v.length>10000||keys.length!==v.length+1))throw Error('밀집 JSON 배열이 필요합니다.');ancestors.add(v);try{return(array?'[':'{')+fields.map(k=>{const d=Object.getOwnPropertyDescriptor(v,k);if(typeof k!=='string'||!d?.enumerable||!Object.hasOwn(d,'value'))throw Error('JSON 데이터 필드가 필요합니다.');return(array?'':JSON.stringify(k)+':')+encode(d.value,depth+1);}).join(',')+(array?']':'}');}finally{ancestors.delete(v);}}const text=encode(value,0);if(new TextEncoder().encode(text).byteLength>256*1024)throw Error('작업 JSON은 256KiB 이하여야 합니다.');return text;}
async function digest(text){const hash=await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');}
// Commit results contain ID summaries, never document/asset payloads. Preserve
// a terminal receipt even when a large deletion produces more than 1MiB of IDs.
function retainedResult(result){
  try{return cloneProjection(result);}catch(error){
    if(error.code!=='READ_TOO_LARGE'||!result.ok||!result.value?.summary)throw error;
    const summary={},counts={};
    for(const[key,value]of Object.entries(result.value.summary)){
      if(Array.isArray(value)){counts[key]=value.length;summary[key]=value.slice(0,10);}
      else summary[key]=value;
    }
    summary.resultTruncated=true;summary.originalCounts=counts;
    summary.resultTruncationReason='결과 ID 목록이 커서 앞의 10개만 보관했습니다. 확정 상태와 이력 ID는 유지됩니다.';
    return cloneProjection({...result,value:{...result.value,summary}});
  }
}
export class OperationLedger{
  constructor({limit=1000}={}){this.limit=limit;this.scope=null;this.records=new Map();this.sequence=0;}
  setScope(scope){if(scope&&this.scope?.grantId===scope.grantId&&this.scope?.editorSessionId===scope.editorSessionId)return;for(const r of this.records.values())r.abort.abort();this.records.clear();this.scope=scope?{...scope}:null;}
  authorized(scope){return Boolean(this.scope&&scope?.grantId===this.scope.grantId&&scope?.editorSessionId===this.scope.editorSessionId);}
  async begin({operationId,method,request,trustedFingerprint=''},scope){if(!this.authorized(scope))return{error:operationFailure('PERMISSION_DENIED','현재 문서의 연결 권한이 필요합니다.')};let encoded;try{encoded=canonicalOperation({method,request});}catch(error){return{error:operationFailure('INVALID_REQUEST',error.message)};}const previous=this.records.get(operationId),fingerprint=digest(encoded+'\n'+trustedFingerprint);if(previous){if(await previous.fingerprint!==await fingerprint)return{error:operationFailure('OPERATION_CONFLICT','같은 작업 ID를 다른 내용으로 재사용할 수 없습니다.')};if(!this.authorized(scope))return{error:operationFailure('PERMISSION_DENIED','연결 권한이 바뀌었습니다.')};return{record:previous,replayed:true};}if(this.records.size>=this.limit)return{error:operationFailure('RECEIPT_LIMIT','현재 연결의 영수증 한도에 도달했습니다. 결과를 보관한 뒤 다시 허용하세요.')};let resolve;const record={operationId,method,expectedRevision:request.expectedRevision,sequence:++this.sequence,state:'pending',cancelRequested:false,fingerprint,abort:new AbortController(),promise:new Promise(r=>resolve=r),resolve,scope:{...scope},result:null};this.records.set(operationId,record);await fingerprint;if(!this.authorized(scope))return{record,error:operationFailure('PERMISSION_DENIED','작업을 준비하는 동안 문서 연결이 바뀌었습니다.')};return{record,replayed:false};}
  complete(record,result){record.result=retainedResult(result);record.state=result.ok?'committed':result.error?.outcomeUnknown?'outcome-unknown':result.error?.code==='CANCELLED_BEFORE_COMMIT'?'cancelled-before-commit':'rejected';record.resolve(record.result);return record.result;}
  cancel(operationId,scope){if(!this.authorized(scope))return operationFailure('PERMISSION_DENIED','현재 문서 연결이 필요합니다.');const record=this.records.get(operationId);if(!record)return{ok:true,value:{operationId,state:'unknown',scope:'current-grant',cancelRequested:false}};if(record.state==='pending'){record.cancelRequested=true;record.abort.abort();}return{ok:true,value:this.receipt(record)};}
  receipt(record){return{operationId:record.operationId,method:record.method,state:record.state,scope:'current-grant',editorSessionId:record.scope.editorSessionId,expectedRevision:record.expectedRevision,sequence:record.sequence,cancelRequested:record.cancelRequested,...(record.result?{result:cloneProjection(record.result)}:{})};}
  lookup(operationId,scope){if(!this.authorized(scope))return operationFailure('PERMISSION_DENIED','현재 문서 연결이 필요합니다.');const record=this.records.get(operationId);return{ok:true,value:record?this.receipt(record):{operationId,state:'unknown',scope:'current-grant'}};}
}
