import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { RecoveryService } from '../desktop/recovery.mjs';
import { AgentBridge, callBridge, readBridgeDescriptor } from '../desktop/agent-bridge.mjs';
import { canonicalJson } from '../desktop/canonical-json.mjs';
import { CommandController } from '../src/controller.js';
import { dispatchAgentRequest } from '../src/agent-dispatch.js';
import { probeMcpBusy } from '../scripts/probe-workbench-mcp-busy.mjs';

const fixture = JSON.parse(await fs.readFile(new URL('../examples/document-contract-v0.1.json', import.meta.url), 'utf8'));
async function directory(t) {
  const parent = await fs.realpath(os.tmpdir()), dir = await fs.mkdtemp(path.join(parent, 'vividly-workbench-desktop-'));
  t.after(async () => {
    const real = await fs.realpath(dir); assert.equal(path.dirname(real).toLowerCase(), parent.toLowerCase());
    assert.ok(path.basename(real).startsWith('vividly-workbench-desktop-')); await fs.rm(real, { recursive: true, force: true });
  }); return dir;
}
const target = c => { const r = c.readCommittedSnapshot().value; return { instanceId: r.instanceId, editorSessionId: r.editorSessionId, documentId: r.documentId }; };
const mutation = (c, operationId = 'workbench-op') => ({ target: target(c), expectedRevision: c.revision, targeting: 'id', operationId,
  commands: [{ id: 'shape.set_fill', params: { elementId: 'element-shape-001', fill: '#dd2288' } }] });
async function bridgeFixture(t, activityProvider = () => ({}), document = fixture, controllerOptions = {}) {
  const dir = await directory(t), c = new CommandController(document, { activityProvider, ...controllerOptions });
  const bridge = new AgentBridge({ directory: path.join(dir, 'bridge'), getSessionId: () => c.sessionId,
    dispatch: (method, params, agentContext) => dispatchAgentRequest({method,params,agentContext},{store:c}) });
  t.after(() => bridge.stop()); await bridge.setEnabled(true);
  return { dir, c, bridge, descriptor: await readBridgeDescriptor(bridge.descriptorPath) };
}

test('recovery persists committed document independently, rejects stale sessions and clears only the selected recovery', async t => {
  const dir = await directory(t); let current = 'session-current';
  const service = new RecoveryService({ directory: path.join(dir, 'recovery'), isCurrent: sessionId => sessionId === current });
  assert.equal((await service.read()).available, false);
  const first = await service.write({ sessionId: current, document: fixture, revision: 3 }); assert.equal(first.written, true);
  const changed = structuredClone(fixture); changed.title = '복구 한글 자료';
  await service.write({ sessionId: current, document: changed, revision: 4 });
  const read = await service.read(); assert.equal(read.available, true); assert.equal(read.document.title, '복구 한글 자료');
  assert.equal((await service.write({ sessionId: current, document: fixture, revision: 2 })).stale, true);
  current = 'session-new'; assert.equal((await service.write({ sessionId: 'session-current', document: fixture, revision: 5 })).stale, true);
  assert.equal((await service.clear({ sessionId: current })).cleared, 0);
  const restarted = new RecoveryService({ directory: path.join(dir, 'recovery') });
  assert.deepEqual((await restarted.read()).document, read.document);
  assert.equal((await restarted.clear({ recoveryId: read.recoveryId })).cleared, 2);
  assert.equal((await restarted.read()).available, false);
  assert.deepEqual(await fs.readdir(dir), ['recovery']);
});

test('corrupt recovery bytes are quarantined and previous valid generation is offered without changing user files', async t => {
  const dir = await directory(t), recoverDir = path.join(dir, 'recovery'), userFile = path.join(dir, 'user.html');
  await fs.writeFile(userFile, 'USER ORIGINAL');
  const service = new RecoveryService({ directory: recoverDir });
  await service.write({ sessionId: 's', document: fixture, revision: 1 });
  const changed = structuredClone(fixture); changed.title = 'newer';
  await service.write({ sessionId: 's', document: changed, revision: 2 });
  const head = (await fs.readdir(recoverDir)).find(n => !n.includes('.previous.'));
  await fs.writeFile(path.join(recoverDir, head), '{BROKEN');
  const result = await service.read(); assert.equal(result.available, true); assert.equal(result.revision, 1);
  assert.match(result.warning, /직전 정상/); assert.equal(await fs.readFile(userFile, 'utf8'), 'USER ORIGINAL');
  const quarantine = (await fs.readdir(recoverDir)).find(n => n.includes('.corrupt-'));
  assert.equal(await fs.readFile(path.join(recoverDir, quarantine), 'utf8'), '{BROKEN');
  assert.equal((await service.read()).revision, 1);
});

