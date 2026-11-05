import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { colorInputRgb, mergeColorInput } from '../src/workbench-colors.js';
import { normalizeDocument } from '../src/model.js';
import { exportPresentation, parsePresentation } from '../src/format.js';

test('native RGB color controls display each supported author color width', () => {
  for (const [author, rgb] of [
    ['#AbC', '#aabbcc'], ['#f008', '#ff0000'],
    ['#336699', '#336699'], ['#182037AA', '#182037'],
  ]) assert.equal(colorInputRgb(author), rgb, author);
});

test('an unchanged native RGB value preserves the full original author literal', () => {
  for (const author of ['#AbC', '#f008', '#336699', '#182037AA', '#ffffffFF']) {
    assert.equal(mergeColorInput(author, colorInputRgb(author)), author, author);
  }
});

test('changing native RGB retains short or long alpha, including explicit opaque alpha', () => {
  for (const [author, expected] of [
    ['#f008', '#12345688'], ['#1234', '#12345644'],
    ['#5a8c', '#123456cc'], ['#18203780', '#12345680'],
    ['#aabbccff', '#123456ff'], ['#abcF', '#123456ff'],
  ]) assert.equal(mergeColorInput(author, '#123456'), expected, author);
  assert.equal(mergeColorInput('#abc', '#123456'), '#123456');
  assert.equal(mergeColorInput('#AABBCC', '#123456'), '#123456');
});

test('the mixed-width UI regression document retains every author color in editable HTML', () => {
  const document = JSON.parse(readFileSync(new URL('./fixtures/workbench-color-regression.json', import.meta.url), 'utf8'));
  const normalized = normalizeDocument(document);
  assert.deepEqual(normalized, document, 'fixture must already be canonical and valid');
  const html = exportPresentation(document), reopened = parsePresentation(html);
  assert.deepEqual(reopened, document);
  const gradient = reopened.slides[0].elements[0], solid = reopened.slides[0].elements[1];
  assert.deepEqual(gradient.style.gradient.stops.map(stop => stop.color), ['#f008', '#0af', '#336699cc']);
  assert.equal(gradient.style.shadow.color, '#18203780');
  assert.equal(solid.fill, '#5a8c');
  assert.equal(solid.style?.gradient, undefined);
  assert.equal(reopened.slides[0].elements.length, 3);
  const longSolid = reopened.slides[0].elements[2];
  assert.equal(longSolid.id, 'element-color-solid-long');
  assert.equal(longSolid.fill, '#55aa88cc');
  assert.equal(longSolid.style?.gradient, undefined);
  assert.deepEqual(reopened.theme.colors, { primary: '#abc', secondary: '#1234', background: '#fefefeff', text: '#182037aa' });
});
