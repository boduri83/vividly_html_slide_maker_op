/** Transport-neutral document commands. No DOM, EditorStore, file or host access. */
import { cloneDocument, normalizeDocument, WORKBENCH_SCHEMA, MOTION_SCHEMA, BUSINESS_SCHEMA, ADVANCED_SCHEMA, elementBounds, preparePublicDuplicate } from './model.js';
import {CREATION_COMMANDS,withCreationReferences,resolveCreationReferences,createCreationContext,hasClientReferences} from './creation-context.js';
import { motionSchemas, cleanMotionReferences } from './motion-model.js';
import { hasAdvancedMotion,cleanAdvancedReferences } from './advanced-motion-model.js';
import { businessSchemas, applyTextRange, isBusinessElement, cleanBusinessReferences } from './business-model.js';
import { SHAPE_KINDS, SHAPE_ADJUSTMENT_NAMES, normalizeShapeAdjustments } from './shapes.js';
import { FREEFORM_KIND, drawingSchemas, normalizeFreeformPath } from './drawing-model.js';
import { captureLayout, updateLayout, applyLayoutToSlide, cleanLayoutLinks,ensureLayoutLibrary,createSlideFromLayout,resetLayoutSlides,insertLayout,duplicateLayout,createLayoutMaster,updateLayoutMaster,replaceLayoutLibrary,fillLayoutSlot,isInheritedLayoutElement,detachLayoutFromSlide } from './master-model.js';
import { VIDEO_MIME_TYPES,videoSchemas,pruneUnreferencedVideoAssets } from './media-model.js';
import { DESIGN_SCHEMA,designSchemas,normalizeDesignAppearance,mergeDesignAppearance,patchDesignAppearance,detachDesignElement,flowParent,flowMinimumSize,cleanDesignReferences,hasDesign } from './design-model.js';

import {BEHAVIOR_SCHEMA,behaviorSchemas,hasBehavior,hasSpatialBehavior,cleanBehaviorReferences}from './behavior-model.js';
import{SCENE_SCHEMA,sceneSchemas,normalizeScene,hasScene,cleanSceneReferences,scaleScene}from'./scene-model.js';
import{audioAssetSchema,pruneUnreferencedAudioAssets}from'./audio-model.js';
import {AUTHORING_SCHEMA,captureComponent,insertComponent,updateComponent,detachComponent,removeComponent,componentFlowUnits,cleanComponentReferences,reconcileComponentTransforms,hasAuthoring} from './component-library-model.js';
import {compositionSchema,containerChildren,reconcileDirectCompositions,cleanCompositionReferences} from './composition-model.js';
import {webSchemas,validateWebFormVariables,cleanWebReferences,hasWebAuthoring} from './web-authoring-model.js';
import {responsiveSchemas} from './responsive-model.js';
import{appendLibraryImport}from'./reuse-library.js';
export const COMMAND_CONTRACT_VERSION = 'vividly.commands/0.23';
export const COMMAND_LIMITS = Object.freeze({ bytes: 262144, depth: 32, nodes: 10000 });
export const BATCH_LIMITS = Object.freeze({ commands: 100, ...COMMAND_LIMITS });

class ContractError extends Error {
  constructor(code, message, path = '$') { super(message); this.code = code; this.path = path; }
}
const reject = (code, message, path) => { throw new ContractError(code, message, path); };
const object = (properties, required = Object.keys(properties), extra = {}) => ({ type: 'object', properties, required, additionalProperties: false, ...extra });
const string = (extra = {}) => ({ type: 'string', maxLength: 65536, ...extra });
const identifier = string({ minLength: 1, maxLength: 256, pattern: '\\S' });
const number = { type: 'number' };
const positive = { type: 'number', exclusiveMinimum: 0 };
const color = string({ pattern: '^#(?:[\\da-fA-F]{3}|[\\da-fA-F]{4}|[\\da-fA-F]{6}|[\\da-fA-F]{8})$' });
const enumeration = (...values) => ({ type: 'string', enum: values });
const geometry = object({ x: number, y: number, width: positive, height: positive }, [], { minProperties: 1 });
const stroke = object({ color, width: { type: 'number', minimum: 0 } }, [], { minProperties: 1 });
const style = object({
  fontFamily: string({ minLength: 1, maxLength: 256 }),
  fontSize: positive, lineHeight: positive, color,
  align: enumeration('left', 'center', 'right'), verticalAlign: enumeration('top', 'middle', 'bottom'), bold: { type: 'boolean' },italic:{type:'boolean'},underline:{type:'boolean'},strike:{type:'boolean'},
}, [], { minProperties: 1 });
const paragraphs = { type: 'array', items: string(), maxItems: 4096 };
const fullText = object({ paragraphs, textStyle: object(style.properties, Object.keys(style.properties).filter(key => !['bold','italic','underline','strike'].includes(key))),runs:businessSchemas.runs,paragraphStyles:businessSchemas.paragraphStyles },['paragraphs','textStyle']);
const elementInput = fields => object({ elementId: identifier, ...fields });
const slideInput = fields => object({ slideId: identifier, ...fields });
const ids = { type: 'array', items: identifier, minItems: 1, maxItems: 1000 };
const flags = object({ name: string(), locked: { type: 'boolean' }, hidden: { type: 'boolean' }, initiallyHidden: { type: 'boolean' } }, [], { minProperties: 1 });
const crop = object({ x: { type: 'number', minimum: 0, maximum: 1 }, y: { type: 'number', minimum: 0, maximum: 1 }, width: { type: 'number', exclusiveMinimum: 0, maximum: 1 }, height: { type: 'number', exclusiveMinimum: 0, maximum: 1 } });
const focal = object({ x: { type: 'number', minimum: 0, maximum: 1 }, y: { type: 'number', minimum: 0, maximum: 1 } });
const themeRefs = object({ fill: enumeration('primary', 'secondary', 'background', 'text'), textColor: enumeration('primary', 'secondary', 'background', 'text'), fontFamily: { type: 'boolean' } }, []);
const visualStyle = object({ backdropBlur:{type:'number',minimum:0,maximum:100},blur:{type:'number',minimum:0,maximum:100},blendMode:enumeration('normal','multiply','screen','overlay','darken','lighten','color-dodge'),opacity: { type: 'number', minimum: 0, maximum: 1 }, radius: { type: 'number', minimum: 0, maximum: 100000 },
  gradient: { anyOf: [{ type: 'null' }, object({ type: enumeration('linear', 'radial'), angle: number, stops: { type: 'array', minItems: 2, maxItems: 16, items: object({ offset: { type: 'number', minimum: 0, maximum: 1 }, color }) } })] },
  shadow: { anyOf: [{ type: 'null' }, object({ x: number, y: number, blur: { type: 'number', minimum: 0, maximum: 100000 }, spread: number, color })] },
}, [], { minProperties: 1 });
const theme = object({ colors: object({ primary: color, secondary: color, background: color, text: color }), fontFamily: style.properties.fontFamily,headingFontFamily:style.properties.fontFamily,spacing:businessSchemas.spacing },['colors','fontFamily']);
const updates = { type: 'array', minItems: 1, maxItems: 1000, items: object({ elementId: identifier, geometry, rotation: number }, ['elementId', 'geometry']) };
const fullGeometry = object(geometry.properties);
const shapeAdjustments=object(Object.fromEntries(SHAPE_ADJUSTMENT_NAMES.map(name=>[name,{type:'number',minimum:-1000000000,maximum:1000000000}])),[]);
const storedVisualStyle = { ...visualStyle, minProperties: 0 };
const elementBase = { id: identifier, geometry: fullGeometry, name: string(), locked: { type: 'boolean' }, hidden: { type: 'boolean' }, initiallyHidden: { type: 'boolean' }, rotation: number, groupId: identifier, style: storedVisualStyle, themeRefs, component: motionSchemas.component, binding: motionSchemas.binding,states:motionSchemas.states,semanticRole:businessSchemas.semanticRole,design:designSchemas.design,flow:designSchemas.flow,responsive:responsiveSchemas.element,web:webSchemas.control,composition:compositionSchema };
const elementData = { anyOf: [
  object({ ...elementBase, type: enumeration('text'), text: fullText }, ['id', 'type', 'geometry', 'text']),
  object({ ...elementBase, type: enumeration('shape'), shape: enumeration(...SHAPE_KINDS,FREEFORM_KIND), fill: color, stroke: object(stroke.properties), text: fullText,adjustments:shapeAdjustments,path:drawingSchemas.path }, ['id', 'type', 'geometry', 'shape', 'fill', 'stroke']),
  object({ ...elementBase, type: enumeration('image'), assetId: identifier, fit: enumeration('contain', 'cover'), alt: string(), crop, focal, source: string() }, ['id', 'type', 'geometry', 'assetId', 'fit', 'alt']),
  object({...elementBase,type:enumeration('video'),assetId:identifier,alt:string(),video:videoSchemas.settings},['id','type','geometry','assetId','alt','video']),
  ...['table','chart','connector','svg'].map(type=>object({...elementBase,type:enumeration(type),[type]:businessSchemas[type]},['id','type','geometry',type])),
] };
const visualAssetData = object({ id: identifier, mimeType: enumeration('image/png', 'image/jpeg', 'image/webp', 'image/gif',...VIDEO_MIME_TYPES), width: positive, height: positive, bytes: { type: 'integer', minimum: 1 }, sha256: string({ pattern: '^[a-fA-F0-9]{64}$' }), dataBase64: string() });
const assetData={anyOf:[visualAssetData,audioAssetSchema]};
const elementArray = { type: 'array', minItems: 1, maxItems: 1000, items: elementData };
const assetArray = { type: 'array', maxItems: 1000, items: assetData };
const layoutSlot=object({elementId:identifier,key:identifier,role:enumeration('title','subtitle','body','text','image','chart','table','video'),prompt:string({maxLength:256})});
const layoutSlots={type:'array',items:layoutSlot,maxItems:1000};
const layoutCanvas=object({width:positive,height:positive});
const layoutFields={name:string({minLength:1,maxLength:160}),canvas:layoutCanvas,background:color,elements:{...elementArray,minItems:0},placeholderIds:{...ids,minItems:0},masterId:identifier,slots:layoutSlots,inheritBackground:{type:'boolean'}};
const layoutDefinition=object({id:identifier,version:{type:'integer',minimum:1},...layoutFields},['id','name','canvas','background','elements','placeholderIds']);
const masterFields={name:layoutFields.name,canvas:layoutCanvas,background:color,elements:{...elementArray,minItems:0}};
const masterDefinition=object({id:identifier,version:{type:'integer',minimum:1},...masterFields},['id','name','canvas','background','elements']);
const layoutLink=object({layoutId:identifier,version:{type:'integer',minimum:1},elementMap:{type:'object',properties:{},required:[],additionalProperties:identifier,maxProperties:1000}});
const slideBusinessFields={layout:layoutLink,notes:string(),readingOrder:{...ids,minItems:0},hideMaster:{type:'boolean'},masterOverride:businessSchemas.masterOverride,template:businessSchemas.template};
const slideBehavior=object({rules:behaviorSchemas.rules,machines:behaviorSchemas.machines,bindings:behaviorSchemas.bindings,inputs:behaviorSchemas.inputs},[]);
const componentDefinition=object({id:identifier,name:string({minLength:1,maxLength:160}),version:{type:'integer',minimum:1},width:positive,height:positive,elements:{...elementArray,maxItems:200},motions:motionSchemas.motions,interactions:motionSchemas.interactions,behavior:slideBehavior},['id','name','version','width','height','elements']);
const componentInstance=object({id:identifier,componentId:identifier,wrapperId:identifier,version:{type:'integer',minimum:1},frame:fullGeometry,elementMap:layoutLink.properties.elementMap,motionMap:layoutLink.properties.elementMap,interactionMap:layoutLink.properties.elementMap,behaviorMap:layoutLink.properties.elementMap,idMap:{...layoutLink.properties.elementMap,maxProperties:10000}},['id','componentId','version','frame','elementMap']);
const slideData = object({componentInstances:{type:'array',items:componentInstance,maxItems:256},scene:sceneSchemas.scene,behavior:slideBehavior, id: identifier, background: color, elements: { ...elementArray, minItems: 0 }, name: string(), section: string(), motions: motionSchemas.motions, interactions: motionSchemas.interactions, transition: motionSchemas.transition, advanceAfter: { type: 'number', minimum: 100, maximum: 600000 },...slideBusinessFields }, ['id', 'background', 'elements']);

