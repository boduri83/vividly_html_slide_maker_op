import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cloneDocument, normalizeDocument, createBlankDocument, EditorStore } from '../src/model.js';

const example = JSON.parse(readFileSync(new URL('../examples/document-contract-v0.1.json', import.meta.url), 'utf8'));
const fixture = () => cloneDocument(example);
const textId = example.slides[0].elements[0].id;

test('normalize preserves literal text, paragraphs, whitespace, and normalizes CRLF without mutating input', () => {
  const input = fixture();
  input.slides[0].elements[0].text.paragraphs = ['  <>&"\' </script>\r\n한글\r끝  ', ''];
  input.selection = { id: textId };
  input.viewport = { zoom: 2 };
  const normalized = normalizeDocument(input);
  assert.deepEqual(normalized.slides[0].elements[0].text.paragraphs, ['  <>&"\' </script>\n한글\n끝  ', '']);
  assert.equal(input.slides[0].elements[0].text.paragraphs[0].includes('\r'), true);
  assert.equal('selection' in normalized, false);
  assert.equal('viewport' in normalized, false);
  normalized.slides[0].elements[0].geometry.x = 999;
  assert.equal(input.slides[0].elements[0].geometry.x, 80);
});

test('normalize rejects unsupported format/type, duplicate identities, invalid geometry and missing assets', () => {
  const mutations = [
    (doc) => { doc.schemaVersion = 'unknown'; },
    (doc) => { doc.slides[0].elements[0].type = 'iframe'; },
    (doc) => { doc.slides[1].id = doc.slides[0].id; },
    (doc) => { doc.slides[0].elements[0].id = doc.assets[0].id; },
    (doc) => { doc.canvas.width = Infinity; },
    (doc) => { doc.slides[0].elements[0].geometry.x = NaN; },
    (doc) => { doc.slides[0].elements[0].geometry.width = 0; },
    (doc) => { doc.slides[0].elements[1].fill = '#12345'; },
    (doc) => { doc.slides[0].elements[0].text.textStyle.fontFamily = 'Arial\u0000Invalid'; },
    (doc) => { doc.slides[0].elements[0].text.textStyle.bold = 'true'; },
    (doc) => { doc.slides[1].elements[1].assetId = 'missing'; },
    (doc) => { doc.assets[0].bytes += 1; },
    (doc) => { doc.assets[0].mimeType = 'image/svg+xml'; },
    (doc) => { doc.slides = []; },
  ];
  for (const mutate of mutations) { const input = fixture(); mutate(input); assert.throws(() => normalizeDocument(input)); }
  const valid = fixture();
  valid.slides[0].elements[1].shape = 'ellipse';
  valid.slides[0].elements[0].text.textStyle.bold = true;
  assert.equal(normalizeDocument(valid).slides[0].elements[0].text.textStyle.bold, true);
});

test('selection, slide switching and no-op transactions never create document history', () => {
  const store = new EditorStore(fixture());
  store.selectElement(textId);
  store.selectElement(null);
  store.switchSlide(store.document.slides[1].id);
  store.transact('noop', () => {});
  assert.equal(store.undoCount, 0);
  assert.equal(store.revision, 0);
  assert.equal(store.isDirty, false);
});

test('text snapshot includes draft without commit/history and saved content keeps the text Undo baseline', () => {
  const store = new EditorStore(fixture());
  const initial = cloneDocument(store.document.slides[0].elements[0].text);
  store.beginText(textId);
  store.updateText(['저장한 초안', '', '  <>& </script>  ']);
  const snapshot = store.snapshot();
  assert.deepEqual(snapshot.slides[0].elements[0].text.paragraphs, ['저장한 초안', '', '  <>& </script>  ']);
  assert.deepEqual(store.document.slides[0].elements[0].text, initial);
  assert.equal(store.undoCount, 0);
  assert.equal(store.textSession.elementId, textId);
  assert.equal(store.isDirty, true);
  store.markSaved(snapshot);
  assert.equal(store.isDirty, false);
  store.finishText();
  assert.equal(store.undoCount, 1);
  assert.equal(store.isDirty, false);
  store.undo();
  assert.deepEqual(store.document.slides[0].elements[0].text, initial);
  assert.equal(store.isDirty, true);
  store.redo();
  assert.deepEqual(store.document, snapshot);
  assert.equal(store.isDirty, false);
});

