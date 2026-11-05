import { changedTargetIds } from './document-diff.js';
import { canonicalBase64 } from './safe-base64.js';
import{createDirtyTracker}from'./dirty-tracker.js';
import { SHAPE_KINDS, SHAPE_CATEGORIES, getShapeDefinition, normalizeShapeAdjustments } from './shapes.js';
import { FREEFORM_KIND, normalizeFreeformPath } from './drawing-model.js';
import { normalizeLayouts, normalizeLayoutLink,normalizeLayoutMasters,detachLayoutFromSlide,isInheritedLayoutElement } from './master-model.js';
import { isFontFamily } from './font-names.js';
import { VIDEO_MIME_TYPES,normalizeVideoSettings,validateMediaAsset,validateMediaBudget } from './media-model.js';
import { MOTION_SCHEMA, ADVANCED_SCHEMA, motionSchemas, normalizeMotionValue, validateMotionReferences, cleanMotionReferences } from './motion-model.js';
import { hasAdvancedMotion, validateAdvancedReferences, cleanAdvancedReferences } from './advanced-motion-model.js';
import { BUSINESS_SCHEMA, businessSchemas, normalizeBusinessValue, normalizeBusinessText, isBusinessElement, isBusinessDocument, validateBusinessReferences, cleanBusinessReferences } from './business-model.js';
export { MOTION_SCHEMA } from './motion-model.js';
export { ADVANCED_SCHEMA } from './motion-model.js';
export { BUSINESS_SCHEMA } from './business-model.js';
import {DESIGN_SCHEMA,normalizeStyleTokens,normalizeDesignRecipes,normalizeElementDesign,normalizeFlow,resolveFlowSlide,validateDesignReferences,detachDesignElement,hasDesign} from './design-model.js';
export {DESIGN_SCHEMA} from './design-model.js';
import {BEHAVIOR_SCHEMA,BEHAVIOR_LIMITS,normalizeBehaviorVariables,normalizeBehaviorSlide,validateBehaviorReferences,cleanBehaviorReferences,behaviorIds,referencedBehaviorVariables,remapBehaviorSlide,selectBehaviorForElements,hasSpatialBehavior}from './behavior-model.js';
export{BEHAVIOR_SCHEMA}from './behavior-model.js';
import{SCENE_SCHEMA,SCENE_LIMITS,normalizeScene,validateSceneReferences,cleanSceneReferences,sceneIds,selectSceneForElements,remapScene}from'./scene-model.js';
export{SCENE_SCHEMA}from'./scene-model.js';
import {AUTHORING_SCHEMA,COMPONENT_LIMITS,hasAuthoringContent,normalizeComponentLibrary,normalizeComponentInstances,copyComponentInstances,compositeIds} from './component-library-model.js';
export {AUTHORING_SCHEMA} from './component-library-model.js';
import {normalizeComposition} from './composition-model.js';
import {normalizeWebForms,normalizeWebControl,validateWebReferences} from './web-authoring-model.js';
import {normalizeResponsiveDocument,normalizeResponsiveElement,validateResponsiveReferences} from './responsive-model.js';
import {prepareLibraryImport} from './reuse-library.js';
import{AUDIO_MIME_TYPES,normalizeAudioAsset,validateAudioBudget}from'./audio-model.js';

const FORMAT = 'html-slide-document';
const SCHEMA = '0.1-draft.1';
export const WORKBENCH_SCHEMA = '0.2-workbench.1';
const THEME_COLORS = ['primary', 'secondary', 'background', 'text'];
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
let sequence = 0;