function upgrade(doc) { if (![MOTION_SCHEMA,BUSINESS_SCHEMA,ADVANCED_SCHEMA,DESIGN_SCHEMA,BEHAVIOR_SCHEMA,SCENE_SCHEMA,AUTHORING_SCHEMA].includes(doc.schemaVersion)) doc.schemaVersion = WORKBENCH_SCHEMA; }
function upgradeMotion(doc) { if([DESIGN_SCHEMA,BEHAVIOR_SCHEMA,SCENE_SCHEMA,AUTHORING_SCHEMA].includes(doc.schemaVersion))return;if(doc.schemaVersion===ADVANCED_SCHEMA||hasAdvancedMotion(doc))doc.schemaVersion=ADVANCED_SCHEMA;else if(doc.schemaVersion!==BUSINESS_SCHEMA)doc.schemaVersion = MOTION_SCHEMA; }
function upgradeBusiness(doc){if([DESIGN_SCHEMA,BEHAVIOR_SCHEMA,SCENE_SCHEMA,AUTHORING_SCHEMA].includes(doc.schemaVersion))return;doc.schemaVersion=doc.schemaVersion===ADVANCED_SCHEMA||hasAdvancedMotion({...doc,slides:[...doc.slides,...(doc.layouts||[]),...(doc.layoutMasters||[])]})?ADVANCED_SCHEMA:BUSINESS_SCHEMA;}
function cleanReferences(doc){cleanCompositionReferences(doc);cleanWebReferences(doc);cleanDesignReferences(doc);cleanLayoutLinks(doc);cleanBusinessReferences(doc);for(const slide of doc.slides)cleanGroupRefs(slide);cleanMotionReferences(doc);cleanAdvancedReferences(doc);for(const layout of [...(doc.layouts||[]),...(doc.layoutMasters||[]),...(doc.componentLibrary||[])]){const view={...doc,slides:doc.componentLibrary?.includes(layout)?[...doc.slides,layout]:[layout]};cleanWebReferences(view);if(doc.componentLibrary?.includes(layout))cleanBehaviorReferences(view);cleanBusinessReferences(view);cleanMotionReferences(view);cleanAdvancedReferences(view);cleanGroupRefs(layout);if(layout.placeholderIds)layout.placeholderIds=layout.placeholderIds.filter(id=>layout.elements.some(e=>e.id===id));}cleanSceneReferences(doc);cleanBehaviorReferences(doc);cleanComponentReferences(doc);}
function layoutOperation(doc,run){upgradeBusiness(doc);try{run();}catch(error){reject('INVALID_COMMAND',error.message,'$.params');}upgradeBusiness(doc);cleanReferences(doc);}
function protectChangedTargets(doc, before, after, field) {
  const indexed = new Map((before || []).map(item => [item.id, item]));
  for (const item of after || []) if (JSON.stringify(indexed.get(item.id)) !== JSON.stringify(item)) {
    ensureEditable(findElement(doc, item[field]).element);
    if (indexed.has(item.id)) ensureEditable(findElement(doc, indexed.get(item.id)[field]).element);
  }
  const remaining = new Set((after || []).map(item => item.id));
  for (const item of before || []) if (!remaining.has(item.id)) ensureEditable(findElement(doc, item[field]).element);
}
function selected(doc, elementIds, allowLocked = false) {
  if (!elementIds.length || new Set(elementIds).size !== elementIds.length) reject('INVALID_COMMAND', '중복 없는 개체 선택이 필요합니다.', '$.params.elementIds');
  const found = elementIds.map(id => findElement(doc, id));
  if (found.some(item => item.slide.id !== found[0].slide.id)) reject('INVALID_COMMAND', '한 슬라이드의 개체만 함께 편집할 수 있습니다.', '$.params.elementIds');
  if (!allowLocked && found.some(item => item.element.locked)) reject('TARGET_LOCKED', '잠긴 개체를 먼저 잠금 해제해 주세요.', '$.params.elementIds');
  return found.map(item => item.element);
}
function ensureEditable(element) { if (element.locked) reject('TARGET_LOCKED', '잠긴 개체를 먼저 잠금 해제해 주세요.', '$.params.elementId'); return element; }
function ensureFlowMembersEditable(document,element,seen=new Set()){if(seen.has(element.id))return;seen.add(element.id);for(const id of containerChildren(element)){const child=ensureEditable(findElement(document,id).element);ensureFlowMembersEditable(document,child,seen);}}
function flowChildren(document,element){return element.flow.children.map(id=>findElement(document,id).element);}
function growFlowParents(document,element,geometry=element.geometry){const parent=flowParent(findElement(document,element.id).slide,element.id);if(!parent)return;const children=flowChildren(document,parent).map(child=>child.id===element.id?{...child,geometry:{...child.geometry,...geometry}}:child),minimum=flowMinimumSize(parent.flow,children);parent.geometry.width=Math.max(parent.geometry.width,minimum.width);parent.geometry.height=Math.max(parent.geometry.height,minimum.height);growFlowParents(document,parent);}
function ensureFlowGeometry(document,element,geometry){const parent=flowParent(findElement(document,element.id).slide,element.id);if(parent&&(['x','y'].some(key=>geometry[key]!==undefined&&geometry[key]!==element.geometry[key])))reject('INVALID_COMMAND','자동 배치 안의 개체는 배치 순서/간격을 조절하거나 자동 배치에서 해제해 주세요.','$.params.geometry');ensureFlowMembersEditable(document,parent||element);if(element.flow){const minimum=flowMinimumSize(element.flow,flowChildren(document,element)),next={...element.geometry,...geometry};if(next.width<minimum.width-.00001||next.height<minimum.height-.00001)reject('INVALID_COMMAND','자동 배치의 내용·간격·안쪽 여백을 담을 수 있는 크기가 필요합니다. 배치 설정을 먼저 줄이세요.','$.params.geometry');}if(parent)growFlowParents(document,element,geometry);}
function designOverride(element,appearance){if(element.design)element.design.overrides=patchDesignAppearance(element.design.overrides,appearance);}
function upgradeDesign(document){if(![BEHAVIOR_SCHEMA,SCENE_SCHEMA,AUTHORING_SCHEMA].includes(document.schemaVersion))document.schemaVersion=DESIGN_SCHEMA;}
function designOperation(document,fn){upgradeDesign(document);try{return fn();}catch(error){if(error instanceof ContractError)throw error;reject('INVALID_COMMAND',error.message,'$.params');}}
function localOverride(element, keys) {
  for (const key of keys) if (element.themeRefs) delete element.themeRefs[key];
  if (element.themeRefs && !Object.keys(element.themeRefs).length) delete element.themeRefs;
}
function cleanGroupRefs(slide) {
  const counts = new Map(); for (const e of slide.elements) if (e.groupId) counts.set(e.groupId, (counts.get(e.groupId) ?? 0) + 1);
  for (const e of slide.elements) if (e.groupId && counts.get(e.groupId) < 2) delete e.groupId;
}

function findElement(document, id) {
  for (const slide of document.slides) {
    const element = slide.elements.find(item => item.id === id);
    if (element) return { element, slide };
  }
  reject('TARGET_NOT_FOUND', '개체를 찾을 수 없습니다.', '$.params.elementId');
}
function findSlide(document, id) {
  const slide = document.slides.find(item => item.id === id);
  if (!slide) reject('TARGET_NOT_FOUND', '슬라이드를 찾을 수 없습니다.', '$.params.slideId');
  return slide;
}
function typedElement(document, id, type) {
  const { element } = findElement(document, id);
  if (element.type !== type) reject('TARGET_TYPE_MISMATCH', `${type} 개체가 필요합니다.`, '$.params.elementId');
  return element;
}
function textElement(document, id) {
  const { element } = findElement(document, id);
  if (!element.text) reject('TARGET_TYPE_MISMATCH', '기존 텍스트가 있는 개체가 필요합니다.', '$.params.elementId');
  return element;
}

