import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CommandController } from '../src/controller.js';
import { exportPresentation, parsePresentation } from '../src/format.js';
import { renderSlideContent } from '../src/render.js';

const fixture = JSON.parse(readFileSync(new URL('../examples/document-contract-v0.1.json', import.meta.url), 'utf8'));
const text = 'element-title-001', shape = 'element-shape-001', image = 'element-image-001';
const target = c => { const r = c.readCommittedSnapshot().value; return { instanceId: r.instanceId, editorSessionId: r.editorSessionId, documentId: r.documentId }; };

test('manual properties and JSON commands produce identical content with reversible individual edits and HTML roundtrip', () => {
  const ui = new CommandController(fixture), json = new CommandController(fixture);
  const edits = [
    [() => ui.setTextStyle(text, { lineHeight: 1.8, verticalAlign: 'bottom' }), 'text.set_style', { elementId: text, style: { lineHeight: 1.8, verticalAlign: 'bottom' } }],
    [() => ui.setShapeKind(shape, 'ellipse'), 'shape.set_kind', { elementId: shape, shape: 'ellipse' }],
    [() => ui.setStroke(shape, { width: 0 }), 'shape.set_stroke', { elementId: shape, stroke: { width: 0 } }],
    [() => ui.setSlideBackground('slide-001', '#f2e8ff'), 'slide.set_background', { slideId: 'slide-001', background: '#f2e8ff' }],
    [() => ui.setImageProperties(image, { fit: 'cover', alt: '한글 이미지 <설명> & "인용"' }), 'image.set_properties', { elementId: image, properties: { fit: 'cover', alt: '한글 이미지 <설명> & "인용"' } }],
  ];
  for (const [edit, id, params] of edits) {
    const before = structuredClone(ui.document); edit();
    assert.equal(json.execute({ id, params }).ok, true);
    assert.deepEqual(ui.document, json.document);
    const after = structuredClone(ui.document); ui.undo(); assert.deepEqual(ui.document, before); ui.redo(); assert.deepEqual(ui.document, after);
  }
  assert.equal(ui.undoCount, edits.length);
  assert.deepEqual(ui.document.assets, fixture.assets);
  assert.deepEqual(parsePresentation(exportPresentation(ui.document)), ui.document);
  const rendered = ui.document.slides.map(slide => renderSlideContent(slide, ui.document)).join('');
  assert.match(rendered, /line-height:1.8/); assert.match(rendered, /justify-content:flex-end/);
  assert.match(rendered, /border:0px solid/); assert.match(rendered, /border-radius:50%/);
  assert.match(rendered, /object-fit:cover/); assert.match(rendered, /한글 이미지 &lt;설명&gt; &amp; &quot;인용&quot;/);
});

test('invalid shape kind and targets leave a live Korean draft, history and assets untouched', () => {
  const c = new CommandController(fixture); c.beginText(text); c.updateText(['한글 임시 입력']);
  const before = structuredClone({ document: c.document, draft: c.textSession, revision: c.revision, undo: c.undoCount, redo: c.redoCount });
  for (const [id, params, code] of [
    ['shape.set_kind', { elementId: shape, shape: 'not-a-shape' }, 'INVALID_COMMAND'],
    ['shape.set_kind', { elementId: text, shape: 'ellipse' }, 'TARGET_TYPE_MISMATCH'],
    ['shape.set_stroke', { elementId: shape, stroke: { width: -1 } }, 'INVALID_COMMAND'],
    ['text.set_style', { elementId: text, style: { lineHeight: 0 } }, 'INVALID_COMMAND'],
    ['image.set_properties', { elementId: image, properties: { fit: 'stretch' } }, 'INVALID_COMMAND'],
  ]) {
    assert.equal(c.execute({ id, params }).error.code, code);
    assert.deepEqual({ document: c.document, draft: c.textSession, revision: c.revision, undo: c.undoCount, redo: c.redoCount }, before);
  }
  c.finishText(); const id = c.addShape('ellipse'); assert.equal(c.selectedElement.shape, 'ellipse');
  const created = structuredClone(c.document); c.undo(); c.redo(); assert.equal(c.selectedId, id); assert.deepEqual(c.document, created);
  const undo = c.undoCount; assert.throws(() => c.addShape('not-a-shape')); assert.deepEqual(c.document, created); assert.equal(c.undoCount, undo);
});

test('all new property controls protect human focus and background metadata does not disclose draft values', async () => {
  let activity = {};
  const c = new CommandController(fixture, { activityProvider: () => activity });
  for (const fieldId of ['property-line-height', 'property-vertical-align', 'property-shape', 'property-stroke-width', 'property-image-fit', 'property-image-alt', 'property-slide-background']) {
    activity = { controls: [{ fieldId, elementId: image, slideId: 'slide-001', raw: 'private composition', filePath: 'secret' }] };
    const read = c.readEditorState().value.state;
    assert.equal(read.busy.active, true); assert.equal(read.humanEditing, true);
    assert.equal(JSON.stringify(read).includes('private composition'), false); assert.equal(JSON.stringify(read).includes('secret'), false);
    const reason = read.busy.reasons.find(r => r.fieldId === fieldId);
    assert.equal(reason.slideId, 'slide-001'); assert.equal(reason.kind, fieldId === 'property-slide-background' ? 'colorControl' : 'property');
    const before = structuredClone(c.document);
    const result = await c.executeGuarded({ target: target(c), expectedRevision: c.revision, operationId: 'human-property', targeting: 'id', command: { id: 'shape.set_kind', params: { elementId: shape, shape: 'ellipse' } } });
    assert.equal(result.error.code, 'EDITOR_BUSY'); assert.equal(result.error.mutated, false); assert.deepEqual(c.document, before);
  }
});