test('failed recovery replacement keeps last valid snapshot and malformed/oversize requests have no file effect', async t => {
  const dir = await directory(t), recoverDir = path.join(dir, 'recovery');
  const service = new RecoveryService({ directory: recoverDir });
  await service.write({ sessionId: 's', document: fixture, revision: 1 });
  const failing = new RecoveryService({ directory: recoverDir, write: async () => { throw new Error('disk unavailable'); } });
  await assert.rejects(failing.write({ sessionId: 's', document: fixture, revision: 2 }), /disk unavailable/);
  assert.equal((await service.read()).revision, 1);
  const head = (await fs.readdir(recoverDir)).find(n => /^[a-f0-9]{64}\.json$/.test(n));
  await fs.writeFile(path.join(recoverDir, head), 'BROKEN BEFORE AUTOSAVE');
  await service.write({ sessionId: 's', document: fixture, revision: 3 });
  assert.equal((await service.read()).revision, 3);
  const corrupt = (await fs.readdir(recoverDir)).find(n => n.includes('.corrupt-'));
  assert.equal(await fs.readFile(path.join(recoverDir, corrupt), 'utf8'), 'BROKEN BEFORE AUTOSAVE');
  await assert.rejects(service.write({ sessionId: 's', document: fixture, revision: -1 }));
  const tiny = new RecoveryService({ directory: path.join(dir, 'unused'), maxBytes: 10 });
  await assert.rejects(tiny.write({ sessionId: 's', document: fixture, revision: 0 }), /100MB/);
  await assert.rejects(fs.stat(path.join(dir, 'unused')), { code: 'ENOENT' });
});

test('local bridge authenticates explicit instance and deduplicates concurrent/retried guarded operations', async t => {
  const { c, bridge, descriptor } = await bridgeFixture(t);
  const request = mutation(c), [first, second] = await Promise.all([
    callBridge(descriptor, 'applyCommands', request), callBridge(descriptor, 'applyCommands', request),
  ]);
  assert.equal(first.ok, true); assert.equal(second.ok, true); assert.equal(c.undoCount, 1); assert.equal(c.revision, 1);
  assert.deepEqual([first.receipt.replayed, second.receipt.replayed].sort(), [false, true]);
  assert.equal((await callBridge(descriptor, 'applyCommands', request)).receipt.replayed, true); assert.equal(c.undoCount, 1);
  const reordered = structuredClone(request);
  reordered.commands[0].params = { fill: request.commands[0].params.fill, elementId: request.commands[0].params.elementId };
  assert.equal((await callBridge(descriptor, 'applyCommands', reordered)).receipt.replayed, true); assert.equal(c.undoCount, 1);
  const changed = structuredClone(request); changed.commands[0].params.fill = '#ffffff';
  assert.equal((await callBridge(descriptor, 'applyCommands', changed)).error.code, 'OPERATION_CONFLICT');
  await assert.rejects(callBridge({ ...descriptor, token: '0'.repeat(64) }, 'readCommittedSnapshot', {}));
  const read = await callBridge(descriptor, 'readCommittedSnapshot', {}); assert.equal(read.ok, true); assert.equal(read.value.contentRevision, 1);
  assert.equal(bridge.status().descriptorPath, bridge.descriptorPath); assert.equal('token' in bridge.status(), false);
});

