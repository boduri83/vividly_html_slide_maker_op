import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CommandController } from '../src/controller.js';
import { cloneDocument } from '../src/model.js';
import { evaluateCommands, validateCommands } from '../src/commands.js';
import { exportPresentation, parsePresentation } from '../src/format.js';

const fixture = JSON.parse(readFileSync(new URL('../examples/document-contract-v0.1.json', import.meta.url), 'utf8'));
const shapeId = 'element-shape-001', textId = 'element-title-001';
const fill = (color = '#9116a2', elementId = shapeId) => ({ id: 'shape.set_fill', params: { elementId, fill: color } });
const title = value => ({ id: 'document.set_title', params: { title: value } });
const geometry = { id: 'element.set_geometry', params: { elementId: shapeId, geometry: { x: 203, width: 527 } } };
function request(c, commands = [geometry, fill()], extra = {}) {
  const r = c.readCommittedSnapshot().value;
  return { target: { instanceId: r.instanceId, editorSessionId: r.editorSessionId, documentId: r.documentId },
    expectedRevision: r.contentRevision, operationId: 'batch-test', targeting: 'id', commands, ...extra };
}
function historyRequest(c, entryId, extra = {}) {
  const { commands, targeting, ...input } = request(c);
  return { ...input, expectedTopEntryId: entryId, ...extra };
}
const state = c => cloneDocument({ read: c.readCommittedSnapshot().value, history: c.readHistory().value.history,
  text: c.textSession, transform: c.transformSession });
async function unchanged(c, input, code, method = 'applyCommands') {
  const before = state(c), doc = c.document, text = c.textSession, transform = c.transformSession;
  const result = await c[method](input);
  assert.equal(result.ok, false); assert.equal(result.error.code, code); assert.equal(result.error.mutated, false);
  assert.deepEqual(state(c), before); assert.equal(c.document, doc);
  assert.equal(c.textSession, text); assert.equal(c.transformSession, transform);
  return result;
}

test('a multi-command candidate is detached and a late semantic failure changes absolutely nothing', async () => {
  const c = new CommandController(fixture); c.selectElement(shapeId); c.setTitle('prior'); c.undo();
  const input = request(c, [geometry, fill(), fill('#123456', 'missing')]);
  const result = await unchanged(c, input, 'TARGET_NOT_FOUND');
  assert.equal(result.error.commandIndex, 2); assert.equal(result.error.path, '$.commands[2].params.elementId');
  assert.equal(c.canRedo, true); assert.equal(c.isDirty, false);
  const base = cloneDocument(fixture); assert.equal(evaluateCommands(base, input.commands).ok, false); assert.deepEqual(base, fixture);
});

test('dependent operations see the preceding candidate and delete-then-edit failure rolls back the deletion', async () => {
  const c = new CommandController(fixture); c.selectElement(shapeId);
  await unchanged(c, request(c, [fill(), { id: 'element.delete', params: { elementId: shapeId } }, geometry]), 'TARGET_NOT_FOUND');
  const result = await c.applyCommands(request(c, [fill(), { id: 'element.delete', params: { elementId: shapeId } }]));
  assert.equal(result.value.changed, true); assert.deepEqual(result.value.summary.removedElementIds, [shapeId]);
  assert.deepEqual(result.value.summary.changedElementIds, []); assert.equal(c.selectedId, null);
  c.undo(); assert.equal(c.selectedId, shapeId); assert.deepEqual(c.document, fixture);
});

