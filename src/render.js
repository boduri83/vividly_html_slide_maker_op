import { BUSINESS_CONTENT_CSS,renderRichParagraphs,tableContent,chartContent,svgContent,connectorContent,masterContent,orderedElements,staticControlContent } from './business-render.js';
import { resolveConnectorGeometry } from './business-model.js';
import { fontStack } from './font-names.js';
import { canonicalBase64 } from './safe-base64.js';
import { resolveDesignElement } from './design-model.js';
import { projectResponsiveSlide } from './responsive-model.js';
import { webFieldForVariable } from './web-authoring-model.js';
import {createBehaviorEvaluator}from './behavior-model.js';
import { videoContent,MEDIA_CONTENT_CSS } from './media-render.js';
import { isPresetShape, presetShapeMarkup, presetShapeRootStyles, presetShapeTextRect, presetShapeTextInsets, presetShapeBackdrop, updatePresetShapePaint,SHAPE_BACKGROUND_PROPERTIES } from './shape-render.js';
export { isPresetShape, presetShapeTextInsets } from './shape-render.js';
const TYPES = new Set(['text', 'shape', 'image','table','chart','connector','svg','video']);
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const GENERIC_FONTS = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui']);

export const CONTENT_CSS = `
.slide-element{position:absolute;box-sizing:border-box;overflow:hidden;isolation:isolate}
.slide-element *{box-sizing:border-box}
.slide-element .element-text-content{width:100%;height:100%;display:flex;flex-direction:column;overflow:hidden}
.slide-element .element-paragraphs{width:100%;flex:none}
.slide-element p{margin:0;padding:0;white-space:pre-wrap;overflow-wrap:break-word;line-height:inherit}
.slide-element p:empty::before{content:"\\200b"}
.slide-element img{display:block;width:100%;height:100%;border:0}
.slide-element .element-image-crop{position:absolute;overflow:hidden}
.slide-element>.element-text-content,.slide-element>img{pointer-events:none}
.slide-element>.element-shape-geometry{position:absolute;inset:0;display:block;width:100%;height:100%;overflow:visible;pointer-events:none}
.slide-element>.element-shape-text{position:absolute;overflow:hidden;pointer-events:none}
.behavior-input-control{width:100%;height:100%;box-sizing:border-box;padding:6px 10px;display:flex;flex-direction:column;justify-content:center;gap:3px;font:inherit;color:inherit}.behavior-input-control label{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}.behavior-input-control input:not([type=checkbox]),.behavior-input-control select,.behavior-input-control textarea{width:100%;min-width:0;min-height:0;max-height:100%;flex:1 1 auto;box-sizing:border-box;border:1px solid #a5b4cc;border-radius:7px;padding:4px 8px;background:#fff;color:#182037;font:inherit;font-size:.85em;line-height:1.15}.behavior-input-control[data-kind=checkbox]{flex-direction:row;align-items:center;gap:8px}.behavior-input-control[data-kind=checkbox] label{position:static;width:auto;height:auto;margin:0;overflow:visible;clip-path:none;white-space:normal;font:inherit;font-size:.8em}.behavior-input-control input[type=checkbox]{width:22px;height:22px;flex:none;accent-color:#4f46e5}.behavior-input-control input[type=range]{padding:0;accent-color:#4f46e5}.behavior-input-control input:focus-visible,.behavior-input-control select:focus-visible,.behavior-input-control textarea:focus-visible{outline:3px solid #6366f1;outline-offset:2px}.behavior-input-control [aria-invalid=true]{border-color:#b42334!important}.behavior-input-control [data-behavior-error]{font:11px/1.2 "Malgun Gothic",sans-serif;color:#b42334;overflow-wrap:anywhere;flex:none;max-height:50%;overflow:auto}.behavior-input-control textarea{resize:none}.behavior-input-control [hidden]{display:none!important}.behavior-input-control output{font:inherit;font-size:.7em;line-height:1.15;flex:none}.behavior-input-static{padding:6px 10px;display:flex;flex-direction:column;justify-content:center;gap:3px;width:100%;height:100%;box-sizing:border-box;font:inherit}.behavior-input-static span{font-size:.65em;line-height:1.1}.behavior-input-static strong{font:inherit;line-height:1.1}
`+BUSINESS_CONTENT_CSS+MEDIA_CONTENT_CSS;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

