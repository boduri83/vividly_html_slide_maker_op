import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { CommandController } from '../src/controller.js';
import { normalizeDocument, WORKBENCH_SCHEMA, elementBounds } from '../src/model.js';
import { exportPresentation, parsePresentation } from '../src/format.js';
import { resolveElementAppearance } from '../src/render.js';

const fixture = JSON.parse(readFileSync(new URL('../examples/document-contract-v0.1.json', import.meta.url), 'utf8'));
const title = 'element-title-001', shape = 'element-shape-001', image = 'element-image-001';
const find = (c, id) => c.document.slides.flatMap(s => s.elements).find(e => e.id === id);
const request = c => { const r = c.readCommittedSnapshot().value; return { target: { instanceId: r.instanceId, editorSessionId: r.editorSessionId, documentId: r.documentId }, expectedRevision: c.revision, operationId: 'workbench', targeting: 'id', command: { id: 'shape.set_fill', params: { elementId: shape, fill: '#abcdef' } } }; };

test('v1 remains identical; supported fields promote only on edit and future/unknown fields fail without loss', () => {
  const c = new CommandController(fixture); assert.deepEqual(c.document, fixture);
  c.setRotation(shape, 0); c.setElementFlags(shape, { locked: false });
  assert.equal(c.undoCount, 0); assert.equal(c.document.schemaVersion, fixture.schemaVersion);
  c.setElementFlags(shape, { name: '마케팅 카드', locked: true });
  assert.equal(c.document.schemaVersion, WORKBENCH_SCHEMA); assert.equal(find(c, shape).name, '마케팅 카드');
  const saved = structuredClone(c.document); c.undo(); assert.deepEqual(c.document, fixture); c.redo(); assert.deepEqual(c.document, saved);
  assert.deepEqual(parsePresentation(exportPresentation(saved)), saved);
  for (const mutate of [d => d.schemaVersion = '9.0', d => d.slides[0].elements[0].futureMotion = {}, d => d.theme = { colors: {}, fontFamily: 'Arial' }]) {
    const input = structuredClone(fixture); mutate(input); assert.throws(() => normalizeDocument(input));
  }
  assert.equal(c.readCapabilities().value.unknownFields, 'reject-without-mutation');
});

test('multi selection and group geometry preview stay uncommitted, reject guarded writes, and commit exactly one Undo', async () => {
  const c = new CommandController(fixture); c.selectElements([title, shape]); const before = structuredClone(c.document);
  const selected = c.selectedIds; assert.deepEqual(c.readEditorState().value.state.selectedElementIds, selected);
  const revision = c.revision, undo = c.undoCount;
  c.beginMultiTransform(selected, 'move');
  const updates = c.selectedElements.map(e => ({ elementId: e.id, geometry: { ...e.geometry, x: e.geometry.x + 100, y: e.geometry.y + 35 } }));
  c.previewMultiGeometry(updates); assert.deepEqual(c.readCommittedSnapshot().value.document, before);
  const rejected = await c.executeGuarded(request(c)); assert.equal(rejected.error.code, 'EDITOR_BUSY');
  assert.equal(c.revision, revision); assert.equal(c.undoCount, undo);
  c.commitTransform(); assert.equal(c.undoCount, undo + 1); assert.equal(c.revision, revision + 1);
  const after = structuredClone(c.document); c.undo(); assert.deepEqual(c.document, before); assert.deepEqual(c.selectedIds, selected);
  c.redo(); assert.deepEqual(c.document, after); assert.deepEqual(c.selectedIds, selected);
  c.beginMultiTransform(selected, 'resize'); c.cancelTransform(); assert.deepEqual(c.document, after);
});

