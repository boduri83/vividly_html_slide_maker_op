import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CommandController } from '../src/controller.js';
import { EditorStore, cloneDocument } from '../src/model.js';
import { exportPresentation, parsePresentation } from '../src/format.js';

const fixture = JSON.parse(readFileSync(new URL('../examples/document-contract-v0.1.json', import.meta.url), 'utf8'));
const textId = 'element-title-001', shapeId = 'element-shape-001';
const state = c => cloneDocument({ document: c.document, textSession: c.textSession, transformSession: c.transformSession,
  active: c.activeSlideId, selected: c.selectedId, revision: c.revision, undo: c.undoCount, redo: c.redoCount, dirty: c.isDirty });

test('UI convenience and decoded JSON share strict validation, identical content, history and errors', () => {
  const ui = new CommandController(fixture), json = new CommandController(fixture);
  ui.setGeometry(shapeId, { x: 170, width: 540 }); ui.setFill(shapeId, '#9F16A2');
  for (const command of [
    { id: 'element.set_geometry', params: { elementId: shapeId, geometry: { x: 170, width: 540 } } },
    { id: 'shape.set_fill', params: { elementId: shapeId, fill: '#9F16A2' } },
  ]) assert.equal(json.execute(JSON.parse(JSON.stringify(command))).ok, true);
  assert.deepEqual(state(ui), state(json));
  assert.equal(ui.undoCount, 2); ui.undo(); json.undo(); assert.deepEqual(state(ui), state(json));
  const before = state(ui);
  assert.throws(() => ui.setGeometry(shapeId, { width: 0 }), error => error.code === 'INVALID_COMMAND');
  assert.equal(json.execute({ id: 'element.set_geometry', params: { elementId: shapeId, geometry: { x: 7, css: 'x' } } }).error.code, 'INVALID_COMMAND');
  assert.deepEqual(state(ui), before); assert.deepEqual(state(json), before);
  assert.equal(ui.transact, undefined); assert.equal(ui.updateElement, undefined);
});

test('invalid target during text editing does not commit draft, close session, change selection or history', () => {
  const c = new CommandController(fixture); c.beginText(textId); c.updateText(['한글 draft']);
  const before = state(c), session = c.textSession;
  assert.equal(c.execute({ id: 'shape.set_fill', params: { elementId: textId, fill: '#123' } }).error.code, 'TARGET_TYPE_MISMATCH');
  assert.deepEqual(state(c), before); assert.equal(c.textSession, session);
});

test('IME blocks mutations/history/session replacement atomically while saved snapshot remains distinct from committed content', () => {
  const c = new CommandController(fixture); c.beginText(textId); c.updateText(['하']); c.setComposing(true);
  const before = state(c), sessionId = c.sessionId;
  assert.equal(c.execute({ id: 'shape.set_fill', params: { elementId: shapeId, fill: '#123' } }).error.code, 'EDITOR_BUSY');
  for (const operation of [() => c.finishText(), () => c.undo(), () => c.redo(), () => c.addText(), () => c.addShape(),
    () => c.switchSlide('slide-002'), () => c.selectElement(shapeId), () => c.loadDocument(fixture), () => c.snapshot()]) {
    assert.throws(operation); assert.deepEqual(state(c), before); assert.equal(c.sessionId, sessionId);
  }
  c.setComposing(false); c.updateText(['한글', '', '  끝\n줄  ']);
  const saved = c.snapshot(); assert.notDeepEqual(saved, c.document); assert.equal(c.undoCount, 0);
  c.markSaved(saved); assert.equal(c.isDirty, false);
  c.finishText(); assert.deepEqual(c.document, saved); assert.equal(c.undoCount, 1); assert.equal(c.isDirty, false);
  c.undo(); assert.deepEqual(c.document.slides[0].elements[0].text.paragraphs, fixture.slides[0].elements[0].text.paragraphs);
  c.redo(); assert.deepEqual(c.document, saved);
});

test('finishing a text draft then changing style creates the same two Undo steps and never overwrites the draft', () => {
  const c = new CommandController(fixture); c.beginText(textId); c.updateText(['한글 123']);
  c.setTextStyle(textId, { bold: true });
  assert.equal(c.textSession, null); assert.equal(c.undoCount, 2);
  assert.deepEqual(c.selectedElement.text.paragraphs, ['한글 123']); assert.equal(c.selectedElement.text.textStyle.bold, true);
  c.undo(); assert.deepEqual(c.selectedElement.text.paragraphs, ['한글 123']); assert.equal(c.selectedElement.text.textStyle.bold, undefined);
  c.undo(); assert.deepEqual(c.document, fixture); c.redo(); c.redo(); assert.equal(c.selectedElement.text.textStyle.bold, true);
});

