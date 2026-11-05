/** Declarative web controls. Form values use the existing behavior variables at runtime. */
import {normalizeMotionValue} from './motion-model.js';
const object=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const text=(maxLength=256)=>({type:'string',maxLength}),id={...text(),minLength:1,pattern:'\\S'},list=(items,maxItems)=>({type:'array',items,maxItems});
const choice=(...values)=>({type:'string',enum:values});
const field=object({key:{...text(80),minLength:1,pattern:'^[a-zA-Z][a-zA-Z0-9_-]*$'},variableId:id,label:{...text(160),minLength:1},type:choice('text','textarea','email','number','checkbox','select'),required:{type:'boolean'},maxLength:{type:'integer',minimum:1,maximum:4096},placeholder:text(512)},['key','variableId','label','type']);
const form=object({id,name:{...text(160),minLength:1},persistence:choice('none','local','session'),fields:{...list(field,32),minItems:1}},['id','name','persistence','fields']);
export const webSchemas={forms:list(form,32),control:{anyOf:[
  object({kind:choice('formAction'),formId:id,action:choice('save','export','reset'),closePanelId:id},['kind','formId','action']),
  object({kind:choice('filterButton','filterItem'),group:{...text(80),minLength:1},value:{...text(160),minLength:1}}),
  object({kind:choice('scrollLink'),targetId:id}),
  object({kind:choice('emailLink'),formId:id,variableId:id,emptyPanelId:id},['kind','formId','variableId']),
]}};
export const normalizeWebForms=value=>normalizeMotionValue(value,webSchemas.forms,'webForms');
export const normalizeWebControl=value=>normalizeMotionValue(value,webSchemas.control,'web');
export function validateWebFormVariables(document,forms){
  const variables=new Map((document.behavior?.variables||[]).map(v=>[v.id,v])),formIds=new Set();
  for(const form of forms){
    if(formIds.has(form.id))throw Error('입력 폼 ID가 중복됩니다.');formIds.add(form.id);
    const keys=new Set(),ids=new Set();
    for(const field of form.fields){const variable=variables.get(field.variableId),type={number:'number',checkbox:'boolean',select:'choice'}[field.type]||'text';
      if(!variable||variable.type!==type)throw Error('폼 입력과 동작 변수의 종류가 다릅니다: '+field.label);
      if(keys.has(field.key)||ids.has(field.variableId))throw Error('폼의 필드 키와 변수는 중복할 수 없습니다.');keys.add(field.key);ids.add(field.variableId);
    }
  }
}
export function validateWebReferences(document,usedIds){
  validateWebFormVariables(document,document.webForms||[]);
  const variables=new Map((document.behavior?.variables||[]).map(v=>[v.id,v])),forms=new Map();
  for(const form of document.webForms||[]){
    if(forms.has(form.id)||usedIds?.has(form.id))throw Error('입력 폼 ID가 중복됩니다: '+form.id);
    usedIds?.add(form.id);forms.set(form.id,form);
    const keys=new Set(),ids=new Set();
    for(const field of form.fields){const variable=variables.get(field.variableId),type={number:'number',checkbox:'boolean',select:'choice'}[field.type]||'text';
      if(!variable||variable.type!==type)throw Error('폼 입력과 동작 변수의 종류가 다릅니다: '+field.label);
      if(keys.has(field.key)||ids.has(field.variableId))throw Error('폼의 필드 키와 변수는 중복할 수 없습니다.');
      keys.add(field.key);ids.add(field.variableId);
    }
  }
  const slides=[...document.slides,...(document.layouts||[]),...(document.layoutMasters||[])],elements=new Map(slides.flatMap(s=>s.elements.map(e=>[e.id,e])));
  for(const slide of slides)for(const e of slide.elements){const web=e.web;if(!web)continue;
    if(web.formId&&!forms.has(web.formId))throw Error('웹 동작의 입력 폼을 찾을 수 없습니다.');
    if(web.kind==='emailLink'&&(!forms.get(web.formId).fields.some(f=>f.variableId===web.variableId&&f.type==='email')))throw Error('이메일 연결은 폼의 이메일 입력을 선택하세요.');
    if(web.kind==='scrollLink'&&!elements.has(web.targetId))throw Error('이동할 개체를 찾을 수 없습니다.');
    for(const key of ['closePanelId','emptyPanelId'])if(web[key]&&!slide.elements.some(e=>e.id===web[key]&&e.component?.kind==='panel'))throw Error('같은 장의 패널을 선택하세요.');
  }
}
export function cleanWebReferences(document){
  const variables=new Set((document.behavior?.variables||[]).map(v=>v.id));
  if(document.webForms)document.webForms=document.webForms.map(f=>({...f,fields:f.fields.filter(field=>variables.has(field.variableId))})).filter(f=>f.fields.length);
  const forms=new Set((document.webForms||[]).map(f=>f.id)),slides=[...document.slides,...(document.layouts||[]),...(document.layoutMasters||[])],ids=new Set(slides.flatMap(s=>s.elements.map(e=>e.id)));
  for(const slide of slides)for(const e of slide.elements)if(e.web){const web=e.web;if(web.formId&&!forms.has(web.formId)||web.targetId&&!ids.has(web.targetId)||web.variableId&&!variables.has(web.variableId)){delete e.web;continue;}for(const key of ['closePanelId','emptyPanelId'])if(web[key]&&!slide.elements.some(e=>e.id===web[key]&&e.component?.kind==='panel'))delete web[key];}
}
export const webFieldForVariable=(document,variableId)=>(document.webForms||[]).flatMap(form=>form.fields).find(field=>field.variableId===variableId);
export const hasWebAuthoring=document=>document.webForms!==undefined||[...document.slides,...(document.layouts||[]),...(document.layoutMasters||[])].some(slide=>slide.elements.some(e=>e.web!==undefined));
