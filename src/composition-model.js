/** Explicit free-position frames; ordinary groups keep their existing semantics. */
const number={type:'number'},positive={type:'number',exclusiveMinimum:0},id={type:'string',minLength:1,maxLength:256};
export const compositionSchema={type:'object',properties:{children:{type:'array',items:id,minItems:1,maxItems:1000},bounds:{type:'object',properties:{x:number,y:number,width:positive,height:positive},required:['x','y','width','height'],additionalProperties:false}},required:['children','bounds'],additionalProperties:false};
const copy=value=>structuredClone(value),same=(a,b)=>['x','y','width','height'].every(key=>Math.abs(a[key]-b[key])<.0000001);
export function normalizeComposition(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['children','bounds'].includes(key)))throw Error('composition: 자유 배치 프레임을 확인하세요.');
  if(!Array.isArray(value.children)||!value.children.length||value.children.length>1000||new Set(value.children).size!==value.children.length||value.children.some(id=>typeof id!=='string'||!id.trim()||id.length>256))throw Error('composition.children: 중복 없는 개체 목록이 필요합니다.');
  const b=value.bounds;if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(key=>!['x','y','width','height'].includes(key))||['x','y','width','height'].some(key=>!Number.isFinite(b[key]))||b.width<=0||b.height<=0)throw Error('composition.bounds: 유효한 프레임 배치가 필요합니다.');
  return{children:[...value.children],bounds:{...b}};
}
export const containerChildren=element=>element.composition?.children||element.flow?.children||[];
export function compositionDescendants(slide,container){const indexed=new Map(slide.elements.map(e=>[e.id,e])),result=[],seen=new Set(),active=new Set();function visit(id){if(active.has(id))throw Error('프레임 배치에 순환 참조가 있습니다.');if(seen.has(id))return;const element=indexed.get(id);if(!element)throw Error('프레임의 내용 개체가 없습니다.');active.add(id);seen.add(id);result.push(element);for(const child of containerChildren(element))visit(child);active.delete(id);}for(const id of containerChildren(container))visit(id);return result;}
export function compositionRoots(elements){const children=new Set(elements.flatMap(element=>containerChildren(element)));return elements.filter(element=>!children.has(element.id)).map(element=>element.id);}
function transformBounds(b,from,to){const sx=to.width/from.width,sy=to.height/from.height;return{x:to.x+(b.x-from.x)*sx,y:to.y+(b.y-from.y)*sy,width:b.width*sx,height:b.height*sy};}
function transformElement(element,from,to){const sx=to.width/from.width,sy=to.height/from.height;element.geometry=transformBounds(element.geometry,from,to);if(element.composition)element.composition.bounds=transformBounds(element.composition.bounds,from,to);if(element.flow){element.flow.padding*=Math.min(sx,sy);element.flow.gap*=element.flow.direction==='row'?sx:element.flow.direction==='column'?sy:Math.min(sx,sy);}if(element.connector){const point=p=>{p.x=to.x+(p.x-from.x)*sx;p.y=to.y+(p.y-from.y)*sy;};for(const end of['from','to'])if(element.connector[end].point)point(element.connector[end].point);if(element.connector.control)point(element.connector.control);for(const p of element.connector.waypoints||[])point(p);}}
/** Canonical projection after a frame alone is placed by a parent flow or explicit resize. */
export function arrangeComposition(slide,container){
  if(!container.composition)return[];const from=container.composition.bounds,to=container.geometry,descendants=compositionDescendants(slide,container);
  if(!same(from,to))for(const child of descendants)transformElement(child,from,to);container.composition.bounds=copy(to);
  for(const instance of slide.componentInstances||[])if(instance.wrapperId===container.id)instance.frame=copy(to);
  return descendants;
}
/** A direct group transform already changed every member: adopt its frame, never project twice. */
export function reconcileDirectCompositions(before,after,command){
  const params=command.params||{},ids=new Set(params.elementIds||params.updates?.map(item=>item.elementId)||[]);if(command.id==='document.resize_canvas'&&params.policy==='scale')for(const slide of after.slides)for(const element of slide.elements)ids.add(element.id);
  for(const slide of after.slides)for(const wrapper of slide.elements)if(wrapper.composition&&ids.has(wrapper.id)){const descendants=compositionDescendants(slide,wrapper);if(descendants.every(element=>ids.has(element.id))){wrapper.composition.bounds=copy(wrapper.geometry);for(const instance of slide.componentInstances||[])if(instance.wrapperId===wrapper.id)instance.frame=copy(wrapper.geometry);}}
}
export function cleanCompositionReferences(document){for(const slide of [...document.slides,...(document.layouts||[]),...(document.layoutMasters||[]),...(document.componentLibrary||[])]){const ids=new Set(slide.elements.map(e=>e.id));for(const e of slide.elements)if(e.composition){e.composition.children=e.composition.children.filter(id=>id!==e.id&&ids.has(id));if(!e.composition.children.length)delete e.composition;}}}
