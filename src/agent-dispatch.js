/** Closed renderer dispatch for main-owned requests. Context is a separate trusted IPC envelope, never params. */
import{READ_LIMITS}from'./read-projection.js';
import{CREATION_COMMANDS}from'./creation-context.js';
const mutationMethods=new Set(['applyCommands','undoGuarded','redoGuarded']);
export function hostCapabilities(base){return{...base,creation:{...base.creation,contractVersion:'vividly.creation/0.1',available:[...CREATION_COMMANDS].every(id=>base.commands?.some(command=>command.id===id&&command.availability!=='reserved')),commands:[...CREATION_COMMANDS],referenceSyntax:{$ref:'previous clientRef'},references:'Only documented ID fields; forward, unknown, duplicate refs rejected; text literals unchanged',createdIds:'clientRef -> permanent document ID; persisted IDs survive save/reopen',preview:'Same target/revision/operationId/commands gives stable IDs; preview does not reserve a mutation receipt',newDocument:'Person starts a fresh blank workspace; prior document/file grants are not migrated',maxCommands:100,maxPublicBytes:262144},readContractVersion:'vividly.read/0.2',hostOperations:{partialCommittedRead:true,readOperation:true,cancelOperation:true,revisionPreview:true,save:true,open:true,present:true,approvedFileListing:true,assetStaging:true,readHostOperation:true,cancelHostOperation:true,unrestrictedFilePaths:false},agentIO:{contractVersion:'vividly.agent-io/0.1',authority:'human-approved IO grant per document/session; independent of external MCP enable',paths:false,publicAssetBytes:false,approvedMimeTypes:['image/png'],assetLimits:{perAssetBytes:20971520,totalBytes:41943040,count:8,maxAxis:16384,maxPixels:67108864},publicCommandLimits:{bytes:262144,count:100},requires:{asset:'immutable approved stage',saveOpen:'approved file handle and revision',present:'approved presentation permission and revision'}},readLimits:READ_LIMITS,receipts:{scope:'current-grant/session',limit:1000,reconnectClears:true,unknownMeans:'not known in current grant; never assume safe replay with a new operationId'},cancellation:{atomicCommit:true,forwardedOutcome:'read authoritative operation receipt; cancellation is not rollback',transport:'authenticated cancelOperation, not serialized AbortSignal'}};}
export async function dispatchAgentRequest(request,{store,render=()=>{},notice=()=>{}}={}){let result;const method=request?.method,params=request?.params??{},context=request?.agentContext;
  try{
    const validId=value=>typeof value==='string'&&value.trim()&&value.length<=256;
    if(context&&(!context||typeof context!=='object'||Array.isArray(context)||Object.keys(context).some(k=>!['grantId','ioGrantId','editorSessionId','stagedAssets'].includes(k))||!validId(context.editorSessionId)||context.grantId!==undefined&&context.grantId!==null&&!validId(context.grantId)||context.ioGrantId!==undefined&&context.ioGrantId!==null&&!validId(context.ioGrantId)))return{ok:false,error:{code:'PERMISSION_DENIED',message:'신뢰된 연결 맥락이 필요합니다.',mutated:false}};
    if(context?.stagedAssets!==undefined&&!['applyCommands','previewCommands'].includes(method))return{ok:false,error:{code:'PERMISSION_DENIED',message:'승인 자산은 변경/검토 전용 비공개 맥락입니다.',mutated:false}};
    if(method==='bindAgentGrant'||method==='bindIOGrant'){
      const key=method==='bindIOGrant'?'ioGrantId':'grantId';
      if(!context||!Object.hasOwn(context,key)||context[key]!==null&&context.editorSessionId!==store.editorSessionId||Object.keys(context).some(k=>![key,'editorSessionId'].includes(k)))return{ok:false,error:{code:'PERMISSION_DENIED',message:'호스트가 허용한 문서 세션이 필요합니다.',mutated:false}};
      return{ok:true,value:{enabled:method==='bindIOGrant'?store.setIOGrant(context[key]):store.setAgentGrant(context[key])}};
    }
    if(context){const authorized=store.checkAgentGrant(context);if(!authorized.ok)return authorized;}
    if(method==='readProjection')result=store.readProjection(params);
    else if(method==='readCommittedSnapshot')result=store.readCommittedSnapshot(params.target);
    else if(method==='readEditorState')result=store.readEditorState(params.target);
    else if(method==='readHistory')result=store.readHistory(params.target);
    else if(method==='readCapabilities'){const value=store.readCapabilities();result=value.ok?{ok:true,value:hostCapabilities(value.value)}:value;}
    else if(['readOperation','cancelOperation'].includes(method))result=store[method](params,context||{});
    else if(method==='previewCommands')result=await store.previewCommands(params,context||{});
    else if(mutationMethods.has(method)){result=context?await store.invokeOperation(method,params,context):await store[method](params);if(result.ok&&result.value.changed){try{render();}catch(error){notice('문서 변경 후 화면 갱신 오류: '+error.message,true);}}}
    else result={ok:false,error:{code:'UNKNOWN_METHOD',message:'지원하지 않는 요청입니다.',mutated:false}};
  }catch(error){result={ok:false,error:{code:error.code||'REQUEST_FAILED',message:error.message,...(mutationMethods.has(method)?{outcomeUnknown:true}:{mutated:false})}};}return result;
}