function number(value, label, positive = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || (positive && value <= 0)) {
    throw new Error(`${label}: 유효한 ${positive ? '양수' : '숫자'}가 필요합니다.`);
  }
  return String(Object.is(value, -0) ? 0 : value);
}

function color(value, label) {
  if (typeof value !== 'string' || !/^#(?:[a-f\d]{3}|[a-f\d]{4}|[a-f\d]{6}|[a-f\d]{8})$/i.test(value)) {
    throw new Error(`${label}: HEX 색상만 지원합니다.`);
  }
  return value;
}

function range(value, minimum, maximum, label) {
  number(value, label);
  if (value < minimum || value > maximum) throw new Error(`${label}: ${minimum}~${maximum} 범위가 필요합니다.`);
  return value;
}

function choice(value, allowed, label) {
  if (!allowed.includes(value)) throw new Error(`${label}: 지원하지 않는 값입니다.`);
  return value;
}

function fontFamily(value) {
  return fontStack(value);
}

const THEME_COLORS = new Set(['primary', 'secondary', 'background', 'text']);
function themeColor(reference, fallback, document, label) {
  if (reference === undefined) return fallback;
  if (!THEME_COLORS.has(reference)) throw new Error(`${label}: 지원하지 않는 테마 색입니다.`);
  return color(document.theme?.colors?.[reference], label);
}

/** Structured presentation appearance, also used by the text editing overlay. */
export function resolveElementAppearance(element, document) {
  const design=element.design?resolveDesignElement(element,document,{state:element.__designPreviewState||'base'}):null;
  if(design)element=design.element;
  const refs = element.themeRefs || {};
  const style = element.style || {};
  const fill = themeColor(refs.fill, element.fill, document, 'theme fill');
  const textColor = themeColor(refs.textColor, element.text?.textStyle?.color, document, 'theme textColor');
  const family = refs.fontFamily ? (element.semanticRole==='heading'?document.theme?.headingFontFamily||document.theme?.fontFamily:document.theme?.fontFamily) : element.text?.textStyle?.fontFamily;
  if (family !== undefined) fontFamily(family);
  let background = fill;
  if (style.gradient) {
    const gradient = style.gradient;
    choice(gradient.type, ['linear', 'radial'], 'gradient.type');
    if (!Array.isArray(gradient.stops) || gradient.stops.length < 2 || gradient.stops.length > 16)
      throw new Error('gradient.stops: 2~16개의 색상 지점이 필요합니다.');
    let previous = -1;
    const stops = gradient.stops.map(stop => {
      const offset = range(stop.offset, 0, 1, 'gradient offset');
      if (offset < previous) throw new Error('gradient.stops: 위치는 오름차순이어야 합니다.');
      previous = offset;
      return `${color(stop.color, 'gradient color')} ${number(offset * 100, 'gradient offset')}%`;
    }).join(',');
    background = gradient.type === 'linear'
      ? `linear-gradient(${number(gradient.angle, 'gradient angle')}deg,${stops})`
      : `radial-gradient(ellipse at center,${stops})`;
  }
  let boxShadow;
  if (style.shadow) {
    const shadow = style.shadow;
    number(shadow.blur, 'shadow blur');
    if (shadow.blur < 0) throw new Error('shadow blur는 음수일 수 없습니다.');
    boxShadow = `${number(shadow.x, 'shadow x')}px ${number(shadow.y, 'shadow y')}px ${number(shadow.blur, 'shadow blur')}px ${number(shadow.spread, 'shadow spread')}px ${color(shadow.color, 'shadow color')}`;
  }
  if (style.radius !== undefined && (number(style.radius, 'style radius'), style.radius < 0)) throw new Error('style radius는 음수일 수 없습니다.');
  return { fill, textColor, fontFamily: family, background,
    opacity: style.opacity === undefined ? 1 : range(style.opacity, 0, 1, 'style opacity'),
    radius: style.radius, rotation: element.rotation === undefined ? 0 : Number(number(element.rotation, 'rotation')), boxShadow,...(design?{css:design.css}:{}) };
}

