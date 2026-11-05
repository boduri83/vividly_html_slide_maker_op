/** Private main-to-editor file boundary. Never flushes a human draft or accepts a path. */
import { validateReadTarget } from './editor-read.js';
import { normalizeDocument } from './model.js';
import { exportPresentation, parsePresentation, validateAssetBytes } from './format.js';

export const IO_EDITOR_METHODS = new Set(['ioCaptureDocument','ioMarkSaved','ioOpenDocument','ioPresentDocument','ioCancelOperation']);
const fail=(code,message)=>({ok:false,error:{code,message,mutated:false}});
const targetOf=value=>Object.fromEntries(['instanceId','editorSessionId','documentId'].map(key=>[key,value[key]]));
const fields={ioCaptureDocument:['target','expectedRevision','operationId'],ioMarkSaved:['target','expectedRevision','captureId','name'],ioOpenDocument:['target','expectedRevision','contents','name','openToken','operationId'],ioPresentDocument:['target','expectedRevision','active','slideId','operationId'],ioCancelOperation:['operationId']};
export function createAgentIOEditor({store,render,updateStatus,onSaved=()=>{},onOpened=()=>{},present=()=>{},isPresenting=()=>false}) {
  const captures=new Map(),cancelled=new Set();
  let cancellationScope=null;
  const cancelKey=(context,operationId)=>JSON.stringify([context.ioGrantId,context.editorSessionId,operationId]);
  function authorize(context){
    const permitted=store.checkAgentGrant(context);
    if(!permitted.ok)return permitted;
    if(!context?.ioGrantId)return fail('PERMISSION_DENIED','파일 작업 허용이 필요합니다.');
    const next=JSON.stringify([context.ioGrantId,context.editorSessionId]);
    if(cancellationScope!==next){cancelled.clear();for(const[id,capture]of captures)if(capture.ioGrantId!==context.ioGrantId||capture.target.editorSessionId!==context.editorSessionId)captures.delete(id);cancellationScope=next;}
    return permitted;
  }
  function guard(params,context,{clean=false,busy=true}={}) {
    const permitted=authorize(context);if(!permitted.ok)return permitted;
    const state=store.readEditorState(params.target);
    if(!state.ok)return state;
    const invalid=validateReadTarget(params.target,state.value);
    if(invalid)return {ok:false,error:{...invalid,mutated:false}};
    if(params.expectedRevision!==state.value.contentRevision)return fail('REVISION_CONFLICT','자료가 변경됐습니다. 현재 내용을 다시 확인하세요.');
    if(params.operationId&&cancelled.has(cancelKey(context,params.operationId)))return fail('CANCELLED_BEFORE_COMMIT','확정 전에 파일 작업을 취소했습니다.');
    const reasons=state.value.state.busy.reasons.filter(reason=>!(params.active===false&&reason.kind==='presentation'));
    if(busy&&reasons.length)return fail('EDITOR_BUSY','사람이 편집 중입니다. 입력을 마친 뒤 다시 시도하세요.');
    if(clean&&state.value.state.dirty)return fail('UNSAVED_CHANGES','현재 자료를 저장한 뒤 다른 자료를 여세요.');
    return state;
  }
  return async function ioEditor(request) {
    const {method,params={},agentContext:context}=request;
    try {
      if(!IO_EDITOR_METHODS.has(method))return fail('UNKNOWN_METHOD','지원하지 않는 파일 작업입니다.');
      if(!params||typeof params!=='object'||Array.isArray(params)||Object.keys(params).some(key=>!fields[method].includes(key)))return fail('INVALID_REQUEST','허용한 파일 작업 필드만 사용하세요.');
      if(!context||typeof context!=='object'||Array.isArray(context)||Object.keys(context).some(key=>!['grantId','ioGrantId','editorSessionId','operationId'].includes(key)))return fail('PERMISSION_DENIED','신뢰된 파일 작업 맥락이 필요합니다.');
      if(method!=='ioCancelOperation'&&(!params.target||!Number.isSafeInteger(params.expectedRevision)||params.expectedRevision<0))return fail('INVALID_REQUEST','명시적인 문서 대상과 revision이 필요합니다.');
      if(method==='ioCancelOperation') {
        const allowed=authorize(context);if(!allowed.ok)return allowed;
        if(typeof params.operationId!=='string'||!params.operationId.trim()||params.operationId.length>256)return fail('INVALID_REQUEST','작업 식별자가 필요합니다.');
        if(cancelled.size>=1000)return fail('RECEIPT_LIMIT','파일 작업 한도에 도달했습니다.');
        cancelled.add(cancelKey(context,params.operationId));return {ok:true,value:{cancelRequested:true}};
      }
      if(method==='ioMarkSaved') {
        // Acknowledgement binds the exact captured baseline even if subsequent edits exist.
        const allowed=authorize(context);if(!allowed.ok)return allowed;
        const captured=captures.get(params.captureId);
        if(!captured||captured.ioGrantId!==context?.ioGrantId||captured.revision!==params.expectedRevision||validateReadTarget(params.target,captured.target))return fail('INVALID_CAPTURE','저장한 문서 사본을 확인하지 못했습니다.');
        const current=store.readEditorState(params.target);if(!current.ok)return current;
        store.markSaved(captured.snapshot,captured.target.editorSessionId);captures.delete(params.captureId);
        onSaved({name:params.name,sessionId:captured.target.editorSessionId});updateStatus();
        return {ok:true,value:{contentRevision:store.revision,savedRevision:captured.revision,dirty:store.isDirty}};
      }
      const checked=guard(params,context,{clean:method==='ioOpenDocument'});if(!checked.ok)return checked;
      if(method==='ioCaptureDocument') {
        for(const[id,capture]of captures)if(capture.target.editorSessionId!==store.sessionId||Date.now()-capture.created>120000)captures.delete(id);
        if(captures.size>=8)return fail('CAPTURE_LIMIT','진행 중인 저장 작업을 먼저 완료하세요.');
        const read=store.readCommittedSnapshot(params.target);if(!read.ok)return read;
        const snapshot=read.value.document,captureId=crypto.randomUUID(),target=targetOf(read.value),revision=read.value.contentRevision;
        const html=exportPresentation(snapshot);captures.set(captureId,{snapshot,target,revision,created:Date.now(),ioGrantId:context.ioGrantId});
        return {ok:true,value:{target,contentRevision:revision,html,title:snapshot.title,dirty:store.isDirty,captureId}};
      }
      if(method==='ioOpenDocument') {
        if(typeof params.contents!=='string'||new TextEncoder().encode(params.contents).length>100*1024*1024)return fail('INVALID_DOCUMENT','100MB 이하의 문서가 필요합니다.');
        const document=await validateAssetBytes(String(params.name).toLowerCase().endsWith('.json')?normalizeDocument(JSON.parse(params.contents)):parsePresentation(params.contents));
        const final=guard(params,context,{clean:true});if(!final.ok)return final;
        if(isPresenting())present({active:false});
        const previousTarget=targetOf(final.value);store.loadDocument(document);onOpened({name:params.name,sessionId:store.sessionId});render();
        const next=store.readEditorState();return {ok:true,value:{target:targetOf(next.value),previousTarget,contentRevision:next.value.contentRevision}};
      }
      if(typeof params.active!=='boolean'||params.slideId!==undefined&&!store.document.slides.some(slide=>slide.id===params.slideId))return fail('INVALID_REQUEST','발표 상태와 페이지를 확인하세요.');
      present({active:params.active,slideId:params.slideId});updateStatus();
      return {ok:true,value:{active:params.active,slideId:store.activeSlideId,contentRevision:store.revision}};
    }catch(error){return fail(error.code||'IO_EDITOR_FAILED',error.message);}
  };
}
