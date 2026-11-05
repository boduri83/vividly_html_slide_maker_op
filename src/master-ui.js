import { renderSlideContent } from './render.js';
import { resolveLayout, getLayoutSlots } from './master-model.js';
import { createLayoutPresets } from './layout-presets.js';
const $=id=>document.getElementById(id);
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const CANVAS_PRESETS=[['wide','와이드 16:9',1280,720],['standard','일반 4:3',1200,900],['square','정사각 1:1',1080,1080],['portrait34','세로 3:4',900,1200],['portrait','세로 9:16',720,1280]];
const ROLE_NAMES={title:'제목',subtitle:'부제',body:'본문',text:'글',image:'이미지',chart:'차트',table:'표',video:'동영상'};
const PRESET_DESCRIPTIONS={title:'제목과 부제로 시작하는 첫 장',section:'이야기의 새로운 구간을 여는 장',body:'제목과 핵심 내용을 담는 기본 장','two-columns':'두 가지 내용을 나란히 배치',comparison:'두 항목의 차이와 공통점을 비교',image:'큰 이미지와 짧은 설명',chart:'데이터와 핵심 메시지를 함께',video:'동영상 중심의 장면',menu:'클릭으로 이동하는 메뉴 페이지',blank:'직접 자유롭게 구성하는 빈 장'};
const CSS=`
#ms-dialog{width:min(1040px,94vw);height:min(810px,86vh);max-height:86vh;overflow:hidden}
#ms-dialog[open]{display:flex;flex-direction:column}
#ms-dialog>header{padding:19px 23px 15px;align-items:flex-start;border-bottom:1px solid #e0e6f2;flex:none}
#ms-dialog h2{font-size:20px;line-height:1.35;margin:0 0 5px}
#ms-dialog header p{font-size:12px;line-height:1.6;max-width:720px}
#ms-dialog button,#ms-dialog input{font:inherit}
#ms-dialog #ms-close{flex:none;padding:7px 12px;font-size:12px}
#ms-dialog .ms-gallery-tools{display:flex;align-items:center;gap:14px;justify-content:space-between;padding:10px 23px;border-bottom:1px solid #e1e7f3;background:white;flex:none}
#ms-dialog .ms-gallery-tools label{display:flex;align-items:center;gap:8px;color:#6b7c98;font-size:11px;min-width:0}
#ms-dialog #ms-search{width:225px;max-width:40vw;padding:7px 10px;border:1px solid #d4ddeb;border-radius:6px;font-size:12px}
#ms-dialog #ms-current-label{font-size:11px;color:#61738f;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#ms-dialog .ms-gallery{display:block;flex:1;min-height:0;max-height:none;padding:0 23px 20px;overflow:auto;background:#f5f7fc;scrollbar-width:thin}
#ms-dialog .ms-layout-group>h3{display:flex;align-items:center;gap:8px;margin:18px 0 10px;font-size:12px;color:#4d6080}
#ms-dialog .ms-layout-group>h3 small{font-size:10px;color:#8b98ac;font-weight:400}
#ms-dialog .ms-layout-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px}
#ms-dialog .ms-card{position:relative;border:1px solid #d9e1ee;border-radius:9px;background:white;overflow:hidden;padding:0;min-width:0;box-shadow:0 2px 5px #20395d04}
#ms-dialog .ms-card[data-current=true]{border-color:#7166dd;box-shadow:0 0 0 1px #7166dd}
#ms-dialog .ms-layout-choose{display:flex;flex-direction:column;width:100%;border:0;border-radius:0;background:white;text-align:left;padding:8px 8px 9px;min-width:0;gap:0;color:#243653}
#ms-dialog .ms-layout-choose:hover{background:#eef2ff}
#ms-dialog .ms-layout-choose:focus-visible{outline:3px solid #8a80f0;outline-offset:-3px}
#ms-dialog .ms-preview{height:123px;width:100%;border-radius:5px;background:#e9eef7;overflow:hidden;position:relative;pointer-events:none;border:1px solid #e7ebf4}
#ms-dialog .ms-preview>div{position:absolute;left:50%;top:50%;transform-origin:center}
#ms-dialog .ms-layout-choose strong{display:block;font-size:12px;line-height:1.5;margin:10px 3px 3px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#ms-dialog .ms-layout-choose small{display:block;font-size:10px;line-height:1.5;margin:0 3px;color:#7b8ca5;min-height:15px}
#ms-dialog .ms-card-meta{display:flex;align-items:center;justify-content:space-between;gap:5px;padding:6px 10px;border-top:1px solid #edf0f6;min-height:30px;font-size:10px;color:#8a98ad}
#ms-dialog .ms-current-badge{color:#6256c9;font-weight:700}
#ms-dialog .ms-card-menu{position:relative;margin-left:auto}
#ms-dialog .ms-card-menu>summary{cursor:pointer;list-style:none;font-size:10px;color:#677b98;padding:2px 4px}
#ms-dialog .ms-card-menu>div{display:flex;gap:4px;flex-wrap:wrap;margin-top:5px}
#ms-dialog .ms-card-menu button{font-size:10px;padding:4px 6px;border:1px solid #dce3ef;background:#f8faff;border-radius:4px;white-space:nowrap}
#ms-dialog .ms-slot-preview{position:absolute;display:flex;align-items:center;justify-content:center;border:2px dashed #8a9bc477;background:#dfe8f71a;color:#7286a7;font:20px/1.4 "Malgun Gothic",sans-serif;text-align:center;overflow:hidden;padding:6px;box-sizing:border-box}
#ms-dialog>footer{padding:12px 23px;gap:14px;border-top:1px solid #e0e6f0;flex:none;background:white;align-items:center}
#ms-dialog #ms-register{font-size:11px;padding:7px 10px;flex:none}
#ms-dialog #ms-status{font-size:11px;line-height:1.6;overflow-wrap:anywhere;text-align:right}
#ms-dialog .studio-empty{margin:35px 0;padding:20px;line-height:1.8;font-size:12px;text-align:center}
@media(max-width:700px){#ms-dialog .ms-layout-grid{grid-template-columns:repeat(2,minmax(0,1fr))}#ms-dialog .ms-gallery-tools{align-items:flex-start;flex-direction:column;gap:6px}#ms-dialog #ms-search{max-width:none;width:200px}#ms-dialog>footer{align-items:flex-start;flex-direction:column;gap:8px}#ms-dialog #ms-status{text-align:left}#ms-dialog .ms-gallery{padding-left:12px;padding-right:12px}.ms-layout-choose strong{font-size:11px}}
`;

