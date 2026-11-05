import { getLayoutSlots } from './master-model.js';
const TEXT_ROLES=new Set(['title','subtitle','body','text']);
const LABELS={title:'제목을 입력하세요',subtitle:'부제를 입력하세요',body:'본문을 입력하세요',text:'내용을 입력하세요',image:'이미지를 선택하세요',chart:'차트를 추가하세요',table:'표를 추가하세요',video:'동영상을 선택하세요'};
const ICONS={image:'image',chart:'chart',table:'table',video:'play'};
const CSS=`
#lp-overlay{position:absolute;inset:0;pointer-events:none;z-index:10;overflow:hidden}
#lp-overlay[hidden]{display:none!important}
#stage.dw-tool-active #lp-overlay,#stage.dw-gesture #lp-overlay{display:none!important}
#lp-overlay .lp-slot-frame{position:absolute;display:flex;align-items:center;justify-content:center;border:1.5px dashed #8d9fbd88;border-radius:3px;pointer-events:none;box-sizing:border-box;overflow:hidden;transform-origin:center}
#lp-overlay .lp-placeholder{pointer-events:auto;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:8px;width:calc(100% - 22px);height:calc(100% - 22px);min-height:0;min-width:0;margin:0;padding:6px 10px;border:0;border-radius:5px;background:transparent;color:inherit;white-space:normal;overflow:hidden;cursor:text;line-height:1.5;box-sizing:border-box;font-family:"Malgun Gothic",Arial,sans-serif}
#lp-overlay .lp-placeholder[data-slot-role=image],#lp-overlay .lp-placeholder[data-slot-role=chart],#lp-overlay .lp-placeholder[data-slot-role=table],#lp-overlay .lp-placeholder[data-slot-role=video]{cursor:pointer}
#lp-overlay .lp-placeholder:hover,#lp-overlay .lp-placeholder:focus-visible{background:#819bd914;outline:2px solid #8a9fe355;outline-offset:-2px}
#lp-overlay .lp-placeholder img{width:30px;height:30px;opacity:.7;pointer-events:none}
#lp-overlay .lp-prompt{max-width:100%;overflow-wrap:anywhere;text-align:center;opacity:.72;pointer-events:none}
`;