function insertCreatedElement(doc,p,element){registry.get('elements.insert').apply(doc,{slideId:p.slideId,elements:[element],assets:[]});return element.id;}
function defaultCreatedText(doc,p){return{paragraphs:p.paragraphs,textStyle:{fontFamily:doc.theme?.fontFamily||'Malgun Gothic',fontSize:32,lineHeight:1.2,color:doc.theme?.colors.text||'#182037',align:'left',verticalAlign:'top',...(p.textStyle||{})}};}
function duplicateCreated(doc,p,context,kind){
  try{const prepared=preparePublicDuplicate(doc,{kind,sourceId:kind==='slide'?p.slideId:p.elementId,...(p.slideId&&kind==='element'?{targetSlideId:p.slideId}:{}),...(p.afterSlideId?{afterSlideId:p.afterSlideId}:{}),...(p.offsetX!==undefined?{offsetX:p.offsetX}:{}),...(p.offsetY!==undefined?{offsetY:p.offsetY}:{})},context.fresh);
    for(const asset of prepared.assets)if(!doc.assets.some(old=>old.id===asset.id))doc.assets.push(asset);
    if(p.name!==undefined){if(kind==='slide')prepared.command.params.slides[0].name=p.name;else prepared.command.params.elements.find(element=>element.id===prepared.createdId).name=p.name;}
    registry.get(prepared.command.id).apply(doc,prepared.command.params);return prepared.createdId;
  }catch(error){if(error instanceof ContractError)throw error;reject('INVALID_COMMAND',error.message,'$.params');}
}
function componentOperation(document,fn){document.schemaVersion=AUTHORING_SCHEMA;try{return fn();}catch(error){if(error instanceof ContractError)throw error;reject('INVALID_COMMAND',error.message,'$.params');}}
const definitions = [
  ['document.set_title', object({ title: string() }), (doc, p) => { doc.title = p.title; }],
  ['element.set_geometry', elementInput({ geometry }), (doc, p) => { const e=ensureEditable(findElement(doc,p.elementId).element);if(e.type==='connector')reject('TARGET_TYPE_MISMATCH','연결선은 endpoint를 변경해 배치해 주세요.','$.params.elementId');ensureFlowGeometry(doc,e,p.geometry);Object.assign(e.geometry, p.geometry); }, 'pilot'],
  ['shape.set_fill', elementInput({ fill: color }), (doc, p) => { const e = ensureEditable(typedElement(doc, p.elementId, 'shape')); e.fill = p.fill; localOverride(e, ['fill']);designOverride(e,{fill:p.fill}); }, 'pilot'],
  ['shape.set_stroke', elementInput({ stroke }), (doc, p) => { const e=ensureEditable(typedElement(doc,p.elementId,'shape'));Object.assign(e.stroke,p.stroke);designOverride(e,{stroke:p.stroke}); }],
  ['shape.set_kind', elementInput({ shape: enumeration(...SHAPE_KINDS) }), (doc, p) => { const element=ensureEditable(typedElement(doc,p.elementId,'shape'));if(element.shape!==p.shape){delete element.adjustments;delete element.path;element.shape=p.shape;} }],
  ['shape.set_adjustments',elementInput({adjustments:shapeAdjustments}),(doc,p)=>{const e=ensureEditable(typedElement(doc,p.elementId,'shape'));if(e.shape===FREEFORM_KIND)reject('TARGET_TYPE_MISMATCH','자유형은 점 편집을 사용하세요.','$.params.elementId');try{e.adjustments=normalizeShapeAdjustments(e.shape,p.adjustments,e.geometry.width,e.geometry.height);}catch(error){reject('INVALID_COMMAND',error.message,'$.params.adjustments');}upgrade(doc);}],
  ['shape.set_path',elementInput({path:drawingSchemas.path}),(doc,p)=>{const e=ensureEditable(typedElement(doc,p.elementId,'shape'));if(e.shape!==FREEFORM_KIND)reject('TARGET_TYPE_MISMATCH','자유형 도형이 필요합니다.','$.params.elementId');try{e.path=normalizeFreeformPath(p.path);}catch(error){reject('INVALID_COMMAND',error.message,'$.params.path');}upgrade(doc);}],
  ['text.set_content', elementInput({ paragraphs }), (doc, p) => { const e=ensureEditable(textElement(doc, p.elementId));if(JSON.stringify(e.text.paragraphs)!==JSON.stringify(p.paragraphs)){e.text.paragraphs=p.paragraphs;delete e.text.runs;delete e.text.paragraphStyles;} }],
  ['text.set_style', elementInput({ style }), (doc, p) => { const e = ensureEditable(textElement(doc, p.elementId)); Object.assign(e.text.textStyle, p.style);designOverride(e,{textStyle:p.style}); localOverride(e, [...(p.style.color ? ['textColor'] : []), ...(p.style.fontFamily ? ['fontFamily'] : [])]); }],
  ['text.replace', elementInput({ text: fullText }), (doc, p) => {
    const { element } = findElement(doc, p.elementId);
    ensureEditable(element);
    if (!['text','shape'].includes(element.type)) reject('TARGET_TYPE_MISMATCH', '텍스트를 지원하는 개체가 필요합니다.', '$.params.elementId');
    element.text = p.text;
    if(p.text.runs!==undefined||p.text.paragraphStyles!==undefined)upgradeBusiness(doc);
  }],
  ['text.set_runs',elementInput({runs:businessSchemas.runs}),(doc,p)=>{const e=ensureEditable(textElement(doc,p.elementId));if(p.runs.length||e.text.runs!==undefined)e.text.runs=p.runs;upgradeBusiness(doc);}],
  ['text.set_paragraph_styles',elementInput({paragraphStyles:businessSchemas.paragraphStyles}),(doc,p)=>{ensureEditable(textElement(doc,p.elementId)).text.paragraphStyles=p.paragraphStyles;upgradeBusiness(doc);}],
  ['text.format_range',elementInput({range:businessSchemas.range,marks:businessSchemas.marks}),(doc,p)=>{const e=ensureEditable(textElement(doc,p.elementId));e.text=applyTextRange(e.text,p.range,p.marks);upgradeBusiness(doc);}],
  ...['table','chart','connector','svg'].map(type=>[`${type}.set_data`,elementInput({[type]:businessSchemas[type]}),(doc,p)=>{ensureEditable(typedElement(doc,p.elementId,type))[type]=p[type];upgradeBusiness(doc);}]),
  ['element.set_semantics',elementInput({semanticRole:businessSchemas.semanticRole}),(doc,p)=>{const e=ensureEditable(findElement(doc,p.elementId).element);if(p.semanticRole!=='auto'||e.semanticRole!==undefined)e.semanticRole=p.semanticRole;upgradeBusiness(doc);}],
  ['layout.update',object({layoutId:identifier,...layoutFields,assets:assetArray},['layoutId','name','canvas','background','elements','placeholderIds']),(doc,p)=>layoutOperation(doc,()=>updateLayout(doc,p))],
  ['layout.library_ensure',object({}),(doc)=>layoutOperation(doc,()=>ensureLayoutLibrary(doc))],
  ['layout.library_replace',object({layoutMasters:{type:'array',items:masterDefinition,maxItems:128},layouts:{type:'array',items:layoutDefinition,maxItems:128},assets:assetArray},['layoutMasters','layouts']),(doc,p)=>layoutOperation(doc,()=>replaceLayoutLibrary(doc,p))],
  ['library.import',object({slides:{type:'array',items:slideData,maxItems:1000},slideIndex:{type:'integer',minimum:0,maximum:100000},webForms:webSchemas.forms,behaviorVariables:behaviorSchemas.variables,motionClips:motionSchemas.motionClips,componentLibrary:{type:'array',items:componentDefinition,maxItems:128},layoutMasters:{type:'array',items:masterDefinition,maxItems:64},layouts:{type:'array',items:layoutDefinition,maxItems:128},styleRecipes:{type:'array',items:designSchemas.recipe,maxItems:128},styleTokens:designSchemas.tokens,assetIds:{type:'array',items:identifier,maxItems:1000},variables:motionSchemas.variables},['layoutMasters','layouts','styleRecipes','styleTokens','assetIds']),(doc,p)=>{try{if(p.layoutMasters.length||p.layouts.length||p.styleRecipes.length||p.styleTokens.length||p.variables?.length)upgradeDesign(doc);if(p.componentLibrary?.length||p.behaviorVariables?.length||p.webForms?.length||p.slides?.length)doc.schemaVersion=AUTHORING_SCHEMA;appendLibraryImport(doc,p);}catch(error){reject('INVALID_COMMAND',error.message,'$.params');}}],
  ['layout.insert',object({layoutId:identifier,...layoutFields},['layoutId','name','canvas','background','elements','placeholderIds']),(doc,p)=>layoutOperation(doc,()=>insertLayout(doc,p))],
  ['layout.duplicate',object({layoutId:identifier,newLayoutId:identifier,name:layoutFields.name},['layoutId','newLayoutId']),(doc,p)=>layoutOperation(doc,()=>duplicateLayout(doc,p))],
  ['layout.master_create',object({masterId:identifier,...masterFields}),(doc,p)=>layoutOperation(doc,()=>createLayoutMaster(doc,p))],
  ['layout.master_update',object({masterId:identifier,...masterFields}),(doc,p)=>layoutOperation(doc,()=>updateLayoutMaster(doc,p))],
  ['layout.reset',object({slideIds:ids}),(doc,p)=>layoutOperation(doc,()=>resetLayoutSlides(doc,p))],
  ['layout.fill_slot',object({slideId:identifier,slotKey:identifier,element:elementData,assets:assetArray},['slideId','slotKey','element']),(doc,p)=>layoutOperation(doc,()=>fillLayoutSlot(doc,p))],
  ['slide.create_from_layout',object({layoutId:identifier,slideId:identifier,afterSlideId:identifier,preset:{type:'boolean'}},['layoutId','slideId']),(doc,p)=>layoutOperation(doc,()=>{if(p.preset)ensureLayoutLibrary(doc);createSlideFromLayout(doc,p);})],
  ['video.set_properties',elementInput({video:videoSchemas.settings}),(doc,p)=>{const e=ensureEditable(typedElement(doc,p.elementId,'video'));e.video=p.video;upgradeBusiness(doc);}],
  ['layout.capture',object({slideId:identifier,name:string({minLength:1,maxLength:160}),layoutId:identifier,placeholderIds:{...ids,minItems:0}},['slideId','name','layoutId']),(doc,p)=>{findSlide(doc,p.slideId);try{captureLayout(doc,p);}catch(error){reject('INVALID_COMMAND',error.message,'$.params');}upgradeBusiness(doc);cleanReferences(doc);}],
  ['layout.apply',object({slideIds:ids,layoutId:identifier,preset:{type:'boolean'}},['slideIds','layoutId']),(doc,p)=>{if(p.preset){upgradeBusiness(doc);ensureLayoutLibrary(doc);}const layout=(doc.layouts||[]).find(l=>l.id===p.layoutId);if(!layout)reject('TARGET_NOT_FOUND','레이아웃을 찾을 수 없습니다.','$.params.layoutId');if(new Set(p.slideIds).size!==p.slideIds.length)reject('INVALID_COMMAND','중복 없는 슬라이드 목록이 필요합니다.','$.params.slideIds');const targets=p.slideIds.map(id=>findSlide(doc,id));try{for(const slide of targets)applyLayoutToSlide(doc,slide,layout);}catch(error){reject('INVALID_COMMAND',error.message,'$.params');}upgradeBusiness(doc);cleanReferences(doc);}],
  ['layout.detach',object({slideIds:ids}),(doc,p)=>{if(new Set(p.slideIds).size!==p.slideIds.length)reject('INVALID_COMMAND','중복 없는 슬라이드 목록이 필요합니다.','$.params.slideIds');for(const id of p.slideIds)detachLayoutFromSlide(doc,findSlide(doc,id));}],
  ['layout.delete',object({layoutId:identifier}),(doc,p)=>{if(!(doc.layouts||[]).some(l=>l.id===p.layoutId))reject('TARGET_NOT_FOUND','레이아웃을 찾을 수 없습니다.','$.params.layoutId');for(const slide of doc.slides)if(slide.layout?.layoutId===p.layoutId)detachLayoutFromSlide(doc,slide);doc.layouts=doc.layouts.filter(l=>l.id!==p.layoutId);}],
  ['document.set_master',object({master:{anyOf:[{type:'null'},businessSchemas.master]}}),(doc,p)=>{if(p.master===null)delete doc.master;else doc.master=p.master;upgradeBusiness(doc);}],
  ['slide.set_business',slideInput({properties:object({...slideBusinessFields,masterOverride:{anyOf:[{type:'null'},businessSchemas.masterOverride]},template:{anyOf:[{type:'null'},businessSchemas.template]}},[],{minProperties:1})}),(doc,p)=>{const s=findSlide(doc,p.slideId);for(const [key,value]of Object.entries(p.properties)){if(value===null)delete s[key];else s[key]=value;}upgradeBusiness(doc);}],
  ['image.set_properties', elementInput({ properties: object({ fit: enumeration('contain', 'cover'), alt: string(), crop, focal, source: string() }, [], { minProperties: 1 }) }), (doc, p) => {
    const e = ensureEditable(typedElement(doc, p.elementId, 'image')); Object.assign(e, p.properties);
    if (['crop', 'focal', 'source'].some(key => Object.hasOwn(p.properties, key))) upgrade(doc);
  }],
  ['slide.set_background', slideInput({ background: color }), (doc, p) => { findSlide(doc, p.slideId).background = p.background; }],
  ['element.delete', elementInput({}), (doc, p) => { const { element, slide } = findElement(doc, p.elementId); ensureEditable(element); slide.elements.splice(slide.elements.indexOf(element), 1); cleanGroupRefs(slide); cleanReferences(doc); }],
  ['element.move', elementInput({ delta: { type: 'integer', minimum: -2147483648, maximum: 2147483647 } }), (doc, p) => {
    const { element, slide } = findElement(doc, p.elementId); ensureEditable(element); const index = slide.elements.indexOf(element);
    slide.elements.splice(index, 1); slide.elements.splice(Math.max(0, Math.min(slide.elements.length, index + p.delta)), 0, element);
  }],
  ['slide.delete', slideInput({}), (doc, p) => { const slide = findSlide(doc, p.slideId); if (doc.slides.length > 1) { doc.slides.splice(doc.slides.indexOf(slide), 1); cleanReferences(doc); } }],
  ['slide.move', slideInput({ delta: { type: 'integer', minimum: -2147483648, maximum: 2147483647 } }), (doc, p) => {
    const slide = findSlide(doc, p.slideId); const index = doc.slides.indexOf(slide);
    doc.slides.splice(index, 1); doc.slides.splice(Math.max(0, Math.min(doc.slides.length, index + p.delta)), 0, slide);
  }],
  ['element.set_properties', elementInput({ properties: flags }), (doc, p) => {
    const found=findElement(doc,p.elementId),e=found.element;
    if(isInheritedLayoutElement(doc,found.slide,p.elementId))reject('TARGET_LOCKED','공통 디자인은 마스터 보기에서 편집하세요.','$.params.elementId');
    if (p.properties.initiallyHidden !== undefined) ensureEditable(e);
    for (const [key, value] of Object.entries(p.properties)) if (!(value === false && e[key] === undefined)) e[key] = value;
    if (p.properties.initiallyHidden !== undefined) upgradeMotion(doc); else upgrade(doc);
  }],
  ['element.set_rotation', elementInput({ rotation: number }), (doc, p) => { const e = ensureEditable(findElement(doc, p.elementId).element);if(e.type==='connector')reject('TARGET_TYPE_MISMATCH','연결선은 endpoint를 변경해 배치해 주세요.','$.params.elementId'); if (p.rotation !== 0 || e.rotation !== undefined) e.rotation = p.rotation; upgrade(doc); }],
  ['element.set_style', elementInput({ style: visualStyle }), (doc, p) => {
    const e = ensureEditable(findElement(doc, p.elementId).element); e.style = { ...e.style, ...p.style };
    for (const key of ['gradient', 'shadow']) if (e.style[key] === null) delete e.style[key];
    designOverride(e,{style:p.style});upgrade(doc);
  }],
  ['element.set_theme_refs', elementInput({ refs: themeRefs }), (doc, p) => {
    const e = ensureEditable(findElement(doc, p.elementId).element);
    if (p.refs.fill && e.type !== 'shape') reject('TARGET_TYPE_MISMATCH', '채우기 테마는 도형에 적용할 수 있습니다.', '$.params.refs.fill');
    if ((p.refs.textColor || p.refs.fontFamily) && !e.text) reject('TARGET_TYPE_MISMATCH', '글자 테마는 텍스트가 있는 개체에 적용할 수 있습니다.', '$.params.refs');
    if (!doc.theme && (p.refs.fill || p.refs.textColor || p.refs.fontFamily)) doc.theme = { colors: { primary: '#2563eb', secondary: '#7c3aed', background: '#ffffff', text: '#182037' }, fontFamily: 'Malgun Gothic' };
    e.themeRefs = p.refs; upgrade(doc);
  }],
  ['document.set_theme', object({ theme }), (doc, p) => { doc.theme = p.theme;if(p.theme.headingFontFamily!==undefined||p.theme.spacing!==undefined)upgradeBusiness(doc);else upgrade(doc); }],
  ['document.set_variables', object({ variables: motionSchemas.variables }), (doc, p) => {
    if (p.variables.length || doc.variables !== undefined) doc.variables = p.variables;
    for(const slide of [...doc.slides,...(doc.layouts||[])])for(const e of slide.elements)if(e.chart?.variants){const v=p.variables.find(v=>v.id===e.chart.variants.variableId);if(v?.kind==='number'){delete e.chart.variants;continue;}if(v)e.chart.variants.values=v.options.map(o=>e.chart.variants.values.find(row=>row.value===o.value)||{value:o.value,series:e.chart.series.map(s=>({seriesId:s.id,values:[...s.values]}))});}
    upgradeMotion(doc); cleanReferences(doc);
  }],
  ['slide.set_motions', slideInput({ motions: motionSchemas.motions }), (doc, p) => {
    const slide = findSlide(doc, p.slideId); protectChangedTargets(doc, slide.motions, p.motions, 'targetId'); if (p.motions.length || slide.motions !== undefined) slide.motions = p.motions; upgradeMotion(doc); cleanMotionReferences(doc);cleanBehaviorReferences(doc);
  }],
  ['slide.set_interactions', slideInput({ interactions: motionSchemas.interactions }), (doc, p) => {
    const slide = findSlide(doc, p.slideId); protectChangedTargets(doc, slide.interactions, p.interactions, 'sourceId'); if (p.interactions.length || slide.interactions !== undefined) slide.interactions = p.interactions; upgradeMotion(doc);
  }],
  ['slide.set_transition', object({ slideId: identifier, transition: motionSchemas.nullableTransition, advanceAfter: motionSchemas.advanceAfter }, ['slideId', 'transition']), (doc, p) => {
    const slide = findSlide(doc, p.slideId); if (p.transition === null) delete slide.transition; else slide.transition = p.transition;
    if (p.advanceAfter !== undefined) { if (p.advanceAfter === null) delete slide.advanceAfter; else slide.advanceAfter = p.advanceAfter; }
    upgradeMotion(doc);
  }],
  ['element.set_component', elementInput({ component: motionSchemas.nullableComponent }), (doc, p) => {
    const element = ensureEditable(findElement(doc, p.elementId).element); if (p.component === null) delete element.component; else element.component = p.component;
    upgradeMotion(doc); cleanMotionReferences(doc);
  }],
  ['element.set_binding', elementInput({ binding: motionSchemas.nullableBinding }), (doc, p) => {
    const element = ensureEditable(findElement(doc, p.elementId).element); if (p.binding === null) delete element.binding; else element.binding = p.binding; upgradeMotion(doc);
  }],
  ['element.set_states',elementInput({states:motionSchemas.states}),(doc,p)=>{const element=ensureEditable(findElement(doc,p.elementId).element);if(p.states.length||element.states!==undefined)element.states=p.states;upgradeMotion(doc);cleanAdvancedReferences(doc);cleanBehaviorReferences(doc);} ],
  ['document.set_motion_clips',object({clips:motionSchemas.motionClips}),(doc,p)=>{if(p.clips.length||doc.motionClips!==undefined)doc.motionClips=p.clips;upgradeMotion(doc);} ],
  ['document.resize_canvas', object({ width: positive, height: positive, policy: enumeration('keep', 'scale') }), (doc, p) => {
    if (p.policy === 'scale') for (const slide of doc.slides) for (const e of slide.elements) {
      e.geometry.x *= p.width / doc.canvas.width; e.geometry.width *= p.width / doc.canvas.width;
      e.geometry.y *= p.height / doc.canvas.height; e.geometry.height *= p.height / doc.canvas.height;
      if(e.connector){for(const endpoint of [e.connector.from,e.connector.to])if(endpoint.point){endpoint.point.x*=p.width/doc.canvas.width;endpoint.point.y*=p.height/doc.canvas.height;}if(e.connector.control){e.connector.control.x*=p.width/doc.canvas.width;e.connector.control.y*=p.height/doc.canvas.height;}if(e.connector.waypoints)e.connector.waypoints=e.connector.waypoints.map(v=>({x:v.x*p.width/doc.canvas.width,y:v.y*p.height/doc.canvas.height}));}
    }
    for(const slide of doc.slides)if(slide.scene){if(p.policy==='scale')scaleScene(slide.scene,p.width/doc.canvas.width,p.height/doc.canvas.height,{width:p.width,height:p.height});else if(slide.scene.world){slide.scene.world.width=Math.max(slide.scene.world.width,p.width);slide.scene.world.height=Math.max(slide.scene.world.height,p.height);}}
    doc.canvas.width = p.width; doc.canvas.height = p.height;
  }],
  ['elements.set_geometry', object({ updates }), (doc, p) => {
    const targets=selected(doc, p.updates.map(u => u.elementId));if(targets.every(e=>e.type==='connector'))reject('TARGET_TYPE_MISMATCH','연결선은 endpoint를 변경해 배치해 주세요.','$.params.updates');
    for (const update of p.updates) { const e = findElement(doc, update.elementId).element;if(e.type==='connector')continue;ensureFlowGeometry(doc,e,update.geometry); Object.assign(e.geometry, update.geometry); if (update.rotation !== undefined && (update.rotation !== 0 || e.rotation !== undefined)) { e.rotation = update.rotation; upgrade(doc); } }
  }],
  ['elements.transform', object({ elementIds: ids, transform: object({ dx: number, dy: number, scaleX: positive, scaleY: positive, rotation: number }, [], { minProperties: 1 }) }), (doc, p) => {
    const elements = selected(doc, p.elementIds), bounds = elementBounds(elements), t = p.transform;
    for(const e of elements)if(flowParent(findElement(doc,e.id).slide,e.id))reject('INVALID_COMMAND','자동 배치 안의 개체는 배치 순서/간격을 조절하거나 자동 배치에서 해제해 주세요.','$.params.elementIds');
    const angle = (t.rotation ?? 0) * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle), center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    for (const e of elements) {
      if(e.type==='connector')continue;
      e.geometry.x = bounds.x + (e.geometry.x - bounds.x) * (t.scaleX ?? 1); e.geometry.width *= t.scaleX ?? 1;
      e.geometry.y = bounds.y + (e.geometry.y - bounds.y) * (t.scaleY ?? 1); e.geometry.height *= t.scaleY ?? 1;
      if (t.rotation) {
        const x = e.geometry.x + e.geometry.width / 2 - center.x, y = e.geometry.y + e.geometry.height / 2 - center.y;
        e.geometry.x = center.x + x * c - y * s - e.geometry.width / 2; e.geometry.y = center.y + x * s + y * c - e.geometry.height / 2;
        e.rotation = (e.rotation ?? 0) + t.rotation; upgrade(doc);
      }
      e.geometry.x += t.dx ?? 0; e.geometry.y += t.dy ?? 0;
    }
  }],
  ['elements.align', object({ elementIds: ids, alignment: enumeration('left', 'center', 'right', 'top', 'middle', 'bottom'), relativeTo: enumeration('selection', 'slide') }), (doc, p) => {
    const elements = selected(doc, p.elementIds);for(const e of elements)if(flowParent(findElement(doc,e.id).slide,e.id))reject('INVALID_COMMAND','자동 배치 안의 개체는 배치 설정에서 정렬하세요.','$.params.elementIds');
    const b = p.relativeTo === 'slide' ? { x: 0, y: 0, width: doc.canvas.width, height: doc.canvas.height } : elementBounds(elements);
    for (const e of elements) { const g = elementBounds([e]);
      if (p.alignment === 'left') e.geometry.x += b.x - g.x;
      if (p.alignment === 'center') e.geometry.x += b.x + b.width / 2 - g.x - g.width / 2;
      if (p.alignment === 'right') e.geometry.x += b.x + b.width - g.x - g.width;
      if (p.alignment === 'top') e.geometry.y += b.y - g.y;
      if (p.alignment === 'middle') e.geometry.y += b.y + b.height / 2 - g.y - g.height / 2;
      if (p.alignment === 'bottom') e.geometry.y += b.y + b.height - g.y - g.height;
    }
  }],
  ['elements.distribute', object({ elementIds: ids, axis: enumeration('horizontal', 'vertical') }), (doc, p) => {
    const elements = selected(doc, p.elementIds);for(const e of elements)if(flowParent(findElement(doc,e.id).slide,e.id))reject('INVALID_COMMAND','자동 배치 안의 개체는 배치 설정에서 분배하세요.','$.params.elementIds'); if (elements.length < 3) return;
    const key = p.axis === 'horizontal' ? 'x' : 'y', size = key === 'x' ? 'width' : 'height';
    const ordered = elements.map(e => ({ e, b: elementBounds([e]) })).sort((a, b) => a.b[key] - b.b[key]);
    const start = ordered[0].b[key], end = ordered.at(-1).b[key] + ordered.at(-1).b[size];
    const gap = (end - start - ordered.reduce((sum, item) => sum + item.b[size], 0)) / (ordered.length - 1);
    let cursor = start; for (const { e, b } of ordered) { e.geometry[key] += cursor - b[key]; cursor += b[size] + gap; }
  }],
  ['elements.group', object({ elementIds: ids, groupId: identifier }), (doc, p) => {
    const elements = selected(doc, p.elementIds); if (elements.length < 2) reject('INVALID_COMMAND', '그룹에는 개체가 두 개 이상 필요합니다.', '$.params.elementIds');
    if (doc.slides.flatMap(s => s.elements).some(e => e.groupId === p.groupId || e.id === p.groupId) || doc.id === p.groupId || doc.assets.some(a => a.id === p.groupId)) reject('INVALID_COMMAND', '이미 사용 중인 그룹 ID입니다.', '$.params.groupId');
    for (const e of elements) e.groupId = p.groupId;
    cleanGroupRefs(findElement(doc, elements[0].id).slide); upgrade(doc);
  }],
  ['elements.ungroup', object({ elementIds: ids }), (doc, p) => {
    const elements = selected(doc, p.elementIds), groups = new Set(elements.map(e => e.groupId).filter(Boolean));
    for (const slide of doc.slides) for (const e of slide.elements) if (groups.has(e.groupId)) { ensureEditable(e); delete e.groupId; }
  }],
  ['elements.delete', object({ elementIds: ids }), (doc, p) => {
    const elements = selected(doc, p.elementIds), slide = findElement(doc, elements[0].id).slide, removed = new Set(p.elementIds);
    slide.elements = slide.elements.filter(e => !removed.has(e.id)); cleanGroupRefs(slide); cleanReferences(doc);
  }],
  ['elements.move', object({ elementIds: ids, delta: { type: 'integer', minimum: -2147483648, maximum: 2147483647 } }), (doc, p) => {
    const elements = selected(doc, p.elementIds), slide = findElement(doc, elements[0].id).slide, moving = new Set(p.elementIds);
    const direction = Math.sign(p.delta), steps = Math.min(Math.abs(p.delta), slide.elements.length);
    for (let step = 0; step < steps; step++) {
      if (direction > 0) for (let index = slide.elements.length - 2; index >= 0; index--) {
        if (moving.has(slide.elements[index].id) && !moving.has(slide.elements[index + 1].id)) [slide.elements[index], slide.elements[index + 1]] = [slide.elements[index + 1], slide.elements[index]];
      }
      else for (let index = 1; index < slide.elements.length; index++) {
        if (moving.has(slide.elements[index].id) && !moving.has(slide.elements[index - 1].id)) [slide.elements[index - 1], slide.elements[index]] = [slide.elements[index], slide.elements[index - 1]];
      }
    }
  }],
  ['elements.insert', object({componentInstances:{type:'array',items:componentInstance,maxItems:256}, slideId: identifier, elements: elementArray, assets: assetArray, variables: motionSchemas.variables, motions: motionSchemas.motions, interactions: motionSchemas.interactions,scene:sceneSchemas.scene,behavior:slideBehavior,behaviorVariables:behaviorSchemas.variables }, ['slideId', 'elements', 'assets']), (doc, p) => {
    const slide = findSlide(doc, p.slideId); slide.elements.push(...p.elements);if(p.componentInstances?.length){slide.componentInstances=[...(slide.componentInstances||[]),...p.componentInstances];doc.schemaVersion=AUTHORING_SCHEMA;} doc.assets.push(...p.assets);
    if(p.scene){const incoming=normalizeScene(p.scene,{canvas:doc.canvas});if(slide.scene){const old=slide.scene;slide.scene={...old,...(!old.world&&incoming.world?{world:incoming.world}:{}),bodies:[...old.bodies,...incoming.bodies],hudIds:[...old.hudIds,...incoming.hudIds],sprites:[...old.sprites,...incoming.sprites],audio:[...old.audio,...incoming.audio]};if(old.world&&incoming.world){slide.scene.world={...old.world,width:Math.max(old.world.width,incoming.world.width),height:Math.max(old.world.height,incoming.world.height)};}}else slide.scene=incoming;doc.schemaVersion=SCENE_SCHEMA;}
    if(p.behavior){slide.behavior||={};for(const field of['rules','machines','bindings','inputs'])if(p.behavior[field]?.length)slide.behavior[field]=[...(slide.behavior[field]||[]),...p.behavior[field]];if(![SCENE_SCHEMA,AUTHORING_SCHEMA].includes(doc.schemaVersion))doc.schemaVersion=BEHAVIOR_SCHEMA;}
    if (p.variables?.length) doc.variables = [...(doc.variables || []), ...p.variables];
    if(p.behaviorVariables?.length){doc.behavior||={variables:[]};doc.behavior.variables.push(...p.behaviorVariables);if(![SCENE_SCHEMA,AUTHORING_SCHEMA].includes(doc.schemaVersion))doc.schemaVersion=BEHAVIOR_SCHEMA;}
    if (p.motions?.length) slide.motions = [...(slide.motions || []), ...p.motions];
    if (p.interactions?.length) slide.interactions = [...(slide.interactions || []), ...p.interactions];
    if(p.elements.some(isBusinessElement))upgradeBusiness(doc);
    else if (p.elements.some(e => e.component || e.binding || e.initiallyHidden !== undefined) || p.variables?.length || p.motions?.length || p.interactions?.length) upgradeMotion(doc);
    else if (p.elements.some(e => ['name', 'locked', 'hidden', 'rotation', 'groupId', 'style', 'themeRefs', 'crop', 'focal', 'source'].some(key => Object.hasOwn(e, key)))) upgrade(doc);
    if(slide.readingOrder)slide.readingOrder=[...slide.readingOrder,...p.elements.filter(e=>!slide.readingOrder.includes(e.id)).map(e=>e.id)];
  }],
  ['elements.apply_format', object({ elementIds: ids, format: object({ style: storedVisualStyle, fill: color, stroke, textStyle: style, themeRefs,design:designSchemas.design }, []) }), (doc, p) => {
    for (const e of selected(doc, p.elementIds)) {
      if(p.format.design){e.design=cloneDocument(p.format.design);upgradeDesign(doc);}else delete e.design;
      if (p.format.style) { e.style = cloneDocument(p.format.style); upgrade(doc); }
      if (e.type === 'shape' && p.format.fill) e.fill = p.format.fill;
      if (e.type === 'shape' && p.format.stroke) e.stroke = { ...e.stroke, ...p.format.stroke };
      if (e.text && p.format.textStyle) e.text.textStyle = { ...e.text.textStyle, ...p.format.textStyle };
      if (p.format.themeRefs) { e.themeRefs = cloneDocument(p.format.themeRefs); upgrade(doc); } else delete e.themeRefs;
    }
  }],
  ['image.replace', elementInput({ assetId: identifier }), (doc, p) => {
    const e = ensureEditable(typedElement(doc, p.elementId, 'image'));
    if (!doc.assets.some(a => a.id === p.assetId)) reject('TARGET_NOT_FOUND', '이미지 자산을 찾을 수 없습니다.', '$.params.assetId');
    e.assetId = p.assetId;
  }],
  ['slides.rename', slideInput({ name: string() }), (doc, p) => { findSlide(doc, p.slideId).name = p.name; upgrade(doc); }],
  ['slide.set_properties', slideInput({ properties: object({ name: string(), section: string() }, [], { minProperties: 1 }) }), (doc, p) => { Object.assign(findSlide(doc, p.slideId), p.properties); upgrade(doc); }],
  ['slides.delete', object({ slideIds: ids }), (doc, p) => {
    p.slideIds.forEach(id => findSlide(doc, id)); if (new Set(p.slideIds).size !== p.slideIds.length) reject('INVALID_COMMAND', '중복 슬라이드 ID입니다.', '$.params.slideIds');
    if (p.slideIds.length >= doc.slides.length) reject('INVALID_COMMAND', '최소 한 장의 슬라이드를 남겨 주세요.', '$.params.slideIds');
    const removed = new Set(p.slideIds); doc.slides = doc.slides.filter(s => !removed.has(s.id)); cleanReferences(doc);
  }],
  ['slides.move', object({ slideIds: ids, index: { type: 'integer', minimum: 0, maximum: 100000 } }), (doc, p) => {
    p.slideIds.forEach(id => findSlide(doc, id)); const moving = new Set(p.slideIds);
    if (moving.size !== p.slideIds.length) reject('INVALID_COMMAND', '중복 슬라이드 ID입니다.', '$.params.slideIds');
    const slides = doc.slides.filter(s => moving.has(s.id)); doc.slides = doc.slides.filter(s => !moving.has(s.id));
    doc.slides.splice(Math.min(p.index, doc.slides.length), 0, ...slides);
  }],
  ['slides.insert', object({ slides: { type: 'array', minItems: 1, maxItems: 1000, items: slideData }, assets: assetArray, index: { type: 'integer', minimum: 0, maximum: 100000 }, variables: motionSchemas.variables,behaviorVariables:behaviorSchemas.variables }, ['slides', 'assets', 'index']), (doc, p) => {
    doc.slides.splice(Math.min(p.index, doc.slides.length), 0, ...p.slides); doc.assets.push(...p.assets);
    if (p.variables?.length) doc.variables = [...(doc.variables || []), ...p.variables];
    if(p.behaviorVariables?.length){doc.behavior||={variables:[]};doc.behavior.variables.push(...p.behaviorVariables);if(![SCENE_SCHEMA,AUTHORING_SCHEMA].includes(doc.schemaVersion))doc.schemaVersion=BEHAVIOR_SCHEMA;}
    if(p.slides.some(s=>Object.keys(slideBusinessFields).some(k=>s[k]!==undefined)||s.elements.some(isBusinessElement)))upgradeBusiness(doc);
    else if (p.variables?.length || p.slides.some(s => s.motions || s.interactions || s.transition || s.advanceAfter !== undefined || s.elements.some(e => e.component || e.binding || e.initiallyHidden !== undefined))) upgradeMotion(doc);
    else if (p.slides.some(s => s.name !== undefined || s.section !== undefined || s.elements.some(e => ['name', 'locked', 'hidden', 'rotation', 'groupId', 'style', 'themeRefs', 'crop', 'focal', 'source'].some(key => Object.hasOwn(e, key))))) upgrade(doc);
  }],
  ['design.set_tokens',object({tokens:designSchemas.tokens}),(doc,p)=>designOperation(doc,()=>{if(p.tokens.length||doc.styleTokens!==undefined)doc.styleTokens=p.tokens;})],
  ['design.recipe_upsert',object({recipe:designSchemas.recipe}),(doc,p)=>designOperation(doc,()=>{const recipes=doc.styleRecipes||=[],at=recipes.findIndex(r=>r.id===p.recipe.id);if(at<0)recipes.push(p.recipe);else recipes[at]=p.recipe;doc.styleRecipes=recipes;})],
  ['design.recipe_apply',object({elementIds:ids,recipeId:identifier,keepOverrides:{type:'boolean'}},['elementIds','recipeId']),(doc,p)=>designOperation(doc,()=>{if(!doc.styleRecipes?.some(r=>r.id===p.recipeId))reject('TARGET_NOT_FOUND','문서 스타일을 찾을 수 없습니다.','$.params.recipeId');for(const e of selected(doc,p.elementIds)){const previous=e.design||{};e.design={recipeId:p.recipeId,...(p.keepOverrides&&previous.overrides?{overrides:previous.overrides}:{}),...(p.keepOverrides&&previous.states?{states:previous.states}:{}),...(previous.disabled!==undefined?{disabled:previous.disabled}:{})};}})],
  ['design.recipe_detach',object({elementIds:ids}),(doc,p)=>designOperation(doc,()=>{for(const e of selected(doc,p.elementIds))detachDesignElement(e,doc);})],
  ['design.recipe_remove',object({recipeId:identifier}),(doc,p)=>designOperation(doc,()=>{if(!doc.styleRecipes?.some(r=>r.id===p.recipeId))reject('TARGET_NOT_FOUND','문서 스타일을 찾을 수 없습니다.','$.params.recipeId');for(const slide of [...doc.slides,...(doc.layouts||[]),...(doc.layoutMasters||[]),...(doc.componentLibrary||[])])for(const e of slide.elements)if(e.design?.recipeId===p.recipeId)detachDesignElement(e,doc);doc.styleRecipes=doc.styleRecipes.filter(r=>r.id!==p.recipeId);})],
  ['design.set_overrides',object({elementIds:ids,appearance:designSchemas.appearance,replace:{type:'boolean'}},['elementIds','appearance']),(doc,p)=>designOperation(doc,()=>{for(const e of selected(doc,p.elementIds)){e.design||={};e.design.overrides=p.replace?p.appearance:patchDesignAppearance(e.design.overrides,p.appearance);}})],
  ['design.reset_overrides',object({elementIds:ids,section:enumeration('all','fill','stroke','text','effects','css')}),(doc,p)=>designOperation(doc,()=>{for(const e of selected(doc,p.elementIds)){if(!e.design?.overrides)continue;if(p.section==='all')delete e.design.overrides;else{const key={text:'textStyle',effects:'style'}[p.section]||p.section;delete e.design.overrides[key];if(!Object.keys(e.design.overrides).length)delete e.design.overrides;}}})],
  ['design.set_state',object({elementIds:ids,state:enumeration('hover','pressed','focus','disabled'),appearance:{anyOf:[{type:'null'},designSchemas.appearance]}}),(doc,p)=>designOperation(doc,()=>{for(const e of selected(doc,p.elementIds)){e.design||={};if(p.appearance===null){if(e.design.states){delete e.design.states[p.state];if(!Object.keys(e.design.states).length)delete e.design.states;}}else{e.design.states||={};e.design.states[p.state]=p.appearance;}}})],
  ['design.set_enabled',object({elementIds:ids,enabled:{type:'boolean'}}),(doc,p)=>designOperation(doc,()=>{for(const e of selected(doc,p.elementIds)){if(p.enabled){if(e.design)delete e.design.disabled;}else{e.design||={};e.design.disabled=true;}}})],
  ['flow.create',object({slideId:identifier,elementIds:ids,containerId:identifier,flow:designSchemas.flowSettings,name:string({minLength:1,maxLength:160})},['slideId','elementIds','containerId','flow']),(doc,p)=>designOperation(doc,()=>{const slide=findSlide(doc,p.slideId);selected(doc,p.elementIds);const units=componentFlowUnits(doc,slide,p.elementIds),members=selected(doc,units);if(members.some(e=>!slide.elements.includes(e)||e.type==='connector'||flowParent(slide,e.id)))reject('INVALID_COMMAND','같은 페이지에서 자동 배치에 속하지 않은 개체를 선택해 주세요.','$.params.elementIds');const b=elementBounds(members),f=p.flow,pad=f.padding,gap=f.gap,col=Math.min(f.columns,members.length),rows=Math.ceil(members.length/col),maxW=Math.max(...members.map(e=>e.geometry.width)),maxH=Math.max(...members.map(e=>e.geometry.height));const width=f.direction==='row'?members.reduce((n,e)=>n+e.geometry.width,0)+gap*(members.length-1):f.direction==='grid'?maxW*col+gap*(col-1):maxW;const height=f.direction==='column'?members.reduce((n,e)=>n+e.geometry.height,0)+gap*(members.length-1):f.direction==='grid'?maxH*rows+gap*(rows-1):maxH;const container={id:p.containerId,type:'shape',shape:'rectangle',name:p.name||'자동 배치',fill:'#ffffff00',stroke:{color:'#ffffff00',width:0},geometry:{x:b.x-pad,y:b.y-pad,width:Math.max(width+pad*2,.001),height:Math.max(height+pad*2,.001)},semanticRole:'decorative',flow:{...f,children:[...units]}};const compositionParent=slide.elements.find(e=>e.composition&&units.every(id=>e.composition.children.includes(id)));if(compositionParent){const order=compositionParent.composition.children,at=Math.min(...units.map(id=>order.indexOf(id)));compositionParent.composition.children=order.filter(id=>!units.includes(id));compositionParent.composition.children.splice(at,0,container.id);if(compositionParent.groupId)container.groupId=compositionParent.groupId;}const at=Math.min(...members.map(e=>slide.elements.indexOf(e)));slide.elements.splice(at,0,container);if(slide.readingOrder)slide.readingOrder.push(container.id);})],
  ['flow.set',elementInput({flow:designSchemas.flow}),(doc,p)=>designOperation(doc,()=>{const e=ensureEditable(findElement(doc,p.elementId).element),slide=findElement(doc,p.elementId).slide;if(new Set(p.flow.children).size!==p.flow.children.length)reject('INVALID_COMMAND','중복 없는 자동 배치 개체가 필요합니다.','$.params.flow.children');p.flow.children=componentFlowUnits(doc,slide,p.flow.children);for(const id of p.flow.children){const child=ensureEditable(findElement(doc,id).element);ensureFlowMembersEditable(doc,child);}e.flow=p.flow;const minimum=flowMinimumSize(e.flow,flowChildren(doc,e));if(e.flow.align==='stretch'&&e.flow.direction==='grid'&&(e.geometry.width<minimum.width||e.geometry.height<minimum.height))reject('INVALID_COMMAND','간격과 안쪽 여백이 자동 배치 영역보다 큽니다. 값을 줄이거나 영역 크기를 늘리세요.','$.params.flow');e.geometry.width=Math.max(e.geometry.width,minimum.width);e.geometry.height=Math.max(e.geometry.height,minimum.height);growFlowParents(doc,e);})],
  ['flow.remove',elementInput({}),(doc,p)=>designOperation(doc,()=>{delete ensureEditable(findElement(doc,p.elementId).element).flow;})],
  ['scene.set_slide',slideInput({scene:sceneSchemas.scene}),(doc,p)=>{const slide=findSlide(doc,p.slideId),scene=normalizeScene(p.scene,{canvas:doc.canvas});for(const field of['bodies','sprites']){const before=new Map((slide.scene?.[field]||[]).map(v=>[v.targetId,v])),after=new Map(scene[field].map(v=>[v.targetId,v]));for(const id of new Set([...before.keys(),...after.keys()]))if(JSON.stringify(before.get(id))!==JSON.stringify(after.get(id)))ensureEditable(findElement(doc,id).element);}slide.scene=scene;doc.schemaVersion=SCENE_SCHEMA;cleanBehaviorReferences(doc);pruneUnreferencedAudioAssets(doc);}],
  ['behavior.set_variables',object({variables:behaviorSchemas.variables}),(doc,p)=>{doc.behavior={variables:p.variables};if(![SCENE_SCHEMA,AUTHORING_SCHEMA].includes(doc.schemaVersion))doc.schemaVersion=BEHAVIOR_SCHEMA;cleanReferences(doc);}],
  ['behavior.set_slide',slideInput({behavior:slideBehavior}),(doc,p)=>{const slide=findSlide(doc,p.slideId);for(const field of['rules','bindings','inputs']){const before=new Map((slide.behavior?.[field]||[]).map(v=>[v.id,v])),after=new Map((p.behavior[field]||[]).map(v=>[v.id,v]));for(const id of new Set([...before.keys(),...after.keys()]))if(JSON.stringify(before.get(id))!==JSON.stringify(after.get(id)))for(const v of[before.get(id),after.get(id)]){const target=field==='rules'?v?.sourceId:v?.targetId;if(target)ensureEditable(findElement(doc,target).element);}}slide.behavior=p.behavior;if(![SCENE_SCHEMA,AUTHORING_SCHEMA].includes(doc.schemaVersion))doc.schemaVersion=BEHAVIOR_SCHEMA;}],
  ...['rules','machines','bindings','inputs'].map(field=>['behavior.set_'+field,slideInput({[field]:behaviorSchemas[field]}),(doc,p)=>{const slide=findSlide(doc,p.slideId),before=slide.behavior?.[field]||[];if(['bindings','inputs','rules'].includes(field)){const indexed=new Map(before.map(v=>[v.id,v])),next=new Map(p[field].map(v=>[v.id,v]));for(const id of new Set([...indexed.keys(),...next.keys()]))if(JSON.stringify(indexed.get(id))!==JSON.stringify(next.get(id)))for(const item of[indexed.get(id),next.get(id)]){const target=field==='rules'?item?.sourceId:item?.targetId;if(target)ensureEditable(findElement(doc,target).element);}}slide.behavior||={};slide.behavior[field]=p[field];if(![SCENE_SCHEMA,AUTHORING_SCHEMA].includes(doc.schemaVersion))doc.schemaVersion=BEHAVIOR_SCHEMA;if(['rules','machines'].includes(field)){cleanBehaviorReferences(doc);slide.behavior[field]=p[field];}}]),
  ['slide.create',object({clientRef:identifier,afterSlideId:identifier,name:string(),background:color},['clientRef']),(doc,p,context)=>{
    const id=context.fresh('slide'),index=p.afterSlideId===undefined?doc.slides.length:doc.slides.indexOf(findSlide(doc,p.afterSlideId))+1;
    registry.get('slides.insert').apply(doc,{slides:[{id,background:p.background||doc.theme?.colors.background||'#ffffff',elements:[],...(p.name!==undefined?{name:p.name}:{})}],assets:[],index});return id;
  }],
  ['slide.duplicate',object({clientRef:identifier,slideId:identifier,afterSlideId:identifier,name:string()},['clientRef','slideId']),(doc,p,context)=>duplicateCreated(doc,p,context,'slide')],
  ['element.create_text',object({clientRef:identifier,slideId:identifier,geometry:fullGeometry,paragraphs,textStyle:style,name:string()},['clientRef','slideId','geometry','paragraphs']),(doc,p,context)=>insertCreatedElement(doc,p,{id:context.fresh('element'),type:'text',geometry:p.geometry,text:defaultCreatedText(doc,p),...(p.name!==undefined?{name:p.name}:{})})],
  ['element.create_shape',object({clientRef:identifier,slideId:identifier,geometry:fullGeometry,shape:enumeration(...SHAPE_KINDS),fill:color,stroke,text:fullText,name:string()},['clientRef','slideId','geometry']),(doc,p,context)=>insertCreatedElement(doc,p,{id:context.fresh('element'),type:'shape',geometry:p.geometry,shape:p.shape||'rectangle',fill:p.fill||doc.theme?.colors.primary||'#2563eb',stroke:{color:doc.theme?.colors.primary||'#2563eb',width:0,...(p.stroke||{})},...(p.text?{text:p.text}:{}),...(p.name!==undefined?{name:p.name}:{})})],
  ['element.create_image',object({clientRef:identifier,slideId:identifier,geometry:fullGeometry,assetId:identifier,fit:enumeration('contain','cover'),alt:string(),name:string()},['clientRef','slideId','geometry','assetId']),(doc,p,context)=>{
    if(!doc.assets.some(asset=>asset.id===p.assetId&&asset.mimeType.startsWith('image/')))reject('TARGET_NOT_FOUND','승인해 준비했거나 문서에 있는 이미지 자산이 필요합니다.','$.params.assetId');
    return insertCreatedElement(doc,p,{id:context.fresh('element'),type:'image',geometry:p.geometry,assetId:p.assetId,fit:p.fit||'contain',alt:p.alt||'',...(p.name!==undefined?{name:p.name}:{})});
  }],
  ['element.duplicate',object({clientRef:identifier,elementId:identifier,slideId:identifier,offsetX:number,offsetY:number,name:string()},['clientRef','elementId']),(doc,p,context)=>duplicateCreated(doc,p,context,'element')],
  ['document.set_web_forms',object({forms:webSchemas.forms}),(doc,p)=>componentOperation(doc,()=>{validateWebFormVariables(doc,p.forms);doc.webForms=p.forms;cleanReferences(doc);})],
  ['element.set_web',elementInput({web:{anyOf:[{type:'null'},webSchemas.control]}}),(doc,p)=>componentOperation(doc,()=>{const element=ensureEditable(findElement(doc,p.elementId).element);if(p.web===null)delete element.web;else element.web=p.web;})],
  ['component.capture',object({componentId:identifier,slideId:identifier,elementIds:ids,name:string({minLength:1,maxLength:160})}),(doc,p)=>componentOperation(doc,()=>captureComponent(doc,p))],
  ['component.insert',object({componentId:identifier,instanceId:identifier,slideId:identifier,x:number,y:number,width:positive,height:positive},['componentId','instanceId','slideId','x','y']),(doc,p)=>componentOperation(doc,()=>insertComponent(doc,p))],
  ['component.update',object({componentId:identifier,slideId:identifier,instanceId:identifier,elementIds:ids,name:string({minLength:1,maxLength:160})},['componentId','slideId','instanceId']),(doc,p)=>componentOperation(doc,()=>updateComponent(doc,p))],
  ['component.detach',object({slideId:identifier,instanceId:identifier}),(doc,p)=>componentOperation(doc,()=>detachComponent(doc,p))],
  ['component.remove',object({componentId:identifier}),(doc,p)=>componentOperation(doc,()=>removeComponent(doc,p))],
  ['document.set_responsive',object({responsive:{anyOf:[{type:'null'},responsiveSchemas.document]}}),(doc,p)=>componentOperation(doc,()=>{if(p.responsive===null)delete doc.responsive;else doc.responsive=p.responsive;})],
  ['element.set_responsive',elementInput({responsive:{anyOf:[{type:'null'},responsiveSchemas.element]}}),(doc,p)=>componentOperation(doc,()=>{const element=ensureEditable(findElement(doc,p.elementId).element);if(p.responsive===null)delete element.responsive;else element.responsive=p.responsive;})],
];
for(const row of definitions)if(['element.delete','elements.delete','slide.delete','slides.delete','layout.delete'].includes(row[0])&&row[2]){const apply=row[2];row[2]=(doc,params)=>{apply(doc,params);pruneUnreferencedVideoAssets(doc);pruneUnreferencedAudioAssets(doc);};}
const registry = new Map(definitions.map(([id, inputSchema, apply, exposure = 'internal']) => [id, { id, inputSchema:withCreationReferences(inputSchema), apply, exposure: apply ? exposure : 'reserved' }]));

