/** Familiar task tabs; the existing controls remain the sole editing/command authority. */
import {resolveDesignElement}from './design-model.js';
const $ = id => document.getElementById(id);
const tabs = [
  ['file','파일'],['home','홈'],['insert','삽입'],['design','디자인'],
  ['transitions','전환'],['animations','애니메이션'],['interaction','인터랙션'],
  ['show','슬라이드 쇼'],['view','보기'],
];
const iconNames = {
  'save-button':'save','undo-button':'undo','redo-button':'redo','present-button':'play',
  'wb-paste':'paste','wb-copy':'copy','wb-cut':'cut','wb-copy-format':'format-paint',
  'add-text':'text','add-shape':'rectangle','add-ellipse':'ellipse','add-image':'image',
  'bu-add-table':'table','bu-add-chart':'chart','bu-add-connector':'connector','bu-add-svg':'svg',
  'duplicate-element':'duplicate','delete-element':'delete','wb-group':'group',
  'wb-align-left':'align-left','wb-align-center':'align-center','wb-align-right':'align-right',
  'wb-align-top':'align-top','wb-align-middle':'align-middle','wb-align-bottom':'align-bottom',
  'wb-distribute-h':'distribute-h','wb-distribute-v':'distribute-v','wb-ungroup':'ungroup',
};