/** Same fixed geometry as the committed shape, behind the text editing overlay. */
export function presetShapeEditorBackground(element, document) {
  const appearance=resolveElementAppearance(element,document);
  if(element.design)element=resolveDesignElement(element,document,{state:element.__designPreviewState||'base'}).element;
  return isPresetShape(element.shape) ? presetShapeBackdrop(element,appearance) : 'none';
}

/** Native color confirmation can repaint a preset without replacing the active control or canvas node. */
export function updatePresetShapeAppearance(node, element, document) {
  if(element.design)element=resolveDesignElement(element,document,{state:element.__designPreviewState||'base'}).element;
  return updatePresetShapePaint(node,element,resolveElementAppearance(element,document));
}

const DESIGN_TEXT_PROPERTIES=new Set(['color','font-family','font-size','font-weight','font-style','line-height','letter-spacing','word-spacing','text-align','text-transform','text-decoration','text-decoration-color','text-decoration-style','text-decoration-thickness','text-underline-offset','text-shadow','text-indent','white-space','overflow-wrap','word-break','writing-mode','text-orientation']);
function textContent(text, appearance,css={}) {
  if (!text || !Array.isArray(text.paragraphs) || text.paragraphs.some((paragraph) => typeof paragraph !== 'string')) {
    throw new Error('text.paragraphs: 문자열 배열이 필요합니다.');
  }
  const style = text.textStyle;
  if (!style || (style.bold !== undefined && typeof style.bold !== 'boolean')) throw new Error('textStyle: 올바른 서식이 필요합니다.');
  const align = choice(style.align, ['left', 'center', 'right'], 'textStyle.align');
  const vertical = choice(style.verticalAlign, ['top', 'middle', 'bottom'], 'textStyle.verticalAlign');
  const declarations = [
    `font-family:${fontFamily(appearance.fontFamily ?? style.fontFamily)}`,
    `font-size:${number(style.fontSize, 'fontSize', true)}px`,
    `line-height:${number(style.lineHeight, 'lineHeight', true)}`,
    `color:${color(appearance.textColor ?? style.color, 'text color')}`,
    `text-align:${align}`,
    `font-weight:${style.bold ? 700 : 400}`,
    `font-style:${style.italic?'italic':'normal'}`,
    `justify-content:${{ top: 'flex-start', middle: 'center', bottom: 'flex-end' }[vertical]}`,
  ];
  for(const[property,value]of Object.entries(css))if(DESIGN_TEXT_PROPERTIES.has(property))declarations.push(`${property}:${value}`);
  const styles=declarations.join(';');
  const paragraphs = text.runs||text.paragraphStyles||style.underline||style.strike?renderRichParagraphs(text):text.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('');
  return `<div class="element-text-content" style="${escapeHtml(styles)}"><div class="element-paragraphs">${paragraphs}</div></div>`;
}

function imageContent(element, document) {
  const asset = document.assets?.find((candidate) => candidate.id === element.assetId);
  if (!asset || !IMAGE_TYPES.has(asset.mimeType) || !canonicalBase64(asset.dataBase64)) {
    throw new Error(`이미지 자산을 읽을 수 없습니다: ${element.assetId}`);
  }
  const fit = choice(element.fit, ['contain', 'cover'], 'image.fit');
  const attributes = `alt="${escapeHtml(element.alt ?? '')}" src="data:${asset.mimeType};base64,${asset.dataBase64}" draggable="false"`;
  const focal = element.focal || { x: 0.5, y: 0.5 };
  range(focal.x, 0, 1, 'image focal x'); range(focal.y, 0, 1, 'image focal y');
  if (element.crop) {
    const box = imageCropLayout(element, asset);
    return `<div class="element-image-crop" style="left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px"><img ${attributes} style="position:absolute;left:${box.imageLeft}px;top:${box.imageTop}px;width:${box.imageWidth}px;height:${box.imageHeight}px;object-fit:fill"></div>`;
  }
  const position = element.focal ? `;object-position:${focal.x * 100}% ${focal.y * 100}%` : '';
  return `<img ${attributes} style="object-fit:${fit}${position}">`;
}

