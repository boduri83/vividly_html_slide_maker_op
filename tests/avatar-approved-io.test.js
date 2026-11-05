/** Real Controller + approval broker + file service; scripted model decisions, no model inference/native picker. */
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {AvatarCoordinator} from '../desktop/avatar-coordinator.mjs';import {AVATAR_TOOLS,avatarToolsForScope} from '../desktop/avatar-tools.mjs';
import {parseCodexDecision} from '../desktop/codex-provider.mjs';import {DesktopFileService} from '../desktop/files.mjs';
import {ApprovedAssetBroker} from '../desktop/approved-asset-broker.mjs';import {AgentIOService} from '../desktop/agent-io-service.mjs';
import {CommandController} from '../src/controller.js';import {dispatchAgentRequest} from '../src/agent-dispatch.js';
import {createAgentIOEditor} from '../src/agent-io-editor.js';import {parsePresentation} from '../src/format.js';
const fixture=JSON.parse(await fs.readFile(new URL('../examples/document-contract-v0.1.json',import.meta.url),'utf8'));
const message=text=>({type:'message',role:'assistant',content:[{type:'output_text',text}]}),clone=structuredClone;
function typed(name,args){const proposal=['propose_commands','propose_commands_with_assets'].includes(name),wire={kind:'tool',tool:name,argumentsJson:proposal?(name==='propose_commands_with_assets'?JSON.stringify({stagingIdsJson:args.stagingIdsJson}):null):JSON.stringify(args),text:null,commands:proposal?JSON.parse(args.commandsJson).map(c=>({id:c.id,paramsJson:JSON.stringify(c.params)})):null,summary:proposal?args.summary:null};const parsed=parseCodexDecision(JSON.stringify(wire));return{type:'function_call',name:parsed.tool,arguments:parsed.argumentsJson,call_id:'scripted-'+crypto.randomUUID()};}
function scripted(steps){const requests=[];return{requests,async respond(request){requests.push(clone({...request,signal:undefined}));const step=steps.shift();assert.ok(step,'unexpected extra model decision');return{output:[typeof step==='function'?step(request):step]};}};}
const observation=request=>JSON.parse(request.input.filter(x=>x.type==='function_call_output').at(-1).output);
async function setup(t,provider,{dispatchWrap=(_m,_p,next)=>next()}={}){
 const parent=await fs.realpath(os.tmpdir()),dir=await fs.mkdtemp(path.join(parent,'vividly-avatar-io-'));t.after(async()=>{const real=await fs.realpath(dir);assert.equal(path.dirname(real),parent);assert.match(path.basename(real),/^vividly-avatar-io-/);await fs.rm(real,{recursive:true,force:true,maxRetries:10,retryDelay:50});});
 const c=new CommandController(fixture),events=[],calls=[];let coordinator,grant={grantId:'independent-io-grant',documentId:c.document.id,editorSessionId:c.sessionId},selected=path.join(dir,'approved.png'),presenting=false;c.setIOGrant(grant.grantId);
 await fs.writeFile(selected,Buffer.from(fixture.assets[0].dataBase64,'base64'));
 const dialog={async showOpenDialog(){return{canceled:false,filePaths:[selected]};},async showSaveDialog(){return{canceled:false,filePath:selected};}},files=new DesktopFileService({dialog});
 const rendererDispatch=(method,params,context)=>dispatchAgentRequest({method,params,agentContext:context},{store:c});
 const editor=createAgentIOEditor({store:c,render(){},updateStatus(){},isPresenting:()=>presenting,present:({active,slideId})=>{presenting=active;c.setPresentation(active?{slideId:slideId||c.activeSlideId}:null);},onOpened(){grant=null;c.setIOGrant(null);service.documentChanged();coordinator?.invalidateReplacedDocument();}});
 const broker=new ApprovedAssetBroker({getGrant:()=>grant,dispatch:rendererDispatch,chooseFile:()=>dialog.showOpenDialog(),decodeImage:async()=>({width:fixture.assets[0].width,height:fixture.assets[0].height})});
 const service=new AgentIOService({getGrant:()=>grant,dispatch:rendererDispatch,files,broker,rendererOperation:(method,params,agentContext)=>editor({method,params,agentContext})});
 const dispatch=async(method,params={})=>{calls.push({method,params:clone(params)});return dispatchWrap(method,params,()=>{
  if(['listApprovedFiles','importAsset','saveDocument','openDocument','presentDocument','readHostOperation','cancelHostOperation'].includes(method))return service.invoke(method,params);
  if(['applyCommands','previewCommands'].includes(method)&&params.stagingIds!==undefined)return broker.executeBatch({...params,...(method==='previewCommands'?{dryRun:true}:{})});
  if(['readOperation','cancelOperation'].includes(method)&&broker.ownsOperation(params))return broker[method](params);
  return rendererDispatch(method,params);
 });};
 const settings={async getPublic(){return{visible:true};},async getConnection(){return{provider:'local',model:'owned-scripted-model',endpoint:'http://127.0.0.1:1/v1/responses'};},async configure(input){return{visible:input.visible??true};}};
 coordinator=new AvatarCoordinator({dispatch,getSessionId:()=>c.sessionId,settings,provider,onEvent:e=>events.push(e)});
 t.after(()=>service.close());return{c,coordinator,broker,service,files,dir,events,calls,selected:value=>selected=value,presenting:()=>presenting};
}

