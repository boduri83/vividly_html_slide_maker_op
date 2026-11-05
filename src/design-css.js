/** Author-time CSS grammar and scoped visual declarations. No DOM, URLs or executable code. */
import {parse,walk,generate,lexer} from '../assets/vendor/css-tree.js';
const groups={
 '배경':['background','background-color','background-image','background-size','background-position','background-repeat','background-clip','background-origin'],
 '테두리':['border','border-color','border-width','border-style','border-top','border-right','border-bottom','border-left','border-radius','border-top-left-radius','border-top-right-radius','border-bottom-left-radius','border-bottom-right-radius','outline','outline-color','outline-width','outline-style','outline-offset'],
 '글자':['color','font-family','font-size','font-weight','font-style','line-height','letter-spacing','word-spacing','text-align','text-transform','text-decoration','text-decoration-color','text-decoration-style','text-decoration-thickness','text-underline-offset','text-shadow','text-indent','white-space','overflow-wrap','word-break','writing-mode','text-orientation'],
 '효과':['opacity','box-shadow','filter','backdrop-filter','mix-blend-mode','background-blend-mode','clip-path'],
 '안쪽 여백':['padding','padding-top','padding-right','padding-bottom','padding-left'],
};
const labels={background:'배경', 'background-color':'배경 색','background-image':'배경 패턴','background-size':'배경 크기','background-position':'배경 위치','background-repeat':'배경 반복','background-clip':'배경을 칠할 영역','background-origin':'배경 위치 기준',border:'테두리','border-color':'테두리 색','border-width':'테두리 굵기','border-style':'테두리 모양','border-top':'위 테두리','border-right':'오른쪽 테두리','border-bottom':'아래 테두리','border-left':'왼쪽 테두리','border-radius':'모서리 둥글기','border-top-left-radius':'왼쪽 위 모서리','border-top-right-radius':'오른쪽 위 모서리','border-bottom-left-radius':'왼쪽 아래 모서리','border-bottom-right-radius':'오른쪽 아래 모서리',outline:'외곽선','outline-color':'외곽선 색','outline-width':'외곽선 굵기','outline-style':'외곽선 모양','outline-offset':'외곽선 간격',color:'글자 색','font-family':'글꼴','font-size':'글자 크기','font-weight':'글자 굵기','font-style':'글자 기울임','line-height':'줄 간격','letter-spacing':'자간','word-spacing':'단어 간격','text-align':'글자 정렬','text-transform':'대소문자 표시','text-decoration':'밑줄·취소선','text-decoration-color':'밑줄·취소선 색','text-decoration-style':'밑줄·취소선 모양','text-decoration-thickness':'밑줄·취소선 굵기','text-underline-offset':'밑줄 간격','text-shadow':'글자 그림자','text-indent':'들여쓰기','white-space':'공백·줄바꿈','overflow-wrap':'긴 단어 줄바꿈','word-break':'단어 나누기','writing-mode':'글쓰기 방향','text-orientation':'세로 글자 방향',opacity:'불투명도','box-shadow':'상자 그림자',filter:'개체 필터','backdrop-filter':'뒤 배경 필터','mix-blend-mode':'개체 혼합','background-blend-mode':'배경 혼합','clip-path':'표시 영역 자르기',padding:'안쪽 여백','padding-top':'위 여백','padding-right':'오른쪽 여백','padding-bottom':'아래 여백','padding-left':'왼쪽 여백'};
export const CSS_PROPERTY_DEFINITIONS=Object.freeze(Object.entries(groups).flatMap(([group,properties])=>properties.map(property=>Object.freeze({property,label:labels[property]||property,group}))));
export const CSS_PROPERTY_NAMES=Object.freeze(CSS_PROPERTY_DEFINITIONS.map(p=>p.property));
const properties=new Set(CSS_PROPERTY_NAMES),tokenId=/^[a-z][a-z0-9-]{0,63}$/;
const plain=(v,label)=>{if(!v||typeof v!=='object'||Array.isArray(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v)))throw Error(label+': 객체가 필요합니다.');};
const err=(message,node)=>{const at=node?.loc?.start;throw Error(message+(at?` (${at.line}행 ${at.column}열)`:''));};
function valueAst(value){
 if(typeof value!=='string'||!value.trim()||value.length>2048)throw Error('CSS 값은 1~2048자여야 합니다.');
 const ast=parse(value,{context:'value',positions:true,onParseError:e=>{throw e;}});
 walk(ast,node=>{if(['Raw','Url','Atrule','Declaration','Rule'].includes(node.type))err('지원하지 않는 CSS 구문/외부 자산입니다.',node);
  if(node.type==='Function'&&['url','attr','env','expression','image-set','-webkit-image-set','paint','element'].includes(node.name.toLowerCase()))err('외부 자산이나 동적 코드를 참조할 수 없습니다.',node);
  if(node.type==='Function'&&node.name.toLowerCase()==='var'){
   const children=node.children.toArray(),name=children[0];
   if(name?.type!=='Identifier'||!/^--v-[a-z][a-z0-9-]{0,63}$/.test(name.name)||children[1]&&!(children[1].type==='Operator'&&children[1].value===','))err('토큰은 var(--v-이름)으로 참조하세요.',node);
  }
 });return ast;
}
function references(ast){const result=[];walk(ast,node=>{if(node.type==='Function'&&node.name.toLowerCase()==='var')result.push(node.children.first.name.slice(4));});return result;}
function expand(value,tokens,stack=[]){
 const ast=valueAst(value);walk(ast,{visit:'Function',enter(node,item,list){if(node.name.toLowerCase()!=='var')return;
  const name=node.children.first.name.slice(4),token=tokens.get(name);
  if(!token)throw Error('없는 스타일 토큰입니다: '+name);
  if(stack.includes(name))throw Error('스타일 토큰이 순환 참조합니다: '+[...stack,name].join(' → '));
  const replacement=valueAst(expand(token.value,tokens,[...stack,name]));list.replace(item,replacement.children);
 }});return generate(ast);
}
function grammar(property,value){const ast=valueAst(value),r=lexer.matchProperty(property,ast);if(r.error)throw Error(`${property}: ${r.error.rawMessage||r.error.message}`);return generate(ast);}
export function normalizeStyleTokens(value){
 if(!Array.isArray(value)||value.length>128)throw Error('스타일 토큰은 최대128개입니다.');
 const seen=new Set(),out=value.map(t=>{plain(t,'token');for(const k of Object.keys(t))if(!['id','name','type','value'].includes(k))throw Error('지원하지 않는 token 필드: '+k);
  if(typeof t.id!=='string'||!tokenId.test(t.id)||seen.has(t.id))throw Error('토큰 ID는 중복 없는 영문 소문자/숫자/하이픈 이름이어야 합니다.');seen.add(t.id);
  if(typeof t.name!=='string'||!t.name.trim()||t.name.length>160)throw Error('토큰 이름은1~160자입니다.');
  if(!['color','length','number'].includes(t.type))throw Error('토큰 유형을 선택하세요.');
  return{id:t.id,name:t.name,type:t.type,value:generate(valueAst(t.value))};
 });const map=new Map(out.map(t=>[t.id,t]));
 for(const t of out){const resolved=expand(t.value,map,[t.id]);if(t.type==='color')grammar('color',resolved);else if(t.type==='length'){
   const match=lexer.matchType('length-percentage',valueAst(resolved));if(match.error)throw Error(t.name+': 길이 값이 필요합니다.');
  }else if(!/^-?(?:\d+\.?\d*|\.\d+)$/.test(resolved)||!Number.isFinite(Number(resolved)))throw Error(t.name+': 숫자가 필요합니다.');}
 return out;
}
export function normalizeCssDeclarations(value,tokens){
 plain(value,'CSS');const entries=Object.entries(value);if(entries.length>64)throw Error('CSS 선언은 최대64개입니다.');
 const map=tokens===undefined?null:new Map(tokens.map(t=>[t.id,t]));const out={};
 for(const [property,v]of entries){if(!properties.has(property))throw Error('이 영역에서 지원하지 않는 CSS 속성입니다: '+property);
  const ast=valueAst(v),refs=references(ast);if(map)grammar(property,expand(v,map));else if(!refs.length)grammar(property,v);
  out[property]=generate(ast);
 }return out;
}
export function resolveCssTokens(value,tokens=[]){const map=new Map(tokens.map(t=>[t.id,t]));return Object.fromEntries(Object.entries(value||{}).map(([p,v])=>[p,grammar(p,expand(v,map))]));}
export function parseCssDeclarations(text,tokens){
 if(typeof text!=='string'||text.length>32768)throw Error('CSS 입력은 최대32768자입니다.');
 const ast=parse(text,{context:'declarationList',positions:true,onParseError:e=>{throw e;}}),out={};
 ast.children.forEach(node=>{if(node.type!=='Declaration'||node.important)err('속성: 값; 형식만 입력하세요. !important는 지원하지 않습니다.',node);
  if(!properties.has(node.property))err('이 영역에서 지원하지 않는 CSS 속성입니다: '+node.property,node);
  if(Object.hasOwn(out,node.property))err('같은 CSS 속성이 중복됩니다: '+node.property,node);out[node.property]=generate(node.value);
 });return normalizeCssDeclarations(out,tokens);
}
