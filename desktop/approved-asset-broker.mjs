/** Main-only approval handles and immutable PNG staging. No arbitrary model path or network authority. */
import fs from'node:fs/promises';import path from'node:path';import{createHash,randomUUID}from'node:crypto';
import{canonicalJson}from'./canonical-json.mjs';
export const APPROVED_ASSET_LIMITS=Object.freeze({bytes:20*1024*1024,totalBytes:40*1024*1024,pinnedBytes:40*1024*1024,pixels:64*1024*1024,axis:16384,handles:32,stages:8,operations:1000,ttlMs:10*60*1000});
export class AssetApprovalError extends Error{constructor(code,message){super(message);this.code=code;}}
const clone=structuredClone,ok=value=>({ok:true,value}),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const failure=error=>({ok:false,error:{code:error.code||'ASSET_ERROR',message:error instanceof AssetApprovalError?error.message:'승인 자산 작업을 완료하지 못했습니다.',mutated:false}});
function exact(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key)))throw new AssetApprovalError('INVALID_REQUEST','허용된 자산 입력 항목을 확인하세요. 파일 경로는 입력할 수 없습니다.');}
function id(value){if(typeof value!=='string'||!value.trim()||value.length>256)throw new AssetApprovalError('INVALID_REQUEST','명시적인 승인 핸들 ID가 필요합니다.');return value;}
function pngHeader(bytes){
 const signature=Buffer.from([137,80,78,71,13,10,26,10]);
 if(bytes.length<33||!bytes.subarray(0,8).equals(signature)||bytes.readUInt32BE(8)!==13||bytes.toString('ascii',12,16)!=='IHDR')throw new AssetApprovalError('ASSET_FORMAT','첫 승인 자산 흐름은 실제 PNG 이미지만 지원합니다.');
 const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
 if(!width||!height||width>APPROVED_ASSET_LIMITS.axis||height>APPROVED_ASSET_LIMITS.axis||width*height>APPROVED_ASSET_LIMITS.pixels)throw new AssetApprovalError('ASSET_DIMENSIONS','이미지는 한 변 16384px, 전체 64M 픽셀 이내로 선택하세요.');
 return{width,height};
}
export function createNativePngDecoder(nativeImage){
 if(typeof nativeImage?.createFromBuffer!=='function')throw TypeError('Electron nativeImage dependency required');
 return async bytes=>{let decoded;try{decoded=nativeImage.createFromBuffer(bytes);if(!decoded||decoded.isEmpty())throw Error('empty image');const size=decoded.getSize();return{width:size.width,height:size.height};}catch{throw new AssetApprovalError('ASSET_DECODE_FAILED','PNG 이미지를 실제로 해석하지 못했습니다. 다른 파일을 선택하세요.');}};
}
export function createNativeAssetPicker({dialog,getWindow=()=>undefined,withDialog=operation=>operation()}={}){
 if(typeof dialog?.showOpenDialog!=='function')throw TypeError('Native dialog dependency required');
 return()=>withDialog(()=>dialog.showOpenDialog(getWindow(),{title:'현재 문서의 에이전트에 허용할 PNG 선택',properties:['openFile'],filters:[{name:'PNG 이미지',extensions:['png']}]}));
}
export class ApprovedAssetBroker{
 constructor({getGrant,dispatch,chooseFile,decodeImage,io=fs,now=()=>Date.now()}={}){
  if(typeof getGrant!=='function'||typeof dispatch!=='function'||typeof chooseFile!=='function'||typeof decodeImage!=='function')throw TypeError('Main approval dependencies required');
  this.getGrant=getGrant;this.dispatch=dispatch;this.chooseFile=chooseFile;this.decodeImage=decodeImage;this.io=io;this.now=now;this.principal=null;this.handles=new Map();this.stages=new Map();this.selecting=false;this.operations=new Map();this.jobs=new Set();for(const name of ['chooseAsset','importAsset','revokeFile','releaseAsset']){const operation=this[name].bind(this);this[name]=(...args)=>{const job=Promise.resolve().then(()=>operation(...args));this.jobs.add(job);const done=()=>this.jobs.delete(job);job.then(done,done);return job;};}
 }
 current(){
  const grant=this.getGrant(),valid=grant&&['grantId','editorSessionId','documentId'].every(key=>typeof grant[key]==='string'&&grant[key].trim()&&grant[key].length<=256),principal=valid?JSON.stringify([grant.grantId,grant.editorSessionId,grant.documentId]):null;
  if(principal!==this.principal){for(const record of this.operations.values())if(['pending','outcome-unknown'].includes(record.state))this.requestCancellation(record);this.handles.clear();this.stages.clear();this.principal=principal;}
  for(const[key,record]of this.operations)if(JSON.stringify([record.grant.grantId,record.grant.editorSessionId,record.grant.documentId])!==principal&&!['pending','outcome-unknown'].includes(record.state))this.operations.delete(key);
  for(const[handleId,record]of this.handles)if(record.expires<=this.now())this.dropHandle(handleId);
  return valid?{grantId:grant.grantId,editorSessionId:grant.editorSessionId,documentId:grant.documentId}:null;
 }
 requireGrant(expected){
  const grant=this.current();if(!grant||expected&&JSON.stringify(grant)!==JSON.stringify(expected))throw new AssetApprovalError('PERMISSION_DENIED','현재 문서의 파일 허용 문맥이 필요합니다. 문서가 바뀌면 파일을 다시 선택하세요.');return grant;
 }
 async snapshot(grant,target){
  const result=await this.dispatch('readCommittedSnapshot',target?{target}:{},{ioGrantId:grant.grantId,editorSessionId:grant.editorSessionId});this.requireGrant(grant);
  if(!result?.ok)throw new AssetApprovalError(result?.error?.code||'EDITOR_UNAVAILABLE','승인할 현재 문서 상태를 읽지 못했습니다.');
  if(result.value.documentId!==grant.documentId||result.value.editorSessionId!==grant.editorSessionId)throw new AssetApprovalError('PERMISSION_DENIED','허용한 문서 세션과 현재 문서가 다릅니다.');return result.value;
 }
 handleView(record){return{fileHandleId:record.id,name:record.name,mimeType:'image/png',bytes:record.bytes.length,sha256:record.sha256,width:record.width,height:record.height,expiresAt:new Date(record.expires).toISOString()};}
 stageView(record){return{stagingId:record.id,fileHandleId:record.fileHandleId,assetId:record.asset.id,mimeType:record.asset.mimeType,bytes:record.asset.bytes,sha256:record.asset.sha256,width:record.asset.width,height:record.asset.height,expiresAt:new Date(record.expires).toISOString()};}
 dropHandle(handleId){this.handles.delete(handleId);for(const[stageId,record]of this.stages)if(record.fileHandleId===handleId)this.stages.delete(stageId);}
 async getStatus(){const grant=this.current();return ok({enabled:Boolean(grant),granted:Boolean(grant),...(grant?{grant}:{}),capabilities:{assetSelection:true,assetStaging:true,fullSizeAssetBatch:true,save:false,open:false,present:false},limits:clone(APPROVED_ASSET_LIMITS),handles:[...this.handles.values()].map(record=>this.handleView(record)),staged:[...this.stages.values()].map(record=>this.stageView(record)),outcomeUnknown:this.outcomeUnknown,pinnedOperations:[...this.operations.values()].filter(r=>r.bundle).length});}
 async boundedRead(filePath){
  let handle;try{handle=await this.io.open(filePath,'r');const stat=await handle.stat();if(!stat.isFile()||stat.size<1||stat.size>APPROVED_ASSET_LIMITS.bytes)throw new AssetApprovalError('ASSET_SIZE','일반 PNG 파일을 20MiB 이하로 선택하세요.');const chunks=[];let total=0;
   for(;;){const buffer=Buffer.alloc(Math.min(65536,APPROVED_ASSET_LIMITS.bytes-total+1)),part=await handle.read(buffer,0,buffer.length,null);if(!part.bytesRead)break;total+=part.bytesRead;if(total>APPROVED_ASSET_LIMITS.bytes)throw new AssetApprovalError('ASSET_SIZE','파일을 읽는 동안 20MiB 한도를 넘었습니다.');chunks.push(buffer.subarray(0,part.bytesRead));}return Buffer.concat(chunks);
  }catch(error){if(error instanceof AssetApprovalError)throw error;throw new AssetApprovalError('ASSET_READ_FAILED','선택한 PNG 파일을 읽지 못했습니다. 다시 선택하세요.');}finally{try{await handle?.close();}catch{}}
 }
 async chooseAsset(input={}){
  try{exact(input,[]);const grant=this.requireGrant();await this.snapshot(grant);if(this.selecting)throw new AssetApprovalError('DIALOG_BUSY','이미 파일 선택 창이 열려 있습니다.');if(this.handles.size>=APPROVED_ASSET_LIMITS.handles)throw new AssetApprovalError('APPROVAL_LIMIT','허용 파일을 정리한 뒤 새 파일을 선택하세요.');this.selecting=true;
   try{const selected=await this.chooseFile();this.requireGrant(grant);if(selected?.canceled)return ok({canceled:true});if(!Array.isArray(selected?.filePaths)||selected.filePaths.length!==1||!path.isAbsolute(selected.filePaths[0]))throw new AssetApprovalError('INVALID_SELECTION','기본 파일 선택 창에서 PNG 하나를 선택하세요.');
    const bytes=await this.boundedRead(selected.filePaths[0]),dimensions=pngHeader(bytes);let decoded;try{decoded=await this.decodeImage(bytes);}catch(error){if(error instanceof AssetApprovalError)throw error;throw new AssetApprovalError('ASSET_DECODE_FAILED','선택한 PNG를 해석하지 못했습니다.');}
    this.requireGrant(grant);if(decoded?.width!==dimensions.width||decoded?.height!==dimensions.height)throw new AssetApprovalError('ASSET_DIMENSIONS','실제 이미지 크기와 PNG 정보가 다릅니다.');
    const stored=[...this.handles.values()].reduce((total,record)=>total+record.bytes.length,0);if(stored+bytes.length>APPROVED_ASSET_LIMITS.totalBytes)throw new AssetApprovalError('APPROVAL_LIMIT','승인 대기 이미지 합계를 40MiB 이내로 줄이세요.');
    const record={id:randomUUID(),name:path.basename(selected.filePaths[0]),bytes:Buffer.from(bytes),sha256:hash(bytes),...dimensions,expires:this.now()+APPROVED_ASSET_LIMITS.ttlMs};this.handles.set(record.id,record);return ok({canceled:false,handle:this.handleView(record)});
   }finally{this.selecting=false;}
  }catch(error){return failure(error);}
 }
 async revokeFile(input){try{exact(input,['fileHandleId']);this.requireGrant();const fileHandleId=id(input.fileHandleId);if(!this.handles.has(fileHandleId))throw new AssetApprovalError('HANDLE_EXPIRED','허용 파일이 없거나 만료됐습니다.');const stages=[...this.stages.values()].filter(r=>r.fileHandleId===fileHandleId).map(r=>r.id);await this.cancelStages(stages);this.dropHandle(fileHandleId);return ok({revoked:true});}catch(error){return failure(error);}}
 async importAsset(input){
  try{exact(input,['target','fileHandleId','expectedSha256','expectedMimeType']);const grant=this.requireGrant(),fileHandleId=id(input.fileHandleId),record=this.handles.get(fileHandleId);if(!record)throw new AssetApprovalError('HANDLE_EXPIRED','현재 허용한 파일 핸들이 없거나 만료됐습니다.');
   if(input.expectedMimeType!==undefined&&input.expectedMimeType!=='image/png')throw new AssetApprovalError('ASSET_MIME_MISMATCH','승인된 PNG 형식과 요청한 MIME가 다릅니다.');if(input.expectedSha256!==undefined&&input.expectedSha256!==record.sha256)throw new AssetApprovalError('ASSET_HASH_MISMATCH','승인된 원본 SHA-256과 요청이 다릅니다.');
   const existing=[...this.stages.values()].find(item=>item.fileHandleId===fileHandleId);if(existing){if(input.target)await this.snapshot(grant,input.target);return ok(this.stageView(existing));}if(this.stages.size>=APPROVED_ASSET_LIMITS.stages)throw new AssetApprovalError('STAGING_LIMIT','대기 자산을 정리한 뒤 다시 준비하세요.');
   const snapshot=await this.snapshot(grant,input.target);if(!this.handles.has(fileHandleId)||record.expires<=this.now())throw new AssetApprovalError('HANDLE_EXPIRED','승인한 파일이 만료됐습니다. 다시 선택하세요.');const raced=[...this.stages.values()].find(item=>item.fileHandleId===fileHandleId);if(raced)return ok(this.stageView(raced));const known=snapshot.document.assets.find(asset=>asset.mimeType==='image/png'&&asset.sha256===record.sha256&&asset.bytes===record.bytes.length&&asset.dataBase64===record.bytes.toString('base64'));
   const asset={id:known?.id||'asset-'+randomUUID(),mimeType:'image/png',width:record.width,height:record.height,bytes:record.bytes.length,sha256:record.sha256,dataBase64:record.bytes.toString('base64')},stage={id:randomUUID(),fileHandleId,asset,expires:record.expires};this.stages.set(stage.id,stage);return ok(this.stageView(stage));
  }catch(error){return failure(error);}
 }
 async releaseAsset(input){try{exact(input,['stagingId']);this.requireGrant();const stagingId=id(input.stagingId);if(!this.stages.has(stagingId))throw new AssetApprovalError('STAGING_EXPIRED','대기 자산이 없거나 만료됐습니다.');await this.cancelStages([stagingId]);this.stages.delete(stagingId);return ok({released:true});}catch(error){return failure(error);}}
 /** Trusted main-only seam. Never put this method in preload or an MCP tool catalog. */
 async resolveForBatch(input){
  exact(input,['stagingIds','target']);const grant=this.requireGrant();if(!Array.isArray(input.stagingIds)||!input.stagingIds.length||input.stagingIds.length>8||new Set(input.stagingIds).size!==input.stagingIds.length)throw new AssetApprovalError('INVALID_REQUEST','중복 없는 대기 자산 ID 1–8개가 필요합니다.');const snapshot=await this.snapshot(grant,input.target),records=input.stagingIds.map(stageId=>{const record=this.stages.get(id(stageId));if(!record)throw new AssetApprovalError('STAGING_EXPIRED','대기 자산이 만료됐거나 권한 범위를 벗어났습니다.');return record;});
  const usedIds=new Set(),stagedAssets=[];for(const record of records){if(usedIds.has(record.asset.id))continue;usedIds.add(record.asset.id);const known=snapshot.document.assets.find(asset=>asset.id===record.asset.id);if(known&&known.sha256!==record.asset.sha256)throw new AssetApprovalError('ASSET_ID_CONFLICT','자료의 자산 ID가 달라졌습니다. 자산을 다시 준비하세요.');stagedAssets.push({asset:clone(record.asset)});}
  return{ioGrantId:grant.grantId,editorSessionId:grant.editorSessionId,documentId:grant.documentId,stagingIds:[...input.stagingIds],stagedAssets};
 }
 /** Called only after a trusted Controller receipt. dryRun/failure/unknown retain the same staging IDs. */
 completeBatch({stagingIds,result}){
  this.current();if(result?.ok===true&&result.value?.changed===true&&result.value?.dryRun!==true&&!result.error?.outcomeUnknown)for(const stageId of stagingIds||[])this.stages.delete(stageId);
  return{consumed:result?.ok===true&&result.value?.changed===true&&result.value?.dryRun!==true};
 }
 get busy(){return this.selecting||this.jobs.size>0;}
 get outcomeUnknown(){return[...this.operations.values()].some(record=>record.state==='outcome-unknown');}
 requestCancellation(record){record.abort.abort();if(record.cancelling)return record.cancelling;const job=Promise.resolve().then(()=>this.dispatch('cancelOperation',{target:record.request.target,operationId:record.request.operationId},record.context)).catch(()=>{});record.cancelling=job;this.jobs.add(job);const done=()=>{this.jobs.delete(job);if(record.cancelling===job)record.cancelling=null;};job.then(done,done);return job;}
 async cancelStages(stageIds){for(const record of this.operations.values())if(['pending','outcome-unknown'].includes(record.state)&&record.stagingIds.some(id=>stageIds.includes(id))){await this.requestCancellation(record);if(record.state==='outcome-unknown')await this.reconcile(record);}}
 context(grant,caller={}){if(caller.editorSessionId!==undefined&&caller.editorSessionId!==grant.editorSessionId)throw new AssetApprovalError('PERMISSION_DENIED','현재 문서 세션만 사용할 수 있습니다.');return{...(caller.grantId!==undefined?{grantId:caller.grantId}:{}),ioGrantId:grant.grantId,editorSessionId:grant.editorSessionId};}
 operationKey(grant,operationId){return JSON.stringify([grant.grantId,grant.editorSessionId,id(operationId)]);}
 ownsOperation(input,caller={}){try{const g=this.current();if(!g||typeof input?.operationId!=='string')return false;const r=this.operations.get(this.operationKey(g,input.operationId));return Boolean(r&&canonicalJson(r.request.target)===canonicalJson(input.target)&&(r.context.grantId??null)===(caller.grantId??null)&&r.context.editorSessionId===(caller.editorSessionId??g.editorSessionId));}catch{return false;}}
 finishOperation(record,result){record.result=clone(result);record.state=result?.error?.outcomeUnknown?'outcome-unknown':result?.ok?'committed':result?.error?.code==='CANCELLED_BEFORE_COMMIT'?'cancelled-before-commit':'rejected';if(record.state!=='outcome-unknown'){this.completeBatch({stagingIds:record.stagingIds,result});record.bundle=null;}return clone(result);}
 async reconcile(record){
  let value;try{value=await this.dispatch('readOperation',{target:record.request.target,operationId:record.request.operationId},record.context);}catch{return null;}
  if(value?.ok&&value.value?.result&&['committed','rejected','cancelled-before-commit'].includes(value.value.state))return this.finishOperation(record,{...value.value.result,receipt:{...value.value.result.receipt,operationId:record.request.operationId,state:value.value.state,replayed:true}});return null;
 }
 /** Main-only executor: public IDs are resolved once; immutable bytes never enter public params. */
 async executeBatch(input,caller={}){
  let grant,request,stagingIds,fingerprint,key;try{
   grant=this.requireGrant();const context=this.context(grant,caller);if(!input||typeof input!=='object'||Array.isArray(input))throw new AssetApprovalError('INVALID_REQUEST','공용 명령 묶음이 필요합니다.');
   ({stagingIds,...request}=input);if(Buffer.byteLength(canonicalJson(request))>256*1024)throw new AssetApprovalError('COMMAND_LIMIT','공용 명령은 256KiB 이하여야 합니다.');
   if(stagingIds===undefined)return await this.dispatch(request.dryRun===true?'previewCommands':'applyCommands',request,context);
   if(!Array.isArray(stagingIds)||!stagingIds.length||stagingIds.length>8||new Set(stagingIds).size!==stagingIds.length)throw new AssetApprovalError('INVALID_REQUEST','대기 자산 ID 1–8개가 필요합니다.');
   fingerprint=hash(canonicalJson({request,stagingIds,externalGrantId:caller.grantId??null}));key=this.operationKey(grant,request.operationId);
   const previous=this.operations.get(key);if(previous){if(previous.fingerprint!==fingerprint)throw new AssetApprovalError('OPERATION_CONFLICT','같은 작업 ID를 다른 내용이나 자산으로 재사용할 수 없습니다.');if(previous.promise)return clone(await previous.promise);if(previous.state==='outcome-unknown'){const known=await this.reconcile(previous);return known||clone(previous.result);}return{...clone(previous.result),receipt:{...previous.result.receipt,replayed:true}};}
   if(this.operations.size>=APPROVED_ASSET_LIMITS.operations)throw new AssetApprovalError('RECEIPT_LIMIT','현재 파일 작업 결과를 정리한 뒤 다시 요청하세요.');
   const record={grant,context,request:clone(request),stagingIds:[...stagingIds],fingerprint,state:'pending',abort:new AbortController(),bundle:null,result:null,promise:null};
   if(request.dryRun!==true)this.operations.set(key,record);
   const job=(async()=>{try{const bundle=await this.resolveForBatch({stagingIds,target:request.target});this.requireGrant(grant);if(record.abort.signal.aborted)throw new AssetApprovalError('CANCELLED_BEFORE_COMMIT','자산 편입 전에 취소했습니다.');
    const pinned=[...this.operations.values()].reduce((n,r)=>n+(r.bundle?.stagedAssets.reduce((sum,a)=>sum+a.asset.bytes,0)||0),0),size=bundle.stagedAssets.reduce((sum,a)=>sum+a.asset.bytes,0);if(pinned+size>APPROVED_ASSET_LIMITS.pinnedBytes)throw new AssetApprovalError('STAGING_BUSY','완료 여부를 확인할 자산 작업을 먼저 정리하세요.');record.bundle=bundle;
    let result;try{result=await this.dispatch(request.dryRun===true?'previewCommands':'applyCommands',request,{...context,stagedAssets:bundle.stagedAssets});}catch{result={ok:false,error:{code:'OUTCOME_UNKNOWN',message:'자산 편입 결과를 확인해야 합니다. 같은 작업 ID로 결과를 조회하세요.',outcomeUnknown:true}};}
    if(!result||typeof result.ok!=='boolean')result={ok:false,error:{code:'OUTCOME_UNKNOWN',message:'자산 편입 결과를 확인하지 못했습니다.',outcomeUnknown:true}};
    if(request.dryRun===true){record.bundle=null;return result;}return this.finishOperation(record,result);
   }catch(error){const result=failure(error);if(request.dryRun===true)return result;return this.finishOperation(record,result);}finally{record.promise=null;}})();record.promise=job;this.jobs.add(job);try{return clone(await job);}finally{this.jobs.delete(job);}
  }catch(error){return failure(error);}
 }
 async readOperation(input,caller={}){try{exact(input,['target','operationId']);const grant=this.requireGrant(),record=this.operations.get(this.operationKey(grant,input.operationId)),context=this.context(grant,caller);const result=await this.dispatch('readOperation',input,context);if(record&&result?.ok&&result.value?.result&&['committed','rejected','cancelled-before-commit'].includes(result.value.state))this.finishOperation(record,result.value.result);return result;}catch(error){return failure(error);}}
 async cancelOperation(input,caller={}){try{exact(input,['target','operationId']);const grant=this.requireGrant(),record=this.operations.get(this.operationKey(grant,input.operationId));record?.abort.abort();return await this.dispatch('cancelOperation',input,this.context(grant,caller));}catch(error){return failure(error);}}
 async stopAndDrain(){for(const record of this.operations.values())if(record.promise||record.state==='outcome-unknown')await this.requestCancellation(record);await Promise.allSettled([...this.jobs]);return this.getStatus();}
}
