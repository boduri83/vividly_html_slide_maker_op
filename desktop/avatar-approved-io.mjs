/** Approved IO uses app-owned targets/operation IDs; model arguments never confer authority. */
import { randomUUID } from 'node:crypto';
import { AvatarError } from './avatar-provider.mjs';

export const capturedTarget = run => Object.fromEntries(['instanceId','editorSessionId','documentId'].map(key => [key,run.bound[key]]));
export function blockingAvatarBusy(editor,scope) {
  const reasons=editor.state?.busy?.reasons;
  return scope==='document'&&Array.isArray(reasons)
    ? reasons.some(reason=>reason.kind!=='presentation') : Boolean(editor.state?.busy?.active);
}
const metadataKeys=new Set(['fileHandleId','permissionId','stagingId','assetId','kind','name','mimeType','bytes','sha256','width','height','expiresAt']);
const metadata=value=>Object.fromEntries(Object.entries(value||{}).filter(([key,value])=>metadataKeys.has(key)&&['string','number','boolean'].includes(typeof value)));
function unwrap(result) {
  if(result?.ok!==true)throw Object.assign(new AvatarError(result?.error?.code||'IO_FAILED',result?.error?.message||'승인한 파일 작업을 완료하지 못했습니다.'),result?.error);
  return result.value;
}
export function approvedIOReceipt(record) {
  const value=record.result?.value||{};
  return {operationId:record.operationId,kind:record.kind,method:record.method,state:record.state,
    documentId:record.target.documentId,editorSessionId:record.target.editorSessionId,
    ...(typeof value.name==='string'?{name:value.name.slice(0,160)}:{}),
    ...(typeof value.active==='boolean'?{active:value.active}:{}),
    ...(Number.isSafeInteger(value.savedRevision)?{savedRevision:value.savedRevision}:{}),
    ...(Number.isSafeInteger(value.contentRevision)?{contentRevision:value.contentRevision}:{}),
    ...(value.newTarget?{newTarget:value.newTarget}:{})};
}
export async function reconcileApprovedIO(coordinator) {
  for(const record of coordinator.ioReceipts.values()) {
    if(record.state!=='outcome-unknown'||record.pending||record.target.editorSessionId!==coordinator.getSessionId())continue;
    try {
      const read=await coordinator.dispatch('readHostOperation',{target:record.target,operationId:record.operationId});
      if(!read?.ok||!read.value?.result||!['committed','rejected','cancelled-before-commit'].includes(read.value.state))continue;
      record.result=structuredClone(read.value.result);record.state=read.value.state;
      coordinator.lastHostReceipt=approvedIOReceipt(record);coordinator.emit('hostReceipt',{receipt:coordinator.lastHostReceipt},record.run);if(!coordinator.hasUnknownOutcome()&&coordinator.state==='outcomeUnknown')coordinator.status(record.run.cancelled?(coordinator.enabled?'cancelled':'off'):'done','파일 작업의 확정 결과를 확인했습니다.',record.run);
    } catch { /* An unknown result remains unknown until the authoritative receipt is readable. */ }
  }
}
export async function callApprovedIO(coordinator,run,name,args) {
  if(run.bound.scope!=='document')throw new AvatarError('SCOPE_VIOLATION','파일·자산 작업은 문서 범위에서 요청하세요.',{mutated:false});
  const target=capturedTarget(run);
  if(name==='list_approved_files') {
    const value=unwrap(await coordinator.dispatch('listApprovedFiles',{target}));coordinator.active(run);
    return {ok:true,value:{handles:(value.handles||[]).map(metadata),staged:(value.staged||[]).map(metadata),permissions:(value.permissions||[]).map(metadata),capabilities:value.capabilities||{}}};
  }
  if(name==='import_approved_asset') {
    const value=unwrap(await coordinator.dispatch('importAsset',{target,fileHandleId:args.fileHandleId}));coordinator.active(run);
    return {ok:true,value:metadata(value)};
  }
  if([...coordinator.ioReceipts.values()].some(record=>record.state==='outcome-unknown'))throw new AvatarError('OUTCOME_UNKNOWN','이전 파일 작업의 결과를 먼저 확인하세요. 새 작업으로 반복하지 않습니다.',{outcomeUnknown:true});
  const method={save_approved_document:'saveDocument',open_approved_document:'openDocument',present_approved_document:'presentDocument'}[name];
  if(!method)throw new AvatarError('UNKNOWN_TOOL','지원하지 않는 파일 작업입니다.');
  if(coordinator.ioReceipts.size>=1000)throw new AvatarError('RECEIPT_LIMIT','파일 작업 결과 한도에 도달했습니다.',{mutated:false});
  const operationId=randomUUID(),params={target,expectedRevision:run.bound.revision,operationId,
    ...(method==='presentDocument'?{permissionId:args.permissionId,active:args.active,...(args.slideId?{slideId:args.slideId}:{})}:{fileHandleId:args.fileHandleId})};
  const record={operationId,kind:{saveDocument:'save',openDocument:'open',presentDocument:'present'}[method],method,target,run,state:'pending',pending:true,result:null};
  coordinator.ioReceipts.set(operationId,record);run.ioOperation=record;run.inFlight=true;run.ioOpening=method==='openDocument';
  try {
    try{record.result=await coordinator.dispatch(method,params);}catch{record.result={ok:false,error:{code:'OUTCOME_UNKNOWN',message:'파일 작업 결과를 확인해야 합니다.',outcomeUnknown:true}};}
    if(!record.result||typeof record.result.ok!=='boolean')record.result={ok:false,error:{code:'OUTCOME_UNKNOWN',message:'파일 작업의 완료 여부를 확인하지 못했습니다.',outcomeUnknown:true}};
    record.state=record.result.error?.outcomeUnknown?'outcome-unknown':record.result.ok?'committed':record.result.error?.code==='CANCELLED_BEFORE_COMMIT'?'cancelled-before-commit':'rejected';
    if(record.result.ok&&method==='openDocument') {
      const next=record.result.value?.newTarget;
      if(!next||next.editorSessionId===target.editorSessionId||next.editorSessionId!==coordinator.getSessionId()) {
        record.state='outcome-unknown';record.result={ok:false,error:{code:'OUTCOME_UNKNOWN',message:'새 문서의 열기 결과를 확인해야 합니다.',outcomeUnknown:true}};
      } else {run.ioOpened=true;run.ioTerminal=true;coordinator.clearConversation();if(coordinator.proposal)coordinator.proposal.stale=true;coordinator.proposal=null;}
    }
    if(record.result.ok&&method==='presentDocument')run.ioTerminal=true;
    record.pending=false;const receipt=approvedIOReceipt(record);coordinator.lastHostReceipt=receipt;run.hostReceipt=receipt;coordinator.emit('hostReceipt',{receipt},run);
    if(run.cancelled&&record.state!=='outcome-unknown')coordinator.status(coordinator.enabled?'cancelled':'off',record.state==='committed'?'중단 전에 전달한 파일·발표 작업은 반영됐습니다.':'중단한 파일·발표 작업은 반영되지 않았습니다.',run);
    unwrap(record.result);return {ok:true,value:{hostReceipt:receipt}};
  } finally {record.pending=false;run.inFlight=false;run.ioOpening=false;}
}
