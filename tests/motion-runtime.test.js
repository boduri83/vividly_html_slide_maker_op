import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeDocument } from '../src/model.js';
import { renderPresentationSlides, renderSlide } from '../src/render.js';
import { exportPresentation, parsePresentation } from '../src/format.js';
import { createPresentationRuntime, PRESENTATION_RUNTIME_CSS } from '../src/presentation-runtime.js';

function document() {
  const value = JSON.parse(readFileSync(new URL('../examples/document-contract-v0.1.json', import.meta.url), 'utf8'));
  value.schemaVersion = '0.3-motion.1';
  value.variables = [{ id: 'variable-year', name: '연도', initialValue: '2024', options: [{ value: '2024', label: '2024' }, { value: '2025', label: '2025' }] }];
  value.slides[0].motions = [{ id: 'motion-title', targetId: 'element-title-001', preset: 'slideInUp', start: 'onClick', duration: 650, delay: 100, easing: 'ease-out', iterations: 2 }];
  value.slides[0].transition = { type: 'push', duration: 400, easing: 'ease-in-out' };
  value.slides[0].elements[0].binding = { variableId: 'variable-year', format: 'number', values: [{ value: '2024', text: '128' }, { value: '2025', text: '186' }], prefix: '', suffix: '건', animate: true };
  value.slides[0].elements[1].component = { kind: 'tabs', variableId: 'variable-year' };
  return normalizeDocument(value);
}

test('advanced editable HTML includes the identical shared runtime and detached complete author metadata', () => {
  const value = document(), before = structuredClone(value), html = exportPresentation(value);
  assert.deepEqual(value, before);
  assert.deepEqual(parsePresentation(html), before);
  assert.ok(html.includes(createPresentationRuntime.toString()), 'export must embed the production player verbatim');
  assert.ok(html.includes(PRESENTATION_RUNTIME_CSS));
  assert.match(html, /id="presentation-pause"/);
  assert.match(html, /id="presentation-reset"/);
  assert.match(html, /id="presentation-seek"/);
  assert.match(html, /vividlyPresentation/);
});

test('all slide sections share the exact content renderer used by editing and presentation', () => {
  const value = document();
  assert.equal(renderPresentationSlides(value), value.slides.map(slide => renderSlide(slide, value)).join('\n'));
  assert.equal((renderPresentationSlides(value).match(/class="presentation-slide"/g) || []).length, value.slides.length);
});

test('runtime author labels and bound values remain literal metadata and cannot end an inline script', () => {
  const value = document();
  value.variables[0].options[0].label = '</script><img src=x onerror="throw 123">';
  value.slides[0].elements[0].binding.format = 'text';
  value.slides[0].elements[0].binding.values[0].text = '<button onclick="throw 123">한글 & text</button>';
  const html = exportPresentation(value);
  assert.deepEqual(parsePresentation(html), value);
  assert.equal((html.match(/<script\b/g) || []).length, 3, 'author metadata, the MPL source archive and the bundled runtime');
  assert.doesNotMatch(html, /<img src=x onerror/);
  assert.doesNotMatch(html, /<button onclick=/);
  const executable = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].at(-1)[1];
  assert.doesNotThrow(() => new Function(executable), 'the embedded runtime must not rely on ESM import syntax');
});

test('legacy workbench HTML remains on its established static player without interaction metadata', () => {
  const value = document();
  value.schemaVersion = '0.2-workbench.1'; delete value.variables;
  for (const slide of value.slides) {
    delete slide.motions; delete slide.transition;
    for (const element of slide.elements) { delete element.component; delete element.binding; }
  }
  const html = exportPresentation(value);
  assert.deepEqual(parsePresentation(html), value);
  const rendered = html.replace(/<script type="application\/json" id="vividly-runtime-source">[\s\S]*?<\/script>/, "");
  assert.doesNotMatch(rendered, /id="presentation-pause"|vividlyPresentation|vividly-runtime-root/);
});