test('document-scope approved PNG decisions use verified preview, identical Apply, one shared Undo and no public payload',async t=>{
 let imported;const provider=scripted([
  typed('list_approved_files',{}),
  request=>typed('import_approved_asset',{fileHandleId:observation(request).value.handles[0].fileHandleId}),
  request=>{imported=observation(request).value;return typed('find_commands',{query:'elements.insert',limit:1});},
  ()=>typed('propose_commands_with_assets',{commandsJson:JSON.stringify([{id:'elements.insert',params:{slideId:fixture.slides[0].id,elements:[{id:'avatar-approved-image',type:'image',assetId:imported.assetId,geometry:{x:50,y:60,width:300,height:180},fit:'contain',alt:'승인 이미지'}],assets:[]}}]),summary:'승인한 이미지를 추가합니다.',stagingIdsJson:JSON.stringify([imported.stagingId])}),message('이미지 변경안을 검토하세요.')
 ]),h=await setup(t,provider),approved=await h.broker.chooseAsset();assert.equal(approved.ok,true);const before=clone(h.c.document),result=await h.coordinator.start({scope:'document',message:'승인한 PNG로 이미지를 추가해 줘'});
 assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.value.state,'review');assert.equal(result.value.proposal.stagedAssetCount,1);assert.ok(result.value.proposal.preview.entries.some(e=>e.id==='avatar-approved-image'));assert.deepEqual(h.c.document,before);assert.equal(h.c.undoCount,0);
 const applied=await h.coordinator.applyProposal({proposalId:result.value.proposal.proposalId});assert.equal(applied.ok,true,JSON.stringify(applied));assert.equal(h.c.undoCount,1);assert.equal(h.c.document.slides[0].elements.find(e=>e.id==='avatar-approved-image').assetId,imported.assetId);assert.equal(h.c.document.assets.filter(a=>a.id===imported.assetId).length,1);
 assert.equal((await h.coordinator.applyProposal({proposalId:result.value.proposal.proposalId})).value.receipt.replayed,true);assert.equal(h.c.undoCount,1);assert.equal((await h.coordinator.undoLast({})).ok,true);assert.deepEqual(h.c.document,before);
 for(const data of[provider.requests,h.events,h.calls]){const text=JSON.stringify(data);assert.equal(text.includes(fixture.assets[0].dataBase64),false);assert.equal(text.includes(h.dir),false);}
});

test('IO tools remain outside selection/slide scope and model targets/paths/operation IDs are rejected',async t=>{
 assert.equal(AVATAR_TOOLS.length,11);for(const scope of['selection','slide'])assert.equal(avatarToolsForScope(scope).length,5);
 const provider=scripted([typed('list_approved_files',{}),message('권한이 없습니다.')]),h=await setup(t,provider);h.c.selectElements(['element-title-001']);const result=await h.coordinator.start({scope:'selection',message:'승인 목록을 읽어 줘'});assert.equal(result.ok,false);assert.equal(result.error.code,'SCOPE_VIOLATION');assert.equal(provider.requests[0].tools.length,5);assert.equal(h.calls.some(c=>c.method==='listApprovedFiles'),false);assert.equal(h.c.undoCount,0);
 for(const name of['import_approved_asset','save_approved_document','open_approved_document'])assert.throws(()=>typed(name,{fileHandleId:'opaque',target:{},path:'C:/forged',operationId:'model-chosen'}),{code:'CODEX_DECISION'});
});