test('receipt JSON identity preserves arrays and value types, rejects non-JSON fields without invoking accessors', () => {
  assert.equal(canonicalJson({ b: [1, { y: true, x: null }], a: '1' }), canonicalJson({ a: '1', b: [1, { x: null, y: true }] }));
  assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
  assert.notEqual(canonicalJson({ value: 1 }), canonicalJson({ value: '1' }));
  let accessed = 0; const getter = Object.defineProperty({}, 'value', { enumerable: true, get() { accessed++; return 1; } });
  const cycle = {}; cycle.self = cycle;
  for (const value of [getter, cycle, { x: undefined }, { x: NaN }, { x: Infinity }, { x: 1n }, { [Symbol()]: 1 }, new Date(), [1, , 2], new Array(1000001)]) assert.throws(() => canonicalJson(value), TypeError);
  assert.equal(accessed, 0);
});

test('same receipt ID with different command array order conflicts and never applies a second batch', async t => {
  const { c, descriptor } = await bridgeFixture(t), request = mutation(c, 'ordered-batch');
  request.commands.push({ id: 'document.set_title', params: { title: '순서 있는 묶음' } });
  assert.equal((await callBridge(descriptor, 'applyCommands', request)).ok, true);
  const changedOrder = structuredClone(request); changedOrder.commands.reverse();
  assert.equal((await callBridge(descriptor, 'applyCommands', changedOrder)).error.code, 'OPERATION_CONFLICT');
  assert.equal(c.revision, 1); assert.equal(c.undoCount, 1);
});

test('an unknown renderer reply is recovered from the authoritative ledger on identical replay without another commit',async t=>{
  const{c,bridge,descriptor}=await bridgeFixture(t),request=mutation(c,'lost-renderer-reply'),dispatch=bridge.dispatch;
  let loseReply=true;
  bridge.dispatch=async(method,params,context)=>{const result=await dispatch(method,params,context);if(method==='applyCommands'&&loseReply){loseReply=false;throw Error('test-owned renderer reply loss after atomic commit');}return result;};
  const first=await callBridge(descriptor,'applyCommands',request);assert.equal(first.error.outcomeUnknown,true);assert.equal(c.undoCount,1);
  const known=await callBridge(descriptor,'readOperation',{target:target(c),operationId:request.operationId});assert.equal(known.value.state,'committed');
  const replay=await callBridge(descriptor,'applyCommands',request);assert.equal(replay.ok,true,JSON.stringify(replay));assert.equal(replay.receipt.replayed,true);assert.equal(replay.receipt.state,'committed');assert.equal(replay.value.undoEntryId,known.value.result.value.undoEntryId);assert.equal(c.undoCount,1);assert.equal(c.revision,1);
});

test('bridge dryRun/busy retain human draft and document changes revoke both socket and descriptor grants', async t => {
  let activity = {};
  const { c, bridge, descriptor } = await bridgeFixture(t, () => activity);
  const dry = await callBridge(descriptor, 'applyCommands', { ...mutation(c,'workbench-dry'), dryRun: true });
  assert.equal(dry.ok, true); assert.equal(c.undoCount, 0); assert.equal(c.revision, 0);
  c.beginText('element-title-001'); c.updateText(['한ㄱ']); c.setComposing(true);
  const request = mutation(c), before = structuredClone(c.document);
  const blocked = await callBridge(descriptor, 'applyCommands', request); assert.equal(blocked.error.code, 'EDITOR_BUSY');
  assert.deepEqual(c.document, before); assert.equal(c.textSession.composing, true);
  c.setComposing(false); c.finishText(); activity = {};
  c.loadDocument(fixture); await bridge.documentChanged();
  assert.equal(bridge.status().enabled, false); await assert.rejects(fs.stat(bridge.descriptorPath), { code: 'ENOENT' });
  await assert.rejects(callBridge(descriptor, 'readCommittedSnapshot', {}));
});