test('shape without a text payload can acquire its first text via the same validated finish command', () => {
  const input = cloneDocument(fixture); delete input.slides[0].elements[1].text;
  const c = new CommandController(input); c.beginText(shapeId); c.updateText(['도형 한글']); c.finishText();
  assert.deepEqual(c.selectedElement.text.paragraphs, ['도형 한글']); c.undo(); assert.equal(c.selectedElement.text, undefined); c.redo();
  assert.deepEqual(parsePresentation(exportPresentation(c.document)), c.document);
});

test('move/resize preview, no-op/cancel and one commit preserve original geometry history and selection', () => {
  const c = new CommandController(fixture); c.selectElement(shapeId); const before = state(c);
  c.beginTransform(shapeId, 'move'); c.previewGeometry({ x: 300, y: 320 });
  const busy = state(c);
  assert.equal(c.execute({ id: 'document.set_title', params: { title: 'late' } }).error.code, 'EDITOR_BUSY');
  assert.deepEqual(state(c), busy); assert.equal(c.undoCount, 0);
  c.cancelTransform(); assert.deepEqual(state(c), before);
  c.beginTransform(shapeId, 'resize'); c.previewGeometry({ width: 550 }); assert.equal(c.commitTransform(), true);
  assert.equal(c.undoCount, 1); assert.equal(c.transformSession, null); assert.equal(c.selectedElement.geometry.width, 550);
  c.undo(); assert.equal(c.selectedId, shapeId); assert.equal(c.selectedElement.geometry.width, 500);
  c.redo(); const revision = c.revision; c.beginTransform(shapeId, 'move'); assert.equal(c.commitTransform(), false); assert.equal(c.revision, revision);
});

test('implicit text commits through selection, creation, slide switching and Undo retain legacy Store behavior', () => {
  for (const operation of [c => c.selectElement(shapeId), c => c.switchSlide('slide-002'), c => c.undo(), c => c.beginTransform(shapeId, 'move')]) {
    const c = new CommandController(fixture), old = new EditorStore(fixture);
    for (const target of [c, old]) { target.beginText(textId); target.updateText(['한글', '둘째 문단']); operation(target); }
    assert.deepEqual(state(c), state(old));
  }
  const c = new CommandController(fixture); c.beginText(textId); c.updateText(['새 제목']); const id = c.addText();
  assert.equal(c.undoCount, 2); assert.equal(c.selectedId, id); c.undo(); assert.deepEqual(c.document.slides[0].elements[0].text.paragraphs, ['새 제목']);
  c.undo(); assert.deepEqual(c.document, fixture);
});

test('create/duplicate/delete/reorder preserve stable IDs, shared assets, selected objects and active-slide restoration', () => {
  const c = new CommandController(fixture); c.selectElement(shapeId); const copy = c.duplicateElement(shapeId);
  c.undo(); c.redo(); assert.equal(c.selectedId, copy); c.deleteElement(copy); c.undo(); assert.equal(c.selectedId, copy);
  c.moveElement(copy, -1); assert.equal(c.activeSlide.elements.at(-2).id, copy); c.undo(); assert.equal(c.activeSlide.elements.at(-1).id, copy);
  c.switchSlide('slide-003'); c.deleteSlide('slide-003'); assert.equal(c.activeSlideId, 'slide-002'); c.undo(); assert.equal(c.activeSlideId, 'slide-003');
  const asset = cloneDocument(fixture.assets[0]); const image = c.addImage(asset); assert.equal(c.document.assets.length, 1);
  c.undo(); c.redo(); assert.equal(c.selectedId, image); assert.deepEqual(c.document.assets, fixture.assets);
  const slide = c.duplicateSlide(c.activeSlideId); c.undo(); c.redo(); assert.equal(c.activeSlideId, slide);
});

test('no-op/failed commands preserve redo and saved status; reopened session ignores old save acknowledgements', () => {
  const c = new CommandController(fixture); c.setFill(shapeId, '#9f16a2'); c.undo();
  const before = state(c); assert.equal(c.setFill(shapeId, '#16A34A'), false); assert.deepEqual(state(c), before);
  assert.equal(c.execute({ id: 'unknown', params: {} }).ok, false); assert.deepEqual(state(c), before);
  c.redo(); const saved = c.snapshot(), session = c.sessionId; c.markSaved(saved); c.setTitle('다음 수정');
  assert.equal(c.isDirty, true); c.loadDocument(parsePresentation(exportPresentation(saved))); assert.notEqual(c.sessionId, session);
  c.setTitle('재편집'); assert.equal(c.markSaved(saved, session), false); assert.equal(c.isDirty, true);
});

test('a failed text commit retains the entire visible draft and history for correction', () => {
  const c = new CommandController(fixture); c.beginText(textId); c.updateText(['x'.repeat(65537)]);
  const before = state(c), session = c.textSession;
  assert.throws(() => c.finishText()); assert.deepEqual(state(c), before); assert.equal(c.textSession, session);
  c.updateText(['수정한 내용']); c.finishText(); assert.equal(c.undoCount, 1);
});