test('saving with a pending proposal writes current committed content and uses an app-assigned target/revision/operation ID',async t=>{
 let fileHandleId;const commands=[{id:'document.set_title',params:{title:'검토 중인 제목'}}],provider=scripted([typed('propose_commands',{commandsJson:JSON.stringify(commands),summary:'제목 변경 검토'}),()=>typed('save_approved_document',{fileHandleId}),message('현재 확정 자료를 저장했고 변경안은 검토를 기다립니다.')]),h=await setup(t,provider);const destination=path.join(h.dir,'approved-save.html');h.selected(destination);fileHandleId=(await h.service.chooseSaveTarget()).value.permission.fileHandleId;
 const started=await h.coordinator.start({scope:'document',message:'제목 변경안을 만들고 현재 확정 자료를 저장해 줘'});assert.equal(started.ok,true,JSON.stringify(started));assert.equal(started.value.state,'review');assert.equal(h.c.document.title,fixture.title);assert.equal(h.c.undoCount,0);assert.equal(parsePresentation(await fs.readFile(destination,'utf8')).title,fixture.title);
 const save=h.calls.find(c=>c.method==='saveDocument');assert.equal(save.params.target.editorSessionId,h.c.sessionId);assert.equal(save.params.expectedRevision,0);assert.match(save.params.operationId,/^[a-f0-9-]{36}$/);assert.equal(h.events.find(e=>e.type==='hostReceipt').receipt.kind,'save');
 assert.equal((await h.coordinator.applyProposal({proposalId:started.value.proposal.proposalId})).ok,true);assert.equal(h.c.document.title,'검토 중인 제목');assert.equal(h.c.undoCount,1);assert.equal(h.c.isDirty,true);
});

test('successful approved open survives its own document invalidation, emits a known receipt and terminates without a new-document tool call',async t=>{
 let fileHandleId;const provider=scripted([()=>typed('open_approved_document',{fileHandleId})]),h=await setup(t,provider),source=path.join(h.dir,'approved-source.json');await fs.writeFile(source,JSON.stringify({...fixture,id:'opened-avatar-document',title:'승인한 새 자료'}));h.selected(source);fileHandleId=(await h.service.chooseOpenSource()).value.permission.fileHandleId;const previous=h.c.sessionId;
 const result=await h.coordinator.start({scope:'document',message:'승인한 자료를 열어 줘'});assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.value.state,'done');assert.equal(result.value.hostReceipt.kind,'open');assert.equal(result.value.hostReceipt.state,'committed');assert.notEqual(h.c.sessionId,previous);assert.equal(h.c.document.id,'opened-avatar-document');assert.equal(h.c.undoCount,0);assert.equal(provider.requests.length,1);assert.equal(h.coordinator.conversation.pairs.length,0);assert.equal((await h.coordinator.getStatus()).value.state,'done');
 assert.equal(h.c.checkAgentGrant({ioGrantId:'independent-io-grant',editorSessionId:h.c.sessionId}).ok,false);assert.equal(h.calls.filter(c=>c.method==='openDocument').length,1);
});

test('start and stop presentation are successful terminal decisions and leave author state/history unchanged',async t=>{
 let permissionId,active=true;const provider=scripted([()=>typed('present_approved_document',{permissionId,active,slideId:''}),()=>typed('present_approved_document',{permissionId,active,slideId:''})]),h=await setup(t,provider);permissionId=(await h.service.setPresentPermission({allowed:true})).value.permission.permissionId;const before=clone(h.c.document);
 const started=await h.coordinator.start({scope:'document',message:'발표를 시작해 줘'});assert.equal(started.ok,true,JSON.stringify(started));assert.equal(started.value.state,'done');assert.equal(h.presenting(),true);assert.equal(provider.requests.length,1);
 active=false;const stopped=await h.coordinator.start({scope:'document',message:'발표를 중지해 줘'});assert.equal(stopped.ok,true,JSON.stringify(stopped));assert.equal(stopped.value.state,'done');assert.equal(h.presenting(),false);assert.equal(provider.requests.length,2);assert.deepEqual(h.c.document,before);assert.equal(h.c.undoCount,0);assert.equal(h.c.revision,0);
});

test('unknown host outcomes survive cancel and Off until the same authoritative receipt confirms completion; no second save is sent',async t=>{
 let fileHandleId,saves=0;const provider=scripted([()=>typed('save_approved_document',{fileHandleId}),message('확인이 필요합니다.')]),h=await setup(t,provider,{dispatchWrap:async(method,_params,next)=>{const result=await next();if(method==='saveDocument'){saves++;throw Error('owned lost known save response');}return result;}});h.selected(path.join(h.dir,'unknown-save.html'));fileHandleId=(await h.service.chooseSaveTarget()).value.permission.fileHandleId;
 const result=await h.coordinator.start({scope:'document',message:'현재 자료를 저장해 줘'});assert.equal(result.ok,false);assert.equal(result.error.outcomeUnknown,true);assert.equal(h.coordinator.hasUnknownOutcome(),true);await h.coordinator.cancel({});await h.coordinator.setEnabled({enabled:false});assert.equal(h.coordinator.hasUnknownOutcome(),true);
 const status=await h.coordinator.getStatus();assert.equal(status.ok,true);assert.equal(h.coordinator.hasUnknownOutcome(),false);assert.equal(status.value.lastHostReceipt.kind,'save');assert.equal(status.value.lastHostReceipt.state,'committed');assert.equal(saves,1);assert.equal(h.c.undoCount,0);
});