/** Reject JS-only values before cloning: getters, functions, cycles, symbols, exotic prototypes. */
function jsonData(input) {
  const ancestors = new Set(); let nodes = 0;
  function visit(value, path, depth) {
    if (++nodes > COMMAND_LIMITS.nodes || depth > COMMAND_LIMITS.depth) reject('LIMIT_EXCEEDED', '명령 구조가 너무 큽니다.', path);
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      if (value.length > COMMAND_LIMITS.bytes) reject('LIMIT_EXCEEDED', '문자열이 너무 큽니다.', path);
      return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'object' || value === null) reject('INVALID_COMMAND', '유한 수를 포함한 JSON 데이터만 허용합니다.', path);
    if (ancestors.has(value)) reject('INVALID_COMMAND', '순환 참조를 허용하지 않습니다.', path);
    const array = Array.isArray(value);
    if (Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype) && !(Object.getPrototypeOf(value) === null && !array))
      reject('INVALID_COMMAND', '일반 JSON 객체가 필요합니다.', path);
    const keys = Reflect.ownKeys(value);
    if (keys.length > COMMAND_LIMITS.nodes || (array && value.length > COMMAND_LIMITS.nodes)) reject('LIMIT_EXCEEDED', '명령 구조가 너무 큽니다.', path);
    if (array && keys.length !== value.length + 1) reject('INVALID_COMMAND', '빈 배열 슬롯을 허용하지 않습니다.', path);
    ancestors.add(value);
    const result = array ? [] : {};
    for (const key of keys) {
      if (array && key === 'length') continue;
      if (typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key)) reject('INVALID_COMMAND', '지원하지 않는 JSON 키입니다.', path);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) reject('INVALID_COMMAND', 'JSON 데이터 속성만 허용합니다.', path);
      if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) reject('INVALID_COMMAND', '배열의 사용자 속성을 허용하지 않습니다.', path);
      result[key] = visit(descriptor.value, `${path}.${key}`, depth + 1);
    }
    ancestors.delete(value);
    return result;
  }
  const copy = visit(input, '$', 0);
  if (new TextEncoder().encode(JSON.stringify(copy)).length > COMMAND_LIMITS.bytes) reject('LIMIT_EXCEEDED', '명령은 256 KiB 이하여야 합니다.');
  return copy;
}