test('dryRun returns the exact net summary without changing document, view, dirty, redo or history', async () => {
  const c = new CommandController(fixture); c.selectElement(textId); c.setTitle('prior'); c.undo();
  const before = state(c), doc = c.document, preview = await c.applyCommands(request(c, undefined, { dryRun: true }));
  assert.equal(preview.ok, true); assert.equal(preview.value.dryRun, true); assert.equal(preview.value.wouldChange, true);
  assert.equal(preview.value.changed, false); assert.equal(preview.value.undoEntryId, null);
  assert.equal(preview.value.previousRevision, preview.value.contentRevision); assert.deepEqual(preview.value.createdIds, {});
  assert.deepEqual(state(c), before); assert.equal(c.document, doc);
  const applied = await c.applyCommands(request(c)); assert.deepEqual(applied.value.summary, preview.value.summary);
  assert.deepEqual(applied.value.summary.changedElementIds, [shapeId]); assert.equal(c.selectedId, textId);
});

test('failure, dryRun and cancelling net changes allocate no IDs; real batch allocates one history ID', async t => {
  const c = new CommandController(fixture); let ids = 0;
  t.mock.method(globalThis.crypto, 'randomUUID', () => `observed-${++ids}`);
  await c.applyCommands(request(c, undefined, { dryRun: true }));
  await c.applyCommands(request(c, [fill(), fill('#123456', 'missing')]));
  await c.applyCommands(request(c, [fill(), fill(fixture.slides[0].elements[1].fill)]));
  assert.equal(ids, 0);
  const result = await c.applyCommands(request(c)); assert.equal(ids, 1); assert.equal(result.value.undoEntryId, 'history-observed-1');
});

test('one real batch creates one revision, one shared human Undo/Redo and bound actor metadata', async () => {
  const c = new CommandController(fixture, { agentActorId: 'connection-qa' }); c.selectElement(shapeId);
  const input = request(c, [geometry, fill(), title('공동 편집')], { label: '배치와 색상 정리' });
  const result = await c.applyCommands(input), after = cloneDocument(c.document), id = result.value.undoEntryId;
  assert.equal(c.revision, 1); assert.equal(c.undoCount, 1); assert.equal(c.redoCount, 0);
  const entry = c.readHistory().value.history.undo[0];
  assert.equal(entry.entryId, id); assert.equal(entry.source, 'agent'); assert.equal(entry.actorId, 'connection-qa');
  assert.equal(entry.label, input.label); assert.equal(entry.operationId, input.operationId);
  assert.deepEqual(entry.commands, input.commands); assert.ok(entry.targetIds.includes(shapeId)); assert.ok(entry.targetIds.includes(fixture.id));
  assert.equal(entry.previousRevision, 0); assert.equal(entry.contentRevision, 1);
  assert.equal(c.undo(), true); assert.deepEqual(c.document, fixture); assert.equal(c.revision, 2); assert.equal(c.selectedId, shapeId);
  assert.equal(c.redo(), true); assert.deepEqual(c.document, after); assert.equal(c.revision, 3);
  assert.equal(c.readEditorState().value.state.history.topUndoEntryId, id);
  assert.deepEqual(c.readHistory().value.history.undo[0], entry, 'Original entry identity/provenance remains stable across replay');
});

test('ordinary human commands, text, gesture and typed creation share provenance without draft history', () => {
  const c = new CommandController(fixture);
  c.setTitle('사람 제목'); c.beginText(textId); c.updateText(['한글']);
  assert.equal(c.readHistory().value.history.undo.length, 1); c.finishText();
  c.beginTransform(shapeId, 'move'); c.previewGeometry({ x: 200 }); c.commitTransform(); c.addText();
  const entries = c.readHistory().value.history.undo;
  assert.equal(entries.length, 4); assert.ok(entries.every(e => e.source === 'human' && e.actorId === 'local-human' && e.operationId === null));
  assert.deepEqual(entries.map(e => e.previousRevision), [0, 1, 2, 3]);
  assert.equal(entries[1].commands[0].id, 'text.replace'); assert.equal(entries[2].commands[0].id, 'element.set_geometry');
  assert.ok(entries[3].targetIds.includes(c.selectedId)); assert.equal('before' in entries[0], false);
});

