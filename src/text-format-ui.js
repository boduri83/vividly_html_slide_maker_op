import { safeRichHref } from './rich-text-conversion.js';

const marks=['bold','italic','underline','strike'];
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const glyphs={bold:'<b>B</b>',italic:'<i>I</i>',underline:'<u>U</u>',strike:'<s>S</s>'};
const labels={bold:'굵게',italic:'기울임',underline:'밑줄',strike:'취소선'};
const keys={bold:'Ctrl+B',italic:'Ctrl+I',underline:'Ctrl+U',strike:'Ctrl+Shift+X'};

/** Read the plain editor's UTF-16 range before promotion to the rich draft engine. */
export function readPlainTextSelection(mount){
  const fields=[...mount.querySelectorAll('textarea')],active=mount.ownerDocument.activeElement,index=fields.indexOf(active);
  return index<0?null:{paragraph:index,start:active.selectionStart,end:active.selectionEnd};
}

/** Whole-object formatting removes only the same run override; links and other marks survive. */
export function textFormatCommands(elements,mark,enabled){
  if(!marks.includes(mark)||typeof enabled!=='boolean')throw new Error('유효한 글자 서식이 필요합니다.');
  return elements.filter(e=>e.text).flatMap(element=>{
    const commands=[{id:'text.set_style',params:{elementId:element.id,style:{[mark]:enabled}}}];
    if(element.text.runs?.some(run=>Object.hasOwn(run,mark))){
      const runs=element.text.runs.map(run=>{const next={...run};delete next[mark];return next;}).filter(run=>Object.keys(run).some(key=>!['paragraph','start','end'].includes(key)));
      commands.push({id:'text.set_runs',params:{elementId:element.id,runs}});
    }
    return commands;
  });
}
export function isObjectHyperlink(rule,elementId){return rule.sourceId===elementId&&rule.event==='click'&&!rule.condition&&!rule.trigger&&rule.actions.length===1&&['openLink','goToSlide'].includes(rule.actions[0].type);}
export function objectHyperlinkCommands(document,slideId,elementId,destination){
  const slide=document.slides.find(s=>s.id===slideId),element=slide?.elements.find(e=>e.id===elementId);
  if(!element||element.locked||element.hidden)throw new Error('편집 가능한 개체를 선택하세요.');
  const original=slide.interactions||[],prior=original.find(rule=>isObjectHyperlink(rule,elementId));
  const interactions=original.filter(rule=>!isObjectHyperlink(rule,elementId));
  if(destination){
    const action=destination.kind==='url'?{type:'openLink',href:safeRichHref(destination.href)}:destination.kind==='slide'&&document.slides.some(s=>s.id===destination.slideId)?{type:'goToSlide',targetId:destination.slideId}:null;
    if(!action)throw new Error('이동할 주소나 슬라이드를 선택하세요.');
    const rule={id:prior?.id||'hyperlink-'+crypto.randomUUID(),sourceId:elementId,event:'click',actions:[action]};
    // Preserve the existing position relative to non-navigation click behavior.
    interactions.splice(prior?original.slice(0,original.indexOf(prior)).filter(rule=>!isObjectHyperlink(rule,elementId)).length:interactions.length,0,rule);
  }
  return [{id:'slide.set_interactions',params:{slideId,interactions}}];
}