/** Closed JSON Schema subset used by this registry; never interprets code or CSS. */
function validate(value, schema, path) {
  if (schema.anyOf) {
    for (const option of schema.anyOf) { try { validate(value, option, path); return; } catch (error) { if (!(error instanceof ContractError)) throw error; } }
    reject('INVALID_COMMAND', '지원하지 않는 값입니다.', path);
  }
  const type = schema.type;
  const matches = type === 'null' ? value === null : type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value)
    : type === 'array' ? Array.isArray(value) : type === 'integer' ? Number.isSafeInteger(value) : typeof value === type;
  if (!matches) reject('INVALID_COMMAND', `${type} 값이 필요합니다.`, path);
  if (schema.enum && !schema.enum.includes(value)) reject('INVALID_COMMAND', '지원하지 않는 값입니다.', path);
  if (type === 'object') {
    if (!schema.properties) return; // Envelope params are validated against the registry schema next.
    const keys = Object.keys(value);
    for (const key of keys) if (!Object.hasOwn(schema.properties, key)&&!(schema.additionalProperties&&typeof schema.additionalProperties==='object')) reject('INVALID_COMMAND', '알 수 없는 필드입니다.', `${path}.${key}`);
    for (const key of schema.required) if (!Object.hasOwn(value, key)) reject('INVALID_COMMAND', '필수 필드가 없습니다.', `${path}.${key}`);
    if (keys.length < (schema.minProperties ?? 0)) reject('INVALID_COMMAND', '변경할 속성이 필요합니다.', path);
    if(keys.length>(schema.maxProperties??Infinity))reject('INVALID_COMMAND','속성 수 제한을 초과했습니다.',path);
    for (const key of keys) validate(value[key], schema.properties[key]||schema.additionalProperties, `${path}.${key}`);
  } else if (type === 'array') {
    if (value.length > schema.maxItems || value.length < (schema.minItems ?? 0)) reject('INVALID_COMMAND', '항목 수 제한을 초과했습니다.', path);
    value.forEach((entry, index) => validate(entry, schema.items, `${path}[${index}]`));
  } else if (type === 'string') {
    const length = [...value].length; // JSON Schema length counts Unicode code points, not UTF-16 units.
    if (length < (schema.minLength ?? 0) || length > schema.maxLength || (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)))
      reject('INVALID_COMMAND', '문자열 형식 또는 길이가 올바르지 않습니다.', path);
  } else if (type === 'number' || type === 'integer') {
    if ((schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum)
      || (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum)) reject('INVALID_COMMAND', '수의 범위가 올바르지 않습니다.', path);
  }
}
function errorResult(error, commandId) {
  if (!(error instanceof ContractError)&&!error.creationError) throw error; // Do not mask programming failures as user errors.
  return { ok: false, error: { code: error.code, message: error.message, path: error.path, ...(commandId ? { commandId } : {}) } };
}
/** Detached catalog: reserved entries are visible only to local development callers. */
export function getCommandCatalog({ includeReserved = false } = {}) {
  return [...registry.values()].filter(entry => includeReserved || entry.apply).map(({ id, inputSchema, exposure }) => ({
    id, contractVersion: COMMAND_CONTRACT_VERSION, effect: 'document', exposure,
    availability: exposure === 'reserved' ? 'reserved' : 'candidate-only',
    inputSchema: cloneDocument(inputSchema), outputSchema: getCommandResultSchema(),
  }));
}

