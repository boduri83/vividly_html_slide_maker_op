import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CommandController } from '../src/controller.js';
import { cloneDocument } from '../src/model.js';
import { exportPresentation, parsePresentation } from '../src/format.js';

const fixture = JSON.parse(readFileSync(new URL('../examples/document-contract-v0.1.json', import.meta.url), 'utf8'));
const textId = 'element-title-001', shapeId = 'element-shape-001';
const handle = value => Object.fromEntries(['instanceId', 'editorSessionId', 'documentId'].map(key => [key, value[key]]));
const read = (c, target) => { const result = c.readCommittedSnapshot(target); assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const state = c => cloneDocument({ document: c.document, textSession: c.textSession, transformSession: c.transformSession,
  active: c.activeSlideId, selected: c.selectedId, contentRevision: c.contentRevision, viewRevision: c.viewRevision,
  undo: c.undoCount, redo: c.redoCount, dirty: c.isDirty, canUndo: c.canUndo, canRedo: c.canRedo });

test('committed document, handle, revisions and every returned nested object are detached', () => {
  const c = new CommandController(fixture); c.beginText(textId); const before = state(c), session = c.textSession;
  const first = read(c); assert.deepEqual(first.document, fixture); assert.equal(first.contractVersion, 'vividly.read/0.1');
  assert.equal(first.documentId, fixture.id); assert.equal(first.editorSessionId, c.sessionId);
  first.document.slides[0].elements[0].text.paragraphs[0] = 'outside mutation'; first.document.assets[0].dataBase64 = 'changed';
  first.state.selectedElementIds.push('changed'); first.state.viewport.scale = 7; first.state.busy.reasons[0].kind = 'changed';
  const second = read(c, handle(first)); assert.deepEqual(second.document, fixture); assert.deepEqual(state(c), before); assert.equal(c.textSession, session);
  assert.deepEqual(second.state.selectedElementIds, [textId]);
});

test('repeated reads during each Korean IME fragment expose no draft and do not finish or modify the composition', () => {
  const c = new CommandController(fixture); c.beginText(textId); c.setComposing(true);
  for (const fragment of ['ㅎ', '하', '한', '한ㄱ', '한그', '한글']) {
    c.updateText([fragment]); const before = state(c), session = c.textSession;
    for (let index = 0; index < 8; index++) {
      const result = read(c); assert.deepEqual(result.document, fixture); assert.equal(result.contentRevision, 0);
      assert.ok(result.state.busy.reasons.some(reason => reason.kind === 'ime' && reason.elementId === textId));
      assert.equal(Object.hasOwn(result.state, 'textSession'), false); assert.equal(result.state.humanEditing, true);
      assert.deepEqual(state(c), before); assert.equal(c.textSession, session);
    }
    assert.throws(() => c.snapshot());
  }
  assert.equal(c.textSession.composing, true); assert.equal(c.undoCount, 0);
});

test('save snapshots retain uncommitted text while committed reads, saved status and text Undo keep their existing semantics', () => {
  const c = new CommandController(fixture); c.beginText(textId); c.updateText(['한글 저장 초안', '', '  줄\n끝  ']);
  const saved = c.snapshot(); assert.deepEqual(read(c).document, fixture); assert.notDeepEqual(saved, fixture); assert.equal(c.undoCount, 0);
  assert.deepEqual(parsePresentation(exportPresentation(saved)), saved); c.markSaved(saved); assert.equal(c.isDirty, false);
  assert.deepEqual(read(c).document, fixture); c.finishText(); assert.equal(c.contentRevision, 1); assert.equal(c.undoCount, 1); assert.equal(c.isDirty, false);
  assert.deepEqual(read(c).document, saved); c.undo(); assert.equal(read(c).contentRevision, 2); assert.deepEqual(read(c).document, fixture);
  c.redo(); assert.equal(read(c).contentRevision, 3); assert.deepEqual(read(c).document, saved); assert.equal(c.isDirty, false);
});

test('drag and resize reads exclude preview geometry, preserve the gesture, and observe only commit or cancel', () => {
  for (const kind of ['move', 'resize']) {
    const c = new CommandController(fixture); c.beginTransform(shapeId, kind);
    c.previewGeometry({ x: 765, width: 610 }); const before = state(c), session = c.transformSession;
    for (let index = 0; index < 10; index++) {
      const result = read(c); assert.deepEqual(result.document, fixture); assert.equal(result.contentRevision, 0);
      assert.ok(result.state.busy.reasons.some(reason => reason.kind === (kind === 'move' ? 'drag' : 'resize')));
      assert.equal('preview' in result.state, false); assert.deepEqual(state(c), before); assert.equal(c.transformSession, session);
    }
    assert.throws(() => c.snapshot()); c.cancelTransform(); assert.deepEqual(read(c).document, fixture); assert.equal(c.undoCount, 0);
    c.beginTransform(shapeId, kind); c.previewGeometry({ x: 765, width: 610 }); c.commitTransform();
    assert.equal(read(c).document.slides[0].elements[1].geometry.x, 765); assert.equal(c.contentRevision, 1); assert.equal(c.undoCount, 1);
    c.undo(); assert.deepEqual(read(c).document, fixture); c.redo(); assert.equal(read(c).document.slides[0].elements[1].geometry.width, 610);
  }
});

test('title/property/color/IME/file activity is metadata only and does not leak pending values or host paths', () => {
  const secret = 'SECRET_PENDING_TITLE_OR_PATH'; let activity = { controls: [
    { fieldId: 'document-title', raw: secret }, { fieldId: 'property-x', elementId: shapeId, raw: secret },
    { fieldId: 'property-fill', elementId: shapeId, preview: secret }, { fieldId: secret, elementId: secret },
  ], pendingChanges: true, composing: true, saving: true, opening: true, pendingAction: true, filePath: secret, token: secret };
  const c = new CommandController(fixture, { activityProvider: () => activity }); const before = state(c);
  const result = read(c); assert.deepEqual(result.document, fixture); assert.equal(JSON.stringify(result).includes(secret), false);
  for (const kind of ['title', 'property', 'colorControl', 'ime', 'saving', 'opening', 'pendingAction']) assert.ok(result.state.busy.reasons.some(reason => reason.kind === kind));
  assert.equal(result.state.dirty, true); assert.deepEqual(state(c), before); activity = {};
  assert.equal(read(c).state.busy.active, false); assert.equal(c.isDirty, false);
});

test('view revisions track selection, slide, zoom and presentation without changing content revision or history', () => {
  const c = new CommandController(fixture); const initial = read(c); c.selectElement(shapeId); const selected = c.viewRevision;
  assert.equal(selected, initial.viewRevision + 1); c.selectElement(shapeId); assert.equal(c.viewRevision, selected);
  c.beginText(shapeId); c.updateText(['draft']); c.setComposing(true); assert.equal(c.viewRevision, selected); c.setComposing(false);
  c.setViewport({ mode: 'fixed', scale: 1.25 }); assert.equal(c.viewRevision, selected + 1); c.setViewport({ mode: 'fixed', scale: 1.25 }); assert.equal(c.viewRevision, selected + 1);
  c.setPresentation({ slideId: 'slide-002' }); assert.equal(c.viewRevision, selected + 2);
  const shown = read(c); assert.deepEqual(shown.state.presentation, { active: true, slideId: 'slide-002' }); assert.equal(shown.state.activeSlideId, 'slide-001');
  assert.ok(shown.state.busy.reasons.some(reason => reason.kind === 'presentation'));
  c.setPresentation(null); assert.equal(c.viewRevision, selected + 3); assert.equal(c.contentRevision, 0); assert.equal(c.undoCount, 0);
  c.finishText(); const committed = c.contentRevision; c.switchSlide('slide-003'); assert.equal(c.contentRevision, committed);
});

test('reads and commands execute in call order with matching content and revision; no query creates history', () => {
  const c = new CommandController(fixture); const first = read(c);
  c.setFill(shapeId, '#123456'); const afterFirst = read(c, handle(first)); c.setFill(shapeId, '#abcdef'); const afterSecond = read(c);
  c.undo(); const afterUndo = read(c); c.redo(); const afterRedo = read(c);
  assert.deepEqual([first, afterFirst, afterSecond, afterUndo, afterRedo].map(result => result.contentRevision), [0, 1, 2, 3, 4]);
  assert.deepEqual([first, afterFirst, afterSecond, afterUndo, afterRedo].map(result => result.document.slides[0].elements[1].fill), ['#16a34a', '#123456', '#abcdef', '#123456', '#abcdef']);
  assert.equal(c.undoCount, 2); assert.equal(c.redoCount, 0);
});

test('same-document reopen rejects its previous editor-session handle and old save acknowledgements', () => {
  const c = new CommandController(fixture); const old = read(c); c.setTitle('changed'); const saved = c.snapshot(); c.loadDocument(fixture);
  const before = state(c); assert.equal(c.readCommittedSnapshot(handle(old)).error.code, 'STALE_EDITOR_SESSION'); assert.deepEqual(state(c), before);
  assert.notEqual(c.sessionId, old.editorSessionId); assert.equal(c.viewRevision, 0); assert.equal(c.contentRevision, 0);
  c.setTitle('later'); assert.equal(c.markSaved(saved, old.editorSessionId), false); assert.equal(c.isDirty, true); assert.equal(read(c).document.title, 'later');
});

test('new renderer/controller rejects old handles even when its trusted instance ID is reused', () => {
  const old = new CommandController(fixture, { instanceId: 'window-owned-1' }); const oldHandle = handle(read(old));
  const reloaded = new CommandController(fixture, { instanceId: 'window-owned-1' });
  assert.equal(reloaded.readCommittedSnapshot(oldHandle).error.code, 'STALE_EDITOR_SESSION');
  const other = new CommandController(fixture); assert.notEqual(other.instanceId, old.instanceId);
  assert.equal(other.readEditorState(oldHandle).error.code, 'INSTANCE_MISMATCH');
});

test('malformed targets and getters fail before provider access without reflecting private input', () => {
  let calls = 0, getterCalled = false; const c = new CommandController(fixture, { activityProvider: () => { calls++; return {}; } }); const valid = handle(read(c)); calls = 0;
  const getter = { ...valid }; Object.defineProperty(getter, 'documentId', { enumerable: true, get() { getterCalled = true; return fixture.id; } });
  for (const target of [null, 'selector', {}, { ...valid, unknown: 'secret' }, { ...valid, documentId: '' }, getter]) assert.equal(c.readCommittedSnapshot(target).error.code, 'INVALID_TARGET');
  assert.equal(c.readCommittedSnapshot({ ...valid, documentId: 'another' }).error.code, 'DOCUMENT_MISMATCH');
  assert.equal(calls, 0); assert.equal(getterCalled, false); assert.equal(c.undoCount, 0);
});

test('state-only queries omit document content, stay detached and never consume redo', () => {
  const c = new CommandController(fixture); c.setFill(shapeId, '#123'); c.undo(); const before = state(c);
  const result = c.readEditorState(); assert.equal(result.ok, true); assert.equal('document' in result.value, false);
  result.value.state.history.redoCount = 99; result.value.state.selectedElementIds.push('changed');
  assert.deepEqual(state(c), before); assert.equal(c.redoCount, 1); c.redo(); assert.equal(read(c).document.slides[0].elements[1].fill, '#123');
});

test('a reentrant activity provider is refused before mutation and the queue recovers after a failed read', () => {
  let reenter = true; let c;
  c = new CommandController(fixture, { activityProvider: () => { if (reenter) c.setTitle('unexpected'); return {}; } });
  const before = state(c); assert.throws(() => c.readCommittedSnapshot(), /재진입/); assert.deepEqual(state(c), before);
  reenter = false; assert.deepEqual(read(c).document, fixture); c.setTitle('normal'); assert.equal(read(c).document.title, 'normal');
});
