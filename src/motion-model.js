/** Closed author contracts for motion and interactive HTML. Runtime state is never author data. */
export const MOTION_SCHEMA = '0.3-motion.1';
export const ADVANCED_SCHEMA = '0.5-motion.1';
export const MOTION_PRESETS = ['fadeIn', 'slideInLeft', 'slideInRight', 'slideInUp', 'zoomIn', 'fadeOut', 'slideOutRight', 'pulse', 'spin', 'keyframes'];
export const MOTION_STARTS = ['onClick', 'withPrevious', 'afterPrevious'];
export const MOTION_EASINGS = ['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out'];
const object = (properties, required = Object.keys(properties), extra = {}) => ({ type: 'object', properties, required, additionalProperties: false, ...extra });
const text = (maxLength = 65536) => ({ type: 'string', maxLength });
const identifier = { ...text(256), minLength: 1, pattern: '\\S' };
const enumeration = (...values) => ({ type: 'string', enum: values });
const bounded = (minimum, maximum) => ({ type: 'number', minimum, maximum });
const array = (items, maxItems, minItems = 0) => ({ type: 'array', items, minItems, maxItems });
const nullable = schema => ({ anyOf: [{ type: 'null' }, schema] });
const frame = object({ offset: bounded(0,1), x: bounded(-100000,100000), y: bounded(-100000,100000), scale: bounded(.01,100), rotate: bounded(-36000,36000), opacity: bounded(0,1), blur: bounded(0,100) },['offset']);
const motionFields = { preset: enumeration(...MOTION_PRESETS), start: enumeration(...MOTION_STARTS), duration: bounded(0,60000), delay: bounded(0,60000), easing: enumeration(...MOTION_EASINGS), iterations: {type:'integer',minimum:1,maximum:20}, at: bounded(0,600000), keyframes:array(frame,64,2), stagger:object({by:enumeration('character','word','paragraph'),delay:bounded(0,2000)}) };
const motionRequired=['preset','start','duration','delay','easing','iterations'];
export const motionSchemas = {
  variable: {anyOf:[object({ id: identifier, name: text(256), initialValue: text(256), options: array(object({ value: text(256), label: text(512) }), 128, 1) }),object({id:identifier,name:text(256),kind:enumeration('number'),initialValue:text(256),options:array(object({value:text(256),label:text(512)}),0),minimum:bounded(-1e9,1e9),maximum:bounded(-1e9,1e9),step:bounded(.000001,1e9)})]},
  motion: object({ id: identifier, targetId: identifier, ...motionFields }, ['id','targetId',...motionRequired]),
  transition: object({ type: enumeration('none', 'fade', 'push', 'zoom','wipe','flip'), duration: bounded(0, 10000), easing: enumeration(...MOTION_EASINGS), navigation: enumeration('sequential','interaction') },['type','duration','easing']),
  component: { anyOf: [
    object({ kind: enumeration('button') }),
    object({ kind: enumeration('tabs', 'select','slider'), variableId: identifier }),
    object({ kind: enumeration('panel'), initiallyOpen: { type: 'boolean' }, dim: { type: 'boolean' }, placement: enumeration('left', 'right', 'center'), contentIds: array(identifier, 1000) }, ['kind', 'initiallyOpen', 'dim', 'placement']),
  ] },
  binding: object({ variableId: identifier, values: array(object({ value: text(256), text: text() }), 128), source:enumeration('variable'), format: enumeration('text', 'number'), prefix: text(1024), suffix: text(1024), animate: { type: 'boolean' }, formula:object({operation:enumeration('multiply','add','subtract','divide'),operand:bounded(-1e12,1e12),fallback:text(1024)}) }, ['variableId', 'values', 'format']),
  states:array(object({id:identifier,name:text(256),style:object({fill:{...text(9),pattern:'^#(?:[a-fA-F0-9]{3}|[a-fA-F0-9]{4}|[a-fA-F0-9]{6}|[a-fA-F0-9]{8})$'},color:{...text(9),pattern:'^#(?:[a-fA-F0-9]{3}|[a-fA-F0-9]{4}|[a-fA-F0-9]{6}|[a-fA-F0-9]{8})$'},opacity:bounded(0,1),radius:bounded(0,100000),scale:bounded(.01,100),x:bounded(-100000,100000),y:bounded(-100000,100000),rotate:bounded(-36000,36000),blur:bounded(0,100),shadow:object({x:bounded(-1000,1000),y:bounded(-1000,1000),blur:bounded(0,1000),color:{...text(9),pattern:'^#(?:[a-fA-F0-9]{3}|[a-fA-F0-9]{4}|[a-fA-F0-9]{6}|[a-fA-F0-9]{8})$'}})},[])}),32),
  motionClips:array(object({id:identifier,name:text(256),tracks:array(object({slot:{type:'integer',minimum:0,maximum:999},...motionFields},['slot',...motionRequired]),256,1)}),64),
};
motionSchemas.action = { anyOf: [
  object({ type: enumeration('show', 'hide', 'toggle', 'openPanel', 'closePanel', 'goToSlide'), targetId: identifier }),
  object({ type: enumeration('playMotion'), motionId: identifier }),
  object({ type: enumeration('playVideo','pauseVideo','stopVideo'), targetId: identifier }),
  object({ type: enumeration('openLink'), href: text(2048) }),
  object({ type: enumeration('setVariable'), variableId: identifier, value: text(256) }),
  object({ type: enumeration('addVariable'), variableId: identifier, amount: bounded(-1e9,1e9) }),
  object({ type: enumeration('setState'), targetId:identifier,stateId:identifier }),
  object({ type: enumeration('resetState'), targetId:identifier }),
] };
motionSchemas.interaction = object({ id: identifier, sourceId: identifier, event: enumeration('click', 'hover', 'focus', 'change','key','scroll','inView','leave','blur','ended'), actions: array(motionSchemas.action, 32, 1),trigger:object({key:{...text(1),minLength:1,pattern:'^[a-zA-Z0-9]$'},threshold:bounded(0,1),once:{type:'boolean'},direction:enumeration('up','down')},[]),condition:object({variableId:identifier,operator:enumeration('equals','notEquals','less','lessOrEqual','greater','greaterOrEqual'),value:text(256)}) },['id','sourceId','event','actions']);
motionSchemas.variables = array(motionSchemas.variable, 128);
motionSchemas.motions = array(motionSchemas.motion, 256);
motionSchemas.interactions = array(motionSchemas.interaction, 256);
motionSchemas.nullableComponent = nullable(motionSchemas.component);
motionSchemas.nullableBinding = nullable(motionSchemas.binding);
motionSchemas.nullableTransition = nullable(motionSchemas.transition);
motionSchemas.advanceAfter = nullable(bounded(100, 600000));