export function createRibbon({store, workbench, action, notice,openShapes,armDrawing,openIcons,openMasters,showMasters,showCss,showWeb,showLogic,showScene,showData,showMasterEditor,insertVideo,openLink,newSlide,chooseNewLayout,resetLayout,openComponents,showResponsive,previewResponsive,showWebTools}) {
  const originalBar = document.querySelector('.toolbar');
  const secondaryBar = document.querySelector('.workbench-toolbar');
  const header = document.querySelector('.app-header');
  const ribbon = document.createElement('section');
  ribbon.id='ribbon';ribbon.className='ribbon';ribbon.setAttribute('aria-label','프레젠테이션 도구');
  ribbon.innerHTML='<div class="ribbon-tab-row"><div class="ribbon-tabs" role="tablist" aria-label="메뉴">'+
    tabs.map(([id,label])=>`<button id="ribbon-tab-${id}" data-ribbon-tab="${id}" role="tab" aria-controls="ribbon-panel-${id}" aria-selected="${id==='home'}" tabindex="${id==='home'?0:-1}">${label}</button>`).join('')+
    '</div><div id="ribbon-help" class="ribbon-help"></div></div><div class="ribbon-panels">'+
    tabs.map(([id])=>`<div id="ribbon-panel-${id}" data-ribbon-panel="${id}" role="tabpanel" aria-labelledby="ribbon-tab-${id}" ${id==='home'?'':'hidden'}></div>`).join('')+'</div>';
  header.after(ribbon);
  document.documentElement.classList.add('has-ribbon');
  let active='home';
  const aliases=[];
  const modalOpen=()=>Boolean(document.querySelector('dialog[open]'));
  const groups={};
  function group(tab,name,kind='') {
    const section=document.createElement('section');section.className='ribbon-group '+kind;
    section.setAttribute('aria-label',name);
    const body=document.createElement('div');body.className='ribbon-group-body';
    const label=document.createElement('div');label.className='ribbon-group-label';label.textContent=name;
    section.append(body,label);$('ribbon-panel-'+tab).append(section);groups[name]=body;return body;
  }
  function decorate(node,label,large=false,icon=iconNames[node.id]) {
    node.classList.add('ribbon-command');if(large)node.classList.add('ribbon-large');
    label ||= node.getAttribute('aria-label') || node.textContent.trim();
    node.setAttribute('aria-label',label);node.title ||= label;
    node.replaceChildren();
    if(icon){const image=document.createElement('img');image.src='/assets/ui/'+icon+'.svg';image.alt='';image.setAttribute('aria-hidden','true');node.append(image);}
    const text=document.createElement('span');text.textContent=label;node.append(text);return node;
  }
  function move(id,container,label,large=false) {
    const node=$(id);if(!node)throw new Error('Ribbon control missing: '+id);
    container.append(node);if(node.tagName==='BUTTON')decorate(node,label,large);return node;
  }
  const directFields=[];
  function field(id,container,label){
    const input=$(id),wrapper=input.closest('label')||document.createElement('label');
    wrapper.replaceChildren(document.createTextNode(label),input);wrapper.className='ribbon-field';wrapper.dataset.ribbonField=id;container.append(wrapper);directFields.push({id,wrapper,label});return input;
  }
  function command(id,label,container,handler,{icon,large=false,target}={}) {
    const button=document.createElement('button');button.id=id;button.type='button';decorate(button,label,large,icon);container.append(button);
    button.addEventListener('click',()=>{if(modalOpen())return;handler();});
    if(target)aliases.push({button,target});return button;
  }
  function alias(id,label,target,container,options={}) {
    return command(id,label,container,()=>$(target)?.click(),{...options,target});
  }
  function inspector(page,id) {
    if(modalOpen())return;
    action(()=>{
      workbench.showTab(page);
      requestAnimationFrame(()=>{
        const field=id?$(id):null;
        const section=field?.closest('.property-section')||field;
        section?.scrollIntoView({block:'start',behavior:'instant'});
        if(field&&!field.disabled&&/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(field.tagName))field.focus({preventScroll:true});
      });
    });
  }
  function link(id,label,container,page,field,options) {return command(id,label,container,()=>inspector(page,field),options);}

  // Compact title bar: everyday actions remain reachable from every ribbon tab.
  const quick=document.createElement('div');quick.id='ribbon-quick';quick.className='ribbon-quick';quick.setAttribute('role','toolbar');quick.setAttribute('aria-label','빠른 실행');
  document.querySelector('.brand').after(quick);
  move('save-button',quick,'저장');move('undo-button',quick,'실행 취소');move('redo-button',quick,'다시 실행');
  for(const node of quick.children)node.classList.add('ribbon-quick-icon');
  const right=document.querySelector('.file-actions');
  move('wf-tool-finder',right,'도구 찾기');move('present-button',right,'슬라이드 쇼');
  move('wf-shortcuts',$('ribbon-help'),'단축키');
  move('wf-examples',$('ribbon-help'));

  const files=group('file','프레젠테이션');
  move('new-button',files,'새 자료',true);move('open-button',files,'열기',true);
  const save=group('file','저장·내보내기');
  alias('rb-file-save','저장','save-button',save,{icon:'save',large:true});
  move('save-as-button',save,'다른 이름으로 저장');move('bu-export',save,'내보내기');
  const restore=group('file','복구·연결');
  link('rb-recovery','작업 복구',restore,'document','wb-recovery-check');
  link('rb-agent','에이전트 연결',restore,'document','wb-agent-panel');
  const fileNote=document.createElement('p');fileNote.className='ribbon-note';fileNote.textContent='편집용 HTML로 저장하고, PDF·PNG·공유용 HTML로 내보냅니다.';$('ribbon-panel-file').append(fileNote);

  const clipboard=group('home','클립보드','ribbon-clipboard');
  move('wb-paste',clipboard,'붙여넣기',true);
  const copy=document.createElement('div');copy.className='ribbon-stack';clipboard.append(copy);
  move('wb-cut',copy,'잘라내기');move('wb-copy',copy,'복사');move('wb-copy-format',copy,'서식 복사');
  move('wb-paste-format',copy,'서식 적용');
  const slides=group('home','슬라이드');
  const newSlideRow=document.createElement('div');newSlideRow.className='ribbon-slide-split';slides.append(newSlideRow);
  command('rb-new-slide','새 슬라이드',newSlideRow,()=>newSlide?newSlide():$('add-slide').click(),{icon:'new-slide',large:true}).title='현재 유형으로 새 슬라이드 · 옆 화살표에서 다른 유형 선택';
  command('rb-new-layout','슬라이드 유형 선택',newSlideRow,()=>chooseNewLayout?chooseNewLayout():$('add-slide').click()).innerHTML='<span aria-hidden="true">▾</span>';
  const layoutRow=document.createElement('div');layoutRow.className='ribbon-slide-actions';slides.append(layoutRow);
  command('rb-home-layout','레이아웃',layoutRow,()=>openMasters?.());
  command('rb-reset-layout','다시 설정',layoutRow,()=>resetLayout?.()).title='내용을 유지하고 레이아웃의 위치와 서식 복원';
  alias('rb-duplicate-slide','슬라이드 복제','duplicate-slide',originalBar,{icon:'duplicate'}).hidden=true;
  const font=group('home','글꼴','ribbon-font');
  const fontRow=document.createElement('div');fontRow.className='ribbon-field-row';font.append(fontRow);
  for(const id of ['property-font-family','property-font-size']){const label=$(id).closest('label');label.classList.add('ribbon-field');fontRow.append(label);}
  const fontActions=document.createElement('div');fontActions.className='ribbon-field-row';font.append(fontActions);
  for(const [mark,label,glyph]of [['bold','굵게','<b>B</b>'],['italic','기울임','<i>I</i>'],['underline','밑줄','<u>U</u>'],['strike','취소선','<s>S</s>']]){const node=move('property-'+mark,fontActions,label);node.classList.add('ribbon-font-toggle');node.innerHTML=glyph;}
  field('property-text-color',fontActions,'글자 색');
  const paragraph=group('home','단락');
  // The new wrapping label replaces the old offscreen sidebar label, including its layout box.
  document.querySelector('label[for="property-align"]')?.remove();
  paragraph.classList.add('ribbon-paragraph-fields');
  const paragraphRow=document.createElement('div');paragraphRow.className='ribbon-field-row';paragraph.append(paragraphRow);
  const alignLabel=document.createElement('label');alignLabel.className='ribbon-field';alignLabel.textContent='글자 정렬';alignLabel.append($('property-align'));paragraphRow.append(alignLabel);
  field('property-vertical-align',paragraphRow,'세로 정렬');
  const paragraphDetails=document.createElement('div');paragraphDetails.className='ribbon-field-row ribbon-paragraph-detail-row';paragraph.append(paragraphDetails);
  field('property-line-height',paragraphDetails,'줄 간격');
  move('rt-open',paragraphDetails,'글자·문단 자세히').title='선택한 글자의 서식, 글머리표·번호, 문단 간격과 링크를 편집합니다.';
  const drawing=group('home','도형 서식','ribbon-shape-fields');
  const paintRow=document.createElement('div');paintRow.className='ribbon-field-row';drawing.append(paintRow);
  field('property-fill',paintRow,'채우기');field('property-stroke',paintRow,'테두리 색');
  const strokeRow=document.createElement('div');strokeRow.className='ribbon-field-row';drawing.append(strokeRow);
  field('property-stroke-width',strokeRow,'선 굵기');
  command('rb-fill-none','채우기 없음',strokeRow,()=>action(()=>{
    const shapes=store.selectedElements;if(!shapes.length||!shapes.every(e=>e.type==='shape'&&!e.locked&&!e.hidden))return;
    const restore=shapes.every(e=>/^#(?:[\da-f]{3}0|[\da-f]{6}00)$/i.test(e.fill));
    store.runBatch(shapes.flatMap(element=>[{id:'shape.set_fill',params:{elementId:element.id,fill:restore?$('property-fill').value:'#00000000'}},...(element.style?.gradient?[{id:'element.set_style',params:{elementId:element.id,style:{gradient:null}}}]:[])]),'도형 채우기');
  }));
  const shapeTools=group('home','도형 편집');
  command('rb-change-shape','도형 바꾸기',shapeTools,()=>openShapes?.('replace'));
  command('draw-edit-points','점 편집',shapeTools,()=>armDrawing?.('points'));
  command('draw-replace-icon','아이콘 바꾸기',shapeTools,()=>openIcons?.('replace'));
  const arrange=group('home','개체 정렬','ribbon-arrange-fields');
  const reference=document.createElement('label');reference.className='ribbon-field';reference.textContent='정렬 기준';reference.append($('wb-align-reference'));arrange.append(reference);
  $('wb-align-reference').title='선택 기준: 선택한 개체끼리 맞춤 · 슬라이드 기준: 장의 가장자리나 중심에 맞춤';
  const alignGrid=document.createElement('div');alignGrid.className='ribbon-align-grid';arrange.append(alignGrid);
  for(const [id,label]of [['wb-align-left','왼쪽 맞춤'],['wb-align-center','가로 가운데'],['wb-align-right','오른쪽 맞춤'],['wb-align-top','위쪽 맞춤'],['wb-align-middle','세로 가운데'],['wb-align-bottom','아래쪽 맞춤']])move(id,alignGrid,label).classList.add('ribbon-align-command');
  const menu=document.createElement('details');menu.className='ribbon-menu';menu.id='rb-arrange-menu';menu.innerHTML='<summary>그룹·간격·순서</summary><div class="ribbon-menu-body" role="group" aria-label="개체 정렬과 순서"></div>';arrange.append(menu);
  const menuBody=menu.lastElementChild;
  for(const [id,label] of [['wb-group','그룹'],['wb-ungroup','그룹 해제'],['wb-distribute-h','가로 간격 동일하게'],['wb-distribute-v','세로 간격 동일하게']])move(id,menuBody,label);
  alias('rb-front','앞으로 가져오기','element-front',menuBody);
  alias('rb-back','뒤로 보내기','element-back',menuBody);
  move('duplicate-element',menuBody,'복제');move('delete-element',menuBody,'삭제');
  command('draw-reset-shape','조절점 초기화',menuBody,()=>action(()=>{const commands=store.selectedElements.filter(e=>e.type==='shape'&&e.shape!=='freeform'&&e.adjustments&&Object.keys(e.adjustments).length).map(e=>({id:'shape.set_adjustments',params:{elementId:e.id,adjustments:{}}}));if(commands.length)store.runBatch(commands,'도형 조절점 초기화');}));

  const insertText=group('insert','텍스트');move('add-text',insertText,'텍스트 상자',true);
  const insertImages=group('insert','그림');move('add-image',insertImages,'이미지',true);move('reuse-document-assets',insertImages,'자료 이미지');move('bu-add-svg',insertImages,'SVG 아이콘',true);move('bu-import-svg',insertImages,'SVG 가져오기');
  const insertMedia=group('insert','미디어·링크');command('rb-insert-video','동영상',insertMedia,()=>insertVideo?.(),{large:true,icon:'play'});command('rb-insert-link','하이퍼링크',insertMedia,()=>openLink?.(),{large:true});$('rb-insert-link').title='개체·선택 글자에 웹 주소나 슬라이드 링크 연결 (Ctrl+K)';
  const insertShapes=group('insert','도형');move('add-shape',insertShapes,'도형',true);
  const draw=group('insert','자유형 그리기','ribbon-drawing-tools');
  command('draw-freeform','자유형 도형',draw,()=>armDrawing?.('freeform'));
  command('draw-freehand','자유 곡선',draw,()=>armDrawing?.('freehand'));
  alias('draw-edit-points-insert','점 편집','draw-edit-points',draw);
  const lines=group('insert','연결선','ribbon-connector-tools');
  alias('draw-connector','연결선 그리기','bu-add-connector',lines,{icon:'connector'});
  const routeLabel=document.createElement('label');routeLabel.className='ribbon-field';routeLabel.textContent='연결선 종류';routeLabel.innerHTML+='<select id="draw-connector-route"><option value="straight">직선</option><option value="elbow">꺾인 연결선</option><option value="curve">곡선</option><option value="polyline">자유 꺾은선</option></select>';lines.append(routeLabel);
  document.getElementById('draw-connector-route').addEventListener('change',event=>{const route=event.target.value,e=store.selectedElement;if(e?.type==='connector'&&!e.locked&&!e.hidden&&(e.connector.route||'straight')!==route)action(()=>{const connector={...e.connector,route};delete connector.control;store.setConnector(e.id,connector);});});
  const insertData=group('insert','표·차트');move('bu-add-table',insertData,'표',true);move('bu-add-chart',insertData,'차트',true);if(showData)command('rb-data-connector','데이터 연결',insertData,showData);
  const insertSlide=group('insert','슬라이드');alias('rb-import-slides','다른 자료에서 가져오기','wb-import-slides',insertSlide);command('rb-layouts','레이아웃 적용',insertSlide,()=>openMasters?.());
  const webBlocks=group('insert','재사용·웹 요소');
  command('rb-components','컴포넌트',webBlocks,()=>openComponents?.(),{icon:'group'});
  command('rb-web-tools','입력 폼·필터·이동',webBlocks,()=>showWebTools?.());

  const theme=group('design','문서 테마');
  link('rb-theme','색·글꼴 테마',theme,'document','wb-theme-font',{large:true,icon:'format-paint'});
  link('rb-templates','업무 템플릿',theme,'business','bu-template-details',{icon:'new-slide'});
  const layouts=group('design','레이아웃·마스터');
  command('rb-layout-gallery','레이아웃 선택',layouts,()=>openMasters?.(),{large:true,icon:'new-slide'});
  command('rb-master','마스터 편집',layouts,()=>{if(showMasterEditor)showMasterEditor();else showMasters?.();},{large:true,icon:'group'});
  move('ms-import-library',layouts,'디자인 가져오기');
  const responsive=group('design','화면에 맞춘 배치');
  command('rb-responsive','반응형 배치',responsive,()=>showResponsive?.());
  command('rb-responsive-preview','화면별 미리보기',responsive,()=>previewResponsive?.());
  const pageSetup=group('design','슬라이드 설정');
  link('rb-background','배경 색',pageSetup,'properties','property-slide-background',{large:true,icon:'format-paint'});
  link('rb-canvas-size','슬라이드 크기',pageSetup,'document','wb-canvas-width',{large:true,icon:'rectangle'});
  link('rb-footer','로고·쪽 번호',pageSetup,'business','bu-master-logo');
  // Object effects live with the selected object. Keep legacy command entry points for tool search.
  command('rb-css-studio','CSS 디자인',originalBar,()=>showCss?.());
  link('rb-object-style','도형 서식·CSS 효과',originalBar,'properties','css-studio');
  link('rb-design-style','채우기·그림자·테두리',originalBar,'properties','wb-design-apply');
  const designNote=document.createElement('p');designNote.className='ribbon-note';designNote.textContent='자료 전체의 디자인을 설정합니다. 개체 효과는 개체를 오른쪽 클릭해 “도형 서식·CSS 효과”에서 편집하세요.';$('ribbon-panel-design').append(designNote);

  const transition=group('transitions','슬라이드 전환');
  link('rb-transition','전환 효과·시간',transition,'motion','mo-transition',{large:true});
  const transitionNote=document.createElement('p');transitionNote.className='ribbon-note';transitionNote.textContent='장과 장 사이의 전환을 설정합니다. 여러 슬라이드를 선택해 함께 적용할 수 있습니다.';$('ribbon-panel-transitions').append(transitionNote);

  const animation=group('animations','개체 애니메이션');
  link('rb-animation','효과·시작·순서',animation,'motion','mo-preset',{large:true});
  move('tl-open',animation,'애니메이션 타임라인',true);
  const preview=group('animations','미리보기');move('mo-preview',preview,'동작 미리보기',true);
  const animationNote=document.createElement('p');animationNote.className='ribbon-note';animationNote.textContent='개체를 선택해 등장·강조·퇴장 효과와 키프레임을 편집합니다.';$('ribbon-panel-animations').append(animationNote);

  const interact=group('interaction','인터랙티브 요소');
  for(const [id,label] of [['mo-insert-button','버튼'],['mo-insert-tabs','탭'],['mo-insert-select','선택 입력'],['mo-insert-panel','상세 패널']])move(id,interact,label,true);
  const behaviors=group('interaction','동작·상태');
  command('rb-logic','동작 만들기',behaviors,()=>showLogic?.(),{large:true});
  command('rb-scene','이동·장면',behaviors,()=>showScene?.());
  const legacyMenu=document.createElement('details');legacyMenu.className='ribbon-menu';legacyMenu.id='rb-legacy-behavior';legacyMenu.innerHTML='<summary>기존 동작 도구</summary><div class="ribbon-menu-body" role="group" aria-label="이전 자료의 동작 편집"></div>';behaviors.append(legacyMenu);const legacyBody=legacyMenu.lastElementChild;
  command('rb-web-studio','웹 인터랙션',legacyBody,()=>showWeb?.());
  link('rb-interaction','클릭·변수 연결',legacyBody,'interaction');
  link('rb-behavior','상태·조건·계산',legacyBody,'behavior');
  const previewInteraction=group('interaction','미리보기');alias('rb-interaction-preview','동작 미리보기','mo-preview',previewInteraction,{icon:'play',large:true});

  const show=group('show','슬라이드 쇼 시작');
  alias('rb-present','현재 슬라이드부터','present-button',show,{icon:'play',large:true});
  move('bu-presenter',show,'발표자 화면',true);
  const notes=group('show','발표 준비');link('rb-notes','발표 메모',notes,'business','bu-notes',{large:true});link('rb-diagnostics','문서 진단',notes,'business','bu-diagnostics',{large:true});
  const output=group('show','출력');alias('rb-show-export','PDF·이미지·HTML','bu-export',output,{large:true});

  const canvasView=group('view','화면');move('wb-fit',canvasView,'화면에 맞춤',true);move('wb-pan',canvasView,'손 도구',true);
  const panels=group('view','작업 창');link('rb-properties','개체 속성',panels,'properties',null);link('rb-layers','선택 창·레이어',panels,'layers',null);alias('rb-view-timeline','타임라인','tl-open',panels);
  const guides=group('view','맞춤');guides.append($('wb-snap').closest('label'));
  if($('ag-controls'))guides.append($('ag-controls'));

  // Keep the now-empty legacy containers for compatibility, without their rows.
  originalBar.hidden=true;secondaryBar.hidden=true;
  const oldText=document.createElement('p');oldText.className='property-help';oldText.textContent='글꼴·글자 색·문단 정렬은 상단 홈 탭에서 바로 편집합니다.';$('text-properties').prepend(oldText);
  const shapeNote=document.createElement('p');shapeNote.className='property-help';shapeNote.textContent='채우기·테두리·선 굵기·도형 바꾸기는 홈 탭에서 바로 편집합니다.';$('shape-properties').prepend(shapeNote);
  const menus=[menu,legacyMenu];
  function closeMenus(){for(const item of menus)item.open=false;const examples=$('wf-examples');if(examples)examples.open=false;}
  function selectTab(name,{focus=false}={}) {
    if(!tabs.some(([id])=>id===name)||modalOpen())return;
    closeMenus();
    const previous=$('ribbon-panel-'+active);
    if(previous.contains(document.activeElement))$('ribbon-tab-'+name).focus({preventScroll:true});
    active=name;
    for(const [id]of tabs){const selected=id===name;const tab=$('ribbon-tab-'+id);tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;$('ribbon-panel-'+id).hidden=!selected;}
    if(focus)$('ribbon-tab-'+name).focus({preventScroll:true});
    window.dispatchEvent(new CustomEvent('vividly:ribbon-change',{detail:{name}}));
  }
  ribbon.querySelector('.ribbon-tabs').addEventListener('click',event=>{const tab=event.target.closest('[data-ribbon-tab]');if(tab)selectTab(tab.dataset.ribbonTab);});
  ribbon.querySelector('.ribbon-tabs').addEventListener('keydown',event=>{
    if(event.defaultPrevented||event.isComposing)return;
    const current=event.target.closest('[data-ribbon-tab]');if(!current)return;
    const index=tabs.findIndex(([id])=>id===current.dataset.ribbonTab);
    const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:event.key==='ArrowRight'?(index+1)%tabs.length:event.key==='ArrowLeft'?(index+tabs.length-1)%tabs.length:-1;
    if(next<0)return;event.preventDefault();event.stopPropagation();selectTab(tabs[next][0],{focus:true});
  });
  // Command clicks preserve the canvas selection; tabs and fields keep normal focus behavior.
  for(const container of [ribbon,quick,right])container.addEventListener('pointerdown',event=>{if(event.target.closest('button')&&!event.target.closest('[data-ribbon-tab]'))event.preventDefault();});
  menu.addEventListener('toggle',()=>{if(!menu.open)return;const rect=menu.firstElementChild.getBoundingClientRect();menuBody.style.left=Math.min(rect.left,window.innerWidth-250)+'px';menuBody.style.top=rect.bottom+4+'px';});
  menuBody.addEventListener('click',event=>{if(event.target.closest('button:not(:disabled)'))menu.open=false;});
  document.addEventListener('pointerdown',event=>{if(!event.target.closest('.ribbon-menu,.wf-examples'))closeMenus();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&menu.open){event.preventDefault();event.stopPropagation();menu.open=false;menu.firstElementChild.focus();}},true);
  window.addEventListener('resize',closeMenus);
  function sync() {
    const resolvedSelection=store.selectedElements.map(e=>resolveDesignElement(e,store.document).element);
    const selectedSlideIds=workbench.selectedSlideIds.length?workbench.selectedSlideIds:[store.activeSlideId];
    $('rb-reset-layout').disabled=!selectedSlideIds.every(id=>store.document.slides.find(s=>s.id===id)?.layout);
    const text=store.selectedElements.length>0&&store.selectedElements.every(element=>element.text&&!element.locked&&!element.hidden);
    const shapes=store.selectedElements.length>0&&store.selectedElements.every(element=>element.type==='shape'&&!element.locked&&!element.hidden);
    const outlines=store.selectedElements.length>0&&store.selectedElements.every(element=>['shape','connector'].includes(element.type)&&!element.locked&&!element.hidden);
    for(const id of ['property-font-family','property-font-size','property-align','property-bold','property-italic','property-underline','property-strike','property-text-color','property-vertical-align','property-line-height'])$(id).disabled=!text;
    for(const id of ['property-fill','rb-fill-none','rb-change-shape'])$(id).disabled=!shapes;
    for(const id of ['property-stroke','property-stroke-width'])$(id).disabled=!outlines;
    const free=store.selectedIds.length===1&&store.selectedElement?.shape==='freeform';
    const svg=store.selectedIds.length===1&&store.selectedElement?.type==='svg';
    $('draw-edit-points').hidden=!free;$('draw-edit-points').disabled=!free||!shapes;
    $('draw-replace-icon').hidden=!svg;$('draw-replace-icon').disabled=!svg||store.selectedElement.locked||store.selectedElement.hidden;
    $('rb-change-shape').hidden=Boolean(free||svg);
    $('draw-reset-shape').disabled=!shapes||!store.selectedElements.some(e=>Object.keys(e.adjustments||{}).length);
    if(store.selectedIds.length===1&&store.selectedElement.type==='connector'&&document.activeElement!==$('draw-connector-route'))$('draw-connector-route').value=store.selectedElement.connector.route||'straight';
    for(const {button,target}of aliases){const node=$(target);button.disabled=!node||node.disabled||node.hidden;}
    for(const id of ['rb-object-style','rb-design-style'])$(id).disabled=!store.selectedElement;
    $('rb-fill-none').setAttribute('aria-pressed',String(shapes&&resolvedSelection.every(e=>/^#(?:[\da-f]{3}0|[\da-f]{6}00)$/i.test(e.fill))));
    for(const {id,wrapper}of directFields){const values=resolvedSelection.map(element=>id==='property-fill'?element.fill:id==='property-stroke'?(element.stroke||element.connector?.stroke)?.color:id==='property-stroke-width'?(element.stroke||element.connector?.stroke)?.width:element.text?.textStyle?.[{'property-text-color':'color','property-vertical-align':'verticalAlign','property-line-height':'lineHeight'}[id]]);wrapper.classList.toggle('ribbon-mixed',!$(id).disabled&&new Set(values).size>1);}
  }
  sync();return{sync,selectTab,get activeTab(){return active;}};
}
