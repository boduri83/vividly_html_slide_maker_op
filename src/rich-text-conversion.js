/** Canonical, DOM-free adapter between Vividly text and the supported Tiptap schema. */
import {isFontFamily} from './font-names.js';
const clone = value => structuredClone(value);
const defaultParagraph = () => ({ list: 'none', level: 0, spaceBefore: 0, spaceAfter: 0 });

export function safeRichHref(value) {
  if (typeof value !== 'string' || !value || /[\u0000-\u0020\u007f]/u.test(value)) throw new Error('http, https, mailto 주소를 입력하세요.');
  let url;
  try { url = new URL(value); } catch { throw new Error('올바른 링크 주소를 입력하세요.'); }
  if (!['http:', 'https:', 'mailto:'].includes(url.protocol) || url.username || url.password) throw new Error('지원하지 않는 링크 형식입니다.');
  return value;
}

export function colorToHex(value) {
  if (typeof value !== 'string') return null;
  if (/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)) return value.toLowerCase();
  const rgb = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*(0(?:\.\d+)?|1(?:\.0+)?))?\s*\)$/i);
  if (!rgb || rgb.slice(1, 4).some(component => Number(component) > 255)) return null;
  let hex = '#' + rgb.slice(1, 4).map(component => Number(component).toString(16).padStart(2, '0')).join('');
  if (rgb[4] !== undefined && Number(rgb[4]) < 1) hex += Math.round(Number(rgb[4]) * 255).toString(16).padStart(2, '0');
  return hex;
}

export function graphemeOffsets(text) {
  const points = [0];
  for (const segment of new Intl.Segmenter('ko', { granularity: 'grapheme' }).segment(text)) points.push(segment.index + segment.segment.length);
  return [...new Set(points)];
}

export function expandGraphemeRange(text, start, end) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > text.length) throw new Error('유효한 문자 범위가 필요합니다.');
  const points = graphemeOffsets(text);
  if (start === end) {
    const nearest = points.reduce((best, value) => Math.abs(value - start) < Math.abs(best - start) ? value : best, 0);
    return { start: nearest, end: nearest };
  }
  return { start: points.filter(value => value <= start).at(-1), end: points.find(value => value >= end) };
}

function marksFor(run, style) {
  const result = [];
  if (run?.bold ?? style.bold ?? false) result.push({ type: 'bold' });
  if (run?.italic ?? style.italic ?? false) result.push({ type: 'italic' });
  if (run?.underline ?? style.underline ?? false) result.push({ type: 'underline' });
  if (run?.strike ?? style.strike ?? false) result.push({ type: 'strike' });
  const attrs = {};
  if (run?.fontSize !== undefined) attrs.fontSize = `${run.fontSize}px`;
  if (run?.fontFamily !== undefined) attrs.fontFamily = run.fontFamily;
  if (run?.color !== undefined) attrs.color = run.color;
  if (Object.keys(attrs).length) result.push({ type: 'textStyle', attrs });
  if (run?.href) result.push({ type: 'link', attrs: { href: safeRichHref(run.href), target: '_blank', rel: 'noopener noreferrer' } });
  return result;
}

function inline(text, marks) {
  const result = [];
  text.split('\n').forEach((part, index) => {
    if (index) result.push({ type: 'hardBreak', ...(marks.length ? { marks: clone(marks) } : {}) });
    if (part) result.push({ type: 'text', text: part, ...(marks.length ? { marks: clone(marks) } : {}) });
  });
  return result;
}

export function textToRichDocument(text) {
  const paragraphs = text.paragraphs.length ? text.paragraphs : [''];
  return { type: 'doc', content: paragraphs.map((paragraph, index) => {
    const runs = (text.runs || []).filter(run => run.paragraph === index);
    const boundaries = [...new Set([0, paragraph.length, ...runs.flatMap(run => [run.start, run.end])])].sort((a, b) => a - b);
    const content = [];
    for (let i = 1; i < boundaries.length; i++) {
      const start = boundaries[i - 1], end = boundaries[i], run = runs.find(item => item.start <= start && item.end >= end);
      content.push(...inline(paragraph.slice(start, end), marksFor(run, text.textStyle)));
    }
    return { type: 'paragraph', attrs: clone(text.paragraphStyles?.[index] || defaultParagraph()), ...(content.length ? { content } : {}) };
  }) };
}

