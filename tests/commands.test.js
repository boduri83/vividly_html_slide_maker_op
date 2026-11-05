import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cloneDocument, EditorStore, normalizeDocument } from '../src/model.js';
import { exportPresentation, parsePresentation } from '../src/format.js';
import { COMMAND_CONTRACT_VERSION, evaluateCommand, getCommandCatalog, validateCommand } from '../src/commands.js';

const fixture = JSON.parse(readFileSync(new URL('../examples/document-contract-v0.1.json', import.meta.url), 'utf8'));
const textId = 'element-title-001';
const shapeId = 'element-shape-001';
const imageId = 'element-image-001';
const command = (id, params) => ({ id, params });
const apply = (doc, id, params) => {
  const result = evaluateCommand(doc, command(id, params));
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.value;
};
function unchangedFailure(input, code, document = cloneDocument(fixture)) {
  const store = new EditorStore(document);
  store.beginText(textId); store.updateText(['미확정 한글']); store.setComposing(true);
  const before = cloneDocument({ ...store });
  const result = evaluateCommand(store.document, input);
  assert.equal(result.ok, false, JSON.stringify(input));
  assert.equal(result.error.code, code);
  assert.deepEqual({ ...store }, before, 'failure must not touch draft, selection, revision, dirty or history');
  return result;
}

test('catalog distinguishes implemented candidates, pilot eligibility and public creation contracts', () => {
  const catalog = getCommandCatalog();
  assert.equal(catalog.length,106);
  assert.equal(new Set(catalog.map(entry => entry.id)).size, catalog.length);
  assert.deepEqual(catalog.filter(entry => entry.exposure === 'pilot').map(entry => entry.id), ['element.set_geometry', 'shape.set_fill']);
  assert.ok(catalog.every(entry => entry.contractVersion === COMMAND_CONTRACT_VERSION && entry.availability === 'candidate-only'));
  const all = getCommandCatalog({ includeReserved: true });
  assert.equal(all.length,106);
  assert.equal(all.filter(entry => entry.availability === 'reserved').length, 0);
  catalog[0].inputSchema.properties.title.type = 'number';
  catalog[0].outputSchema.oneOf.pop();
  assert.equal(getCommandCatalog()[0].inputSchema.properties.title.type, 'string');
  assert.equal(getCommandCatalog()[0].outputSchema.oneOf.length, 2);
});

test('unknown commands, extra envelope/parameter/nested fields and unsupported values fail before any model mutation', () => {
  const cases = [
    [command('eval', {}), 'UNKNOWN_COMMAND'],
    [{ ...command('shape.set_fill', { elementId: shapeId, fill: '#123' }), actor: 'administrator' }, 'INVALID_COMMAND'],
    [command('shape.set_fill', { elementId: shapeId, fill: '#123', selector: '.selected' }), 'INVALID_COMMAND'],
    [command('element.set_geometry', { elementId: shapeId, geometry: { x: 3, css: 'display:none' } }), 'INVALID_COMMAND'],
    [command('element.set_geometry', { elementId: shapeId, geometry: {} }), 'INVALID_COMMAND'],
    [command('element.set_geometry', { elementId: shapeId, geometry: { width: 0 } }), 'INVALID_COMMAND'],
    [command('shape.set_fill', { elementId: shapeId, fill: 'url(javascript:alert(1))' }), 'INVALID_COMMAND'],
    [command('shape.set_fill', { elementId: shapeId }), 'INVALID_COMMAND'],
    [command('text.set_style', { elementId: textId, style: { fontFamily: 'Arial\u0000' } }), 'INVALID_COMMAND'],
    [command('text.set_style', { elementId: textId, style: { fontFamily: '   ' } }), 'INVALID_COMMAND'],
    [command('text.set_style', { elementId: textId, style: { bold: 'true' } }), 'INVALID_COMMAND'],
    [command('image.set_properties', { elementId: imageId, properties: { fit: 'fill' } }), 'INVALID_COMMAND'],
    [command('slide.move', { slideId: 'slide-001', delta: 0.5 }), 'INVALID_COMMAND'],
    [command('slide.move', { slideId: 'slide-001', delta: 2147483648 }), 'INVALID_COMMAND'],
    [command('shape.set_fill', { elementId: ' ', fill: '#123' }), 'INVALID_COMMAND'],
    [{ id: 'shape.set_fill', params: null }, 'INVALID_COMMAND'],
    [null, 'INVALID_COMMAND'],
  ];
  for (const [input, code] of cases) unchangedFailure(input, code);
});