test('single guarded commands also record agent provenance and all returned history/result data is detached', async () => {
  const c = new CommandController(fixture), input = request(c, [fill()]); const { commands, ...header } = input;
  await c.executeGuarded({ ...header, command: commands[0] });
  const h = c.readHistory().value.history; assert.equal(h.undo[0].source, 'agent');
  h.undo[0].commands[0].params.fill = '#ffffff'; h.undo[0].targetIds.push('fake'); h.undo.length = 0;
  assert.equal(c.readHistory().value.history.undo[0].commands[0].params.fill, '#9116a2');
  const result = await c.applyCommands(request(c, [geometry])); result.value.summary.changedElementIds.push('fake');
  assert.equal(c.readHistory().value.history.undo[1].targetIds.includes('fake'), false);
});

test('net no-op preserves redo, saved signature, selection and original document identity', async () => {
  const c = new CommandController(fixture); c.setTitle('prior'); c.undo(); c.selectElement(shapeId);
  const before = state(c), doc = c.document;
  const result = await c.applyCommands(request(c, [fill(), fill(fixture.slides[0].elements[1].fill)]));
  assert.equal(result.value.changed, false); assert.equal(result.value.wouldChange, false); assert.equal(result.value.undoEntryId, null);
  assert.deepEqual(state(c), before); assert.equal(c.document, doc); assert.equal(c.redo(), true);
});

test('closed bounded JSON rejects malformed members, callbacks, actor claims, sparse arrays and aggregate excess', async () => {
  let calls = 0; const c = new CommandController(fixture, { activityProvider: () => { calls++; return {}; } });
  const valid = request(c); calls = 0;
  const getter = {}; Object.defineProperty(getter, 'id', { enumerable: true, get() { throw Error('getter invoked'); } });
  const sparse = Array(2); sparse[0] = fill();
  const invalid = [[], [getter], sparse, [fill(), { id: 'element.create_text', params: { slideId: fixture.slides[0].id, clientRef: 'new' } }],
    Array(101).fill(fill()), Array(5).fill(title('한'.repeat(20000)))];
  for (const commands of invalid) {
    const result = await c.applyCommands({ ...valid, commands }); assert.equal(result.ok, false); assert.equal(result.error.mutated, false);
  }
  for (const extra of [{ actorId: 'spoof' }, { source: 'human' }, { label: '' }, { dryRun: 1 }, { callback: () => {} }, { [Symbol()]: 1 }])
    assert.equal((await c.applyCommands({ ...valid, ...extra })).ok, false);
  assert.equal(calls, 0); assert.equal(c.revision, 0); assert.equal(c.undoCount, 0);
  assert.equal(validateCommands([fill(), geometry]).ok, true);
});

test('request, command array and preconditions are detached before the preparation boundary', async () => {
  const c = new CommandController(fixture), input = request(c);
  const pending = c.applyCommands(input); input.commands[0].params.geometry.x = 999; input.commands.pop();
  input.target.documentId = 'fake'; input.expectedRevision = 999; input.dryRun = true; input.label = 'fake';
  const result = await pending; assert.equal(result.ok, true); assert.equal(result.value.changed, true);
  assert.equal(c.document.slides[0].elements[1].geometry.x, 203);
  assert.equal(c.document.slides[0].elements[1].fill, '#9116a2');
});

test('two batches at the same CAS revision yield one complete commit and one zero-effect rejection', async () => {
  const c = new CommandController(fixture), input = request(c);
  const results = await Promise.all([c.applyCommands(input), c.applyCommands({ ...input, operationId: 'second', commands: [title('other'), fill('#ffffff')] })]);
  assert.equal(results[0].ok, true); assert.equal(results[1].error.code, 'REVISION_CONFLICT');
  assert.equal(c.revision, 1); assert.equal(c.undoCount, 1); assert.equal(c.document.title, fixture.title);
});

