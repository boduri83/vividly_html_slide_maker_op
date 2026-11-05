/** Self-contained player extension; serialized into independent HTML with the shared player. */
export function createWebRuntime({root,document:authored,getValues=()=>({}),setValues=()=>false,onLayout=()=>{},goTo=()=>false,openLink,saveData,openPanel=()=>false,closePanel=()=>false}={}){
  if(!root||!authored)return null;
  if(!authored.webForms?.length&&!authored.slides.some(slide=>slide.elements.some(element=>element.web)))return null;
  const owner=root.ownerDocument,win=owner.defaultView||globalThis,forms=new Map((authored.webForms||[]).map(f=>[f.id,f]));
  const allElements=authored.slides.flatMap(slide=>slide.elements),byId=new Map(allElements.map(e=>[e.id,e])),variables=new Map((authored.behavior?.variables||[]).map(v=>[v.id,v]));
  const selectedFilters=new Map(),loaded=new Set(),listeners=[],urls=new Set(),downloads=new WeakSet(),composing=new Set();let nodes=new Map(),slideId=null,destroyed=false,announcer=null;
  const style=owner.createElement('style');style.dataset.vividlyOwned='web';style.textContent='.vividly-runtime-root [data-web-filtered=true]{display:none!important}.vividly-runtime-root [data-web-control]:focus-visible{outline:3px solid #635bff;outline-offset:3px}.vividly-web-status{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);max-width:min(600px,90vw);padding:10px 16px;background:#182337;color:white;border-radius:8px;font:13px/1.5 sans-serif;z-index:99999;pointer-events:none}.vividly-web-status:empty{display:none}';root.append(style);
  const on=(target,type,handler,options)=>{target.addEventListener(type,handler,options);listeners.push(()=>target.removeEventListener(type,handler,options));};
  function message(text){if(!announcer){announcer=owner.createElement('div');announcer.className='vividly-web-status';announcer.dataset.vividlyOwned='web';announcer.setAttribute('role','status');announcer.setAttribute('aria-live','polite');root.append(announcer);}announcer.textContent=text;}
  function storage(form){try{return form.persistence==='local'?win.localStorage:form.persistence==='session'?win.sessionStorage:null;}catch{return null;}}
  const storageKey=form=>'vividly-form/v1/'+encodeURIComponent(authored.id)+'/'+encodeURIComponent(form.id);
  function validEmail(value){return typeof value==='string'&&value.length<=4096&&/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value)&&!/[\r\n]/.test(value);}
  function formValues(form,values=getValues()){
    const output={};for(const field of form.fields)output[field.key]=values[field.variableId]??variables.get(field.variableId)?.initial??'';return output;
  }
  function validate(form,values=formValues(form)){
    for(const field of form.fields){const value=values[field.key],label=field.label||field.key;
      if(field.required&&(value===false||value===null||value===undefined||typeof value==='string'&&!value.trim()))return {field,message:label+'을(를) 입력하세요.'};
      if(typeof value==='string'&&value.length>(field.maxLength??4096))return {field,message:label+'의 길이를 줄여 주세요.'};
      if(field.type==='email'&&value&&!validEmail(value))return {field,message:label+'에 올바른 이메일을 입력하세요.'};
      const definition=variables.get(field.variableId);if(!definition)return {field,message:'입력 변수를 찾을 수 없습니다.'};
      if(definition.type==='number'&&(typeof value!=='number'||!Number.isFinite(value)||value<(definition.minimum??-1e12)||value>(definition.maximum??1e12))||definition.type==='boolean'&&typeof value!=='boolean'||['text','choice'].includes(definition.type)&&typeof value!=='string'||definition.type==='choice'&&!definition.options.some(o=>o.value===value))return {field,message:label+'의 입력 값을 확인하세요.'};
    }return null;
  }
  function errorField(error){message(error.message);const input=authored.slides.flatMap(s=>s.behavior?.inputs||[]).find(i=>i.variableId===error.field.variableId&&nodes.has(i.targetId)),control=input&&nodes.get(input.targetId)?.querySelector('[data-behavior-input]');if(control){control.setCustomValidity(error.message);control.reportValidity();control.focus();}}
  function load(form){if(loaded.has(form.id))return;loaded.add(form.id);const target=storage(form);if(!target)return;try{const raw=target.getItem(storageKey(form));if(!raw)return;if(raw.length>256*1024)throw Error('저장한 입력이 너무 큽니다.');const data=JSON.parse(raw);if(!data||data.version!==1||!data.values||typeof data.values!=='object'||Array.isArray(data.values))throw Error('저장 형식을 확인하세요.');const patch={},values=formValues(form);for(const field of form.fields)if(Object.hasOwn(data.values,field.key)){values[field.key]=data.values[field.key];patch[field.variableId]=data.values[field.key];}if(validate(form,values))throw Error('저장한 입력 값이 현재 폼과 다릅니다.');if(!setValues(patch))throw Error('저장한 입력을 적용할 수 없습니다.');}catch{message('저장한 입력을 읽지 못했습니다. 현재 초기 값으로 계속합니다.');}}
  function save(form,web){if(composing.size){message('입력 조합을 마친 뒤 저장하세요.');return;}const values=formValues(form),error=validate(form,values);if(error){errorField(error);return;}
    const target=storage(form);if(form.persistence!=='none'&&!target){message('이 환경에서는 브라우저에 저장할 수 없습니다. 내용을 내보내 보관하세요.');return;}
    try{target?.setItem(storageKey(form),JSON.stringify({version:1,values}));if(web.closePanelId)closePanel(web.closePanelId);message(form.persistence==='none'?'현재 화면에 입력 내용을 반영했습니다.':'현재 브라우저에 입력 내용을 저장했습니다.');}catch{message('화면에는 반영했지만 저장소에 쓰지 못했습니다. 내용을 내보내 보관하세요.');}}
  async function exportForm(form){if(composing.size){message('입력 조합을 마친 뒤 내보내세요.');return;}const values=formValues(form),error=validate(form,values);if(error){errorField(error);return;}
    if(saveData){try{const result=await saveData({name:form.name,values});if(!destroyed)message(result?.canceled?'내보내기를 취소했습니다.':'입력 내용을 JSON 파일로 내보냈습니다.');}catch(error){if(!destroyed)message('입력 내용을 내보내지 못했습니다: '+error.message);}return;}
    const name=(form.name||'입력-내용').replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').slice(0,120),url=win.URL.createObjectURL(new win.Blob([JSON.stringify(values,null,2)],{type:'application/json;charset=utf-8'}));urls.add(url);const link=owner.createElement('a');link.href=url;link.download=name+'.json';downloads.add(link);root.append(link);link.click();link.remove();message('입력 내용을 JSON 파일로 내보냈습니다.');
  }
  function resetForm(form){const patch={};for(const field of form.fields)patch[field.variableId]=variables.get(field.variableId)?.initial??'';if(!setValues(patch))return;try{storage(form)?.removeItem(storageKey(form));message('입력 내용을 초기 값으로 되돌렸습니다.');}catch{message('화면은 초기화했지만 저장소의 기록은 지우지 못했습니다.');}refresh();}
  function memberIds(element){const result=new Set(),visit=id=>{if(result.has(id))return;result.add(id);const item=byId.get(id);for(const child of [...(item?.flow?.children||[]),...(item?.composition?.children||[])])visit(child);};visit(element.id);if(element.groupId)for(const member of allElements)if(member.groupId===element.groupId)visit(member.id);return result;}
  function applyFilters(){let changed=false;const hiddenIds=new Set();for(const element of allElements){if(element.web?.kind!=='filterItem')continue;const value=selectedFilters.get(element.web.group)||'all';if(value!=='all'&&element.web.value!==value)for(const id of memberIds(element))hiddenIds.add(id);}
    for(const [id,node]of nodes){const hidden=hiddenIds.has(id);if((node.dataset.webFiltered==='true')!==hidden){if(hidden)node.dataset.webFiltered='true';else delete node.dataset.webFiltered;changed=true;}const web=byId.get(id)?.web;if(web?.kind==='filterButton')node.setAttribute('aria-pressed',String((selectedFilters.get(web.group)||'all')===web.value));}
    if(changed)onLayout();return hiddenIds;
  }
  function scrollTo(id){const targetSlide=authored.slides.find(s=>s.elements.some(e=>e.id===id));if(!targetSlide)return false;if(targetSlide.id!==slideId)goTo(targetSlide.id);const node=root.querySelector('[data-element-id="'+win.CSS.escape(id)+'"]');if(!node)return false;const stickyHeight=Math.max(0,...[...root.querySelectorAll('[data-responsive-sticky]')].map(item=>item.getBoundingClientRect().height));node.style.scrollMarginTop=Math.ceil(stickyHeight+28)+'px';node.tabIndex=node.tabIndex<0?-1:node.tabIndex;node.focus({preventScroll:true});node.scrollIntoView({behavior:win.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});return true;}
  function activate(id){const element=byId.get(id),web=element?.web;if(!web||element.design?.disabled||element.hidden)return false;
    if(web.kind==='filterButton'){selectedFilters.set(web.group,web.value);applyFilters();message((web.value==='all'?'전체':web.value)+' 항목을 표시합니다.');return true;}
    if(web.kind==='scrollLink'){scrollTo(web.targetId);return true;}
    if(web.kind==='emailLink'){const email=getValues()[web.variableId];if(validEmail(email)){const href='mailto:'+encodeURIComponent(email).replaceAll('%40','@');if(openLink)openLink(href);else{const link=owner.createElement('a');link.href=href;root.append(link);link.click();link.remove();}}else if(web.emptyPanelId)openPanel(web.emptyPanelId);else message('이메일 입력을 먼저 확인하세요.');return true;}
    if(web.kind==='formAction'){const form=forms.get(web.formId);if(!form)return false;if(web.action==='save')save(form,web);else if(web.action==='export')exportForm(form);else resetForm(form);return true;}return false;
  }
  function eventControl(event){const node=event.target.closest?.('[data-web-control]');if(!node||!root.contains(node)||node.closest('[hidden]')||node.dataset.webFiltered==='true'||node.getAttribute('aria-disabled')==='true')return null;return node;}
  on(root,'click',event=>{const node=eventControl(event);if(node&&activate(node.dataset.elementId)){event.preventDefault();event.stopImmediatePropagation();}},true);
  on(root,'keydown',event=>{if(event.isComposing||!['Enter',' '].includes(event.key)||event.target.closest?.('input,textarea,select,[contenteditable=true]'))return;const node=eventControl(event);if(node&&activate(node.dataset.elementId)){event.preventDefault();event.stopImmediatePropagation();}},true);
  on(root,'input',event=>{event.target.setCustomValidity?.('');},true);
  on(root,'compositionstart',event=>{if(event.target.matches?.('[data-behavior-input]'))composing.add(event.target);},true);on(root,'compositionend',event=>composing.delete(event.target),true);
  function refresh(){if(destroyed)return;const values=getValues();for(const [id,node]of nodes){const web=byId.get(id)?.web;if(web?.kind==='emailLink'){const available=validEmail(values[web.variableId]);node.dataset.emailAvailable=String(available);node.setAttribute('aria-label',available?'이메일 보내기':'연락처 입력 열기');}}}
  function sync(context){if(destroyed)return;nodes=context.nodes;slideId=context.slideId;for(const [id,node]of nodes){const web=byId.get(id)?.web;if(web&&web.kind!=='filterItem'){node.dataset.webControl=web.kind;node.setAttribute('role','button');node.tabIndex=byId.get(id).design?.disabled?-1:0;}}
    for(const form of forms.values())load(form);applyFilters();refresh();
  }
  return{sync,refresh,activate,ownsDownload:link=>downloads.has(link)&&Boolean(link.download)&&urls.has(link.href),getState:()=>({filters:Object.fromEntries(selectedFilters)}),destroy(){if(destroyed)return;destroyed=true;listeners.forEach(remove=>remove());for(const url of urls)win.URL.revokeObjectURL(url);urls.clear();composing.clear();announcer?.remove();style.remove();for(const node of root.querySelectorAll('[data-web-filtered],[data-web-control]')){delete node.dataset.webFiltered;delete node.dataset.webControl;delete node.dataset.emailAvailable;}}};
}
