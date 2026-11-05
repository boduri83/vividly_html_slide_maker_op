import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CommandController } from '../src/controller.js';
import { cloneDocument } from '../src/model.js';
import { exportPresentation, parsePresentation } from '../src/format.js';
import { validateGuardedCommand } from '../src/editor-guard.js';

const fixture = JSON.parse(readFileSync(new URL('../examples/document-contract-v0.1.json', import.meta.url), 'utf8'));
const textId = 'element-title-001', shapeId = 'element-shape-001';
const fill = color => ({ id: 'shape.set_fill', params: { elementId: shapeId, fill: color } });
function request(c, command = fill('#123456'), extra = {}) {
  const read = c.readCommittedSnapshot().value;
  return { target: { instanceId: read.instanceId, editorSessionId: read.editorSessionId, documentId: read.documentId },
    expectedRevision: read.contentRevision, operationId: 'op-cas-test', targeting: 'id', command, ...extra };
}
const state = c => cloneDocument({ document: c.document, textSession: c.textSession, transformSession: c.transformSession,
  active: c.activeSlideId, selected: c.selectedId, session: c.sessionId, revision: c.revision, viewRevision: c.viewRevision,
  undo: c.undoCount, redo: c.redoCount, canUndo: c.canUndo, canRedo: c.canRedo, dirty: c.isDirty });
async function rejectedWithoutChange(c, input, code) {
  const before = state(c), text = c.textSession, transform = c.transformSession;
  const result = await c.executeGuarded(input);
  assert.equal(result.ok, false); assert.equal(result.error.code, code); assert.equal(result.error.mutated, false);
  assert.deepEqual(state(c), before); assert.equal(c.textSession, text); assert.equal(c.transformSession, transform);
  return result;
}

test('guarded decoded JSON uses the UI validator/commit/history and returns detached revision metadata', async () => {
  const c = new CommandController(fixture), ui = new CommandController(fixture);
  c.selectElement(textId); ui.selectElement(textId);
  const input = request(c), result = await c.executeGuarded(JSON.parse(JSON.stringify(input)));
  ui.setFill(shapeId, '#123456');
  assert.equal(result.ok, true); assert.equal(result.value.changed, true);
  assert.equal(result.value.previousRevision, 0); assert.equal(result.value.contentRevision, 1);
  assert.equal(result.value.viewRevision, c.viewRevision); assert.equal(result.value.operationId, input.operationId);
  assert.equal(result.value.editorSessionId, c.sessionId); assert.equal(c.selectedId, textId);
  assert.deepEqual(c.document, ui.document); assert.equal(c.undoCount, 1);
  result.value.document.title = 'mutated copy'; assert.notEqual(c.document.title, 'mutated copy');
  c.undo(); ui.undo(); assert.deepEqual(c.document, ui.document);
  c.redo(); ui.redo(); assert.deepEqual(c.document, ui.document);
});

test('missing/extra fields, invalid numbers and missing operation IDs are rejected before activity access', async () => {
  let reads = 0; const c = new CommandController(fixture, { activityProvider: () => { reads++; return {}; } });
  const valid = request(c); reads = 0;
  const inputs = [undefined, null, [], { ...valid, extra: true }, { ...valid, target: undefined },
    ...['target', 'expectedRevision', 'operationId', 'targeting', 'command'].map(key => { const v = { ...valid }; delete v[key]; return v; }),
    ...[-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '0'].map(expectedRevision => ({ ...valid, expectedRevision })),
    ...['', ' ', 'x'.repeat(257), 1].map(operationId => ({ ...valid, operationId })),
    { ...valid, targeting: 'automatic' }, { ...valid, expectedViewRevision: 0 }];
  for (const input of inputs) { const before = state(c); const result = await c.executeGuarded(input); assert.equal(result.ok, false); assert.equal(result.error.mutated, false); assert.deepEqual(state(c), before); }
  assert.equal(reads, 0);
});