export function cloneDocument(value) {
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function fail(message) { throw new Error(message); }
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label}: 객체가 필요합니다.`);
  return value;
}
function keys(value, allowed, label) {
  object(value, label);
  const unknown = Object.keys(value).find(key => !allowed.includes(key));
  if (unknown) fail(`${label}.${unknown}: 지원하지 않는 필드입니다. 원본을 보존해 주세요.`);
}
function between(value, min, max, label) {
  finite(value, label);
  if (value < min || value > max) fail(`${label}: ${min}~${max} 범위여야 합니다.`);
  return value;
}
function bool(value, label) { if (typeof value !== 'boolean') fail(`${label}: Boolean이 필요합니다.`); return value; }
export function normalizeVisualStyle(value) {
  keys(value, ['opacity', 'radius', 'gradient', 'shadow', 'backdropBlur', 'blur', 'blendMode'], 'style');
  const result = {};
  for (const key of ['blur','backdropBlur']) if(value[key]!==undefined) result[key]=between(value[key],0,100,`style.${key}`);
  if(value.blendMode!==undefined) result.blendMode=choice(value.blendMode,['normal','multiply','screen','overlay','darken','lighten','color-dodge'],'style.blendMode');
  if (value.opacity !== undefined) result.opacity = between(value.opacity, 0, 1, 'style.opacity');
  if (value.radius !== undefined) result.radius = between(value.radius, 0, 100000, 'style.radius');
  if (value.gradient !== undefined && value.gradient !== null) {
    const gradient = value.gradient; keys(gradient, ['type', 'angle', 'stops'], 'gradient');
    if (!Array.isArray(gradient.stops) || gradient.stops.length < 2 || gradient.stops.length > 16) fail('그라데이션은 2~16개 stop이 필요합니다.');
    result.gradient = { type: choice(gradient.type, ['linear', 'radial'], 'gradient.type'), angle: finite(gradient.angle, 'gradient.angle'),
      stops: gradient.stops.map(stop => { keys(stop, ['offset', 'color'], 'gradient.stop'); return { offset: between(stop.offset, 0, 1, 'stop.offset'), color: color(stop.color, 'stop.color') }; }) };
    if (result.gradient.stops.some((stop, i, all) => i && stop.offset < all[i - 1].offset)) fail('그라데이션 stop은 순서대로 배치해야 합니다.');
  }
  if (value.shadow !== undefined && value.shadow !== null) {
    const shadow = value.shadow; keys(shadow, ['x', 'y', 'blur', 'spread', 'color'], 'shadow');
    result.shadow = { x: finite(shadow.x, 'shadow.x'), y: finite(shadow.y, 'shadow.y'), blur: between(shadow.blur, 0, 100000, 'shadow.blur'), spread: finite(shadow.spread, 'shadow.spread'), color: color(shadow.color, 'shadow.color') };
  }
  return result;
}
function normalizeTheme(value, business = false) {
  keys(value, ['colors', 'fontFamily', ...(business?['headingFontFamily','spacing']:[])], 'theme'); keys(value.colors, THEME_COLORS, 'theme.colors');
  const colors = Object.fromEntries(THEME_COLORS.map(key => [key, color(value.colors[key], `theme.colors.${key}`)]));
  const fontFamily = string(value.fontFamily, 'theme.fontFamily');
  if (!isFontFamily(fontFamily)) fail('theme.fontFamily: 지원하지 않는 글꼴 이름입니다.');
  const result={colors,fontFamily};
  if(value.headingFontFamily!==undefined){const name=string(value.headingFontFamily,'headingFontFamily');if(!isFontFamily(name))fail('headingFontFamily: 지원하지 않는 글꼴 이름입니다.');result.headingFontFamily=name;}
  if(value.spacing!==undefined)result.spacing=normalizeBusinessValue(value.spacing,businessSchemas.spacing,'theme.spacing');
  return result;
}
export function getDocumentCapabilities() {
  return { format: FORMAT, readableSchemaVersions: [SCHEMA, WORKBENCH_SCHEMA, MOTION_SCHEMA, BUSINESS_SCHEMA,ADVANCED_SCHEMA,DESIGN_SCHEMA,BEHAVIOR_SCHEMA,SCENE_SCHEMA,AUTHORING_SCHEMA], extendedSchemaVersion: AUTHORING_SCHEMA,
    elements: ['text', 'shape', 'image','table','chart','connector','svg','video'], componentLibrary:{limits:COMPONENT_LIMITS,sourceUpdate:'preserve-content-and-local-overrides',history:'shared'}, features: ['multiSelection', 'groups', 'rotation', 'lock', 'hidden', 'layers', 'align', 'distribute', 'clipboard', 'theme', 'gradient', 'shadow', 'opacity', 'radius', 'imageCrop', 'slideImport', 'canvasResize', 'videoPlayback', 'mediaActions', 'dedicatedMasterEditor','layoutHierarchy','newSlideFromLayout','typedLayoutSlots','layoutReset','layoutLocalOverrides', 'designTokens','styleRecipes','styleOverrides','automaticStyleStates','designDisabled','scopedCssDeclarations','flowLayout','reusableCompositeComponents','componentInstances','responsiveLayout', 'reusableLayouts', 'layoutPlaceholders', 'layoutPropagation', 'cssBackdropBlur', 'cssBlur', 'cssBlendModes', 'motion', 'slideTransition', 'interactions', 'components', 'choiceVariables', 'numberVariables', 'conditionalNavigation', 'chartJsAnimation', 'chartTooltips', 'textBindings', 'initialVisibility','richText','lists','links','tables','charts','chartVariants','connectors','safeSvg','businessTemplates','master','notes','readingOrder','semantics','diagnostics','keyframes','timelineOffsets','textStagger','motionClips','namedStates','conditionalInteractions','slider','formulaBindings','scrollTriggers','inViewTriggers','keyTriggers'],
    motion: { presets: [...motionSchemas.motion.properties.preset.enum], starts: [...motionSchemas.motion.properties.start.enum], events: [...motionSchemas.interaction.properties.event.enum], components: ['button', 'tabs', 'select', 'panel','slider'], features:['numberVariables','numericComparisons','numericAddActions','interactionOnlyNavigation','cssStates','keyframes','timelineOffsets','textStagger','motionClips','namedStates','conditions','formulaBindings','inView','scroll','key'],runtimeState: 'separate-from-author-document', arbitraryScript: false },
    scene:{namespace:'scene',features:['physicsBodies','contactEvents','camera','spriteClips','localAudio','portableProgress'],limits:SCENE_LIMITS,physics:'matter-js@0.20.0',runtimeState:'separate-from-author-document'},
    behavior:{namespace:'behavior',variableKinds:['number','boolean','text','choice'],features:['typedExpressions','compoundConditions','stateMachines','timers','heldInput','pointerDrag','computedText','runtimeTrace'],limits:BEHAVIOR_LIMITS,runtimeState:'separate-from-author-document',arbitraryScript:false},
    shapes: { presets: [...SHAPE_KINDS], categories: SHAPE_CATEGORIES.map(category=>({...category})), adjustableHandles: true, freeform:true, drawingPreview:'separate-from-committed-document' },
    unknownFields: 'reject-without-mutation', schemaUpgrade: 'on-first-extended-edit', downgrade: 'explicit-loss-report-required' };
}
function string(value, label) {
  if (typeof value !== 'string') fail(`${label}: 문자열이 필요합니다.`);
  return value;
}
function finite(value, label, positive = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || (positive && value <= 0)) fail(`${label}: 유효한 ${positive ? '양수' : '수'}가 필요합니다.`);
  return value;
}
function choice(value, allowed, label) {
  if (!allowed.includes(value)) fail(`${label}: 지원하지 않는 값입니다.`);
  return value;
}
function color(value, label) {
  if (typeof value !== 'string' || !/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)) fail(`${label}: HEX 색상이 필요합니다.`);
  return value.toLowerCase();
}
function lf(value) { return value.replace(/\r\n?/g, '\n'); }
function id(value, label) {
  string(value, label);
  if (!value.trim()) fail(`${label}: 비어 있는 ID입니다.`);
  return value;
}
function geometry(value) {
  keys(value, ['x', 'y', 'width', 'height'], 'geometry');
  return { x: finite(value.x, 'geometry.x'), y: finite(value.y, 'geometry.y'), width: finite(value.width, 'geometry.width', true), height: finite(value.height, 'geometry.height', true) };
}
function text(value, business = true) {
  keys(value, ['paragraphs', 'textStyle', ...(business?['runs','paragraphStyles']:[])], 'text');
  if (!Array.isArray(value.paragraphs)) fail('text.paragraphs: 문자열 배열이 필요합니다.');
  const style = object(value.textStyle, 'textStyle');
  keys(style, ['fontFamily', 'fontSize', 'lineHeight', 'color', 'align', 'verticalAlign', 'bold','italic','underline','strike'], 'textStyle');
  const fontFamily = string(style.fontFamily, 'fontFamily');
  if (!isFontFamily(fontFamily)) fail('fontFamily: 지원하지 않는 글꼴 이름입니다.');
  if (style.bold !== undefined && typeof style.bold !== 'boolean') fail('textStyle.bold: Boolean이 필요합니다.');
  const result = {
    paragraphs: value.paragraphs.map((paragraph) => lf(string(paragraph, 'paragraph'))),
    textStyle: {
      fontFamily, fontSize: finite(style.fontSize, 'fontSize', true),
      lineHeight: finite(style.lineHeight, 'lineHeight', true), color: color(style.color, 'text color'),
      align: choice(style.align, ['left', 'center', 'right'], 'align'),
      verticalAlign: choice(style.verticalAlign, ['top', 'middle', 'bottom'], 'verticalAlign'),
    },
  };
  if (style.bold !== undefined) result.textStyle.bold = style.bold;
  for(const key of ['italic','underline','strike'])if(style[key]!==undefined)result.textStyle[key]=bool(style[key],`textStyle.${key}`);
  return normalizeBusinessText(value,result);
}
function asset(value) {
  if(AUDIO_MIME_TYPES.includes(value?.mimeType))return normalizeAudioAsset(value);
  keys(value, ['id', 'mimeType', 'width', 'height', 'bytes', 'sha256', 'dataBase64'], 'asset');
  const data = string(value.dataBase64, 'asset.dataBase64');
  if (!canonicalBase64(data)) fail('asset.dataBase64: 올바른 base64가 아닙니다.');
  const bytes = finite(value.bytes, 'asset.bytes', true);
  const decodedLength = data.length / 4 * 3 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
  if (!Number.isSafeInteger(bytes) || bytes !== decodedLength) fail('asset.bytes: base64 길이와 일치하지 않습니다.');
  const hash = string(value.sha256, 'asset.sha256').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) fail('asset.sha256: SHA-256 형식이 아닙니다.');
  return {
    id: id(value.id, 'asset.id'), mimeType: choice(value.mimeType, [...IMAGE_TYPES,...VIDEO_MIME_TYPES], 'asset.mimeType'),
    width: finite(value.width, 'asset.width', true), height: finite(value.height, 'asset.height', true),
    bytes, sha256: hash, dataBase64: data,
  };
}

/** Return a detached, validated document projection. View and session state are excluded. */
export function normalizeDocument(input) {
  keys(input, ['format', 'schemaVersion', 'id', 'title', 'canvas', 'slides', 'assets', 'theme', 'selection', 'history', 'viewport', ...([MOTION_SCHEMA,BUSINESS_SCHEMA,ADVANCED_SCHEMA,DESIGN_SCHEMA,BEHAVIOR_SCHEMA,SCENE_SCHEMA,AUTHORING_SCHEMA].includes(input.schemaVersion) ? ['variables'] : []), ...([BUSINESS_SCHEMA,ADVANCED_SCHEMA,DESIGN_SCHEMA,BEHAVIOR_SCHEMA,SCENE_SCHEMA,AUTHORING_SCHEMA].includes(input.schemaVersion)?['master','layouts','layoutMasters']:[]),...([ADVANCED_SCHEMA,DESIGN_SCHEMA,BEHAVIOR_SCHEMA,SCENE_SCHEMA,AUTHORING_SCHEMA].includes(input.schemaVersion)?['motionClips']:[]),...([DESIGN_SCHEMA,BEHAVIOR_SCHEMA,SCENE_SCHEMA,AUTHORING_SCHEMA].includes(input.schemaVersion)?['styleTokens','styleRecipes']:[]),...([BEHAVIOR_SCHEMA,SCENE_SCHEMA,AUTHORING_SCHEMA].includes(input.schemaVersion)?['behavior']:[]),...(input.schemaVersion===AUTHORING_SCHEMA?['componentLibrary','responsive','webForms']:[])], 'document');
  if (input.format !== FORMAT || ![SCHEMA, WORKBENCH_SCHEMA, MOTION_SCHEMA,BUSINESS_SCHEMA,ADVANCED_SCHEMA,DESIGN_SCHEMA,BEHAVIOR_SCHEMA,SCENE_SCHEMA,AUTHORING_SCHEMA].includes(input.schemaVersion)) fail('지원하지 않는 문서 형식 또는 schemaVersion입니다.');
  const business=[BUSINESS_SCHEMA,ADVANCED_SCHEMA,DESIGN_SCHEMA,BEHAVIOR_SCHEMA,SCENE_SCHEMA,AUTHORING_SCHEMA].includes(input.schemaVersion);
  const styleTokens=input.styleTokens===undefined?[]:normalizeStyleTokens(input.styleTokens);
  const advanced = input.schemaVersion === MOTION_SCHEMA || business;
  const extended = input.schemaVersion !== SCHEMA;
  if (!extended && input.theme !== undefined) fail('theme: 확장 schemaVersion이 필요합니다.');
  const usedIds = new Set();
  function unique(value, label) {
    const result = id(value, label);
    if (usedIds.has(result)) fail(`중복 ID: ${result}`);
    usedIds.add(result);
    return result;
  }
  const documentId = unique(input.id, 'document.id');
  const canvas = object(input.canvas, 'canvas');
  keys(canvas, ['width', 'height', 'unit'], 'canvas');
  if (canvas.unit !== 'logical-px') fail('지원하지 않는 canvas 단위입니다.');
  if (!Array.isArray(input.assets)) fail('assets 배열이 필요합니다.');
  const assets = input.assets.map((item) => {
    const result = asset(item);
    unique(result.id, 'asset.id');
    return result;
  });
  const assetIds = new Set(assets.map((item) => item.id));
  validateMediaBudget(assets);validateAudioBudget(assets);if(![SCENE_SCHEMA,AUTHORING_SCHEMA].includes(input.schemaVersion)&&assets.some(a=>AUDIO_MIME_TYPES.includes(a.mimeType)))fail('음향 자산은 0.14-scene.1 형식이 필요합니다.');
  if (!Array.isArray(input.slides) || input.slides.length === 0) fail('문서는 최소 한 장의 슬라이드가 필요합니다.');
  let behavior;if(input.behavior!==undefined){keys(input.behavior,['variables'],'document.behavior');behavior={variables:normalizeBehaviorVariables(input.behavior.variables)};}
  const slides = input.slides.map((slide) => {
    keys(slide, ['id', 'background', 'elements', ...(extended ? ['name', 'section'] : []), ...(advanced ? ['motions', 'interactions', 'transition', 'advanceAfter'] : []), ...(business?['notes','readingOrder','hideMaster','masterOverride','template','layout']:[]),...([BEHAVIOR_SCHEMA,SCENE_SCHEMA,AUTHORING_SCHEMA].includes(input.schemaVersion)?['behavior']:[]),...([SCENE_SCHEMA,AUTHORING_SCHEMA].includes(input.schemaVersion)?['scene']:[]),...(input.schemaVersion===AUTHORING_SCHEMA?['componentInstances']:[])], 'slide');
    const slideId = unique(slide.id, 'slide.id');
    if (!Array.isArray(slide.elements)) fail('slide.elements 배열이 필요합니다.');
    const normalizedSlide = {
      id: slideId, background: color(slide.background, 'slide.background'),
      elements: slide.elements.map((element) => {
        const optional = ['name', 'locked', 'hidden', 'rotation', 'groupId', 'style', 'themeRefs', ...(advanced ? ['component', 'binding', 'initiallyHidden'] : []), ...(business?['semanticRole']:[]),...([ADVANCED_SCHEMA,DESIGN_SCHEMA,BEHAVIOR_SCHEMA,SCENE_SCHEMA,AUTHORING_SCHEMA].includes(input.schemaVersion)?['states']:[]),...([DESIGN_SCHEMA,BEHAVIOR_SCHEMA,SCENE_SCHEMA,AUTHORING_SCHEMA].includes(input.schemaVersion)?['design','flow']:[]),...(input.schemaVersion===AUTHORING_SCHEMA?['responsive','web','composition']:[])];
        const typeFields = element.type === 'text' ? ['text'] : element.type === 'shape' ? ['shape', 'fill', 'stroke', 'text','adjustments','path'] : element.type==='video'?['assetId','alt','video']:['table','chart','connector','svg'].includes(element.type)?[element.type]:['assetId', 'fit', 'alt', ...(extended ? ['crop', 'focal', 'source'] : [])];
        keys(element, ['id', 'type', 'geometry', ...typeFields, ...(extended ? optional : [])], 'element');
        const result = { id: unique(element.id, 'element.id'), type: choice(element.type, ['text', 'shape', 'image',...(business?['table','chart','connector','svg','video']:[])], 'element.type'), geometry: geometry(element.geometry) };
        if (element.type === 'text') result.text = text(element.text,business);
        if (element.type === 'shape') {
          result.shape = choice(element.shape, [...SHAPE_KINDS,FREEFORM_KIND], 'shape');
          if(element.shape===FREEFORM_KIND){if(element.adjustments!==undefined)fail('자유형에는 표준 도형 조절값을 지정할 수 없습니다.');result.path=normalizeFreeformPath(element.path);}
          else{
            if(element.path!==undefined)fail('표준 도형에는 자유형 경로를 지정할 수 없습니다.');
            if(element.adjustments!==undefined)result.adjustments=normalizeShapeAdjustments(element.shape,element.adjustments,result.geometry.width,result.geometry.height);
          }
          result.fill = color(element.fill, 'fill');
          const stroke = object(element.stroke, 'stroke');
          keys(stroke, ['color', 'width'], 'stroke');
          result.stroke = { color: color(stroke.color, 'stroke.color'), width: finite(stroke.width, 'stroke.width') };
          if (result.stroke.width < 0) fail('stroke.width는 음수일 수 없습니다.');
          if (element.text !== undefined) result.text = text(element.text,business);
        }
        if (element.type === 'image') {
          result.assetId = id(element.assetId, 'assetId');
          if (!assetIds.has(result.assetId)) fail(`이미지 asset 참조가 없습니다: ${result.assetId}`);
          if(!IMAGE_TYPES.has(assets.find(a=>a.id===result.assetId).mimeType))fail('이미지 개체에는 이미지 자산이 필요합니다.');
          result.fit = choice(element.fit, ['contain', 'cover'], 'image.fit');
          result.alt = lf(string(element.alt, 'image.alt'));
          if (element.crop !== undefined) {
            keys(element.crop, ['x', 'y', 'width', 'height'], 'crop');
            const crop = Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, between(element.crop[key], 0, 1, `crop.${key}`)]));
            if (!crop.width || !crop.height || crop.x + crop.width > 1.000001 || crop.y + crop.height > 1.000001) fail('crop: 이미지 범위 안의 양수 영역이어야 합니다.');
            result.crop = crop;
          }
          if (element.focal !== undefined) { keys(element.focal, ['x', 'y'], 'focal'); result.focal = { x: between(element.focal.x, 0, 1, 'focal.x'), y: between(element.focal.y, 0, 1, 'focal.y') }; }
          if (element.source !== undefined) result.source = lf(string(element.source, 'image.source'));
        }
        if(element.type==='video'){result.assetId=id(element.assetId,'video.assetId');const source=assets.find(a=>a.id===result.assetId);if(!source||!VIDEO_MIME_TYPES.includes(source.mimeType))fail('동영상 자산을 찾을 수 없습니다.');validateMediaAsset(source);result.alt=lf(string(element.alt,'video.alt'));result.video=normalizeVideoSettings(element.video,assets);}
        if (element.name !== undefined) result.name = lf(string(element.name, 'element.name'));
        for(const type of ['table','chart','connector','svg'])if(element.type===type)result[type]=normalizeBusinessValue(element[type],businessSchemas[type],type);
        if(element.semanticRole!==undefined)result.semanticRole=normalizeBusinessValue(element.semanticRole,businessSchemas.semanticRole,'semanticRole');
        for (const key of ['locked', 'hidden', 'initiallyHidden']) if (element[key] !== undefined) result[key] = bool(element[key], `element.${key}`);
        if (element.rotation !== undefined) result.rotation = finite(element.rotation, 'rotation');
        if (element.groupId !== undefined) result.groupId = id(element.groupId, 'groupId');
        if (element.style !== undefined) result.style = normalizeVisualStyle(element.style);
        if (element.component !== undefined) result.component = normalizeMotionValue(element.component, motionSchemas.component, 'component');
        if (element.binding !== undefined) result.binding = normalizeMotionValue(element.binding, motionSchemas.binding, 'binding');
        if(element.states!==undefined)result.states=normalizeMotionValue(element.states,motionSchemas.states,'states');
        if(element.design!==undefined)result.design=normalizeElementDesign(element.design,styleTokens);
        if(element.flow!==undefined)result.flow=normalizeFlow(element.flow);
        if(element.responsive!==undefined)result.responsive=normalizeResponsiveElement(element.responsive);
        if(element.web!==undefined)result.web=normalizeWebControl(element.web);
        if(element.composition!==undefined)result.composition=normalizeComposition(element.composition);
        if (element.themeRefs !== undefined) {
          keys(element.themeRefs, ['fill', 'textColor', 'fontFamily'], 'themeRefs'); result.themeRefs = {};
          for (const key of ['fill', 'textColor']) if (element.themeRefs[key] !== undefined) result.themeRefs[key] = choice(element.themeRefs[key], THEME_COLORS, `themeRefs.${key}`);
          if (element.themeRefs.fontFamily !== undefined) result.themeRefs.fontFamily = bool(element.themeRefs.fontFamily, 'themeRefs.fontFamily');
          if ((result.themeRefs.fill || result.themeRefs.textColor || result.themeRefs.fontFamily) && !input.theme) fail('themeRefs: 참조할 문서 테마가 없습니다.');
          if (result.themeRefs.fill && result.type !== 'shape') fail('themeRefs.fill: 도형이 필요합니다.');
          if ((result.themeRefs.textColor || result.themeRefs.fontFamily) && !result.text) fail('themeRefs: 텍스트가 있는 개체가 필요합니다.');
        }
        return result;
      }),
    };
    if (slide.name !== undefined) normalizedSlide.name = lf(string(slide.name, 'slide.name'));
    if (slide.section !== undefined) normalizedSlide.section = lf(string(slide.section, 'slide.section'));
    if(slide.notes!==undefined)normalizedSlide.notes=lf(string(slide.notes,'slide.notes'));
    if(slide.readingOrder!==undefined){if(!Array.isArray(slide.readingOrder))fail('readingOrder 배열이 필요합니다.');normalizedSlide.readingOrder=slide.readingOrder.map(value=>id(value,'readingOrder'));}
    if(slide.hideMaster!==undefined)normalizedSlide.hideMaster=bool(slide.hideMaster,'slide.hideMaster');
    if(slide.masterOverride!==undefined)normalizedSlide.masterOverride=normalizeBusinessValue(slide.masterOverride,businessSchemas.masterOverride,'masterOverride');
    if(slide.template!==undefined)normalizedSlide.template=normalizeBusinessValue(slide.template,businessSchemas.template,'template');
    if (slide.motions !== undefined) normalizedSlide.motions = normalizeMotionValue(slide.motions, motionSchemas.motions, 'motions');
    if (slide.interactions !== undefined) normalizedSlide.interactions = normalizeMotionValue(slide.interactions, motionSchemas.interactions, 'interactions');
    if (slide.transition !== undefined) normalizedSlide.transition = normalizeMotionValue(slide.transition, motionSchemas.transition, 'transition');
    if (slide.advanceAfter !== undefined) normalizedSlide.advanceAfter = normalizeMotionValue(slide.advanceAfter, { type: 'number', minimum: 100, maximum: 600000 }, 'advanceAfter');
    if(slide.behavior!==undefined)normalizedSlide.behavior=normalizeBehaviorSlide(slide.behavior,behavior?.variables||[]);
    if(slide.scene!==undefined)normalizedSlide.scene=normalizeScene(slide.scene,{canvas:input.canvas});
    return normalizedSlide;
  });
  const groupSlides = new Map();
  const groupCounts = new Map();
  for (const slide of slides) for (const element of slide.elements) if (element.groupId) {
    if (usedIds.has(element.groupId)) fail('groupId는 다른 문서 ID와 충돌할 수 없습니다.');
    if (groupSlides.has(element.groupId) && groupSlides.get(element.groupId) !== slide.id) fail('그룹은 한 슬라이드 안에 있어야 합니다.');
    groupSlides.set(element.groupId, slide.id);
    groupCounts.set(element.groupId, (groupCounts.get(element.groupId) ?? 0) + 1);
  }
  if ([...groupCounts.values()].some(count => count < 2)) fail('그룹에는 두 개 이상의 개체가 필요합니다.');
  const result = {
    format: FORMAT, schemaVersion: input.schemaVersion, id: documentId, title: lf(string(input.title, 'title')),
    canvas: { width: finite(canvas.width, 'canvas.width', true), height: finite(canvas.height, 'canvas.height', true), unit: 'logical-px' },
    slides, assets,
  };
  if(behavior!==undefined)result.behavior=behavior;
  if (input.theme !== undefined) result.theme = normalizeTheme(input.theme,business);
  if(input.styleTokens!==undefined)result.styleTokens=styleTokens;
  if(input.styleRecipes!==undefined){result.styleRecipes=normalizeDesignRecipes(input.styleRecipes,styleTokens);for(const recipe of result.styleRecipes)unique(recipe.id,'styleRecipe.id');}
  if(input.master!==undefined)result.master=normalizeBusinessValue(input.master,businessSchemas.master,'master');
  if (input.variables !== undefined) result.variables = normalizeMotionValue(input.variables, motionSchemas.variables, 'variables');
  if(input.motionClips!==undefined)result.motionClips=normalizeMotionValue(input.motionClips,motionSchemas.motionClips,'motionClips');
  if(input.layoutMasters!==undefined)result.layoutMasters=normalizeLayoutMasters(input.layoutMasters,result,normalizeDocument);
  if(input.layouts!==undefined)result.layouts=normalizeLayouts(input.layouts,result,normalizeDocument);
  if(input.responsive!==undefined)result.responsive=normalizeResponsiveDocument(input.responsive);
  if(input.webForms!==undefined)result.webForms=normalizeWebForms(input.webForms);
  if(input.componentLibrary!==undefined)result.componentLibrary=normalizeComponentLibrary(input.componentLibrary,result,normalizeDocument);
  for(let i=0;i<slides.length;i++)if(input.slides[i].componentInstances!==undefined)slides[i].componentInstances=normalizeComponentInstances(input.slides[i].componentInstances,slides[i],result.componentLibrary||[]);
  const instanceIds=new Set();for(const definition of result.componentLibrary||[]){if(groupCounts.has(definition.id))fail('컴포넌트 원본 ID가 그룹과 겹칩니다.');unique(definition.id,'component.id');}for(const page of slides)for(const instance of page.componentInstances||[]){if(instanceIds.has(instance.id)||usedIds.has(instance.id)||groupCounts.has(instance.id))fail('컴포넌트 인스턴스 ID가 중복됩니다.');instanceIds.add(instance.id);usedIds.add(instance.id);}
  validateResponsiveReferences(result);
  for(let i=0;i<slides.length;i++)if(input.slides[i].layout!==undefined){
    const link=normalizeLayoutLink(input.slides[i].layout,result.layouts||[],result.layoutMasters||[]),targets=new Set(slides[i].elements.map(e=>e.id));
    link.elementMap=Object.fromEntries(Object.entries(link.elementMap).filter(([,target])=>targets.has(target)));
    slides[i].layout=link;
  }
  if([DESIGN_SCHEMA,BEHAVIOR_SCHEMA,SCENE_SCHEMA,AUTHORING_SCHEMA].includes(input.schemaVersion)){for(let i=0;i<slides.length;i++)slides[i]=resolveFlowSlide(slides[i]);validateDesignReferences(result);}
  const referenceIds=new Set([...usedIds,...groupCounts.keys()]);
  validateWebReferences(result,referenceIds);
  if (advanced) validateMotionReferences(result, referenceIds);
  validateAdvancedReferences(result,referenceIds);
  if(business)validateBusinessReferences(result);
  if(![SCENE_SCHEMA,AUTHORING_SCHEMA].includes(input.schemaVersion)&&hasSpatialBehavior(result))fail('공간 동작은 0.14-scene.1 형식이 필요합니다.');
  if([SCENE_SCHEMA,AUTHORING_SCHEMA].includes(input.schemaVersion))validateSceneReferences(result,referenceIds);
  if([BEHAVIOR_SCHEMA,SCENE_SCHEMA,AUTHORING_SCHEMA].includes(input.schemaVersion))validateBehaviorReferences(result,referenceIds);
  if(input.schemaVersion!==AUTHORING_SCHEMA&&hasAuthoringContent(result))fail('새 제작 기능은 0.15-authoring.1 형식이 필요합니다.');
  return result;
}

function newId(prefix) {
  const token = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${(++sequence).toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${token}`;
}
function defaultText(shape = false) {
  return { paragraphs: [''], textStyle: { fontFamily: 'Malgun Gothic', fontSize: 32, lineHeight: 1.2, color: '#182037', align: shape ? 'center' : 'left', verticalAlign: shape ? 'middle' : 'top' } };
}
function signature(document) { return JSON.stringify(document); }
function equal(first, second) { return signature(first) === signature(second); }
function sameDesignLibrary(source,target){const order=rows=>[...(rows||[])].sort((a,b)=>a.id.localeCompare(b.id));return !!source&&equal(order(source.styleTokens),order(target.styleTokens))&&equal(order(source.styleRecipes),order(target.styleRecipes));}
function sameLayoutFamily(source,target,slide){if(source.id!==target.id||!slide.layout||!sameDesignLibrary(source,target))return false;const a=source.layouts?.find(l=>l.id===slide.layout.layoutId),b=target.layouts?.find(l=>l.id===slide.layout.layoutId);if(!a||!b||!equal(a,b))return false;return !a.masterId||equal(source.layoutMasters?.find(m=>m.id===a.masterId),target.layoutMasters?.find(m=>m.id===a.masterId));}

