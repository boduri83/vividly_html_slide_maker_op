/** Trusted desktop IPC for manual JSON import. Separate from model tools and external MCP grants. */
import{SourceRegistry}from'./data-source-registry.mjs';
import{DataConnectorService}from'./data-connector-service.mjs';
const routes=Object.freeze([['list','listSources'],['configure','configureSource'],['remove','removeSource'],['sample','readSample'],['prepare','prepare'],['refresh','refresh'],['apply','applyProposal'],['cancel','cancel'],['undo','undoLast'],['status','getStatus'],['unlink','unlink']]);
const startMethods=new Set(['configureSource','removeSource','readSample','prepare','refresh','applyProposal','undoLast','unlink']);
const mutationMethods=new Set(['configureSource','removeSource','unlink','applyProposal','undoLast']);
const readJobs=new Set(['readSample','prepare','refresh']);
const error=(code,message)=>({ok:false,error:{code,message,mutated:false}});
export class DataHost{
 constructor({ipcMain,safeStorage,file,dispatch,getSessionId,getWindow,trustedSender,isClosing=()=>false,fetchImpl,fetchJson,deadlineMs,responseBytes}={}){
  if(typeof ipcMain?.handle!=='function'||typeof dispatch!=='function'||typeof getSessionId!=='function'||typeof getWindow!=='function'||typeof trustedSender!=='function')throw TypeError('Data host dependencies required');
  this.pendingMutations=new Set();this.pendingRequests=new Set();this.getWindow=getWindow;this.getSessionId=getSessionId;this.trustedSender=trustedSender;this.isClosing=isClosing;this.disposed=false;this.sessionId=getSessionId();this.draining=null;
  this.registry=new SourceRegistry({file,safeStorage});
  const send=(method,params)=>{const job=Promise.resolve().then(()=>dispatch(method,params));return this.track(job,['applyCommands','undoGuarded','redoGuarded'].includes(method)&&params?.dryRun!==true?this.pendingMutations:null);};
  this.service=new DataConnectorService({dispatch:send,getSessionId,registry:this.registry,...(fetchImpl?{fetchImpl}:{}),...(fetchJson?{fetchJson}:{}),...(deadlineMs===undefined?{}:{deadlineMs}),...(responseBytes===undefined?{}:{responseBytes}),onEvent:event=>{
   if(this.disposed)return;try{const window=getWindow();if(window&&!window.isDestroyed())window.webContents.send('desktop:data-event',event);}catch{/* The window can close after the main-process result is known. */}
  }});
  for(const[route,method]of routes)ipcMain.handle('desktop:data-'+route,(event,value)=>this.invoke(method,event,value));
 }
 track(job,set){if(!set)return job;set.add(job);const finish=()=>set.delete(job);job.then(finish,finish);return job;}
 invoke(method,event,value){
  try{this.trustedSender(event);}catch{return Promise.resolve(error('IPC_FORBIDDEN','앱의 편집 화면에서 데이터 기능을 사용하세요.'));}
  if(this.disposed)return Promise.resolve(error('HOST_CLOSED','데이터 연결 창이 종료됐습니다.'));
  if((this.isClosing()||this.draining)&&startMethods.has(method))return Promise.resolve(error('EDITOR_BUSY','창 닫기 확인을 마친 뒤 데이터 작업을 요청하세요.'));
  const job=Promise.resolve().then(()=>this.service[method](value)).catch(()=>error('DATA_HOST_ERROR','데이터 작업을 완료하지 못했습니다. 다시 시도하세요.'));
  return this.track(job,mutationMethods.has(method)?this.pendingMutations:readJobs.has(method)?this.pendingRequests:null);
 }
 get outcomeUnknown(){return this.service.hasUnknownOutcome();}
 get needsStop(){return this.outcomeUnknown||this.pendingMutations.size>0||this.pendingRequests.size>0||['fetching','review','waiting','outcomeUnknown'].includes(this.service.state);}
 documentChanged(){const session=this.getSessionId();if(session===this.sessionId)return;this.sessionId=session;void this.service.cancel({});}
 stopAndDrain(){
  if(this.draining)return this.draining;
  const job=(async()=>{await this.service.cancel({});while(this.pendingMutations.size)await Promise.allSettled([...this.pendingMutations]);return this.service.getStatus();})();
  this.draining=job;const finish=()=>{if(this.draining===job)this.draining=null;};job.then(finish,finish);return job;
 }
 close(){this.disposed=true;void this.service.cancel({});}
}
