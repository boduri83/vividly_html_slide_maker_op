/** Observe a granted, human-busy editor over stdio. This helper never sends UI input. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export async function probeMcpBusy(config, { expectedReason } = {}) {
  if (!config || typeof config.command !== 'string' || !Array.isArray(config.args)) throw new Error('MCP launchConfig가 필요합니다.');
  const child = spawn(config.command, config.args, { env: { ...process.env, ...config.env }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = '', stderr = '', counter = 0; const pending = new Map(), trace = [], invalid = [];
  child.stderr.on('data', chunk => { stderr += chunk; });
  const rejectPending = error => { for (const job of pending.values()) { clearTimeout(job.timer); job.reject(error); } pending.clear(); };
  child.on('error', rejectPending);
  child.on('exit', code => { if (pending.size) rejectPending(new Error(`MCP exited during request (${code}): ${stderr}`)); });
  child.stdout.on('data', chunk => {
    buffer += chunk.toString();
    for (;;) {
      const at = buffer.indexOf('\n'); if (at < 0) break;
      const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
      try {
        const response = JSON.parse(line); trace.push({ direction: 'response', at: new Date().toISOString(), message: response });
        const job = pending.get(response.id); if (job) { pending.delete(response.id); clearTimeout(job.timer); job.resolve(response); }
      } catch { invalid.push(line); }
    }
  });
  const rpc = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++counter, message = { jsonrpc: '2.0', id, method, params };
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP ${method} timeout: ${stderr}`)); }, 35000);
    pending.set(id, { resolve, reject, timer }); trace.push({ direction: 'request', at: new Date().toISOString(), message });
    child.stdin.write(JSON.stringify(message) + '\n');
  });
  const call = async (name, args = {}) => {
    const response = await rpc('tools/call', { name, arguments: args });
    assert.equal(response.error, undefined, JSON.stringify(response.error));
    return response.result?.structuredContent ?? JSON.parse(response.result?.content?.find(item => item.type === 'text')?.text || '{}');
  };
  const read = async name => { const result = await call(name); assert.equal(result.ok, true, JSON.stringify(result)); return result; };
  const report = { schemaVersion: 1, startedUtc: new Date().toISOString(),
    scope: 'Actual stdio MCP while editor reports human-busy; no UI input. Physical IME/native-popup provenance must come from separate caller observations.',
    cases: [], trace };
  try {
    const initialized = await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'vividly-busy-probe', version: '1.0' } });
    assert.equal(initialized.result?.serverInfo?.name, 'vividly'); report.server = initialized.result.serverInfo;
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const before = await read('vividly_read_document'), editorBefore = await read('vividly_read_editor_state'), historyBefore = await read('vividly_read_history');
    assert.equal(editorBefore.value.state.humanEditing, true, 'Keep a human input action active before invoking this probe');
    assert.equal(editorBefore.value.state.busy.active, true);
    const humanReasons = editorBefore.value.state.busy.reasons.filter(reason => reason.scope === 'human');
    assert.ok(humanReasons.length > 0); if (expectedReason) assert.ok(humanReasons.some(reason => reason.kind === expectedReason), `Expected human busy kind ${expectedReason}`);
    report.observedBusyKinds = humanReasons.map(reason => reason.kind);
    const pages = await call('vividly_read_document',{projection:'slides',limit:100});
    assert.equal(pages.ok,true,JSON.stringify(pages));
    let chosen;
    for(const slide of pages.value.items){
      let cursor;
      do{const page=await call('vividly_read_document',{projection:'elements',slideId:slide.id,fields:['geometry'],limit:100,...(cursor?{cursor}:{})});assert.equal(page.ok,true,JSON.stringify(page));chosen=page.value.items.find(element=>!element.locked&&!element.hidden);cursor=page.value.page.nextCursor;}while(!chosen&&cursor);
      if(chosen)break;
    }
    assert.ok(chosen, 'The owned verification document needs one editable element');
    const target = { instanceId: before.value.instanceId, editorSessionId: before.value.editorSessionId, documentId: before.value.documentId };
    const base = { target, expectedRevision: before.value.contentRevision, targeting: 'id', label: 'Human busy protection probe' };
    // The real-commit attempt is a valid no-op: a person ending input between
    // observations cannot cause this verification helper to move their content.
    const attempted = await call('vividly_apply_commands', { ...base, operationId: randomUUID(),
      commands: [{ id: 'element.set_geometry', params: { elementId: chosen.id, geometry: { x: chosen.geometry.x } } }] });
    assert.equal(attempted.ok, false); assert.equal(attempted.error.code, 'EDITOR_BUSY'); assert.equal(attempted.error.mutated, false);
    const dryRun = await call('vividly_apply_commands', { ...base, operationId: randomUUID(), dryRun: true,
      commands: [{ id: 'element.set_geometry', params: { elementId: chosen.id, geometry: { x: chosen.geometry.x + 1 } } }] });
    assert.equal(dryRun.ok, false); assert.equal(dryRun.error.code, 'EDITOR_BUSY'); assert.equal(dryRun.error.mutated, false);
    report.cases.push({ id: 'B01', status: 'passed', title: 'Valid no-op commit batch and would-change dryRun reject human-busy with mutated:false' });
    const after = await read('vividly_read_document'), editorAfter = await read('vividly_read_editor_state'), historyAfter = await read('vividly_read_history');
    assert.deepEqual(after, before); assert.deepEqual(editorAfter, editorBefore); assert.deepEqual(historyAfter, historyBefore);
    const afterChosen=await call('vividly_read_document',{projection:'objects',ids:[chosen.id],fields:['geometry']});
    assert.deepEqual(afterChosen.value.items[0],chosen);
    report.cases.push({ id: 'B02', status: 'passed', title: 'Committed summary/object, revisions, selection, busy metadata and shared history remain unchanged' });
    report.before = before; report.after = after; report.editorBefore = editorBefore; report.editorAfter = editorAfter;
    report.historyBefore = historyBefore; report.historyAfter = historyAfter; report.attempted = attempted; report.dryRun = dryRun;
    assert.deepEqual(invalid, []); assert.equal(stderr, ''); report.passed = true;
  } catch (error) { report.passed = false; report.error = { message: error.message, stack: error.stack }; }
  finally {
    for (const job of pending.values()) clearTimeout(job.timer);
    const closed = new Promise(resolve => {
      if (child.exitCode !== null) { resolve(); return; }
      const timer = setTimeout(() => { child.kill(); resolve(); }, 1000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
    child.stdin.end(); await closed;
    report.finishedUtc = new Date().toISOString(); report.stderr = stderr; report.invalidStdoutLines = invalid;
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), option = name => { const at = argv.indexOf(name); return at < 0 ? null : argv[at + 1]; };
  const config = option('--config'), output = option('--output');
  if (!config || !output) throw new Error('Use --config launch-config.json --output new-report.json [--expect-reason ime|colorControl]');
  const report = await probeMcpBusy(JSON.parse(await fs.readFile(config, 'utf8')), { expectedReason: option('--expect-reason') });
  await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  process.stdout.write(`${report.passed ? 'PASS' : 'FAIL'} ${report.cases.length} MCP busy cases\n`); process.exitCode = report.passed ? 0 : 1;
}