test('request, target and command getters are never invoked and no caller callback is accepted', async () => {
  const c = new CommandController(fixture), valid = request(c); let invoked = 0;
  const top = { ...valid }; Object.defineProperty(top, 'operationId', { enumerable: true, get() { invoked++; return 'x'; } });
  const target = { ...valid.target }; Object.defineProperty(target, 'documentId', { enumerable: true, get() { invoked++; return 'x'; } });
  const command = { ...valid.command }; Object.defineProperty(command, 'params', { enumerable: true, get() { invoked++; return {}; } });
  for (const input of [top, { ...valid, target }, { ...valid, command }, { ...valid, beforeCommit: () => invoked++ }, { ...valid, [Symbol()]: 1 }]) {
    const result = await c.executeGuarded(input); assert.equal(result.ok, false); assert.equal(result.error.mutated, false);
  }
  assert.equal(invoked, 0); assert.equal(c.revision, 0); assert.equal(c.undoCount, 0);
});

test('two real concurrent preparations at the same revision yield exactly one changed commit', async () => {
  const c = new CommandController(fixture), a = request(c, fill('#112233')), b = request(c, fill('#aabbcc'), { operationId: 'second' });
  const results = await Promise.all([c.executeGuarded(a), c.executeGuarded(b)]);
  assert.equal(results.filter(r => r.ok && r.value.changed).length, 1);
  assert.equal(results[1].error.code, 'REVISION_CONFLICT'); assert.equal(c.revision, 1); assert.equal(c.undoCount, 1);
  assert.equal(c.document.slides[0].elements[1].fill, '#112233');
  await Promise.resolve(); assert.equal(c.revision, 1, 'Rejected work must never replay itself later');
});

test('human content edit during preparation wins and commit rechecks revision after await', async () => {
  const c = new CommandController(fixture), pending = c.executeGuarded(request(c));
  c.setTitle('사람이 먼저 확정'); const before = state(c);
  const result = await pending; assert.equal(result.error.code, 'REVISION_CONFLICT');
  assert.deepEqual(state(c), before); assert.equal(c.undoCount, 1);
});

test('request is detached before await so caller mutations cannot change command, target or preconditions', async () => {
  const c = new CommandController(fixture), input = request(c, fill('#112233'));
  const pending = c.executeGuarded(input);
  input.command.params.fill = '#aabbcc'; input.command.params.elementId = textId;
  input.target.editorSessionId = 'other'; input.expectedRevision = 999; input.operationId = 'changed'; input.targeting = 'selection';
  const result = await pending; assert.equal(result.ok, true); assert.equal(result.value.operationId, 'op-cas-test');
  assert.equal(c.document.slides[0].elements[1].fill, '#112233');
});

test('open textarea, changed draft and active IME each block even unrelated or no-op agent changes', async () => {
  for (const phase of ['clean', 'draft', 'ime']) {
    const c = new CommandController(fixture), input = request(c); c.beginText(textId);
    if (phase !== 'clean') c.updateText(['미확정 한글']); if (phase === 'ime') c.setComposing(true);
    const result = await rejectedWithoutChange(c, input, 'EDITOR_BUSY');
    assert.ok(result.error.busy.reasons.some(r => r.kind === 'text'));
    assert.equal(JSON.stringify(result).includes('미확정'), false);
    await rejectedWithoutChange(c, { ...input, command: fill(fixture.slides[0].elements[1].fill) }, 'EDITOR_BUSY');
  }
});

test('a draft or IME beginning after preparation is rejected without closing or committing it', async () => {
  for (const composing of [false, true]) {
    const c = new CommandController(fixture), pending = c.executeGuarded(request(c));
    c.beginText(textId); c.updateText(['한ㄱ']); c.setComposing(composing);
    const before = state(c), session = c.textSession;
    const result = await pending; assert.equal(result.error.code, 'EDITOR_BUSY');
    assert.deepEqual(state(c), before); assert.equal(c.textSession, session);
  }
});

