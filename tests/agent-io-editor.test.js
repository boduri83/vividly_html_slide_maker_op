/** Closed editor callbacks exercised with the true Controller; no native files or live provider. */
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';
import{CommandController}from'../src/controller.js';import{createAgentIOEditor,IO_EDITOR_METHODS}from'../src/agent-io-editor.js';import{parsePresentation}from'../src/format.js';
const fixture=JSON.parse(await fs.readFile(new URL('../examples/document-contract-v0.1.json',import.meta.url),'utf8'));
function setup(){let presenting=false;const calls=[],c=new CommandController(fixture);c.setIOGrant('io-editor-grant');c.setAgentGrant('external-grant');
 const io=createAgentIOEditor({store:c,render:()=>calls.push('render'),updateStatus:()=>calls.push('status'),onSaved:x=>calls.push({saved:x}),onOpened:x=>calls.push({opened:x}),isPresenting:()=>presenting,present:({active,slideId})=>{presenting=active;c.setPresentation(active?{slideId:slideId||c.activeSlideId}:null);calls.push({present:active});}});
 const target=()=>{const v=c.readEditorState().value;return Object.fromEntries(['instanceId','editorSessionId','documentId'].map(k=>[k,v[k]]));};
 const context=()=>({ioGrantId:'io-editor-grant',editorSessionId:c.sessionId});
 const request=(method,params={},agentContext=context())=>io({method,params:{...(method==='ioCancelOperation'?{}:{target:target(),expectedRevision:c.revision}),...(method==='ioMarkSaved'?{}:{operationId:method+'-operation'}),...params},agentContext});
 return{c,io,calls,target,context,request,presenting:()=>presenting};
}
const stable=c=>({document:structuredClone(c.document),revision:c.revision,undo:c.undoCount,redo:c.redoCount,session:c.sessionId,dirty:c.isDirty});

test('capture exports the exact committed revision without changing author/history; saving an older capture leaves later editing dirty',async()=>{
 const{c,request,target,calls}=setup(),before=stable(c),capture=await request('ioCaptureDocument');assert.equal(capture.ok,true,JSON.stringify(capture));assert.deepEqual(stable(c),before);assert.deepEqual(parsePresentation(capture.value.html),before.document);assert.equal(typeof capture.value.captureId,'string');
 c.setTitle('나중에 편집한 제목');const title=c.document.title,history=c.undoCount;
 const marked=await request('ioMarkSaved',{target:target(),expectedRevision:capture.value.contentRevision,captureId:capture.value.captureId,name:'owned.html'});assert.equal(marked.ok,true,JSON.stringify(marked));assert.equal(marked.value.dirty,true);assert.equal(c.document.title,title);assert.equal(c.undoCount,history);assert.equal(c.isDirty,true);assert.equal(calls.filter(x=>x?.saved).length,1);
 c.undo();assert.equal(c.isDirty,false);assert.deepEqual(c.document,before.document);
});

test('saved acknowledgement requires the exact capture/revision/target/session and current IO authority',async()=>{
 for(const kind of['capture','revision','target','session','ioRevoked','externalOnly']){const s=setup();s.c.setTitle('저장할 변경');const capture=await s.request('ioCaptureDocument');const params={captureId:capture.value.captureId,expectedRevision:capture.value.contentRevision,name:'owned.html'};let ctx=s.context();
  if(kind==='capture')params.captureId='unknown';if(kind==='revision')params.expectedRevision++;if(kind==='target')params.target={...s.target(),documentId:'different'};if(kind==='session')s.c.loadDocument(fixture);if(kind==='ioRevoked')s.c.setIOGrant(null);if(kind==='externalOnly')ctx={grantId:'external-grant',editorSessionId:s.c.sessionId};
  const before=stable(s.c),r=await s.request('ioMarkSaved',params,ctx);assert.equal(r.ok,false,kind);assert.equal(r.error.mutated,false);assert.deepEqual(stable(s.c),before,kind);assert.equal(s.calls.filter(x=>x?.saved).length,0);
 }
});