test('JavaScript-only values, prototype keys, sparse arrays, cycles and getters are rejected without invoking callbacks', () => {
  let invoked = false;
  const getter = { elementId: shapeId };
  Object.defineProperty(getter, 'fill', { enumerable: true, get() { invoked = true; return '#123'; } });
  const cycle = {}; cycle.cycle = cycle;
  const extraArray = ['text']; extraArray.other = 'extra';
  const symbol = command('shape.set_fill', { elementId: shapeId, fill: '#123' }); symbol[Symbol('actor')] = 'x';
  const hidden = command('shape.set_fill', { elementId: shapeId, fill: '#123' }); Object.defineProperty(hidden, 'hidden', { value: 'x' });
  const invalid = [undefined, () => { invoked = true; }, NaN, Infinity, -Infinity, 1n, new Date(), new Map(), cycle];
  for (const value of invalid) assert.equal(validateCommand(command('document.set_title', { title: value })).ok, false);
  for (const input of [command('shape.set_fill', getter), symbol, hidden,
    JSON.parse('{"id":"document.set_title","params":{"__proto__":{"polluted":true}}}'),
    JSON.parse('{"id":"document.set_title","params":{"constructor":"bad"}}'),
    ...[Array(2), [, 'x'], ['x', ,], extraArray].map(paragraphs => command('text.set_content', { elementId: textId, paragraphs }))])
    assert.equal(validateCommand(input).ok, false);
  assert.equal(invoked, false);
  assert.equal({}.polluted, undefined);
});

test('resource limits reject deep/wide/large UTF-8 payloads while accepting ordinary Korean text', () => {
  let deep = {}; for (let index = 0; index < 40; index++) deep = { next: deep };
  for (const input of [deep, Array(10001).fill(1), command('text.set_content', { elementId: textId, paragraphs: Array(4).fill('한'.repeat(30000)) })])
    assert.equal(validateCommand(input).error.code, 'LIMIT_EXCEEDED');
  assert.equal(validateCommand(command('text.set_content', { elementId: textId, paragraphs: ['한글 🙂 e\u0301'] })).ok, true);
});

test('JSON Schema string lengths count Unicode code points consistently for supplementary characters', () => {
  const emoji = '🙂'.repeat(40000); // 80,000 UTF-16 units, within 65,536 code points and 256 KiB.
  const result = validateCommand(command('text.set_content', { elementId: textId, paragraphs: [emoji] }));
  assert.equal(result.ok, true);
  assert.equal(result.value.params.paragraphs[0], emoji);
  assert.equal(validateCommand(command('document.set_title', { title: 'a'.repeat(65537) })).error.code, 'INVALID_COMMAND');
});

test('missing or wrong-type targets are explicit failures with zero state changes', () => {
  unchangedFailure(command('element.set_geometry', { elementId: 'missing', geometry: { x: 10 } }), 'TARGET_NOT_FOUND');
  unchangedFailure(command('slide.delete', { slideId: 'missing' }), 'TARGET_NOT_FOUND');
  unchangedFailure(command('shape.set_fill', { elementId: textId, fill: '#123' }), 'TARGET_TYPE_MISMATCH');
  unchangedFailure(command('text.set_content', { elementId: imageId, paragraphs: ['text'] }), 'TARGET_TYPE_MISMATCH');
  unchangedFailure(command('image.set_properties', { elementId: shapeId, properties: { alt: 'x' } }), 'TARGET_TYPE_MISMATCH');
  const bareShape = cloneDocument(fixture); delete bareShape.slides[0].elements[1].text;
  unchangedFailure(command('text.set_style', { elementId: shapeId, style: { bold: true } }), 'TARGET_TYPE_MISMATCH', bareShape);
});

