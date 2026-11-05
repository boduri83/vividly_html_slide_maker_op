/** Convert a deliberately small static SVG vocabulary to closed author data. */
import { normalizeSvgPath } from './svg-path.js';
export function parseStaticSvg(source) {
  if (
    typeof source !== "string" ||
    source.length > 524288 ||
    /<!DOCTYPE|<!ENTITY/i.test(source)
  )
    throw new Error("512 KiB 이하의 정적 SVG만 가져올 수 있습니다.");
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  if (
    document.querySelector("parsererror") ||
    document.documentElement.localName !== "svg"
  )
    throw new Error("올바른 SVG 파일이 아닙니다.");
  const root = document.documentElement;
  const allowedRoot = new Set([
    "xmlns",
    "width",
    "height",
    "viewBox",
    "fill",
    "stroke",
    "stroke-width",
    "version",
    "stroke-linecap","stroke-linejoin","fill-rule",
  ]);
  for (const attribute of root.attributes)
    if (!allowedRoot.has(attribute.name))
      throw new Error(`지원하지 않는 SVG 속성: ${attribute.name}`);
  function number(value, fallback) {
    if (value === null || value === "") return fallback;
    const clean = String(value).replace(/px$/, "");
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(clean))
      throw new Error("SVG 길이는 유한한 숫자여야 합니다.");
    const result = Number(clean);
    if (!Number.isFinite(result) || Math.abs(result) > 1000000)
      throw new Error("SVG 좌표 범위를 벗어났습니다.");
    return result;
  }
  const named = {
    black: "#000000",
    white: "#ffffff",
    red: "#ff0000",
    blue: "#0000ff",
    green: "#008000",
    currentColor: "#182037",
  };
  function paint(value, fallback) {
    value = value ?? fallback;
    if (value === "none") return value;
    if (named[value]) return named[value];
    if (
      !/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value || "")
    )
      throw new Error("SVG 색은 HEX 또는 none만 지원합니다.");
    return value.toLowerCase();
  }
  const view = root
    .getAttribute("viewBox")
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (
    view &&
    (view.length !== 4 ||
      view.some((n) => !Number.isFinite(n)) ||
      view[0] !== 0 ||
      view[1] !== 0)
  )
    throw new Error("viewBox는 0 0 너비 높이 형식이어야 합니다.");
  const width = view?.[2] ?? number(root.getAttribute("width"), 100),
    height = view?.[3] ?? number(root.getAttribute("height"), 100);
  if (!(width > 0 && height > 0))
    throw new Error("SVG 크기는 양수여야 합니다.");
  const baseFill = paint(root.getAttribute("fill"), "#000000"),
    baseStroke = paint(root.getAttribute("stroke"), "none"),
    baseWidth = number(root.getAttribute("stroke-width"), 1);
  const fields = {
    rect: ["x", "y", "width", "height", "rx"],
    circle: ["cx", "cy", "r"],
    ellipse: ["cx", "cy", "rx", "ry"],
    line: ["x1", "y1", "x2", "y2"],
    polygon: ["points"],
    polyline: ["points"],
    path: ["d"],
  };
  const shapes = [];
  for (const child of root.children) {
    const kind = child.localName;
    if (kind === "title") {
      if (child.children.length)
        throw new Error("SVG 제목에는 텍스트만 넣을 수 있습니다.");
      continue;
    }
    if (!fields[kind] || child.children.length)
      throw new Error(
        `지원하지 않는 SVG 요소: ${kind}. 정적 path/rect/circle/ellipse/line/polygon/polyline만 지원합니다.`,
      );
    const allowed = new Set([
      ...fields[kind],
      "fill",
      "stroke",
      "stroke-width",
      "stroke-linecap","stroke-linejoin","fill-rule",
    ]);
    for (const attribute of child.attributes)
      if (!allowed.has(attribute.name))
        throw new Error(`지원하지 않는 SVG 속성: ${attribute.name}`);
    const item = { kind };
    for (const field of fields[kind]) {
      if (field === "points") {
        const values = (child.getAttribute(field) || "")
          .trim()
          .split(/[\s,]+/)
          .filter(Boolean)
          .map((value) => number(value));
        if (values.length < 4 || values.length % 2)
          throw new Error("SVG 점 좌표가 잘못되었습니다.");
        item.points = Array.from({ length: values.length / 2 }, (_, i) => ({
          x: values[i * 2],
          y: values[i * 2 + 1],
        }));
      } else if(field==='d')item.d=normalizeSvgPath(child.getAttribute(field));
      else item[field] = number(child.getAttribute(field), 0);
    }
    if (kind === "line") {
      item.stroke = paint(child.getAttribute("stroke"), baseStroke);
      item.strokeWidth = number(child.getAttribute("stroke-width"), baseWidth);
    } else {
      item.fill = paint(child.getAttribute("fill"), baseFill);
      const stroke = paint(child.getAttribute("stroke"), baseStroke);
      if (stroke !== "none") {
        item.stroke = stroke;
        item.strokeWidth = number(
          child.getAttribute("stroke-width"),
          baseWidth,
        );
      }
    }
    for(const [attribute,key,values]of [['stroke-linecap','strokeLinecap',['butt','round','square']],['stroke-linejoin','strokeLinejoin',['miter','round','bevel']],['fill-rule','fillRule',['nonzero','evenodd']]]){
      const value=child.getAttribute(attribute)||root.getAttribute(attribute);if(value){if(!values.includes(value))throw new Error('지원하지 않는 SVG 선 서식입니다.');if(kind!=='path')throw new Error('SVG 선 끝·모서리 서식은 path에서 지원합니다.');item[key]=value;}
    }
    shapes.push(item);
  }
  if (!shapes.length || shapes.length > 256)
    throw new Error("SVG에는 1~256개의 허용 도형이 필요합니다.");
  return {
    viewBox: { width, height },
    shapes,
    title:
      root.querySelector("title")?.textContent?.slice(0, 512) || "가져온 SVG",
  };
}