test('one document Undo while editing finishes and undoes exactly the changed text session', () => {
  const store = new EditorStore(fixture());
  store.updateElement(textId, { geometry: { x: 150 } });
  const geometry = cloneDocument(store.selectedElement?.geometry ?? store.document.slides[0].elements[0].geometry);
  store.beginText(textId);
  store.updateText(['텍스트 변경']);
  assert.equal(store.canUndo, true);
  store.undo();
  assert.equal(store.textSession, null);
  assert.deepEqual(store.document.slides[0].elements[0].geometry, geometry);
  assert.deepEqual(store.document.slides[0].elements[0].text, example.slides[0].elements[0].text);
  assert.equal(store.undoCount, 1);
  assert.equal(store.redoCount, 1);
});

test('IME composition blocks snapshot, finish, switch, mutation, Undo and document replacement atomically', () => {
  const store = new EditorStore(fixture());
  store.beginText(textId);
  store.setComposing(true);
  store.updateText(['조합중']);
  const baseline = cloneDocument(store.document);
  const sessionId = store.sessionId;
  for (const action of [() => store.snapshot(), () => store.finishText(), () => store.undo(), () => store.addShape(), () => store.switchSlide(store.document.slides[1].id), () => store.loadDocument(createBlankDocument())]) assert.throws(action, /조합/);
  assert.deepEqual(store.document, baseline);
  assert.equal(store.undoCount, 0);
  assert.equal(store.sessionId, sessionId);
  assert.equal(store.textSession.composing, true);
  store.setComposing(false);
  store.finishText();
  assert.equal(store.undoCount, 1);
  assert.equal(store.document.slides[0].elements[0].text.paragraphs[0], '조합중');
});

test('move preview/cancel and no-op commits preserve document and redo; changed commit is one entry', () => {
  const store = new EditorStore(fixture());
  const original = cloneDocument(store.document.slides[0].elements[0].geometry);
  store.updateElement(textId, { geometry: { x: 150 } });
  store.undo();
  const baseline = cloneDocument(store.document);
  store.beginTransform(textId, 'move');
  store.previewGeometry({ x: original.x + 200 });
  assert.deepEqual(store.document, baseline);
  assert.equal(store.undoCount, 0);
  assert.equal(store.redoCount, 1);
  assert.equal(store.isDirty, false);
  assert.throws(() => store.snapshot(), /조작/);
  store.cancelTransform();
  assert.deepEqual(store.document, baseline);
  assert.equal(store.redoCount, 1);
  store.beginTransform(textId, 'move');
  store.previewGeometry({ x: original.x });
  assert.equal(store.commitTransform(), false);
  assert.equal(store.redoCount, 1);
  store.beginTransform(textId, 'resize');
  store.previewGeometry({ width: original.width + 60, height: original.height + 40 });
  store.commitTransform();
  assert.equal(store.undoCount, 1);
  assert.equal(store.redoCount, 0);
  store.undo();
  assert.deepEqual(store.document, baseline);
  store.redo();
  assert.equal(store.document.slides[0].elements[0].geometry.width, original.width + 60);
});

test('transform begins after text finish and geometry cancel keeps the separately committed text', () => {
  const store = new EditorStore(fixture());
  store.beginText(textId);
  store.updateText(['도형 이동 전에 확정']);
  store.beginTransform(textId, 'move');
  store.previewGeometry({ x: 500 });
  store.cancelTransform();
  assert.equal(store.undoCount, 1);
  assert.equal(store.document.slides[0].elements[0].text.paragraphs[0], '도형 이동 전에 확정');
  assert.equal(store.document.slides[0].elements[0].geometry.x, 80);
});