test('the same direct-ID pilot command works as a local object or JSON transport and ignores current selection', () => {
  const store = new EditorStore(fixture); store.switchSlide('slide-002'); store.selectElement(imageId);
  const before = cloneDocument({ ...store });
  for (const input of [command('element.set_geometry', { elementId: shapeId, geometry: { x: -21.5, width: 250 } }), command('shape.set_fill', { elementId: shapeId, fill: '#AbC8' })]) {
    const local = evaluateCommand(store.document, input);
    const transported = evaluateCommand(store.document, JSON.parse(JSON.stringify(input)));
    assert.deepEqual(transported, local);
    assert.equal(local.ok, true);
    assert.equal(local.value.changed, true);
  }
  assert.deepEqual({ ...store }, before);
});

test('partial geometry and stroke updates preserve unrelated fields, text and asset bytes', () => {
  const before = cloneDocument(fixture);
  const moved = apply(before, 'element.set_geometry', { elementId: shapeId, geometry: { y: 80, height: 160 } });
  const updated = apply(moved.document, 'shape.set_stroke', { elementId: shapeId, stroke: { width: 0 } });
  const expected = cloneDocument(fixture);
  Object.assign(expected.slides[0].elements[1].geometry, { y: 80, height: 160 });
  expected.slides[0].elements[1].stroke.width = 0;
  assert.deepEqual(updated.document, normalizeDocument(expected));
  assert.deepEqual(before, fixture);
  assert.deepEqual(updated.document.assets, fixture.assets);
});

test('text commands preserve Korean, literal markup, emoji, blank paragraphs and whitespace, normalizing LF only', () => {
  const paragraphs = ['  한글 👨‍👩‍👧‍👦 e\u0301 <script>text</script>\r\n줄  ', '', ''];
  const content = apply(fixture, 'text.set_content', { elementId: textId, paragraphs });
  const styled = apply(content.document, 'text.set_style', { elementId: textId, style: { bold: true, fontSize: 42, lineHeight: 1.5, verticalAlign: 'middle', color: '#AABBCC' } });
  const text = styled.document.slides[0].elements[0].text;
  assert.deepEqual(text.paragraphs, paragraphs.map(value => value.replace(/\r\n/g, '\n')));
  assert.equal(text.textStyle.fontFamily, 'Malgun Gothic');
  assert.equal(text.textStyle.color, '#aabbcc');
  assert.equal(text.textStyle.bold, true);
  assert.equal(paragraphs[0].includes('\r\n'), true);
});

test('title, image and background commands change only their explicit fields', () => {
  let doc = apply(fixture, 'document.set_title', { title: '자료 <>&\r\n한글' }).document;
  doc = apply(doc, 'image.set_properties', { elementId: imageId, properties: { fit: 'cover', alt: '비교 그림\r설명' } }).document;
  doc = apply(doc, 'slide.set_background', { slideId: 'slide-003', background: '#ABCD' }).document;
  const expected = cloneDocument(fixture);
  expected.title = '자료 <>&\n한글'; expected.slides[1].elements[1].fit = 'cover'; expected.slides[1].elements[1].alt = '비교 그림\n설명'; expected.slides[2].background = '#abcd';
  assert.deepEqual(doc, normalizeDocument(expected));
});

test('slide order, element deletion and last-slide protection match existing domain behavior', () => {
  const moved = apply(fixture, 'slide.move', { slideId: 'slide-001', delta: 99 });
  assert.deepEqual(moved.document.slides.map(slide => slide.id), ['slide-002', 'slide-003', 'slide-001']);
  const back = apply(moved.document, 'slide.move', { slideId: 'slide-001', delta: -99 });
  assert.deepEqual(back.document, normalizeDocument(fixture));
  const deleted = apply(fixture, 'element.delete', { elementId: imageId });
  assert.deepEqual(deleted.document.assets, fixture.assets, 'unused assets retained under current model contract');
  assert.equal(deleted.document.slides[1].elements.some(element => element.id === imageId), false);
  let doc = apply(fixture, 'slide.delete', { slideId: 'slide-001' }).document;
  doc = apply(doc, 'slide.delete', { slideId: 'slide-002' }).document;
  const last = apply(doc, 'slide.delete', { slideId: 'slide-003' });
  assert.equal(last.changed, false);
  assert.equal(last.document.slides.length, 1);
});