function invalid(label) { throw new Error(`${label}: 지원하지 않는 모션/인터랙션 값입니다.`); }
/** Deliberately small JSON-only validation; no expressions, scripts or CSS strings are interpreted. */
export function normalizeMotionValue(value, schema, label = 'motion') {
  if (schema.anyOf) {
    for (const candidate of schema.anyOf) { try { return normalizeMotionValue(value, candidate, label); } catch {} }
    invalid(label);
  }
  if (schema.type === 'null') { if (value !== null) invalid(label); return null; }
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(label);
    const names = Object.keys(value);
    if (names.some(name => !Object.hasOwn(schema.properties, name)) || schema.required.some(name => !Object.hasOwn(value, name))) invalid(label);
    return Object.fromEntries(Object.keys(schema.properties).filter(name => Object.hasOwn(value, name)).map(name => [name, normalizeMotionValue(value[name], schema.properties[name], `${label}.${name}`)]));
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length < schema.minItems || value.length > schema.maxItems) invalid(label);
    return value.map((item, index) => normalizeMotionValue(item, schema.items, `${label}[${index}]`));
  }
  if (schema.type === 'string') {
    if (typeof value !== 'string' || [...value].length < (schema.minLength || 0) || [...value].length > schema.maxLength || schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) invalid(label);
    if (schema.enum && !schema.enum.includes(value)) invalid(label);
    return value.replace(/\r\n?/g, '\n');
  }
  if (schema.type === 'boolean') { if (typeof value !== 'boolean') invalid(label); return value; }
  if (typeof value !== 'number' || !Number.isFinite(value) || schema.type === 'integer' && !Number.isSafeInteger(value) || value < schema.minimum || value > schema.maximum) invalid(label);
  return value;
}