test('official SDK stdio MCP initializes, lists tools/resources, reads, applies one shared Undo batch and rejects malformed calls', async t => {
  const document = { ...fixture, id: ` ${fixture.id} ` };
  const { c, descriptor, bridge } = await bridgeFixture(t, () => ({}), document, { instanceId: ' opaque-editor-instance ' });
  const executable = process.env.VIVIDLY_MCP_ADAPTER || fileURLToPath(new URL('../desktop/mcp-adapter.mjs', import.meta.url));
  const child = spawn(process.execPath, [executable, '--descriptor', bridge.descriptorPath], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let output = '', stderr = '', id = 0; const pending = new Map(), invalid = [];
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  child.stdout.on('data', chunk => {
    output += chunk.toString();
    for (;;) {
      const at = output.indexOf('\n'); if (at < 0) break;
      const line = output.slice(0, at); output = output.slice(at + 1);
      try { const response = JSON.parse(line), callback = pending.get(response.id); if (callback) { pending.delete(response.id); callback(response); } }
      catch { invalid.push(line); }
    }
  });
  const rpc = (method, params = {}) => new Promise((resolve, reject) => {
    const key = ++id, timeout = setTimeout(() => { pending.delete(key); reject(new Error(`MCP ${method} timed out: ${stderr}`)); }, 10000);
    pending.set(key, result => { clearTimeout(timeout); resolve(result); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: key, method, params }) + '\n');
  });
  t.after(async () => {
    child.stdin.end();
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(() => { child.kill(); resolve(); }, 1000))]);
  });
  const initialized = await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'vividly-qa', version: '1.0' } });
  assert.equal(initialized.result.serverInfo.name, 'vividly');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const tools = await rpc('tools/list'); assert.equal(tools.result.tools.length, 17);
  assert.deepEqual(tools.result.tools.map(t=>t.name).filter(n=>/approved_files|import_asset|save_document|open_document|present_document|host_operation/.test(n)).sort(),['vividly_list_approved_files','vividly_import_asset','vividly_save_document','vividly_open_document','vividly_present_document','vividly_read_host_operation','vividly_cancel_host_operation'].sort());
  assert.ok(tools.result.tools.every(tool=>tool.outputSchema?.type==='object'));
  assert.ok(tools.result.tools.some(tool => tool.name === 'vividly_apply_commands'));
  const resources = await rpc('resources/list'); assert.equal(resources.result.resources[0].uri, 'vividly://document/current');
  const read = await rpc('tools/call', { name: 'vividly_read_document', arguments: {} });
  assert.equal(read.result.structuredContent.ok, true); assert.equal(read.result.structuredContent.value.document.id, document.id);
  const request = mutation(c, ' opaque-stdio-operation ');
  const targetedRead = await rpc('tools/call', { name: 'vividly_read_document', arguments: { target: request.target } });
  assert.equal(targetedRead.result.structuredContent.ok, true);
  assert.equal(targetedRead.result.structuredContent.value.documentId, document.id);
  const applied = await rpc('tools/call', { name: 'vividly_apply_commands', arguments: request });
  assert.equal(applied.result.structuredContent.ok, true); assert.equal(c.undoCount, 1);
  assert.equal(applied.result.structuredContent.value.operationId, request.operationId);
  assert.equal(applied.result.structuredContent.receipt.operationId, request.operationId);
  const repeated = await rpc('tools/call', { name: 'vividly_apply_commands', arguments: request });
  assert.equal(repeated.result.structuredContent.receipt.replayed, true); assert.equal(c.undoCount, 1);
  const malformed = await rpc('tools/call', { name: 'vividly_apply_commands', arguments: { ...request, eval: 'x' } });
  assert.ok(malformed.error || malformed.result.isError); assert.equal(c.undoCount, 1); assert.deepEqual(invalid, []);
  for (const documentId of [' ', 'x'.repeat(257)]) {
    const invalidTarget = await rpc('tools/call', { name: 'vividly_read_document', arguments: { target: { ...request.target, documentId } } });
    assert.ok(invalidTarget.error || invalidTarget.result.isError);
  }
  for(const [name,args]of[
    ['vividly_import_asset',{target:request.target,fileHandleId:'approved',path:'C:/not-approved.png'}],
    ['vividly_import_asset',{target:request.target,fileHandleId:'approved',dataBase64:'AAAA'}],
    ['vividly_save_document',{target:request.target,expectedRevision:c.revision,operationId:'forged-save',fileHandleId:'approved',path:'C:/not-approved.html'}],
    ['vividly_present_document',{target:request.target,expectedRevision:c.revision,operationId:'forged-present',active:true}],
    ['vividly_apply_commands',{...request,stagingIds:Array.from({length:9},(_,i)=>'stage-'+i)}],
    ['vividly_apply_commands',{...request,stagingIds:['stage'],ioGrantId:'forged'}],
  ]){const invalid=await rpc('tools/call',{name,arguments:args});assert.ok(invalid.error||invalid.result?.isError,name);assert.equal(c.undoCount,1);}
  assert.equal(stderr, ''); assert.equal(descriptor.instanceId, bridge.status().instanceId);
});