export function elementBounds(elements) {
  if (!elements.length) return null;
  const points = elements.flatMap(element => {
    const g = element.geometry, angle = (element.rotation ?? 0) * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
    const cx = g.x + g.width / 2, cy = g.y + g.height / 2;
    return [[-g.width / 2, -g.height / 2], [g.width / 2, -g.height / 2], [g.width / 2, g.height / 2], [-g.width / 2, g.height / 2]].map(([x, y]) => ({ x: cx + x * c - y * s, y: cy + x * s + y * c }));
  });
  const x = Math.min(...points.map(p => p.x)), y = Math.min(...points.map(p => p.y));
  return { x, y, width: Math.max(...points.map(p => p.x)) - x, height: Math.max(...points.map(p => p.y)) - y };
}

export function createBlankDocument() {
  return { format: FORMAT, schemaVersion: SCHEMA, id: newId('deck'), title: '새 프레젠테이션', canvas: { width: 1280, height: 720, unit: 'logical-px' }, slides: [{ id: newId('slide'), background: '#ffffff', elements: [] }], assets: [] };
}

export class EditorStore {
  constructor(document = createBlankDocument(), { evaluateCommand } = {}) {
    this._evaluateCommand = evaluateCommand;
    Object.defineProperty(this,'_dirtyState',{value:createDirtyTracker(),enumerable:false});
    this.loadDocument(document);
  }
  get activeSlide() { return this.document.slides.find((slide) => slide.id === this.activeSlideId); }
  get selectedId() { return this._selectedId ?? null; }
  set selectedId(value) { this._selectedId = value; this._selectedIds = value ? [value] : []; }
  get selectedIds() { return [...(this._selectedIds ?? [])]; }
  get selectedElements() { const ids = new Set(this.selectedIds); return this.activeSlide.elements.filter(e => ids.has(e.id)); }
  get selectionBounds() { return elementBounds(this.selectedElements); }
  get selectedElement() { return this.activeSlide?.elements.find((element) => element.id === this.selectedId) ?? null; }
  get isDirty() { return this._dirtyState.isDirty(this.document,this.textSession,{revision:this.revision,richSchemas:[ADVANCED_SCHEMA,DESIGN_SCHEMA,BEHAVIOR_SCHEMA,SCENE_SCHEMA,AUTHORING_SCHEMA],richSchemaVersion:BUSINESS_SCHEMA}); }
  get canUndo() { return this._undo.length > 0 || (!!this.textSession && !equal(this.textSession.beforeText, this.textSession.draft)); }
  get canRedo() { return this._redo.length > 0 && !this.textSession && !this.transformSession; }
  get undoCount() { return this._undo.length; }
  get redoCount() { return this._redo.length; }
  get topUndoEntryId() { return this._undo.at(-1)?.entryId ?? null; }
  get topRedoEntryId() { return this._redo.at(-1)?.entryId ?? null; }
  historyMetadata() {
    const metadata = ({ before, after, beforeActiveSlideId, afterActiveSlideId, beforeSelectedId, afterSelectedId, beforeSelectedIds, afterSelectedIds, ...entry }) => cloneDocument(entry);
    return { undo: this._undo.map(metadata), redo: this._redo.map(metadata) };
  }

