import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeDocument } from "../src/model.js";
import { renderSlideContent, renderPresentationSlides } from "../src/render.js";
import {
  exportPresentation,
  parsePresentation,
  createStaticExport,
} from "../src/format.js";
import {
  staticDocument,
  normalizeOutputState,
} from "../src/business-render.js";

const style = {
  fontFamily: "Arial",
  fontSize: 30,
  lineHeight: 1.2,
  color: "#182037",
  align: "left",
  verticalAlign: "top",
};
function fixture() {
  return normalizeDocument({
    format: "html-slide-document",
    schemaVersion: "0.4-business.1",
    id: "business-render-document",
    title: "업무 자료",
    canvas: { width: 1280, height: 720, unit: "logical-px" },
    assets: [],
    variables: [
      {
        id: "year",
        name: "연도",
        initialValue: "2024",
        options: [
          { value: "2024", label: "2024년" },
          { value: "2025", label: "2025년" },
        ],
      },
    ],
    master: {
      enabled: true,
      footer: "공통 바닥글",
      logoText: "Vividly",
      accentColor: "#4f63ff",
      showPageNumber: true,
    },
    slides: [
      {
        id: "business-slide",
        background: "#ffffff",
        notes: "외부에 공개하지 않을 발표 노트",
        readingOrder: ["body", "title", "table", "chart", "icon", "connector"],
        elements: [
          {
            id: "title",
            type: "text",
            geometry: { x: 60, y: 40, width: 1100, height: 90 },
            semanticRole: "heading",
            text: {
              paragraphs: ["한글을 생생하게!"],
              textStyle: style,
              runs: [
                {
                  paragraph: 0,
                  start: 4,
                  end: 8,
                  bold: true,
                  italic: true,
                  underline: true,
                  fontSize: 42,
                  color: "#4f63ff",
                  href: "https://example.com/demo",
                },
              ],
            },
          },
          {
            id: "body",
            type: "text",
            geometry: { x: 60, y: 150, width: 500, height: 130 },
            text: {
              paragraphs: ["첫 번째", "두 번째", "세 번째"],
              textStyle: style,
              paragraphStyles: [
                { list: "bullet", level: 0, spaceBefore: 0, spaceAfter: 8 },
                { list: "number", level: 1, spaceBefore: 2, spaceAfter: 0 },
                { list: "none", level: 0, spaceBefore: 8, spaceAfter: 0 },
              ],
            },
          },
          {
            id: "table",
            type: "table",
            geometry: { x: 60, y: 310, width: 500, height: 260 },
            table: {
              rows: [
                [{ text: "항목" }, { text: "수치" }],
                [{ text: "보조 머리글" }, { text: "단위" }],
                [
                  { text: "매출 < >" },
                  { text: "128", bold: true, align: "right", fill: "#eef2ff" },
                ],
              ],
              columnWidths: [2, 1],
              headerRows: 2,
              fontSize: 22,
            },
          },
          {
            id: "chart",
            type: "chart",
            geometry: { x: 650, y: 200, width: 540, height: 330 },
            chart: {
              kind: "bar",
              categories: ["2024", "2025"],
              series: [
                {
                  id: "sales",
                  name: "매출",
                  color: "#4f63ff",
                  values: [-5, 10],
                },
              ],
              showLegend: true,
              variants: {
                variableId: "year",
                values: [
                  {
                    value: "2024",
                    series: [{ seriesId: "sales", values: [-5, 10] }],
                  },
                  {
                    value: "2025",
                    series: [{ seriesId: "sales", values: [20, 50] }],
                  },
                ],
              },
            },
          },
          {
            id: "icon",
            type: "svg",
            geometry: { x: 800, y: 40, width: 100, height: 100 },
            semanticRole: "decorative",
            svg: {
              title: "편집 가능한 벡터",
              viewBox: { width: 100, height: 100 },
              shapes: [
                {
                  kind: "rect",
                  x: 10,
                  y: 10,
                  width: 80,
                  height: 80,
                  rx: 12,
                  fill: "#a78bfa",
                },
                {
                  kind: "line",
                  x1: 20,
                  y1: 20,
                  x2: 80,
                  y2: 80,
                  stroke: "#ffffff",
                  strokeWidth: 4,
                },
              ],
            },
          },
          {
            id: "connector",
            type: "connector",
            geometry: { x: 0, y: 0, width: 1, height: 1 },
            connector: {
              from: { elementId: "body", anchor: "right" },
              to: { elementId: "chart", anchor: "left" },
              stroke: { color: "#71809e", width: 3 },
              arrow: "end",
            },
          },
        ],
      },
    ],
  });
}

