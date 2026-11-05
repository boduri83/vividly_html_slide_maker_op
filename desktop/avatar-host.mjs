/** Trusted app IPC for the in-window assistant; it never enables the external MCP grant. */
import {AvatarCoordinator}from'./avatar-coordinator.mjs';
import {EncryptedAvatarSettings}from'./avatar-settings.mjs';
import {createResponsesProvider}from './avatar-provider.mjs';
import {createCodexProvider}from './codex-provider.mjs';
import path from 'node:path';
export class AvatarHost{
 constructor({ipcMain,safeStorage,file,dispatch,getSessionId,getWindow,trustedSender,isClosing=()=>false,provider,codexProvider,codexWorkspace}={}){
  this.pendingMutations=new Set();this.getWindow=getWindow;this.dispatch=dispatch;this.isClosing=isClosing;
  this.settings=new EncryptedAvatarSettings({file,safeStorage});
  this.codex=codexProvider??createCodexProvider({cwd:codexWorkspace??path.join(path.dirname(file),'codex-workspace')});
  const responses=createResponsesProvider(),router=provider??{respond:request=>request.connection?.provider==='codex'?this.codex.respond(request):responses.respond(request)};
  const send=async(method,params)=>{const mutation=['applyCommands','undoGuarded','redoGuarded','importAsset','saveDocument','openDocument','presentDocument'].includes(method)&&params?.dryRun!==true;const job=Promise.resolve().then(()=>dispatch(method,params));if(mutation)this.pendingMutations.add(job);try{return await job;}finally{if(mutation)this.pendingMutations.delete(job);}};
  this.coordinator=new AvatarCoordinator({dispatch:send,getSessionId,settings:this.settings,provider:router,onEvent:event=>{const w=getWindow();if(w&&!w.isDestroyed())w.webContents.send('desktop:avatar-event',event);}});
  ipcMain.handle('desktop:avatar-codex-check',async event=>{trustedSender(event);if(isClosing())return{ok:false,error:{code:'EDITOR_BUSY',message:'창 닫기 확인 뒤 연결 상태를 확인하세요.',mutated:false}};try{return{ok:true,value:await this.codex.checkCodex()};}catch(error){return{ok:false,error:{code:error.code||'CODEX_CONNECTION_FAILED',message:error.message,mutated:false}};}});
  for(const[route,method]of[['status','getStatus'],['settings','getSettings'],['configure','configure'],['enabled','setEnabled'],['start','start'],['cancel','cancel'],['apply','applyProposal'],['undo','undoLast']])ipcMain.handle('desktop:avatar-'+route,(event,value)=>{
   trustedSender(event);if(isClosing()&&['start','applyProposal','undoLast'].includes(method))return{ok:false,error:{code:'EDITOR_BUSY',message:'창 닫기 확인을 마친 뒤 요청하세요.',mutated:false}};
   return this.coordinator[method](value);
  });
 }
 get outcomeUnknown(){return this.coordinator.hasUnknownOutcome();}
 get needsStop(){return Boolean(this.codex.busy)||this.outcomeUnknown||this.pendingMutations.size>0||['thinking','tool','waiting','review','outcomeUnknown'].includes(this.coordinator.state);}
 documentChanged(){this.coordinator.invalidateReplacedDocument();}
 async stopAndDrain(){await this.coordinator.cancel({});await this.codex.close();await Promise.allSettled([...this.pendingMutations]);return this.coordinator.getStatus();}
 async close(){await this.coordinator.cancel({});await this.codex.close();await Promise.allSettled([...this.pendingMutations]);}
}