  loadDocument(input) {
    if (this.textSession?.composing) fail('한글 조합이 끝난 뒤 문서를 열 수 있습니다.');
    const document = normalizeDocument(input);
    this.document = document;
    this.activeSlideId = document.slides[0].id;
    this.selectedId = null;
    this.textSession = null;
    this.transformSession = null;
    this.revision = 0;
    this.sessionId = newId('session');
    this._undo = [];
    this._redo = [];
    this._savedSignature = this._dirtyState.reset(document,this.revision).signature;
    return this.document;
  }
  _element(id, document = this.document) {
    for (const slide of document.slides) {
      const element = slide.elements.find((item) => item.id === id);
      if (element) return { slide, element };
    }
    fail(`개체를 찾을 수 없습니다: ${id}`);
  }
  _freshId(prefix) {
    const ids = new Set([...compositeIds({componentLibrary:this.document.componentLibrary,instances:this.document.slides.map(s=>s.componentInstances)}),...sceneIds(this.document),...behaviorIds(this.document),this.document.id, ...(this.document.styleRecipes||[]).map(r=>r.id),...(this.document.layouts||[]).map(l=>l.id),...(this.document.layoutMasters||[]).map(l=>l.id), ...(this.document.motionClips||[]).map(c=>c.id),...(this.document.variables || []).map(v => v.id), ...this.document.assets.map((item) => item.id), ...this.document.slides.flatMap((slide) => [slide.id, ...(slide.motions || []).map(m => m.id), ...(slide.interactions || []).map(i => i.id), ...slide.elements.flatMap((element) => [element.id, element.groupId,...(element.states||[]).map(s=>s.id)].filter(Boolean))])]);
    let candidate;
    do { candidate = newId(prefix); } while (ids.has(candidate));
    return candidate;
  }
  _reconcile() {
    if (!this.document.slides.some((slide) => slide.id === this.activeSlideId)) this.activeSlideId = this.document.slides[0].id;
    this._selectedIds = (this._selectedIds ?? []).filter(id => this.activeSlide.elements.some(element => element.id === id));
    if (!this._selectedIds.includes(this._selectedId)) this._selectedId = this._selectedIds[0] ?? null;
  }
  _selectAfterCommit(id) {
    this.selectedId = id;
    this._reconcile();
    const entry = this._undo.at(-1);
    if (entry) entry.afterSelectedId = this.selectedId;
    if (entry) entry.afterSelectedIds = this.selectedIds;
  }
  _ready() {
    if (this.transformSession) fail('현재 개체 조작을 완료하거나 취소해 주세요.');
    this.finishText();
  }
  _commit(label, mutate, nextSlideId, context = {}) {
    const candidate = cloneDocument(this.document);
    mutate(candidate);
    return this._commitDocument(label, candidate, nextSlideId, context);
  }
  _commitDocument(label, candidate, nextSlideId, context = {}) {
    const before = cloneDocument(this.document);
    const beforeActiveSlideId = this.activeSlideId;
    const beforeSelectedId = this.selectedId;
    const beforeSelectedIds = this.selectedIds;
    const after = normalizeDocument(candidate);
    if (equal(before, after)) return false;
    // Prepare the complete entry before the only live-state swap. No allocation for dryRun/no-op/failure.
    const commands = cloneDocument(context.commands ?? []);
    const entry = { entryId: newId('history'), source: context.source ?? 'human', actorId: context.actorId ?? 'local-human',
      commands, targetIds: [...new Set([...changedTargetIds(before, after),
        ...commands.flatMap(command => [command.params.elementId, command.params.slideId].filter(id=>typeof id==='string'))])],
      previousRevision: this.revision, contentRevision: this.revision + 1,
      operationId: context.operationId ?? null, label, before, after: cloneDocument(after), beforeActiveSlideId, beforeSelectedId, beforeSelectedIds };
    this.document = after;
    if (nextSlideId) this.activeSlideId = nextSlideId;
    this._reconcile();
    entry.afterActiveSlideId = this.activeSlideId;
    entry.afterSelectedId = this.selectedId;
    entry.afterSelectedIds = this.selectedIds;
    this._undo.push(entry);
    if (this._undo.length > 100) this._undo.shift();
    this._redo = [];
    this.revision += 1;
    return true;
  }
  transact(label, mutateFn) {
    this._ready();
    if (typeof mutateFn !== 'function') fail('mutateFn 함수가 필요합니다.');
    return this._commit(label, mutateFn);
  }
  _commitCommand(label, command, nextSlideId, context = {}) {
    if (!this._evaluateCommand) fail('공용 명령 평가기가 연결되지 않았습니다.');
    return this._commit(label, document => {
      const result = this._evaluateCommand(document, command);
      if (!result.ok) throw Object.assign(new Error(result.error.message), { commandError: result.error });
      Object.assign(document, result.value.document);
    }, nextSlideId, { ...context, commands: [command] });
  }
  applyCommand(command, label, nextSlideId, context) {
    this._ready();
    return this._commitCommand(label, command, nextSlideId, context);
  }
  commitCandidate(candidate, label, context, nextSlideId) {
    // Only the controller may call this after guarded candidate evaluation. Never finish human drafts.
    if (this.textSession || this.transformSession) fail('진행 중인 편집이 있습니다.');
    return this._commitDocument(label, candidate, nextSlideId, context);
  }
  selectElement(id) {
    if (id !== null && !this.activeSlide.elements.some((element) => element.id === id)) fail(`현재 슬라이드의 개체가 아닙니다: ${id}`);
    if (id !== this.selectedId || this.selectedIds.length > 1) { this._ready(); this.selectedId = id; }
    return this.selectedElement;
  }
  selectElements(ids, { expandGroups = true, includeLocked = false, includeHidden = false } = {}) {
    if (!Array.isArray(ids)) fail('선택할 개체 ID 배열이 필요합니다.');
    if (ids.some(id => !this.activeSlide.elements.some(e => e.id === id))) fail('현재 슬라이드의 개체만 선택할 수 있습니다.');
    const selected = new Set(ids);
    if (expandGroups) {
      const groups = new Set(this.activeSlide.elements.filter(e => selected.has(e.id) && e.groupId).map(e => e.groupId));
      for (const element of this.activeSlide.elements) if (groups.has(element.groupId)) selected.add(element.id);
    }
    const unavailableGroups = expandGroups ? new Set(this.activeSlide.elements.filter(e => e.groupId && ((!includeLocked && e.locked) || (!includeHidden && e.hidden))).map(e => e.groupId)) : new Set();
    const next = this.activeSlide.elements.filter(e => selected.has(e.id) && !unavailableGroups.has(e.groupId) && (includeLocked || !e.locked) && (includeHidden || !e.hidden)).map(e => e.id);
    if (!equal(next, this.selectedIds)) { this._ready(); this._selectedIds = next; this._selectedId = next[0] ?? null; }
    return this.selectedIds;
  }
  toggleSelection(id) {
    const element = this.activeSlide.elements.find(e => e.id === id); if (!element) fail('현재 슬라이드의 개체가 아닙니다.');
    const toggled = new Set(element.groupId ? this.activeSlide.elements.filter(e => e.groupId === element.groupId).map(e => e.id) : [id]);
    return this.selectElements(this.selectedIds.some(item => toggled.has(item)) ? this.selectedIds.filter(item => !toggled.has(item)) : [...this.selectedIds, ...toggled]);
  }
  switchSlide(id) {
    if (!this.document.slides.some((slide) => slide.id === id)) fail(`슬라이드를 찾을 수 없습니다: ${id}`);
    if (id === this.activeSlideId) return;
    this._ready();
    this.activeSlideId = id;
    this.selectedId = null;
  }
  undo() {
    this._ready();
    const entry = this._undo.pop();
    if (!entry) return false;
    this.document = cloneDocument(entry.before);
    this.activeSlideId = entry.beforeActiveSlideId;
    this.selectedId = entry.beforeSelectedId ?? null;
    if (entry.beforeSelectedIds) { this._selectedIds = [...entry.beforeSelectedIds]; this._selectedId = entry.beforeSelectedId; }
    this._reconcile();
    this._redo.push(entry);
    this.revision += 1;
    return true;
  }
  redo() {
    this._ready();
    const entry = this._redo.pop();
    if (!entry) return false;
    this.document = cloneDocument(entry.after);
    this.activeSlideId = entry.afterActiveSlideId;
    this.selectedId = entry.afterSelectedId ?? null;
    if (entry.afterSelectedIds) { this._selectedIds = [...entry.afterSelectedIds]; this._selectedId = entry.afterSelectedId; }
    this._reconcile();
    this._undo.push(entry);
    this.revision += 1;
    return true;
  }
  beginText(id) {
    if (this.textSession?.elementId === id) return this.textSession;
    const { slide, element } = this._element(id);
    if (element.locked || element.hidden) fail('잠기거나 숨겨진 개체는 텍스트를 편집할 수 없습니다.');
    if (!['text','shape'].includes(element.type)) fail('텍스트와 도형만 직접 글자를 편집할 수 있습니다. 표는 셀 편집을 사용해 주세요.');
    this._ready();
    const before = cloneDocument(element.text ?? defaultText(true));
    this.activeSlideId = slide.id;
    this.selectedId = id;
    this.textSession = { elementId: id, beforeText: before, draft: cloneDocument(before), composing: false, draftRevision: 0 };
    return this.textSession;
  }
  updateText(paragraphs) {
    if (!this.textSession) fail('활성 텍스트 편집 세션이 없습니다.');
    const base={...this.textSession.draft,paragraphs};if(JSON.stringify(paragraphs)!==JSON.stringify(this.textSession.draft.paragraphs)){delete base.runs;delete base.paragraphStyles;}
    const draft = text(base);
    if (!equal(draft, this.textSession.draft)) { this.textSession.draft = draft; this.textSession.draftRevision += 1; }
  }
  updateRichText(value){
    if(!this.textSession)fail('활성 텍스트 편집 세션이 없습니다.');
    keys(value,['paragraphs','runs','paragraphStyles'],'richTextDraft');
    const draft=text({...value,textStyle:this.textSession.draft.textStyle});
    if(!equal(draft,this.textSession.draft)){this.textSession.draft=draft;this.textSession.draftRevision+=1;}
  }
  setComposing(value) {
    if (!this.textSession) { if (value) fail('활성 텍스트 편집 세션이 없습니다.'); return; }
    this.textSession.composing = Boolean(value);
  }
  finishText() {
    const session = this.textSession;
    if (!session) return false;
    if (session.composing) fail('한글 조합이 끝난 뒤 텍스트 편집을 종료할 수 있습니다.');
    if (equal(session.beforeText, session.draft)) { this.textSession = null; return false; }
    const draft = text(session.draft);
    const result = this._evaluateCommand
      ? this._commitCommand('텍스트 편집', { id: 'text.replace', params: { elementId: session.elementId, text: draft } })
      : this._commit('텍스트 편집', (document) => { this._element(session.elementId, document).element.text = draft;if((draft.runs!==undefined||draft.paragraphStyles!==undefined)&&![ADVANCED_SCHEMA,DESIGN_SCHEMA,BEHAVIOR_SCHEMA,SCENE_SCHEMA,AUTHORING_SCHEMA].includes(document.schemaVersion))document.schemaVersion=BUSINESS_SCHEMA;if(hasAuthoringContent(document))document.schemaVersion=AUTHORING_SCHEMA; });
    this.textSession = null;
    return result;
  }
  _draftSnapshot() {
    const result = cloneDocument(this.document);
    if (this.textSession && !equal(this.textSession.beforeText, this.textSession.draft)) this._element(this.textSession.elementId, result).element.text = cloneDocument(this.textSession.draft);
    if(this.textSession&&(this.textSession.draft.runs!==undefined||this.textSession.draft.paragraphStyles!==undefined)&&![ADVANCED_SCHEMA,DESIGN_SCHEMA,BEHAVIOR_SCHEMA,SCENE_SCHEMA,AUTHORING_SCHEMA].includes(result.schemaVersion))result.schemaVersion=BUSINESS_SCHEMA;
    if(hasAuthoringContent(result))result.schemaVersion=AUTHORING_SCHEMA;
    return result;
  }
  snapshot() {
    if (this.textSession?.composing) fail('한글 조합 중에는 저장할 수 없습니다.');
    if (this.transformSession) fail('개체 조작 중에는 저장할 수 없습니다.');
    return normalizeDocument(this._draftSnapshot());
  }
  markSaved(snapshot, sessionId = this.sessionId) {
    if (sessionId !== this.sessionId) return false;
    const normalized = normalizeDocument(snapshot);
    if (normalized.id !== this.document.id) return false;
    this._savedSignature = this._dirtyState.markSaved(normalized).signature;
    return true;
  }
  markUnsaved() { this._savedSignature = `unsaved:${newId('recovery')}`;this._dirtyState.markUnsaved(); return true; }
  beginTransform(id, kind) {
    choice(kind, ['move', 'resize'], 'transform.kind');
    const { slide, element } = this._element(id);
    if (element.locked || element.hidden) fail('잠기거나 숨겨진 개체는 조작할 수 없습니다.');
    this._ready();
    this.activeSlideId = slide.id;
    this.selectedId = id;
    const before = cloneDocument(element.geometry);
    this.transformSession = { elementId: id, kind, before, preview: cloneDocument(before) };
    return this.transformSession;
  }
  previewGeometry(value) {
    if (!this.transformSession) fail('활성 개체 조작이 없습니다.');
    this.transformSession.preview = geometry({ ...this.transformSession.preview, ...value });
  }
  commitTransform() {
    const session = this.transformSession;
    if (!session) return false;
    if (session.elementIds) {
      const changed = this._commitCommand(session.kind === 'move' ? '선택 개체 이동' : session.kind === 'rotate' ? '선택 개체 회전' : '선택 개체 크기 변경',
        { id: 'elements.set_geometry', params: { updates: session.previews } });
      this.transformSession = null; return changed;
    }
    const preview = geometry(session.preview);
    const label = session.kind === 'move' ? '개체 이동' : '크기 변경';
    const changed = this._evaluateCommand
      ? this._commitCommand(label, { id: 'element.set_geometry', params: { elementId: session.elementId, geometry: preview } })
      : this._commit(label, (document) => { this._element(session.elementId, document).element.geometry = preview; });
    this.transformSession = null;
    return changed;
  }
  cancelTransform() { const hadSession = Boolean(this.transformSession); this.transformSession = null; return hadSession; }
  beginMultiTransform(ids, kind) {
    choice(kind, ['move', 'resize', 'rotate'], 'transform.kind');
    if (!Array.isArray(ids) || !ids.length || ids.some(id => !this.activeSlide.elements.some(e => e.id === id && !e.locked && !e.hidden))) fail('잠금 해제된 현재 슬라이드 개체를 선택해 주세요.');
    this._ready();
    // Selection expansion belongs to the canvas selection action. A layer-selected
    // individual group member must retain its explicit target set while dragging.
    this.selectElements(ids, { expandGroups: false });
    if (!this.selectedIds.length) fail('조작할 개체가 없습니다.');
    const before = this.selectedElements.map(e => ({ elementId: e.id, geometry: cloneDocument(e.geometry), ...(e.rotation !== undefined ? { rotation: e.rotation } : {}) }));
    this.transformSession = { elementId: this.selectedId, elementIds: this.selectedIds, kind, before: cloneDocument(before), previews: cloneDocument(before), preview: cloneDocument(before[0].geometry) };
    return this.transformSession;
  }
  previewMultiGeometry(updates) {
    const session = this.transformSession;
    if (!session?.elementIds) fail('활성 다중 개체 조작이 없습니다.');
    if (!Array.isArray(updates) || updates.length !== session.elementIds.length || new Set(updates.map(u => u.elementId)).size !== updates.length) fail('선택한 모든 개체의 기하가 필요합니다.');
    session.previews = updates.map(update => {
      if (!session.elementIds.includes(update.elementId)) fail('선택하지 않은 개체의 미리보기입니다.');
      return { elementId: update.elementId, geometry: geometry(update.geometry), ...(update.rotation !== undefined ? { rotation: finite(update.rotation, 'rotation') } : {}) };
    });
    session.preview = cloneDocument(session.previews[0].geometry);
  }

