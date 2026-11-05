/** Search and keyboard entry points route existing UI commands; they never own document history. */
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normalize = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();

const PRODUCTIVITY_CSS = `
.wf-tool-actions{display:flex;align-items:center;gap:5px;flex-shrink:0;margin-left:auto}.wf-tool-actions button{white-space:nowrap}.wf-tool-actions kbd{margin-left:8px;font-size:9px;color:#8190ab}
.wf-palette{width:min(650px,calc(100vw - 36px));max-height:min(700px,90vh);padding:0;border:1px solid #ccd6ed;border-radius:14px;color:#23324c;background:#fff;box-shadow:0 24px 100px #101c3c45;overflow:hidden}.wf-palette::backdrop{background:#15213c6b}.wf-palette-head{display:flex;align-items:center;justify-content:space-between;padding:16px 19px 10px;gap:10px}.wf-palette-head h2{font-size:16px;margin:0}.wf-palette-head button{font-size:11px;padding:5px 8px}.wf-palette-search{padding:0 18px 12px}.wf-palette-search input{width:100%;padding:11px 12px;font-size:14px;border:1px solid #b6c7e7;border-radius:8px}.wf-palette-search input:focus{outline:2px solid #9e91ff;outline-offset:2px}.wf-palette-results{max-height:min(440px,54vh);overflow:auto;border-top:1px solid #e6ebf5;border-bottom:1px solid #e6ebf5;padding:5px 8px;background:#fcfdff}.wf-tool-group{padding:9px 11px 5px;font-size:10px;font-weight:700;color:#7282a0}.wf-tool-option{display:flex;align-items:center;width:100%;gap:13px;padding:9px 11px;border:1px solid transparent;background:transparent;text-align:left;min-height:48px;border-radius:7px;white-space:normal;cursor:pointer}.wf-tool-option>span:first-child{flex:1;min-width:0}.wf-tool-option strong{display:block;font-size:12px;font-weight:600}.wf-tool-option small{display:block;font-size:10px;color:#7788a6;margin-top:3px;line-height:1.5}.wf-tool-option kbd{font-size:10px;white-space:nowrap;color:#7d8ba2}.wf-tool-option[aria-selected=true]{background:#ece9ff;border-color:#b8aff1;color:#3d3290}.wf-tool-option[aria-disabled=true]{color:#9ca6b8;background:#f7f8fb;cursor:default}.wf-tool-option[aria-disabled=true] small{color:#929bad}.wf-palette-foot{padding:10px 18px;display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:10px;color:#6e7f9e}.wf-palette-foot kbd{font-size:9px}.wf-tool-empty{padding:28px 17px;color:#7584a0;font-size:12px;text-align:center}.wf-tool-status{font-size:11px;padding:0 18px 10px;color:#966526;min-height:15px}.wf-shortcut-body{padding:2px 20px 17px;overflow:auto;max-height:65vh}.wf-shortcut-body h3{font-size:12px;margin:17px 0 8px;color:#596e90}.wf-shortcut-body dl{margin:0}.wf-shortcut-body div{display:flex;gap:20px;justify-content:space-between;padding:7px 0;border-bottom:1px solid #edf0f6;font-size:12px}.wf-shortcut-body dt{font-weight:400}.wf-shortcut-body dd{margin:0;text-align:right;color:#596e90;white-space:nowrap}.wf-shortcut-body p{font-size:11px;color:#7d8ba3;line-height:1.7;margin-top:16px}
@media(max-width:1200px){.wf-tool-actions kbd{display:none}.wf-tool-actions button{font-size:11px;padding:5px 7px}}
`;