/** Empty input prompts are editor overlays, never authored sample text or exported decoration. */
export function isEmptyLayoutPlaceholder(element,role){
  if(!element||element.hidden||element.locked||element.binding)return false;
  const emptyText=Boolean(element.text)&&element.text.paragraphs.every(value=>!value.trim());
  if(TEXT_ROLES.has(role))return emptyText;
  return element.type==='shape'&&emptyText;
}
export function createLayoutPlaceholderWorkbench({store,action,beginText,insertImage,insertVideo,insertChart,insertTable,notice,blocked=()=>false}){
  const style=document.createElement('style');style.id='layout-placeholder-ui-style';style.textContent=CSS;document.head.append(style);
  const overlay=document.createElement('div');overlay.id='lp-overlay';overlay.setAttribute('aria-label','레이아웃 내용 입력');document.getElementById('stage').append(overlay);
  let busy=false;
  function slots(){const slide=store.activeSlide,layout=store.document.layouts?.find(l=>l.id===slide.layout?.layoutId);if(!layout)return[];return getLayoutSlots(layout).map(slot=>{const elementId=slide.layout.elementMap[slot.elementId],element=slide.elements.find(e=>e.id===elementId);return{slot,element,target:{sessionId:store.sessionId,revision:store.revision,slideId:slide.id,elementId,slotKey:slot.key,role:slot.role}};}).filter(item=>item.element&&isEmptyLayoutPlaceholder(item.element,item.slot.role));}
  function selectedSlot(role){return slots().find(item=>store.selectedIds.includes(item.target.elementId)&&(!role||item.slot.role===role))?.target||null;}
  async function activate(target){
    if(busy||blocked())return;const item=slots().find(item=>item.target.elementId===target.elementId);if(!item)return;
    if(target.sessionId!==store.sessionId||target.revision!==store.revision||target.slideId!==store.activeSlideId)return;
    busy=true;
    try{
      await action(()=>store.selectElement(target.elementId));
      if(target.sessionId!==store.sessionId||target.revision!==store.revision||target.slideId!==store.activeSlideId||!store.selectedIds.includes(target.elementId))return;
      if(TEXT_ROLES.has(target.role))beginText?.(target.elementId);
      else{const callback={image:insertImage,chart:insertChart,table:insertTable,video:insertVideo}[target.role];if(callback)await callback(target);else notice?.('이 입력 자리의 내용 도구를 열 수 없습니다.',true);}
    }catch(error){notice?.(error.message,true);}finally{busy=false;}
  }
  overlay.addEventListener('pointerdown',event=>{if(event.target.closest('.lp-placeholder'))event.stopPropagation();});
  overlay.addEventListener('dblclick',event=>{if(event.target.closest('.lp-placeholder'))event.stopPropagation();});
  overlay.addEventListener('click',event=>{const button=event.target.closest('[data-placeholder-element]');if(!button)return;event.stopPropagation();const item=slots().find(item=>item.target.elementId===button.dataset.placeholderElement);if(item)activate(item.target);});
  function sync(){
    const unavailable=blocked()||Boolean(store.transformSession);overlay.hidden=unavailable;if(unavailable){overlay.replaceChildren();return;}
    const fragment=document.createDocumentFragment();
    for(const{slot,element,target}of slots()){
      if(store.textSession?.elementId===element.id)continue;
      const frame=document.createElement('div');frame.className='lp-slot-frame';frame.dataset.placeholderFrame=element.id;Object.assign(frame.style,{left:element.geometry.x+'px',top:element.geometry.y+'px',width:element.geometry.width+'px',height:element.geometry.height+'px',transform:`rotate(${element.rotation||0}deg)`,color:element.text?.textStyle?.color||'#627b9f'});
      const button=document.createElement('button');button.type='button';button.className='lp-placeholder';button.dataset.placeholderElement=element.id;button.dataset.slotKey=slot.key;button.dataset.slotRole=slot.role;button.setAttribute('aria-label',slot.prompt||LABELS[slot.role]||'내용 입력');button.title=TEXT_ROLES.has(slot.role)?'클릭해 내용을 입력합니다. 바깥 점선 부근에서는 위치를 조절할 수 있습니다.':'클릭해 파일이나 내용을 추가합니다.';
      if(TEXT_ROLES.has(slot.role)){const align=element.text?.textStyle?.align||'left',vertical=element.text?.textStyle?.verticalAlign||'top';button.style.alignItems=align==='center'?'center':align==='right'?'flex-end':'flex-start';button.style.justifyContent=vertical==='middle'?'center':vertical==='bottom'?'flex-end':'flex-start';}
      if(ICONS[slot.role]&&element.geometry.height>100){const icon=document.createElement('img');icon.src='/assets/ui/'+ICONS[slot.role]+'.svg';icon.alt='';icon.setAttribute('aria-hidden','true');button.append(icon);}
      const prompt=document.createElement('span');prompt.className='lp-prompt';prompt.textContent=slot.prompt||LABELS[slot.role]||'내용 입력';prompt.style.fontSize=(TEXT_ROLES.has(slot.role)?Math.min(40,Math.max(16,element.text?.textStyle?.fontSize||24)):Math.min(28,Math.max(16,element.geometry.height*.18)))+'px';if(TEXT_ROLES.has(slot.role))prompt.style.textAlign=element.text?.textStyle?.align||'left';button.append(prompt);frame.append(button);fragment.append(frame);
    }
    overlay.replaceChildren(fragment);
  }
  sync();return{sync,selectedSlot,getSelectedSlot:selectedSlot,get busy(){return busy;},destroy(){overlay.remove();style.remove();}};
}