  _addElement(element, label, newAsset) {
    this._ready();
    const slideId = this.activeSlideId;
    this._commit(label, (document) => {
      if (newAsset) document.assets.push(newAsset);
      const slide = document.slides.find((slide) => slide.id === slideId);
      slide.elements.push(element);
      if (slide.readingOrder) slide.readingOrder.push(element.id);
    });
    this._selectAfterCommit(element.id);
    return element.id;
  }
  addText() {
    return this._addElement({ id: this._freshId('element'), type: 'text', geometry: { x: 100, y: 100, width: 480, height: 160 }, text: defaultText() }, '텍스트 상자 추가');
  }
  addShape(shape = 'rectangle') {
    const definition = getShapeDefinition(shape);
    return this._addElement({ id: this._freshId('element'), type: 'shape', geometry: { x: 160, y: 180, width: definition.defaultWidth, height: definition.defaultHeight }, shape, fill: '#16a34a', stroke: { color: '#11632e', width: 2 }, text: defaultText(true) }, definition.label + ' 추가');
  }
  addImage(inputAsset) {
    const incoming = asset(inputAsset);
    const existing = this.document.assets.find((item) => item.sha256 === incoming.sha256 && item.dataBase64 === incoming.dataBase64 && item.mimeType === incoming.mimeType && item.width === incoming.width && item.height === incoming.height);
    let newAsset = null;
    if (!existing) { newAsset = { ...incoming, id: this._freshId('asset') }; }
    const usedAsset = existing ?? newAsset;
    const scale = Math.min(1, this.document.canvas.width * 0.6 / usedAsset.width, this.document.canvas.height * 0.6 / usedAsset.height);
    const width = usedAsset.width * scale;
    const height = usedAsset.height * scale;
    return this._addElement({ id: this._freshId('element'), type: 'image', geometry: { x: (this.document.canvas.width - width) / 2, y: (this.document.canvas.height - height) / 2, width, height }, assetId: usedAsset.id, fit: 'contain', alt: '' }, '이미지 추가', newAsset);
  }
  updateElement(id, changes) {
    object(changes, 'changes');
    return this.transact('개체 속성 변경', (document) => {
      const element = this._element(id, document).element;
      if ('id' in changes || 'type' in changes) fail('개체 ID와 종류는 변경할 수 없습니다.');
      const update = cloneDocument(changes);
      if (update.geometry) update.geometry = { ...element.geometry, ...update.geometry };
      if (update.stroke) update.stroke = { ...element.stroke, ...update.stroke };
      if (update.text) update.text = { ...element.text, ...update.text, textStyle: { ...element.text?.textStyle, ...update.text.textStyle } };
      Object.assign(element, update);
    });
  }
  deleteElement(id) {
    return this.transact('개체 삭제', (document) => {
      const { slide, element } = this._element(id, document);
      slide.elements.splice(slide.elements.indexOf(element), 1);
      cleanMotionReferences(document);
      cleanAdvancedReferences(document);
      cleanSceneReferences(document);cleanBehaviorReferences(document);
    });
  }
  duplicateElement(id) {
    this._ready();
    const { element } = this._element(id);
    if ([MOTION_SCHEMA,BUSINESS_SCHEMA,ADVANCED_SCHEMA,DESIGN_SCHEMA,BEHAVIOR_SCHEMA,SCENE_SCHEMA,AUTHORING_SCHEMA].includes(this.document.schemaVersion)) return this.pasteElements(this.copyElements([id]))[0];
    const copy = cloneDocument(element);
    copy.id = this._freshId('element');
    delete copy.groupId;
    copy.geometry.x += 24;
    copy.geometry.y += 24;
    return this._addElement(copy, '개체 복제');
  }
  addSlide() {
    this._ready();
    const id = this._freshId('slide');
    const index = this.document.slides.findIndex((slide) => slide.id === this.activeSlideId) + 1;
    this._commit('슬라이드 추가', (document) => { document.slides.splice(index, 0, { id, background: '#ffffff', elements: [] }); }, id);
    this._selectAfterCommit(null);
    return id;
  }
  duplicateSlide(id) {
    this._ready();
    if ([MOTION_SCHEMA,BUSINESS_SCHEMA,ADVANCED_SCHEMA,DESIGN_SCHEMA,BEHAVIOR_SCHEMA,SCENE_SCHEMA,AUTHORING_SCHEMA].includes(this.document.schemaVersion)) return this.importSlides(this.document, [id], this.document.slides.findIndex(slide => slide.id === id) + 1)[0];
    const index = this.document.slides.findIndex((slide) => slide.id === id);
    if (index < 0) fail(`슬라이드를 찾을 수 없습니다: ${id}`);
    const copy = cloneDocument(this.document.slides[index]);
    copy.id = this._freshId('slide');
    const groups = new Map();
    copy.elements.forEach((element) => { element.id = this._freshId('element'); if (element.groupId) { if (!groups.has(element.groupId)) groups.set(element.groupId, this._freshId('group')); element.groupId = groups.get(element.groupId); } });
    this._commit('슬라이드 복제', (document) => { document.slides.splice(index + 1, 0, copy); }, copy.id);
    this._selectAfterCommit(null);
    return copy.id;
  }
  deleteSlide(id) {
    this._ready();
    const index = this.document.slides.findIndex((slide) => slide.id === id);
    if (index < 0) fail(`슬라이드를 찾을 수 없습니다: ${id}`);
    if (this.document.slides.length <= 1) return false;
    const nextId = id === this.activeSlideId ? this.document.slides[index === 0 ? 1 : index - 1].id : this.activeSlideId;
    return this._commit('슬라이드 삭제', (document) => { document.slides.splice(index, 1); cleanMotionReferences(document);cleanSceneReferences(document);cleanBehaviorReferences(document); }, nextId);
  }
  moveSlide(id, delta) {
    this._ready();
    if (!Number.isInteger(delta)) fail('슬라이드 이동량은 정수여야 합니다.');
    const index = this.document.slides.findIndex((slide) => slide.id === id);
    if (index < 0) fail(`슬라이드를 찾을 수 없습니다: ${id}`);
    const destination = Math.max(0, Math.min(this.document.slides.length - 1, index + delta));
    return this._commit('슬라이드 순서 변경', (document) => { const [slide] = document.slides.splice(index, 1); document.slides.splice(destination, 0, slide); });
  }