test('move/resize previews are neither canceled nor committed by preflight or post-await rejection', async () => {
  for (const kind of ['move', 'resize']) for (const afterAwait of [false, true]) {
    const c = new CommandController(fixture), input = request(c);
    let pending; if (afterAwait) pending = c.executeGuarded(input);
    c.beginTransform(shapeId, kind); c.previewGeometry({ x: 173, width: 550 });
    const before = state(c), session = c.transformSession;
    const result = await (pending ?? c.executeGuarded(input)); assert.equal(result.error.code, 'EDITOR_BUSY');
    assert.deepEqual(state(c), before); assert.equal(c.transformSession, session);
    c.commitTransform(); assert.equal(c.revision, 1); assert.equal(c.undoCount, 1);
  }
});

test('title/property/color/external IME and app saving/opening/pending/initializing all block globally', async () => {
  for (const activity of [{ controls: [{ fieldId: 'document-title' }], pendingChanges: true },
    { controls: [{ fieldId: 'property-x', elementId: shapeId }], pendingChanges: true },
    { controls: [{ fieldId: 'property-fill', elementId: shapeId }] }, { composing: true },
    ...['initializing', 'saving', 'opening', 'pendingAction'].map(key => ({ [key]: true }))]) {
    let current = {};
    const c = new CommandController(fixture, { activityProvider: () => current }), input = request(c);
    current = activity; await rejectedWithoutChange(c, input, 'EDITOR_BUSY');
    current = {}; const pending = c.executeGuarded(input); current = activity;
    const before = state(c); const result = await pending;
    assert.equal(result.error.code, 'EDITOR_BUSY'); assert.deepEqual(state(c), before);
    current = {}; assert.equal((await c.executeGuarded(input)).ok, true, 'Fresh explicit request after input ends may succeed');
  }
});

test('presentation blocks both existing and newly started agent work and never exits presentation', async () => {
  const c = new CommandController(fixture), input = request(c), pending = c.executeGuarded(input);
  c.setPresentation({ slideId: c.activeSlideId });
  const before = c.readEditorState().value;
  assert.equal((await pending).error.code, 'EDITOR_BUSY'); await rejectedWithoutChange(c, input, 'EDITOR_BUSY');
  assert.deepEqual(c.readEditorState().value, before);
  c.setPresentation(null); assert.equal((await c.executeGuarded(input)).ok, true);
});

test('master/media and CSS/interaction studio activity blocks agent changes before preparation and before commit', async () => {
  for (const fieldId of ['workspace-properties', 'studio-properties']) {
    let activity = {};
    const c = new CommandController(fixture, { activityProvider: () => activity }), input = request(c);
    const committed = c.readCommittedSnapshot().value.document;
    activity = { controls: [{ fieldId, elementId: shapeId }], pendingChanges: true };
    const read = c.readCommittedSnapshot().value;
    assert.deepEqual(read.document, committed, 'Read keeps the committed document while workspace draft is pending');
    assert.equal(read.state.humanEditing, true); assert.equal(read.state.busy.active, true); assert.equal(read.state.dirty, true);
    assert.ok(read.state.busy.reasons.some(reason => reason.fieldId === fieldId && reason.kind === 'property'));
    await rejectedWithoutChange(c, input, 'EDITOR_BUSY');
    activity = {}; const pending = c.executeGuarded(input);
    activity = { controls: [{ fieldId, elementId: shapeId }] };
    const before = state(c), result = await pending;
    assert.equal(result.error.code, 'EDITOR_BUSY'); assert.deepEqual(state(c), before);
    activity = {}; assert.equal((await c.executeGuarded(input)).ok, true);
    assert.equal(c.undoCount, 1); c.undo(); assert.deepEqual(c.document, committed); c.redo(); assert.equal(c.revision, 3);
  }
});

