import { SHAPE_KINDS, getShapeDefinition, shapeGeometry } from './shapes.js';
import { FREEFORM_KIND, freeformGeometry } from './drawing-model.js';

const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n = value => {
  if(typeof value!=='number'||!Number.isFinite(value))throw new Error('도형 좌표는 유한한 숫자여야 합니다.');
  return String(Object.is(value,-0)?0:Number(value.toFixed(7)));
};
const paint = value => {
  if(typeof value!=='string'||!/^#(?:[a-f\d]{3}|[a-f\d]{4}|[a-f\d]{6}|[a-f\d]{8})$/i.test(value))throw new Error('도형 색상은 HEX 값이어야 합니다.');
  return value;
};
const identifier = value => 'vividly-shape-'+Array.from(String(value),c=>c.codePointAt(0).toString(16)).join('-');
const shadeModes={darken:[.6,0],darkenLess:[.8,0],lighten:[.6,.4],lightenLess:[.8,.2]};
export const SHAPE_BACKGROUND_PROPERTIES=new Set(['background','background-color','background-image','background-size','background-position','background-repeat','background-clip','background-origin','background-blend-mode']);

const shapeKinds=new Set(SHAPE_KINDS);
export const isPresetShape = kind => kind===FREEFORM_KIND||kind!=='rectangle'&&kind!=='ellipse'&&shapeKinds.has(kind);

function layout(element) {
  if(element.shape!==FREEFORM_KIND&&!getShapeDefinition(element.shape))throw new Error('지원하지 않는 도형입니다.');
  const {width,height}=element.geometry||{},stroke=element.stroke?.width;
  if(!(width>0&&height>0)||!Number.isFinite(width)||!Number.isFinite(height)||!(stroke>=0)||!Number.isFinite(stroke))throw new Error('도형 크기와 테두리가 올바르지 않습니다.');
  // Keep the centerline inside the authored box, including narrow, small shapes.
  const inset=element.shape===FREEFORM_KIND?0:Math.min(stroke/2,width/2-.000001,height/2-.000001),innerWidth=Math.max(.000002,width-inset*2),innerHeight=Math.max(.000002,height-inset*2);
  const geometry=element.shape===FREEFORM_KIND?freeformGeometry(element.path,innerWidth,innerHeight):shapeGeometry(element.shape,innerWidth,innerHeight,element.adjustments);
  const rect=geometry.textRect||{x:0,y:0,width:innerWidth,height:innerHeight};
  for(const value of Object.values(rect))n(value);
  const x=Math.max(0,Math.min(width,rect.x+inset)),y=Math.max(0,Math.min(height,rect.y+inset));
  const textRect={x,y,width:Math.max(0,Math.min(width-x,rect.width)),height:Math.max(0,Math.min(height-y,rect.height))};
  return {width,height,stroke,inset,paths:geometry.paths,textRect};
}

export function presetShapeTextRect(element) { return layout(element).textRect; }
export function presetShapeTextInsets(element) {
  const {width,height,textRect}=layout(element);
  return {top:textRect.y,right:Math.max(0,width-textRect.x-textRect.width),bottom:Math.max(0,height-textRect.y-textRect.height),left:textRect.x};
}

function gradientMarkup(element,id,width,height) {
  const gradient=element.style?.gradient;if(!gradient)return '';
  const stops=gradient.stops.map(stop=>`<stop offset="${n(stop.offset*100)}%" stop-color="${paint(stop.color)}"/>`).join('');
  if(gradient.type==='radial')return `<radialGradient id="${id}" cx="50%" cy="50%" r="50%">${stops}</radialGradient>`;
  if(gradient.type!=='linear'||!Number.isFinite(gradient.angle))throw new Error('도형 그라데이션이 올바르지 않습니다.');
  // Use the same physical angle and corner-to-corner length as a CSS linear gradient.
  const angle=gradient.angle*Math.PI/180,dx=Math.sin(angle),dy=-Math.cos(angle),length=Math.abs(width*dx)+Math.abs(height*dy);
  return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${n((width-dx*length)/2)}" y1="${n((height-dy*length)/2)}" x2="${n((width+dx*length)/2)}" y2="${n((height+dy*length)/2)}">${stops}</linearGradient>`;
}

function shadowMarkup(shadow,id) {
  if(!shadow)return '';
  for(const value of [shadow.x,shadow.y,shadow.blur,shadow.spread])n(value);
  if(shadow.blur<0)throw new Error('그림자 흐림은 음수일 수 없습니다.');
  const spread=shadow.spread?`<feMorphology in="SourceAlpha" operator="${shadow.spread>0?'dilate':'erode'}" radius="${n(Math.abs(shadow.spread))}" result="spread"/>`:'';
  return `<filter id="${id}" x="-100%" y="-100%" width="300%" height="300%" color-interpolation-filters="sRGB">${spread}<feGaussianBlur in="${shadow.spread?'spread':'SourceAlpha'}" stdDeviation="${n(shadow.blur/2)}" result="blur"/><feOffset in="blur" dx="${n(shadow.x)}" dy="${n(shadow.y)}" result="offset"/><feFlood flood-color="${paint(shadow.color)}" result="color"/><feComposite in="color" in2="offset" operator="in" result="shadow"/><feMerge><feMergeNode in="shadow"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
}

function shadeMarkup(mode,id) {
  const [slope,intercept]=shadeModes[mode];
  return `<filter id="${id}" color-interpolation-filters="sRGB"><feComponentTransfer>${['R','G','B'].map(channel=>`<feFunc${channel} type="linear" slope="${slope}" intercept="${intercept}"/>`).join('')}</feComponentTransfer></filter>`;
}

function fillValue(element,appearance,id) {
  return element.style?.gradient?`url(#${id}-gradient)`:paint(appearance.fill??element.fill);
}

export function presetShapeRootStyles(element,appearance) {
  const id=identifier(element.id);
  return [
    `--vividly-shape-fill:${fillValue(element,appearance,id)}`,
    `--vividly-shape-stroke:${paint(element.stroke.color)}`,
    `--vividly-shape-stroke-width:${n(element.stroke.width)}`,
    'background:transparent','border:0','border-radius:0','overflow:visible',
  ];
}

/** Deterministic preset paths, local gradients, and outline-aware shadow; never arbitrary SVG input. */
export function presetShapeMarkup(element,appearance,css=appearance.css||{}) {
  const {width,height,stroke,inset,paths}=layout(element),id=identifier(element.id),fill=fillValue(element,appearance,id),outline=paint(element.stroke.color);
  const usedModes=[...new Set(paths.map(path=>path.fillMode).filter(mode=>shadeModes[mode]))];
  let defs=gradientMarkup(element,id+'-gradient',width,height)+shadowMarkup(element.style?.shadow,id+'-shadow')+usedModes.map(mode=>shadeMarkup(mode,id+'-'+mode)).join('');
  const backgrounds=Object.entries(css).filter(([property])=>SHAPE_BACKGROUND_PROPERTIES.has(property)),advancedBackground=backgrounds.length>0;
  const backgroundStyle=[`width:100%`,`height:100%`,`background:${appearance.background||appearance.fill||element.fill}`,...backgrounds.map(([property,value])=>`${property}:${value}`)].join(';');
  const fills=[],outlines=[];
  for(const [index,path]of paths.entries()){
    if(typeof path.d!=='string'||!path.d||!/^[MmLlHhVvCcSsQqTtAaZz0-9eE+\-.,\s]+$/.test(path.d))throw new Error('도형 경로가 올바르지 않습니다.');
    if(path.fillMode!==undefined&&!Object.hasOwn(shadeModes,path.fillMode))throw new Error('지원하지 않는 도형 명암입니다.');
    const attrs=`d="${esc(path.d)}" fill-rule="${path.fillRule==='evenodd'?'evenodd':'nonzero'}"`;
    const clipId=id+'-css-clip-'+index;
    if(advancedBackground&&path.fill!==false)defs+=`<clipPath id="${clipId}" clipPathUnits="userSpaceOnUse"><path ${attrs}/></clipPath>`;
    const filled=path.fill===false?'':advancedBackground?`<g clip-path="url(#${clipId})"${path.fillMode?` filter="url(#${id}-${path.fillMode})"`:''}><foreignObject data-design-shape-paint="true" x="0" y="0" width="${n(width-inset*2)}" height="${n(height-inset*2)}"><div xmlns="http://www.w3.org/1999/xhtml" style="${esc(backgroundStyle)}"></div></foreignObject></g>`:`<path ${attrs} fill="var(--vividly-shape-fill,${fill})" stroke="none"${path.fillMode?` filter="url(#${id}-${path.fillMode})"`:''}/>`;
    const stroked=path.stroke===false||stroke===0?'':`<path ${attrs} fill="none" stroke="var(--vividly-shape-stroke,${outline})" stroke-width="var(--vividly-shape-stroke-width,${n(stroke)})" stroke-linejoin="round" stroke-linecap="round"/>`;
    fills.push(filled);outlines.push(stroked);
  }
  // DrawingML geometry supplies independent fill and outline subpaths. Paint the
  // fill planes first so a later background path cannot erase an earlier marker.
  const content=fills.join('')+outlines.join('');
  return `<svg class="element-shape-geometry" xmlns="http://www.w3.org/2000/svg" width="${n(width)}" height="${n(height)}" viewBox="0 0 ${n(width)} ${n(height)}" preserveAspectRatio="none" aria-hidden="true" focusable="false"><defs>${defs}</defs><g${element.style?.shadow?` filter="url(#${id}-shadow)"`:''}><g transform="translate(${n(inset)} ${n(inset)})">${content}</g></g></svg>`;
}

/** Paint-only update used at the native color commit boundary without replacing the clicked DOM. */
export function updatePresetShapePaint(node,element,appearance) {
  if(!node||!isPresetShape(element.shape))return false;
  node.style.setProperty('--vividly-shape-fill',fillValue(element,appearance,identifier(element.id)));
  node.style.setProperty('--vividly-shape-stroke',paint(element.stroke.color));
  node.style.setProperty('--vividly-shape-stroke-width',n(element.stroke.width));
  node.style.background='transparent';node.style.border='0';node.style.borderRadius='0';
  return true;
}

export function presetShapeBackdrop(element,appearance) {
  // A separate SVG image keeps the original outline visible underneath the text input surface.
  return `url("data:image/svg+xml,${encodeURIComponent(presetShapeMarkup(element,appearance))}")`;
}
