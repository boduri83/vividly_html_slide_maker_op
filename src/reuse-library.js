/** Detached, append-only reuse planning. File access and approval belong to the local UI. */
import {normalizeDocument} from './model.js';
import {parse,walk,generate} from '../assets/vendor/css-tree.js';
import {compositeIds,remapComposite} from './component-library-model.js';
import {resolveLayout} from './master-model.js';
import {collectReuseDependencies} from './reuse-dependencies.js';
import {validateWebFormVariables,validateWebReferences} from './web-authoring-model.js';

const clone=value=>structuredClone(value);
const fail=message=>{throw Object.assign(Error(message),{code:'INVALID_LIBRARY_IMPORT'});};
const categories=['masters','layouts','components','recipes','tokens','assets','clips','behaviorVariables'];
const fields={masters:'layoutMasters',layouts:'layouts',recipes:'styleRecipes',tokens:'styleTokens',assets:'assets',variables:'variables',components:'componentLibrary',clips:'motionClips',behaviorVariables:'behaviorVariables',forms:'webForms',slides:'slides'};
const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const equal=(a,b)=>canonical(a)===canonical(b);
function retainedOverride(source,current,after){if(equal(source,current))return false;if(source&&current&&typeof source==='object'&&typeof current==='object'&&!Array.isArray(source)&&!Array.isArray(current))return [...new Set([...Object.keys(source),...Object.keys(current)])].some(key=>retainedOverride(source[key],current[key],after?.[key]));return equal(current,after);}
const imageTypes=new Set(['image/png','image/jpeg','image/webp','image/gif']);
const idFields=new Set(['id','groupId','elementId','targetId','sourceId','panelId','stateId','seriesId','motionId','contentIds','children','placeholderIds']);

function hash(value){let a=2166136261,b=2246822519;for(const char of canonical(value)){a=Math.imul(a^char.charCodeAt(0),16777619)>>>0;b=Math.imul(b^char.charCodeAt(0),3266489917)>>>0;}return a.toString(36)+'-'+b.toString(36);}
function occupiedIds(document){const ids=new Set();const visit=value=>{if(!value||typeof value!=='object')return;if(typeof value.id==='string')ids.add(value.id);if(typeof value.groupId==='string')ids.add(value.groupId);Object.values(value).forEach(visit);};visit(document);return ids;}
function allocate(base,occupied){let id=base,n=1;while(occupied.has(id))id=base+'-'+(++n);occupied.add(id);return id;}
function uniqueName(name,collection){const used=new Set(collection.map(item=>item.name));if(!used.has(name))return name;let n=1,value;do{value=name.slice(0,140)+` (가져옴 ${n++})`;}while(used.has(value));return value;}
function stripIdentity(item){const result=clone(item);delete result.id;delete result.name;delete result.version;return result;}
function localIds(elements){const ids=new Set();const visit=value=>{if(!value||typeof value!=='object')return;if(typeof value.id==='string')ids.add(value.id);if(typeof value.groupId==='string')ids.add(value.groupId);Object.values(value).forEach(visit);};elements.forEach(visit);return [...ids];}
function remapLocal(value,map,key=''){if(Array.isArray(value))return value.map(item=>remapLocal(item,map,key));if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([name,item])=>[name,remapLocal(item,map,name)]));return typeof value==='string'&&idFields.has(key)&&map.has(value)?map.get(value):value;}
function prototypeLocalIds(item){return [...compositeIds({elements:item.elements,motions:item.motions,interactions:item.interactions,behavior:item.behavior})];}
function prototypeKey(item){const map=new Map(prototypeLocalIds(item).map((id,index)=>[id,'@'+index]));return canonical(remapComposite(stripIdentity(item),map));}