test('workspace and studio drafts protect atomic batches, dry runs and guarded shared history', async () => {
  for (const fieldId of ['workspace-properties', 'studio-properties']) {
    let activity = {};
    const c = new CommandController(fixture, { activityProvider: () => activity });
    const busy = { controls: [{ fieldId, elementId: shapeId }], pendingChanges: true };
    const { command, ...guard } = request(c);
    for (const dryRun of [false, true]) {
      const input = { ...guard, commands: [command], dryRun };
      activity = busy; let before = state(c), result = await c.applyCommands(input);
      assert.equal(result.error.code, 'EDITOR_BUSY'); assert.equal(result.error.mutated, false); assert.deepEqual(state(c), before);
      activity = {}; const pending = c.applyCommands(input); activity = busy; before = state(c); result = await pending;
      assert.equal(result.error.code, 'EDITOR_BUSY'); assert.deepEqual(state(c), before);
    }
    activity = {}; c.setTitle('공동 이력 보호');
    for (const direction of ['undo', 'redo']) {
      const read = c.readEditorState().value;
      const expectedTopEntryId = direction === 'undo' ? read.state.history.topUndoEntryId : read.state.history.topRedoEntryId;
      const input = { target: guard.target, expectedRevision: c.revision, operationId: `${fieldId}-${direction}`, expectedTopEntryId };
      activity = busy; const before = state(c), result = await c[`${direction}Guarded`](input);
      assert.equal(result.error.code, 'EDITOR_BUSY'); assert.equal(result.error.mutated, false); assert.deepEqual(state(c), before);
      activity = {}; assert.equal((await c[`${direction}Guarded`](input)).ok, true);
    }
    assert.equal(c.document.title, '공동 이력 보호'); assert.equal(c.undoCount, 1); assert.equal(c.redoCount, 0);
  }
});

test('busy preflight fails immediately even if editing ends before the returned promise is awaited', async () => {
  const c = new CommandController(fixture), input = request(c); c.beginText(textId);
  const pending = c.executeGuarded(input); c.finishText();
  const result = await pending; assert.equal(result.error.code, 'EDITOR_BUSY');
  assert.equal(c.revision, 0); assert.equal(c.document.slides[0].elements[1].fill, fixture.slides[0].elements[1].fill);
});

test('reopen, reload identity and document mismatches reject old work including after await', async () => {
  const c = new CommandController(fixture), input = request(c), pending = c.executeGuarded(input);
  c.loadDocument(fixture); const before = state(c);
  assert.equal((await pending).error.code, 'STALE_EDITOR_SESSION'); assert.deepEqual(state(c), before);
  await rejectedWithoutChange(c, input, 'STALE_EDITOR_SESSION');
  const current = request(c);
  await rejectedWithoutChange(c, { ...current, target: { ...current.target, documentId: 'other' } }, 'DOCUMENT_MISMATCH');
  const reload = new CommandController(fixture); await rejectedWithoutChange(reload, current, 'INSTANCE_MISMATCH');
  const sameInstance = new CommandController(fixture, { instanceId: c.instanceId }); await rejectedWithoutChange(sameInstance, current, 'STALE_EDITOR_SESSION');
});

test('direct ID ignores selection/zoom view changes and never retargets the current selection', async () => {
  const c = new CommandController(fixture), input = request(c), pending = c.executeGuarded(input);
  c.selectElement(textId); c.setViewport({ mode: 'fixed', scale: 0.5 });
  const view = c.viewRevision; const result = await pending;
  assert.equal(result.ok, true); assert.equal(c.selectedId, textId); assert.equal(c.viewRevision, view);
  assert.equal(c.document.slides[0].elements[1].fill, '#123456');
});