test('dryRun is not a reservation: real execution and preview completion both recheck session and CAS', async () => {
  const c = new CommandController(fixture), input = request(c); await c.applyCommands({ ...input, dryRun: true });
  c.setTitle('human'); await unchanged(c, input, 'REVISION_CONFLICT');
  const pending = c.applyCommands(request(c, undefined, { dryRun: true })); c.undo();
  const before = state(c); assert.equal((await pending).error.code, 'REVISION_CONFLICT'); assert.deepEqual(state(c), before);
  const stale = c.applyCommands(request(c)); c.loadDocument(fixture);
  assert.equal((await stale).error.code, 'STALE_EDITOR_SESSION'); assert.equal(c.undoCount, 0);
});

test('text/IME/move/resize/title/color/save activity blocks both batch and dryRun without finishing work', async () => {
  for (const dryRun of [false, true]) for (const phase of ['text', 'ime', 'move', 'resize', 'title', 'color', 'saving']) {
    let activity = {}; const c = new CommandController(fixture, { activityProvider: () => activity });
    const input = request(c, undefined, { dryRun });
    if (['text', 'ime'].includes(phase)) { c.beginText(textId); c.updateText(['한ㄱ']); if (phase === 'ime') c.setComposing(true); }
    else if (['move', 'resize'].includes(phase)) { c.beginTransform(shapeId, phase); c.previewGeometry({ x: 333 }); }
    else activity = phase === 'saving' ? { saving: true } : { controls: [{ fieldId: phase === 'title' ? 'document-title' : 'property-fill' }] };
    await unchanged(c, input, 'EDITOR_BUSY');
  }
});

test('human input starting after preparation blocks batch/dryRun completion with identical draft identity', async () => {
  for (const dryRun of [false, true]) {
    const c = new CommandController(fixture), pending = c.applyCommands(request(c, undefined, { dryRun }));
    c.beginText(textId); c.updateText(['미확정']); c.setComposing(true); const before = state(c), draft = c.textSession;
    assert.equal((await pending).error.code, 'EDITOR_BUSY'); assert.deepEqual(state(c), before); assert.equal(c.textSession, draft);
  }
});

test('selection batches require every explicit element and current view; ID batches preserve unrelated selection', async () => {
  const c = new CommandController(fixture); c.selectElement(shapeId);
  const input = request(c, undefined, { targeting: 'selection', expectedViewRevision: c.viewRevision });
  const pending = c.applyCommands(input); c.selectElement(textId); c.selectElement(shapeId);
  assert.equal((await pending).error.code, 'VIEW_REVISION_CONFLICT');
  await unchanged(c, request(c, [geometry, { id: 'text.set_content', params: { elementId: textId, paragraphs: ['x'] } }],
    { targeting: 'selection', expectedViewRevision: c.viewRevision }), 'SELECTION_CONFLICT');
  assert.equal((await c.applyCommands(request(c, [title('x')], { targeting: 'selection', expectedViewRevision: c.viewRevision }))).ok, false);
  const direct = c.applyCommands(request(c)); c.selectElement(textId); assert.equal((await direct).ok, true); assert.equal(c.selectedId, textId);
});

test('batch deletion reconciles active slide/selection once and Undo/Redo restores both endpoints', async () => {
  const c = new CommandController(fixture); c.switchSlide(fixture.slides[1].id); c.selectElement(c.activeSlide.elements[0].id);
  const selected = c.selectedId;
  const result = await c.applyCommands(request(c, [{ id: 'slide.delete', params: { slideId: c.activeSlideId } }, fill()]));
  assert.equal(result.ok, true); assert.equal(c.activeSlideId, fixture.slides[0].id); assert.equal(c.selectedId, null); assert.equal(c.undoCount, 1);
  c.undo(); assert.equal(c.activeSlideId, fixture.slides[1].id); assert.equal(c.selectedId, selected); assert.deepEqual(c.document, fixture);
  c.redo(); assert.equal(c.activeSlideId, fixture.slides[0].id); assert.equal(c.selectedId, null);
});

