/** Preset gallery uses the same declarative geometry as saved, editable shapes. */
import { SHAPE_DEFINITIONS, SHAPE_CATEGORIES, shapeGeometry } from './shapes.js';
const escape = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const categoryNames=Object.fromEntries(SHAPE_CATEGORIES.map(category=>[category.id,category.label]));
export function createShapeGallery({store,action,notice}) {
  const dialog=document.createElement('dialog');dialog.id='sg-dialog';dialog.className='sg-dialog';dialog.setAttribute('aria-labelledby','sg-title');
  dialog.innerHTML='<header class="sg-heading"><div><h2 id="sg-title">도형 삽입</h2><p id="sg-subtitle">도형을 고른 뒤 크기·색·텍스트를 자유롭게 편집하세요.</p></div><button id="sg-close" type="button">닫기 · Esc</button></header><div class="sg-search"><label for="sg-query">도형 찾기</label><input id="sg-query" type="search" placeholder="예: 화살표, 별, 순서도…" autocomplete="off"><span id="sg-count" role="status" aria-live="polite"></span></div><div class="sg-layout"><nav id="sg-categories" aria-label="도형 범주"></nav><div id="sg-results" class="sg-results" role="group" aria-label="도형 목록"></div></div><footer class="sg-footer"><span id="sg-status" role="status"></span><span>방향키로 도형 이동 · Enter 선택 · Esc 닫기</span></footer>';
  document.body.append(dialog);
  const $=id=>document.getElementById(id),query=$('sg-query'),results=$('sg-results'),status=$('sg-status');
  let captured=null,mode='insert',category='all',returnFocus=null,queryComposing=false,opening=false;
  const context=()=>JSON.stringify({sessionId:store.sessionId,revision:store.revision,slideId:store.activeSlideId,selectedIds:[...store.selectedIds]});
  const categories=[...new Set(SHAPE_DEFINITIONS.map(shape=>shape.category))];
  $('sg-categories').innerHTML=[['all','모든 도형'],...categories.map(id=>[id,categoryNames[id]||id])].map(([id,label])=>`<button type="button" data-shape-category="${escape(id)}" aria-pressed="${id==='all'}">${escape(label)}</button>`).join('');
  function preview(shape){const width=shape.defaultWidth,height=shape.defaultHeight,{paths}=shapeGeometry(shape.id,width,height),attrs=path=>`d="${escape(path.d)}" fill-rule="${path.fillRule==='evenodd'?'evenodd':'nonzero'}"`;return `<svg viewBox="0 0 ${width} ${height}" aria-hidden="true" focusable="false">${paths.filter(path=>path.fill!==false).map(path=>`<path ${attrs(path)} fill="#dce7ff" stroke="none"/>`).join('')}${paths.filter(path=>path.stroke!==false).map(path=>`<path ${attrs(path)} fill="none" stroke="#3d5d95" stroke-width="1.5" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>`).join('')}</svg>`;}
  function paint(){const words=query.value.normalize('NFKC').toLowerCase().trim().split(/\s+/).filter(Boolean);const matches=SHAPE_DEFINITIONS.filter(shape=>(category==='all'||shape.category===category)&&words.every(word=>`${shape.label} ${shape.id} ${categoryNames[shape.category]||shape.category} ${(shape.keywords||[]).join?.(' ')||shape.keywords||''}`.toLowerCase().includes(word)));
    const groups=new Map();for(const shape of matches){if(!groups.has(shape.category))groups.set(shape.category,[]);groups.get(shape.category).push(shape);}
    results.innerHTML=matches.length?[...groups].map(([cat,shapes])=>`<section class="sg-section"><h3>${escape(categoryNames[cat]||cat)}</h3><div class="sg-grid">${shapes.map(shape=>`<button type="button" data-shape-kind="${escape(shape.id)}" title="${escape(shape.label)}" aria-label="${escape(shape.label)}">${preview(shape)}<span>${escape(shape.label)}</span></button>`).join('')}</div></section>`).join(''):'<p class="sg-empty">일치하는 도형이 없습니다. 다른 이름으로 찾아보세요.</p>';
    $('sg-count').textContent=matches.length+'개';for(const node of $('sg-categories').children)node.setAttribute('aria-pressed',String(node.dataset.shapeCategory===category));
  }
  function close(restore=true){if(dialog.open)dialog.close();captured=null;queryComposing=false;if(restore&&returnFocus?.isConnected)returnFocus.focus({preventScroll:true});}
  function open(nextMode='insert'){
    if(document.querySelector('dialog[open]')||!document.getElementById('presentation').hidden)return;
    if(nextMode==='replace'&&(!store.selectedIds.length||!store.selectedElements.every(element=>element.type==='shape'&&!element.locked&&!element.hidden))){notice('종류를 바꿀 도형을 선택하세요.');return;}
    mode=nextMode;returnFocus=document.activeElement;opening=true;
    try{category='all';query.value='';status.textContent='';$('sg-title').textContent=mode==='replace'?'도형 바꾸기':'도형 삽입';$('sg-subtitle').textContent=mode==='replace'?'텍스트·크기·색·동작은 유지하고 선택한 도형의 종류를 바꿉니다.':'도형을 고른 뒤 크기·색·텍스트를 자유롭게 편집하세요.';paint();dialog.showModal();query.focus();captured=context();}finally{opening=false;}
  }
  async function choose(kind){if(!captured||captured!==context()){status.textContent='자료나 선택이 바뀌었습니다. 닫고 다시 선택하세요.';return;}const token=captured,replace=mode==='replace',ids=[...store.selectedIds];close(false);
    await action(()=>{if(token!==context())throw new Error('도형을 선택하는 동안 자료가 바뀌었습니다.');if(replace)store.runBatch(ids.map(elementId=>({id:'shape.set_kind',params:{elementId,shape:kind}})),'도형 바꾸기');else store.addShape(kind);});document.getElementById('stage').focus({preventScroll:true});
  }
  $('sg-close').addEventListener('click',()=>{if(!queryComposing)close();});
  dialog.addEventListener('cancel',event=>{event.preventDefault();if(!queryComposing)close();});
  query.addEventListener('compositionstart',()=>queryComposing=true);query.addEventListener('compositionend',()=>queryComposing=false);
  query.addEventListener('input',paint);
  query.addEventListener('keydown',event=>{if(!event.isComposing&&event.key==='ArrowDown'){event.preventDefault();results.querySelector('button')?.focus();}});
  $('sg-categories').addEventListener('click',event=>{const button=event.target.closest('[data-shape-category]');if(!button)return;category=button.dataset.shapeCategory;paint();results.scrollTop=0;});
  results.addEventListener('click',event=>{const button=event.target.closest('[data-shape-kind]');if(button)choose(button.dataset.shapeKind);});
  results.addEventListener('keydown',event=>{if(event.isComposing)return;const button=event.target.closest('[data-shape-kind]');if(!button)return;const buttons=[...results.querySelectorAll('[data-shape-kind]')],index=buttons.indexOf(button),columns=getComputedStyle(button.parentElement).gridTemplateColumns.split(' ').length;let next=index;
    if(event.key==='ArrowRight')next++;else if(event.key==='ArrowLeft')next--;else if(event.key==='ArrowDown')next+=columns;else if(event.key==='ArrowUp')next-=columns;else if(event.key==='Home')next=0;else if(event.key==='End')next=buttons.length-1;else return;
    event.preventDefault();buttons[Math.max(0,Math.min(buttons.length-1,next))]?.focus();
  });
  dialog.addEventListener('keydown',event=>{event.stopPropagation();if(event.isComposing||queryComposing)return;if(event.key==='Escape'){event.preventDefault();close();return;}if((event.ctrlKey||event.metaKey)&&['s','o','n'].includes(event.key.toLowerCase())||event.key==='F5'){event.preventDefault();status.textContent='도형 선택을 마친 뒤 파일 작업이나 발표를 실행하세요.';}});
  return{open,close,sync(){if(dialog.open&&!opening&&captured!==context())close();},get busy(){return dialog.open;}};
}