/** Direct ribbon formatting and a single discoverable hyperlink dialog share the normal command boundary. */
export function createTextFormatWorkbench({store,action,notice,getRichEditor=()=>null,ensureRichEditor=()=>null,composing=()=>false,blocked=()=>false,updateStatus}){
  const $=id=>document.getElementById(id),host=$('property-bold').parentElement;
  for(const mark of marks){let button=$('property-'+mark);if(!button){button=document.createElement('button');button.id='property-'+mark;host.append(button);}button.type='button';button.innerHTML=glyphs[mark];button.classList.add('ribbon-font-toggle');button.setAttribute('aria-label',labels[mark]);button.setAttribute('aria-pressed','false');button.title=`${labels[mark]} (${keys[mark]}) · 글자를 선택하면 부분 적용, 개체를 선택하면 전체 적용`;
    button.addEventListener('pointerdown',event=>event.preventDefault());button.addEventListener('click',()=>toggle(mark));}
  const style=document.createElement('style');style.id='text-format-ui-style';style.textContent=`.ribbon-font-toggle{min-width:29px!important;width:29px;padding:4px!important;font-size:14px!important;justify-content:center!important}.ribbon-font-toggle[aria-pressed=true]{background:#dfe5ff!important;border-color:#8fa0eb!important;color:#2d3d91!important}.ribbon-font-toggle[aria-pressed=mixed]{background:linear-gradient(135deg,#e4e9ff 50%,#fff 50%)!important}.text-link-dialog{width:min(540px,92vw);padding:22px;border:1px solid #ccd6ed;border-radius:14px;box-shadow:0 24px 80px #17243f44;color:#23324c}.text-link-dialog::backdrop{background:#18203766}.text-link-dialog h2{margin:0 0 8px;font-size:19px}.text-link-dialog p{font-size:12px;line-height:1.7;color:#70809b}.text-link-dialog label{display:flex;flex-direction:column;gap:6px;margin:15px 0;font-size:12px}.text-link-dialog input,.text-link-dialog select{width:100%;padding:9px;border:1px solid #c9d4e9;border-radius:6px}.text-link-dialog footer{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}.text-link-dialog [role=alert]{min-height:20px;margin:8px 0;color:#aa3547}`;document.head.append(style);
  const dialog=document.createElement('dialog');dialog.id='hl-dialog';dialog.className='text-link-dialog';dialog.setAttribute('aria-labelledby','hl-title');dialog.innerHTML=`<h2 id="hl-title">하이퍼링크</h2><p id="hl-context"></p><label>적용 범위<select id="hl-target"><option value="object">개체 전체</option><option value="text">선택한 글자</option></select></label><label>연결할 곳<select id="hl-kind"><option value="url">웹 주소 · 이메일</option><option value="slide">이 자료의 슬라이드</option></select></label><label id="hl-url-label">주소<input id="hl-url" type="text" inputmode="url" maxlength="2048" placeholder="https://example.com 또는 mailto:team@example.com"></label><label id="hl-slide-label" hidden>이동할 슬라이드<select id="hl-slide"></select></label><p class="property-help">발표 중 클릭하면 연결한 곳으로 이동합니다. 웹 주소는 http·https·mailto를 지원합니다.</p><p id="hl-status" role="alert"></p><footer><button id="hl-remove">링크 해제</button><button id="hl-cancel">취소</button><button id="hl-apply" class="primary-button">적용</button></footer>`;document.body.append(dialog);
  let context=null,priorFocus=null;
  const editableElements=()=>store.selectedElements.filter(e=>e.text&&!e.locked&&!e.hidden);
  function currentRich(){return store.textSession?getRichEditor():null;}
  async function toggle(mark){
    if(blocked()||composing()){notice('현재 편집을 마친 뒤 글자 서식을 바꿔 주세요.');return;}
    const editor=store.textSession?(currentRich()||ensureRichEditor()):null;
    if(editor){editor.toggleMark(mark);sync();updateStatus?.();return;}
    const elements=editableElements();if(!elements.length)return;
    const enabled=!elements.every(e=>!!e.text.textStyle[mark]);
    await action(()=>store.runBatch(textFormatCommands(elements,mark,enabled),labels[mark]+' 적용'));
  }
  function close(restore=true){if(dialog.open)dialog.close();context=null;if(restore&&priorFocus?.isConnected)priorFocus.focus({preventScroll:true});updateStatus?.();}
  function choices(){const text=$('hl-target').value==='text',slide=$('hl-kind').value==='slide'&&!text;if(text)$('hl-kind').value='url';$('hl-kind').querySelector('[value=slide]').disabled=text;$('hl-url-label').hidden=slide;$('hl-slide-label').hidden=!slide;}
  function openLink(mode='auto'){
    if(blocked()||composing())return;
    if(dialog.open){$('hl-url').focus();return;}
    if(document.querySelector('dialog[open]')){notice('열려 있는 편집 창을 먼저 마치세요.');return;}
    const element=store.selectedElement;if(store.selectedIds.length!==1||!element||element.locked||element.hidden){notice('링크를 연결할 개체 하나를 선택하세요.');return;}
    const plain=store.textSession?readPlainTextSelection($('text-editor')):null;
    const rich=currentRich()||(plain&&plain.start!==plain.end?ensureRichEditor():null);
    rich?.captureSelection();const textAvailable=Boolean(rich&&(rich.hasSelection()||rich.getLink()));
    const rule=(store.activeSlide.interactions||[]).find(rule=>isObjectHyperlink(rule,element.id)),destination=rule?.actions[0];
    priorFocus=document.activeElement;context={sessionId:store.sessionId,slideId:store.activeSlideId,elementId:element.id,rich};
    $('hl-context').textContent=element.name||element.text?.paragraphs.find(Boolean)||'선택한 개체';
    $('hl-target').querySelector('[value=text]').disabled=!textAvailable;$('hl-target').value=mode!=='object'&&textAvailable?'text':'object';
    $('hl-slide').innerHTML=store.document.slides.map((slide,index)=>`<option value="${escape(slide.id)}">${index+1}. ${escape(slide.name||slide.elements.find(e=>e.text)?.text.paragraphs.find(Boolean)||'슬라이드')}</option>`).join('');
    const href=$('hl-target').value==='text'?rich.getLink():destination?.type==='openLink'?destination.href:'';
    $('hl-url').value=href;$('hl-kind').value=$('hl-target').value==='object'&&destination?.type==='goToSlide'?'slide':'url';$('hl-slide').value=destination?.type==='goToSlide'?destination.targetId:store.activeSlideId;
    $('hl-status').textContent='';choices();dialog.showModal();($('hl-kind').value==='slide'?$('hl-slide'):$('hl-url')).focus();updateStatus?.();
  }
  function validContext(){return context?.sessionId===store.sessionId&&context.slideId===store.activeSlideId&&store.activeSlide.elements.some(e=>e.id===context.elementId&&!e.hidden&&!e.locked);}
  async function apply(remove=false){
    if(!validContext()){close(false);notice('자료나 선택이 바뀌었습니다. 링크를 다시 선택하세요.',true);return;}
    try{
      const captured=context,text=$('hl-target').value==='text';
      if(text){if(captured.rich!==currentRich()||captured.rich.isComposing)throw new Error('선택한 글자를 다시 확인하세요.');const href=remove?null:safeRichHref($('hl-url').value.trim());close(false);if(remove)captured.rich.clearLink();else captured.rich.setLink(href);captured.rich.element.focus();sync();updateStatus?.();return;}
      const destination=remove?null:$('hl-kind').value==='slide'?{kind:'slide',slideId:$('hl-slide').value}:{kind:'url',href:safeRichHref($('hl-url').value.trim())};
      close(false);
      await action(()=>{if(captured.sessionId!==store.sessionId)throw new Error('자료가 바뀌었습니다.');store.runBatch(objectHyperlinkCommands(store.document,captured.slideId,captured.elementId,destination),remove?'하이퍼링크 해제':'하이퍼링크 적용');notice(remove?'링크를 해제했습니다.':'발표에서 클릭할 수 있는 링크를 연결했습니다.');});
    }catch(error){$('hl-status').textContent=error.message;}
  }
  $('hl-target').addEventListener('change',()=>{const rich=context?.rich;if($('hl-target').value==='text')$('hl-url').value=rich?.getLink()||'';else{const rule=(store.activeSlide.interactions||[]).find(rule=>isObjectHyperlink(rule,context.elementId));$('hl-url').value=rule?.actions[0].type==='openLink'?rule.actions[0].href:'';$('hl-kind').value=rule?.actions[0].type==='goToSlide'?'slide':'url';if($('hl-kind').value==='slide')$('hl-slide').value=rule.actions[0].targetId;}choices();});
  $('hl-kind').addEventListener('change',choices);$('hl-apply').onclick=()=>apply();$('hl-remove').onclick=()=>apply(true);$('hl-cancel').onclick=()=>close();dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
  dialog.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing&&!e.target.closest('button')){e.preventDefault();apply();}if((e.ctrlKey||e.metaKey)&&['s','o','n'].includes(e.key.toLowerCase())||e.key==='F5'){e.preventDefault();e.stopImmediatePropagation();$('hl-status').textContent='링크를 적용하거나 취소한 뒤 실행하세요.';}});
  document.addEventListener('keydown',e=>{if(e.defaultPrevented||e.isComposing||composing()||blocked()||document.querySelector('dialog[open]')||$('presentation')?.hidden===false)return;if(!(e.ctrlKey||e.metaKey)||e.altKey)return;const target=e.target;if(target.closest?.('#slide-list,#slide-context-menu'))return;if(target.closest?.('input,textarea,select,[contenteditable=true]')&&!target.closest?.('#text-editor'))return;const key=e.key.toLowerCase(),mark=key==='b'?'bold':key==='i'?'italic':key==='u'?'underline':key==='x'&&e.shiftKey?'strike':null;if(!mark&&key!=='k')return;e.preventDefault();e.stopImmediatePropagation();if(key==='k')openLink();else toggle(mark);},true);
  function sync(){const elements=editableElements(),editor=currentRich();let state=null;if(editor)try{state=editor.formatState();}catch{}for(const mark of marks){const button=$('property-'+mark),values=elements.map(e=>!!e.text.textStyle[mark]);button.disabled=blocked()||composing()||(!elements.length&&!editor);const active=state?String(state[mark]):new Set(values).size>1?'mixed':String(values.length>0&&values[0]);button.setAttribute('aria-pressed',active);}if(dialog.open&&!validContext())close(false);}
  window.addEventListener('vividly:rich-format-state',sync);sync();return{sync,openLink,close,toggle,get busy(){return dialog.open;}};
}