/** Cross-reference validation is shared by import, command candidate evaluation and save. */
export function validateMotionReferences(document, usedIds) {
  const variables = new Map((document.variables || []).map(variable => [variable.id, variable]));
  const unique = (id, label) => { if (usedIds.has(id)) throw new Error(`${label}: 중복 ID ${id}`); usedIds.add(id); };
  for (const variable of document.variables || []) {
    unique(variable.id, 'variable');
    const values = variable.options.map(option => option.value);
    if(variable.kind==='number'){if(variable.maximum<=variable.minimum||variable.step>variable.maximum-variable.minimum||!validVariableValue(variable,variable.initialValue))throw Error('number variable: 유효한 범위·간격과 초기 숫자가 필요합니다.');continue;}
    if (new Set(values).size !== values.length || !values.includes(variable.initialValue)) throw new Error('variable: 중복 없는 선택 값과 유효한 초기 값이 필요합니다.');
  }
  const slideIds = new Set(document.slides.map(slide => slide.id));
  for (const slide of document.slides) {
    const elements = new Map(slide.elements.map(element => [element.id, element]));
    const motions = new Map((slide.motions || []).map(motion => [motion.id, motion]));
    const panelMembers = new Set();
    for (const motion of slide.motions || []) {
      unique(motion.id, 'motion');
      if (!elements.has(motion.targetId)) throw new Error('motion.targetId: 같은 슬라이드의 개체가 필요합니다.');
    }
    for (const element of slide.elements) {
      const component = element.component, binding = element.binding;
      if (component && ['tabs', 'select','slider'].includes(component.kind) && (!variables.has(component.variableId)||variables.get(component.variableId)?.kind==='number'&&component.kind!=='slider')) throw new Error('component.variableId: 변수를 찾을 수 없습니다.');
      if (component?.kind === 'panel') for (const memberId of component.contentIds || []) {
        if (memberId === element.id || !elements.has(memberId) || elements.get(memberId).component?.kind === 'panel' || panelMembers.has(memberId)) throw new Error('panel.contentIds: 중복·중첩 없는 같은 장의 내용 개체가 필요합니다.');
        panelMembers.add(memberId);
      }
      if (binding) {
        const variable = variables.get(binding.variableId), values = binding.values.map(row => row.value);
        const numeric=variable?.kind==='number';
        if(!element.text||!variable||(numeric?binding.source!=='variable'||binding.format!=='number'||values.length!==0:binding.source!==undefined||new Set(values).size!==values.length||variable.options.length!==values.length||variable.options.some(option=>!values.includes(option.value))))throw new Error('binding: 텍스트 개체와 변수 종류에 맞는 연결이 필요합니다.');
        if (binding.format === 'number' && !binding.formula && binding.values.some(row => !row.text.trim() || !Number.isFinite(Number(row.text)))) throw new Error('binding: 숫자 표에는 유한 수가 필요합니다.');
      }
    }
    for (const interaction of slide.interactions || []) {
      unique(interaction.id, 'interaction');
      if (!elements.has(interaction.sourceId)) throw new Error('interaction.sourceId: 같은 슬라이드의 개체가 필요합니다.');
      const navigation = interaction.actions.findIndex(action => action.type === 'goToSlide');
      if (navigation >= 0 && navigation !== interaction.actions.length - 1) throw new Error('goToSlide: 장 이동은 동작 목록의 마지막에 한 번만 배치해 주세요.');
      if(interaction.event==='ended'&&elements.get(interaction.sourceId)?.type!=='video')throw Error('ended: 동영상 개체가 필요합니다.');
      for (const action of interaction.actions) {
        if (action.type === 'goToSlide') { if (!slideIds.has(action.targetId)) throw new Error('goToSlide: 슬라이드를 찾을 수 없습니다.'); }
        else if (action.type === 'playMotion') { if (!motions.has(action.motionId)) throw new Error('playMotion: 같은 슬라이드의 효과를 찾을 수 없습니다.'); }
        else if (action.type === 'setVariable') { if (!validVariableValue(variables.get(action.variableId),action.value)) throw new Error('setVariable: 변수 선택 값이 올바르지 않습니다.'); }
        else if(action.type==='addVariable'){if(variables.get(action.variableId)?.kind!=='number')throw Error('addVariable: 숫자 변수가 필요합니다.');}
        else if(action.type==='openLink'){if(!validExternalLink(action.href))throw Error('openLink: http·https·mailto 링크가 필요합니다.');}
        else if(['playVideo','pauseVideo','stopVideo'].includes(action.type)){if(elements.get(action.targetId)?.type!=='video')throw Error('동영상 제어: 같은 장의 동영상이 필요합니다.');}
        else {
          const target = elements.get(action.targetId);
          if (!target || ['openPanel', 'closePanel'].includes(action.type) && target.component?.kind !== 'panel') throw new Error('action.targetId: 같은 장의 유효한 대상 개체가 필요합니다.');
        }
      }
    }
  }
}