test('selection intent requires view revision and matching element ID; selection ABA is stale', async () => {
  const c = new CommandController(fixture); c.selectElement(shapeId);
  const selection = request(c, fill('#123456'), { targeting: 'selection', expectedViewRevision: c.viewRevision });
  const missing = { ...selection }; delete missing.expectedViewRevision;
  await rejectedWithoutChange(c, missing, 'INVALID_PRECONDITION');
  await rejectedWithoutChange(c, { ...selection, command: { id: 'document.set_title', params: { title: 'x' } } }, 'INVALID_PRECONDITION');
  await rejectedWithoutChange(c, { ...selection, command: { id: 'element.set_geometry', params: { elementId: textId, geometry: { x: 20 } } } }, 'SELECTION_CONFLICT');
  c.selectElement(textId); c.selectElement(shapeId);
  await rejectedWithoutChange(c, selection, 'VIEW_REVISION_CONFLICT');
  const fresh = { ...selection, expectedViewRevision: c.viewRevision }, pending = c.executeGuarded(fresh);
  c.setViewport({ mode: 'fixed', scale: 0.7 }); const before = state(c);
  assert.equal((await pending).error.code, 'VIEW_REVISION_CONFLICT'); assert.deepEqual(state(c), before);
  const valid = request(c, { id: 'element.delete', params: { elementId: shapeId } }, { targeting: 'selection', expectedViewRevision: c.viewRevision });
  const result = await c.executeGuarded(valid); assert.equal(result.ok, true);
  assert.equal(result.value.viewRevision, c.viewRevision); assert.equal(c.selectedId, null);
});

test('Undo/Redo content ABA never reuses revision and guarded changes retain HTML IDs/assets', async () => {
  const c = new CommandController(fixture), old = request(c);
  c.setTitle('ABA'); c.undo(); assert.deepEqual(c.document, fixture); assert.equal(c.revision, 2);
  await rejectedWithoutChange(c, old, 'REVISION_CONFLICT');
  const result = await c.executeGuarded(request(c)); assert.equal(result.value.contentRevision, 3);
  const changed = cloneDocument(c.document); c.undo(); assert.equal(c.revision, 4); c.redo(); assert.equal(c.revision, 5);
  assert.deepEqual(c.document, changed); assert.deepEqual(parsePresentation(exportPresentation(c.snapshot())), changed);
  assert.deepEqual(c.document.assets, fixture.assets); assert.equal(c.document.id, fixture.id);
});

test('no-op and rejected semantic targets preserve redo, selection and saved signature', async () => {
  const c = new CommandController(fixture); c.setTitle('temporary'); c.undo(); c.markSaved(c.snapshot());
  const before = state(c);
  const noop = await c.executeGuarded(request(c, fill(fixture.slides[0].elements[1].fill)));
  assert.equal(noop.ok, true); assert.equal(noop.value.changed, false); assert.deepEqual(state(c), before);
  await rejectedWithoutChange(c, request(c, { id: 'shape.set_fill', params: { elementId: textId, fill: '#123' } }), 'TARGET_TYPE_MISMATCH');
  await rejectedWithoutChange(c, request(c, { id: 'shape.set_fill', params: { elementId: 'missing', fill: '#123' } }), 'TARGET_NOT_FOUND');
  await rejectedWithoutChange(c, request(c, { id: 'slide.create', params: { afterSlideId: 'missing', clientRef: 'x' } }), 'TARGET_NOT_FOUND');
  assert.equal(c.isDirty, false); assert.equal(c.redoCount, 1);
});

test('guard request validation returns a detached command and does not relax the registry limits', () => {
  const c = new CommandController(fixture), input = request(c);
  const checked = validateGuardedCommand(input); assert.equal(checked.ok, true);
  checked.value.target.documentId = 'detached'; checked.value.command.params.fill = '#000';
  assert.equal(input.target.documentId, c.document.id); assert.equal(input.command.params.fill, '#123456');
  assert.equal(validateGuardedCommand(request(c, { id: 'text.set_content', params: { elementId: textId, paragraphs: ['x'.repeat(65537)] } })).ok, false);
});