function cssValue(value,map){const ast=parse(value,{context:'value'}),refs=new Set();walk(ast,node=>{if(node.type==='Function'&&node.name.toLowerCase()==='var'){const name=node.children.first;if(name?.type==='Identifier'&&name.name.startsWith('--v-')){const id=name.name.slice(4);refs.add(id);if(map?.has(id))name.name='--v-'+map.get(id);}}});return {value:generate(ast),refs};}
function designCss(value,callback){if(!value||typeof value!=='object')return;for(const [key,item] of Object.entries(value)){if(key==='css'&&item&&typeof item==='object'&&!Array.isArray(item)){for(const [property,v] of Object.entries(item))item[property]=callback(v);}else if(item&&typeof item==='object')designCss(item,callback);}}
function prototypeDependencies(item,source){const refs={recipes:new Set(),assets:new Set(),variables:new Set(),behaviorVariables:new Set(),tokens:new Set(),clips:new Set()};const variable=id=>{if(source.behaviorVariables.some(v=>v.id===id))refs.behaviorVariables.add(id);else refs.variables.add(id);};function scan(value){if(!value||typeof value!=='object')return;for(const[key,item]of Object.entries(value)){if((key==='variableId'||key==='id'&&value.type==='variable')&&typeof item==='string')variable(item);if(key==='clipId'&&typeof item==='string'&&(source.motionClips||[]).some(clip=>clip.id===item))refs.clips.add(item);if(item&&typeof item==='object')scan(item);}}scan(item);for(const element of item.elements){if(element.design?.recipeId)refs.recipes.add(element.design.recipeId);if(element.assetId)refs.assets.add(element.assetId);if(element.video?.posterAssetId)refs.assets.add(element.video.posterAssetId);for(const id of [element.component?.variableId,element.binding?.variableId,element.chart?.variants?.variableId])if(id)variable(id);if(element.design)designCss(clone(element.design),v=>{cssValue(v).refs.forEach(id=>refs.tokens.add(id));return v;});}return refs;}
function freezeSourceTheme(element,theme){if(!element.themeRefs)return;const refs=element.themeRefs;if(refs.fill)element.fill=theme.colors[refs.fill];if(refs.textColor)element.text.textStyle.color=theme.colors[refs.textColor];if(refs.fontFamily)element.text.textStyle.fontFamily=element.semanticRole==='heading'?(theme.headingFontFamily||theme.fontFamily):theme.fontFamily;delete element.themeRefs;}
function transformPrototype(item,maps,theme){const result=remapComposite(item,new Map([...maps.variables,...maps.behaviorVariables]));if(result.masterId)result.masterId=maps.masters.get(result.masterId);for(const element of result.elements){freezeSourceTheme(element,theme);if(element.assetId)element.assetId=maps.assets.get(element.assetId);if(element.video?.posterAssetId)element.video.posterAssetId=maps.assets.get(element.video.posterAssetId);if(element.design?.recipeId)element.design.recipeId=maps.recipes.get(element.design.recipeId);if(element.design)designCss(element.design,v=>cssValue(v,maps.tokens).value);if(element.component?.variableId)element.component.variableId=maps.variables.get(element.component.variableId)||maps.behaviorVariables.get(element.component.variableId)||element.component.variableId;if(element.binding?.variableId)element.binding.variableId=maps.variables.get(element.binding.variableId)||maps.behaviorVariables.get(element.binding.variableId)||element.binding.variableId;if(element.chart?.variants?.variableId)element.chart.variants.variableId=maps.variables.get(element.chart.variants.variableId)||maps.behaviorVariables.get(element.chart.variants.variableId)||element.chart.variants.variableId;}for(const motion of result.motions||[])if(motion.clipId)motion.clipId=maps.clips.get(motion.clipId);for(const interaction of result.interactions||[]){if(interaction.condition?.variableId)interaction.condition.variableId=maps.variables.get(interaction.condition.variableId)||interaction.condition.variableId;for(const action of interaction.actions)if(action.variableId)action.variableId=maps.variables.get(action.variableId)||action.variableId;}return result;}

function selectionIds(selection,key,collection){const values=selection[key]??[];if(!Array.isArray(values)||values.length>1000||new Set(values).size!==values.length||values.some(id=>typeof id!=='string'||!collection.some(item=>item.id===id)))fail('가져올 항목을 원본 목록에서 선택하세요: '+key);return new Set(values);}
function assertSourceInstanceMaps(original,normalized){for(const page of original.slides||[])for(const instance of page.componentInstances||[]){const after=normalized.slides.find(row=>row.id===page.id)?.componentInstances?.find(row=>row.id===instance.id);if(!after)fail('원본 페이지의 컴포넌트 연결이 올바르지 않습니다.');for(const field of ['elementMap','motionMap','interactionMap','behaviorMap','idMap'])for(const[from,to]of Object.entries(instance[field]||{}))if(after[field]?.[from]!==to)fail('원본 컴포넌트에서 누락된 개체/동작 연결을 먼저 확인하세요.');}}

