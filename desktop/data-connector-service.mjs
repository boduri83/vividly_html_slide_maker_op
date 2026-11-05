/** Human-configured read import/refresh. No model-provider tools, API writes or live exported viewer. */
import{randomUUID}from'node:crypto';
import{DataError,DATA_LIMITS,clone,exact,identifier,normalizeDataUrl,normalizeAuth,normalizeKey,containsSecret,redact,resultError}from'./data-common.mjs';
import{buildSnapshotCommands,projectSample,normalizeRowsPath}from'./data-mapping.mjs';
const ok=value=>({ok:true,value});
const canonical=value=>JSON.stringify(Array.isArray(value)?value.map(item=>JSON.parse(canonical(item))):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,JSON.parse(canonical(value[key]))])):value);
export function createJsonFetcher({fetchImpl=globalThis.fetch,deadlineMs=DATA_LIMITS.deadlineMs,responseBytes=DATA_LIMITS.responseBytes}={}){
 if(typeof fetchImpl!=='function')throw TypeError('fetch dependency required');
 return async function fetchJson(connection,signal){
  const endpoint=normalizeDataUrl(connection.url),auth=normalizeAuth(connection.authType,connection.headerName,connection.keyName),apiKey=normalizeKey(connection.apiKey||'');
  if(auth.authType!=='none'&&!apiKey)throw new DataError('NOT_CONFIGURED','데이터 API 키를 입력하세요.');
  const url=new URL(endpoint),headers={Accept:'application/json'};
  if(auth.authType==='bearer')headers.Authorization='Bearer '+apiKey;
  if(auth.authType==='header')headers[auth.headerName]=apiKey;
  if(auth.authType==='query')url.searchParams.set(auth.keyName,apiKey);
  const controller=new AbortController(),abort=()=>controller.abort(),timer=setTimeout(()=>controller.abort(),Math.max(1,Math.min(DATA_LIMITS.deadlineMs,deadlineMs)));let reader;
  if(signal?.aborted)controller.abort();else signal?.addEventListener('abort',abort,{once:true});
  try{
   const response=await fetchImpl(url.href,{method:'GET',headers,redirect:'error',signal:controller.signal});
   if(!response.ok)throw new DataError('DATA_HTTP','데이터 요청을 완료하지 못했습니다. HTTP '+response.status);
   if(!/^(?:application\/(?:[a-z0-9_.-]+\+)?json|text\/json)(?:\s*;|$)/i.test(response.headers.get('content-type')||''))throw new DataError('DATA_FORMAT','JSON 응답을 제공하는 API 주소인지 확인하세요.');
   const declared=Number(response.headers.get('content-length'));if(Number.isFinite(declared)&&declared>Math.min(responseBytes,DATA_LIMITS.responseBytes))throw new DataError('RESPONSE_LIMIT','JSON 응답이 2MB 한도를 넘었습니다.');
   if(!response.body?.getReader)throw new DataError('DATA_FORMAT','JSON 응답 본문이 없습니다.');reader=response.body.getReader();const chunks=[];let size=0;
   for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>Math.min(responseBytes,DATA_LIMITS.responseBytes))throw new DataError('RESPONSE_LIMIT','JSON 응답이 허용 크기를 넘었습니다.');chunks.push(Buffer.from(part.value));}
   let data;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new DataError('DATA_FORMAT','API가 유효한 JSON을 반환하지 않았습니다.');}
   return data;
  }catch(error){if(signal?.aborted)throw new DataError('CANCELLED','데이터 요청을 중단했습니다.');if(controller.signal.aborted)throw new DataError('DATA_TIMEOUT','데이터 응답 시간이 초과됐습니다.');if(error instanceof DataError)throw error;throw new DataError('DATA_NETWORK','데이터 API에 연결하지 못했습니다. 주소와 네트워크를 확인하세요.');}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);try{await reader?.cancel();}catch{}}
 };
}
export class DataConnectorService{
 constructor({dispatch,getSessionId,registry,fetchImpl,fetchJson,onEvent=()=>{},deadlineMs,responseBytes}={}){
  if(typeof dispatch!=='function'||typeof getSessionId!=='function'||!registry?.getConnection||!registry?.bind)throw TypeError('Data service dependencies required');
  this.dispatch=dispatch;this.getSessionId=getSessionId;this.registry=registry;this.fetchJson=fetchJson||createJsonFetcher({fetchImpl,deadlineMs,responseBytes});this.onEvent=onEvent;this.run=null;this.proposal=null;this.receipts=new Map();this.lastReceipt=null;this.state='idle';
 }
 emit(type,data={},run=this.run){const event=redact({eventId:randomUUID(),...(run?{runId:run.id}:{}),type,...clone(data)},run?.secret);try{this.onEvent(event);}catch{}}
 status(state,message,run=this.run){this.state=state;this.emit('status',{state,...(message?{message}:{})},run);}
 publicProposal(p=this.proposal){if(!p)return undefined;return redact({proposalId:p.id,runId:p.run.id,sourceId:p.source.id,sourceName:p.source.name,documentId:p.bound.documentId,editorSessionId:p.bound.editorSessionId,baseRevision:p.bound.revision,elementId:p.element.id,targetName:p.element.name||'데이터 개체',mapping:clone(p.mapping),summary:clone(p.summary),changes:clone(p.dry.summary),...(p.dry.preview?{preview:clone(p.dry.preview)}:{}),fetchedAt:p.fetchedAt,stale:Boolean(p.stale)},p.run.secret);}
 publicReceipt(record,replayed=false){return{receiptId:record.id,proposalId:record.proposal.id,sourceId:record.proposal.source.id,elementId:record.proposal.element.id,documentId:record.request.target.documentId,editorSessionId:record.request.target.editorSessionId,operationId:record.request.operationId,contentRevision:record.result.value.contentRevision,undoEntryId:record.result.value.undoEntryId,summary:clone(record.proposal.summary),bindingSaved:record.bindingSaved===true,...(record.bindingWarning?{bindingWarning:record.bindingWarning}:{}),replayed,undone:Boolean(record.undone),...(record.unknownUndo?{undoOutcomeUnknown:true}:{})};}
 hasUnknownOutcome(){const sessionId=this.getSessionId();return[...this.receipts.values()].some(record=>record.request.target.editorSessionId===sessionId&&(record.unknown===true||record.unknownUndo===true));}
 statusValue(){return{state:this.state,...(this.hasUnknownOutcome()?{outcomeUnknown:true}:{}),...(this.run?{runId:this.run.id}:{}),...(this.proposal?{proposal:this.publicProposal()}:{}),...(this.lastReceipt?.result?.ok&&this.lastReceipt.request.target.editorSessionId===this.getSessionId()?{lastReceipt:this.publicReceipt(this.lastReceipt)}:{})};}
 async read(method,params={}){const result=await this.dispatch(method,params);if(!result?.ok)throw Object.assign(new DataError(result?.error?.code||'EDITOR_UNAVAILABLE',result?.error?.message||'편집기 상태를 읽지 못했습니다.'),result?.error);return result.value;}
 active(run){if(run!==this.run||run.cancelled||run.abort.signal.aborted)throw new DataError('CANCELLED','데이터 요청을 중단했습니다.');if(run.bound&&run.bound.editorSessionId!==this.getSessionId()){this.proposal&&(this.proposal.stale=true);throw new DataError('STALE_EDITOR_SESSION','문서가 바뀌었습니다. 현재 자료에서 다시 가져오세요.');}}
 cancelCurrent(){if(this.run){this.run.cancelled=true;this.run.abort.abort();this.status(this.run.inFlight||this.hasUnknownOutcome()?'outcomeUnknown':'cancelled',this.run.inFlight||this.hasUnknownOutcome()?'이미 전달된 편집 결과를 확인하고 있습니다.':'데이터 요청을 중단했습니다.');}this.proposal=null;}
 begin(){this.cancelCurrent();const run={id:randomUUID(),abort:new AbortController(),cancelled:false,inFlight:false,secret:''};this.run=run;return run;}
 async capture(run,elementId){
  const read=await this.read('readCommittedSnapshot'),editor=await this.read('readEditorState');this.active(run);
  if(read.editorSessionId!==editor.editorSessionId||read.contentRevision!==editor.contentRevision||read.editorSessionId!==this.getSessionId())throw new DataError('REVISION_CONFLICT','문서가 바뀌었습니다. 다시 가져오세요.');
  if(editor.state.busy.active)throw new DataError('EDITOR_BUSY','사람의 편집을 마친 뒤 데이터를 가져오세요.');
  const element=read.document.slides.flatMap(slide=>slide.elements).find(item=>item.id===elementId);if(!element||!['chart','table'].includes(element.type))throw new DataError('TARGET_TYPE_MISMATCH','기존 차트 또는 표를 선택하세요.');
  run.bound={instanceId:read.instanceId,documentId:read.documentId,editorSessionId:read.editorSessionId,revision:read.contentRevision};return{read,element:clone(element)};
 }
 async check(run){
  this.active(run);const read=await this.read('readCommittedSnapshot'),editor=await this.read('readEditorState');this.active(run);const b=run.bound;
  if(read.editorSessionId!==b.editorSessionId||read.documentId!==b.documentId||read.contentRevision!==b.revision||editor.contentRevision!==read.contentRevision){if(this.proposal)this.proposal.stale=true;throw new DataError('REVISION_CONFLICT','데이터 요청 뒤 자료가 바뀌었습니다. 다시 미리보기하세요.');}
  if(editor.state.busy.active)throw new DataError('EDITOR_BUSY','사람이 편집 중입니다. 입력을 마친 뒤 다시 시도하세요.');
  const source=await this.registry.get(run.source.id);this.active(run);if(source.revision!==run.source.revision)throw new DataError('SOURCE_CHANGED','연결 설정이 바뀌었습니다. 다시 가져오세요.');
 }
 async listSources(){try{const read=await this.read('readCommittedSnapshot');return ok(await this.registry.list({documentId:read.documentId}));}catch(error){return resultError(error);}}
 async configureSource(input){try{if(this.run&&(!input?.sourceId||input.sourceId===this.run.source?.id))this.cancelCurrent();return ok(await this.registry.configure(input));}catch(error){return resultError(error);}}
 async removeSource(input){try{exact(input,['sourceId']);if(input.sourceId===this.run?.source?.id)this.cancelCurrent();return ok(await this.registry.remove(identifier(input.sourceId)));}catch(error){return resultError(error);}}
 async unlink(input){try{exact(input,['elementId']);const read=await this.read('readCommittedSnapshot');return ok(await this.registry.unbind(read.documentId,identifier(input.elementId)));}catch(error){return resultError(error);}}
 async cancel(input={}){try{exact(input,['runId']);if(input.runId&&input.runId!==this.run?.id)throw new DataError('STALE_RUN','이미 끝난 데이터 요청입니다.');this.cancelCurrent();return ok(this.statusValue());}catch(error){return resultError(error);}}
 async sourceFor(run,sourceId){const source=await this.registry.getConnection(identifier(sourceId,'연결 ID'));this.active(run);run.secret=source.apiKey;run.source=source;return source;}
 async readSample(input){
  let run;try{exact(input,['sourceId','rowsPath']);run=this.begin();const source=await this.sourceFor(run,input.sourceId);if(input.rowsPath!==undefined)normalizeRowsPath(input.rowsPath);this.status('fetching','JSON 데이터의 첫 10행을 읽고 있습니다.',run);const data=await this.fetchJson(source,run.abort.signal);this.active(run);const current=await this.registry.get(source.id);if(current.revision!==source.revision)throw new DataError('SOURCE_CHANGED','연결 설정이 바뀌었습니다. 다시 읽으세요.');
   const sample=redact(projectSample(data,{rowsPath:input.rowsPath,secret:run.secret}),run.secret);this.status('done','샘플을 읽었습니다. 가져올 필드와 행 범위를 선택하세요.',run);return ok({runId:run.id,sourceId:source.id,...sample});
  }catch(error){if(run===this.run&&!run?.cancelled)this.status(error.code==='EDITOR_BUSY'?'waiting':'error',error.message,run);return redact(resultError(error),run?.secret);}
 }
 async prepare(input){return this.prepareInternal(input,false);}
 async refresh(input){return this.prepareInternal(input,true);}
 async prepareInternal(input,refresh){
  let run;try{exact(input,refresh?['sourceId','elementId']:['sourceId','elementId','mapping']);run=this.begin();const elementId=identifier(input.elementId,'대상 개체 ID'),captured=await this.capture(run,elementId);let sourceId=input.sourceId,mapping=input.mapping;
   if(refresh){const binding=await this.registry.getBinding(captured.read.documentId,elementId);if(!binding||sourceId&&sourceId!==binding.sourceId)throw new DataError('BINDING_NOT_FOUND','이 차트·표의 저장된 연결을 찾을 수 없습니다. 먼저 데이터를 가져와 적용하세요.');sourceId=binding.sourceId;mapping=binding.mapping;}
   const source=await this.sourceFor(run,sourceId);this.status('fetching','선택한 차트·표의 데이터를 가져오고 있습니다.',run);const data=await this.fetchJson(source,run.abort.signal);this.active(run);await this.check(run);
   const candidate=buildSnapshotCommands(captured.element,mapping,data);if(containsSecret(candidate.commands,run.secret)||containsSecret(candidate.mapping,run.secret))throw new DataError('SECRET_DATA','인증 키가 포함된 데이터는 자료에 저장하지 않습니다. 응답 필드를 확인하세요.');
   const request={target:{instanceId:run.bound.instanceId,editorSessionId:run.bound.editorSessionId,documentId:run.bound.documentId},expectedRevision:run.bound.revision,targeting:'id',operationId:randomUUID(),commands:clone(candidate.commands),dryRun:false,label:refresh?'연결된 데이터 새로 고침':'외부 데이터 가져오기'};
   const dry=await this.dispatch('applyCommands',{...clone(request),operationId:randomUUID(),dryRun:true});this.active(run);if(!dry?.ok)throw Object.assign(new DataError(dry?.error?.code||'DRY_RUN_FAILED',dry?.error?.message||'데이터 변경을 미리보기하지 못했습니다.'),dry?.error);await this.check(run);
   const proposal={id:randomUUID(),run,source:clone(source),bound:clone(run.bound),element:captured.element,mapping:candidate.mapping,summary:candidate.summary,request,dry:clone(dry.value),fetchedAt:new Date().toISOString(),stale:false};delete proposal.source.apiKey;this.proposal=proposal;this.status('review',dry.value.wouldChange?'변경 내용을 확인하고 적용하세요.':'현재 자료와 같은 데이터입니다. 적용하면 연결 설정만 기억합니다.',run);this.emit('proposal',{proposal:this.publicProposal()},run);return ok({runId:run.id,state:this.state,proposal:this.publicProposal()});
  }catch(error){if(run===this.run&&!run?.cancelled)this.status(error.code==='EDITOR_BUSY'?'waiting':'error',error.message,run);return redact(resultError(error),run?.secret);}
 }
 async saveBinding(record){try{await this.registry.bind({sourceId:record.proposal.source.id,documentId:record.proposal.bound.documentId,elementId:record.proposal.element.id,mapping:record.proposal.mapping,lastRefreshAt:record.proposal.fetchedAt,expectedSourceRevision:record.proposal.source.revision});record.bindingSaved=true;}catch{record.bindingSaved=false;record.bindingWarning='데이터는 적용했지만 연결 기억에 실패했습니다. 다음 새로 고침 전에 연결을 다시 지정하세요.';}}
 async reconcile(record){const read=await this.read('readCommittedSnapshot'),history=await this.read('readHistory');if(read.editorSessionId!==record.request.target.editorSessionId||read.documentId!==record.request.target.documentId)return null;const entry=[...(history.history?.undo||[]),...(history.history?.redo||[])].find(item=>item.operationId===record.request.operationId&&item.source==='agent'&&canonical(item.commands)===canonical(record.request.commands));if(!entry)return null;return{ok:true,value:{changed:true,contentRevision:entry.contentRevision,undoEntryId:entry.entryId}};}
 async applyProposal(input){
  try{exact(input,['proposalId']);identifier(input.proposalId);let record=this.receipts.get(input.proposalId);if(record?.result?.ok){if(record.request.target.editorSessionId!==this.getSessionId())throw new DataError('STALE_EDITOR_SESSION','이전 문서의 데이터 적용 요청입니다.');return ok({receipt:this.publicReceipt(record,true)});}if(record?.pending)return record.pending;
   const proposal=this.proposal;if(!proposal||proposal.id!==input.proposalId||proposal.stale)throw new DataError('STALE_PROPOSAL','적용할 데이터 제안이 없거나 오래됐습니다.');const run=proposal.run;
   record=record||{id:randomUUID(),proposal,request:clone(proposal.request),unknown:false,result:null};this.receipts.set(proposal.id,record);if(this.receipts.size>100)this.receipts.delete(this.receipts.keys().next().value);
   const job=(async()=>{try{this.active(run);if(record.unknown){const reconciled=await this.reconcile(record);this.active(run);if(reconciled){record.result=reconciled;record.unknown=false;await this.saveBinding(record);this.lastReceipt=record;this.proposal=null;this.status('done','이전에 전달된 데이터 적용을 확인했습니다.');return ok({receipt:this.publicReceipt(record,true)});}}await this.check(run);this.active(run);run.inFlight=true;let result;
    try{result=await this.dispatch('applyCommands',clone(record.request));}catch{record.unknown=true;this.status('outcomeUnknown','데이터 적용 결과를 확인해야 합니다. 같은 제안으로 다시 확인하세요.');throw new DataError('OUTCOME_UNKNOWN','이미 전달된 데이터 편집의 결과가 아직 확인되지 않았습니다.',{outcomeUnknown:true});}
    if(!result||typeof result.ok!=='boolean'||result.error?.outcomeUnknown===true){record.unknown=true;this.status('outcomeUnknown','데이터 적용 결과를 확인해야 합니다.');throw new DataError('OUTCOME_UNKNOWN','이미 전달된 데이터 편집의 결과가 아직 확인되지 않았습니다.',{outcomeUnknown:true});}
    if(!result.ok){if(['REVISION_CONFLICT','STALE_EDITOR_SESSION','DOCUMENT_MISMATCH'].includes(result.error?.code))proposal.stale=true;this.status(run.cancelled&&result.error?.mutated===false?'cancelled':result.error?.code==='EDITOR_BUSY'?'waiting':'error',result.error?.message||'데이터를 반영하지 못했습니다.',run);return result;}
    record.result=clone(result);record.unknown=false;this.lastReceipt=record;await this.saveBinding(record);this.proposal=null;const receipt=this.publicReceipt(record);this.emit('receipt',{receipt},run);this.status(run.cancelled?'cancelled':'done',run.cancelled?'중단 전에 전달된 데이터는 적용됐습니다. 실행 취소할 수 있습니다.':'데이터를 적용했습니다. 한 번 실행 취소할 수 있습니다.',run);return ok({receipt});
   }catch(error){if(error.code==='EDITOR_BUSY')this.status('waiting',error.message,run);return redact(resultError(error),run.secret);}finally{run.inFlight=false;}})();record.pending=job;job.finally(()=>{if(record.pending===job)record.pending=null;});return job;
  }catch(error){return resultError(error);}
 }
 async getStatus(){try{if(this.run?.bound&&!this.run.cancelled&&this.run.bound.editorSessionId!==this.getSessionId())this.cancelCurrent();if(this.proposal){const current=await this.read('readCommittedSnapshot'),source=await this.registry.get(this.proposal.source.id);if(current.contentRevision!==this.proposal.bound.revision||current.documentId!==this.proposal.bound.documentId||source.revision!==this.proposal.source.revision)this.proposal.stale=true;}for(const record of this.receipts.values()){if(record.unknown&&!record.pending&&record.request.target.editorSessionId===this.getSessionId()){const reconciled=await this.reconcile(record);if(reconciled){record.result=reconciled;record.unknown=false;await this.saveBinding(record);this.lastReceipt=record;if(record.proposal.run===this.run){this.proposal=null;this.status(this.run.cancelled?'cancelled':'done','데이터 적용의 완료를 공동 이력에서 확인했습니다.');}}}if(record.unknownUndo&&record.request.target.editorSessionId===this.getSessionId()){const editor=await this.read('readEditorState');if(editor.state.history.topRedoEntryId===record.result.value.undoEntryId){record.undone=true;record.unknownUndo=false;this.status('done','데이터 실행 취소의 완료를 확인했습니다.');}}}return ok(this.statusValue());}catch(error){return resultError(error);}}
 async undoLast(input={}){
  try{exact(input,['receiptId']);const record=input.receiptId?[...this.receipts.values()].find(item=>item.id===input.receiptId):this.lastReceipt;if(!record?.result?.ok||record.undone||!record.result.value.undoEntryId)throw new DataError('HISTORY_CONFLICT','실행 취소할 데이터 편집이 없습니다.');
   const read=await this.read('readCommittedSnapshot'),editor=await this.read('readEditorState');if(read.editorSessionId!==record.request.target.editorSessionId||read.documentId!==record.request.target.documentId)throw new DataError('STALE_EDITOR_SESSION','다른 문서의 데이터 편집을 취소할 수 없습니다.');
   if(record.unknownUndo&&editor.state.history.topRedoEntryId===record.result.value.undoEntryId){record.undone=true;record.unknownUndo=false;return ok({receipt:this.publicReceipt(record,true)});}
   if(editor.state.history.topUndoEntryId!==record.result.value.undoEntryId)throw new DataError('HISTORY_CONFLICT','이후에 편집한 내용이 있습니다. 현재 맨 위 데이터 편집만 실행 취소할 수 있습니다.');
   const request=record.unknownUndo?record.undoRequest:{target:record.request.target,expectedRevision:read.contentRevision,operationId:randomUUID(),expectedTopEntryId:record.result.value.undoEntryId};record.undoRequest=clone(request);let result;
   try{result=await this.dispatch('undoGuarded',request);}catch{record.unknownUndo=true;this.status('outcomeUnknown','실행 취소의 결과를 확인해야 합니다.');throw new DataError('OUTCOME_UNKNOWN','데이터 실행 취소 결과가 아직 확인되지 않았습니다.',{outcomeUnknown:true});}
   if(!result||typeof result.ok!=='boolean'||result.error?.outcomeUnknown===true){record.unknownUndo=true;this.status('outcomeUnknown','데이터 실행 취소 결과를 확인해야 합니다.');throw new DataError(result?.error?.code||'OUTCOME_UNKNOWN',result?.error?.message||'데이터 실행 취소 결과가 아직 확인되지 않았습니다.',{outcomeUnknown:true});}if(!result.ok)return result;record.undone=true;record.unknownUndo=false;const receipt=this.publicReceipt(record);this.emit('receipt',{receipt});this.status('done','데이터 편집을 실행 취소했습니다.');return ok({receipt});
  }catch(error){return resultError(error);}
 }
}
