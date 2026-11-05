/** Batch-local aliases and deterministic IDs. No author/store/session mutation. */
export const CREATION_COMMANDS = new Set(['slide.create','slide.duplicate','element.create_text','element.create_shape','element.create_image','element.duplicate']);
const scalarReferences = new Set(['elementId','slideId','afterSlideId','targetId','sourceId','panelId','containerId']);
const listReferences = new Set(['elementIds','slideIds','readingOrder','contentIds','children']);
const canonical=value=>JSON.stringify(Array.isArray(value)?value.map(item=>JSON.parse(canonical(item))):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,JSON.parse(canonical(value[key]))])):value);
const fail=(message,path='$')=>{throw Object.assign(Error(message),{creationError:true,code:'INVALID_COMMAND',path});};
export const clientReferenceSchema={type:'object',properties:{$ref:{type:'string',minLength:1,maxLength:256,pattern:'\\S'}},required:['$ref'],additionalProperties:false};

/** Only explicit identity slots receive the alias union; literal content is never rewritten. */
export function withCreationReferences(schema,key='') {
  if(!schema||typeof schema!=='object')return schema;
  if(Array.isArray(schema))return schema.map(value=>withCreationReferences(value,key));
  if(scalarReferences.has(key)&&schema.type==='string')return {anyOf:[schema,clientReferenceSchema]};
  const result={...schema};
  if(schema.properties)result.properties=Object.fromEntries(Object.entries(schema.properties).map(([name,value])=>[name,withCreationReferences(value,name)]));
  if(schema.items)result.items=listReferences.has(key)&&schema.items.type==='string'?{anyOf:[schema.items,clientReferenceSchema]}:withCreationReferences(schema.items);
  for(const union of ['anyOf','oneOf','allOf'])if(schema[union])result[union]=schema[union].map(value=>withCreationReferences(value,key));
  return result;
}
export function hasClientReferences(value) {
  if(!value||typeof value!=='object')return false;
  if(!Array.isArray(value)&&Object.hasOwn(value,'$ref'))return true;
  return Object.values(value).some(hasClientReferences);
}
export function resolveCreationReferences(value,createdIds,key='',path='$.params') {
  if(!value||typeof value!=='object')return value;
  if(!Array.isArray(value)&&Object.hasOwn(value,'$ref')) {
    if(!scalarReferences.has(key)&&!listReferences.has(key))fail('clientRef는 명시적인 개체·슬라이드 ID 참조 위치에서만 사용할 수 있습니다.',path);
    if(Object.keys(value).length!==1||typeof value.$ref!=='string'||!createdIds.has(value.$ref))fail('이 묶음에서 먼저 생성한 clientRef만 참조할 수 있습니다.',path);
    return createdIds.get(value.$ref);
  }
  if(Array.isArray(value))return value.map((item,index)=>resolveCreationReferences(item,createdIds,listReferences.has(key)?key:'',path+'['+index+']'));
  return Object.fromEntries(Object.entries(value).map(([name,item])=>[name,resolveCreationReferences(item,createdIds,name,path+'.'+name)]));
}
function occupied(document) {
  const ids=new Set();
  function visit(value){if(!value||typeof value!=='object')return;if(Array.isArray(value)){value.forEach(visit);return;}for(const[key,item]of Object.entries(value)){if((key==='id'||key==='groupId')&&typeof item==='string')ids.add(item);else if(item&&typeof item==='object')visit(item);}}
  visit(document);return ids;
}
// Local evaluator callers use the same stable input seed for preview and execution.
// Guarded Controller calls supply a cryptographic request seed instead.
function localSeed(document,commands,ids) {
  const text=canonical([document.id,[...ids].sort(),commands]),words=[0x811c9dc5,0x9e3779b9,0x85ebca6b,0xc2b2ae35];
  for(let i=0;i<text.length;i++)for(let j=0;j<words.length;j++)words[j]=Math.imul(words[j]^(text.charCodeAt(i)+j*97),0x01000193+j*2)>>>0;
  return words.map(word=>word.toString(16).padStart(8,'0')).join('');
}
export function createCreationContext(document,commands,{creationSeed}={}) {
  const ids=occupied(document),seed=creationSeed??localSeed(document,commands,ids),createdIds=new Map();let sequence=0;
  if(typeof seed!=='string'||!/^[a-f0-9]{32,64}$/.test(seed))fail('검증된 생성 요청 문맥이 필요합니다.');
  const fresh=prefix=>{let id;do{id=prefix+'-'+seed.slice(0,32)+'-'+(++sequence).toString(36);}while(ids.has(id));ids.add(id);return id;};
  return {createdIds,fresh,declare(clientRef,id){if(createdIds.has(clientRef))fail('한 묶음의 clientRef는 중복될 수 없습니다.','$.params.clientRef');createdIds.set(clientRef,id);},result(){return Object.fromEntries(createdIds);}};
}
/** Same target/revision/operation/command payload means the same preview and commit IDs. */
export async function creationRequestSeed(request) {
  const text=canonical([request.target,request.expectedRevision,request.operationId,request.commands]);
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}