/** No source provenance or opaque byte payload is written into public command params. */
export function prepareLibraryImport(targetDocument,sourceDocument,selection={}){
  if(!selection||typeof selection!=='object'||Array.isArray(selection)||Object.keys(selection).some(key=>!['masterIds','layoutIds','componentIds','recipeIds','assetIds','slideIds','formIds'].includes(key)))fail('지원하지 않는 라이브러리 선택 필드입니다.');
  const target=normalizeDocument(targetDocument),source=normalizeDocument(sourceDocument);target.behaviorVariables=target.behavior?.variables||[];source.behaviorVariables=source.behavior?.variables||[];
  assertSourceInstanceMaps(sourceDocument,source);
  if(source.assets.reduce((bytes,asset)=>bytes+asset.bytes,0)>100*1024*1024)fail('원본 자산 합계는 100MiB 이하로 선택하세요.');
  const closure=collectReuseDependencies(source,selection),required={...closure.required,tokens:new Set()};
  if(!Object.values(required).some(set=>set.size))fail('가져올 항목을 하나 이상 선택하세요.');
  for(const id of selection.assetIds||[])if(!imageTypes.has(source.assets.find(asset=>asset.id===id).mimeType))fail('자산 보관함에는 이미지 자산을 선택하세요.');
  for(const category of ['masters','layouts','components','slides'])for(const item of source[fields[category]]||[])if(required[category].has(item.id)){
    const dependencies=prototypeDependencies(item,source);for(const[kind,ids]of Object.entries(dependencies))ids.forEach(id=>required[kind].add(id));
  }
  for(const recipe of source.styleRecipes||[])if(required.recipes.has(recipe.id))designCss(clone(recipe),v=>{cssValue(v).refs.forEach(id=>required.tokens.add(id));return v;});
  const tokenIndex=new Map((source.styleTokens||[]).map(token=>[token.id,token])),orderedTokens=[],visited=new Set();
  function visitToken(id){if(visited.has(id))return;visited.add(id);const token=tokenIndex.get(id);if(!token)fail('스타일에 필요한 토큰이 없습니다: '+id);for(const dependency of cssValue(token.value).refs){required.tokens.add(dependency);visitToken(dependency);}orderedTokens.push(token);}
  for(const id of required.tokens)visitToken(id);
  const extraCategories=['forms','slides'].filter(key=>required[key].size),activeCategories=[...categories,...extraCategories],allCategories=[...categories,'variables','forms','slides'];
  const selectionKeys={components:'componentIds',masters:'masterIds',layouts:'layoutIds',recipes:'recipeIds',assets:'assetIds',forms:'formIds',slides:'slideIds'};
  const selected=Object.fromEntries(Object.entries(selectionKeys).filter(([key])=>!['forms','slides'].includes(key)||extraCategories.includes(key)).map(([key,field])=>[key,selection[field]?.length||0]));
  const sourcePages=source.slides.filter(page=>required.slides.has(page.id));
  // Stable author graph IDs make repeat imports idempotent without stored provenance.
  // A modified page causes a fresh entire page graph, never an overwrite or accidental ID binding.
  const graphKey=hash([source.id,source.canvas,source.theme,source.master,Object.entries(required).filter(([key])=>key!=='assets'&&key!=='tokens').map(([key,ids])=>[key,(source[fields[key]]||[]).filter(row=>ids.has(row.id))])]);
  for(let pageAttempt=0;pageAttempt<=target.slides.length+1;pageAttempt++){
    const occupied=occupiedIds(target),maps=Object.fromEntries(allCategories.map(key=>[key,new Map()])),additions=Object.fromEntries(allCategories.map(key=>[key,[]])),reused=Object.fromEntries(activeCategories.map(key=>[key,0]));maps.elements=new Map();maps.prototypeElements=new Map();
    let pageCollision=false;
    for(const page of sourcePages){
      const pageId='reuse-page-'+hash([graphKey,page.id,pageAttempt]),existing=target.slides.find(row=>row.id===pageId),owned=existing?compositeIds(existing):new Set();
      if(occupied.has(pageId)&&!existing){pageCollision=true;break;}maps.slides.set(page.id,pageId);occupied.add(pageId);
      for(const sourceId of compositeIds(page))if(sourceId!==page.id){const localId='reuse-page-object-'+hash([pageId,sourceId]);if(occupied.has(localId)&&!owned.has(localId)){pageCollision=true;break;}occupied.add(localId);maps.elements.set(sourceId,localId);}
      if(pageCollision)break;
    }
    if(pageCollision)continue;
    function importItem(category,item,prepared=item,{isolated=false}={}){
      const collection=[...(target[fields[category]]||[]),...additions[category]],isPrototype=['masters','layouts','components'].includes(category),key=isPrototype?prototypeKey(prepared):canonical(stripIdentity(prepared));
      const base=(isolated?'reuse-form-variable-':'reuse-'+category+'-')+hash(isolated?[source.id,item.id,key]:[item.id,key]);
      const known=collection.find(candidate=>(!isolated||candidate.id===base||candidate.id.startsWith(base+'-'))&&(isPrototype?prototypeKey(candidate):canonical(stripIdentity(candidate)))===key);
      const registerLocals=(original,mapped)=>{const from=prototypeLocalIds(original),to=prototypeLocalIds(mapped);maps.prototypeElements.set(category+':'+item.id,new Map(from.map((id,index)=>[id,to[index]])));};
      if(known){maps[category].set(item.id,known.id);if(reused[category]!==undefined)reused[category]++;if(isPrototype)registerLocals(prepared,known);return;}
      const result=clone(prepared),id=allocate(base,occupied);maps[category].set(item.id,id);result.id=id;if(result.name!==undefined)result.name=uniqueName(result.name,collection);
      if(isPrototype){const ids=new Map(prototypeLocalIds(result).map((sourceId,index)=>[sourceId,allocate('reuse-object-'+hash([id,sourceId,index]),occupied)])),mapped=remapComposite(result,ids);mapped.id=id;mapped.version=1;additions[category].push(mapped);registerLocals(prepared,mapped);}else additions[category].push(result);
    }
    for(const clip of source.motionClips||[])if(required.clips.has(clip.id))importItem('clips',clip);
    if(maps.clips.size!==required.clips.size)fail('컴포넌트가 사용하는 모션 씬을 찾을 수 없습니다.');
    for(const asset of source.assets)if(required.assets.has(asset.id))importItem('assets',asset);
    const privateVariables=new Set((source.webForms||[]).filter(form=>required.forms.has(form.id)).flatMap(form=>form.fields.map(field=>field.variableId)));
    for(const variable of source.behaviorVariables)if(required.behaviorVariables.has(variable.id))importItem('behaviorVariables',variable,variable,{isolated:privateVariables.has(variable.id)});
    if(maps.behaviorVariables.size!==required.behaviorVariables.size)fail('컴포넌트가 사용하는 동작 변수를 찾을 수 없습니다.');
    for(const variable of source.variables||[])if(required.variables.has(variable.id))importItem('variables',variable);
    if(maps.variables.size!==required.variables.size)fail('레이아웃에서 사용하는 변수가 없습니다.');
    for(const form of source.webForms||[])if(required.forms.has(form.id))importItem('forms',form,remapComposite(form,maps.behaviorVariables));
    for(const token of orderedTokens)importItem('tokens',token,{...token,value:cssValue(token.value,maps.tokens).value});
    for(const recipe of source.styleRecipes||[])if(required.recipes.has(recipe.id)){const prepared=clone(recipe);designCss(prepared,v=>cssValue(v,maps.tokens).value);importItem('recipes',recipe,prepared);}
    for(const category of ['masters','layouts','components'])for(const item of source[fields[category]]||[])if(required[category].has(item.id)){
      const prepared=transformPrototype(item,maps,source.theme),local=new Set(prototypeLocalIds(item)),externalMap=new Map([...maps.forms,...maps.slides,...maps.clips,...maps.elements].filter(([id])=>!local.has(id)));
      importItem(category,item,remapComposite(prepared,externalMap));
    }
    const mapping=new Map([...maps.variables,...maps.behaviorVariables,...maps.assets,...maps.recipes,...maps.clips,...maps.forms,...maps.masters,...maps.layouts,...maps.components,...maps.elements,...maps.slides]);
    for(const page of sourcePages){
      const prepared=clone(page);for(const element of prepared.elements){freezeSourceTheme(element,source.theme);if(element.design)designCss(element.design,v=>cssValue(v,maps.tokens).value);}
      if(source.master)prepared.masterOverride={...clone(source.master),...(prepared.masterOverride||{})};
      const mapped=remapComposite(prepared,mapping);
      if(page.layout){const layout=source.layouts.find(row=>row.id===page.layout.layoutId),keys=new Map([...(maps.prototypeElements.get('masters:'+layout.masterId)||[]),...(maps.prototypeElements.get('layouts:'+layout.id)||[])]);mapped.layout.elementMap=Object.fromEntries(Object.entries(page.layout.elementMap).map(([from,to])=>[keys.get(from)||from,maps.elements.get(to)||to]));}
      for(let index=0;index<(page.componentInstances||[]).length;index++){const original=page.componentInstances[index],keys=maps.prototypeElements.get('components:'+original.componentId)||new Map(),instance=mapped.componentInstances[index];for(const field of ['elementMap','motionMap','interactionMap','behaviorMap','idMap'])if(original[field])instance[field]=Object.fromEntries(Object.entries(original[field]).map(([from,to])=>[keys.get(from)||from,maps.elements.get(to)||to]));}
      if(mapped.layout)mapped.layout.version=(additions.layouts.find(row=>row.id===mapped.layout.layoutId)||target.layouts?.find(row=>row.id===mapped.layout.layoutId))?.version||mapped.layout.version;
      for(const instance of mapped.componentInstances||[])instance.version=(additions.components.find(row=>row.id===instance.componentId)||target.componentLibrary?.find(row=>row.id===instance.componentId))?.version||instance.version;
      const existing=target.slides.find(row=>row.id===mapped.id);
      if(existing&&!equal(existing,mapped)){pageCollision=true;break;}
      if(existing)reused.slides++;else additions.slides.push(mapped);
    }
    if(pageCollision)continue;
    const params={...(additions.components.length?{componentLibrary:additions.components}:{}),...(additions.clips.length?{motionClips:additions.clips}:{}),...(additions.behaviorVariables.length?{behaviorVariables:additions.behaviorVariables}:{}),...(additions.forms.length?{webForms:additions.forms}:{}),...(additions.slides.length?{slides:additions.slides}:{}),layoutMasters:additions.masters,layouts:additions.layouts,styleRecipes:additions.recipes,styleTokens:additions.tokens,assetIds:[...new Set(maps.assets.values())],...(additions.variables.length?{variables:additions.variables}:{})};
    const summary={added:Object.fromEntries(activeCategories.map(key=>[key,additions[key].length])),reused,selected,dependencies:Object.fromEntries(activeCategories.map(key=>[key,Math.max(0,required[key].size-(selected[key]||0))])),requiredItems:closure.requiredItems};
    return{params,assets:additions.assets,summary,mapping:Object.fromEntries([...activeCategories,'elements'].map(key=>[key,Object.fromEntries(maps[key])]))};
  }
  fail('변경한 기존 페이지를 덮어쓰지 않고 연결 페이지를 배치할 수 없습니다.');
}