test('stdio busy probe preserves a synthetic composing controller and records actual guard responses without UI input', async t => {
  const { c, bridge } = await bridgeFixture(t);
  c.beginText('element-title-001'); c.updateText(['한ㄱ']); c.setComposing(true);
  const text = c.textSession, draft = structuredClone(c.textSession), committed = structuredClone(c.document);
  const report = await probeMcpBusy({ command: process.execPath, args: [fileURLToPath(new URL('../desktop/mcp-adapter.mjs', import.meta.url)), '--descriptor', bridge.descriptorPath] }, { expectedReason: 'ime' });
  assert.equal(report.passed, true, JSON.stringify(report.error)); assert.equal(report.cases.length, 2);
  assert.equal(c.textSession, text); assert.deepEqual(c.textSession, draft); assert.deepEqual(c.document, committed); assert.equal(c.undoCount, 0);
});


test('authorized open flushes its exact old-grant response before document-change revocation and never grants the new session',async t=>{
  const dir=await directory(t);let session='session-before-open',bridge;
  bridge=new AgentBridge({directory:path.join(dir,'bridge'),getSessionId:()=>session,dispatch:async(method,params)=>{
    if(method==='bindAgentGrant')return{ok:true,value:{}};
    assert.equal(method,'openDocument');session='session-after-open';await bridge.documentChanged();
    assert.equal(bridge.enabled,true,'old reply socket must survive until write completes');
    return{ok:true,value:{operationId:params.operationId,kind:'open',previousTarget:params.target,newTarget:{...params.target,editorSessionId:session},openToken:'owned-open-token',padding:'x'.repeat(200000)}};
  }});t.after(()=>bridge.stop());await bridge.start();const descriptor=await readBridgeDescriptor(bridge.descriptorPath);
  const response=await callBridge(descriptor,'openDocument',{target:{instanceId:bridge.instanceId,editorSessionId:session,documentId:'owned-doc'},expectedRevision:0,operationId:'owned-open',fileHandleId:'owned-handle'});
  assert.equal(response.ok,true);assert.equal(response.value.padding.length,200000);assert.equal(response.value.newTarget.editorSessionId,'session-after-open');
  for(let n=0;n<100&&bridge.enabled;n++)await new Promise(r=>setTimeout(r,2));assert.equal(bridge.enabled,false);assert.equal(bridge.grantId,null);assert.equal(bridge.openReplyBarriers.size,0);
  await assert.rejects(()=>callBridge(descriptor,'readCapabilities',{}));
});

test('an open-reply barrier never delays explicit human revocation',async t=>{
  const dir=await directory(t);let session='before',entered,release;
  const started=new Promise(r=>entered=r),wait=new Promise(r=>release=r),bridge=new AgentBridge({directory:path.join(dir,'bridge'),getSessionId:()=>session,dispatch:async method=>{
    if(method==='bindAgentGrant')return{ok:true,value:{}};entered();await wait;session='after';return{ok:true,value:{kind:'open'}};
  }});t.after(()=>bridge.stop());await bridge.start();const descriptor=await readBridgeDescriptor(bridge.descriptorPath);
  const outcome=callBridge(descriptor,'openDocument',{target:{instanceId:bridge.instanceId,editorSessionId:session,documentId:'doc'},expectedRevision:0,operationId:'human-stop',fileHandleId:'handle'}).catch(error=>error);
  await started;await bridge.stop();assert.equal(bridge.enabled,false);assert.equal(bridge.openReplyBarriers.size,0);release();assert.ok(await outcome instanceof Error);assert.equal(bridge.grantId,null);
});
