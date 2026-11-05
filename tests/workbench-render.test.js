import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { CONTENT_CSS, imageCropLayout, renderSlideContent, resolveElementAppearance } from '../src/render.js';
import { exportPresentation, parsePresentation } from '../src/format.js';

const fixture = () => JSON.parse(readFileSync(new URL('../examples/document-contract-v0.1.json', import.meta.url), 'utf8'));
function workbenchDocument() {
  const doc = fixture(); doc.schemaVersion = '0.2-workbench.1';
  doc.theme = { colors: { primary: '#6633cc', secondary: '#33aabb', background: '#f9f6ff', text: '#221133' }, fontFamily: 'Georgia' };
  Object.assign(doc.slides[0].elements[1], {
    name: '브랜드 카드', rotation: 25, groupId: 'group-brand-001', locked: true,
    style: { opacity: 0.8, radius: 18, gradient: { type: 'linear', angle: 135, stops: [{ offset: 0, color: '#6633cc' }, { offset: 0.45, color: '#cc66ff' }, { offset: 1, color: '#33aabb' }] }, shadow: { x: 3, y: 9, blur: 16, spread: -2, color: '#22113355' } },
    themeRefs: { fill: 'primary', textColor: 'text', fontFamily: true },
  });
  Object.assign(doc.slides[1].elements[1], { crop: { x: 0.25, y: 0, width: 0.5, height: 1 }, focal: { x: 0.5, y: 0.5 }, source: '저작자 <한글> & 원본', alt: '잘린 이미지 <설명>', fit: 'contain' });
  return doc;
}