/** Geometry of a clipped source region. Original image bytes and aspect ratio are unchanged. */
export function imageCropLayout(element, asset) {
  const crop = element.crop || { x: 0, y: 0, width: 1, height: 1 };
  range(crop.x, 0, 1, 'crop.x'); range(crop.y, 0, 1, 'crop.y');
  range(crop.width, Number.EPSILON, 1, 'crop.width'); range(crop.height, Number.EPSILON, 1, 'crop.height');
  if (crop.x + crop.width > 1 + 1e-9 || crop.y + crop.height > 1 + 1e-9) throw new Error('crop 범위가 원본 이미지를 벗어났습니다.');
  const width = Number(number(element.geometry.width, 'geometry.width', true));
  const height = Number(number(element.geometry.height, 'geometry.height', true));
  const naturalWidth = Number(number(asset.width, 'asset.width', true));
  const naturalHeight = Number(number(asset.height, 'asset.height', true));
  const factor = (choice(element.fit, ['contain', 'cover'], 'image.fit') === 'cover' ? Math.max : Math.min)(width / (naturalWidth * crop.width), height / (naturalHeight * crop.height));
  const croppedWidth = naturalWidth * crop.width * factor, croppedHeight = naturalHeight * crop.height * factor;
  const focal = element.focal || { x: 0.5, y: 0.5 };
  range(focal.x, 0, 1, 'image focal x'); range(focal.y, 0, 1, 'image focal y');
  const clean = value => Number(value.toFixed(8));
  return { left: clean((width - croppedWidth) * focal.x), top: clean((height - croppedHeight) * focal.y),
    width: clean(croppedWidth), height: clean(croppedHeight), imageLeft: clean(-crop.x * naturalWidth * factor),
    imageTop: clean(-crop.y * naturalHeight * factor), imageWidth: clean(naturalWidth * factor), imageHeight: clean(naturalHeight * factor) };
}

