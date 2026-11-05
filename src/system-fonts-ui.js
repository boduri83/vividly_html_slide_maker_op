import { fontStack } from './font-names.js';
/** One inventory serves the ribbon and theme controls without adding another editing authority. */
export function createSystemFonts({desktop,notice}) {
  const list=document.createElement('datalist');list.id='system-font-families';document.body.append(list);
  let families=[],result=null;
  const field=document.getElementById('property-font-family');
  // Replace before app.js binds properties; retain the same command context and ID.
  if(field?.tagName==='SELECT') {const input=document.createElement('input');input.id=field.id;input.type='text';input.maxLength=256;input.value=field.value;input.setAttribute('aria-label','설치 글꼴 검색');field.replaceWith(input);}
  const status=document.createElement('small');status.id='system-font-status';status.textContent='설치 글꼴 조회 중';
  document.getElementById('wb-theme-font')?.closest('section').append(status);
  function attach(){for(const id of ['property-font-family','wb-theme-font','bu-heading-font']){const node=document.getElementById(id);if(node){node.setAttribute('list',list.id);node.title='설치된 글꼴을 검색하거나 이름을 입력하세요.';}}}
  function paint(){list.replaceChildren(...families.map(name=>{const o=document.createElement('option');o.value=name;return o;}));attach();status.textContent=result?.error?'글꼴 목록을 읽지 못했습니다. 이름을 직접 입력할 수 있습니다.':`이 PC의 설치 글꼴 ${families.length}종 · 다른 PC에서는 해당 글꼴 설치 필요`;}
  async function load(refresh=false){result=desktop?.listFonts?await desktop.listFonts({refresh}):{families:[],source:'browser'};families=result.families||[];if(!families.length&&!desktop&&globalThis.queryLocalFonts){try{families=[...new Set((await queryLocalFonts()).map(v=>v.family))].sort();}catch{}}paint();return result;}
  function sync(){attach();const current=document.getElementById('property-font-family');if(current?.value){try{current.style.fontFamily=fontStack(current.value);}catch{}}}
  attach();const ready=load();return {ready,sync,refresh:()=>load(true),get inventory(){return result;},get families(){return [...families];}};
}