test('group selection expands members; group and ungroup plus resize/rotation are reversible operations', () => {
  const c = new CommandController(fixture); c.selectElements([title, shape]); const group = c.groupElements(c.selectedIds);
  assert.equal(find(c, title).groupId, group); assert.equal(find(c, shape).groupId, group);
  c.selectElements([]); c.selectElements([shape]); assert.deepEqual(c.selectedIds, [title, shape]);
  c.toggleSelection(shape); assert.deepEqual(c.selectedIds, []); c.toggleSelection(title); assert.deepEqual(c.selectedIds, [title, shape]);
  c.selectElements([shape], { expandGroups: false }); assert.deepEqual(c.selectedIds, [shape]);
  const titleGeometry = structuredClone(find(c, title).geometry);
  c.beginMultiTransform([shape], 'move');
  c.previewMultiGeometry([{ elementId: shape, geometry: { ...find(c, shape).geometry, x: 150 } }]);
  assert.deepEqual(c.transformSession.elementIds, [shape]); c.commitTransform();
  assert.deepEqual(find(c, title).geometry, titleGeometry); c.undo();
  c.selectElements([shape]); const before = structuredClone(c.document), bounds = c.selectionBounds;
  c.transformElements(c.selectedIds, { rotation: 90 });
  assert.equal(find(c, title).rotation, 90); assert.equal(find(c, shape).rotation, 90);
  assert.ok(Math.abs(elementBounds(c.selectedElements).width - bounds.height) < 0.00001);
  c.undo(); assert.deepEqual(c.document, before); c.redo();
  c.ungroupElements(c.selectedIds); assert.equal(find(c, title).groupId, undefined); c.undo(); assert.equal(find(c, title).groupId, group);
});

test('alignment uses logical rotated bounds; distribution yields equal gaps and one history entry', () => {
  const c = new CommandController(fixture), a = c.addShape(), b = c.addShape(), d = c.addShape();
  c.setElementsGeometry([{ elementId: a, geometry: { x: 10, y: 20, width: 50, height: 80 } }, { elementId: b, geometry: { x: 100, y: 40, width: 100, height: 80 } }, { elementId: d, geometry: { x: 410, y: 60, width: 90, height: 80 } }]);
  const before = structuredClone(c.document), undo = c.undoCount; c.distributeElements([a, b, d], 'horizontal');
  assert.equal(find(c, b).geometry.x, 185); assert.equal(c.undoCount, undo + 1);
  c.undo(); assert.deepEqual(c.document, before); c.redo();
  c.alignElements([a, b, d], 'bottom', 'selection'); assert.ok([a, b, d].every(id => find(c, id).geometry.y === 60));
  c.setRotation(a, 90); c.alignElements([a], 'left', 'slide'); assert.ok(Math.abs(elementBounds([find(c, a)]).x) < 0.00001);
  const count = c.undoCount; c.alignElements([a], 'left', 'slide'); assert.equal(c.undoCount, count);
});

test('locked commands reject atomically, selection skips locked/hidden, and flag edits can unlock', () => {
  const c = new CommandController(fixture); c.setElementFlags(shape, { locked: true });
  const before = structuredClone(c.document), undo = c.undoCount;
  for (const command of [
    { id: 'shape.set_fill', params: { elementId: shape, fill: '#123456' } },
    { id: 'shape.set_stroke', params: { elementId: shape, stroke: { width: 9 } } },
    { id: 'elements.delete', params: { elementIds: [title, shape] } },
  ]) { assert.equal(c.execute(command).error.code, 'TARGET_LOCKED'); assert.deepEqual(c.document, before); assert.equal(c.undoCount, undo); }
  c.selectElements([title, shape]); assert.deepEqual(c.selectedIds, [title]);
  c.setElementFlags(title, { hidden: true }); c.selectElements([title, shape]); assert.deepEqual(c.selectedIds, []);
  c.setElementFlags(shape, { locked: false }); c.selectElements([shape]); assert.deepEqual(c.selectedIds, [shape]);
  c.selectElements([title, shape], { includeHidden: true }); c.groupElements(c.selectedIds);
  c.selectElements([shape]); assert.deepEqual(c.selectedIds, []);
  c.selectElements([shape], { expandGroups: false }); c.beginMultiTransform([shape], 'move'); c.cancelTransform();
});

