import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { normalizeDocument } from '../src/model.js';
import { CONTENT_CSS, renderSlide, renderSlideContent } from '../src/render.js';
import { exportPresentation, parsePresentation, validateAssetBytes } from '../src/format.js';

function fixture() {
  return JSON.parse(readFileSync(new URL('../examples/document-contract-v0.1.json', import.meta.url), 'utf8'));
}
function metadata(html) {
  return html.match(/<script type="application\/json" id="html-slide-document">([\s\S]*?)<\/script>/)[1];
}
function withoutRuntimeSource(html) {
  return html.replace(/<script type="application\/json" id="vividly-runtime-source">[\s\S]*?<\/script>/, '');
}
function replaceMetadata(html, value) {
  const safe = JSON.stringify(value).replace(/</g, '\\u003c');
  return html.replace(/(<script type="application\/json" id="html-slide-document">)[\s\S]*?(<\/script>)/, (_, start, end) => start + safe + end);
}

test('three-slide export and metadata-only import preserve the normalized document and assets', async () => {
  const input = fixture(); const before = structuredClone(input);
  const html = exportPresentation(input);
  const actualMarkup = withoutRuntimeSource(html);
  assert.deepEqual(parsePresentation(html), normalizeDocument(input));
  assert.deepEqual(input, before, 'export must not mutate the editor document');
  assert.equal((actualMarkup.match(/class="presentation-slide"/g) ?? []).length, 3);
  assert.equal((actualMarkup.match(/data-element-id=/g) ?? []).length, 5);
  assert.ok(html.includes(`src="data:image/png;base64,${input.assets[0].dataBase64}"`));
  assert.equal(createHash('sha256').update(Buffer.from(input.assets[0].dataBase64, 'base64')).digest('hex'), input.assets[0].sha256);
  assert.deepEqual(await validateAssetBytes(input), normalizeDocument(input));
  assert.ok(html.includes('id="presentation-prev"'));
  assert.ok(html.includes('id="presentation-next"'));
  assert.ok(html.includes('id="presentation-counter"'));
  assert.ok(html.includes('PageDown') && html.includes('Home') && html.includes('Escape'));
  assert.doesNotMatch(actualMarkup, /<script[^>]+src=|<link[^>]+href=|\bfetch\s*\(|\bXMLHttpRequest\b/i);
  assert.doesNotMatch(actualMarkup, /selection-overlay|resize-handle|contenteditable|data-interactive=/i);
});

test('HTML special characters, Korean, blank paragraphs and soft line breaks remain literal data', () => {
  const input = fixture();
  const payload = '</script><script>globalThis.pwned = true</script><img src=x onerror="alert(1)"> & < > " \' 한글\u2028\u2029';
  input.title = payload;
  input.slides[0].id = 'slide-"<&\'';
  input.slides[0].elements[0].id = 'element-" onmouseover="alert(1)';
  input.slides[0].elements[0].text.paragraphs = [payload, '', '  leading  spaces  ', 'soft\nline\n', '한글\r\n둘째'];
  input.slides[1].elements[1].alt = payload;
  const html = exportPresentation(input);
  const decoded = parsePresentation(html);
  assert.deepEqual(decoded, normalizeDocument(input));
  assert.doesNotMatch(metadata(html), /[<>&\u2028\u2029]/);
  assert.ok(metadata(html).includes('\\u003c/script\\u003e'));
  assert.equal((html.match(/<script\b/g) ?? []).length, 3, 'two typed data blocks and one fixed runtime script exist');
  assert.equal((withoutRuntimeSource(html).match(/<script\b/g) ?? []).length, 2, 'source archive adds no executable script');
  assert.ok(html.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'));
  assert.ok(html.includes('data-element-id="element-&quot; onmouseover=&quot;alert(1)"'));
  assert.ok(html.includes('<p></p>'));
  assert.ok(html.includes('<p>soft\nline\n</p>'));
  assert.ok(CONTENT_CSS.includes('white-space:pre-wrap'));
  assert.equal(globalThis.pwned, undefined);
});

test('interactive and presentation renderers share identical content geometry and text layout', () => {
  const input = normalizeDocument(fixture()); const slide = input.slides[0];
  const normal = renderSlideContent(slide, input);
  const interactive = renderSlideContent(slide, input, { interactive: true });
  assert.equal(interactive.replaceAll(' data-interactive="true"', ''), normal);
  assert.ok(normal.includes('left:80px;top:64px;width:1120px;height:100px'));
  assert.ok(normal.includes('justify-content:center'));
  assert.ok(normal.includes('line-height:1.2'));
  assert.ok(renderSlide(slide, input).includes('width:1280px;height:720px;background:#ffffff'));
  input.slides[0].elements[1].shape = 'ellipse';
  input.slides[0].elements[1].text.textStyle.bold = true;
  const ellipse = renderSlideContent(input.slides[0], input);
  assert.ok(ellipse.includes('border-radius:50%'));
  assert.ok(ellipse.includes('font-weight:700'));
});

test('renderer quotes font punctuation and rejects non-finite geometry before markup', () => {
  const input = fixture(); const slide = input.slides[0];
  slide.elements[0].text.textStyle.fontFamily = 'Arial; background:url(https://example.invalid)';
  assert.ok(renderSlideContent(slide,input).includes('font-family:&quot;Arial; background:url(https://example.invalid)&quot;'));
  slide.elements[0].text.textStyle.fontFamily = 'Malgun Gothic';
  slide.elements[0].text.textStyle.color = '#fff;position:fixed';
  assert.throws(() => renderSlideContent(slide, input), /HEX/);
  slide.elements[0].text.textStyle.color = '#ffffff';
  slide.elements[0].geometry.x = Number.POSITIVE_INFINITY;
  assert.throws(() => renderSlideContent(slide, input), /geometry.x/);
  slide.elements[0].geometry.x = 0;
  slide.elements[0].text.textStyle.lineHeight = -1;
  assert.throws(() => renderSlideContent(slide, input), /lineHeight/);
});

test('metadata-only import ignores all source scripts and visible DOM changes', () => {
  const input = fixture();
  const html = exportPresentation(input).replace('<body>', '<body><script>globalThis.pwned = true; throw new Error("must not execute")</script>');
  assert.deepEqual(parsePresentation(html.replace('HTML 프레젠테이션', 'externally changed visible text')), normalizeDocument(input));
  assert.equal(globalThis.pwned, undefined);
});

test('unsupported HTML, schema versions, duplicate metadata and corrupt JSON fail clearly', () => {
  const input = fixture(); const html = exportPresentation(input);
  assert.throws(() => parsePresentation('<html><h1>external</h1></html>'), /metadata|임의 HTML/);
  assert.throws(() => parsePresentation(html.replace(metadata(html), '{broken')), /JSON.*손상/);
  const future = structuredClone(input); future.schemaVersion = '9.0';
  assert.throws(() => parsePresentation(replaceMetadata(html, future)), /schemaVersion|문서 형식/);
  assert.throws(() => parsePresentation(html + `<script type="application/json" id="html-slide-document">${metadata(html)}</script>`), /여러 개/);
  assert.throws(() => parsePresentation(html.replace('type="application/json"', 'type="text/javascript"')), /application\/json/);
  const unsupported = structuredClone(input); unsupported.slides[0].elements[0].type = 'iframe';
  assert.throws(() => parsePresentation(replaceMetadata(html, unsupported)), /지원하지/);
});

test('actual asset bytes and SHA-256 are checked on export, import and async validation', async () => {
  const valid = fixture(); const html = exportPresentation(valid);
  const wrongHash = structuredClone(valid); wrongHash.assets[0].sha256 = '0'.repeat(64);
  assert.throws(() => exportPresentation(wrongHash), /SHA-256/);
  assert.throws(() => parsePresentation(replaceMetadata(html, wrongHash)), /SHA-256/);
  await assert.rejects(validateAssetBytes(wrongHash), /SHA-256/);
  const wrongLength = structuredClone(valid); wrongLength.assets[0].bytes += 1;
  assert.throws(() => exportPresentation(wrongLength), /길이|byte/);
  const svg = structuredClone(valid); svg.assets[0].mimeType = 'image/svg+xml';
  assert.throws(() => exportPresentation(svg), /지원하지/);
});

test('portable synchronous checksum agrees with Node across SHA-256 padding boundaries', () => {
  for (const length of [1, 3, 55, 56, 63, 64, 65, 127, 128, 129]) {
    const input = fixture();
    const bytes = Buffer.from(Array.from({ length }, (_, index) => (index * 17 + length) & 255));
    Object.assign(input.assets[0], { dataBase64: bytes.toString('base64'), bytes: length, sha256: createHash('sha256').update(bytes).digest('hex') });
    assert.deepEqual(parsePresentation(exportPresentation(input)), normalizeDocument(input), `SHA-256 byte length ${length}`);
  }
});
