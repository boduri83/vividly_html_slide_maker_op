/** Production approved-asset Controller integration; no live editor or native dialog. */
import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs/promises';import{createHash}from'node:crypto';
import{exportPresentation,parsePresentation,validateAssetBytes}from'../src/format.js';
import{CommandController}from'../src/controller.js';import{dispatchAgentRequest}from'../src/agent-dispatch.js';import{canonicalBase64}from'../src/safe-base64.js';import{freezeStagedAssets,TRUSTED_ASSET_LIMITS}from'../src/trusted-assets.js';
const fixture=JSON.parse(await fs.readFile(new URL('../examples/document-contract-v0.1.json',import.meta.url),'utf8'));
const setup=options=>{const c=new CommandController(fixture,{agentPreparationGate:()=>Promise.resolve(),...options});c.setAgentGrant('asset-grant');c.setIOGrant('io-grant');return c;};
const handle=c=>{const v=c.readProjection().value;return{instanceId:v.instanceId,editorSessionId:v.editorSessionId,documentId:v.documentId};};
const staged=(id='approved-png')=>[{asset:{...fixture.assets[0],id}}],context=(c,entries)=>({grantId:'asset-grant',ioGrantId:'io-grant',editorSessionId:c.editorSessionId,stagedAssets:entries});
const image=(c,assetId='approved-png',elementId='approved-image')=>({id:'elements.insert',params:{slideId:c.activeSlideId,elements:[{id:elementId,type:'image',assetId,geometry:{x:100,y:100,width:512,height:288},fit:'contain',alt:'사람이 승인한 PNG'}],assets:[]}});
const request=(c,commands=[image(c)],operationId='asset-batch')=>({target:handle(c),expectedRevision:c.revision,operationId,targeting:'id',commands});
const invoke=(c,input,entries)=>dispatchAgentRequest({method:'applyCommands',params:input,agentContext:context(c,entries)},{store:c});
function gate(){let entered,release;return{entered:new Promise(r=>entered=r),wait(){entered();return new Promise(r=>release=r);},release(){release();}};}
const table=Array.from({length:256},(_,n)=>{for(let j=0;j<8;j++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;}),crc=bytes=>{let n=0xffffffff;for(const byte of bytes)n=table[(n^byte)&255]^(n>>>8);return(n^0xffffffff)>>>0;};
function paddedPng(length){const base=Buffer.from(fixture.assets[0].dataBase64,'base64'),data=Buffer.alloc(length-base.length-12,97);Buffer.from('padding\0').copy(data);const chunk=Buffer.alloc(12+data.length);chunk.writeUInt32BE(data.length);chunk.write('tEXt',4,'ascii');data.copy(chunk,8);chunk.writeUInt32BE(crc(chunk.subarray(4,-4)),chunk.length-4);const bytes=Buffer.concat([base.subarray(0,-12),chunk,base.subarray(-12)]);assert.equal(bytes.length,length);return{...fixture.assets[0],id:'full-size-approved-png',bytes:bytes.length,dataBase64:bytes.toString('base64'),sha256:createHash('sha256').update(bytes).digest('hex')};}

test('trusted approved PNG plus ordinary typed commands form one exact atomic batch and one shared Undo/Redo',async()=>{
  const c=setup(),before=structuredClone(c.document),entries=staged(),commands=[image(c),{id:'element.set_geometry',params:{elementId:'approved-image',geometry:{x:333}}},{id:'document.set_title',params:{title:'이미지와 제목을 한 번에'}}];
  const r=await invoke(c,request(c,commands),entries);assert.equal(r.ok,true,JSON.stringify(r));assert.equal(c.revision,1);assert.equal(c.undoCount,1);assert.equal(c.document.assets.length,before.assets.length+1);assert.equal(c.document.slides[0].elements.find(e=>e.id==='approved-image').geometry.x,333);assert.equal(c.document.assets.at(-1).dataBase64,entries[0].asset.dataBase64);
  c.undo();assert.deepEqual(c.document,before);c.redo();assert.equal(c.document.title,'이미지와 제목을 한 번에');assert.equal(c.document.assets.at(-1).id,'approved-png');
});
test('dryRun and late command failure never add staged assets, revision or history',async()=>{
  const c=setup(),before=structuredClone(c.document),entries=staged();const preview=await dispatchAgentRequest({method:'previewCommands',params:request(c),agentContext:context(c,entries)},{store:c});assert.equal(preview.ok,true,JSON.stringify(preview));assert.equal(preview.value.summary.addedAssetIds[0],'approved-png');assert.deepEqual(c.document,before);assert.equal(c.undoCount,0);
  const failed=await invoke(c,request(c,[image(c),{id:'element.set_geometry',params:{elementId:'missing-object',geometry:{x:2}}}],'late-failure'),entries);assert.equal(failed.ok,false);assert.equal(failed.error.mutated,false);assert.deepEqual(c.document,before);assert.equal(c.revision,0);assert.equal(c.undoCount,0);
});
test('raw public asset bytes, public trusted fields, missing authority and unused staged payloads are rejected',async()=>{
  for(const mode of['raw','public','authority','unused']){const c=setup(),before=structuredClone(c.document),entries=staged();let req=request(c),r;
    if(mode==='raw'){req.commands[0].params.assets=[entries[0].asset];r=await invoke(c,req,[]);assert.equal(r.error.code,'PUBLIC_ASSET_BYTES_FORBIDDEN');}
    if(mode==='public'){req.stagedAssets=entries;r=await invoke(c,req,entries);assert.equal(r.error.code,'INVALID_REQUEST');}
    if(mode==='authority'){r=await c.applyCommands(req,{stagedAssets:entries});assert.equal(r.error.code,'PERMISSION_DENIED');}
    if(mode==='unused'){r=await invoke(c,request(c,[{id:'document.set_title',params:{title:'쓰지 않는 자산'}}]),entries);assert.equal(r.error.code,'UNUSED_STAGED_ASSET');}
    assert.equal(r.ok,false);assert.deepEqual(c.document,before);assert.equal(c.undoCount,0);
  }
});
test('stage metadata/hash/header/collision/accessors cannot change author state',async()=>{
  for(const kind of['hash','width','mime','collision','getter','duplicates']){const c=setup(),before=structuredClone(c.document),entries=staged();
    if(kind==='hash')entries[0].asset.sha256='0'.repeat(64);if(kind==='width')entries[0].asset.width++;if(kind==='mime')entries[0].asset.mimeType='image/svg+xml';if(kind==='collision'){entries[0].asset.id=fixture.assets[0].id;entries[0].asset.sha256='0'.repeat(64);}if(kind==='getter'){Object.defineProperty(entries[0],'asset',{enumerable:true,get(){throw Error('must not access');}});}if(kind==='duplicates')entries.push(entries[0]);
    const r=await invoke(c,request(c),entries);assert.equal(r.ok,false,kind);assert.equal(r.error.mutated,false);assert.deepEqual(c.document,before);assert.equal(c.undoCount,0);
  }
});
test('a same-ID replay requires the identical trusted manifest and makes no second asset/history entry',async()=>{
  const c=setup(),entries=staged(),req=request(c),first=await invoke(c,req,entries);assert.equal(first.ok,true);const again=await invoke(c,req,entries);assert.equal(again.receipt.replayed,true);assert.equal(again.value.undoEntryId,first.value.undoEntryId);assert.equal(c.undoCount,1);assert.equal(c.document.assets.length,2);
  const changed=staged();changed[0].asset.sha256='0'.repeat(64);assert.equal((await invoke(c,req,changed)).error.code,'OPERATION_CONFLICT');assert.equal((await invoke(c,req,[])).error.code,'OPERATION_CONFLICT');assert.equal(c.undoCount,1);
});
test('CAS/busy/grant/cancel are checked again after detached asset preparation',async()=>{
  for(const mode of['cas','busy','grant','cancel']){const g=gate(),c=setup({agentPreparationGate:g.wait}),before=structuredClone(c.document),entries=staged(),req=request(c,undefined,mode),pending=invoke(c,req,entries);await g.entered;
    if(mode==='cas')c.setTitle('더 최신인 사람 제목');if(mode==='busy'){c.beginText('element-title-001');c.updateText(['미확정 한ㄱ']);c.setComposing(true);}if(mode==='grant')c.setAgentGrant('different-grant');if(mode==='cancel')assert.equal(c.cancelOperation({target:handle(c),operationId:mode},{grantId:'asset-grant'}).value.cancelRequested,true);
    g.release();const r=await pending;assert.equal(r.ok,false,mode);assert.equal(r.error.mutated,false);assert.equal(c.document.assets.length,before.assets.length);assert.equal(c.document.slides[0].elements.length,before.slides[0].elements.length);if(mode==='cas')assert.equal(c.document.title,'더 최신인 사람 제목');else assert.deepEqual(c.document,before);if(mode==='busy')assert.equal(c.textSession.composing,true);
  }
});
test('host payload limits are separate from the unchanged public 256KiB command limit',async()=>{
  const c=setup(),entries=staged();entries[0].asset.bytes=TRUSTED_ASSET_LIMITS.perAsset+1;assert.throws(()=>freezeStagedAssets(entries));const capped=Array.from({length:9},(_,i)=>staged('a-'+i)[0]);assert.throws(()=>freezeStagedAssets(capped));
  const raw=request(c,[image(c)]);raw.commands[0].params.assets=[{...fixture.assets[0],dataBase64:'AAAA'.repeat(100000),bytes:300000}];const r=await c.applyCommands(raw);assert.equal(r.error.code,'LIMIT_EXCEEDED');assert.equal(c.undoCount,0);
  for(const value of['AA==','AAA=','AAAA'])assert.equal(canonicalBase64(value),true);for(const value of['AB==','AAB=','AA=A','====','', 'AAAA\n'])assert.equal(canonicalBase64(value),false);
});
test('an exact 20MiB original PNG crosses the trusted seam outside public limits with dryRun, one commit, replay and shared Undo',async()=>{
  const c=setup(),asset=paddedPng(TRUSTED_ASSET_LIMITS.perAsset),entries=[{asset}],req=request(c,[image(c,asset.id,'full-size-image')],'full-size-asset'),before=structuredClone(c.document);
  assert.ok(Buffer.byteLength(JSON.stringify(req))<2048);assert.ok(asset.dataBase64.length>26*1024*1024);
  const dry=await dispatchAgentRequest({method:'previewCommands',params:{...req,operationId:'full-size-preview'},agentContext:context(c,entries)},{store:c});assert.equal(dry.ok,true,JSON.stringify(dry));assert.deepEqual(c.document,before);assert.equal(c.undoCount,0);assert.doesNotMatch(JSON.stringify(dry),/dataBase64/);
  const applied=await invoke(c,req,entries);assert.equal(applied.ok,true,JSON.stringify(applied));assert.equal(c.document.assets.at(-1).bytes,20*1024*1024);assert.equal(c.document.assets.at(-1).dataBase64,asset.dataBase64);assert.equal(c.undoCount,1);assert.equal((await invoke(c,req,entries)).receipt.replayed,true);assert.equal(c.undoCount,1);assert.doesNotMatch(JSON.stringify(applied),/dataBase64/);
  const saved=exportPresentation(c.document),reopened=await validateAssetBytes(parsePresentation(saved));assert.deepEqual(reopened,c.document);const original=Buffer.from(asset.dataBase64,'base64'),recovered=Buffer.from(reopened.assets.find(a=>a.id===asset.id).dataBase64,'base64');assert.deepEqual(recovered,original);assert.equal(createHash('sha256').update(recovered).digest('hex'),asset.sha256);assert.equal(reopened.assets.filter(a=>a.id===asset.id).length,1);assert.equal(reopened.slides[0].elements.find(e=>e.id==='full-size-image').assetId,asset.id);assert.equal(c.undoCount,1);
  c.undo();assert.deepEqual(c.document,before);c.redo();assert.equal(c.document.assets.at(-1).sha256,asset.sha256);assert.equal(c.document.slides[0].elements.at(-1).assetId,asset.id);
});


test('IO-only approved insertion works with external MCP disabled and retains an independent operation ledger',async()=>{
  const c=setup(),entries=staged(),external=request(c,[{id:'document.set_title',params:{title:'외부 연결 이력'}}],'independent-op');
  const prior=await c.invokeOperation('applyCommands',external,{grantId:'asset-grant'});assert.equal(prior.ok,true);
  c.setAgentGrant(null);
  const req=request(c,undefined,'independent-op'),io={ioGrantId:'io-grant',editorSessionId:c.editorSessionId,stagedAssets:entries};
  const applied=await dispatchAgentRequest({method:'applyCommands',params:req,agentContext:io},{store:c});assert.equal(applied.ok,true,JSON.stringify(applied));assert.equal(c.undoCount,2);
  assert.equal(c.readOperation({target:handle(c),operationId:req.operationId},{ioGrantId:'io-grant'}).value.state,'committed');
  assert.equal(c.readOperation({target:handle(c),operationId:external.operationId},{grantId:'asset-grant'}).error.code,'PERMISSION_DENIED');
  assert.equal((await dispatchAgentRequest({method:'applyCommands',params:req,agentContext:io},{store:c})).receipt.replayed,true);assert.equal(c.undoCount,2);
});

test('revoking IO during preparation prevents dual-authority and IO-only asset commits',async()=>{
  for(const external of[true,false]){const g=gate(),c=setup({agentPreparationGate:g.wait}),before=structuredClone(c.document),ctx=context(c,staged());if(!external)delete ctx.grantId;
    const pending=dispatchAgentRequest({method:'applyCommands',params:request(c),agentContext:ctx},{store:c});await g.entered;c.setIOGrant(null);g.release();const r=await pending;
    assert.equal(r.ok,false);assert.equal(r.error.code,'PERMISSION_DENIED');assert.equal(r.error.mutated,false);assert.deepEqual(c.document,before);assert.equal(c.undoCount,0);
  }
});

test('external authority alone cannot inject assets, and private IO binding cannot be smuggled into public params',async()=>{
  const c=setup(),before=structuredClone(c.document),ctx=context(c,staged());delete ctx.ioGrantId;
  assert.equal((await dispatchAgentRequest({method:'applyCommands',params:request(c),agentContext:ctx},{store:c})).error.code,'PERMISSION_DENIED');
  for(const field of['ioGrantId','grantId','stagedAssets','agentContext'])assert.equal((await c.applyCommands({...request(c),[field]:'forged'})).error.code,'INVALID_REQUEST');
  const stale=await dispatchAgentRequest({method:'bindIOGrant',params:{},agentContext:{ioGrantId:'other',editorSessionId:'stale'}},{store:c});assert.equal(stale.ok,false);
  assert.deepEqual(c.document,before);assert.equal(c.undoCount,0);
});

test('IO grant changes do not erase external receipts and document replacement invalidates IO authority',async()=>{
  const c=setup(),r=request(c,[{id:'document.set_title',params:{title:'이력 보존'}}],'external-receipt');assert.equal((await c.invokeOperation('applyCommands',r,{grantId:'asset-grant'})).ok,true);
  c.setIOGrant('renewed-io');assert.equal(c.readOperation({target:handle(c),operationId:r.operationId},{grantId:'asset-grant'}).value.state,'committed');
  c.loadDocument(fixture);const entries=staged(),ctx={ioGrantId:'renewed-io',editorSessionId:c.editorSessionId,stagedAssets:entries};
  assert.equal((await dispatchAgentRequest({method:'applyCommands',params:request(c),agentContext:ctx},{store:c})).error.code,'PERMISSION_DENIED');assert.equal(c.undoCount,0);
});