test('structured CSS effects and theme references are shared by interactive and presentation markup', () => {
  const doc = workbenchDocument(), slide = doc.slides[0], shape = slide.elements[1];
  const appearance = resolveElementAppearance(shape, doc);
  assert.equal(appearance.textColor, '#221133'); assert.equal(appearance.fontFamily, 'Georgia');
  assert.equal(appearance.background, 'linear-gradient(135deg,#6633cc 0%,#cc66ff 45%,#33aabb 100%)');
  assert.equal(appearance.boxShadow, '3px 9px 16px -2px #22113355');
  const normal = renderSlideContent(slide, doc), interactive = renderSlideContent(slide, doc, { interactive: true });
  assert.equal(interactive.replaceAll(' data-interactive="true"', '').replaceAll(' data-locked="true"', ''), normal);
  for (const value of ['transform:rotate(25deg)', 'opacity:0.8', 'border-radius:18px', 'box-shadow:3px 9px 16px -2px #22113355', 'font-family:&quot;Georgia&quot;', 'color:#221133', 'data-group-id="group-brand-001"']) assert.ok(normal.includes(value), value);
  assert.match(interactive, /data-locked="true"/); assert.doesNotMatch(normal, /data-locked/);
  shape.style.gradient.type = 'radial';
  assert.match(renderSlideContent(slide, doc), /radial-gradient\(ellipse at center,#6633cc 0%,#cc66ff 45%,#33aabb 100%\)/);
});

test('a changed theme updates only opt-in elements and local style remains available', () => {
  const doc = workbenchDocument(), shape = doc.slides[0].elements[1], plain = doc.slides[0].elements[0];
  delete shape.style.gradient;
  const before = structuredClone(plain);
  doc.theme.colors.primary = '#ff8800'; doc.theme.colors.text = '#003355'; doc.theme.fontFamily = 'Arial';
  const themed = resolveElementAppearance(shape, doc);
  assert.equal(themed.background, '#ff8800'); assert.equal(themed.textColor, '#003355'); assert.equal(themed.fontFamily, 'Arial');
  assert.equal(resolveElementAppearance(plain, doc).textColor, plain.text.textStyle.color);
  assert.deepEqual(plain, before);
  delete shape.themeRefs.fill; delete shape.themeRefs.textColor; delete shape.themeRefs.fontFamily;
  assert.equal(resolveElementAppearance(shape, doc).fill, shape.fill);
  assert.equal(resolveElementAppearance(shape, doc).textColor, shape.text.textStyle.color);
  assert.equal(resolveElementAppearance(shape, doc).fontFamily, shape.text.textStyle.fontFamily);
});

test('hidden elements render nowhere while locked objects remain visible and escaped', () => {
  const doc = workbenchDocument(), shape = doc.slides[0].elements[1];
  shape.hidden = true;
  for (const interactive of [false, true]) assert.doesNotMatch(renderSlideContent(doc.slides[0], doc, { interactive }), /element-shape-001/);
  shape.hidden = false; shape.id = 'id"< &'; shape.groupId = 'group"< &';
  const html = renderSlideContent(doc.slides[0], doc, { interactive: true });
  assert.match(html, /data-element-id="id&quot;&lt; &amp;"/); assert.match(html, /data-group-id="group&quot;&lt; &amp;"/);
  assert.match(html, /data-locked="true"/);
});

test('non-destructive source crop honors natural aspect ratio, contain/cover and focal alignment', () => {
  const doc = workbenchDocument(), image = doc.slides[1].elements[1], asset = doc.assets[0];
  const originalHash = createHash('sha256').update(Buffer.from(asset.dataBase64, 'base64')).digest('hex');
  assert.deepEqual(imageCropLayout(image, asset), { left: 80, top: 0, width: 160, height: 180, imageLeft: -80, imageTop: 0, imageWidth: 320, imageHeight: 180 });
  image.fit = 'cover';
  assert.deepEqual(imageCropLayout(image, asset), { left: 0, top: -90, width: 320, height: 360, imageLeft: -160, imageTop: 0, imageWidth: 640, imageHeight: 360 });
  image.fit = 'contain'; image.focal = { x: 1, y: 0 };
  assert.equal(imageCropLayout(image, asset).left, 160);
  const html = renderSlideContent(doc.slides[1], doc);
  assert.match(html, /class="element-image-crop"/); assert.match(html, /alt="잘린 이미지 &lt;설명&gt;"/);
  assert.match(CONTENT_CSS, /element-image-crop.*overflow:hidden/);
  assert.equal(createHash('sha256').update(Buffer.from(asset.dataBase64, 'base64')).digest('hex'), originalHash);
  assert.equal(originalHash, asset.sha256);
  delete image.crop;
  assert.match(renderSlideContent(doc.slides[1], doc), /object-fit:contain;object-position:100% 0%/);
});

test('CSS injection and invalid effect/crop values are rejected by the renderer', () => {
  for (const mutate of [
    e => { e.style.gradient.stops[0].color = 'url(https://example.invalid)'; },
    e => { e.style.gradient.stops[1].offset = 2; },
    e => { e.style.gradient.stops.reverse(); },
    e => { e.style.shadow.blur = -1; },
    e => { e.style.shadow.color = '#fff;background:red'; },
    e => { e.style.opacity = NaN; },
    e => { e.rotation = Infinity; },
    e => { e.themeRefs.fill = '__proto__'; },
  ]) {
    const doc = workbenchDocument(); mutate(doc.slides[0].elements[1]);
    assert.throws(() => renderSlideContent(doc.slides[0], doc));
  }
  const doc = workbenchDocument(); doc.slides[1].elements[1].crop.width = 0.9;
  assert.throws(() => renderSlideContent(doc.slides[1], doc), /crop/);
});

test('extended editable metadata and effect markup survive a standalone HTML roundtrip', () => {
  const doc = workbenchDocument();
  // A group has at least two members in the model; its children retain world geometry.
  doc.slides[0].elements[0].groupId = 'group-brand-001';
  const html = exportPresentation(doc), reopened = parsePresentation(html);
  assert.deepEqual(reopened, doc);
  assert.match(html, /Vividly 0.2-workbench.1/); assert.match(html, /linear-gradient/);
  assert.match(html, /element-image-crop/);
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href=/);
  const rendered = html.replace(/<script type="application\/json" id="vividly-runtime-source">[\s\S]*?<\/script>/, "");
  assert.doesNotMatch(rendered, /https?:\/\/[^<]*<\/script>/);
  assert.deepEqual(reopened.assets, doc.assets);
  assert.equal(reopened.slides[1].elements[1].source, '저작자 <한글> & 원본');
});