test('element duplicate has a new ID and independent text/geometry, Undo/Redo restore original copy ID', () => {
  const store = new EditorStore(fixture());
  const copyId = store.duplicateElement(textId);
  assert.notEqual(copyId, textId);
  assert.equal(store.undoCount, 1);
  store.updateElement(copyId, { text: { paragraphs: ['복제본만 수정'], textStyle: { bold: true } }, geometry: { x: 333 } });
  assert.deepEqual(store.document.slides[0].elements[0].text, example.slides[0].elements[0].text);
  assert.equal(store.selectedElement.text.textStyle.bold, true);
  store.undo();
  store.undo();
  assert.equal(store.document.slides[0].elements.some((item) => item.id === copyId), false);
  store.redo();
  assert.equal(store.document.slides[0].elements.at(-1).id, copyId);
});

test('image insertion/duplicate reuse immutable asset content and Undo restores asset references', () => {
  const store = new EditorStore(createBlankDocument());
  const image = cloneDocument(example.assets[0]);
  const firstId = store.addImage(image);
  const savedAssetId = store.selectedElement.assetId;
  const secondId = store.addImage(image);
  const duplicateId = store.duplicateElement(firstId);
  assert.notEqual(firstId, secondId);
  assert.notEqual(duplicateId, firstId);
  assert.equal(store.document.assets.length, 1);
  assert.equal(store.selectedElement.assetId, savedAssetId);
  assert.deepEqual(store.document.assets[0].dataBase64, image.dataBase64);
  store.undo(); store.undo(); store.undo();
  assert.equal(store.document.assets.length, 0);
  store.redo();
  assert.equal(store.document.assets[0].id, savedAssetId);
  assert.equal(store.document.slides[0].elements[0].id, firstId);
});

test('slide duplicate refreshes slide/node IDs while sharing asset IDs and preserves order on undo/redo', () => {
  const store = new EditorStore(fixture());
  const original = store.document.slides[1];
  const newSlideId = store.duplicateSlide(original.id);
  const duplicate = store.activeSlide;
  assert.notEqual(newSlideId, original.id);
  assert.equal(duplicate.elements.length, original.elements.length);
  duplicate.elements.forEach((element, index) => assert.notEqual(element.id, original.elements[index].id));
  assert.equal(duplicate.elements[1].assetId, original.elements[1].assetId);
  assert.equal(store.document.assets.length, 1);
  const copyIds = duplicate.elements.map((element) => element.id);
  store.undo();
  assert.equal(store.document.slides.some((slide) => slide.id === newSlideId), false);
  store.redo();
  assert.deepEqual(store.activeSlide.elements.map((element) => element.id), copyIds);
  store.moveSlide(newSlideId, -2);
  assert.equal(store.document.slides[0].id, newSlideId);
  store.undo();
  assert.equal(store.document.slides[2].id, newSlideId);
});

test('slide add/delete retain at least one slide and restore active slide on Undo', () => {
  const store = new EditorStore(createBlankDocument());
  const first = store.activeSlideId;
  assert.equal(store.deleteSlide(first), false);
  assert.equal(store.undoCount, 0);
  const second = store.addSlide();
  assert.equal(store.activeSlideId, second);
  store.deleteSlide(second);
  assert.equal(store.activeSlideId, first);
  store.undo();
  assert.equal(store.activeSlideId, second);
  store.redo();
  assert.equal(store.document.slides.length, 1);
});

