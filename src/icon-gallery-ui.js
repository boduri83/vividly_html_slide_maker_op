/** The icon picker inserts closed editable SVG data; previews never mutate the document. */
import {ICON_DEFINITIONS,ICON_CATEGORIES,getIconDefinition,createIconSvg} from './icon-catalog.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const categoryNames=Object.fromEntries(ICON_CATEGORIES.map(category=>[category.id,category.label]));

export function createIconGallery({store,action,notice}){
  const dialog=document.createElement('dialog');
  dialog.id='ig-dialog';dialog.className='sg-dialog ig-dialog';dialog.setAttribute('aria-labelledby','ig-title');
  dialog.innerHTML='<header class="sg-heading"><div><h2 id="ig-title">SVG 아이콘 삽입</h2><p id="ig-subtitle">아이콘을 고른 뒤 크기와 색을 계속 편집할 수 있습니다.</p></div><button id="ig-close" type="button">닫기 · Esc</button></header><div class="sg-search"><label for="ig-query">아이콘 찾기</label><input id="ig-query" type="search" placeholder="예: 목표, 데이터, 사람, 아이디어…" autocomplete="off"><span id="ig-count" role="status" aria-live="polite"></span></div><div class="sg-layout"><nav id="ig-categories" aria-label="아이콘 범주"></nav><div id="ig-results" class="sg-results" role="group" aria-label="아이콘 목록"></div></div><footer class="sg-footer"><span id="ig-status" role="status"></span><span>방향키로 아이콘 이동 · Enter 선택 · Esc 닫기</span></footer>';
  document.body.append(dialog);
  const $=id=>document.getElementById(id),query=$('ig-query'),results=$('ig-results'),status=$('ig-status');
  let captured=null,mode='insert',category='all',returnFocus=null,composing=false,opening=false;
  const context=()=>JSON.stringify({sessionId:store.sessionId,revision:store.revision,slideId:store.activeSlideId,selectedIds:[...store.selectedIds]});
  $('ig-categories').innerHTML=[['all','모든 아이콘'],...ICON_CATEGORIES.map(category=>[category.id,category.label])].map(([id,label])=>`<button type="button" data-icon-category="${escape(id)}" aria-pressed="${id==='all'}">${escape(label)}</button>`).join('');
  function preview(icon){return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${icon.svg.shapes.map(path=>`<path d="${escape(path.d)}" fill="${escape(path.fill)}" stroke="${escape(path.stroke)}" stroke-width="${path.strokeWidth}" stroke-linecap="${escape(path.strokeLinecap)}" stroke-linejoin="${escape(path.strokeLinejoin)}"/>`).join('')}</svg>`;}
  function paint(){
    const words=query.value.normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    const matches=ICON_DEFINITIONS.filter(icon=>(category==='all'||icon.category===category)&&words.every(word=>`${icon.id} ${icon.label} ${categoryNames[icon.category]} ${icon.keywords.join(' ')}`.toLocaleLowerCase().includes(word)));
    const groups=new Map();for(const icon of matches){if(!groups.has(icon.category))groups.set(icon.category,[]);groups.get(icon.category).push(icon);}
    results.innerHTML=matches.length?[...groups].map(([id,icons])=>`<section class="sg-section"><h3>${escape(categoryNames[id])}</h3><div class="sg-grid">${icons.map(icon=>`<button type="button" data-icon-id="${escape(icon.id)}" title="${escape(icon.label)}" aria-label="${escape(icon.label)}">${preview(icon)}<span>${escape(icon.label)}</span></button>`).join('')}</div></section>`).join(''):'<p class="sg-empty">일치하는 아이콘이 없습니다. 다른 이름으로 찾아보세요.</p>';
    $('ig-count').textContent=matches.length+'개';for(const node of $('ig-categories').children)node.setAttribute('aria-pressed',String(node.dataset.iconCategory===category));
  }
  function close(restore=true){if(dialog.open)dialog.close();captured=null;composing=false;if(restore&&returnFocus?.isConnected)returnFocus.focus({preventScroll:true});}
  function open(nextMode='insert'){
    if(document.querySelector('dialog[open]')||document.getElementById('presentation')?.hidden===false)return;
    if(nextMode==='replace'&&(store.selectedIds.length!==1||store.selectedElement?.type!=='svg'||store.selectedElement.locked||store.selectedElement.hidden)){notice('바꿀 SVG 아이콘 한 개를 선택하세요.');return;}
    mode=nextMode;returnFocus=document.activeElement;opening=true;
    try{category='all';query.value='';status.textContent='';$('ig-title').textContent=mode==='replace'?'SVG 아이콘 바꾸기':'SVG 아이콘 삽입';$('ig-subtitle').textContent=mode==='replace'?'아이콘의 크기·위치·동작은 유지하고 다른 아이콘으로 바꿉니다.':'아이콘을 고른 뒤 크기와 색을 계속 편집할 수 있습니다.';paint();dialog.showModal();query.focus();captured=context();}finally{opening=false;}
  }
  async function choose(iconId){
    if(!captured||captured!==context()){status.textContent='자료나 선택이 바뀌었습니다. 닫고 다시 선택하세요.';return;}
    const token=captured,replace=mode==='replace',prior=store.selectedElement,definition=getIconDefinition(iconId);
    const currentColor=replace?prior.svg.shapes.find(shape=>shape.stroke&&shape.stroke!=='none')?.stroke||prior.svg.shapes.find(shape=>shape.fill&&shape.fill!=='none')?.fill:undefined;
    const svg=createIconSvg(iconId,currentColor||'#253858'),selectedId=prior?.id;
    close(false);
    await action(()=>{
      if(token!==context())throw new Error('아이콘을 고르는 동안 자료가 바뀌었습니다.');
      if(replace)store.setSvg(selectedId,svg);
      else{
        const element={id:'icon-'+crypto.randomUUID(),type:'svg',name:definition.label,geometry:{x:Math.max(0,(store.document.canvas.width-144)/2),y:Math.max(0,(store.document.canvas.height-144)/2),width:144,height:144},svg};
        const created=store.pasteElements({kind:'vividly-elements',version:2,documentId:store.document.id,elements:[element],assets:[],variables:[],motions:[],interactions:[]},{offsetX:0,offsetY:0});
        if(created?.[0])store.selectElements([created[0]],{expandGroups:false});
      }
    });
    document.getElementById('stage')?.focus({preventScroll:true});
  }
  $('ig-close').addEventListener('click',()=>{if(!composing)close();});
  dialog.addEventListener('cancel',event=>{event.preventDefault();if(!composing)close();});
  query.addEventListener('compositionstart',()=>composing=true);query.addEventListener('compositionend',()=>composing=false);
  query.addEventListener('input',paint);
  query.addEventListener('keydown',event=>{if(!event.isComposing&&event.key==='ArrowDown'){event.preventDefault();results.querySelector('button')?.focus();}});
  $('ig-categories').addEventListener('click',event=>{const button=event.target.closest('[data-icon-category]');if(!button)return;category=button.dataset.iconCategory;paint();results.scrollTop=0;});
  results.addEventListener('click',event=>{const button=event.target.closest('[data-icon-id]');if(button)choose(button.dataset.iconId);});
  results.addEventListener('keydown',event=>{
    if(event.isComposing)return;const button=event.target.closest('[data-icon-id]');if(!button)return;
    const buttons=[...results.querySelectorAll('[data-icon-id]')],index=buttons.indexOf(button),columns=getComputedStyle(button.parentElement).gridTemplateColumns.split(' ').length;let next=index;
    if(event.key==='ArrowRight')next++;else if(event.key==='ArrowLeft')next--;else if(event.key==='ArrowDown')next+=columns;else if(event.key==='ArrowUp')next-=columns;else if(event.key==='Home')next=0;else if(event.key==='End')next=buttons.length-1;else return;
    event.preventDefault();buttons[Math.max(0,Math.min(buttons.length-1,next))]?.focus();
  });
  dialog.addEventListener('keydown',event=>{event.stopPropagation();if(event.isComposing||composing)return;if(event.key==='Escape'){event.preventDefault();close();return;}if((event.ctrlKey||event.metaKey)&&['s','o','n'].includes(event.key.toLowerCase())||event.key==='F5'){event.preventDefault();status.textContent='아이콘 선택을 마친 뒤 파일 작업이나 발표를 실행하세요.';}});
  return{open,close,sync(){if(dialog.open&&!opening&&captured!==context())close();},get busy(){return dialog.open;}};
}