test('capture/open/present reject stale revision, absent IO permission and active human drafts without flushing them',async()=>{
 for(const method of['ioCaptureDocument','ioOpenDocument','ioPresentDocument'])for(const kind of['revision','permission','busy']){const s=setup(),params=method==='ioOpenDocument'?{name:'owned.json',contents:JSON.stringify(fixture)}:method==='ioPresentDocument'?{active:true}:{};let ctx=s.context();
  if(kind==='revision')params.expectedRevision=99;if(kind==='permission')ctx={grantId:'external-grant',editorSessionId:s.c.sessionId};if(kind==='busy'){s.c.beginText('element-title-001');s.c.updateText(['미확정 한ㄱ']);s.c.setComposing(true);}
  const before=stable(s.c),draft=s.c.textSession,r=await s.request(method,params,ctx);assert.equal(r.ok,false,method+' '+kind);assert.equal(r.error.mutated,false);assert.deepEqual(stable(s.c),before);assert.equal(s.c.textSession,draft);assert.equal(s.calls.length,0);
 }
});

test('open refuses dirty or corrupt sources, and opens a clean approved source exactly once without creating Undo',async()=>{
 const s=setup(),next={...structuredClone(fixture),id:'opened-approved-document',title:'승인한 자료'};s.c.setTitle('미저장 현재 자료');let before=stable(s.c);assert.equal((await s.request('ioOpenDocument',{name:'owned.json',contents:JSON.stringify(next)})).error.code,'UNSAVED_CHANGES');assert.deepEqual(stable(s.c),before);
 s.c.undo();before=stable(s.c);const bad=await s.request('ioOpenDocument',{name:'owned.html',contents:'<html>broken</html>'});assert.equal(bad.ok,false);assert.deepEqual(stable(s.c),before);
 const opened=await s.request('ioOpenDocument',{name:'owned.json',contents:JSON.stringify(next)});assert.equal(opened.ok,true,JSON.stringify(opened));assert.equal(s.c.document.title,next.title);assert.notEqual(s.c.sessionId,before.session);assert.equal(s.c.undoCount,0);assert.equal(s.c.isDirty,false);assert.equal(s.calls.filter(x=>x?.opened).length,1);assert.equal(s.c.checkAgentGrant(s.context()).ok,false,'new session is not auto-approved');
});

test('open async byte verification rechecks cancellation, IO revocation, human edit and busy state before replacing anything',async()=>{
 for(const kind of['cancel','revoked','edit','busy']){const s=setup(),next={...structuredClone(fixture),id:'never-opened',title:'열리면 안 됨'},before=stable(s.c),operationId='open-'+kind;
  const pending=s.request('ioOpenDocument',{name:'owned.json',contents:JSON.stringify(next),operationId});
  if(kind==='cancel')assert.equal((await s.request('ioCancelOperation',{operationId})).ok,true);if(kind==='revoked')s.c.setIOGrant(null);if(kind==='edit')s.c.setTitle('사람의 새 제목');if(kind==='busy'){s.c.beginText('element-title-001');s.c.updateText(['계속 편집 중']);}
  const current=stable(s.c),draft=s.c.textSession,r=await pending;assert.equal(r.ok,false,kind);assert.equal(r.error.mutated,false);assert.deepEqual(stable(s.c),current);assert.equal(s.c.sessionId,before.session);assert.equal(s.c.textSession,draft);assert.equal(s.calls.filter(x=>x?.opened).length,0);
 }
});

