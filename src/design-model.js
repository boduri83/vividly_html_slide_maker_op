import {containerChildren,arrangeComposition} from './composition-model.js';
/** Reusable author styles and logical flow layout. Runtime state never enters this model. */
import { isFontFamily } from './font-names.js';
import { normalizeCssDeclarations, normalizeStyleTokens, resolveCssTokens } from './design-css.js';
export const DESIGN_SCHEMA = '0.12-design.1';
export const DESIGN_STATES = ['hover','pressed','focus','disabled'];
const copy=value=>structuredClone(value);
const fail=message=>{throw Error(message);};
const plain=(value,label)=>{if(!value||typeof value!=='object'||Array.isArray(value))fail(`${label}: 객체가 필요합니다.`);return value;};
function exact(value,allowed,label){plain(value,label);for(const key of Object.keys(value))if(!allowed.includes(key))fail(`${label}.${key}: 지원하지 않는 필드입니다.`);}
function bounded(value,min,max,label){if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)fail(`${label}: ${min}~${max} 범위의 수가 필요합니다.`);return value;}
function string(value,label,max=256){if(typeof value!=='string'||!value.trim()||value.length>max)fail(`${label}: 1~${max}자 문자열이 필요합니다.`);return value;}
function color(value,label){if(typeof value!=='string'||!/^#(?:[a-f\d]{3}|[a-f\d]{4}|[a-f\d]{6}|[a-f\d]{8})$/i.test(value))fail(`${label}: HEX 색상이 필요합니다.`);return value.toLowerCase();}
function choice(value,values,label){if(!values.includes(value))fail(`${label}: 지원하지 않는 값입니다.`);return value;}
const obj=(properties,required=Object.keys(properties),extra={})=>({type:'object',properties,required,additionalProperties:false,...extra});
const id={type:'string',minLength:1,maxLength:256,pattern:'\\S'},hex={type:'string',pattern:'^#(?:[a-fA-F0-9]{3}|[a-fA-F0-9]{4}|[a-fA-F0-9]{6}|[a-fA-F0-9]{8})$'};
const num=(minimum,maximum)=>({type:'number',minimum,maximum}),enumeration=(...values)=>({type:'string',enum:values});
const cssSchema={type:'object',properties:{},required:[],additionalProperties:{type:'string',maxLength:4096},maxProperties:128};
const gradient=obj({type:enumeration('linear','radial'),angle:num(-36000,36000),stops:{type:'array',minItems:2,maxItems:16,items:obj({offset:num(0,1),color:hex})}});
const shadow=obj({x:num(-100000,100000),y:num(-100000,100000),blur:num(0,100000),spread:num(-100000,100000),color:hex});
const visual=obj({opacity:num(0,1),radius:num(0,100000),blur:num(0,100),backdropBlur:num(0,100),blendMode:enumeration('normal','multiply','screen','overlay','darken','lighten','color-dodge'),gradient:{anyOf:[{type:'null'},gradient]},shadow:{anyOf:[{type:'null'},shadow]}},[]);
const textStyle=obj({fontFamily:{type:'string',minLength:1,maxLength:256},fontSize:{type:'number',exclusiveMinimum:0,maximum:100000},lineHeight:{type:'number',exclusiveMinimum:0,maximum:1000},color:hex,align:enumeration('left','center','right'),verticalAlign:enumeration('top','middle','bottom'),bold:{type:'boolean'},italic:{type:'boolean'},underline:{type:'boolean'},strike:{type:'boolean'}},[]);
const appearance=obj({fill:hex,stroke:obj({color:hex,width:num(0,100000)},[]),textStyle,style:visual,css:cssSchema},[]);
const states=obj(Object.fromEntries(DESIGN_STATES.map(state=>[state,appearance])),[]);
const flowFields={direction:enumeration('row','column','grid'),gap:num(0,100000),padding:num(0,100000),align:enumeration('start','center','end','stretch'),justify:enumeration('start','center','end','space-between'),columns:{type:'integer',minimum:1,maximum:100}};
export const designSchemas={appearance,states,recipe:obj({id,name:{type:'string',minLength:1,maxLength:160},appearance,states},['id','name','appearance']),
 tokens:{type:'array',maxItems:128,items:obj({id:{type:'string',pattern:'^[a-z][a-z0-9-]{0,63}$'},name:{type:'string',minLength:1,maxLength:160},type:enumeration('color','length','number'),value:{type:'string',minLength:1,maxLength:4096}})},
 design:obj({recipeId:id,overrides:appearance,states,disabled:{type:'boolean'}},[]),flow:obj({...flowFields,children:{type:'array',minItems:1,maxItems:1000,items:id}}),flowSettings:obj(flowFields)};

export function normalizeDesignAppearance(value,tokens){
 exact(value,['fill','stroke','textStyle','style','css'],'appearance');const result={};
 if(value.fill!==undefined)result.fill=color(value.fill,'appearance.fill');
 if(value.stroke!==undefined){exact(value.stroke,['color','width'],'appearance.stroke');result.stroke={};if(value.stroke.color!==undefined)result.stroke.color=color(value.stroke.color,'stroke.color');if(value.stroke.width!==undefined)result.stroke.width=bounded(value.stroke.width,0,100000,'stroke.width');}
 if(value.textStyle!==undefined){exact(value.textStyle,Object.keys(textStyle.properties),'appearance.textStyle');result.textStyle={};for(const[key,v]of Object.entries(value.textStyle)){
  if(key==='fontFamily'){if(!isFontFamily(v))fail('fontFamily: 지원하지 않는 글꼴 이름입니다.');result.textStyle[key]=v;}
  else if(key==='color')result.textStyle[key]=color(v,'textStyle.color');
  else if(key==='fontSize')result.textStyle[key]=bounded(v,0.000001,100000,key);
  else if(key==='lineHeight')result.textStyle[key]=bounded(v,0.000001,1000,key);
  else if(key==='align')result.textStyle[key]=choice(v,['left','center','right'],key);
  else if(key==='verticalAlign')result.textStyle[key]=choice(v,['top','middle','bottom'],key);
  else{if(typeof v!=='boolean')fail(`${key}: Boolean이 필요합니다.`);result.textStyle[key]=v;}
 }}
 if(value.style!==undefined){exact(value.style,Object.keys(visual.properties),'appearance.style');result.style={};for(const[key,v]of Object.entries(value.style)){
  if(key==='blendMode')result.style[key]=choice(v,visual.properties.blendMode.enum,key);
  else if(key==='gradient'){if(v===null){result.style.gradient=null;continue;}exact(v,['type','angle','stops'],'gradient');if(!Array.isArray(v.stops)||v.stops.length<2||v.stops.length>16)fail('gradient: 2~16개 stop이 필요합니다.');const stops=v.stops.map(s=>{exact(s,['offset','color'],'gradient.stop');return{offset:bounded(s.offset,0,1,'gradient.offset'),color:color(s.color,'gradient.color')};});if(stops.some((s,i)=>i&&s.offset<stops[i-1].offset))fail('gradient: stop 순서가 올바르지 않습니다.');result.style.gradient={type:choice(v.type,['linear','radial'],'gradient.type'),angle:bounded(v.angle,-36000,36000,'gradient.angle'),stops};}
  else if(key==='shadow'){if(v===null){result.style.shadow=null;continue;}exact(v,['x','y','blur','spread','color'],'shadow');result.style.shadow={x:bounded(v.x,-100000,100000,'shadow.x'),y:bounded(v.y,-100000,100000,'shadow.y'),blur:bounded(v.blur,0,100000,'shadow.blur'),spread:bounded(v.spread,-100000,100000,'shadow.spread'),color:color(v.color,'shadow.color')};}
  else{const schema=visual.properties[key];result.style[key]=bounded(v,schema.minimum,schema.maximum,'style.'+key);}
 }}
 if(value.css!==undefined)result.css=normalizeCssDeclarations(value.css,tokens);
 return result;
}
export function normalizeDesignStates(value,tokens){exact(value,DESIGN_STATES,'design.states');return Object.fromEntries(Object.entries(value).map(([key,v])=>[key,normalizeDesignAppearance(v,tokens)]));}
export function normalizeElementDesign(value,tokens){exact(value,['recipeId','overrides','states','disabled'],'design');const result={};if(value.recipeId!==undefined)result.recipeId=string(value.recipeId,'design.recipeId');if(value.overrides!==undefined)result.overrides=normalizeDesignAppearance(value.overrides,tokens);if(value.states!==undefined)result.states=normalizeDesignStates(value.states,tokens);if(value.disabled!==undefined){if(typeof value.disabled!=='boolean')fail('design.disabled: Boolean이 필요합니다.');result.disabled=value.disabled;}return result;}
export function normalizeDesignRecipes(value,tokens){if(!Array.isArray(value)||value.length>128)fail('styleRecipes: 최대128개 스타일이 필요합니다.');const seen=new Set();return value.map(recipe=>{exact(recipe,['id','name','appearance','states'],'styleRecipe');const key=string(recipe.id,'styleRecipe.id');if(seen.has(key))fail('styleRecipe.id: 중복 ID입니다.');seen.add(key);return{id:key,name:string(recipe.name,'styleRecipe.name',160),appearance:normalizeDesignAppearance(recipe.appearance,tokens),...(recipe.states!==undefined?{states:normalizeDesignStates(recipe.states,tokens)}:{})};});}
export function normalizeFlow(value){exact(value,[...Object.keys(flowFields),'children'],'flow');const result={direction:choice(value.direction,['row','column','grid'],'flow.direction'),gap:bounded(value.gap,0,100000,'flow.gap'),padding:bounded(value.padding,0,100000,'flow.padding'),align:choice(value.align,['start','center','end','stretch'],'flow.align'),justify:choice(value.justify,['start','center','end','space-between'],'flow.justify'),columns:bounded(value.columns,1,100,'flow.columns')};if(!Number.isInteger(result.columns))fail('flow.columns: 정수가 필요합니다.');if(!Array.isArray(value.children)||!value.children.length||value.children.length>1000||new Set(value.children).size!==value.children.length)fail('flow.children: 중복 없는1~1000개 개체가 필요합니다.');result.children=value.children.map(id=>string(id,'flow.child'));return result;}
export function mergeDesignAppearance(first={},second={}){const result=copy(first);for(const[key,value]of Object.entries(second))result[key]=['style','stroke','textStyle','css'].includes(key)?{...(result[key]||{}),...copy(value)}:copy(value);return result;}
export function appearanceCssConflicts(value={}){const out=new Set(),add=(...keys)=>keys.forEach(k=>out.add(k));
 if(value.fill!==undefined)add('background','background-color','background-image');
 if(value.stroke){add('border','border-top','border-right','border-bottom','border-left');if(value.stroke.color!==undefined)add('border-color');if(value.stroke.width!==undefined)add('border-width','border-style');}
 const textMap={fontFamily:'font-family',fontSize:'font-size',color:'color',lineHeight:'line-height',align:'text-align',bold:'font-weight',italic:'font-style',underline:'text-decoration',strike:'text-decoration'};for(const key of Object.keys(value.textStyle||{}))if(textMap[key])add(textMap[key]);
 const styleMap={opacity:['opacity'],radius:['border-radius','border-top-left-radius','border-top-right-radius','border-bottom-left-radius','border-bottom-right-radius'],gradient:['background','background-image','background-color'],shadow:['box-shadow'],blur:['filter'],backdropBlur:['backdrop-filter'],blendMode:['mix-blend-mode']};for(const key of Object.keys(value.style||{}))add(...(styleMap[key]||[]));return out;
}
export function patchDesignAppearance(first={},patch={}){const clean=copy(first);if(clean.css){for(const key of appearanceCssConflicts(patch))delete clean.css[key];if(!Object.keys(clean.css).length)delete clean.css;}return mergeDesignAppearance(clean,patch);}
function applyAppearance(element,value,css){
 for(const property of appearanceCssConflicts(value))delete css[property];
 if(value.fill!==undefined){if(element.type==='shape'){element.fill=value.fill;if(element.themeRefs)delete element.themeRefs.fill;}else css['background-color']=value.fill;}
 if(value.stroke){if(element.type==='shape')element.stroke={...element.stroke,...copy(value.stroke)};else{if(value.stroke.color!==undefined)css['border-color']=value.stroke.color;if(value.stroke.width!==undefined)css['border-width']=value.stroke.width+'px';css['border-style']='solid';}}
 if(value.textStyle&&element.text){element.text.textStyle={...element.text.textStyle,...copy(value.textStyle)};if(element.themeRefs){if(value.textStyle.color!==undefined)delete element.themeRefs.textColor;if(value.textStyle.fontFamily!==undefined)delete element.themeRefs.fontFamily;}}
 if(value.style){element.style={...element.style,...copy(value.style)};for(const key of['gradient','shadow'])if(element.style[key]===null)delete element.style[key];}
 Object.assign(css,value.css||{});
}
/** Detached resolved legacy element, advanced CSS and complete automatic-state appearances. */
export function resolveDesignElement(input,document,{state='base'}={}){
 const recipe=document.styleRecipes?.find(recipe=>recipe.id===input.design?.recipeId),local=input.design;
 const base=copy(input),baseCss={};delete base.design;const origins={};
 if(document.theme&&base.themeRefs){if(base.type==='shape'&&base.themeRefs.fill)base.fill=document.theme.colors[base.themeRefs.fill];if(base.text&&base.themeRefs.textColor)base.text.textStyle.color=document.theme.colors[base.themeRefs.textColor];if(base.text&&base.themeRefs.fontFamily)base.text.textStyle.fontFamily=base.semanticRole==='heading'?(document.theme.headingFontFamily||document.theme.fontFamily):document.theme.fontFamily;}
 const add=(element,css,appearance,origin,originMap=origins)=>{if(!appearance)return;applyAppearance(element,appearance,css);for(const[key,value]of Object.entries(appearance))if(value&&typeof value==='object')for(const name of Object.keys(value))originMap[key+'.'+name]=origin;else originMap[key]=origin;};
 add(base,baseCss,recipe?.appearance,'recipe');add(base,baseCss,local?.overrides,'override');
 const states={};for(const key of DESIGN_STATES)if(recipe?.states?.[key]||local?.states?.[key]){const element=copy(base),css={...baseCss},stateOrigins={...origins};add(element,css,recipe?.states?.[key],'recipe-state',stateOrigins);add(element,css,local?.states?.[key],'state-override',stateOrigins);states[key]={element,css:resolveCssTokens(css,document.styleTokens||[]),origins:stateOrigins};}
 const selected=states[state]||{element:base,css:resolveCssTokens(baseCss,document.styleTokens||[]),origins};return{...selected,states};
}
/** Snapshot current appearance without text/content/geometry; used for detach and cross-document copy. */
export function captureDesignAppearance(element,document){const resolved=resolveDesignElement(element,document),e=resolved.element;return{...(e.type==='shape'?{fill:e.fill,stroke:copy(e.stroke)}:{}),...(e.text?{textStyle:copy(e.text.textStyle)}:{}),...(e.style?{style:copy(e.style)}:{}),...(Object.keys(resolved.css).length?{css:resolved.css}:{})};}
export function detachDesignElement(element,document){if(!element.design)return;const disabled=element.design.disabled,resolved=resolveDesignElement(element,document),e=resolved.element;for(const key of['fill','stroke','style','themeRefs']){if(e[key]!==undefined)element[key]=copy(e[key]);else delete element[key];}if(element.text&&e.text)element.text.textStyle=copy(e.text.textStyle);const states=Object.fromEntries(Object.entries(resolved.states).map(([state,value])=>[state,captureDesignAppearance(value.element,{...document,styleRecipes:[]})]));for(const[state,value]of Object.entries(resolved.states))if(Object.keys(value.css).length)states[state].css=value.css;const design={...(Object.keys(resolved.css).length?{overrides:{css:resolved.css}}:{}),...(Object.keys(states).length?{states}:{}),...(disabled!==undefined?{disabled}:{})};if(Object.keys(design).length)element.design=design;else delete element.design;}

/** Coordinate projection is canonical at normalization/commit, shared by editing and all output paths. */
export function resolveFlowSlide(input){
 const slide=copy(input),indexed=new Map(slide.elements.map(e=>[e.id,e])),parents=new Map();
 for(const container of slide.elements)if(container.flow||container.composition){if(container.flow&&container.composition)fail('한 프레임은 자유 배치와 자동 배치 중 하나를 사용합니다.');if(container.type==='connector')fail('연결선은 자동 배치 컨테이너가 될 수 없습니다.');if(container.flow&&container.rotation)fail('자동 배치 컨테이너는 회전할 수 없습니다. 먼저 자동 배치를 해제해 주세요.');for(const id of containerChildren(container)){const child=indexed.get(id);if(!child||id===container.id)fail('flow.children: 같은 페이지의 다른 개체가 필요합니다.');if(container.flow&&child.type==='connector')fail('연결선은 자동 배치 안에 넣을 수 없습니다.');if(parents.has(id))fail('한 개체는 하나의 자동 배치에만 속할 수 있습니다.');parents.set(id,container.id);}}
 const active=new Set(),done=new Set();
 function arrange(container){if(done.has(container.id))return;if(active.has(container.id))fail('자동 배치에 순환 참조가 있습니다.');active.add(container.id);if(container.composition){const changed=arrangeComposition(slide,container);for(const element of changed)done.delete(element.id);for(const id of container.composition.children){const child=indexed.get(id);if(child.flow||child.composition)arrange(child);}active.delete(container.id);done.add(container.id);return;}const f=container.flow;if(f){const children=f.children.map(id=>indexed.get(id)),g=container.geometry,w=Math.max(.001,g.width-f.padding*2),h=Math.max(.001,g.height-f.padding*2),row=f.direction==='row',grid=f.direction==='grid';
  if(grid){const columns=Math.min(f.columns,children.length),rows=Math.ceil(children.length/columns),cellW=Math.max(.001,(w-f.gap*(columns-1))/columns),cellH=Math.max(.001,(h-f.gap*(rows-1))/rows);children.forEach((child,i)=>{const cg=child.geometry,col=i%columns,r=Math.floor(i/columns);if(f.align==='stretch'){cg.width=cellW;cg.height=cellH;}const offset=delta=>f.align==='center'?delta/2:f.align==='end'?delta:0;cg.x=g.x+f.padding+col*(cellW+f.gap)+offset(cellW-cg.width);cg.y=g.y+f.padding+r*(cellH+f.gap)+offset(cellH-cg.height);});}
  else{const axis=row?'x':'y',cross=row?'y':'x',size=row?'width':'height',crossSize=row?'height':'width',available=row?w:h,crossAvailable=row?h:w,total=children.reduce((n,c)=>n+c.geometry[size],0),free=available-total-f.gap*(children.length-1);let gap=f.gap,cursor=f.justify==='center'?free/2:f.justify==='end'?free:0;if(f.justify==='space-between'&&children.length>1)gap=Math.max(0,(available-total)/(children.length-1));for(const child of children){const cg=child.geometry;if(f.align==='stretch')cg[crossSize]=crossAvailable;cg[axis]=g[axis]+f.padding+cursor;cg[cross]=g[cross]+f.padding+(f.align==='center'?(crossAvailable-cg[crossSize])/2:f.align==='end'?crossAvailable-cg[crossSize]:0);cursor+=cg[size]+gap;}}
  for(const child of children){if(Object.values(child.geometry).some(value=>!Number.isFinite(value))||child.geometry.width<=0||child.geometry.height<=0)fail('자동 배치의 계산 결과가 유효한 기하 범위를 벗어납니다.');if(child.flow||child.composition)arrange(child);}
 }active.delete(container.id);done.add(container.id);}
 for(const element of slide.elements)if((element.flow||element.composition)&&!parents.has(element.id))arrange(element);
 for(const element of slide.elements)if((element.flow||element.composition)&&!done.has(element.id))arrange(element);
 return slide;
}
export function flowParent(slide,elementId){return slide.elements.find(e=>e.flow?.children.includes(elementId));}
export function flowMinimumSize(flow,children){const count=children.length,columns=Math.min(flow.columns,count),rows=Math.ceil(count/columns),pad=flow.padding*2,maxWidth=Math.max(.001,...children.map(e=>e.geometry.width)),maxHeight=Math.max(.001,...children.map(e=>e.geometry.height));
 if(flow.direction==='row')return{width:pad+children.reduce((sum,e)=>sum+e.geometry.width,0)+flow.gap*(count-1),height:pad+(flow.align==='stretch'?.001:maxHeight)};
 if(flow.direction==='column')return{width:pad+(flow.align==='stretch'?.001:maxWidth),height:pad+children.reduce((sum,e)=>sum+e.geometry.height,0)+flow.gap*(count-1)};
 return{width:pad+(flow.align==='stretch'?.001:maxWidth)*columns+flow.gap*(columns-1),height:pad+(flow.align==='stretch'?.001:maxHeight)*rows+flow.gap*(rows-1)};
}
export function cleanDesignReferences(document){for(const slide of [...document.slides,...(document.layouts||[]),...(document.layoutMasters||[])]){const ids=new Set(slide.elements.map(e=>e.id));for(const e of slide.elements)if(e.flow){e.flow.children=e.flow.children.filter(id=>ids.has(id)&&id!==e.id);if(!e.flow.children.length)delete e.flow;}}}
export function validateDesignReferences(document){
 const recipes=new Set((document.styleRecipes||[]).map(r=>r.id));for(const slide of [...document.slides,...(document.layouts||[]),...(document.layoutMasters||[])])for(const e of slide.elements)if(e.design){if(e.design.recipeId&&!recipes.has(e.design.recipeId))fail('design.recipeId: 문서 스타일을 찾을 수 없습니다.');const resolved=resolveDesignElement(e,document);if(e.type==='shape'&&!['rectangle','ellipse'].includes(e.shape)&&[resolved.css,...Object.values(resolved.states).map(s=>s.css)].some(css=>Object.keys(css).some(key=>/^(?:border(?:-|$)|outline(?:-|$))/.test(key))))fail('표준 도형의 테두리는 도형 테두리 도구로 편집하세요. 이 도형에는 CSS border/outline을 적용할 수 없습니다.');}
}
export function hasDesign(document){return document.styleTokens!==undefined||document.styleRecipes!==undefined||[...document.slides,...(document.layouts||[]),...(document.layoutMasters||[])].some(slide=>slide.elements.some(e=>e.design!==undefined||e.flow!==undefined));}
export { normalizeStyleTokens };