/** The same pure preview gallery chooses a type for a new slide or changes existing slides. */
export function createMasterWorkbench({store,workbench,action,notice,openWorkspace}){
  const style=document.createElement('style');style.id='master-layout-gallery-style';style.textContent=CSS;document.head.append(style);
  const panel=document.createElement('section');panel.id='master-workbench';
  panel.innerHTML='<section class="property-section"><h3>마스터 · 레이아웃</h3><p class="property-help">페이지 유형을 골라 장을 시작하고, 공통 디자인은 마스터 보기에서 편집하세요.</p><label class="stacked-label">레이아웃 이름<input id="ms-name" maxlength="160" placeholder="예: 브랜드 · 본문 2열"></label><label class="wb-check"><input id="ms-selected-placeholders" type="checkbox">선택한 내용 개체만 입력 자리로 등록</label><button id="ms-capture" class="wb-wide">현재 장을 새 레이아웃으로 등록</button><button id="ms-update" class="wb-wide">현재 레이아웃 원본 편집</button><p id="ms-current" class="property-help"></p><button id="ms-gallery-open" class="wb-wide primary-button">레이아웃 변경</button><button id="ms-reset" class="wb-wide">레이아웃 다시 설정</button><button id="ms-detach" class="wb-wide">현재 장의 레이아웃 연결 해제</button><p class="property-help">유형을 변경해도 입력한 내용은 유지합니다. 다시 설정은 내용을 남기고 원래 배치와 서식으로 되돌립니다.</p></section>';
  workbench.addInspectorPage('masters','마스터',panel);
  const dialog=document.createElement('dialog');dialog.id='ms-dialog';dialog.className='studio-dialog';dialog.setAttribute('aria-labelledby','ms-title');dialog.setAttribute('aria-describedby','ms-description');
  dialog.innerHTML='<header><div><h2 id="ms-title"></h2><p id="ms-description"></p></div><button id="ms-close" aria-label="레이아웃 선택 닫기">닫기</button></header><div class="ms-gallery-tools"><label>유형 찾기<input id="ms-search" type="search" placeholder="이름 또는 제목·이미지·영상" autocomplete="off"></label><span id="ms-current-label"></span></div><div id="ms-gallery" class="ms-gallery"></div><footer><button id="ms-register">현재 장을 레이아웃으로 등록</button><span id="ms-status" role="status"></span></footer>';
  document.body.append(dialog);let openedSession=null,openedRevision=null,focused=null,signature='',nameOwner='',mode='apply',pending=false,openedSlideIds=[];
  const selectedSlides=()=>{const selected=workbench.selectedSlideIds;return selected.length?[...selected]:[store.activeSlideId];};
  const snapshotSignature=()=>JSON.stringify([store.document.layouts||[],store.document.layoutMasters||[],store.document.canvas,store.activeSlideId,selectedSlides(),mode]);
  function close(){if(dialog.open)dialog.close();openedSession=null;openedRevision=null;openedSlideIds=[];pending=false;focused?.isConnected&&focused.focus();}
  function library(){const presets=createLayoutPresets(store.document.canvas),known=new Set((store.document.layouts||[]).map(l=>l.id));return{...presets,layouts:presets.layouts.filter(l=>!known.has(l.id))};}
  function entries(){const builtins=library();return[...(store.document.layouts||[]).map(layout=>({layout,preset:false})),...builtins.layouts.map(layout=>({layout,preset:true}))];}
  function description(layout){const presetKey=layout.id.startsWith('vividly-layout-')?layout.id.slice('vividly-layout-'.length):null;return PRESET_DESCRIPTIONS[presetKey]||[...new Set(getLayoutSlots(layout).map(s=>ROLE_NAMES[s.role]||'내용'))].join(' · ')||'사용자 정의 배치';}
  function preview(layout,preset){
    const defaults=createLayoutPresets(store.document.canvas),parents=new Map([...defaults.layoutMasters,...(store.document.layoutMasters||[])].map(m=>[m.id,m])),doc=preset?{...store.document,layoutMasters:[...parents.values()]}:store.document;
    const effective=resolveLayout(doc,layout),canvas=effective.canvas||layout.canvas,scale=Math.min(205/canvas.width,119/canvas.height),slide={id:'layout-preview',background:effective.background,elements:effective.elements};
    const slots=getLayoutSlots(layout).map(slot=>{const e=effective.elements.find(e=>e.id===slot.elementId);if(!e)return'';return`<span class="ms-slot-preview" style="left:${e.geometry.x}px;top:${e.geometry.y}px;width:${e.geometry.width}px;height:${e.geometry.height}px">${escape(ROLE_NAMES[slot.role]||'내용')}</span>`;}).join('');
    return`<div class="ms-preview"><div style="width:${canvas.width}px;height:${canvas.height}px;transform:translate(-50%,-50%) scale(${scale});background:${escape(effective.background)}">${renderSlideContent(slide,{...doc,canvas:{...doc.canvas,...canvas}})}${slots}</div></div>`;
  }
  function card(entry){const{layout,preset}=entry,current=store.activeSlide.layout?.layoutId===layout.id,uses=store.document.slides.filter(s=>s.layout?.layoutId===layout.id).length,actionLabel=mode==='new'?'새 슬라이드 만들기':'선택한 장에 적용';return`<article class="ms-card" data-layout-id="${escape(layout.id)}" data-current="${current}"><button class="ms-layout-choose" data-ms-choose="${escape(layout.id)}" ${mode==='new'?'data-ms-create':'data-ms-apply'}="${escape(layout.id)}" data-ms-preset="${preset}" aria-label="${escape(layout.name)} · ${actionLabel}">${preview(layout,preset)}<strong>${escape(layout.name)}</strong><small>${escape(description(layout))}</small></button><div class="ms-card-meta"><span class="${current?'ms-current-badge':''}">${current?'현재 레이아웃':preset?'기본 제공':uses?`${uses}장에 사용 중`:'이 문서의 레이아웃'}</span>${preset?'':`<details class="ms-card-menu"><summary aria-label="${escape(layout.name)} 관리">관리</summary><div><button data-ms-edit="${escape(layout.id)}">원본 편집</button><button data-ms-delete="${escape(layout.id)}">삭제</button></div></details>`}</div></article>`;}
  function paint(){
    signature=snapshotSignature();const all=entries(),query=$('ms-search').value.trim().toLocaleLowerCase(),filtered=all.filter(({layout})=>(layout.name+' '+description(layout)).toLocaleLowerCase().includes(query)),groups=new Map();
    for(const entry of filtered){const parent=(store.document.layoutMasters||[]).find(m=>m.id===entry.layout.masterId),key=entry.preset?'builtin':entry.layout.masterId||'document',label=entry.preset?'Vividly 기본 레이아웃':parent?.name||'이 문서의 레이아웃';if(!groups.has(key))groups.set(key,{label,items:[]});groups.get(key).items.push(entry);}
    $('ms-gallery').innerHTML=groups.size?[...groups].map(([key,g])=>`<section class="ms-layout-group" data-master-group="${escape(key)}"><h3>${escape(g.label)}<small>${g.items.length}개</small></h3><div class="ms-layout-grid">${g.items.map(card).join('')}</div></section>`).join(''):'<p class="studio-empty">찾는 유형이 없습니다. 다른 이름으로 검색해 보세요.</p>';
    const firstEmpty=mode==='apply'&&store.document.slides.length===1&&store.activeSlide.elements.length===0;
    $('ms-title').textContent=mode==='new'?'새 슬라이드 유형 선택':firstEmpty?'첫 슬라이드 유형 선택':'슬라이드 레이아웃 변경';$('ms-description').textContent=mode==='new'?'내용에 맞는 유형을 고르세요. 빈 입력 자리가 있는 새 슬라이드가 추가됩니다.':firstEmpty?'첫 페이지에 맞는 유형을 고르고 내용을 채워 보세요.':'페이지의 배치를 바꿉니다. 입력한 내용과 추가 개체는 유지됩니다.';
    const current=store.document.layouts?.find(l=>l.id===store.activeSlide.layout?.layoutId);$('ms-current-label').textContent=current?'현재: '+current.name:firstEmpty?'첫 페이지 · 유형을 선택하세요':'현재 장: 자유 배치';$('ms-register').hidden=mode==='new'||firstEmpty;$('ms-status').textContent=mode==='new'?'레이아웃을 누르면 새 장을 만듭니다.':firstEmpty?'선택한 유형으로 첫 페이지를 시작합니다.':`선택한 슬라이드 ${openedSlideIds.length||selectedSlides().length}장 · 배치와 서식 변경`;
  }
  async function open(options={}){if(document.querySelector('dialog[open]'))return;await action(()=>{mode=options.mode==='new'?'new':'apply';focused=document.activeElement;openedSession=store.sessionId;openedRevision=store.revision;openedSlideIds=selectedSlides();$('ms-search').value='';paint();dialog.showModal();$('ms-search').focus();});}
  async function createSlide(){const layoutId=store.activeSlide.layout?.layoutId;if(layoutId&&store.document.layouts?.some(l=>l.id===layoutId))return action(()=>store.createSlideFromLayout(layoutId));return open({mode:'new'});}
  async function reset(){const slides=selectedSlides().filter(id=>store.document.slides.find(s=>s.id===id)?.layout);if(!slides.length){notice('레이아웃이 연결된 슬라이드를 선택하세요.');return;}return action(()=>{store.resetLayout(slides);notice(`${slides.length}장의 내용을 유지하고 레이아웃을 다시 설정했습니다.`);});}
  async function show(){const key=store.activeSlide.layout?.layoutId||store.document.layouts?.[0]?.id;if(openWorkspace)return openWorkspace(key);workbench.showTab('masters');$('ms-name').focus();}
  $('ms-close').onclick=close;dialog.addEventListener('cancel',e=>{e.preventDefault();close();});$('ms-search').addEventListener('input',paint);$('ms-register').onclick=()=>{close();workbench.showTab('masters');$('ms-name').focus();};
  $('ms-gallery').addEventListener('click',async event=>{
    const button=event.target.closest('button');if(!button||pending||openedSession!==store.sessionId)return;const id=button.dataset.msChoose||button.dataset.msEdit||button.dataset.msDelete;const entry=entries().find(item=>item.layout.id===id);if(!entry)return;
    if(button.dataset.msChoose){const owner=openedSession,revision=openedRevision,slides=[...openedSlideIds],selectedMode=mode;pending=true;close();await action(()=>{if(owner!==store.sessionId||revision!==store.revision)throw Error('자료가 바뀌었습니다. 레이아웃을 다시 선택하세요.');if(selectedMode==='new'){store.createSlideFromLayout(id,{preset:entry.preset});notice(`${entry.layout.name} 유형으로 새 슬라이드를 만들었습니다.`);}else{store.applyLayout(slides,id,{preset:entry.preset});notice(`${entry.layout.name} 레이아웃을 ${slides.length}장에 적용했습니다.`);}});}
    else if(button.dataset.msEdit){close();if(openWorkspace)await openWorkspace(id);}
    else{if(!confirm('레이아웃을 삭제할까요? 사용 중인 장의 현재 디자인과 내용은 유지됩니다.'))return;await action(()=>store.deleteLayout(id));openedRevision=store.revision;paint();}
  });
  $('ms-capture').onclick=()=>action(()=>{const name=$('ms-name').value.trim()||`사용자 레이아웃 ${(store.document.layouts?.length||0)+1}`,ids=$('ms-selected-placeholders').checked?[...store.selectedIds]:undefined;store.captureLayout(store.activeSlideId,name,undefined,ids);notice('현재 장을 재사용 레이아웃으로 등록했습니다.');});
  $('ms-update').onclick=()=>{const id=store.activeSlide.layout?.layoutId;if(id&&openWorkspace)openWorkspace(id);};$('ms-reset').onclick=reset;
  $('ms-detach').onclick=()=>action(()=>store.detachLayout([store.activeSlideId]));$('ms-gallery-open').onclick=()=>open({mode:'apply'});
  const canvasSection=$('wb-canvas-width').closest('section'),presets=document.createElement('label');presets.className='stacked-label';presets.innerHTML='슬라이드 비율<select id="ms-canvas-preset">'+CANVAS_PRESETS.map(([id,label])=>`<option value="${id}">${label}</option>`).join('')+'<option value="custom">사용자 지정</option></select>';canvasSection.querySelector('h3').after(presets);
  $('ms-canvas-preset').onchange=()=>{const preset=CANVAS_PRESETS.find(p=>p[0]===$('ms-canvas-preset').value);if(preset){$('wb-canvas-width').value=preset[2];$('wb-canvas-height').value=preset[3];for(const id of ['wb-canvas-width','wb-canvas-height'])$(id).dispatchEvent(new Event('input',{bubbles:true}));}};
  function sync(){const layout=store.document.layouts?.find(l=>l.id===store.activeSlide.layout?.layoutId),owner=store.sessionId+'|'+store.activeSlideId+'|'+(layout?.id||'')+'|'+(layout?.version||0)+'|'+(layout?.name||'');if(owner!==nameOwner){nameOwner=owner;$('ms-name').value=layout?.name||'';$('ms-selected-placeholders').checked=false;}$('ms-current').textContent=layout?`현재 레이아웃: ${layout.name}`:'현재 장은 자유 배치입니다.';$('ms-update').disabled=!layout;$('ms-detach').disabled=!layout;$('ms-reset').disabled=!layout;if(document.activeElement!==$('ms-name'))$('ms-name').placeholder=layout?.name||'예: 브랜드 · 본문 2열';const preset=CANVAS_PRESETS.find(p=>p[2]===store.document.canvas.width&&p[3]===store.document.canvas.height);if(document.activeElement!==$('ms-canvas-preset'))$('ms-canvas-preset').value=preset?.[0]||'custom';if(dialog.open){if(openedSession!==store.sessionId)close();else if(signature!==snapshotSignature())paint();}}
  sync();return{open,close,createSlide,reset,show,sync,get busy(){return dialog.open||panel.contains(document.activeElement)&&document.activeElement.matches('input,select,textarea');}};
}