test('normalized no-ops stay detached and report no content change', () => {
  const noOp = apply(fixture, 'shape.set_fill', { elementId: shapeId, fill: '#16A34A' });
  assert.equal(noOp.changed, false);
  noOp.document.assets[0].dataBase64 = 'changed';
  assert.notEqual(fixture.assets[0].dataBase64, 'changed');
  const input = command('element.set_geometry', { elementId: shapeId, geometry: { x: 99 } });
  const checked = validateCommand(input); checked.value.params.geometry.x = 1;
  assert.equal(input.params.geometry.x, 99);
});

test('public creation has executable closed schemas and never accepts a path or raw staged field', () => {
  const inputs = [
    command('slide.create', { afterSlideId: 'slide-001', clientRef: 'new-slide' }),
    command('slide.duplicate', { slideId: 'slide-001', clientRef: 'copy' }),
    command('element.create_text', { slideId: 'slide-001', clientRef: 'new-element',geometry:{x:1,y:2,width:100,height:30},paragraphs:['편집할 수 있는 제목'] }),
    command('element.create_shape', { slideId: 'slide-001', clientRef: 'new-element',geometry:{x:1,y:2,width:100,height:30} }),
    command('element.create_image', { slideId: 'slide-001', clientRef: 'image',assetId:fixture.assets[0].id,geometry:{x:1,y:2,width:100,height:30} }),
    command('element.duplicate', { elementId: shapeId, clientRef: 'copy' }),
  ];
  for (const input of inputs) {assert.equal(validateCommand(input).ok,true);assert.equal(evaluateCommand(fixture,input).ok,true,JSON.stringify(input));}
  unchangedFailure(command('element.create_image', { slideId: 'slide-001', clientRef: 'image', stagedAssetId: 'staged', filePath: 'C:\\secret' }), 'INVALID_COMMAND');
});

test('candidate can round-trip through presentation HTML without flattening content or losing IDs/assets', () => {
  let doc = apply(fixture, 'shape.set_fill', { elementId: shapeId, fill: '#9f16a2' }).document;
  doc = apply(doc, 'element.set_geometry', { elementId: imageId, geometry: { x: 600, height: 250 } }).document;
  doc = apply(doc, 'text.set_content', { elementId: textId, paragraphs: ['한글 123', '발표 🙂'] }).document;
  assert.deepEqual(parsePresentation(exportPresentation(doc)), doc);
  assert.deepEqual(doc.assets, fixture.assets);
});

test('shared candidate results match the current store for supported primitive changes', () => {
  const cases = [
    ['element.set_geometry', { elementId: shapeId, geometry: { x: 17, height: 140 } }, store => store.updateElement(shapeId, { geometry: { x: 17, height: 140 } })],
    ['shape.set_fill', { elementId: shapeId, fill: '#9f16a2' }, store => store.updateElement(shapeId, { fill: '#9f16a2' })],
    ['shape.set_stroke', { elementId: shapeId, stroke: { width: 4 } }, store => store.updateElement(shapeId, { stroke: { width: 4 } })],
    ['text.set_content', { elementId: textId, paragraphs: ['한글', ''] }, store => { store.beginText(textId); store.updateText(['한글', '']); store.finishText(); }],
    ['text.set_style', { elementId: textId, style: { bold: true } }, store => store.updateElement(textId, { text: { textStyle: { bold: true } } })],
    ['image.set_properties', { elementId: imageId, properties: { fit: 'cover', alt: '그림' } }, store => store.updateElement(imageId, { fit: 'cover', alt: '그림' })],
    ['element.delete', { elementId: shapeId }, store => store.deleteElement(shapeId)],
    ['slide.delete', { slideId: 'slide-001' }, store => store.deleteSlide('slide-001')],
    ['slide.move', { slideId: 'slide-001', delta: 1 }, store => store.moveSlide('slide-001', 1)],
  ];
  for (const [id, params, oldPath] of cases) {
    const store = new EditorStore(fixture); oldPath(store);
    assert.deepEqual(apply(fixture, id, params).document, store.document, id);
  }
});