function attributes(marks, baseStyle) {
  const result = {};
  for (const name of ['bold','italic','underline','strike']) {
    const active = marks.some(mark => mark.type === name);
    if (active !== Boolean(baseStyle[name])) result[name] = active;
  }
  const styles = marks.filter(mark => mark.type === 'textStyle').map(mark => mark.attrs || {});
  for (const style of styles) {
    if(style.fontFamily!==null&&style.fontFamily!==undefined){if(!isFontFamily(style.fontFamily))throw Error('유효한 글꼴 이름이 필요합니다.');result.fontFamily=style.fontFamily;}
    const color = colorToHex(style.color);
    if (color) result.color = color;
    if (style.fontSize !== null && style.fontSize !== undefined) {
      const fontSize = Number.parseFloat(style.fontSize);
      if (Number.isFinite(fontSize) && fontSize > 0) result.fontSize = fontSize;
    }
  }
  const href = marks.find(mark => mark.type === 'link')?.attrs?.href;
  if (href) result.href = safeRichHref(href);
  return result;
}

export function richDocumentToText(document, baseText) {
  if (document?.type !== 'doc' || !Array.isArray(document.content)) throw new Error('지원하는 텍스트 문서가 필요합니다.');
  const paragraphs = [], runs = [], paragraphStyles = [];
  for (const node of document.content) {
    if (node.type !== 'paragraph') throw new Error('지원하지 않는 텍스트 문단입니다.');
    const paragraph = paragraphs.length, pieces = [], spans = [];
    let length = 0;
    for (const child of node.content || []) {
      const value = child.type === 'text' ? child.text : child.type === 'hardBreak' ? '\n' : null;
      if (typeof value !== 'string') throw new Error('지원하지 않는 텍스트 요소입니다.');
      const extra = attributes(child.marks || [], baseText.textStyle), start = length;
      pieces.push(value); length += value.length;
      if (value.length) spans.push({start,end:length,extra});
    }
    const value = pieces.join(''), boundaries = graphemeOffsets(value);
    let spanIndex = 0;
    // A combining mark or ZWJ input can join differently marked engine nodes.
    // Canonical ranges always style the complete grapheme using its leading text.
    for(let index=1;index<boundaries.length;index++){
      const start=boundaries[index-1],end=boundaries[index];
      while(spans[spanIndex] && spans[spanIndex].end<=start)spanIndex++;
      const extra=spans[spanIndex]?.extra || {};
      if (Object.keys(extra).length) {
        const previous = runs.at(-1);
        if (previous?.paragraph === paragraph && previous.end === start && JSON.stringify(Object.fromEntries(Object.entries(previous).filter(([key]) => !['paragraph','start','end'].includes(key)))) === JSON.stringify(extra)) previous.end = end;
        else runs.push({ paragraph, start, end, ...extra });
      }
    }
    paragraphs.push(value);
    const attrs = node.attrs || {};
    paragraphStyles.push({ list: ['none','bullet','number'].includes(attrs.list) ? attrs.list : 'none', level: Number.isInteger(attrs.level) ? Math.max(0, Math.min(4, attrs.level)) : 0,
      spaceBefore: Number.isFinite(attrs.spaceBefore) ? attrs.spaceBefore : 0, spaceAfter: Number.isFinite(attrs.spaceAfter) ? attrs.spaceAfter : 0 });
  }
  const result = clone(baseText);
  result.paragraphs = !baseText.paragraphs.length && paragraphs.length === 1 && paragraphs[0] === '' ? [] : paragraphs;
  delete result.runs; delete result.paragraphStyles;
  if (runs.length || baseText.runs !== undefined) result.runs = runs;
  const styled = paragraphStyles.some(style => style.list !== 'none' || style.level || style.spaceBefore || style.spaceAfter);
  if (styled || baseText.paragraphStyles !== undefined) result.paragraphStyles = result.paragraphs.length ? paragraphStyles : [];
  return result;
}