  applyBatch(commands, label = '선택 개체 편집', nextSlideId) {
    if (!this._evaluateCommand || !Array.isArray(commands) || !commands.length) fail('문서 명령 묶음이 필요합니다.');
    // Validate against a detached effective snapshot before finishing any human draft.
    let candidate = this.snapshot();
    for (const command of commands) {
      const evaluated = this._evaluateCommand(candidate, command);
      if (!evaluated.ok) throw Object.assign(new Error(evaluated.error.message), { code: evaluated.error.code });
      candidate = evaluated.value.document;
    }
    if(nextSlideId!==undefined&&(typeof nextSlideId!=='string'||!candidate.slides.some(s=>s.id===nextSlideId)))fail('명령 묶음의 이동 대상 슬라이드가 올바르지 않습니다.');
    this._ready();
    return this._commitDocument(label, candidate, nextSlideId, { commands });
  }
  _applyWithAssets(command, assets, label) {
    // Local asset staging is detached and is not part of the bounded JSON transport payload.
    // The author document receives referenced assets and the evaluated command in one commit.
    const staged = this.snapshot(); staged.assets.push(...assets.map(value => asset(value)));if(staged.assets.some(a=>AUDIO_MIME_TYPES.includes(a.mimeType)))staged.schemaVersion=staged.schemaVersion===AUTHORING_SCHEMA?AUTHORING_SCHEMA:SCENE_SCHEMA;
    const evaluated = this._evaluateCommand(normalizeDocument(staged), command);
    if (!evaluated.ok) throw Object.assign(new Error(evaluated.error.message), { code: evaluated.error.code });
    this._ready(); return this._commitDocument(label, evaluated.value.document, undefined, { commands: [command] });
  }
  setElementsGeometry(updates) { return this.applyBatch([{ id: 'elements.set_geometry', params: { updates } }], '선택 개체 기하 변경'); }
  transformElements(elementIds, transform) { return this.applyBatch([{ id: 'elements.transform', params: { elementIds, transform } }], '선택 개체 변환'); }
  alignElements(elementIds, alignment, relativeTo = 'selection') { return this.applyBatch([{ id: 'elements.align', params: { elementIds, alignment, relativeTo } }], '개체 정렬'); }
  distributeElements(elementIds, axis) { return this.applyBatch([{ id: 'elements.distribute', params: { elementIds, axis } }], '개체 균등 분배'); }
  groupElements(elementIds = this.selectedIds) {
    const groupId = this._freshId('group');
    this.applyBatch([{ id: 'elements.group', params: { elementIds, groupId } }], '개체 그룹'); return groupId;
  }
  ungroupElements(elementIds = this.selectedIds) { return this.applyBatch([{ id: 'elements.ungroup', params: { elementIds } }], '그룹 해제'); }
  deleteElements(elementIds = this.selectedIds) { return this.applyBatch([{ id: 'elements.delete', params: { elementIds } }], '선택 개체 삭제'); }
  copyElements(elementIds = this.selectedIds) {
    const requested = new Set(elementIds);
    let count;
    do {
      count = requested.size;
      const groups = new Set(this.activeSlide.elements.filter(e => requested.has(e.id) && e.groupId).map(e => e.groupId));
      for (const element of this.activeSlide.elements) if (requested.has(element.id) || groups.has(element.groupId)) {
        requested.add(element.id);
        if (element.component?.kind === 'panel') for (const id of element.component.contentIds || []) requested.add(id);
        if(element.flow)for(const id of element.flow.children)requested.add(id);
      }
    } while (requested.size !== count);
    const elements = this.activeSlide.elements.filter(e => requested.has(e.id));
    if (!elements.length) fail('복사할 개체가 없습니다.');
    const assets = new Set(elements.flatMap(e=>['image','video'].includes(e.type)?[e.assetId,...(e.video?.posterAssetId?[e.video.posterAssetId]:[])]:[]));
    const payload = { kind: 'vividly-elements', version: 1, documentId: this.document.id, elements, assets: this.document.assets.filter(a => assets.has(a.id)), ...(this.document.theme ? { theme: this.document.theme } : {}) };
    if ([MOTION_SCHEMA,BUSINESS_SCHEMA,ADVANCED_SCHEMA,DESIGN_SCHEMA,BEHAVIOR_SCHEMA,SCENE_SCHEMA,AUTHORING_SCHEMA].includes(this.document.schemaVersion)) {
      const included = new Set(elements.map(e => e.id));
      const motions = (this.activeSlide.motions || []).filter(m => included.has(m.targetId));
      const interactions = (this.activeSlide.interactions || []).filter(i => included.has(i.sourceId));
      const variables = this._referencedVariables(elements, interactions, this.document.variables || []);
      Object.assign(payload, { version: 2, sourceSlideId: this.activeSlideId, variables, motions, interactions });
    }
    if(elements.some(e=>e.design||e.flow)){payload.version=3;payload.designSource={styleTokens:this.document.styleTokens||[],styleRecipes:this.document.styleRecipes||[]};}
    const selectedBehavior=selectBehaviorForElements(this.activeSlide.behavior,new Set(elements.map(e=>e.id)));if(selectedBehavior){const needed=referencedBehaviorVariables(selectedBehavior);payload.version=4;payload.behaviorSource={variables:(this.document.behavior?.variables||[]).filter(v=>needed.has(v.id)),slide:selectedBehavior};if(elements.some(e=>e.design||e.flow))payload.designSource={styleTokens:this.document.styleTokens||[],styleRecipes:this.document.styleRecipes||[]};}
    const included=new Set(elements.map(e=>e.id)),selectedScene=selectSceneForElements(this.activeSlide.scene,included,selectedBehavior),signals=this._closedBehaviorSignals(this.activeSlide.behavior,selectedBehavior,included);
    if(selectedScene||signals.length||selectedBehavior&&hasSpatialBehavior({slides:[{behavior:selectedBehavior}]})){payload.version=5;payload.sceneSource={...(selectedScene?{scene:selectedScene}:{}),signals};const neededAssets=new Set(selectedScene?.audio.map(a=>a.assetId)||[]);payload.assets=this.document.assets.filter(a=>assets.has(a.id)||neededAssets.has(a.id));}
    const includedComponents=(this.activeSlide.componentInstances||[]).filter(instance=>Object.values(instance.elementMap).every(id=>included.has(id)));if(includedComponents.length)payload.componentSource={instances:includedComponents,definitions:(this.document.componentLibrary||[]).filter(definition=>includedComponents.some(instance=>instance.componentId===definition.id))};
    return cloneDocument(payload);
  }
  _closedBehaviorSignals(source,selected,included){if(included.size===1)return[];const selectedIds=new Set((selected?.rules||[]).map(r=>r.id)),names=new Set((selected?.rules||[]).filter(r=>r.event==='custom').map(r=>r.trigger.eventName));return[...names].filter(name=>(source?.rules||[]).filter(r=>r.event==='custom'&&r.trigger.eventName===name).every(r=>selectedIds.has(r.id)&&(!r.sourceId||included.has(r.sourceId))));}
  _referencedVariables(elements, interactions, variables) {
    const needed = new Set(elements.flatMap(e => [e.component?.variableId, e.binding?.variableId,e.chart?.variants?.variableId].filter(Boolean)));
    for (const interaction of interactions) for (const action of interaction.actions) if (action.variableId) needed.add(action.variableId);
    for(const interaction of interactions)if(interaction.condition)needed.add(interaction.condition.variableId);
    return variables.filter(variable => needed.has(variable.id));
  }
  _prepareCopiedElements(elements, assets, sourceDocumentId, sourceTheme, offsetX = 0, offsetY = 0, sourceDesign) {
    const mappedAssets = new Map(), newAssets = [], groups = new Map(), elementMap = new Map(), stateMap=new Map();
    const known = new Set([...compositeIds({componentLibrary:this.document.componentLibrary,instances:this.document.slides.map(s=>s.componentInstances)}),...sceneIds(this.document),...behaviorIds(this.document),this.document.id,...(this.document.styleRecipes||[]).map(r=>r.id),...(this.document.layouts||[]).map(l=>l.id),...(this.document.layoutMasters||[]).map(l=>l.id),...(this.document.motionClips||[]).map(c=>c.id), ...(this.document.variables || []).map(v => v.id), ...this.document.slides.map(s => s.id), ...this.document.slides.flatMap(s => [...s.elements.flatMap(e => [e.id, e.groupId,...(e.states||[]).map(s=>s.id)].filter(Boolean)), ...(s.motions || []).map(m => m.id), ...(s.interactions || []).map(i => i.id)]), ...this.document.assets.map(a => a.id)]);
    const fresh = prefix => { let id; do { id = this._freshId(prefix); } while (known.has(id)); known.add(id); return id; };
    for (const value of assets) {
      const incoming = asset(value), existing = [...this.document.assets, ...newAssets].find(a => a.sha256 === incoming.sha256 && a.dataBase64 === incoming.dataBase64 && a.mimeType === incoming.mimeType);
      const used = existing ?? { ...incoming, id: fresh('asset') }; mappedAssets.set(incoming.id, used.id); if (!existing) newAssets.push(used);
    }
    const copies = elements.map(input => {
      if (elementMap.has(input.id)) fail('복사한 개체 ID가 중복됩니다.');
      const e = cloneDocument(input);
      if(e.design&&(sourceDocumentId!==this.document.id||!sameDesignLibrary(sourceDesign,this.document))){if(!sourceDesign)fail('스타일이 연결된 개체의 원본 디자인 정보가 필요합니다.');detachDesignElement(e,sourceDesign);}
      e.id = fresh('element'); e.geometry = geometry(e.geometry); e.geometry.x += offsetX; e.geometry.y += offsetY;if(e.composition){e.composition.bounds.x+=offsetX;e.composition.bounds.y+=offsetY;}
      elementMap.set(input.id, e.id);
      if(e.states)e.states=e.states.map(state=>{if(stateMap.has(state.id))fail('복사한 상태 ID가 중복됩니다.');const id=fresh('state');stateMap.set(state.id,id);return {...state,id};});
      if (['image','video'].includes(e.type)) { if (!mappedAssets.has(e.assetId)) fail('복사한 자산이 없습니다.'); e.assetId = mappedAssets.get(e.assetId);if(e.video?.posterAssetId){if(!mappedAssets.has(e.video.posterAssetId))fail('복사한 포스터 자산이 없습니다.');e.video.posterAssetId=mappedAssets.get(e.video.posterAssetId);} }
      if (e.groupId) { if (!groups.has(e.groupId)) groups.set(e.groupId, fresh('group')); e.groupId = groups.get(e.groupId); }
      if ((sourceDocumentId !== this.document.id || !equal(sourceTheme, this.document.theme)) && e.themeRefs) {
        if (sourceTheme) {
          if (e.type === 'shape' && e.themeRefs.fill) e.fill = sourceTheme.colors[e.themeRefs.fill];
          if (e.text && e.themeRefs.textColor) e.text.textStyle.color = sourceTheme.colors[e.themeRefs.textColor];
          if (e.text && e.themeRefs.fontFamily) e.text.textStyle.fontFamily = e.semanticRole==='heading'?(sourceTheme.headingFontFamily||sourceTheme.fontFamily):sourceTheme.fontFamily;
        }
        delete e.themeRefs;
      }
      return e;
    });
    for(const e of copies)if(e.composition){e.composition.children=e.composition.children.map(id=>{const mapped=elementMap.get(id);if(!mapped)fail('자유 배치 프레임의 내용 개체를 함께 복사해 주세요.');return mapped;});}
    for(const e of copies)if(e.flow){e.flow.children=e.flow.children.map(id=>{const mapped=elementMap.get(id);if(!mapped)fail('자동 배치의 내용 개체를 함께 복사해 주세요.');return mapped;});}
    for(const e of copies)if(e.connector){for(const key of ['from','to']){
      if(e.connector[key].point){e.connector[key].point.x+=offsetX;e.connector[key].point.y+=offsetY;continue;}
      const source=e.connector[key].elementId,mapped=elementMap.get(source)||(sourceDocumentId===this.document.id&&this.activeSlide.elements.some(target=>target.id===source)?source:null);
      if(!mapped)fail('연결선을 다른 장/자료에 붙일 때 연결된 개체를 함께 복사해 주세요.');e.connector[key].elementId=mapped;
    }if(e.connector.control){e.connector.control.x+=offsetX;e.connector.control.y+=offsetY;}if(e.connector.waypoints)e.connector.waypoints=e.connector.waypoints.map(p=>({x:p.x+offsetX,y:p.y+offsetY}));}
    return { elements: copies, assets: newAssets, assetMap:mappedAssets, elementMap, stateMap, fresh };
  }
  _prepareInteractiveCopy(prepared, source, context) {
    const variables = normalizeMotionValue(source.variables || [], motionSchemas.variables, 'clipboard.variables');
    const motions = normalizeMotionValue(source.motions || [], motionSchemas.motions, 'clipboard.motions');
    const interactions = normalizeMotionValue(source.interactions || [], motionSchemas.interactions, 'clipboard.interactions');
    const variableIds = new Set();
    for (const variable of variables) {
      if (variableIds.has(variable.id)) fail('복사한 변수 ID가 중복됩니다.'); variableIds.add(variable.id);
      if (context.variableMap.has(variable.id)) continue;
      const existing = source.documentId === this.document.id && this.document.variables?.find(item => item.id === variable.id && equal(item, variable));
      const id = existing ? existing.id : prepared.fresh('variable'); context.variableMap.set(variable.id, id);
      if (!existing) context.variables.push({ ...variable, id });
    }
    const mapVariable = id => context.variableMap.get(id) || (source.documentId === this.document.id && this.document.variables?.some(v => v.id === id) ? id : null);
    for (const element of prepared.elements) {
      if (element.component?.variableId) { const id = mapVariable(element.component.variableId); if (!id) fail('복사한 컴포넌트 변수가 없습니다.'); element.component.variableId = id; }
      if (element.binding) { const id = mapVariable(element.binding.variableId); if (!id) fail('복사한 데이터 연결 변수가 없습니다.'); element.binding.variableId = id; }
      if(element.chart?.variants){const id=mapVariable(element.chart.variants.variableId);if(!id)fail('복사한 차트 선택 변수가 없습니다.');element.chart.variants.variableId=id;}
      if (element.component?.contentIds) element.component.contentIds = element.component.contentIds.map(id => { if (!prepared.elementMap.has(id)) fail('패널 내용 개체를 함께 복사해 주세요.'); return prepared.elementMap.get(id); });
    }
    const motionMap = new Map();
    for (const motion of motions) { if (motionMap.has(motion.id)) fail('복사한 효과 ID가 중복됩니다.'); if (!prepared.elementMap.has(motion.targetId)) fail('복사한 효과 대상이 없습니다.'); motionMap.set(motion.id, prepared.fresh('motion')); }
    const copiedMotions = motions.map(m => ({ ...m, id: motionMap.get(m.id), targetId: prepared.elementMap.get(m.targetId) }));
    const interactionIds = new Set(),interactionMap=new Map();
    const copiedInteractions = interactions.flatMap(interaction => {
      if (interactionIds.has(interaction.id)) fail('복사한 동작 ID가 중복됩니다.'); interactionIds.add(interaction.id);
      if (!prepared.elementMap.has(interaction.sourceId)) fail('복사한 동작 원본 개체가 없습니다.');
      let condition=interaction.condition;
      if(condition){const id=mapVariable(condition.variableId);if(!id)return [];condition={...condition,variableId:id};}
      const actions = interaction.actions.flatMap(action => {
        if (action.type === 'goToSlide') return context.slideMap.has(action.targetId) ? [{ ...action, targetId: context.slideMap.get(action.targetId) }] : [];
        if (action.type === 'playMotion') {
          const id = motionMap.get(action.motionId) || (source.documentId === this.document.id && context.targetSlide?.motions?.some(m => m.id === action.motionId) ? action.motionId : null);
          return id ? [{ ...action, motionId: id }] : [];
        }
        if (['setVariable','addVariable'].includes(action.type)) { const id = mapVariable(action.variableId); return id ? [{ ...action, variableId: id }] : []; }
        if(action.type==='openLink')return [{...action}];
        const id = prepared.elementMap.get(action.targetId) || (source.documentId === this.document.id && context.targetSlide?.elements.some(e => e.id === action.targetId) ? action.targetId : null);
        if(!id)return [];
        if(action.type==='setState')return [{...action,targetId:id,stateId:prepared.stateMap.get(action.stateId)||action.stateId}];
        return [{ ...action, targetId: id }];
      });
      if(!actions.length)return[];const id=prepared.fresh('interaction');interactionMap.set(interaction.id,id);return [{ ...interaction,...(condition?{condition}:{}), id, sourceId: prepared.elementMap.get(interaction.sourceId), actions }];
    });
    prepared.motionMap=motionMap;prepared.interactionMap=interactionMap;
    return { motions: copiedMotions, interactions: copiedInteractions };
  }
  _prepareSceneCopy(prepared,source,context){
    prepared.clipMap=new Map();prepared.audioMap=new Map();prepared.bodyMap=new Map(source.documentId===this.document.id?(context.targetSlide?.scene?.bodies||[]).map(b=>[b.targetId,b.targetId]):[]);prepared.signalMap=new Map((source.signals||[]).map(name=>[name,prepared.fresh('behavior-signal')]));if(!source.scene)return null;
    const result=remapScene(normalizeScene(source.scene),{elementMap:prepared.elementMap,assetMap:prepared.assetMap,clipMap:prepared.clipMap,audioMap:prepared.audioMap,fresh:prepared.fresh,allowExistingElement:id=>source.documentId===this.document.id&&context.targetSlide?.elements.some(e=>e.id===id)});for(const b of source.scene.bodies||[]){const mapped=prepared.elementMap.get(b.targetId);if(mapped&&result.bodies.some(b=>b.targetId===mapped))prepared.bodyMap.set(b.targetId,mapped);}if(result.world){result.world.width=Math.max(result.world.width,this.document.canvas.width);result.world.height=Math.max(result.world.height,this.document.canvas.height);}return result;
  }
  _prepareBehaviorCopy(prepared,source,context){
    const variables=normalizeBehaviorVariables(source.variables||[]),behavior=normalizeBehaviorSlide(source.slide||{},variables);context.behaviorVariables||=[];context.behaviorVariableMap||=new Map();
    for(const v of variables){if(context.behaviorVariableMap.has(v.id))continue;const existing=source.documentId===this.document.id&&this.document.behavior?.variables.find(item=>item.id===v.id&&equal(item,v)),id=existing?existing.id:prepared.fresh('behavior-variable');context.behaviorVariableMap.set(v.id,id);if(!existing)context.behaviorVariables.push({...v,id});}
    return remapBehaviorSlide(behavior,{elementMap:prepared.elementMap,variableMap:context.behaviorVariableMap,motionMap:prepared.motionMap||new Map(),slideMap:context.slideMap,stateMap:prepared.stateMap,fresh:prepared.fresh,sourceSlideId:source.sourceSlideId,targetSlideId:context.targetSlide?.id||context.slideMap.get(source.sourceSlideId),allowExistingElement:id=>source.documentId===this.document.id&&context.targetSlide?.elements.some(e=>e.id===id),allowExistingMotion:id=>source.documentId===this.document.id&&context.targetSlide?.motions?.some(m=>m.id===id),bodyMap:prepared.bodyMap,clipMap:prepared.clipMap||new Map(),audioMap:prepared.audioMap||new Map(),signalMap:prepared.signalMap||new Map(),allowExistingClip:id=>source.documentId===this.document.id&&context.targetSlide?.scene?.sprites.some(s=>s.clips.some(c=>c.id===id)),allowExistingAudio:id=>source.documentId===this.document.id&&context.targetSlide?.scene?.audio.some(a=>a.id===id)});
  }
  _preparePastedElements(payload, { offsetX = 24, offsetY = 24 } = {}) {
    keys(payload, ['kind', 'version', 'documentId', 'elements', 'assets', 'theme', 'componentSource', ...([2,3,4,5].includes(payload.version) ? ['sourceSlideId', 'variables', 'motions', 'interactions'] : []),...([3,4,5].includes(payload.version)?['designSource']:[]),...([4,5].includes(payload.version)?['behaviorSource']:[]),...(payload.version===5?['sceneSource']:[])], 'clipboard');
    if (payload.kind !== 'vividly-elements' || ![1, 2, 3, 4,5].includes(payload.version) || !Array.isArray(payload.elements) || !Array.isArray(payload.assets)) fail('지원하지 않는 개체 클립보드입니다.');
    if (payload.version === 1 && payload.elements.some(element => element.component || element.binding || element.states || element.initiallyHidden !== undefined)) fail('모션 개체에는 버전 2 클립보드가 필요합니다.');
    const sourceIds = new Set();
    for (const item of [...payload.elements,...payload.elements.flatMap(e=>e.states||[]), ...payload.assets, ...(payload.variables || []), ...(payload.motions || []), ...(payload.interactions || [])]) {
      const sourceId = id(item.id, 'clipboard.id'); if (sourceIds.has(sourceId)) fail('복사한 원본 ID가 중복됩니다.'); sourceIds.add(sourceId);
    }
    for (const element of payload.elements) if (element.groupId && sourceIds.has(element.groupId)) fail('복사한 그룹 ID가 다른 ID와 충돌합니다.');
    finite(offsetX, 'offsetX'); finite(offsetY, 'offsetY');
    let designSource;if(payload.designSource!==undefined){keys(payload.designSource,['styleTokens','styleRecipes'],'clipboard.designSource');const styleTokens=normalizeStyleTokens(payload.designSource.styleTokens);designSource={styleTokens,styleRecipes:normalizeDesignRecipes(payload.designSource.styleRecipes,styleTokens)};}
    let behaviorSource;if([4,5].includes(payload.version)&&payload.behaviorSource!==undefined){keys(payload.behaviorSource,['variables','slide'],'clipboard.behaviorSource');const variables=normalizeBehaviorVariables(payload.behaviorSource.variables),slide=normalizeBehaviorSlide(payload.behaviorSource.slide,variables);behaviorSource={variables,slide,documentId:payload.documentId,sourceSlideId:payload.sourceSlideId};for(const sourceId of behaviorIds({behavior:{variables},slides:[{behavior:slide}]})){if(sourceIds.has(sourceId))fail('복사한 동작 ID가 중복됩니다.');sourceIds.add(sourceId);}}
    let sceneSource;if(payload.version===5){keys(payload.sceneSource,['scene','signals'],'clipboard.sceneSource');const signals=payload.sceneSource.signals??[];if(!Array.isArray(signals)||signals.length>256||signals.some(s=>typeof s!=='string'||!s.trim()||s.length>128)||new Set(signals).size!==signals.length)fail('복사한 신호 목록이 잘못되었습니다.');sceneSource={documentId:payload.documentId,signals,...(payload.sceneSource.scene?{scene:normalizeScene(payload.sceneSource.scene)}:{})};for(const sourceId of sceneIds({slides:[{scene:sceneSource.scene}]})){if(sourceIds.has(sourceId))fail('복사한 장면 ID가 중복됩니다.');sourceIds.add(sourceId);}}
    if(payload.version===4&&!behaviorSource)fail('버전4 클립보드에는 동작 원본이 필요합니다.');
    const prepared = this._prepareCopiedElements(payload.elements, payload.assets, payload.documentId, payload.theme, offsetX, offsetY,designSource);
    const context = { variables: [], variableMap: new Map(), targetSlide: this.activeSlide, slideMap: new Map(payload.documentId === this.document.id ? this.document.slides.map(s => [s.id, s.id]) : []) };
    if (payload.sourceSlideId) context.slideMap.set(payload.sourceSlideId, this.activeSlideId);
    const interactive = [2,3,4,5].includes(payload.version) ? this._prepareInteractiveCopy(prepared, payload, context) : {};
    const scene=sceneSource?this._prepareSceneCopy(prepared,sceneSource,context):null;
    const behavior=behaviorSource?this._prepareBehaviorCopy(prepared,behaviorSource,context):null;
    let componentInstances=[];if(payload.componentSource!==undefined){keys(payload.componentSource,['instances','definitions'],'clipboard.componentSource');if(!Array.isArray(payload.componentSource.instances)||!Array.isArray(payload.componentSource.definitions))fail('클립보드 컴포넌트 원본을 확인하세요.');if(payload.documentId===this.document.id)componentInstances=copyComponentInstances(payload.componentSource.instances,{document:this.document,definitions:payload.componentSource.definitions,prepared,sourceBehavior:behaviorSource?.slide,copiedBehavior:behavior,offsetX,offsetY});}
    return {params:{...(componentInstances.length?{componentInstances}:{}), slideId: this.activeSlideId, elements: prepared.elements, assets: [], ...([2,3,4,5].includes(payload.version) ? { ...interactive, variables: context.variables } : {}),...(behavior?{behavior,behaviorVariables:context.behaviorVariables}: {}),...(scene?{scene}:{}) },assets:prepared.assets,elementIds:prepared.elements.map(e=>e.id),elementMap:prepared.elementMap};
  }
  pasteElements(payload, options = {}) {
    const prepared=this._preparePastedElements(payload,options);
    this._applyWithAssets({id:'elements.insert',params:prepared.params},prepared.assets,'개체 붙여넣기');
    this._selectedIds = prepared.elementIds; this._selectedId = this._selectedIds[0] ?? null; this._selectAfterMultiCommit();
    return this.selectedIds;
  }
  _selectAfterMultiCommit() {
    const entry = this._undo.at(-1); if (entry) { entry.afterSelectedId = this.selectedId; entry.afterSelectedIds = this.selectedIds; entry.afterActiveSlideId = this.activeSlideId; }
  }
  copyFormat(elementId = this.selectedId) {
    let e = this._element(elementId).element;if(e.design){e=cloneDocument(e);detachDesignElement(e,this.document);if(e.design){delete e.design.disabled;if(!Object.keys(e.design).length)delete e.design;}}
    return cloneDocument({ ...(e.design?{design:e.design}:{}),...(e.style ? { style: e.style } : {}), ...(e.type === 'shape' ? { fill: e.fill, stroke: e.stroke } : {}), ...(e.text ? { textStyle: e.text.textStyle } : {}), ...(e.themeRefs ? { themeRefs: e.themeRefs } : {}) });
  }
  pasteFormat(elementIds, format) { return this.applyBatch([{ id: 'elements.apply_format', params: { elementIds, format } }], '서식 붙여넣기'); }
  replaceImage(elementId, inputAsset) {
    const incoming = asset(inputAsset), { element } = this._element(elementId);
    if (element.type !== 'image' || element.locked) fail('잠금 해제한 이미지가 필요합니다.');
    const existing = this.document.assets.find(a => a.sha256 === incoming.sha256 && a.dataBase64 === incoming.dataBase64 && a.mimeType === incoming.mimeType);
    const replacement = existing ?? { ...incoming, id: this._freshId('asset') };
    return this._applyWithAssets({ id: 'image.replace', params: { elementId, assetId: replacement.id } }, existing ? [] : [replacement], '이미지 교체');
  }
  duplicateSlides(slideIds) { return this.importSlides(this.document, slideIds, this.document.slides.findIndex(s => s.id === this.activeSlideId) + 1); }
  _prepareImportedSlides(input, slideIds, index = this.document.slides.length) {
    const source = normalizeDocument(input), wanted = new Set(slideIds);
    if (!wanted.size || wanted.size !== slideIds.length || slideIds.some(id => !source.slides.some(s => s.id === id))) fail('가져올 슬라이드 선택이 올바르지 않습니다.');
    if(source.id!==this.document.id||!equal(source,this.document)){const prepared=prepareLibraryImport(this.document,input,{slideIds});prepared.params.slideIndex=index;return{...prepared,commandId:'library.import',slideIds:source.slides.filter(slide=>prepared.mapping.slides?.[slide.id]).map(slide=>prepared.mapping.slides[slide.id]),slideMap:new Map(Object.entries(prepared.mapping.slides||{}))};}
    const chosen = source.slides.filter(s => wanted.has(s.id)), imported = [], newAssets = [];
    const context = { variables: [], variableMap: new Map(), slideMap: new Map(source.id === this.document.id ? this.document.slides.map(s => [s.id, s.id]) : []) };
    for (const slide of chosen) context.slideMap.set(slide.id, this._freshId('slide'));
    for (const slide of chosen) {
      const keepLayout=sameLayoutFamily(source,this.document,slide),detachedSourceSlide=cloneDocument(slide);if(detachedSourceSlide.layout&&!keepLayout)detachLayoutFromSlide(source,detachedSourceSlide);
      const sourceAssets = source.assets.filter(a => slide.elements.some(e => ['image','video'].includes(e.type) && (e.assetId === a.id||e.video?.posterAssetId===a.id))||(slide.scene?.audio||[]).some(sound=>sound.assetId===a.id));
      const prepared = this._prepareCopiedElements(detachedSourceSlide.elements, sourceAssets, source.id, source.theme,0,0,{styleTokens:source.styleTokens||[],styleRecipes:source.styleRecipes||[]});
      const assetRemap = new Map();
      for (const a of prepared.assets) {
        const shared = newAssets.find(existing => existing.sha256 === a.sha256 && existing.dataBase64 === a.dataBase64 && existing.mimeType === a.mimeType);
        if (shared) assetRemap.set(a.id, shared.id); else newAssets.push(a);
      }
      for (const e of prepared.elements) {if (['image','video'].includes(e.type)&&assetRemap.has(e.assetId))e.assetId=assetRemap.get(e.assetId);if(e.video?.posterAssetId&&assetRemap.has(e.video.posterAssetId))e.video.posterAssetId=assetRemap.get(e.video.posterAssetId);}
      for(const [sourceId,targetId]of prepared.assetMap)if(assetRemap.has(targetId))prepared.assetMap.set(sourceId,assetRemap.get(targetId));
      const id = context.slideMap.get(slide.id);
      const interactive = [MOTION_SCHEMA,BUSINESS_SCHEMA,ADVANCED_SCHEMA,DESIGN_SCHEMA,BEHAVIOR_SCHEMA,SCENE_SCHEMA,AUTHORING_SCHEMA].includes(source.schemaVersion) ? this._prepareInteractiveCopy(prepared, { documentId: source.id, motions: slide.motions, interactions: slide.interactions, variables: this._referencedVariables(slide.elements, slide.interactions || [], source.variables || []) }, context) : {};
      const copiedScene=slide.scene?this._prepareSceneCopy(prepared,{documentId:source.id,scene:slide.scene,signals:this._closedBehaviorSignals(slide.behavior,slide.behavior,new Set(slide.elements.map(e=>e.id)))},context):null;
      const copiedBehavior=slide.behavior?this._prepareBehaviorCopy(prepared,{variables:source.behavior?.variables||[],slide:slide.behavior,documentId:source.id,sourceSlideId:slide.id},context):null;
      const businessFields={};
      if(slide.readingOrder)businessFields.readingOrder=slide.readingOrder.map(id=>prepared.elementMap.get(id));
      if(slide.layout&&keepLayout)businessFields.layout={...slide.layout,elementMap:Object.fromEntries(Object.entries(slide.layout.elementMap).filter(([,target])=>prepared.elementMap.has(target)).map(([key,target])=>[key,prepared.elementMap.get(target)]))};
      if(slide.template)businessFields.template={...slide.template,slots:slide.template.slots.map(slot=>({...slot,elementId:prepared.elementMap.get(slot.elementId)}))};
      if(source.id!==this.document.id&&source.master)businessFields.masterOverride={...source.master,...slide.masterOverride};
      const sourceSlide={...detachedSourceSlide};if(!keepLayout)delete sourceSlide.layout;delete sourceSlide.componentInstances;if(source.id===this.document.id&&slide.componentInstances?.length){const copies=copyComponentInstances(slide.componentInstances,{document:this.document,definitions:source.componentLibrary,prepared,sourceBehavior:slide.behavior,copiedBehavior});if(copies.length)businessFields.componentInstances=copies;}
      imported.push({ ...sourceSlide,...(copiedScene?{scene:copiedScene}:{}),...(copiedBehavior?{behavior:copiedBehavior}:{}), id, elements: prepared.elements, ...businessFields,...(slide.motions !== undefined ? { motions: interactive.motions } : {}), ...(slide.interactions !== undefined ? { interactions: interactive.interactions } : {}) });
    }
    return {params:{slides: imported, assets: [], index, ...(context.variables.length ? { variables: context.variables } : {}),...(context.behaviorVariables?.length?{behaviorVariables:context.behaviorVariables}:{})},assets:newAssets,slideIds:imported.map(s=>s.id),slideMap:context.slideMap};
  }
  importSlides(input, slideIds, index = this.document.slides.length) {
    const prepared=this._prepareImportedSlides(input,slideIds,index);
    this._applyWithAssets({id:prepared.commandId||'slides.insert',params:prepared.params},prepared.assets,'슬라이드 가져오기/복제');
    this.activeSlideId = prepared.slideIds[0]; this.selectedId = null; this._selectAfterMultiCommit(); return prepared.slideIds;
  }
}