test('clipboard remaps group/node IDs, preserves image bytes, and cut/paste/format are reversible', () => {
  const c = new CommandController(fixture), addedImage = c.addImage(fixture.assets[0]);
  c.selectElements([shape, addedImage]); c.groupElements(c.selectedIds);
  const payload = c.copyElements([shape]); assert.equal(payload.elements.length, 2); const before = structuredClone(c.document), undo = c.undoCount;
  const pasted = c.pasteElements(payload); assert.equal(pasted.length, 2); assert.equal(c.undoCount, undo + 1);
  assert.ok(pasted.every(id => !payload.elements.some(e => e.id === id)));
  const copy = find(c, pasted[0]); assert.notEqual(copy.groupId, payload.elements[0].groupId);
  assert.equal(copy.geometry.x, payload.elements[0].geometry.x + 24); assert.deepEqual(c.document.assets, fixture.assets);
  c.undo(); assert.deepEqual(c.document, before); c.redo(); assert.deepEqual(c.selectedIds, pasted);
  const format = c.copyFormat(shape); c.pasteFormat([pasted[0]], format); assert.equal(find(c, pasted[0]).fill, find(c, shape).fill);
  c.deleteElements(pasted); assert.ok(pasted.every(id => !find(c, id))); c.undo(); assert.ok(pasted.every(id => find(c, id)));
});

test('theme references retain local overrides; CSS effects, crop/source and image replacement roundtrip without asset mutation', () => {
  const c = new CommandController(fixture); const theme = { colors: { primary: '#781af0', secondary: '#fcba03', background: '#ffffff', text: '#171717' }, fontFamily: 'Arial' };
  c.setTheme(theme); c.setThemeRefs(shape, { fill: 'primary', textColor: 'text', fontFamily: true });
  c.setFill(shape, '#abcdef'); assert.equal(find(c, shape).themeRefs.fill, undefined); assert.equal(find(c, shape).themeRefs.fontFamily, true);
  c.setVisualStyle(shape, { opacity: 0.7, radius: 24, gradient: { type: 'linear', angle: 35, stops: [{ offset: 0, color: '#123456' }, { offset: 1, color: '#abcdef' }] }, shadow: { x: 3, y: 5, blur: 12, spread: 0, color: '#00000055' } });
  c.setImageProperties(image, { crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.7 }, focal: { x: 0.3, y: 0.8 }, source: '자산 출처 설명' });
  const before = structuredClone(c.document); c.replaceImage(image, fixture.assets[0]); assert.deepEqual(c.document, before);
  assert.deepEqual(parsePresentation(exportPresentation(c.document)), c.document); assert.deepEqual(c.document.assets, fixture.assets);
  const invalid = c.execute({ id: 'image.set_properties', params: { elementId: image, properties: { crop: { x: 0.8, y: 0, width: 0.5, height: 1 } } } });
  assert.equal(invalid.ok, false); assert.deepEqual(c.document, before);
  c.setVisualStyle(shape, { gradient: null, shadow: null }); assert.equal(find(c, shape).style.gradient, undefined); c.undo(); assert.deepEqual(c.document, before);
});

test('multiple slides duplicate/import with ID/group remapping and shared assets; ordering/deletion/canvas policy undo correctly', () => {
  const c = new CommandController(fixture); c.selectElements([title, shape]); c.groupElements(c.selectedIds);
  c.setSlideProperties('slide-001', { name: '소개', section: '제품' });
  const before = structuredClone(c.document), copies = c.duplicateSlides(['slide-001', 'slide-002']);
  assert.equal(copies.length, 2); assert.equal(c.document.slides.length, 5); assert.deepEqual(c.document.assets, fixture.assets);
  const duplicated = c.document.slides.find(s => s.id === copies[0]); assert.equal(duplicated.section, '제품');
  assert.notEqual(duplicated.elements[0].groupId, find(c, title).groupId);
  const ids = c.document.slides.flatMap(s => [s.id, ...s.elements.map(e => e.id)]); assert.equal(new Set(ids).size, ids.length);
  c.undo(); assert.deepEqual(c.document, before); c.redo();
  c.moveSlides(copies, 0); assert.deepEqual(c.document.slides.slice(0, 2).map(s => s.id), copies);
  c.deleteSlides(copies); assert.equal(c.document.slides.length, 3); c.undo(); assert.equal(c.document.slides.length, 5);
  const geometry = structuredClone(find(c, shape).geometry); c.resizeCanvas(640, 360, 'scale'); assert.equal(find(c, shape).geometry.width, geometry.width / 2);
  c.undo(); assert.deepEqual(find(c, shape).geometry, geometry);
  c.resizeCanvas(1920, 1080, 'keep'); assert.deepEqual(find(c, shape).geometry, geometry);
});