export function validateCommand(input) {
  let commandId;
  try {
    const command = jsonData(input);
    // Validate envelope separately so the parameter schema comes only from the selected registry entry.
    validate(command, object({ id: identifier, params: { type: 'object' } }), '$');
    commandId = command.id;
    const entry = registry.get(command.id);
    if (!entry) reject('UNKNOWN_COMMAND', '알 수 없는 명령입니다.', '$.id');
    validate(command.params, entry.inputSchema, '$.params');
    if (!entry.apply) reject('COMMAND_RESERVED', '후속 생성 계약으로 예약된 명령입니다.', '$.id');
    return { ok: true, value: command };
  } catch (error) { return errorResult(error, commandId); }
}

/** One aggregate JSON budget, not a separate 256 KiB allowance for every member. */
export function validateCommands(input) {
  let commands;
  try {
    commands = jsonData(input);
    if (!Array.isArray(commands) || commands.length < 1 || commands.length > BATCH_LIMITS.commands)
      reject('INVALID_COMMAND', '1~100개의 문서 명령이 필요합니다.', '$.commands');
  } catch (error) { return errorResult(error); }
  for (let index = 0; index < commands.length; index++) {
    const checked = validateCommand(commands[index]);
    if (!checked.ok) return { ok: false, error: { ...checked.error,
      path: `$.commands[${index}]${checked.error.path.slice(1)}`, commandIndex: index } };
    commands[index] = checked.value;
  }
  return { ok: true, value: commands };
}