/** Append a whole dependency graph before final validation; no cleanup can erase imported links. */
export function appendLibraryImport(document,params){
  const occupied=occupiedIds(document),appendCategories=['masters','layouts','components','recipes','tokens','variables','clips','behaviorVariables','forms','slides'];
  for(const category of appendCategories)for(const item of params[fields[category]]||[]){if(occupied.has(item.id))fail('기존 문서 ID를 덮어쓸 수 없습니다: '+item.id);occupied.add(item.id);}
  for(const id of params.assetIds)if(!document.assets.some(asset=>asset.id===id))fail('승인되거나 이미 문서에 있는 자산을 선택하세요: '+id);
  for(const category of appendCategories)if(params[fields[category]]?.length){
    if(category==='behaviorVariables'){document.behavior||={variables:[]};document.behavior.variables.push(...clone(params.behaviorVariables));}
    else if(category==='slides')document.slides.splice(Math.min(params.slideIndex??document.slides.length,document.slides.length),0,...clone(params.slides));
    else{document[fields[category]]||=[];document[fields[category]].push(...clone(params[fields[category]]));}
  }
  validateWebFormVariables(document,params.webForms||[]);validateWebReferences(document);
  // Ordinary delete/cleanup may prune stale instance maps. Imported metadata must not.
  for(const page of params.slides||[]){
    const present=compositeIds(page),elements=new Set(page.elements.map(element=>element.id));
    if(page.layout){const layout=document.layouts?.find(row=>row.id===page.layout.layoutId);if(!layout)fail('가져온 페이지의 유형을 찾을 수 없습니다.');const sources=new Set(resolveLayout(document,layout).elements.map(element=>element.id));for(const[from,to]of Object.entries(page.layout.elementMap))if(!sources.has(from)||!elements.has(to))fail('가져온 페이지 유형의 개체 연결이 올바르지 않습니다.');}
    for(const instance of page.componentInstances||[]){
      const definition=document.componentLibrary?.find(row=>row.id===instance.componentId);if(!definition)fail('가져온 페이지의 컴포넌트 원본을 찾을 수 없습니다.');
      const source=compositeIds({elements:definition.elements,motions:definition.motions,interactions:definition.interactions,behavior:definition.behavior});
      const owned={elementMap:new Set(definition.elements.map(element=>element.id)),motionMap:new Set((definition.motions||[]).map(row=>row.id)),interactionMap:new Set((definition.interactions||[]).map(row=>row.id)),behaviorMap:compositeIds(definition.behavior),idMap:source};
      for(const[field,allowed]of Object.entries(owned))for(const[from,to]of Object.entries(instance[field]||{}))if(!allowed.has(from)||!present.has(to))fail('가져온 컴포넌트의 개체/동작 연결이 올바르지 않습니다.');
    }
  }
}