test('presentation changes only transport/view state and stop is accepted while presentation itself is busy',async()=>{
 const s=setup(),before=stable(s.c),started=await s.request('ioPresentDocument',{active:true,slideId:s.c.activeSlideId});assert.equal(started.ok,true);assert.equal(s.presenting(),true);assert.deepEqual(stable(s.c),before);
 const blocked=await s.request('ioCaptureDocument');assert.equal(blocked.error.code,'EDITOR_BUSY');assert.deepEqual(stable(s.c),before);
 const stopped=await s.request('ioPresentDocument',{active:false});assert.equal(stopped.ok,true,JSON.stringify(stopped));assert.equal(s.presenting(),false);assert.deepEqual(stable(s.c),before);assert.deepEqual(s.calls.filter(x=>Object.hasOwn(x||{},'present')).map(x=>x.present),[true,false]);
});

test('private callback inventory is closed; external-only cancellation never reports an accepted IO cancellation',async()=>{
 const s=setup(),before=stable(s.c);assert.deepEqual([...IO_EDITOR_METHODS].sort(),['ioCaptureDocument','ioMarkSaved','ioOpenDocument','ioPresentDocument','ioCancelOperation'].sort());
 assert.equal((await s.request('eval',{code:'arbitrary'})).error.code,'UNKNOWN_METHOD');const r=await s.request('ioCancelOperation',{operationId:'not-allowed'},{grantId:'external-grant',editorSessionId:s.c.sessionId});assert.equal(r.ok,false);assert.equal(r.error.code,'PERMISSION_DENIED');assert.deepEqual(stable(s.c),before);assert.equal(s.calls.length,0);
});


test('private file callbacks require explicit targets and reject path/unknown/trusted option fields without effects',async()=>{
 const s=setup(),before=stable(s.c);
 for(const method of['ioCaptureDocument','ioOpenDocument','ioPresentDocument'])for(const mode of['missingTarget','unknownField','forgedContext']){
  const params={target:s.target(),expectedRevision:s.c.revision,operationId:'closed-'+mode,...(method==='ioOpenDocument'?{name:'own.json',contents:JSON.stringify(fixture)}:method==='ioPresentDocument'?{active:true}:{})};let context=s.context();
  if(mode==='missingTarget')delete params.target;if(mode==='unknownField')params.path='C:/unapproved.html';if(mode==='forgedContext')context={...context,stagedAssets:[]};
  const r=await s.io({method,params,agentContext:context});assert.equal(r.ok,false,method+' '+mode);assert.equal(r.error.mutated,false);assert.deepEqual(stable(s.c),before);assert.equal(s.calls.length,0);
 }
});


test('cancelled IDs belong to the authorized IO grant and session; a renewed scope may reuse its own operation ID',async()=>{
 for(const change of['grant','session']){const s=setup(),operationId='same-owned-operation',old=s.context();assert.equal((await s.request('ioCancelOperation',{operationId})).ok,true);if(change==='session')s.c.loadDocument(fixture);s.c.setIOGrant('renewed-scope');const current={ioGrantId:'renewed-scope',editorSessionId:s.c.sessionId};const r=await s.request('ioPresentDocument',{active:true,operationId},current);assert.equal(r.ok,true,change+' '+JSON.stringify(r));assert.equal(s.presenting(),true);assert.equal(s.c.undoCount,0);assert.equal(s.c.checkAgentGrant(old).ok,false);}
});

test('a forged old context cannot clear a new scope cancellation or reuse its previous save capture',async()=>{
 const s=setup(),old=s.context(),capture=await s.request('ioCaptureDocument');s.c.setIOGrant('new-io-scope');const current={ioGrantId:'new-io-scope',editorSessionId:s.c.sessionId},operationId='new-scope-cancelled';assert.equal((await s.request('ioCancelOperation',{operationId},current)).ok,true);
 assert.equal((await s.request('ioCancelOperation',{operationId:'forged-reset'},old)).error.code,'PERMISSION_DENIED');assert.equal((await s.request('ioPresentDocument',{active:true,operationId},current)).error.code,'CANCELLED_BEFORE_COMMIT');assert.equal((await s.request('ioMarkSaved',{captureId:capture.value.captureId,name:'old.html'},current)).error.code,'INVALID_CAPTURE');assert.equal(s.presenting(),false);assert.equal(s.c.undoCount,0);
});