/** Serial candidate evaluation only. No store, ID allocation, view, history or external effects. */
export function evaluateCommands(document, input, options={}) {
  const checked = validateCommands(input);
  if (!checked.ok) return checked;
  let candidate;
  try { candidate = normalizeDocument(document); }
  catch { return { ok: false, error: { code: 'INVALID_DOCUMENT', message: '기준 문서가 올바르지 않습니다.', path: '$.document' } }; }
  const creationContext=createCreationContext(candidate,checked.value,options);
  for (let index = 0; index < checked.value.length; index++) {
    const result = evaluateCommand(candidate, checked.value[index],{creationContext});
    if (!result.ok) return { ok: false, error: { ...result.error,
      path: `$.commands[${index}]${result.error.path.slice(1)}`, commandIndex: index } };
    candidate = result.value.document;
  }
  const createdIds=creationContext.result();
  return { ok: true, value: { document: candidate,
    changed: JSON.stringify(normalizeDocument(document)) !== JSON.stringify(candidate),...(Object.keys(createdIds).length?{createdIds}:{}) } };
}

/** Evaluate one command on a detached normalized candidate. Never commits store/history/session state. */
export function evaluateCommand(document, input, options={}) {
  const checked = validateCommand(input);
  if (!checked.ok) return checked;
  const command = checked.value;
  let before;
  try { before = normalizeDocument(document); }
  catch { return { ok: false, error: { code: 'INVALID_DOCUMENT', message: '기준 문서가 올바르지 않습니다.', path: '$.document', commandId: command.id } }; }
  const candidate = cloneDocument(before);
  try {
    const context=options.creationContext??createCreationContext(before,[command],options);
    if(CREATION_COMMANDS.has(command.id)&&context.createdIds.has(command.params.clientRef))reject('INVALID_COMMAND','한 묶음의 clientRef는 중복될 수 없습니다.','$.params.clientRef');
    const params=hasClientReferences(command.params)?resolveCreationReferences(command.params,context.createdIds):command.params;
    const createdId=registry.get(command.id).apply(candidate,params,context);
    if(['element.set_geometry','elements.set_geometry','elements.transform','elements.align','elements.distribute','document.resize_canvas'].includes(command.id)){reconcileDirectCompositions(before,candidate,command);reconcileComponentTransforms(before,candidate);}
    // Any structured insertion can introduce advanced authored fields.
    if(hasAuthoring(candidate)||hasWebAuthoring(candidate))candidate.schemaVersion=AUTHORING_SCHEMA;else if(candidate.schemaVersion===SCENE_SCHEMA||hasScene(candidate)||hasSpatialBehavior(candidate))candidate.schemaVersion=SCENE_SCHEMA;else if(candidate.schemaVersion===BEHAVIOR_SCHEMA||hasBehavior(candidate))candidate.schemaVersion=BEHAVIOR_SCHEMA;else if(hasDesign(candidate)&&candidate.schemaVersion!==BEHAVIOR_SCHEMA)candidate.schemaVersion=DESIGN_SCHEMA;else if(hasAdvancedMotion(candidate))candidate.schemaVersion=ADVANCED_SCHEMA;
    let after;
    try { after = normalizeDocument(candidate); }
    catch (error) { reject('INVALID_COMMAND', error.message, '$.params'); }
    // An extended no-op must not change the schema/version, dirty flag or history.
    if (before.schemaVersion !== after.schemaVersion) {
      const withoutUpgrade = cloneDocument(after); withoutUpgrade.schemaVersion = before.schemaVersion;
      if (JSON.stringify(withoutUpgrade) === JSON.stringify(before)) after = before;
    }
    if(CREATION_COMMANDS.has(command.id))context.declare(command.params.clientRef,createdId);
    return { ok: true, value: { commandId: command.id, document: after, changed: JSON.stringify(before) !== JSON.stringify(after),...(CREATION_COMMANDS.has(command.id)?{createdIds:context.result()}:{}) } };
  } catch (error) { return errorResult(error, command.id); }
}

/** Response document uses the validated legacy or extended workbench schema. */
export function getCommandResultSchema() {
  return { oneOf: [
    object({ ok: { const: true }, value: object({ commandId: identifier, document: { type: 'object', description: 'Normalized html-slide-document / 0.1-draft.1, 0.2-workbench.1, 0.3-motion.1, 0.4-business.1, 0.5-motion.1, 0.12-design.1, 0.13-behavior.1 or 0.14-scene.1; validated by normalizeDocument.' }, changed: { type: 'boolean' },createdIds:{type:'object',properties:{},required:[],additionalProperties:identifier} },['commandId','document','changed']) }),
    object({ ok: { const: false }, error: object({ code: enumeration('INVALID_COMMAND', 'UNKNOWN_COMMAND', 'COMMAND_RESERVED', 'LIMIT_EXCEEDED', 'TARGET_NOT_FOUND', 'TARGET_TYPE_MISMATCH', 'TARGET_LOCKED', 'INVALID_DOCUMENT'), message: string(), path: string(), commandId: identifier }, ['code', 'message', 'path']) }),
  ] };
}