test('saved signature remains dirty after later edit and ignores an older document session', () => {
  const store = new EditorStore(fixture());
  store.updateElement(textId, { geometry: { x: 100 } });
  const candidate = store.snapshot();
  const sessionId = store.sessionId;
  store.updateElement(textId, { geometry: { x: 200 } });
  store.markSaved(candidate, sessionId);
  assert.equal(store.isDirty, true);
  store.undo();
  assert.equal(store.isDirty, false);
  store.loadDocument(createBlankDocument());
  const newSessionId = store.sessionId;
  assert.notEqual(newSessionId, sessionId);
  assert.equal(store.markSaved(candidate, sessionId), false);
  assert.equal(store.isDirty, false);
  assert.equal(store.undoCount, 0);
  assert.equal(store.selectedId, null);
});

test('invalid transaction rolls back the entire candidate and committed history is capped at 100', () => {
  const store = new EditorStore(fixture());
  const baseline = store.snapshot();
  assert.throws(() => store.transact('invalid', (doc) => { doc.title = 'partial'; doc.slides[0].elements[0].geometry.x = Infinity; }));
  assert.deepEqual(store.document, baseline);
  assert.equal(store.undoCount, 0);
  for (let index = 0; index < 105; index += 1) store.updateElement(textId, { geometry: { x: 500 + index } });
  assert.equal(store.undoCount, 100);
  assert.equal(store.revision, 105);
});

test('delete Undo restores the selected object and Redo clears the removed selection', () => {
  const store = new EditorStore(fixture());
  store.selectElement(textId);
  store.deleteElement(textId);
  assert.equal(store.selectedId, null);
  assert.equal(store.selectedElement, null);
  assert.equal(store.undoCount, 1);
  store.selectElement(store.activeSlide.elements[0].id);
  store.undo();
  assert.equal(store.selectedId, textId);
  assert.equal(store.selectedElement.id, textId);
  assert.equal(store.activeSlide.elements.some((element) => element.id === textId), true);
  store.redo();
  assert.equal(store.selectedId, null);
  assert.equal(store.selectedElement, null);
  assert.equal(store.activeSlide.elements.some((element) => element.id === textId), false);
});

test('element add and duplicate history capture their post-commit selection', () => {
  const store = new EditorStore(fixture());
  store.selectElement(textId);
  const addedId = store.addText();
  assert.equal(store.selectedId, addedId);
  store.undo();
  assert.equal(store.selectedId, textId);
  store.redo();
  assert.equal(store.selectedId, addedId);
  const duplicatedId = store.duplicateElement(addedId);
  assert.equal(store.selectedId, duplicatedId);
  store.undo();
  assert.equal(store.selectedId, addedId);
  store.redo();
  assert.equal(store.selectedId, duplicatedId);
});

test('slide add, duplicate and delete history restore active slide and selection together', () => {
  const store = new EditorStore(fixture());
  const originalSlideId = store.activeSlideId;
  store.selectElement(textId);
  const addedId = store.addSlide();
  assert.equal(store.selectedId, null);
  store.undo();
  assert.equal(store.activeSlideId, originalSlideId);
  assert.equal(store.selectedId, textId);
  store.redo();
  assert.equal(store.activeSlideId, addedId);
  assert.equal(store.selectedId, null);
  store.switchSlide(originalSlideId);
  store.selectElement(textId);
  const duplicatedId = store.duplicateSlide(originalSlideId);
  assert.equal(store.activeSlideId, duplicatedId);
  assert.equal(store.selectedId, null);
  store.undo();
  assert.equal(store.activeSlideId, originalSlideId);
  assert.equal(store.selectedId, textId);
  store.redo();
  assert.equal(store.activeSlideId, duplicatedId);
  assert.equal(store.selectedId, null);
  const copiedElementId = store.activeSlide.elements[0].id;
  store.selectElement(copiedElementId);
  store.deleteSlide(duplicatedId);
  assert.equal(store.selectedId, null);
  store.undo();
  assert.equal(store.activeSlideId, duplicatedId);
  assert.equal(store.selectedId, copiedElementId);
  store.redo();
  assert.notEqual(store.activeSlideId, duplicatedId);
  assert.equal(store.selectedId, null);
});