test("semantic rich text, lists and multiple table header rows survive HTML roundtrip without flattening", () => {
  const document = fixture(),
    before = structuredClone(document),
    html = exportPresentation(document);
  assert.deepEqual(parsePresentation(html), before);
  assert.deepEqual(document, before);
  const content = renderSlideContent(document.slides[0], document);
  assert.match(content, /<a href="https:\/\/example.com\/demo"/);
  assert.match(content, /font-style:italic/);
  assert.match(content, /<ul[^>]*>.*<li aria-level="1">/);
  assert.match(content, /<ol[^>]*data-list-level="1"/);
  const table = content.match(
    /<table class="business-table"[\s\S]*?<\/table>/,
  )[0];
  assert.match(table, /<thead><tr>.*보조 머리글/s);
  assert.equal((table.match(/scope="col"/g) || []).length, 4);
  assert.match(content, /매출 &lt; &gt;/);
  assert.equal(
    (content.match(/<table class="business-table"/g) || []).length,
    1,
  );
});

test("reading order changes semantic DOM order while original visual stacking and shared master remain explicit", () => {
  const document = fixture(),
    slide = document.slides[0],
    content = renderSlideContent(slide, document);
  assert.ok(
    content.indexOf('data-element-id="body"') <
      content.indexOf('data-element-id="title"'),
  );
  assert.match(
    content,
    /data-element-id="title"[^>]*role="heading"[^>]*z-index:1/,
  );
  assert.match(content, /data-element-id="body"[^>]*z-index:2/);
  assert.match(content, /business-master-footer/);
  assert.match(content, /共通|공통 바닥글/);
  slide.masterOverride = { footer: "이 장의 예외" };
  assert.match(renderSlideContent(slide, document), /이 장의 예외/);
  slide.hideMaster = true;
  assert.doesNotMatch(
    renderSlideContent(slide, document),
    /business-master-footer/,
  );
});

test("SVG charts retain negative/null values, editable data and per-choice vector variants; connectors follow rotated anchors", () => {
  const document = fixture(),
    slide = document.slides[0],
    content = renderSlideContent(slide, document);
  assert.match(content, /data-chart-variable="year"/);
  assert.match(content, /<template data-chart-value="2025">/);
  assert.match(content, /매출 · 2025: 50/);
  assert.match(content, /<table class="business-chart-data"/);
  const original = content.match(
    /class="slide-element element-connector"[^>]+/,
  )[0];
  slide.elements.find((e) => e.id === "body").rotation = 90;
  const rotated = renderSlideContent(slide, document).match(
    /class="slide-element element-connector"[^>]+/,
  )[0];
  assert.notEqual(rotated, original);
  slide.elements.find((e) => e.id === "chart").chart.kind = "line";
  slide.elements.find((e) => e.id === "chart").chart.series[0].values = [
    null,
    10,
  ];
  assert.match(
    renderSlideContent(slide, document),
    /<circle data-series-id="sales"/,
  );
});

test("static scenes resolve chosen chart values, preserve source and exclude speaker notes unless requested", () => {
  const document = fixture(),
    before = structuredClone(document),
    slide = document.slides[0];
  slide.motions = [
    {
      id: "title-entrance",
      targetId: "title",
      preset: "fadeIn",
      start: "onClick",
      duration: 500,
      delay: 0,
      easing: "ease",
      iterations: 1,
    },
  ];
  const initial = createStaticExport(document, { scene: "initial" }),
    complete = createStaticExport(document, {
      scene: "complete",
      state: { variables: { year: "2025" } },
    });
  assert.doesNotMatch(initial.html, /한글을/);
  assert.match(complete.html, /한글을/);
  assert.match(complete.html, /매출 · 2025: 50/);
  assert.doesNotMatch(complete.html, /<script|외부에 공개하지/);
  assert.deepEqual(document.slides[0].elements, before.slides[0].elements);
  assert.equal(complete.width, 1280);
  assert.equal(complete.height, 720);
  const notes = createStaticExport(document, { includeNotes: true });
  assert.match(notes.html, /외부에 공개하지 않을 발표 노트/);
  assert.ok(notes.height > 720);
  assert.throws(() => createStaticExport(document, { slideIds: ["unknown"] }));
  assert.throws(() =>
    normalizeOutputState(document, { variables: { year: "2050" } }),
  );
  assert.throws(() =>
    normalizeOutputState(document, { shownIds: ["unknown"] }),
  );
});

test("public HTML removes notes from metadata and DOM; editable saves preserve notes and original author data", () => {
  const document = fixture(),
    before = structuredClone(document),
    publicHtml = exportPresentation(document, { includeNotes: false });
  assert.doesNotMatch(publicHtml, /외부에 공개하지/);
  assert.equal(parsePresentation(publicHtml).slides[0].notes, undefined);
  assert.deepEqual(parsePresentation(exportPresentation(document)), before);
  assert.deepEqual(document, before);
});

test("unsupported SVG execution, unsafe links and malformed business content reject before output", () => {
  const document = fixture();
  document.slides[0].elements.find(
    (e) => e.id === "icon",
  ).svg.shapes[0].onclick = "alert(1)";
  assert.throws(() => exportPresentation(document));
  const linked = fixture();
  linked.slides[0].elements[0].text.runs[0].href = "javascript:alert(1)";
  assert.throws(() => exportPresentation(linked));
  const raw = fixture();
  raw.slides[0].elements.find((e) => e.id === "icon").svg.shapes = [
    { kind: "foreignObject", html: "<iframe>" },
  ];
  assert.throws(() => exportPresentation(raw));
});