/** Deletion removes only affected author links; it never leaves dangling targets in a saved document. */
export function cleanMotionReferences(document) {
  const variables = new Map((document.variables || []).map(variable => [variable.id, variable]));
  const slideIds = new Set(document.slides.map(slide => slide.id));
  for (const slide of document.slides) {
    const elements = new Map(slide.elements.map(element => [element.id, element]));
    if (slide.motions) slide.motions = slide.motions.filter(motion => elements.has(motion.targetId));
    const motionIds = new Set((slide.motions || []).map(motion => motion.id));
    for (const element of slide.elements) {
      if (element.component?.kind === 'panel' && element.component.contentIds) element.component.contentIds = element.component.contentIds.filter(id => elements.has(id));
      if (['tabs', 'select','slider'].includes(element.component?.kind) && (!variables.has(element.component.variableId)||variables.get(element.component.variableId)?.kind==='number'&&element.component.kind!=='slider')) delete element.component;
      if (element.binding && (!variables.has(element.binding.variableId)||(variables.get(element.binding.variableId)?.kind==='number')!==(element.binding.source==='variable'))) delete element.binding;
    }
    if (slide.interactions) slide.interactions = slide.interactions.flatMap(interaction => {
      if (!elements.has(interaction.sourceId)||interaction.event==='ended'&&elements.get(interaction.sourceId)?.type!=='video') return [];
      const actions = interaction.actions.filter(action => action.type === 'goToSlide' ? slideIds.has(action.targetId) : action.type === 'playMotion' ? motionIds.has(action.motionId) : action.type === 'setVariable' ? validVariableValue(variables.get(action.variableId),action.value) : action.type==='addVariable'?variables.get(action.variableId)?.kind==='number':action.type==='openLink'?validExternalLink(action.href):['playVideo','pauseVideo','stopVideo'].includes(action.type)?elements.get(action.targetId)?.type==='video': elements.has(action.targetId) && (!['openPanel', 'closePanel'].includes(action.type) || elements.get(action.targetId).component?.kind === 'panel'));
      return actions.length ? [{ ...interaction, actions }] : [];
    });
  }
}

/** A numeric variable remains bounded data; no expression or code is evaluated. */
export function validVariableValue(variable,value){
 if(!variable)return false;if(variable.kind!=='number')return variable.options.some(o=>o.value===value);
 if(typeof value!=='string'||!value.trim()||!Number.isFinite(Number(value)))return false;const n=Number(value),steps=(n-variable.minimum)/variable.step;
 return n>=variable.minimum&&n<=variable.maximum&&Math.abs(steps-Math.round(steps))<=Math.max(1e-7,Math.abs(steps)*Number.EPSILON*8);
}
export function numericVariableValue(variable,value){if(variable?.kind!=='number'||!Number.isFinite(Number(value)))return null;const count=Math.max(0,Math.min(Math.floor((variable.maximum-variable.minimum)/variable.step+1e-7),Math.round((Number(value)-variable.minimum)/variable.step)));return String(Math.max(variable.minimum,Math.min(variable.maximum,Number((variable.minimum+count*variable.step).toPrecision(15)))));}
export function validCondition(condition,variable){if(!condition||!variable)return false;if(variable.kind!=='number')return ['equals','notEquals'].includes(condition.operator)&&validVariableValue(variable,condition.value);return typeof condition.value==='string'&&!!condition.value.trim()&&Number.isFinite(Number(condition.value))&&Math.abs(Number(condition.value))<=1e9;}

/** External URL data only; internal routes use goToSlide IDs. */
export function validExternalLink(href){if(typeof href!=='string'||!href||href.length>2048||/[\u0000-\u0020\u007f]/u.test(href))return false;try{const url=new URL(href);return ['http:','https:','mailto:'].includes(url.protocol)&&!url.username&&!url.password;}catch{return false;}}