/** Reuse the human copy/remap preparation without constructing a session, selection or Undo stack. */
export function preparePublicDuplicate(input, options, freshId) {
  keys(options,['kind','sourceId','targetSlideId','afterSlideId','offsetX','offsetY'],'duplicate');
  if(typeof freshId!=='function')fail('복제에는 내부 ID 할당기가 필요합니다.');
  const document=normalizeDocument(input),adapter=Object.create(EditorStore.prototype),allocated=new Set();
  adapter.document=document;
  adapter._freshId=prefix=>{const next=freshId(prefix);id(next,'duplicate.id');if(allocated.has(next))fail('복제 ID가 중복됩니다.');allocated.add(next);return next;};
  if(options.kind==='slide') {
    const source=document.slides.find(slide=>slide.id===options.sourceId);
    if(!source)fail('복제할 슬라이드를 찾을 수 없습니다.');
    if(source.elements.some(element=>element.locked&&!isInheritedLayoutElement(document,source,element.id)))fail('잠긴 개체가 있는 슬라이드는 먼저 잠금을 해제하세요.');
    const after=options.afterSlideId??source.id,index=document.slides.findIndex(slide=>slide.id===after);
    if(index<0)fail('복제한 슬라이드를 넣을 위치를 찾을 수 없습니다.');
    adapter.activeSlideId=source.id;
    const prepared=adapter._prepareImportedSlides(document,[source.id],index+1);
    return {command:{id:'slides.insert',params:prepared.params},assets:prepared.assets,createdId:prepared.slideIds[0],createdIds:Object.fromEntries(prepared.slideMap)};
  }
  if(options.kind!=='element')fail('슬라이드 또는 개체 복제만 지원합니다.');
  const sourceSlide=document.slides.find(slide=>slide.elements.some(element=>element.id===options.sourceId));
  if(!sourceSlide)fail('복제할 개체를 찾을 수 없습니다.');
  adapter.activeSlideId=sourceSlide.id;
  const payload=adapter.copyElements([options.sourceId]);
  if(payload.elements.some(element=>element.locked))fail('잠긴 개체를 먼저 잠금 해제하세요.');
  const target=document.slides.find(slide=>slide.id===(options.targetSlideId??sourceSlide.id));
  if(!target)fail('복제한 개체를 넣을 슬라이드를 찾을 수 없습니다.');
  adapter.activeSlideId=target.id;
  const prepared=adapter._preparePastedElements(payload,{offsetX:options.offsetX??24,offsetY:options.offsetY??24});
  return {command:{id:'elements.insert',params:prepared.params},assets:prepared.assets,createdId:prepared.elementMap.get(options.sourceId),createdIds:Object.fromEntries(prepared.elementMap)};
}