/** Actual propagated pages and preserved local source overrides, for a compact pre-apply review. */
export function summarizeLibraryImpact(before,after){
  const slides=after.slides.filter(slide=>!equal(before.slides.find(old=>old.id===slide.id),slide)),changedElementIds=new Set();let overrideCount=0;
  for(const slide of slides){const old=before.slides.find(item=>item.id===slide.id);for(const element of [...(old?.elements||[]),...slide.elements])if(!equal(old?.elements.find(item=>item.id===element.id),slide.elements.find(item=>item.id===element.id)))changedElementIds.add(element.id);}
  // Compare each linked page against its old source: one count per locally formatted object.
  const affected=new Set(slides.map(slide=>slide.id));
  for(const slide of before.slides){if(!affected.has(slide.id))continue;const layout=before.layouts?.find(item=>item.id===slide.layout?.layoutId);if(!layout)continue;const source=resolveLayout(before,layout);for(const element of slide.elements){const sourceId=Object.keys(slide.layout.elementMap).find(id=>slide.layout.elementMap[id]===element.id),original=source.elements.find(item=>item.id===sourceId);if(!original)continue;const current=after.slides.find(item=>item.id===slide.id)?.elements.find(item=>item.id===element.id);if(!current)continue;const scaleX=before.canvas.width/layout.canvas.width,scaleY=before.canvas.height/layout.canvas.height,geometry={x:original.geometry.x*scaleX,y:original.geometry.y*scaleY,width:original.geometry.width*scaleX,height:original.geometry.height*scaleY};const retainedGeometry=retainedOverride(geometry,element.geometry,current.geometry);const retainedStyle=['rotation','fill','stroke','style','hidden','locked','design'].some(key=>retainedOverride(original[key],element[key],current[key]));const retainedText=original.text&&element.text&&current.text&&retainedOverride(original.text.textStyle,element.text.textStyle,current.text.textStyle);if(retainedGeometry||retainedStyle||retainedText)overrideCount++;}}
  return {slideIds:slides.map(slide=>slide.id),slideNames:slides.map(slide=>slide.name||'이름 없는 슬라이드'),changedElementIds:[...changedElementIds],overrideCount};
}