test('trusted multi-property batch creates one Undo; a late failure preserves a human Korean draft', () => {
  const c = new CommandController(fixture); const before = structuredClone(c.document);
  c.runBatch([{ id: 'shape.set_fill', params: { elementId: shape, fill: '#abcdef' } }, { id: 'text.set_style', params: { elementId: title, style: { fontSize: 60 } } }], '선택 속성 편집');
  assert.equal(c.undoCount, 1); c.undo(); assert.deepEqual(c.document, before); c.redo();
  c.beginText(title); c.updateText(['한글 임시']); const draft = c.textSession, undo = c.undoCount;
  assert.throws(() => c.runBatch([{ id: 'shape.set_fill', params: { elementId: shape, fill: '#123456' } }, { id: 'shape.set_fill', params: { elementId: title, fill: '#123456' } }]));
  assert.equal(c.textSession, draft); assert.equal(c.undoCount, undo); assert.deepEqual(c.textSession.draft.paragraphs, ['한글 임시']);
});

test('local clipboard stages large image bytes outside the JSON command budget and recovery forces unsaved state', () => {
  const source = new CommandController(fixture), original = fixture.assets[0];
  const data = Buffer.concat([Buffer.from(original.dataBase64, 'base64'), Buffer.alloc(300000)]);
  const incoming = { ...original, id: 'asset-local-large', bytes: data.length, sha256: createHash('sha256').update(data).digest('hex'), dataBase64: data.toString('base64') };
  const id = source.addImage(incoming), payload = source.copyElements([id]);
  const destination = new CommandController(); const before = structuredClone(destination.document), added = destination.pasteElements(payload);
  assert.equal(added.length, 1); assert.equal(destination.document.assets.length, 1); assert.equal(destination.document.assets[0].dataBase64, incoming.dataBase64);
  assert.equal(destination.undoCount, 1); destination.undo(); assert.deepEqual(destination.document, before); destination.redo();
  const saved = destination.snapshot(); destination.loadDocument(saved); assert.equal(destination.isDirty, false);
  destination.markUnsaved(); assert.equal(destination.isDirty, true); assert.equal(destination.undoCount, 0);
});

test('a late future document load leaves the current dirty document, session, selection and history intact', () => {
  const c = new CommandController(fixture); c.setElementFlags(shape, { name: '보존할 수정' }); c.selectElements([title, shape]);
  const before = structuredClone({ document: c.document, session: c.sessionId, selection: c.selectedIds, undo: c.undoCount, dirty: c.isDirty });
  for (const mutate of [d => d.schemaVersion = '0.9-future', d => d.slides[0].elements[0].futureInteraction = { execute: 'something' }, d => d.slides[0].elements[0].style = { futureFilter: 1 }]) {
    const future = structuredClone(c.document); mutate(future); assert.throws(() => c.loadDocument(future));
    assert.deepEqual({ document: c.document, session: c.sessionId, selection: c.selectedIds, undo: c.undoCount, dirty: c.isDirty }, before);
  }
});