test('guarded Undo requires current top ID even with a fresh revision, protecting newer human work', async () => {
  const c = new CommandController(fixture), result = await c.applyCommands(request(c)), agentId = result.value.undoEntryId;
  c.setTitle('사람의 최근 편집'); const humanId = c.readEditorState().value.state.history.topUndoEntryId;
  await unchanged(c, historyRequest(c, agentId), 'HISTORY_CONFLICT', 'undoGuarded');
  const missing = historyRequest(c, humanId); delete missing.expectedTopEntryId;
  await unchanged(c, missing, 'INVALID_REQUEST', 'undoGuarded');
  assert.equal((await c.undoGuarded(historyRequest(c, humanId))).ok, true, 'Explicit top human entry can be intentionally undone');
  assert.equal(c.readEditorState().value.state.history.topUndoEntryId, agentId);
  assert.equal((await c.undoGuarded(historyRequest(c, agentId))).ok, true); assert.deepEqual(c.document, fixture);
  assert.equal((await c.redoGuarded(historyRequest(c, agentId))).ok, true); assert.equal(c.undoCount, 1);
  await unchanged(c, historyRequest(c, agentId), 'HISTORY_CONFLICT', 'redoGuarded');
});

test('guarded Undo/Redo recheck CAS, history and human activity after await, and never replay themselves', async () => {
  const c = new CommandController(fixture), result = await c.applyCommands(request(c)), id = result.value.undoEntryId;
  const pending = c.undoGuarded(historyRequest(c, id)); c.setTitle('human'); const before = state(c);
  assert.equal((await pending).error.code, 'REVISION_CONFLICT'); assert.deepEqual(state(c), before);
  c.undo(); c.undo();
  const redo = c.redoGuarded(historyRequest(c, id)); c.beginText(textId); c.updateText(['한ㄱ']); c.setComposing(true);
  const draft = state(c); assert.equal((await redo).error.code, 'EDITOR_BUSY'); assert.deepEqual(state(c), draft);
  c.setComposing(false); c.finishText(); assert.equal(c.redoCount, 0);
});

test('batch HTML save/reopen keeps schema, IDs, assets, dirty baseline and subsequent human editing/Undo', async () => {
  const c = new CommandController(fixture);
  await c.applyCommands(request(c, [geometry, fill(), { id: 'text.set_content', params: { elementId: textId, paragraphs: ['한글 공동 편집', '<tag> & 😀'] } }]));
  const saved = c.snapshot(); c.markSaved(saved, c.sessionId); assert.equal(c.isDirty, false);
  c.undo(); assert.equal(c.isDirty, true); c.redo(); assert.equal(c.isDirty, false);
  const reopened = parsePresentation(await exportPresentation(saved)); assert.deepEqual(reopened, saved); assert.deepEqual(reopened.assets, fixture.assets);
  c.loadDocument(reopened); assert.equal(c.undoCount, 0); assert.equal(c.revision, 0); assert.equal(c.readEditorState().value.state.history.topUndoEntryId, null);
  c.beginText(textId); c.updateText(['재열기 후 편집']); c.finishText(); assert.equal(c.undoCount, 1);
  c.undo(); assert.deepEqual(c.document, saved); c.redo(); assert.equal(c.document.slides[0].elements[0].text.paragraphs[0], '재열기 후 편집');
});

test('shared history remains capped at 100 complete entries and reloading invalidates guarded history handles', async () => {
  const c = new CommandController(fixture);
  for (let i = 0; i < 105; i++) c.setTitle(`human-${i}`);
  const result = await c.applyCommands(request(c)); assert.equal(c.undoCount, 100);
  assert.equal(c.readHistory().value.history.undo[0].previousRevision, 6);
  const old = historyRequest(c, result.value.undoEntryId); c.loadDocument(c.document);
  await unchanged(c, old, 'STALE_EDITOR_SESSION', 'undoGuarded');
});