export function createProductivityWorkbench({store, workbench, action, notice, editSelected, openStart, composing=()=>Boolean(store.textSession?.composing)}) {
  const style = document.createElement('style'); style.dataset.vividlyProductivity='true'; style.textContent=PRODUCTIVITY_CSS; document.head.append(style);
  const actions=document.createElement('div'); actions.className='wf-tool-actions';
  actions.innerHTML='<button id="wf-tool-finder" title="도구 찾기 · Ctrl+Shift+P">도구 찾기 <kbd>Ctrl+Shift+P</kbd></button><button id="wf-shortcuts" title="단축키 안내">단축키</button>';
  const examples=document.getElementById('wf-examples');if(examples)examples.before(actions);else document.querySelector('.toolbar').append(actions);
  const dialog=document.createElement('dialog');dialog.id='wf-tool-dialog';dialog.className='wf-palette';dialog.setAttribute('aria-labelledby','wf-tool-heading');
  dialog.innerHTML='<div class="wf-palette-head"><h2 id="wf-tool-heading">도구 찾기</h2><button id="wf-tool-close" aria-label="도구 찾기 닫기">닫기 · Esc</button></div><div class="wf-palette-search"><label class="sr-only" for="wf-tool-query">도구 이름 검색</label><input id="wf-tool-query" type="search" placeholder="표, 차트, 정렬, 저장…" autocomplete="off" spellcheck="false" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="wf-tool-results"></div><div id="wf-tool-status" class="wf-tool-status" role="status" aria-live="polite"></div><div id="wf-tool-results" class="wf-palette-results" role="listbox" aria-label="찾은 도구"></div><div class="wf-palette-foot"><span id="wf-tool-count"></span><span><kbd>↑ ↓</kbd> 이동 · <kbd>Enter</kbd> 실행 · <kbd>Esc</kbd> 닫기</span></div>';
  document.body.append(dialog);
  const shortcuts=document.createElement('dialog');shortcuts.id='wf-shortcut-dialog';shortcuts.className='wf-palette';shortcuts.setAttribute('aria-labelledby','wf-shortcut-heading');
  shortcuts.innerHTML=`<div class="wf-palette-head"><h2 id="wf-shortcut-heading">단축키 안내</h2><button id="wf-shortcut-close">닫기 · Esc</button></div><div class="wf-shortcut-body">${[
    ['자료와 발표',[['저장 / 다른 이름으로 저장','Ctrl+S / Ctrl+Shift+S'],['열기 / 새 자료','Ctrl+O / Ctrl+N'],['발표 시작','F5'],['편집으로 돌아가기','Esc']]],
    ['편집과 선택',[['실행 취소 / 다시 실행','Ctrl+Z / Ctrl+Y'],['선택 개체 복사 / 잘라내기 / 붙여넣기','Ctrl+C / Ctrl+X / Ctrl+V'],['개체 복제','Ctrl+D'],['모두 선택','Ctrl+A'],['그룹 / 그룹 해제','Ctrl+G / Ctrl+Shift+G'],['선택 개체 편집','F2'],['선택 개체 이동 / 10px 이동','방향키 / Shift+방향키']]],
    ['슬라이드 썸네일',[['선택한 장 복제 / 삭제','Ctrl+D / Delete'],['장 복사 / 붙여넣기','Ctrl+C / Ctrl+V'],['장 위아래로 이동','Alt+↑ / Alt+↓'],['여러 장 / 전체 선택','Ctrl·Shift+클릭 / Ctrl+A'],['장 순서 변경','썸네일 드래그'],['장 작업 메뉴','썸네일 오른쪽 클릭']]],
    ['도구와 화면',[['도구 찾기','Ctrl+Shift+P'],['캔버스 이동','Space+드래그'],['텍스트 편집','두 번 클릭 / F2'],['여러 개체 선택','Shift+클릭 / 빈 영역 드래그']]],
  ].map(([title,rows])=>`<h3>${escape(title)}</h3><dl>${rows.map(([label,key])=>`<div><dt>${escape(label)}</dt><dd><kbd>${escape(key)}</kbd></dd></div>`).join('')}</dl>`).join('')}<p>텍스트·표·입력란을 편집할 때는 해당 입력 도구의 키 동작을 유지합니다. 조합 중인 글자를 도구 찾기가 가로채지 않습니다.</p></div>`;
  document.body.append(shortcuts);
  const $=id=>document.getElementById(id),query=$('wf-tool-query'),results=$('wf-tool-results'),status=$('wf-tool-status');
  let captured=null,returnFocus=null,rows=[],active=0,executing=false,opening=false;
  const context=()=>JSON.stringify({sessionId:store.sessionId,revision:store.revision,slideId:store.activeSlideId,selectedIds:[...store.selectedIds]});
  const selected=()=>store.selectedElements||[];
  const requireSelection=()=>selected().length?'':'캔버스나 레이어에서 개체를 먼저 선택하세요.';
  const requireSingle=()=>selected().length===1?'':'내용을 편집할 개체 하나를 선택하세요.';
  const requireMultiple=()=>selected().length>=2?'':'개체를 2개 이상 선택하세요.';
  const buttonAvailable=id=>{const button=$(id);return !button||button.hidden?'현재 화면에서 사용할 수 없습니다.':button.disabled?'현재 선택에서는 사용할 수 없습니다.':'';};
  const click=id=>{const target=$(id);if(!target||target.disabled)throw Error('현재 선택에서는 사용할 수 없습니다.');target.click();};
  const route=tab=>{workbench.showTab(tab);const heading=document.querySelector(`[data-inspector-page="${tab}"] h3`);heading?.scrollIntoView({block:'nearest'});};
  const command=(id,label,group,keywords,execute,extra={})=>({id,label,group,keywords,execute,...extra});
  const create=(id,label,target,keywords,extra={})=>command(id,label,'삽입',keywords,()=>click(target),{reason:()=>buttonAvailable(target),...extra});
  const catalog=[
    command('start','새 자료 · 템플릿으로 시작','자료','시작 새 프레젠테이션 양식 템플릿 template new deck',()=>openStart?.()),
    create('insert-text','텍스트 상자 추가','add-text','텍스트 제목 본문 글자 text title body'),
    create('insert-shape','사각형 추가','add-shape','도형 사각 카드 shape rectangle card'),
    create('insert-ellipse','타원 추가','add-ellipse','원 타원 동그라미 ellipse circle'),
    create('insert-image','이미지 추가','add-image','사진 그림 로고 image photo'),
    create('insert-table','표 추가','bu-add-table','표 셀 데이터 table spreadsheet'),
    create('insert-chart','차트 추가','bu-add-chart','차트 그래프 막대 꺾은선 chart graph'),
    create('insert-connector','연결선 그리기','bu-add-connector','연결선 흐름 화살표 connector arrow'),
    create('insert-svg','SVG 아이콘 추가','bu-add-svg','벡터 아이콘 SVG vector icon'),
    create('insert-button','인터랙티브 버튼 추가','mo-insert-button','버튼 클릭 링크 interactive button'),
    create('insert-tabs','탭 추가','mo-insert-tabs','탭 선택 연도 tabs year'),
    create('insert-select','선택 입력 추가','mo-insert-select','선택 목록 드롭다운 select dropdown'),
    create('insert-panel','상세 패널 추가','mo-insert-panel','상세 모달 패널 popup panel modal'),
    command('edit-selection','선택 개체 편집','편집','편집 내용 데이터 텍스트 표 차트 수정 edit selected',()=>editSelected?.(),{shortcut:'F2',reason:requireSingle}),
    command('duplicate','선택 개체 복제','편집','복제 사본 duplicate copy',()=>workbench.duplicate(),{shortcut:'Ctrl+D',reason:requireSelection}),
    command('copy','선택 개체 복사','편집','복사 clipboard copy',()=>workbench.copy(),{shortcut:'Ctrl+C',reason:requireSelection}),
    command('paste','붙여넣기','편집','붙여넣기 clipboard paste',()=>workbench.paste(),{shortcut:'Ctrl+V'}),
    command('group','선택 개체 그룹','배치','그룹 묶기 group',()=>click('wb-group'),{shortcut:'Ctrl+G',reason:requireMultiple}),
    command('ungroup','그룹 해제','배치','그룹 분리 해제 ungroup',()=>click('wb-ungroup'),{shortcut:'Ctrl+Shift+G',reason:()=>requireSelection()||buttonAvailable('wb-ungroup')}),
    command('align-left','왼쪽 정렬','배치','정렬 왼쪽 align left',()=>click('wb-align-left'),{reason:requireSelection}),
    command('align-center','가로 가운데 정렬','배치','정렬 가운데 수평 align center horizontal',()=>click('wb-align-center'),{reason:requireSelection}),
    command('align-middle','세로 가운데 정렬','배치','정렬 가운데 수직 align middle vertical',()=>click('wb-align-middle'),{reason:requireSelection}),
    command('distribute-horizontal','가로 균등 분배','배치','가로 균등 간격 분배 distribute horizontal spacing',()=>click('wb-distribute-h'),{reason:()=>selected().length>=3?'':'분배할 개체를 3개 이상 선택하세요.'}),
    command('distribute-vertical','세로 균등 분배','배치','세로 균등 간격 분배 distribute vertical spacing',()=>click('wb-distribute-v'),{reason:()=>selected().length>=3?'':'분배할 개체를 3개 이상 선택하세요.'}),
    command('add-slide','빈 슬라이드 추가','슬라이드','슬라이드 장 추가 new slide',()=>click('add-slide')),
    command('duplicate-slide','선택 슬라이드 복제','슬라이드','슬라이드 장 복제 duplicate slide',()=>click('duplicate-slide')),
    create('masters','슬라이드 마스터 · 레이아웃','rb-master','마스터 레이아웃 공통 디자인 master layout'),
    create('css-studio','CSS 디자인 스튜디오','rb-css-studio','글래스 네온 그라데이션 혼합 blur blend glass neon css'),
    create('web-studio','웹 인터랙션 · 숫자 · 조건부 이동','rb-web-studio','게임 점수 숫자 변수 웹 웹사이트 분기 game navigation variable'),
    command('templates','업무 템플릿 · 장 추가','슬라이드','템플릿 캠페인 성과 사업 키트 template layout kit',()=>route('business')),
    command('layers','레이어 · 개체 목록','작업','레이어 개체 목록 선택 잠금 숨김 layers objects',()=>route('layers')),
    command('properties','선택 개체 속성','작업','속성 위치 크기 색상 디자인 properties design',()=>route('properties'),{reason:requireSelection}),
    command('motion','모션 효과 설정','작업','모션 애니메이션 등장 퇴장 animation motion effect',()=>route('motion')),
    command('timeline','타임라인 · 키프레임','작업','타임라인 키프레임 씬 시간 재생 timeline keyframe scene',()=>click('tl-open')),
    command('behavior','상태 · 조건 동작','작업','상태 조건 인터랙션 모양 슬라이더 계산 state condition slider formula interaction',()=>route('behavior')),
    command('document','문서 · 테마 설정','작업','문서 테마 배경 크기 브랜드 theme document canvas',()=>route('document')),
    command('save','자료 저장','파일과 발표','저장 HTML save file',()=>click('save-button'),{shortcut:'Ctrl+S'}),
    command('save-as','다른 이름으로 저장','파일과 발표','다른 이름 저장 새 파일 save as',()=>click('save-as-button'),{shortcut:'Ctrl+Shift+S',reason:()=>buttonAvailable('save-as-button')}),
    command('open-file','저장한 HTML 열기','파일과 발표','열기 파일 불러오기 open load HTML',()=>click('open-button'),{shortcut:'Ctrl+O'}),
    command('delivery','PDF · PNG · 공유 HTML 내보내기','파일과 발표','출력 내보내기 납품 PDF PNG export publish output',()=>click('bu-export')),
    command('preview','동작 미리보기','파일과 발표','미리보기 재생 preview animation',()=>click('mo-preview')),
    command('present','발표 시작','파일과 발표','발표 프레젠테이션 present slideshow',()=>click('present-button'),{shortcut:'F5'}),
  ];
  function rememberFocus(){const field=document.activeElement;returnFocus={field,inputStart:typeof field?.selectionStart==='number'?field.selectionStart:null,inputEnd:typeof field?.selectionEnd==='number'?field.selectionEnd:null,range:window.getSelection()?.rangeCount?window.getSelection().getRangeAt(0).cloneRange():null};}
  function restoreFocus(){const saved=returnFocus;if(!saved?.field?.isConnected)return;saved.field.focus({preventScroll:true});if(saved.inputStart!==null&&typeof saved.field.setSelectionRange==='function')try{saved.field.setSelectionRange(saved.inputStart,saved.inputEnd);}catch{}else if(saved.range?.startContainer.isConnected&&saved.range?.endContainer.isConnected){const selection=window.getSelection();selection.removeAllRanges();selection.addRange(saved.range);}}
  function close(restore=true){if(dialog.open)dialog.close();if(shortcuts.open)shortcuts.close();captured=null;query.removeAttribute('aria-activedescendant');if(restore)restoreFocus();}
  function selectionState(item){try{return item.reason?.()||'';}catch{return '현재 선택에서는 사용할 수 없습니다.';}}
  function filtered(){const tokens=normalize(query.value).split(' ').filter(Boolean);return catalog.map((item,index)=>{const label=normalize(item.label),haystack=normalize(item.label+' '+item.group+' '+item.keywords);return{...item,index,disabledReason:selectionState(item),score:tokens.every(t=>haystack.includes(t))?(tokens.length?tokens.reduce((sum,t)=>sum+(label.startsWith(t)?4:label.includes(t)?2:1),0):0):-1};}).filter(item=>item.score>=0).sort((a,b)=>b.score-a.score||a.index-b.index);}
  function paint(){rows=filtered();active=Math.min(active,Math.max(0,rows.length-1));let group='';results.innerHTML=rows.length?rows.map((item,index)=>{const title=item.group!==group?`<div class="wf-tool-group" role="presentation">${escape(item.group)}</div>`:'';group=item.group;return`${title}<button type="button" tabindex="-1" id="wf-tool-option-${escape(item.id)}" class="wf-tool-option" data-tool-id="${escape(item.id)}" role="option" aria-selected="${index===active}" aria-disabled="${Boolean(item.disabledReason)}"><span><strong>${escape(item.label)}</strong><small>${escape(item.disabledReason||item.group)}</small></span>${item.shortcut?`<kbd>${escape(item.shortcut)}</kbd>`:''}</button>`;}).join(''):'<p class="wf-tool-empty">일치하는 도구가 없습니다. 다른 이름으로 찾아보세요.</p>';$('wf-tool-count').textContent=rows.length+'개 도구';syncActive();}
  function syncActive(){for(const node of results.querySelectorAll('[role=option]'))node.setAttribute('aria-selected',String(node.dataset.toolId===rows[active]?.id));if(rows[active])query.setAttribute('aria-activedescendant','wf-tool-option-'+rows[active].id);else query.removeAttribute('aria-activedescendant');}
  const anotherModal=()=>[...document.querySelectorAll('dialog[open]')].some(node=>node!==dialog&&node!==shortcuts);
  function open(){if($('presentation')?.hidden===false||composing())return;if(dialog.open){query.focus();return;}if(anotherModal()){notice('현재 편집 창을 먼저 마치세요.');return;}if(!shortcuts.open)rememberFocus();opening=true;try{if(shortcuts.open)shortcuts.close();query.value='';active=0;status.textContent='';dialog.showModal();query.focus();captured=context();paint();}finally{opening=false;}}
  function openShortcuts(){if($('presentation')?.hidden===false||composing())return;if(anotherModal()){notice('현재 편집 창을 먼저 마치세요.');return;}if(!dialog.open)rememberFocus();opening=true;try{if(dialog.open)dialog.close();shortcuts.showModal();captured=context();$('wf-shortcut-close').focus();}finally{opening=false;}}
  async function execute(id){if(executing)return;const item=catalog.find(item=>item.id===id);if(!item)return;if(captured!==context()){status.textContent='자료나 선택이 바뀌었습니다. 닫고 다시 도구를 선택하세요.';return;}const reason=selectionState(item);if(reason){status.textContent=reason;return;}executing=true;try{close(false);await item.execute();}catch(error){notice(error.message,true);}finally{executing=false;}}
  for(const button of [$('wf-tool-finder'),$('wf-shortcuts')])button.addEventListener('pointerdown',event=>event.preventDefault());
  $('wf-tool-finder').addEventListener('click',open);$('wf-tool-close').addEventListener('click',()=>close());$('wf-shortcuts').addEventListener('click',openShortcuts);$('wf-shortcut-close').addEventListener('click',()=>close());
  for(const modal of [dialog,shortcuts]){modal.addEventListener('cancel',event=>{event.preventDefault();close();});modal.addEventListener('click',event=>{if(event.target!==modal)return;const rect=modal.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)close();});modal.addEventListener('keydown',event=>{event.stopPropagation();if((event.ctrlKey||event.metaKey)&&['s','o','n'].includes(event.key.toLowerCase())||event.key==='F5'){event.preventDefault();status.textContent='도구 안내를 닫은 뒤 파일 작업이나 발표를 실행하세요.';}});}
  query.addEventListener('input',()=>{active=0;status.textContent='';paint();});
  query.addEventListener('keydown',event=>{if(event.isComposing)return;if(event.key==='Escape'){event.preventDefault();close();}else if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();active=rows.length?(active+(event.key==='ArrowDown'?1:-1)+rows.length)%rows.length:0;syncActive();if(rows[active])$('wf-tool-option-'+rows[active].id)?.scrollIntoView({block:'nearest'});}else if(event.key==='Enter'){event.preventDefault();if(rows[active])execute(rows[active].id);}});
  results.addEventListener('pointermove',event=>{const row=event.target.closest('[data-tool-id]');if(!row)return;active=rows.findIndex(item=>item.id===row.dataset.toolId);syncActive();});
  results.addEventListener('click',event=>{const row=event.target.closest('[data-tool-id]');if(row)execute(row.dataset.toolId);});
  document.addEventListener('keydown',event=>{if(event.isComposing||composing()||event.defaultPrevented||$('presentation')?.hidden===false)return;if((event.ctrlKey||event.metaKey)&&event.shiftKey&&event.code==='KeyP'){event.preventDefault();event.stopImmediatePropagation();if(dialog.open)close();else open();}},true);
  function sync(){if((dialog.open||shortcuts.open)&&captured!==context()&&!executing&&!opening){close(false);notice('자료가 바뀌어 열려 있던 도구 안내를 닫았습니다.');}}
  return {sync,open,close,get isOpen(){return dialog.open;},get busy(){return dialog.open||shortcuts.open;}};
}