test('losing an open reply after document replacement stays unknown and never resumes tools against the new document',async t=>{
 let fileHandleId,opens=0;const provider=scripted([()=>typed('open_approved_document',{fileHandleId})]),h=await setup(t,provider,{dispatchWrap:async(method,_params,next)=>{const result=await next();if(method==='openDocument'){opens++;throw Error('owned reply lost after open');}return result;}}),source=path.join(h.dir,'lost-open.json');
 await fs.writeFile(source,JSON.stringify({...fixture,id:'already-opened-unknown'}));h.selected(source);fileHandleId=(await h.service.chooseOpenSource()).value.permission.fileHandleId;
 const result=await h.coordinator.start({scope:'document',message:'승인한 자료를 열어 줘'});assert.equal(result.ok,false);assert.equal(result.error.outcomeUnknown,true);assert.equal(h.c.document.id,'already-opened-unknown');assert.equal(h.coordinator.hasUnknownOutcome(),true);assert.equal(provider.requests.length,1);await h.coordinator.cancel({});const status=await h.coordinator.getStatus();assert.equal(status.value.outcomeUnknown,true);assert.equal(opens,1);assert.equal(h.c.undoCount,0);
});

test('revoking approved IO after asset review prevents Apply without consuming author history or silently restaging',async t=>{
 let stage;const provider=scripted([()=>typed('propose_commands_with_assets',{commandsJson:JSON.stringify([{id:'elements.insert',params:{slideId:fixture.slides[0].id,elements:[{id:'revoked-avatar-image',type:'image',assetId:stage.assetId,geometry:{x:20,y:20,width:100,height:100},fit:'contain',alt:''}],assets:[]}}]),summary:'승인 이미지 검토',stagingIdsJson:JSON.stringify([stage.stagingId])}),message('적용 전 검토하세요.')]),h=await setup(t,provider);
 const approved=await h.broker.chooseAsset();stage=(await h.broker.importAsset({fileHandleId:approved.value.handle.fileHandleId})).value;const before=clone(h.c.document),proposal=await h.coordinator.start({scope:'document',message:'이미지를 추가해 줘'});assert.equal(proposal.ok,true);h.c.setIOGrant(null);
 const applied=await h.coordinator.applyProposal({proposalId:proposal.value.proposal.proposalId});assert.equal(applied.ok,false);assert.equal(applied.error.code,'PERMISSION_DENIED');assert.deepEqual(h.c.document,before);assert.equal(h.c.undoCount,0);assert.equal(h.calls.filter(c=>c.method==='importAsset').length,0);
});

test('known cancellation or commit after cancel/Off replaces the temporary unknown state with an accurate terminal status',async t=>{
 for(const known of ['cancelled-before-commit','committed']){
  let permissionId,entered,release;const began=new Promise(r=>entered=r),gate=new Promise(r=>release=r),provider=scripted([()=>typed('present_approved_document',{permissionId,active:true,slideId:''})]);
  const h=await setup(t,provider,{dispatchWrap:async(method,_params,next)=>{if(method!=='presentDocument')return next();entered();await gate;return known==='committed'?next():{ok:false,error:{code:'CANCELLED_BEFORE_COMMIT',message:'확정 전 취소',mutated:false}};}});permissionId=(await h.service.setPresentPermission({allowed:true})).value.permission.permissionId;
  const pending=h.coordinator.start({scope:'document',message:'승인한 발표를 시작해 줘'});await began;
  if(known==='committed')await h.coordinator.cancel({});else await h.coordinator.setEnabled({enabled:false});assert.equal(h.coordinator.state,'outcomeUnknown');release();await pending;
  const status=await h.coordinator.getStatus();assert.equal(status.value.state,known==='committed'?'cancelled':'off');assert.equal(h.coordinator.hasUnknownOutcome(),false);assert.equal(status.value.lastHostReceipt.state,known);assert.equal(h.c.undoCount,0);
  const final=h.events.filter(e=>e.type==='status').at(-1);assert.match(final.message,known==='committed'?/중단 전에.*반영됐습니다/:/반영되지 않았습니다/);
 }
});
