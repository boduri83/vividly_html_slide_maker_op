/** Real creation Controller/approved bytes/files, with scripted Codex decisions. No live model or IME. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {AvatarCoordinator} from '../desktop/avatar-coordinator.mjs';
import {GENERATION_COMMANDS,avatarToolsForScope,findCommands} from '../desktop/avatar-tools.mjs';
import {parseCodexDecision,CODEX_DECISION_SCHEMA} from '../desktop/codex-provider.mjs';
import {createBlankDocument} from '../src/model.js';
import {CommandController} from '../src/controller.js';
import {dispatchAgentRequest} from '../src/agent-dispatch.js';
import {createAgentIOEditor} from '../src/agent-io-editor.js';
import {ApprovedAssetBroker} from '../desktop/approved-asset-broker.mjs';
import {AgentIOService} from '../desktop/agent-io-service.mjs';
import {DesktopFileService} from '../desktop/files.mjs';
import {parsePresentation} from '../src/format.js';
import {createVividlyMcpServer} from '../desktop/mcp-tools.mjs';

const fixture=JSON.parse(await fs.readFile(new URL('../examples/document-contract-v0.1.json',import.meta.url),'utf8'));
const clone=structuredClone,ref=name=>({$ref:name}),command=(id,params)=>({id,params});
const message=text=>({type:'message',role:'assistant',content:[{type:'output_text',text}]}),hash=value=>createHash('sha256').update(value).digest('hex');
function typed(name,args){
  const proposal=['propose_commands','propose_commands_with_assets'].includes(name);
  const decision={kind:'tool',tool:name,argumentsJson:proposal?(name==='propose_commands_with_assets'?JSON.stringify({stagingIdsJson:args.stagingIdsJson}):null):JSON.stringify(args),text:null,commands:proposal?JSON.parse(args.commandsJson).map(c=>({id:c.id,paramsJson:JSON.stringify(c.params)})):null,summary:proposal?args.summary:null};
  const parsed=parseCodexDecision(JSON.stringify(decision));
  return {type:'function_call',name:parsed.tool,arguments:parsed.argumentsJson,call_id:randomUUID()};
}
const observation=request=>JSON.parse(request.input.filter(item=>item.type==='function_call_output').at(-1).output);
function scripted(steps=[]){return {steps,requests:[],async respond(request){this.requests.push(clone({...request,signal:undefined}));const next=this.steps.shift();assert.ok(next,'unexpected extra provider call');return {output:[typeof next==='function'?next(request):next]};}};}
const handle=c=>{const read=c.readEditorState().value;return Object.fromEntries(['instanceId','editorSessionId','documentId'].map(key=>[key,read[key]]));};

async function harness(t,provider,{document=createBlankDocument(),wrap=(_m,_p,next)=>next()}={}){
  const parent=await fs.realpath(os.tmpdir()),dir=await fs.mkdtemp(path.join(parent,'vividly-avatar-generation-'));
  t.after(async()=>{const real=await fs.realpath(dir);assert.equal(path.dirname(real),parent);assert.match(path.basename(real),/^vividly-avatar-generation-/);await fs.rm(real,{recursive:true,force:true,maxRetries:10,retryDelay:50});});
  const activity={value:{}},c=new CommandController(document,{activityProvider:()=>activity.value}),events=[],calls=[];
  let grant,coordinator,selected=path.join(dir,'approved.png'),presenting=false;
  const renewGrant=()=>{grant={grantId:randomUUID(),documentId:c.document.id,editorSessionId:c.sessionId};c.setIOGrant(grant.grantId);};renewGrant();
  await fs.writeFile(selected,Buffer.from(fixture.assets[0].dataBase64,'base64'));
  const dialog={async showOpenDialog(){return{canceled:false,filePaths:[selected]};},async showSaveDialog(){return{canceled:false,filePath:selected};}};
  const files=new DesktopFileService({dialog}),renderer=(method,params,agentContext)=>dispatchAgentRequest({method,params,agentContext},{store:c});
  const editor=createAgentIOEditor({store:c,render(){},updateStatus(){},isPresenting:()=>presenting,present:({active,slideId})=>{presenting=active;c.setPresentation(active?{slideId:slideId||c.activeSlideId}:null);},onOpened(){grant=null;c.setIOGrant(null);service.documentChanged();coordinator?.invalidateReplacedDocument();}});
  const broker=new ApprovedAssetBroker({getGrant:()=>grant,dispatch:renderer,chooseFile:()=>dialog.showOpenDialog(),decodeImage:async()=>({width:fixture.assets[0].width,height:fixture.assets[0].height})});
  const service=new AgentIOService({getGrant:()=>grant,dispatch:renderer,files,broker,rendererOperation:(method,params,agentContext)=>editor({method,params,agentContext})});
  const dispatch=async(method,params={})=>{calls.push({method,params:clone(params)});return wrap(method,params,()=>{
    if(['listApprovedFiles','importAsset','saveDocument','openDocument','presentDocument','readHostOperation','cancelHostOperation'].includes(method))return service.invoke(method,params);
    if(['applyCommands','previewCommands'].includes(method)&&params.stagingIds!==undefined)return broker.executeBatch({...params,...(method==='previewCommands'?{dryRun:true}:{})});
    if(['readOperation','cancelOperation'].includes(method)&&broker.ownsOperation(params))return broker[method](params);
    return renderer(method,params);
  });};
  const settings={async getPublic(){return{visible:true};},async getConnection(){return{provider:'local',model:'owned-generation-model',endpoint:'http://127.0.0.1:1/v1/responses'};},async configure(input){return{visible:input.visible??true};}};
  coordinator=new AvatarCoordinator({dispatch,getSessionId:()=>c.sessionId,settings,provider,onEvent:event=>events.push(event)});
  t.after(()=>service.close());return{c,activity,coordinator,broker,service,files,dir,events,calls,renewGrant,selected:value=>selected=value,presenting:()=>presenting};
}
function deckCommands(blankSlideId,assetId){
  const commands=[command('document.set_title',{title:'사람과 에이전트가 만드는 제안서'})];
  for(let index=0;index<3;index++){
    const slide='page-'+index;
    commands.push(command('slide.create',{clientRef:slide,name:['소개','성과','다음 단계'][index],...(index?{afterSlideId:ref('page-'+(index-1))}:{}),background:'#ffffff'}));
    commands.push(command('element.create_text',{clientRef:'title-'+index,slideId:ref(slide),geometry:{x:60,y:50,width:900,height:100},paragraphs:['한글 제안서 '+(index+1),'문자열 {"$ref":"page-0"}은 그대로'],textStyle:{fontSize:40,color:'#20314f'}}));
    commands.push(command('element.create_shape',{clientRef:'shape-'+index,slideId:ref(slide),geometry:{x:60,y:220,width:480,height:260},fill:'#4567df',name:'수정 가능한 도형'}));
    if(assetId)commands.push(command('element.create_image',{clientRef:'image-'+index,slideId:ref(slide),geometry:{x:620,y:220,width:300,height:260},assetId,fit:'contain',alt:'승인된 원본 이미지'}));
  }
  commands.push(command('slide.delete',{slideId:blankSlideId}));
  return commands;
}
async function proposeDeck(h,provider,{assets=true}={}){
  let stage;
  if(assets){assert.equal((await h.broker.chooseAsset()).ok,true);provider.steps.push(typed('list_approved_files',{}),request=>typed('import_approved_asset',{fileHandleId:observation(request).value.handles[0].fileHandleId}),request=>{stage=observation(request).value;return typed('find_commands',{query:'create',limit:5});});}
  const commands=()=>deckCommands(h.c.document.slides[0].id,stage?.assetId);
  provider.steps.push(()=>typed(assets?'propose_commands_with_assets':'propose_commands',{commandsJson:JSON.stringify(commands()),summary:'개체별로 수정 가능한 세 장 제안서',...(assets?{stagingIdsJson:JSON.stringify([stage.stagingId])}:{})}),message('세 장의 변경안을 검토해 주세요.'));
  return h.coordinator.start({scope:'document',message:'새 자료에 소개·성과·다음 단계 세 장과 수정할 수 있는 제목·도형·승인 이미지를 만들어 줘'});
}

test('creation discovery prioritizes four needed creation schemas within the five-command budget and preserves typed Codex refs',async()=>{
  const c=new CommandController(),catalog=c.readCapabilities().value.commands,bound={scope:'document'},found=findCommands(catalog,bound,'create',5);
  for(const id of['slide.create','element.create_text','element.create_shape','element.create_image'])assert.ok(found.some(command=>command.id===id),id);
  assert.equal(found.length,5);assert.equal(GENERATION_COMMANDS.size,6);assert.equal(avatarToolsForScope('document').length,11);
  const input=[command('slide.create',{clientRef:'page'}),command('element.create_text',{clientRef:'heading',slideId:ref('page'),geometry:{x:10,y:10,width:500,height:100},paragraphs:['문자열 {$ref:page}']})];
  const result=typed('propose_commands',{commandsJson:JSON.stringify(input),summary:'새 자료 생성'}),args=JSON.parse(result.arguments);
  assert.deepEqual(JSON.parse(args.commandsJson),input);assert.equal(CODEX_DECISION_SCHEMA.required.length,6);
});

test('the pinned MCP SDK accepts Unicode-length aliases and preserves prototype-looking alias keys as result data',async()=>{
  const c=new CommandController(),alias='📊'.repeat(256),read=c.readEditorState().value,request={target:handle(c),expectedRevision:read.contentRevision,operationId:randomUUID(),targeting:'id',commands:[command('slide.create',{clientRef:alias}),command('element.create_text',{clientRef:'__proto__',slideId:ref(alias),geometry:{x:20,y:20,width:400,height:80},paragraphs:['개체별 편집 가능한 제목']})]};
  const server=createVividlyMcpServer({invoke:()=>null}),tool=server._registeredTools.vividly_apply_commands;
  try{const validated=await server.validateToolInput(tool,request,'vividly_apply_commands');assert.deepEqual(validated.commands[1].params.slideId,ref(alias));const result=await c.applyCommands(validated);assert.equal(result.ok,true,JSON.stringify(result));await server.validateToolOutput(tool,{structuredContent:result},'vividly_apply_commands');const wire=JSON.parse(JSON.stringify(result));assert.equal(typeof wire.value.createdIds[alias],'string');assert.equal(Object.hasOwn(wire.value.createdIds,'__proto__'),true);assert.equal(typeof wire.value.createdIds.__proto__,'string');assert.equal(Object.getPrototypeOf(wire.value.createdIds),Object.prototype);assert.equal(c.undoCount,1);}finally{await server.close();}
});

test('a verified three-page approved-image proposal has stable IDs, one shared Undo, editable objects and a real HTML/file/presentation round trip',async t=>{
  const provider=scripted(),h=await harness(t,provider),before=clone(h.c.document),started=await proposeDeck(h,provider);
  assert.equal(started.ok,true,JSON.stringify(started));assert.equal(started.value.state,'review');assert.deepEqual(h.c.document,before);assert.equal(h.c.undoCount,0);
  const proposal=started.value.proposal,map=proposal.createdIds;assert.equal(Object.keys(map).length,12);assert.ok(proposal.preview.entries.some(entry=>entry.scope==='slide'&&entry.change==='add'));
  const preview=h.calls.find(call=>call.method==='previewCommands');assert.ok(preview);assert.equal(h.calls.some(call=>call.method==='applyCommands'),false);
  const applied=await h.coordinator.applyProposal({proposalId:proposal.proposalId});assert.equal(applied.ok,true,JSON.stringify(applied));assert.deepEqual(applied.value.receipt.createdIds,map);assert.equal(h.c.undoCount,1);assert.equal(h.c.document.slides.length,3);assert.equal(h.c.document.assets.length,1);
  assert.equal(h.calls.find(call=>call.method==='applyCommands').params.operationId,preview.params.operationId);
  for(let index=0;index<3;index++){const slide=h.c.document.slides[index];assert.equal(slide.id,map['page-'+index]);assert.deepEqual(slide.elements.map(e=>e.type),['text','shape','image']);assert.equal(slide.elements[0].text.paragraphs[1],'문자열 {"$ref":"page-0"}은 그대로');}
  const history=h.c.readHistory().value.history.undo[0];assert.ok(history.targetIds.every(id=>typeof id==='string'));assert.ok(history.commands.some(c=>c.params.slideId?.$ref==='page-0'));
  const generated=clone(h.c.document);h.c.undo();assert.deepEqual(h.c.document,before);h.c.redo();assert.deepEqual(h.c.document,generated);
  const replay=await h.coordinator.applyProposal({proposalId:proposal.proposalId});assert.equal(replay.value.receipt.replayed,true);assert.deepEqual(replay.value.receipt.createdIds,map);assert.equal(h.c.undoCount,1);
  h.c.run('text.set_content',{elementId:map['title-0'],paragraphs:['사람이 고친 한글 제목']});h.c.setFill(map['shape-1'],'#be3456');h.c.setGeometry(map['image-2'],{x:700,y:250,width:280,height:220});
  const edited=clone(h.c.document);assert.equal(h.c.undoCount,4);for(let i=0;i<3;i++)h.c.undo();assert.deepEqual(h.c.document,generated);for(let i=0;i<3;i++)h.c.redo();assert.deepEqual(h.c.document,edited);
  const destination=path.join(h.dir,'사람이-수정한-제안서.html');h.selected(destination);const savePermission=(await h.service.chooseSaveTarget()).value.permission,saved=await h.service.saveDocument({target:handle(h.c),expectedRevision:h.c.revision,operationId:randomUUID(),fileHandleId:savePermission.fileHandleId});
  assert.equal(saved.ok,true,JSON.stringify(saved));const html=await fs.readFile(destination,'utf8');assert.equal(saved.value.sha256,hash(Buffer.from(html)));assert.deepEqual(parsePresentation(html),edited);assert.equal(h.c.isDirty,false);
  const source=(await h.service.chooseOpenSource()).value.permission,old=handle(h.c),opened=await h.service.openDocument({target:old,expectedRevision:h.c.revision,operationId:randomUUID(),fileHandleId:source.fileHandleId});
  assert.equal(opened.ok,true,JSON.stringify(opened));assert.notEqual(h.c.sessionId,old.editorSessionId);assert.deepEqual(h.c.document,edited);assert.equal(h.c.undoCount,0);assert.equal((await h.service.getStatus()).value.permissions.length,0);
  h.c.run('text.set_content',{elementId:map['title-2'],paragraphs:['다시 열어 재편집한 결론']});h.c.undo();assert.deepEqual(h.c.document,edited);h.c.redo();assert.equal(h.c.document.slides[2].elements[0].text.paragraphs[0],'다시 열어 재편집한 결론');
  h.renewGrant();const permission=(await h.service.setPresentPermission({allowed:true})).value.permission,author=clone(h.c.document),undo=h.c.undoCount;
  for(const active of[true,false]){const result=await h.service.presentDocument({target:handle(h.c),expectedRevision:h.c.revision,operationId:randomUUID(),permissionId:permission.permissionId,active});assert.equal(result.ok,true,JSON.stringify(result));assert.equal(h.presenting(),active);}
  assert.deepEqual(h.c.document,author);assert.equal(h.c.undoCount,undo);assert.equal(provider.requests.length,5);
});

test('document generation reconciles a lost Apply response with the same created IDs and no second insertion',async t=>{
  let commits=0;const provider=scripted(),h=await harness(t,provider,{wrap:async(method,params,next)=>{const result=await next();if(method==='applyCommands'&&!params.dryRun&&result.ok){commits++;throw Error('owned post-commit response loss');}return result;}}),started=await proposeDeck(h,provider,{assets:false});
  assert.equal(started.ok,true,JSON.stringify(started));const map=started.value.proposal.createdIds,unknown=await h.coordinator.applyProposal({proposalId:started.value.proposal.proposalId});assert.equal(unknown.error.outcomeUnknown,true);assert.equal(h.c.document.slides.length,3);assert.equal(h.c.undoCount,1);
  const known=await h.coordinator.applyProposal({proposalId:started.value.proposal.proposalId});assert.equal(known.ok,true,JSON.stringify(known));assert.equal(known.value.receipt.replayed,true);assert.deepEqual(known.value.receipt.createdIds,map);assert.equal(commits,1);assert.equal(h.c.undoCount,1);
});

test('reviewed creation IDs survive harmless JSON key reordering accepted by the proposal fingerprint',async t=>{
  const provider=scripted(),h=await harness(t,provider),started=await proposeDeck(h,provider,{assets:false});assert.equal(started.ok,true);
  const proposal=h.coordinator.proposal,map=clone(started.value.proposal.createdIds);
  proposal.request.target=Object.fromEntries(Object.entries(proposal.request.target).reverse());
  proposal.request.commands=proposal.request.commands.map(c=>({id:c.id,params:Object.fromEntries(Object.entries(c.params).reverse())}));
  const result=await h.coordinator.applyProposal({proposalId:started.value.proposal.proposalId});assert.equal(result.ok,true,JSON.stringify(result));assert.deepEqual(result.value.receipt.createdIds,map);assert.equal(h.c.document.slides[0].id,map['page-0']);assert.equal(h.c.undoCount,1);
});

test('creation and duplication preserve an active human draft; retrying the same reviewed batch remains one shared Undo',async t=>{
  const provider=scripted(),h=await harness(t,provider),started=await proposeDeck(h,provider,{assets:false});assert.equal(started.ok,true);assert.equal((await h.coordinator.applyProposal({proposalId:started.value.proposal.proposalId})).ok,true);
  const map=started.value.proposal.createdIds,generated=clone(h.c.document),commands=[command('slide.duplicate',{clientRef:'copy-page',slideId:map['page-0'],name:'사람과 수정할 복제 장'}),command('element.duplicate',{clientRef:'copy-title',elementId:map['title-0'],slideId:ref('copy-page'),offsetX:60,offsetY:160})];
  provider.steps.push(typed('propose_commands',{commandsJson:JSON.stringify(commands),summary:'수정 가능한 복제 페이지와 제목'}),message('복제를 검토해 주세요.'));
  const duplication=await h.coordinator.start({scope:'document',message:'첫 페이지와 제목을 복제해 줘'});assert.equal(duplication.ok,true,JSON.stringify(duplication));h.c.beginText(map['title-0']);h.c.updateText(['사람이 편집 중인 미확정 문장']);const draft=h.c.textSession;
  const busy=await h.coordinator.applyProposal({proposalId:duplication.value.proposal.proposalId});assert.equal(busy.ok,false);assert.equal(busy.error.code,'EDITOR_BUSY');assert.equal(h.c.textSession,draft);assert.deepEqual(h.c.readCommittedSnapshot().value.document,generated);assert.equal(h.c.undoCount,1);
  h.c.updateText(clone(draft.beforeText.paragraphs));h.c.finishText();assert.equal(h.c.textSession,null);const applied=await h.coordinator.applyProposal({proposalId:duplication.value.proposal.proposalId});assert.equal(applied.ok,true,JSON.stringify(applied));assert.deepEqual(applied.value.receipt.createdIds,duplication.value.proposal.createdIds);assert.equal(h.c.undoCount,2);assert.equal(h.c.document.slides.length,4);
  const clonePage=h.c.document.slides.find(s=>s.id===applied.value.receipt.createdIds['copy-page']);assert.ok(clonePage.elements.some(e=>e.id===applied.value.receipt.createdIds['copy-title']));h.c.undo();assert.deepEqual(h.c.document,generated);h.c.redo();assert.equal(h.c.document.slides.length,4);
});

test('generation scopes, late invalid refs and human changes reject before any partial creation',async t=>{
  for(const scope of['selection','slide']){const provider=scripted([typed('propose_commands',{commandsJson:JSON.stringify([command('slide.create',{clientRef:'outside'})]),summary:'범위 밖 생성'}),message('요청 실패')]),h=await harness(t,provider,{document:fixture});h.c.selectElements([fixture.slides[0].elements[0].id]);const before=clone(h.c.document),result=await h.coordinator.start({scope,message:'자료를 새로 만들어 줘'});assert.equal(result.ok,false);assert.equal(result.error.code,'SCOPE_VIOLATION');assert.deepEqual(h.c.document,before);assert.equal(h.c.undoCount,0);}
  const provider=scripted(),h=await harness(t,provider),before=clone(h.c.document),commands=deckCommands(h.c.activeSlideId);commands.push(command('element.set_geometry',{elementId:ref('never-created'),geometry:{x:300}}));provider.steps.push(typed('propose_commands',{commandsJson:JSON.stringify(commands),summary:'전체 실패 검증'}),message('실패했습니다.'));const failed=await h.coordinator.start({scope:'document',message:'세 장 생성'});assert.equal(failed.ok,false);assert.equal(failed.error.mutated,false);assert.deepEqual(h.c.document,before);assert.equal(h.c.undoCount,0);
  const started=await proposeDeck(h,provider,{assets:false});assert.equal(started.ok,true);h.c.setTitle('사람이 먼저 바꾼 제목');const human=clone(h.c.document),applied=await h.coordinator.applyProposal({proposalId:started.value.proposal.proposalId});assert.equal(applied.ok,false);assert.equal(applied.error.code,'REVISION_CONFLICT');assert.deepEqual(h.c.document,human);assert.equal(h.c.undoCount,1);
});