test('brand theme changes preserve explicit color/font overrides and cross-document paste keeps source appearance', () => {
  const c = new CommandController(fixture), theme = { colors: { primary: '#781af0', secondary: '#fcba03', background: '#ffffff', text: '#171717' }, fontFamily: 'Arial' };
  c.setTheme(theme); c.setThemeRefs(shape, { fill: 'primary' }); c.setThemeRefs(title, { textColor: 'text', fontFamily: true });
  c.setTextStyle(title, { color: '#123456', fontFamily: 'Georgia' }); c.setFill(shape, '#abcdef');
  c.setTheme({ colors: { ...theme.colors, primary: '#ff0000', text: '#00ff00' }, fontFamily: 'Malgun Gothic' });
  const appearance = resolveElementAppearance(find(c, title), c.document); assert.equal(appearance.fontFamily, 'Georgia'); assert.equal(appearance.textColor, '#123456');
  assert.equal(resolveElementAppearance(find(c, shape), c.document).fill, '#abcdef');
  c.setThemeRefs(shape, { fill: 'primary' }); const payload = c.copyElements([shape]), target = new CommandController();
  target.setTheme(theme); const [copied] = target.pasteElements(payload);
  assert.equal(find(target, copied).themeRefs, undefined); assert.equal(find(target, copied).fill, '#ff0000');
});

test('binding the first branded object creates a valid default theme before renderer use', () => {
  const c = new CommandController(fixture); assert.equal(c.document.theme, undefined);
  c.setThemeRefs(shape, { fill: 'primary' });
  assert.equal(resolveElementAppearance(find(c, shape), c.document).fill, '#2563eb');
  assert.deepEqual(parsePresentation(exportPresentation(c.document)), c.document);
  c.undo(); assert.deepEqual(c.document, fixture);
});

test('layer order moves the selected set together and preserves internal order with one Undo', () => {
  const c = new CommandController(fixture), a = c.addShape(), b = c.addShape();
  const before = c.activeSlide.elements.map(e => e.id), undo = c.undoCount;
  c.moveElements([shape, a], 1);
  assert.deepEqual(c.activeSlide.elements.map(e => e.id), [title, b, shape, a]);
  assert.equal(c.undoCount, undo + 1); c.undo(); assert.deepEqual(c.activeSlide.elements.map(e => e.id), before);
  c.moveElements([shape, a], -1); assert.deepEqual(c.activeSlide.elements.map(e => e.id), [shape, a, title, b]);
});

test('committed resolved styles are detached, revision-bound and exclude Korean composition and geometry previews', () => {
  const c = new CommandController(fixture); c.setThemeRefs(shape, { fill: 'primary', textColor: 'text', fontFamily: true });
  const first = c.readCommittedSnapshot().value, refs = structuredClone(find(c, shape).themeRefs);
  const expected = first.resolvedStyles.find(row => row.elementId === shape);
  assert.equal(expected.slideId, 'slide-001'); assert.equal(expected.appearance.fill, '#2563eb');
  assert.deepEqual(find(c, shape).themeRefs, refs);
  const handle = Object.fromEntries(['instanceId', 'editorSessionId', 'documentId'].map(key => [key, first[key]]));
  c.beginText(shape); c.updateText(['한글 미확정']); c.setComposing(true);
  const before = structuredClone({ document: c.document, revision: c.revision, undo: c.undoCount, dirty: c.isDirty }), session = c.textSession;
  for (let index = 0; index < 3; index++) {
    const read = c.readResolvedStyles(handle).value;
    assert.deepEqual(read.resolvedStyles.find(row => row.elementId === shape), expected);
    assert.equal(read.contentRevision, first.contentRevision); assert.equal(JSON.stringify(read).includes('미확정'), false);
    read.resolvedStyles[0].appearance.color = 'outside';
    assert.equal(c.textSession, session);
    assert.deepEqual({ document: c.document, revision: c.revision, undo: c.undoCount, dirty: c.isDirty }, before);
  }
  c.setComposing(false); c.finishText();
  c.beginMultiTransform([shape], 'rotate'); c.previewMultiGeometry([{ elementId: shape, geometry: find(c, shape).geometry, rotation: 45 }]);
  const during = c.readResolvedStyles(handle).value;
  assert.equal(during.resolvedStyles.find(row => row.elementId === shape).appearance.rotation, 0);
  c.commitTransform(); const committed = c.readResolvedStyles(handle).value;
  assert.equal(committed.resolvedStyles.find(row => row.elementId === shape).appearance.rotation, 45);
  assert.ok(committed.contentRevision > during.contentRevision);
});