function initialBehaviorValues(document,slide){return slide?.__behaviorInitialValues||Object.fromEntries((document.behavior?.variables||[]).map(v=>[v.id,v.initial]));}
function initialBodyValues(slide){return slide?.__sceneInitialBodies||Object.fromEntries((slide?.scene?.bodies||[]).map(b=>{const e=slide.elements.find(e=>e.id===b.targetId);return[b.targetId,{x:e?.geometry.x||0,y:e?.geometry.y||0,vx:b.velocity?.x||0,vy:b.velocity?.y||0,angle:e?.rotation||0,grounded:false}];}));}
function behaviorBindingText(binding,document,slide){
  const result=createBehaviorEvaluator().evaluate(binding.expression,initialBehaviorValues(document,slide),{x:0,y:0,dx:0,dy:0,worldX:0,worldY:0,worldDx:0,worldDy:0,otherId:'',normalX:0,normalY:0,value:'',elapsed:0,delta:0,key:'',down:false},initialBodyValues(slide));if(!result.ok)return'—';const value=result.value;
  if(['number','percent'].includes(binding.format)){if(typeof value!=='number'||!Number.isFinite(value))return'—';return(binding.prefix||'')+new Intl.NumberFormat('ko-KR',{...(binding.format==='percent'?{style:'percent'}:{}),minimumFractionDigits:binding.decimals??0,maximumFractionDigits:binding.decimals??0}).format(value)+(binding.suffix||'');}
  return(binding.prefix||'')+String(value)+(binding.suffix||'');
}
function behaviorInputContent(input,element,document,interactive,staticState,slide,css={}){
  const variable=document.behavior?.variables?.find(v=>v.id===input.variableId);if(!variable)return'';const field=webFieldForVariable(document,input.variableId),value=initialBehaviorValues(document,slide)[variable.id],label=field?.label||((element.name?element.name+' · ':'')+variable.name);
  if(staticState)return`<div class="behavior-input-static"><span>${escapeHtml(label)}</span><strong>${escapeHtml(variable.type==='choice'?variable.options?.find(o=>o.value===value)?.label||value:variable.type==='boolean'?value?'예':'아니오':value)}</strong></div>`;
  const id='vividly-input-'+Array.from(input.id,c=>c.codePointAt(0).toString(16)).join('-'),common=`id="${id}" data-behavior-input="${escapeHtml(input.id)}" aria-describedby="${id}-error" aria-invalid="false"${interactive?' tabindex="-1"':''}`;
  const minimum=input.minimum??variable.minimum??(['number','range'].includes(input.kind)?0:undefined),maximum=input.maximum??variable.maximum??(['number','range'].includes(input.kind)?100:undefined),step=input.step??variable.step;
  const webAttributes=`${field?.required?' required':''}${field?.placeholder?` placeholder="${escapeHtml(field.placeholder)}"`:''}${['text','email','textarea'].includes(input.kind)?` maxlength="${field?.maxLength||4096}"`:''}`;
  let control;if(input.kind==='select')control=`<select ${common}${webAttributes}>${(variable.options||[]).map(o=>`<option value="${escapeHtml(o.value)}"${o.value===value?' selected':''}>${escapeHtml(o.label)}</option>`).join('')}</select>`;
  else if(input.kind==='textarea')control=`<textarea ${common}${webAttributes}>${escapeHtml(value)}</textarea>`;
  else control=`<input type="${escapeHtml(input.kind)}" ${common}${webAttributes}${input.kind==='checkbox'?value?' checked':'':` value="${escapeHtml(value)}"`}${minimum!==undefined?` min="${number(minimum,'behavior input minimum')}"`:''}${maximum!==undefined?` max="${number(maximum,'behavior input maximum')}"`:''}${step!==undefined?` step="${number(step,'behavior input step',true)}"`:['number','range'].includes(input.kind)?' step="any"':''}>`;
  const text=element.text?.textStyle||{},style=[...(interactive?['pointer-events:none']:[]),`font-family:${fontFamily(text.fontFamily||document.theme?.fontFamily||'Malgun Gothic')}`,`font-size:${number(text.fontSize||24,'input font size',true)}px`,`line-height:${number(text.lineHeight||1.3,'input line height',true)}`,`color:${color(text.color||'#182037','input color')}`,...Object.entries(css).filter(([property])=>/^(?:color|font-|line-height|letter-spacing|word-spacing|text-align)/.test(property)).map(([property,value])=>`${property}:${value}`)].join(';');
  return`<div class="behavior-input-control" data-kind="${input.kind}" style="${escapeHtml(style)}"><label for="${id}">${escapeHtml(label)}</label>${control}${input.kind==='range'?`<output data-behavior-output="${escapeHtml(input.id)}">${escapeHtml(value)}</output>`:''}<span id="${id}-error" data-behavior-error="${escapeHtml(input.id)}" role="alert" hidden></span></div>`;
}
function renderElement(element, document, interactive, slide, originalIndex,staticState,staticZ,designOptions={}) {
  if (!element || !TYPES.has(element.type) || typeof element.id !== 'string') throw new Error('지원하지 않는 개체입니다.');
  const disabled=element.design?.disabled===true;
  let design=designOptions.resolved||(element.design?resolveDesignElement(element,document,{state:designOptions.state||element.__designPreviewState||(disabled?'disabled':'base')}):null);
  if(design)element=design.element;
  if(staticState&&element.__staticBehaviorStyle){
    const state=element.__staticBehaviorStyle; element=structuredClone(element);design={...(design||{}),css:{...(design?.css||{})},states:design?.states||{}};
    if(state.fill!==undefined&&element.type==='shape'){element.fill=state.fill;element.style={...element.style,gradient:undefined};for(const key of Object.keys(design.css))if(key==='background'||key.startsWith('background-'))delete design.css[key];}
    if(state.color!==undefined&&element.text){element.text.textStyle.color=state.color;delete design.css.color;}
    if(state.opacity!==undefined){element.style={...element.style,opacity:state.opacity};delete design.css.opacity;}
    if(state.radius!==undefined){element.style={...element.style,radius:state.radius};for(const key of Object.keys(design.css))if(key==='border-radius'||/^border-.*-radius$/.test(key))delete design.css[key];}
    if(state.blur!==undefined||state.shadow){const filters=[design.css.filter??(element.style?.blur!==undefined?`blur(${element.style.blur}px)`:''),state.blur!==undefined?`blur(${state.blur}px)`:'',state.shadow?`drop-shadow(${state.shadow.x}px ${state.shadow.y}px ${state.shadow.blur}px ${state.shadow.color})`:''];design.css.filter=filters.filter(Boolean).join(' ');}
  }
  const behaviorBinding=slide.behavior?.bindings?.find(b=>b.targetId===element.id);
  if(behaviorBinding&&element.text){const {runs,paragraphStyles,...text}=element.text;element={...element,text:{...text,paragraphs:[behaviorBindingText(behaviorBinding,document,slide)]}};}
  const resolved=element.type==='connector'?(staticState&&element.__staticConnector||resolveConnectorGeometry(element,slide)):null;
  const geometry = resolved?.geometry||element.geometry;
  if (!geometry) throw new Error('개체 geometry가 필요합니다.');
  const styles = [
    `left:${number(geometry.x, 'geometry.x')}px`,
    `top:${number(geometry.y, 'geometry.y')}px`,
    `width:${number(geometry.width, 'geometry.width', true)}px`,
    `height:${number(geometry.height, 'geometry.height', true)}px`,
  ];
  const poseStyles=[];
  const appearance = resolveElementAppearance(element, document);
  const presetShape=element.type==='shape'&&isPresetShape(element.shape);
  if(['table','chart'].includes(element.type))styles.push(`font-family:${fontFamily(document.theme?.fontFamily||'Malgun Gothic')}`);
  if(staticZ!==undefined)styles.push(`z-index:${staticZ}`);else if(slide.readingOrder?.length||['0.4-business.1','0.5-motion.1','0.12-design.1','0.13-behavior.1','0.14-scene.1','0.15-authoring.1'].includes(document.schemaVersion))styles.push(`z-index:${originalIndex+1}`);
  if (element.rotation !== undefined) styles.push(`transform:rotate(${number(element.rotation, 'rotation')}deg)`, 'transform-origin:center center');
  if (staticState && element.__staticMotionPose) {
    const pose = element.__staticMotionPose;
    if (['x','y','rotate','scale'].some(key => key in pose)) poseStyles.push(`transform:translate(${number(pose.x || 0,'pose.x')}px,${number(pose.y || 0,'pose.y')}px) rotate(${number((element.rotation || 0)+(pose.rotate || 0),'pose.rotation')}deg) scale(${number(pose.scale ?? 1,'pose.scale')})`);
  }
  if (element.style?.opacity !== undefined) styles.push(`opacity:${number(appearance.opacity, 'opacity')}`);
  if (staticState && element.__staticMotionPose?.opacity !== undefined) poseStyles.push(`opacity:${number(element.__staticMotionPose.opacity,'pose.opacity')}`);
  if (element.style?.radius !== undefined&&!presetShape) styles.push(`border-radius:${number(appearance.radius, 'radius')}px`);
  if(element.style?.backdropBlur!==undefined)styles.push(`backdrop-filter:blur(${number(element.style.backdropBlur,'backdropBlur')}px)`);
  if(element.style?.blur!==undefined)styles.push(`filter:blur(${number(element.style.blur,'blur')}px)`);
  if(staticState&&element.__staticMotionPose?.blur!==undefined)poseStyles.push(`filter:blur(${number(element.__staticMotionPose.blur,'pose.blur')}px)`);
  if(element.style?.blendMode)styles.push(`mix-blend-mode:${choice(element.style.blendMode,['normal','multiply','screen','overlay','darken','lighten','color-dodge'],'blendMode')}`);
  if (appearance.boxShadow !== undefined&&!presetShape) styles.push(`box-shadow:${appearance.boxShadow}`);
  if (element.type !== 'shape' && appearance.background) styles.push(`background:${appearance.background}`);
  let content = '';
  if (element.type === 'text') {
    content = textContent(element.text, appearance,design?.css);
  }
  if (element.type === 'shape') {
    const width = number(element.stroke?.width, 'stroke.width');
    if (element.stroke.width < 0) throw new Error('stroke.width는 음수일 수 없습니다.');
    if(presetShape){
      styles.push(...presetShapeRootStyles(element,appearance));
      content=presetShapeMarkup(element,appearance,design?.css);
      if(element.text!==undefined){const rect=presetShapeTextRect(element);content+=`<div class="element-shape-text" style="left:${number(rect.x,'shape text x')}px;top:${number(rect.y,'shape text y')}px;width:${number(rect.width,'shape text width')}px;height:${number(rect.height,'shape text height')}px">${textContent(element.text,appearance,design?.css)}</div>`;}
    }else{
      choice(element.shape, ['rectangle', 'ellipse'], 'shape');
      styles.push(`background:${appearance.background || color(element.fill, 'fill')}`, `border:${width}px solid ${color(element.stroke.color, 'stroke.color')}`, `border-radius:${element.shape === 'ellipse' ? '50%' : element.style?.radius !== undefined ? `${appearance.radius}px` : '0'}`);
      if (element.text !== undefined) content = textContent(element.text, appearance,design?.css);
    }
  }
  if(element.type==='image'){
    const sprite=slide.scene?.sprites?.find(s=>s.targetId===element.id);
    if(sprite){const asset=document.assets.find(a=>a.id===element.assetId),state=slide.__sceneInitialSprites?.[element.id],clip=sprite.clips.find(c=>c.id===(state?.clipId||sprite.initialClipId))||sprite.clips[0],f=clip?.frames[state?.frame||0]||{x:0,y:0,width:asset.width,height:asset.height};content=`<svg data-scene-sprite="${escapeHtml(element.id)}" xmlns="http://www.w3.org/2000/svg" viewBox="${[f.x,f.y,f.width,f.height].join(' ')}" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(element.alt||element.name||'이미지')}" style="width:100%;height:100%;display:block;overflow:hidden"><image href="data:${asset.mimeType};base64,${asset.dataBase64}" width="${asset.width}" height="${asset.height}"/></svg>`;}
    else content=imageContent(element,document);
  }
  if(element.type==='video')content=videoContent(element,document,{interactive,staticState});
  if(element.type==='table')content=tableContent(element.table);
  if(element.type==='chart')content=chartContent(element,document);
  if(element.type==='svg')content=svgContent(element.svg);
  if(element.type==='connector')content=connectorContent(element,resolved);
  if(staticState)content=staticControlContent(element,document,staticState.variables)||content;
  if(design?.css)for(const [property,value]of Object.entries(design.css))if(!(presetShape&&SHAPE_BACKGROUND_PROPERTIES.has(property)))styles.push(`${property}:${value}`);
  const behaviorInput=slide.behavior?.inputs?.find(input=>input.targetId===element.id);if(behaviorInput)content=behaviorInputContent(behaviorInput,element,document,interactive,staticState,slide,design?.css);
  styles.push(...poseStyles);
  const visual={style:styles.join(';'),textStyle:content.match(/class="element-text-content" style="([^"]*)"/)?.[1]?.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&')||null,
    shape:element.type==='shape'&&presetShape?presetShapeMarkup(element,appearance,design?.css):null};
  if(designOptions.capture)Object.assign(designOptions.capture,visual);
  let designAttributes='';
  if(design&&!staticState&&!designOptions.resolved){
    const stateVisuals={base:visual};
    for(const [state,projection]of Object.entries(design.states||{})){
      const capture={};renderElement(projection.element,document,false,slide,originalIndex,undefined,staticZ,{resolved:projection,capture});stateVisuals[state]=capture;
    }
    designAttributes=` data-design-visuals="${escapeHtml(JSON.stringify(stateVisuals))}"${disabled?' data-design-disabled="true"':''}`;
  }
  const hit = interactive ? ` data-interactive="true"${element.locked ? ' data-locked="true"' : ''}` : '';
  const group = element.groupId ? ` data-group-id="${escapeHtml(element.groupId)}"` : '';
  const semantic=behaviorInput?'':element.semanticRole==='decorative'?' aria-hidden="true"':element.semanticRole==='heading'?' role="heading" aria-level="2"':element.semanticRole==='body'?' role="group"':'';
  return `<div class="slide-element element-${element.type}" data-element-id="${escapeHtml(element.id)}"${element.flow||element.composition?' data-layout-container="true"':''}${presetShape?' data-preset-shape="true"':''}${group}${hit}${semantic}${designAttributes} style="${escapeHtml(styles.join(';'))}">${content}</div>`;
}

/** Common content renderer: editor hit attributes never change content layout. */
export function renderSlideContent(slide, document, { interactive = false,staticState,designStates={},viewportWidth } = {}) {
  if (!slide || !Array.isArray(slide.elements)) throw new Error('슬라이드 elements 배열이 필요합니다.');
  if(viewportWidth!==undefined)slide=projectResponsiveSlide(slide,document,viewportWidth).slide;
  const z=new Map();let dim='';
  if(staticState)for(const [index,panel]of slide.elements.filter(e=>e.component?.kind==='panel'&&staticState.openPanels.includes(e.id)&&!e.hidden).entries()){
    const level=10000+index*2;for(const id of [panel.id,...(panel.component.contentIds||[])])z.set(id,level+1);
    if(panel.component.dim)dim+=`<div aria-hidden="true" style="position:absolute;inset:0;background:#10182a88;z-index:${level}"></div>`;
  }
  const rendered=orderedElements(slide).filter(element=>!element.hidden).map(element=>({element,html:renderElement(element,document,interactive,slide,slide.elements.indexOf(element),staticState,z.get(element.id),{state:designStates[element.id]})}));
  if(staticState&&slide.__sceneInitialCamera){const c=slide.__sceneInitialCamera,hud=new Set(slide.scene?.hudIds||[]);return`<div style="position:absolute;inset:0;transform-origin:0 0;transform:translate(${-c.x*c.zoom}px,${-c.y*c.zoom}px) scale(${c.zoom})">${rendered.filter(r=>!hud.has(r.element.id)).map(r=>r.html).join('')}</div>`+rendered.filter(r=>hud.has(r.element.id)).map(r=>r.html).join('')+masterContent(slide,document)+dim;}
  return rendered.map(r=>r.html).join('')+masterContent(slide,document)+dim;
}

export function renderSlide(slide, document, { interactive = false,staticState,viewportWidth } = {}) {
  const projection=viewportWidth===undefined?null:projectResponsiveSlide(slide,document,viewportWidth);
  if(projection)slide=projection.slide;
  const width = number(projection?.width??document.canvas?.width, 'canvas.width', true);
  const height = number(projection?.height??document.canvas?.height, 'canvas.height', true);
  const background = color(slide.background, 'slide.background');
  return `<section class="presentation-slide" data-slide-id="${escapeHtml(slide.id)}" style="position:absolute;left:0;top:0;width:${width}px;height:${height}px;background:${background}">${renderSlideContent(slide, document, { interactive,staticState })}</section>`;
}

/** Stable semantic sections for both the app player and standalone player. */
export function renderPresentationSlides(document) {
  return document.slides.map(slide => renderSlide(slide, document)).join('\n');
}
