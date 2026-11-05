import{dispatchAgentRequest}from './agent-dispatch.js';
import {resolveDesignElement}from './design-model.js';
import {
  Moveable,
  Selecto,
  getElementInfo,
} from "../assets/vendor/workbench-engines.js";
import { cloneDocument, normalizeDocument } from "./model.js";
import { parsePresentation, validateAssetBytes } from "./format.js";
import { colorInputRgb, mergeColorInput } from "./workbench-colors.js";
import { publishClipboard,resolveClipboardContents,canCommitClipboardCut } from './local-clipboard.js';

const $ = (id) => document.getElementById(id);
const escape = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const editable = (target) =>
  target?.closest?.('input,textarea,select,[contenteditable="true"]');
const value = (id) => $(id).value;
const num = (id) => Number(value(id));
const round = (n) => Math.round(n * 10000) / 10000;

export function createWorkbench({
  store,
  action,
  render,
  notice,
  beginText,
  composing,
  flushReady,
  commitControls,
  scale,
  updateStatus,
  refreshSelection,
  refreshConnections,
  restoreDocument,
  openExample,
  importLibrary,
  applyZoom,
  desktop,
  hostOperation,
  interactionBusy=()=>false,
  showObjectStyle=()=>{},openLink=()=>{},
}) {
  const stage = $("stage"),
    viewport = $("stage-viewport");
  let enginesReady = false,
    syncing = false,
    dragging = false,
    clipboard = null,
    format = null,
    gesture = null;
  let clipboardState=null,clipboardGeneration=0,clipboardWrites=Promise.resolve();
  let pan = null,
    panMode = false,
    spacePan = false,
    imageReplacement = null;
  let selectedSlides = new Set([store.activeSlideId]),
    slideAnchor = store.activeSlideId,
    session = store.sessionId;
  let stops = [
    { offset: 0, color: "#2563eb" },
    { offset: 1, color: "#7c3aed" },
  ];
  let recoveryTimer = null,
    lastRecovery = "",
    recoveryWriting = false;
  let engineFrame = 0;
  let recoveryReady = false,
    restoredRecovery = null;
  let colorLease = null;
  const colorSources = new WeakMap();
  const pending = new Set();
  let heldMouseEvent = null;
  window.addEventListener("mouseup", () => { heldMouseEvent = null; }, true);
  window.addEventListener("blur", () => { heldMouseEvent = null; });
  const ids = () => [...store.selectedIds];
  const nodes = () =>
    ids()
      .map((id) =>
        stage.querySelector(
          `.slide-element[data-element-id="${CSS.escape(id)}"]`,
        ),
      )
      .filter(Boolean);
  const elements = () =>
    store.activeSlide.elements.filter((e) => ids().includes(e.id));
  const busy = () =>
    interactionBusy() ||
    composing() ||
    Boolean(store.textSession) ||
    Boolean(store.transformSession);
  const run = (fn) => action(fn);
  const button = (id, fn) => $(id).addEventListener("click", () => run(fn));

  const bar = document.createElement("div");
  bar.className = "workbench-toolbar";
  bar.innerHTML = `<div class="wb-tool-cluster"><button id="wb-copy" title="개체 복사 Ctrl+C">복사</button><button id="wb-cut" title="잘라내기 Ctrl+X">잘라내기</button><button id="wb-paste" title="붙여넣기 Ctrl+V">붙여넣기</button><button id="wb-copy-format">서식 복사</button><button id="wb-paste-format">서식 적용</button></div><div class="wb-tool-cluster"><button id="wb-group" title="그룹 Ctrl+G">그룹</button><button id="wb-ungroup" title="그룹 해제 Ctrl+Shift+G">해제</button><label class="sr-only" for="wb-align-reference">정렬 기준</label><select id="wb-align-reference"><option value="selection">선택 기준</option><option value="slide">슬라이드 기준</option></select><button id="wb-align-left" title="왼쪽 정렬">↤</button><button id="wb-align-center" title="가로 가운데 정렬">↔</button><button id="wb-align-right" title="오른쪽 정렬">↦</button><button id="wb-align-top" title="위쪽 정렬">↥</button><button id="wb-align-middle" title="세로 가운데 정렬">↕</button><button id="wb-align-bottom" title="아래쪽 정렬">↧</button><button id="wb-distribute-h" title="가로 균등 분배">가로 분배</button><button id="wb-distribute-v" title="세로 균등 분배">세로 분배</button></div><div class="wb-tool-cluster"><label class="wb-check"><input id="wb-snap" type="checkbox" checked> 스냅</label><button id="wb-pan" title="화면 이동 · Space+드래그">손 도구</button><button id="wb-fit" title="화면에 맞춤">맞춤</button></div>`;
  document.querySelector(".toolbar").after(bar);
  const demoButton = document.createElement("button");
  demoButton.id = "wb-open-example";
  demoButton.textContent = "작업대 예제";
  demoButton.title = "편집 가능한 3장 예제 열기";
  document.querySelector(".toolbar").append(demoButton);
  demoButton.addEventListener("click", openExample);
  document.querySelector(".prototype-badge").textContent = "Workbench";
  const panel = document.querySelector(".properties-panel");
  const heading = panel.querySelector(".panel-title"),
    oldNodes = [...panel.children].filter((n) => n !== heading);
  const tabs = document.createElement("div");
  tabs.className = "inspector-tabs";
  tabs.setAttribute('role','tablist');
  tabs.setAttribute('aria-label','편집 도구');
  tabs.innerHTML = `<button data-inspector-tab="properties" class="active">속성</button><button data-inspector-tab="layers">레이어</button><button data-inspector-tab="document">문서</button>`;
  const selectionSummary=document.createElement('div');
  selectionSummary.className='wb-selection-summary';
  selectionSummary.innerHTML='<span id="wb-selection-name">개체를 선택하세요</span><button id="wb-edit-selected" disabled>내용 편집</button>';
  const groups=document.createElement('div');
  groups.className='inspector-groups';groups.setAttribute('role','group');groups.setAttribute('aria-label','도구 분류');
  const groupDefinitions=[
    {id:'edit',label:'편집',pages:['properties','layers','business','media']},
    {id:'motion',label:'모션·동작',pages:['motion','timeline','logic','scene','interaction','behavior','web']},
    {id:'document',label:'문서·내보내기',pages:['document','delivery','masters']},
  ];
  groups.innerHTML=groupDefinitions.map((group,i)=>`<button id="wb-inspector-group-${group.id}" data-inspector-group="${group.id}" aria-pressed="${i===0}" tabindex="${i===0?0:-1}">${group.label}</button>`).join('');
  const properties = document.createElement("div");
  properties.id = "wb-properties";
  properties.className = "inspector-page";
  properties.append(...oldNodes);
  panel.append(selectionSummary,groups,tabs, properties);
  const layers = document.createElement("div");
  layers.id = "wb-layers";
  layers.className = "inspector-page";
  layers.hidden = true;
  layers.innerHTML = `<div class="wb-panel-intro">위에 있는 개체가 앞에 표시됩니다. Shift로 함께 선택하고, 잠금·숨김을 따로 관리하세요.</div><div id="wb-layer-list"></div>`;
  const docPanel = document.createElement("div");
  docPanel.id = "wb-document";
  docPanel.className = "inspector-page";
  docPanel.hidden = true;
  docPanel.innerHTML = `<section class="property-section"><h3>브랜드 테마</h3><p class="property-help">테마에 연결한 개체에만 적용합니다. 직접 지정한 색·글꼴은 유지됩니다.</p><div class="property-grid">${["primary", "secondary", "background", "text"].map((key, i) => `<label>${["주 색", "보조 색", "배경 색", "글자 색"][i]}<input id="wb-theme-${key}" type="color" value="${["#2563eb", "#7c3aed", "#ffffff", "#182037"][i]}"></label>`).join("")}</div><label class="stacked-label">브랜드 글꼴<input id="wb-theme-font" value="Malgun Gothic" maxlength="256"></label><button id="wb-theme-apply" class="wb-wide">테마 적용</button><p class="property-help">글꼴은 이 PC에 설치된 글꼴을 사용합니다. HTML을 전달할 환경에서도 설치 여부를 확인하세요.</p></section><section class="property-section"><h3>슬라이드 정리</h3><label class="stacked-label">현재 슬라이드 이름<input id="wb-slide-name" maxlength="160"></label><label class="stacked-label">섹션<input id="wb-slide-section" maxlength="160" placeholder="예: 소개 / 제안 / 성과"></label><button id="wb-slide-label-apply" class="wb-wide">이름·섹션 적용</button><button id="wb-import-slides" class="wb-wide">다른 Vividly 자료에서 장 가져오기</button><p class="property-help">페이지·입력 폼·디자인을 고르고, 필요한 연결을 확인한 뒤 함께 가져옵니다. 원본 파일은 바뀌지 않습니다.</p><input id="wb-import-file" type="file" accept=".html,.htm,.json" hidden></section><section class="property-section"><h3>자료 크기</h3><div class="property-grid"><label>너비 px<input id="wb-canvas-width" type="number" min="100" max="16384"></label><label>높이 px<input id="wb-canvas-height" type="number" min="100" max="16384"></label></div><label class="stacked-label">배치 정책<select id="wb-canvas-policy"><option value="keep">개체 위치와 크기 유지</option><option value="scale">새 크기에 비례해 개체 조절</option></select></label><p class="property-help">크기 유지는 화면 밖 개체가 생길 수 있습니다. 비례 조절은 모든 장의 위치·크기를 함께 변경합니다.</p><button id="wb-canvas-apply" class="wb-wide">자료 크기 변경</button></section><section class="property-section" id="wb-recovery-panel"><h3>작업 복구</h3><p id="wb-recovery-status" class="property-help">확정된 편집을 이 PC에 자동 보관합니다.</p><button id="wb-recovery-check" class="wb-wide">복구 가능한 작업 확인</button></section><section class="property-section" id="wb-agent-panel"><h3>에이전트 연결·파일 허용</h3><p class="property-help">외부 MCP 호스트에 현재 문서의 조회와 편집을 허용합니다. 앱 안의 아바타와 별도로 켜며, 문서를 다시 열면 권한을 새로 확인합니다.</p><button id="wb-agent-toggle" class="wb-wide">이 문서에 연결 허용</button><p id="wb-agent-status" class="property-help">연결 꺼짐</p><label class="stacked-label">연결 설정<textarea id="wb-agent-config" rows="6" readonly aria-label="MCP 연결 설정"></textarea></label></section>`;
  panel.append(layers, docPanel);
  let activePage='properties',activeGroup='edit';
  const pageScroll=new Map(),groupPages=new Map([['edit','properties'],['motion','motion'],['document','document']]);
  const groupFor=name=>groupDefinitions.find(group=>group.pages.includes(name))?.id||'edit';
  function registerTab(tab,page){
    const name=tab.dataset.inspectorTab;
    tab.id=`wb-inspector-tab-${name}`;tab.setAttribute('role','tab');tab.setAttribute('aria-controls',page.id);
    page.setAttribute('role','tabpanel');page.setAttribute('aria-labelledby',tab.id);
    tab.addEventListener('click',()=>showTab(name));
  }
  function showTab(name) {
    const next=panel.querySelector(`:scope > .inspector-page[data-inspector-page="${CSS.escape(name)}"]`);
    if(!next)return false;
    const previous=activePage,prior=panel.querySelector(`:scope > .inspector-page[data-inspector-page="${CSS.escape(previous)}"]`);
    if(prior&&!prior.hidden)pageScroll.set(previous,prior.scrollTop);
    activePage=name;activeGroup=groupFor(name);groupPages.set(activeGroup,name);panel.dataset.inspectorGroup=activeGroup;tabs.setAttribute('aria-label',`${groupDefinitions.find(group=>group.id===activeGroup)?.label||'편집'} 도구`);
    for(const button of groups.querySelectorAll('button')){const chosen=button.dataset.inspectorGroup===activeGroup;button.classList.toggle('active',chosen);button.setAttribute('aria-pressed',String(chosen));button.tabIndex=chosen?0:-1;}
    for (const tab of tabs.querySelectorAll("button")){
      const chosen=tab.dataset.inspectorTab===name;
      tab.hidden=groupFor(tab.dataset.inspectorTab)!==activeGroup||['interaction','behavior','web'].includes(tab.dataset.inspectorTab)&&tab.dataset.inspectorTab!==name;
      tab.classList.toggle("active", chosen);tab.setAttribute('aria-selected',String(chosen));tab.tabIndex=chosen?0:-1;
    }
    for(const page of panel.querySelectorAll(':scope > .inspector-page')){const chosen=page.dataset.inspectorPage===name;page.hidden=!chosen;page.setAttribute('aria-hidden',String(!chosen));}
    next.scrollTop=pageScroll.get(name)||0;
    if(previous!==name)window.dispatchEvent(new CustomEvent('vividly:inspector-change',{detail:{name,previous,group:activeGroup}}));
    return true;
  }
  properties.dataset.inspectorPage = "properties";
  layers.dataset.inspectorPage = "layers";
  docPanel.dataset.inspectorPage = "document";
  registerTab(tabs.querySelector('[data-inspector-tab="properties"]'),properties);
  registerTab(tabs.querySelector('[data-inspector-tab="layers"]'),layers);
  registerTab(tabs.querySelector('[data-inspector-tab="document"]'),docPanel);
  function showGroup(name){const remembered=groupPages.get(name),available=[...tabs.querySelectorAll('button')].filter(tab=>groupFor(tab.dataset.inspectorTab)===name);return showTab(available.some(tab=>tab.dataset.inspectorTab===remembered)?remembered:available[0]?.dataset.inspectorTab);}
  groups.addEventListener('click',event=>{const button=event.target.closest('[data-inspector-group]');if(button)showGroup(button.dataset.inspectorGroup);});
  const keyboardTabs=(event,buttons,activate)=>{
    const at=buttons.indexOf(event.target.closest('button'));if(at<0)return;
    const key=event.key;if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(key))return;
    event.preventDefault();event.stopPropagation();const index=key==='Home'?0:key==='End'?buttons.length-1:(at+(['ArrowRight','ArrowDown'].includes(key)?1:-1)+buttons.length)%buttons.length;
    activate(buttons[index]);buttons[index].focus();
  };
  groups.addEventListener('keydown',event=>keyboardTabs(event,[...groups.querySelectorAll('button')],button=>showGroup(button.dataset.inspectorGroup)));
  tabs.addEventListener('keydown',event=>keyboardTabs(event,[...tabs.querySelectorAll('button')].filter(button=>!button.hidden),button=>showTab(button.dataset.inspectorTab)));
  function addInspectorPage(name, label, page) {
    page.classList.add('inspector-page'); page.dataset.inspectorPage=name; page.hidden=true;
    page.id ||= `wb-inspector-page-${name}`;
    const tab=document.createElement('button');tab.dataset.inspectorTab=name;tab.textContent=label;
    tabs.append(tab);panel.append(page);registerTab(tab,page);showTab(activePage);
  }
  showTab('properties');
  const typeLabels={text:'텍스트',shape:'도형',image:'이미지',table:'표',chart:'차트',connector:'연결선',svg:'SVG',video:'동영상'};
  const editLabels={text:'텍스트 편집',shape:'도형 텍스트 편집',image:'이미지 편집',table:'표 데이터 편집',chart:'차트 데이터 편집',connector:'연결선 편집',svg:'벡터 편집'};
  function editElement(id){return run(()=>{const element=store.activeSlide.elements.find(e=>e.id===id);if(!element||element.locked||element.hidden){notice('잠금·숨김을 해제한 뒤 내용을 편집하세요.');return;}store.selectElements([id],{expandGroups:false});beginText(id);});}
  function syncSelectionSummary(){
    const element=store.selectedElement,count=ids().length,canEdit=count===1&&element&&!element.locked&&!element.hidden;
    const name=count>1?`${count}개 개체 선택`:element?`${typeLabels[element.type]||'개체'} · ${element.name||element.text?.paragraphs.find(Boolean)||'이름 없음'}`:'개체를 선택하세요';
    if($('wb-selection-name').textContent!==name)$('wb-selection-name').textContent=name;
    $('wb-selection-name').title=name;$('wb-edit-selected').textContent=canEdit?(editLabels[element.type]||'내용 편집'):'내용 편집';$('wb-edit-selected').disabled=!canEdit;
  }
  $('wb-edit-selected').addEventListener('click',()=>{if(store.selectedId)editElement(store.selectedId);});

  const extra = document.createElement("section");
  extra.className = "property-section wb-object-section";
  extra.innerHTML = `<h3>개체 · 변형 <span id="wb-selection-count"></span></h3><label class="stacked-label">이름<input id="wb-name" maxlength="160"></label><div class="property-grid"><label>회전 °<input id="wb-rotation" type="number" step="1" value="0"></label><label>불투명도 %<input id="wb-opacity" type="number" min="0" max="100" value="100"></label><label>모서리 px<input id="wb-radius" type="number" min="0" value="0"></label></div><div class="wb-button-row"><button id="wb-lock">잠금</button><button id="wb-hide">숨김</button></div><p id="wb-mixed" class="property-help" hidden>혼합 값은 빈칸으로 표시합니다. 값을 입력하면 선택한 모든 개체에 적용합니다.</p>`;
  $("property-controls").prepend(extra);
  const design = document.createElement("section");
  design.className = "property-section";
  design.innerHTML = `<h3>CSS 디자인</h3><label class="stacked-label">채우기 효과<select id="wb-gradient-type"><option value="none">단색</option><option value="linear">선형 그라데이션</option><option value="radial">방사형 그라데이션</option></select></label><label class="stacked-label">각도 °<input id="wb-gradient-angle" type="number" value="135"></label><div id="wb-gradient-stops"></div><button id="wb-gradient-add" class="wb-wide">색상 지점 추가</button><label class="wb-check"><input id="wb-shadow-enabled" type="checkbox">그림자</label><div class="property-grid">${[
    ["x", "X 이동", 0],
    ["y", "Y 이동", 8],
    ["blur", "흐림", 24],
    ["spread", "확장", 0],
  ]
    .map(
      ([id, label, v]) =>
        `<label>${label}<input id="wb-shadow-${id}" type="number" value="${v}" ${id === "blur" ? 'min="0"' : ""}></label>`,
    )
    .join(
      "",
    )}<label>그림자 색<input id="wb-shadow-color" type="color" value="#182037"></label></div><button id="wb-design-apply" class="wb-wide primary-button">디자인 적용</button><div class="wb-button-row"><button id="wb-theme-use-fill">브랜드 채우기</button><button id="wb-theme-use-text">브랜드 글자</button><button id="wb-theme-use-font">브랜드 글꼴</button></div><p class="property-help">디자인 적용 한 번은 Undo 한 번입니다. 원본 텍스트·이미지는 유지됩니다.</p>`;
  $("property-controls").append(design);
  const crop = document.createElement("div");
  crop.className = "wb-image-tools";
  crop.innerHTML = `<button id="wb-replace-image" class="wb-wide">원본 이미지 교체</button><h4>비파괴 자르기 · 원본 비율 %</h4><div class="property-grid">${[
    ["x", "왼쪽", 0],
    ["y", "위쪽", 0],
    ["width", "너비", 100],
    ["height", "높이", 100],
  ]
    .map(
      ([id, label, v]) =>
        `<label>${label}<input id="wb-crop-${id}" type="number" min="0" max="100" value="${v}"></label>`,
    )
    .join(
      "",
    )}</div><div class="property-grid"><label>초점 X %<input id="wb-focal-x" type="number" min="0" max="100" value="50"></label><label>초점 Y %<input id="wb-focal-y" type="number" min="0" max="100" value="50"></label></div><label class="stacked-label">출처·이용 메모<input id="wb-image-source" maxlength="2048" placeholder="출처 URL 또는 확인한 이용 조건"></label><p class="property-help">기록한 메모는 권리 승인 여부를 보증하지 않습니다.</p><div class="wb-button-row"><button id="wb-crop-apply">자르기 적용</button><button id="wb-crop-reset">원본 영역</button></div>`;
  $("image-properties").append(crop);
  const slidesTools = document.createElement("div");
  slidesTools.className = "wb-slide-tools";
  slidesTools.innerHTML = `<p id="wb-slides-summary">Ctrl/Shift로 여러 장 선택</p><button id="wb-slides-select-all">모든 장 선택</button>`;
  document.querySelector(".slides-panel").append(slidesTools);
  const context = document.createElement("div");
  context.id = "wb-context-menu";
  context.className = "wb-context-menu";
  context.hidden = true;
  context.setAttribute('role','menu');context.setAttribute('aria-label','선택 개체 작업');
  context.innerHTML = `${[
    ["edit", "내용 편집"],
    ["copy", "복사"],
    ["paste", "붙여넣기"],
    ["duplicate", "복제"],
    ["style", "도형 서식·CSS 효과"],
    ["link", "하이퍼링크…"],
    ["group", "그룹"],
    ["ungroup", "그룹 해제"],
    ["lock", "잠금"],
    ["hide", "숨김"],
    ["delete", "삭제"],
  ]
    .map(([key, label]) => `<button data-context="${key}" role="menuitem" tabindex="-1">${label}</button>`)
    .join("")}`;
  document.body.append(context);

  function batch(commands, label) {
    const result = store.executeBatch(commands, label);
    if (result?.ok === false) throw new Error(result.error.message);
    return result;
  }
  function commandFor(id, params) {
    return { id, params };
  }
  function setFlags(properties) {
    return batch(
      ids().map((elementId) =>
        commandFor("element.set_properties", { elementId, properties }),
      ),
      "개체 속성",
    );
  }
  function each(fn) {
    for (const e of elements()) fn(e);
  }
  async function copy(cut = false) {
    if (!ids().length) return;
    const generation=++clipboardGeneration;
    const captured = await run(() => {
      const selected = ids(),
        payload = store.copyElements(selected);
      return {payload,selected,sessionId:store.sessionId,slideId:store.activeSlideId,revision:store.revision};
    });
    if (!captured||generation!==clipboardGeneration) return;
    clipboard = captured.payload;
    clipboardState={payload:clipboard,token:crypto.randomUUID(),status:'pending'};
    const token=clipboardState.token;
    const writeText=text=>desktop?.clipboard?desktop.clipboard.writeText(text):navigator.clipboard.writeText(text);
    const publication=clipboardWrites.then(()=>publishClipboard(captured.payload,{writeText,token}));
    clipboardWrites=publication.then(()=>undefined,()=>undefined);
    let result;try{result=await publication;}catch(error){result={payload:clipboard,token,status:'failed',errors:[error.message]};}
    if(generation!==clipboardGeneration)return;
    clipboardState=result;
    if(result.status!=='confirmed'){notice('클립보드에 쓰지 못했습니다. 원본 개체를 유지했습니다. 복사를 다시 시도하세요.',true);return;}
    if(cut)return run(()=>{
      if(!canCommitClipboardCut(captured,{sessionId:store.sessionId,slideId:store.activeSlideId,revision:store.revision,selected:ids()}))throw Error('복사하는 동안 자료나 선택이 바뀌어 잘라내기를 취소했습니다. 원본은 유지됩니다.');
      store.deleteElements(captured.selected);notice('개체를 잘라냈습니다.');
    });
    notice(result.mode==='marker'?'큰 개체를 복사했습니다. 이 창에서 붙여넣을 수 있습니다.':'개체 집합을 복사했습니다.');
  }
  async function paste() {
    const capturedSession = store.sessionId,
      capturedSlide = store.activeSlideId;
    await clipboardWrites;
    let payload = clipboard,
      contents = null;
    try {
      contents = desktop?.clipboard
        ? await desktop.clipboard.read()
        : { text: await navigator.clipboard.readText() };
    } catch (error) {
      if (!payload) {
        notice(`클립보드를 읽지 못했습니다: ${error.message}`, true);
        return;
      }
    }
    try {
      const resolved=resolveClipboardContents(contents,clipboardState);
      if(resolved.kind==='local'){payload=resolved.payload;contents=null;}
      if (contents) {
        const text = contents.text || "";
        if (
          text.includes('"kind":"vividly-elements"') ||
          text.includes('"kind": "vividly-elements"')
        )
          payload = JSON.parse(text);
        else if (contents.image) {
          const image = contents.image,
            binary = atob(image.dataBase64),
            bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
          const sha256 = [
            ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
          ]
            .map((n) => n.toString(16).padStart(2, "0"))
            .join("");
          const asset = {
            id: crypto.randomUUID(),
            mimeType: "image/png",
            width: image.width,
            height: image.height,
            bytes: bytes.length,
            sha256,
            dataBase64: image.dataBase64,
          };
          if (
            capturedSession !== store.sessionId ||
            capturedSlide !== store.activeSlideId
          )
            throw new Error(
              "자료 또는 슬라이드가 바뀌어 붙여넣기를 취소했습니다.",
            );
          return run(() => store.addImage(asset));
        } else if (text) {
          if (text.length > 65536)
            throw new Error("붙여넣을 텍스트는 65,536자 이하로 나누어 주세요.");
          payload = {
            kind: "vividly-elements",
            version: 1,
            documentId: store.document.id,
            assets: [],
            elements: [
              {
                id: "clipboard-text",
                type: "text",
                geometry: {
                  x: Math.max(0, store.document.canvas.width / 2 - 300),
                  y: Math.max(0, store.document.canvas.height / 2 - 100),
                  width: 600,
                  height: 200,
                },
                text: {
                  paragraphs: [text.replace(/\r\n?/g, "\n")],
                  textStyle: {
                    fontFamily:
                      store.document.theme?.fontFamily || "Malgun Gothic",
                    fontSize: 32,
                    lineHeight: 1.2,
                    color: store.document.theme?.colors.text || "#182037",
                    align: "left",
                    verticalAlign: "top",
                  },
                },
              },
            ],
          };
        } else {
          notice("클립보드에 지원하는 개체·텍스트·이미지가 없습니다.");
          return;
        }
      }
      if (
        capturedSession !== store.sessionId ||
        capturedSlide !== store.activeSlideId
      )
        throw new Error("자료 또는 슬라이드가 바뀌어 붙여넣기를 취소했습니다.");
      if (!payload) {
        notice("먼저 개체·텍스트·이미지를 복사하세요.");
        return;
      }
      return run(() =>
        store.pasteElements(payload, { offsetX: 24, offsetY: 24 }),
      );
    } catch (error) {
      notice(`붙여넣지 못했습니다: ${error.message}`, true);
    }
  }
  $("wb-copy").addEventListener("click", () => copy());
  $("wb-cut").addEventListener("click", () => copy(true));
  $("wb-paste").addEventListener("click", paste);
  button("wb-copy-format", () => {
    if (store.selectedId) {
      format = store.copyFormat(store.selectedId);
      notice("개체의 서식을 복사했습니다.");
    }
  });
  button("wb-paste-format", () => {
    if (format && ids().length) store.pasteFormat(ids(), format);
  });
  button("wb-group", () => store.groupElements(ids()));
  button("wb-ungroup", () => store.ungroupElements(ids()));
  for (const [key, alignment] of Object.entries({
    left: "left",
    center: "center",
    right: "right",
    top: "top",
    middle: "middle",
    bottom: "bottom",
  }))
    button(`wb-align-${key}`, () =>
      store.alignElements(ids(), alignment, value("wb-align-reference")),
    );
  button("wb-distribute-h", () =>
    store.distributeElements(ids(), "horizontal"),
  );
  button("wb-distribute-v", () => store.distributeElements(ids(), "vertical"));
  button("wb-lock", () => setFlags({ locked: true }));
  button("wb-hide", () => setFlags({ hidden: true }));
  $("wb-name").addEventListener("change", () =>
    run(() => {
      if (ids().length === 1)
        store.setElementFlags(store.selectedId, { name: value("wb-name") });
    }),
  );
  $("wb-rotation").addEventListener("change", () =>
    run(() => {
      const rotation = num("wb-rotation");
      if (Number.isFinite(rotation))
        batch(
          ids().map((elementId) =>
            commandFor("element.set_rotation", { elementId, rotation }),
          ),
          "개체 회전",
        );
    }),
  );
  for (const id of ["wb-opacity", "wb-radius"])
    $(id).addEventListener("change", () =>
      run(() =>
        batch(
          ids().map((elementId) =>
            commandFor("element.set_style", {
              elementId,
              style: {
                [id === "wb-opacity" ? "opacity" : "radius"]:
                  num(id) / (id === "wb-opacity" ? 100 : 1),
              },
            }),
          ),
          "시각 속성",
        ),
      ),
    );
  const clearBindings = (e, keys) => {
    if (!e.themeRefs) return null;
    const refs = { ...e.themeRefs };
    for (const key of keys) delete refs[key];
    return commandFor("element.set_theme_refs", { elementId: e.id, refs });
  };
  function applyDesign() {
    const gradient =
      value("wb-gradient-type") === "none"
        ? null
        : {
            type: value("wb-gradient-type"),
            angle: num("wb-gradient-angle"),
            stops: cloneDocument(stops).sort((a, b) => a.offset - b.offset),
          };
    const shadow = $("wb-shadow-enabled").checked
      ? Object.fromEntries(
          ["x", "y", "blur", "spread"]
            .map((k) => [k, num(`wb-shadow-${k}`)])
            .concat([["color", readColor("wb-shadow-color")]]),
        )
      : null;
    batch(
      ids().map((elementId) =>
        commandFor("element.set_style", {
          elementId,
          style: { gradient, shadow },
        }),
      ),
      "CSS 디자인 적용",
    );
    pending.delete("design");
  }
  button("wb-design-apply", applyDesign);
  function drawStops() {
    $("wb-gradient-stops").innerHTML = stops
      .map(
        (stop, index) =>
          `<div class="wb-gradient-stop"><input type="color" value="${colorInputRgb(stop.color)}" aria-label="지점 ${index + 1} 색" data-stop-color="${index}"><input type="number" value="${round(stop.offset * 100)}" min="0" max="100" aria-label="지점 ${index + 1} 위치" data-stop-offset="${index}"><span>%</span><button data-stop-remove="${index}" aria-label="지점 ${index + 1} 삭제" ${stops.length <= 2 ? "disabled" : ""}>×</button></div>`,
      )
      .join("");
    for (const n of $("wb-gradient-stops").querySelectorAll(
      "[data-stop-color]",
    ))
      n.addEventListener("input", () => {
        const stop = stops[+n.dataset.stopColor];
        stop.color = mergeColorInput(stop.color, n.value);
      });
    for (const n of $("wb-gradient-stops").querySelectorAll(
      "[data-stop-offset]",
    ))
      n.addEventListener("input", () => {
        stops[+n.dataset.stopOffset].offset = Number(n.value) / 100;
      });
    for (const n of $("wb-gradient-stops").querySelectorAll(
      "[data-stop-remove]",
    ))
      n.addEventListener("click", () => {
        stops.splice(+n.dataset.stopRemove, 1);
        pending.add("design");
        drawStops();
        updateStatus();
      });
  }
  $("wb-gradient-add").addEventListener("click", () => {
    if (stops.length < 16) {
      stops.push({ offset: 0.5, color: "#ffffff" });
      pending.add("design");
      drawStops();
      updateStatus();
    }
  });
  drawStops();
  function applyTheme() {
    store.setTheme({
      ...cloneDocument(store.document.theme||{}),
      colors: Object.fromEntries(
        ["primary", "secondary", "background", "text"].map((k) => [
          k,
          readColor(`wb-theme-${k}`),
        ]),
      ),
      fontFamily: value("wb-theme-font"),
    });
    pending.delete("theme");
  }
  button("wb-theme-apply", applyTheme);
  for (const [id, refs] of [
    ["wb-theme-use-fill", { fill: "primary" }],
    ["wb-theme-use-text", { textColor: "text" }],
    ["wb-theme-use-font", { fontFamily: true }],
  ])
    button(id, () =>
      batch(
        elements()
          .filter((e) =>
            id === "wb-theme-use-fill" ? e.type === "shape" : !!e.text,
          )
          .map((e) =>
            commandFor("element.set_theme_refs", {
              elementId: e.id,
              refs: { ...e.themeRefs, ...refs },
            }),
          ),
        "브랜드 테마 연결",
      ),
    );
  function applyCrop() {
    store.setImageProperties(store.selectedId, {
      crop: Object.fromEntries(
        ["x", "y", "width", "height"].map((k) => [
          k,
          num(`wb-crop-${k}`) / 100,
        ]),
      ),
      focal: { x: num("wb-focal-x") / 100, y: num("wb-focal-y") / 100 },
      source: value("wb-image-source"),
    });
    pending.delete("crop");
  }
  button("wb-crop-apply", applyCrop);
  button("wb-crop-reset", () =>
    store.setImageProperties(store.selectedId, {
      crop: { x: 0, y: 0, width: 1, height: 1 },
      focal: { x: 0.5, y: 0.5 },
    }),
  );
  $("wb-replace-image").addEventListener("click", () => {
    imageReplacement = { id: store.selectedId, sessionId: store.sessionId };
    $("image-file").click();
  });
  button("wb-slide-label-apply", () =>
    store.setSlideProperties(store.activeSlideId, {
      name: value("wb-slide-name"),
      section: value("wb-slide-section"),
    }),
  );
  button("wb-canvas-apply", () =>
    store.resizeCanvas(
      num("wb-canvas-width"),
      num("wb-canvas-height"),
      value("wb-canvas-policy"),
    ),
  );
  $("wb-import-slides").addEventListener("click", () =>
    importLibrary ? importLibrary() : $("wb-import-file").click(),
  );
  $("wb-import-file").addEventListener("change", async (event) => {
    const file = event.target.files[0],
      captured = store.sessionId;
    if (!file) return;
    try {
      const raw = await file.text(),
        doc = await validateAssetBytes(
          file.name.endsWith(".json")
            ? normalizeDocument(JSON.parse(raw))
            : parsePresentation(raw),
        );
      if (captured !== store.sessionId)
        throw new Error("자료가 바뀌어 가져오기를 취소했습니다.");
      await run(() =>
        selectCreatedSlides(
          store.importSlides(
            doc,
            doc.slides.map((s) => s.id),
          ),
        ),
      );
      notice(`${doc.slides.length}장을 편집 가능한 개체로 가져왔습니다.`);
    } catch (e) {
      notice(e.message, true);
    }
    event.target.value = "";
  });
  $("wb-slides-select-all").addEventListener("click", () => {
    selectedSlides = new Set(store.document.slides.map((s) => s.id));
    syncSlides();
  });
  $("wb-pan").addEventListener("click", () => {
    panMode = !panMode;
    viewport.classList.toggle("wb-pan-mode", panMode);
    $("wb-pan").classList.toggle("active", panMode);
  });
  $("wb-fit").addEventListener("click", () => {
    $("zoom-select").value = "fit";
    applyZoom();
    syncEngine();
  });

  // Moveable calculates transformed DOM geometry; canonical state is committed once at gesture end.
  const moveable = new Moveable(stage, {
    target: [],
    container: stage,
    rootContainer: viewport,
    draggable: true,
    resizable: true,
    rotatable: true,
    origin: false,
    checkInput: true,
    preventDefault: true,
    snappable: true,
    snapGap:true,isDisplaySnapDigit:true,snapDigit:0,
    snapThreshold: 6,
    snapGridWidth: 0,
    snapGridHeight: 0,
    snapDirections: {
      left: true,
      center: true,
      right: true,
      top: true,
      middle: true,
      bottom: true,
    },
    elementSnapDirections: {
      left: true,
      center: true,
      right: true,
      top: true,
      middle: true,
      bottom: true,
    },
    throttleDrag: 0,
    throttleResize: 0,
    throttleRotate: 1,
    keepRatio: false,
    renderDirections: ["nw", "n", "ne", "w", "e", "sw", "s", "se"],
  });
  function beginGesture(kind, events) {
    if (busy() || !ids().length) return false;
    if(kind==='rotate'&&elements().some(e=>e.flow)){notice('자동 배치 컨테이너는 배치를 해제한 뒤 회전할 수 있습니다.');return false;}
    if(kind!=='rotate'&&store.activeSlide.elements.some(parent=>parent.flow?.children.some(id=>ids().includes(id)))){notice('자동 배치 구성원입니다. 스타일에서 순서·간격을 조절하거나 배치를 해제하세요.');return false;}
    commitControls();
    store.finishText();
    store.beginMultiTransform(ids(), kind);
    dragging = true;
    gesture = {
      kind,
      before: new Map(elements().map((e) => [e.id, cloneDocument(e)])),
      moved: false,
    };
    for (const event of events) {
      const e = gesture.before.get(event.target.dataset.elementId);
      if (!e) continue;
      if (kind === "move") event.set?.([e.geometry.x, e.geometry.y]);
      if (kind === "resize") {
        event.set?.([e.geometry.width, e.geometry.height]);
        event.dragStart?.set([e.geometry.x, e.geometry.y]);
      }
      if (kind === "rotate") {
        event.set?.(e.rotation || 0);
        event.dragStart?.set([e.geometry.x, e.geometry.y]);
      }
    }
    updateStatus();
    return true;
  }
  function preview(kind, events) {
    if (!gesture || gesture.kind !== kind) return;
    const updates = [];
    for (const e of events) {
      const id = e.target.dataset.elementId,
        before = gesture.before.get(id);
      if (!before) continue;
      let geometry = { ...before.geometry },
        rotation = before.rotation || 0;
      if (kind === "move") {
        geometry.x = e.beforeTranslate[0];
        geometry.y = e.beforeTranslate[1];
      }
      if (kind === "resize") {
        geometry = {
          x: e.drag.beforeTranslate[0],
          y: e.drag.beforeTranslate[1],
          width: Math.max(1, e.width),
          height: Math.max(1, e.height),
        };
      }
      if (kind === "rotate") {
        rotation = e.beforeRotate;
        if (e.drag?.beforeTranslate) {
          geometry.x = e.drag.beforeTranslate[0];
          geometry.y = e.drag.beforeTranslate[1];
        }
      }
      for (const key of Object.keys(geometry))
        geometry[key] = round(geometry[key]);
      rotation = round(rotation);
      updates.push({
        elementId: id,
        geometry,
        ...(kind === "rotate" ? { rotation } : {}),
      });
      Object.assign(e.target.style, {
        left: `${geometry.x}px`,
        top: `${geometry.y}px`,
        width: `${geometry.width}px`,
        height: `${geometry.height}px`,
        transform: `rotate(${rotation}deg)`,
      });
    }
    if (updates.length) {
      store.previewMultiGeometry(updates);
      refreshConnections?.();
      gesture.moved = true;
      updateStatus();
    }
  }
  function endGesture() {
    if (!gesture) return;
    try {
      gesture.moved ? store.commitTransform() : store.cancelTransform();
    } catch (e) {
      store.cancelTransform();
      notice(e.message, true);
    }
    gesture = null;
    dragging = false;
    queueMicrotask(() => {
      render();
      flushReady();
    });
  }
  for (const [kind, prefix] of [
    ["move", "drag"],
    ["resize", "resize"],
    ["rotate", "rotate"],
  ]) {
    const delegated = (e) =>
      kind === "move" &&
      e.inputEvent?.target?.closest?.(
        ".moveable-direction,.moveable-rotation-control",
      );
    moveable
      .on(`${prefix}Start`, (e) => {
        if (delegated(e)) return;
        if (!beginGesture(kind, [e])) e.stop();
      })
      .on(prefix, (e) => preview(kind, [e]))
      .on(`${prefix}End`, () => {
        if (gesture?.kind === kind) endGesture();
      });
    moveable
      .on(`${prefix}GroupStart`, (e) => {
        if (delegated(e)) return;
        if (!beginGesture(kind, e.events)) e.stop();
      })
      .on(`${prefix}Group`, (e) => preview(kind, e.events))
      .on(`${prefix}GroupEnd`, () => {
        if (gesture?.kind === kind) endGesture();
      });
  }
  const selecto = new Selecto({
    container: viewport,
    dragContainer: stage,
    rootContainer: viewport,
    selectableTargets: [
      '#slide-content .slide-element:not([data-locked="true"])',
    ],
    selectByClick: false,
    selectFromInside: false,
    continueSelect: false,
    toggleContinueSelect: "shift",
    keyContainer: window,
    hitRate: 0,
    getElementRect: (el) => getElementInfo(el),
  });
  selecto.on("dragStart", (e) => {
    if (
      busy() ||
      panMode ||
      spacePan ||
      editable(e.inputEvent?.target) ||
      moveable.isMoveableElement(e.inputEvent?.target)
    )
      e.stop();
    else commitControls();
  });
  selecto.on("selectEnd", (e) => {
    if (!e.isDragStart && e.selected.length) {
      run(() =>
        store.selectElements(e.selected.map((n) => n.dataset.elementId)),
      );
    }
  });
  // Moveable/Gesto consumes the native mouse stream. Cancelling pointerdown
  // suppresses its compatibility mousedown/move events in Chromium.
  stage.addEventListener("pointerdown", (event) => {
    if (composing() && !event.target.closest("#text-editor")) event.preventDefault();
  });
  stage.addEventListener("mousedown", (event) => {
    if (
      event.button !== 0 ||
      event.target.closest("#text-editor") ||
      moveable.isMoveableElement(event.target) ||
      panMode ||
      spacePan
    )
      return;
    if (composing()) {
      event.preventDefault();
      return;
    }
    const target = event.target.closest(".slide-element[data-element-id]"),
      id = target?.dataset.elementId;
    if (target?.dataset.locked === "true") return;
    if(target?.classList.contains('element-connector')){
      event.preventDefault();
      try{commitControls();store.finishText();event.shiftKey?store.toggleSelection(id):store.selectElements([id],{expandGroups:false});sync();refreshSelection();}catch(error){notice(error.message,true);}
      return;
    }
    try {
      commitControls();
      store.finishText();
    } catch (error) {
      notice(error.message, true);
      return;
    }
    if (!id) {
      if (!event.shiftKey) store.selectElements([]);
      sync();
      return;
    }
    event.preventDefault();
    if (event.shiftKey) {
      store.toggleSelection(id);
      sync();
      return;
    }
    if (!ids().includes(id)) {
      heldMouseEvent = event;
      const changed = moveable.waitToChangeTarget();
      store.selectElements([id]);
      sync();
      changed.then(() => {
        if (
          heldMouseEvent === event &&
          ids().includes(id) &&
          !composing() &&
          !store.textSession &&
          !moveable.isDragging()
        )
          moveable.dragStart(event);
      });
    }
    stage.focus();
  });
  // Selection/Moveable may rebuild a target between two clicks. Keep only the
  // native pointer hit and distance; never turn a moved pointer into an edit.
  let editPointer=null,lastEditTap=null,lastPointerEdit=null;
  stage.addEventListener('pointerdown',event=>{
    const target=event.target.closest('.slide-element[data-element-id]');
    editPointer=event.button===0&&target&&target.dataset.locked!=='true'&&!editable(event.target)&&!moveable.isMoveableElement(event.target)&&!panMode&&!spacePan&&!composing()
      ?{id:target.dataset.elementId,pointerId:event.pointerId,x:event.clientX,y:event.clientY,moved:false,sessionId:store.sessionId,slideId:store.activeSlideId}:null;
  });
  stage.addEventListener('pointermove',event=>{if(editPointer&&editPointer.pointerId===event.pointerId&&Math.hypot(event.clientX-editPointer.x,event.clientY-editPointer.y)>4)editPointer.moved=true;});
  stage.addEventListener('pointercancel',()=>{editPointer=null;lastEditTap=null;});
  stage.addEventListener('pointerup',event=>{
    const tap=editPointer;editPointer=null;
    if(!tap||tap.moved||tap.pointerId!==event.pointerId||tap.sessionId!==store.sessionId||tap.slideId!==store.activeSlideId||composing()){lastEditTap=null;return;}
    const previous=lastEditTap;lastEditTap={...tap,time:event.timeStamp};
    if(!previous||previous.id!==tap.id||previous.sessionId!==tap.sessionId||previous.slideId!==tap.slideId||event.timeStamp-previous.time>500||Math.hypot(event.clientX-previous.x,event.clientY-previous.y)>5)return;
    lastEditTap=null;lastPointerEdit={id:tap.id,time:event.timeStamp};
    queueMicrotask(()=>{if(tap.sessionId===store.sessionId&&tap.slideId===store.activeSlideId&&!composing())editElement(tap.id);});
  });
  stage.addEventListener("dblclick", (event) => {
    const target = event.target.closest(".slide-element[data-element-id]");
    if (!target || target.dataset.locked === "true" || composing() || dragging)
      return;
    const id=target.dataset.elementId;
    if(lastPointerEdit?.id===id&&event.timeStamp-lastPointerEdit.time<700)return;
    editElement(id);
  });
  viewport.addEventListener(
    "pointerdown",
    (event) => {
      if (
        event.button !== 0 ||
        (!panMode && !spacePan) ||
        editable(event.target)
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      pan = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        left: viewport.scrollLeft,
        top: viewport.scrollTop,
      };
      viewport.setPointerCapture(event.pointerId);
    },
    true,
  );
  viewport.addEventListener("pointermove", (event) => {
    if (pan && pan.id === event.pointerId) {
      viewport.scrollLeft = pan.left - (event.clientX - pan.x);
      viewport.scrollTop = pan.top - (event.clientY - pan.y);
    }
  });
  viewport.addEventListener("pointerup", () => {
    pan = null;
  });
  viewport.addEventListener(
    "wheel",
    (event) => {
      if (
        !(event.ctrlKey || event.metaKey) ||
        editable(event.target) ||
        composing()
      )
        return;
      event.preventDefault();
      const next = Math.max(
        25,
        Math.min(
          250,
          Math.round(scale() * 100 + (event.deltaY < 0 ? 10 : -10)),
        ),
      );
      let option = [...$("zoom-select").options].find(
        (o) => o.value === String(next),
      );
      if (!option) {
        option = new Option(`${next}%`, String(next));
        $("zoom-select").add(option);
      }
      $("zoom-select").value = String(next);
      applyZoom();
      syncEngine();
    },
    { passive: false },
  );
  document.addEventListener(
    "keydown",
    (event) => {
      if (
        event.defaultPrevented ||
        event.target.closest?.('dialog[open],[role="menu"]') ||
        event.target.closest?.('#slide-list,#slide-context-menu') ||
        editable(event.target) ||
        composing() || interactionBusy() ||
        $("presentation").hidden === false
      )
        return;
      const ctrl = event.ctrlKey || event.metaKey;
      if (event.code === "Space"&&!event.target.closest?.('button,a,summary,[role="tab"]')) {
        spacePan = true;
        viewport.classList.add("wb-pan-mode");
        event.preventDefault();
      }
      if (ctrl && !(event.shiftKey&&event.key.toLowerCase()==='x') && ["c", "x", "v", "g", "a"].includes(event.key.toLowerCase())) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const key = event.key.toLowerCase();
        if (key === "c") copy();
        if (key === "x") copy(true);
        if (key === "v") paste();
        if (key === "g")
          run(() =>
            event.shiftKey
              ? store.ungroupElements(ids())
              : store.groupElements(ids()),
          );
        if (key === "a")
          run(() =>
            store.selectElements(
              store.activeSlide.elements
                .filter((e) => !e.locked && !e.hidden)
                .map((e) => e.id),
            ),
          );
      }
    },
    true,
  );
  document.addEventListener("keyup", (event) => {
    if (event.code === "Space") {
      spacePan = false;
      viewport.classList.toggle("wb-pan-mode", panMode);
    }
  });
  let contextReturnFocus=null,contextTarget=null;
  function closeContext(restoreFocus=false){context.hidden=true;if(restoreFocus){const target=contextReturnFocus?.isConnected?contextReturnFocus:stage;target.focus?.({preventScroll:true});}}
  function syncContextActions(){
    const selected=elements(),count=selected.length,editableSelection=count>0&&selected.every(e=>!e.locked&&!e.hidden);
    for(const button of context.querySelectorAll('button')){
      const key=button.dataset.context;
      button.disabled=key==='paste'?false:key==='edit'?count!==1||!editableSelection:key==='group'?count<2||!editableSelection:key==='ungroup'?!editableSelection||!selected.some(e=>e.groupId):['lock','hide','delete'].includes(key)?!editableSelection:count===0;
      if(key==='edit')button.textContent=count===1?(editLabels[selected[0].type]||'내용 편집'):'내용 편집';
      if(key==='style'){button.disabled=!editableSelection;button.textContent=selected.every(e=>e.type==='shape')?'도형 서식·CSS 효과':'개체 서식·CSS 효과';}
      if(key==='link')button.disabled=count!==1||!editableSelection;
    }
  }
  stage.addEventListener("contextmenu", async (event) => {
    if(event.target.closest('.tl-preview')){event.preventDefault();return;}
    if (editable(event.target)) return;
    event.preventDefault();
    if(composing()){notice('입력 조합을 마친 뒤 개체 작업을 실행하세요.');return;}
    const sessionId=store.sessionId,slideId=store.activeSlideId;
    const target = event.target.closest(".slide-element[data-element-id]");
    if (target && !ids().includes(target.dataset.elementId))
      await run(() => store.selectElements([target.dataset.elementId]));
    if(sessionId!==store.sessionId||slideId!==store.activeSlideId)return;
    contextReturnFocus=document.activeElement&&document.activeElement!==document.body?document.activeElement:stage;contextTarget={sessionId:store.sessionId,slideId:store.activeSlideId,revision:store.revision,selection:JSON.stringify(ids())};syncContextActions();
    context.hidden = false;
    const bounds=context.getBoundingClientRect();
    context.style.left = `${Math.max(6,Math.min(event.clientX, innerWidth - bounds.width-6))}px`;
    context.style.top = `${Math.max(6,Math.min(event.clientY, innerHeight - bounds.height-6))}px`;
    context.querySelector('button:not(:disabled)')?.focus({preventScroll:true});
  });
  document.addEventListener("pointerdown", (event) => {
    if (!context.contains(event.target)) closeContext();
  });
  context.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeContext(true);return;}
    if(event.key==='Tab'){closeContext(true);return;}
    keyboardTabs(event,[...context.querySelectorAll('button:not(:disabled)')],()=>{});
  });
  context.addEventListener("click", (event) => {
    const button=event.target.closest('[data-context]');if(!button||button.disabled)return;
    const key = button.dataset.context;
    closeContext();
    if(!contextTarget||contextTarget.sessionId!==store.sessionId||contextTarget.slideId!==store.activeSlideId||contextTarget.revision!==store.revision||contextTarget.selection!==JSON.stringify(ids())){notice('메뉴를 연 뒤 선택이나 자료가 바뀌었습니다. 대상을 다시 선택하세요.');return;}
    if (key === "edit") editElement(store.selectedId);
    if (key === "copy") copy();
    if (key === "paste") paste();
    if (key === "duplicate") duplicate();
    if(key==='style')run(()=>showObjectStyle());
    if(key==='link')openLink();
    if (key === "group") run(() => store.groupElements(ids()));
    if (key === "ungroup") run(() => store.ungroupElements(ids()));
    if (key === "lock") run(() => setFlags({ locked: true }));
    if (key === "hide") run(() => setFlags({ hidden: true }));
    if (key === "delete") remove();
  });

  function syncEngine() {
    if (!enginesReady || dragging) return;
    const targets = store.textSession || interactionBusy()
      ? []
      : nodes().filter((n) => n.dataset.locked !== "true" && !n.classList.contains('element-connector'));
    const current = Array.isArray(moveable.target)
      ? moveable.target
      : moveable.target
        ? [moveable.target]
        : [];
    if (
      current.length !== targets.length ||
      targets.some((n, i) => n !== current[i])
    )
      moveable.target = targets.length === 1 ? targets[0] : targets;
    moveable.zoom = 1 / scale();
    const flowMember=store.activeSlide.elements.some(e=>e.flow?.children.some(id=>ids().includes(id)));
    moveable.draggable=!flowMember;moveable.resizable=!flowMember;moveable.rotatable=!elements().some(e=>e.flow);
    moveable.snappable = $("wb-snap").checked;
    moveable.snapGridWidth=moveable.snapGridHeight=$('ag-grid-snap')?.checked?Math.max(2,Math.min(200,Number($('ag-grid-size').value)||20)):0;
    moveable.snapGap=$('ag-gaps')?.checked!==false;
    moveable.isDisplaySnapDigit=$('ag-gaps')?.checked!==false;
    moveable.elementGuidelines = [
      ...stage.querySelectorAll(".slide-element"),
    ].filter((n) => $('ag-objects')?.checked!==false&&!ids().includes(n.dataset.elementId)&&!n.classList.contains('element-connector'));
    moveable.verticalGuidelines = [
      0,
      store.document.canvas.width / 2,
      store.document.canvas.width,
    ];
    moveable.horizontalGuidelines = [
      0,
      store.document.canvas.height / 2,
      store.document.canvas.height,
    ];
    moveable.updateRect();
    if (!engineFrame)
      engineFrame = requestAnimationFrame(() => {
        engineFrame = 0;
        if (!dragging)
          moveable.forceUpdate(() => {
            moveable.updateRect();
            for (const n of stage.querySelectorAll(".moveable-direction")) {
              const dir = ["nw", "n", "ne", "e", "se", "s", "sw", "w"].find(
                (d) => n.classList.contains(`moveable-${d}`),
              );
              if (dir) n.dataset.resizeHandle = dir;
            }
          });
      });
    selecto.setSelectedTargets(nodes());
    for (const n of stage.querySelectorAll(".moveable-direction")) {
      const dir = ["nw", "n", "ne", "e", "se", "s", "sw", "w"].find((d) =>
        n.classList.contains(`moveable-${d}`),
      );
      if (dir) n.dataset.resizeHandle = dir;
    }
  }
  $("wb-snap").addEventListener("change", syncEngine);
  function fill(id, v) {
    if (document.activeElement !== $(id)) $(id).value = v ?? "";
  }
  function fillColor(id, color) {
    const field = $(id);
    if (document.activeElement !== field) {
      field.value = colorInputRgb(color);
      colorSources.set(field, color);
    }
  }
  function readColor(id) {
    const field = $(id);
    return mergeColorInput(colorSources.get(field) ?? field.value, field.value);
  }
  function common(get) {
    const all = elements().map(e=>resolveDesignElement(e,store.document).element).map(get);
    return all.length &&
      all.every((v) => JSON.stringify(v) === JSON.stringify(all[0]))
      ? all[0]
      : "";
  }
  function syncProperties() {
    const e = store.selectedElement?resolveDesignElement(store.selectedElement,store.document).element:null;
    if (!e) return;
    $("wb-selection-count").textContent = `${ids().length}개`;
    $("wb-mixed").hidden = ids().length <= 1;
    fill("wb-name", ids().length === 1 ? e.name || "" : "");
    $("wb-name").disabled = ids().length !== 1;
    $("wb-rotation").disabled=elements().some(e=>e.flow);
    fill(
      "wb-rotation",
      common((e) => e.rotation || 0),
    );
    fill(
      "wb-opacity",
      common((e) => Math.round((e.style?.opacity ?? 1) * 100)),
    );
    fill(
      "wb-radius",
      common((e) => e.style?.radius || 0),
    );
    if (!pending.has("design")) {
      const g = e.style?.gradient;
      fill("wb-gradient-type", g?.type || "none");
      fill("wb-gradient-angle", g?.angle ?? 135);
      if (!design.contains(document.activeElement)) {
        stops = cloneDocument(
          g?.stops || [
            { offset: 0, color: e.fill || "#2563eb" },
            { offset: 1, color: "#7c3aed" },
          ],
        );
        drawStops();
      }
      const shadow = e.style?.shadow;
      $("wb-shadow-enabled").checked = !!shadow;
      for (const [k, v] of Object.entries({
        x: 0,
        y: 8,
        blur: 24,
        spread: 0,
        color: "#182037",
      }))
        (k === "color" ? fillColor : fill)(`wb-shadow-${k}`, shadow?.[k] ?? v);
    }
    if (e.type === "image" && !pending.has("crop")) {
      for (const [k, v] of Object.entries({ x: 0, y: 0, width: 1, height: 1 }))
        fill(`wb-crop-${k}`, round((e.crop?.[k] ?? v) * 100));
      fill("wb-focal-x", (e.focal?.x ?? 0.5) * 100);
      fill("wb-focal-y", (e.focal?.y ?? 0.5) * 100);
      fill("wb-image-source", e.source || "");
    }
    for (const key of ["x", "y", "width", "height"]) {
      const field = $(`property-${key}`);
      if (document.activeElement !== field) {
        const v = common((e) => round(e.geometry[key]));
        field.value = v;
        field.placeholder = v === "" ? "혼합" : "";
      }
    }
  }
  function syncLayers() {
    $("wb-layer-list").innerHTML = [...store.activeSlide.elements]
      .reverse()
      .map(
        (e) =>
          `<div class="wb-layer-row ${ids().includes(e.id) ? "selected" : ""}" data-id="${escape(e.id)}"><button data-action="select" title="개별 선택 · Shift 다중 선택 · 두 번 눌러 내용 편집"><span class="wb-layer-kind">${escape(typeLabels[e.type]||'개체')}</span><span>${escape(e.name || e.text?.paragraphs.find(Boolean) || typeLabels[e.type]||'개체')}${e.groupId ? " · 그룹" : ""}</span></button><button data-action="lock" aria-label="${e.locked ? "잠금 해제" : "잠금"}" aria-pressed="${!!e.locked}">${e.locked ? "🔒" : "◇"}</button><button data-action="hide" aria-label="${e.hidden ? "표시" : "숨김"}" aria-pressed="${!!e.hidden}">${e.hidden ? "◌" : "●"}</button></div>`,
      )
      .join("");
  }
  $("wb-layer-list").addEventListener("click", (event) => {
    const row = event.target.closest("[data-id]"),
      key = event.target.closest("[data-action]")?.dataset.action;
    if (!row || !key) return;
    const e = store.activeSlide.elements.find((e) => e.id === row.dataset.id);
    run(() => {
      if (key === "select") {
        if (e.locked || e.hidden) {
          notice("잠금·숨김 버튼을 해제한 뒤 편집하세요.");
          return;
        }
        const next = event.shiftKey
          ? ids().includes(e.id)
            ? ids().filter((id) => id !== e.id)
            : [...ids(), e.id]
          : [e.id];
        store.selectElements(next, { expandGroups: false });
      }
      if (key === "lock") store.setElementFlags(e.id, { locked: !e.locked });
      if (key === "hide") store.setElementFlags(e.id, { hidden: !e.hidden });
    });
  });
  let layerTap=null;
  $('wb-layer-list').addEventListener('click',event=>{
    const button=event.target.closest('[data-action="select"]'),row=button?.closest('[data-id]');if(!row||event.shiftKey)return;
    const current={id:row.dataset.id,time:event.timeStamp,session:store.sessionId,slide:store.activeSlideId};
    if(layerTap?.id===current.id&&layerTap.session===current.session&&layerTap.slide===current.slide&&current.time-layerTap.time<500){layerTap=null;editElement(current.id);}else layerTap=current;
  });
  function syncSlides() {
    selectedSlides = new Set(
      [...selectedSlides].filter((id) =>
        store.document.slides.some((s) => s.id === id),
      ),
    );
    if (!selectedSlides.size || !selectedSlides.has(store.activeSlideId))
      selectedSlides = new Set([store.activeSlideId]);
    for (const card of $("slide-list").children) {
      card.classList.toggle(
        "wb-slide-selected",
        selectedSlides.has(card.dataset.slideId),
      );
      card.draggable = true;
      card.ondragstart = (event) => {
        if (!selectedSlides.has(card.dataset.slideId))
          selectedSlides = new Set([card.dataset.slideId]);
        event.dataTransfer.setData(
          "application/x-vividly-slides",
          JSON.stringify([...selectedSlides]),
        );
      };
      card.ondragover = e => {e.preventDefault();const after=e.clientY>card.getBoundingClientRect().top+card.offsetHeight/2;card.dataset.dropAfter=String(after);card.classList.toggle('slide-drop-after',after);card.classList.toggle('slide-drop-before',!after);};card.ondragleave=()=>card.classList.remove('slide-drop-before','slide-drop-after');
      card.ondragend=()=>{for(const node of $('slide-list').children)node.classList.remove('slide-drop-before','slide-drop-after');};
      card.ondrop = (event) => {
        event.preventDefault();
        card.classList.remove('slide-drop-before','slide-drop-after');
        try {
          const moving = JSON.parse(
            event.dataTransfer.getData("application/x-vividly-slides"),
          );
          const remaining=store.document.slides.filter(s=>!moving.includes(s.id));
          const targetIndex=remaining.findIndex(s=>s.id===card.dataset.slideId);
          if(targetIndex>=0)run(()=>store.moveSlides(moving,targetIndex+(card.dataset.dropAfter==='true'?1:0)));
        } catch {}
      };
    }
    const total = selectedSlides.size;
    $("wb-slides-summary").textContent =
      total > 1
        ? `${total}장 선택 · 드래그로 함께 이동`
        : "Ctrl/Shift로 여러 장 선택";
  }
  function onSlideClick(event, id) {
    if (event.shiftKey) {
      const a = store.document.slides.findIndex((s) => s.id === slideAnchor),
        b = store.document.slides.findIndex((s) => s.id === id);
      selectedSlides = new Set(
        store.document.slides
          .slice(Math.min(a, b), Math.max(a, b) + 1)
          .map((s) => s.id),
      );
    } else if (event.ctrlKey || event.metaKey) {
      selectedSlides.has(id)
        ? selectedSlides.delete(id)
        : selectedSlides.add(id);
      if (!selectedSlides.size) selectedSlides.add(id);
    } else {
      selectedSlides = new Set([id]);
      slideAnchor = id;
    }
    return run(() => store.switchSlide(id));
  }
  function remove() {
    return run(() => store.deleteElements(ids()));
  }
  function selectCreatedSlides(created) {
    if (Array.isArray(created) && created.length)
      selectedSlides = new Set(created);
    return created;
  }
  function duplicate() {
    return run(() => {
      if (ids().length)
        return store.pasteElements(store.copyElements(ids()), {
          offsetX: 24,
          offsetY: 24,
        });
      return selectCreatedSlides(store.duplicateSlides([...selectedSlides]));
    });
  }
  function onNewSession() {
    pending.clear();
    selectedSlides = new Set([store.activeSlideId]);
    slideAnchor = store.activeSlideId;
    session = store.sessionId;
    lastRecovery = "";
  }
  function sync() {
    if (syncing) return;
    syncing = true;
    try {
      if (session !== store.sessionId) onNewSession();
      for (const n of stage.querySelectorAll(".slide-element"))
        n.classList.toggle("wb-selected", ids().includes(n.dataset.elementId));
      $("selection-overlay").hidden = true;
      refreshSelection();
      syncProperties();
      syncSelectionSummary();
      syncLayers();
      syncSlides();
      fill("wb-slide-name", store.activeSlide.name || "");
      fill("wb-slide-section", store.activeSlide.section || "");
      fill("wb-canvas-width", store.document.canvas.width);
      fill("wb-canvas-height", store.document.canvas.height);
      const theme = store.document.theme;
      if (!pending.has("theme"))
        for (const [k, v] of Object.entries({
          primary: "#2563eb",
          secondary: "#7c3aed",
          background: "#ffffff",
          text: "#182037",
        }))
          fillColor(`wb-theme-${k}`, theme?.colors?.[k] || v);
      if (!pending.has("theme"))
        fill("wb-theme-font", theme?.fontFamily || "Malgun Gothic");
      for (const id of [
        "wb-copy",
        "wb-cut",
        "wb-group",
        "wb-ungroup",
        "wb-paste-format",
      ])
        $(id).disabled = !ids().length;
      $("selection-kind").textContent =
        ids().length > 1
          ? `${ids().length}개 선택`
          : $("selection-kind").textContent;
      syncEngine();
      scheduleRecovery();
    } finally {
      syncing = false;
    }
  }
  function cancel() {
    if (gesture) {
      store.cancelTransform();
      gesture = null;
      dragging = false;
      moveable.stopDrag();
      render();
      flushReady();
    }
  }
  async function checkRecovery() {
    if (!desktop?.recovery) return;
    try {
      const item = await desktop.recovery.read();
      if (!item.available) {
        recoveryReady = true;
        scheduleRecovery();
        notice(item.warning || "복구 가능한 작업이 없습니다.");
        return;
      }
      const dialog = document.createElement("dialog");
      dialog.className = "wb-dialog";
      dialog.innerHTML = `<h2>이전 작업을 복구할까요?</h2><p>${escape(item.title || "이름 없는 자료")}</p><p class="property-help">${escape(item.savedAt || "")} · 수동 저장 파일을 덮어쓰지 않고 새 편집 세션으로 엽니다.</p>${item.warning ? `<p>${escape(item.warning)}</p>` : ""}<div class="wb-button-row"><button data-choice="later">나중에</button><button data-choice="discard">이 복구본 버리기</button><button data-choice="restore" class="primary-button">복구하기</button></div>`;
      document.body.append(dialog);
      dialog.showModal();
      dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        notice(
          "복구하기 또는 버리기를 선택하세요. 복구본은 안전하게 보관됩니다.",
        );
      });
      dialog.addEventListener("click", async (event) => {
        const choice = event.target.dataset.choice;
        if (!choice) return;
        if (choice === "restore") {
          const restored = await restoreDocument(item.document);
          if (!restored) return;
          restoredRecovery = {
            recoveryId: item.recoveryId,
            sessionId: store.sessionId,
          };
        }
        if (choice === "discard")
          await desktop.recovery.clear({ recoveryId: item.recoveryId });
        recoveryReady = choice !== "later";
        dialog.close();
        dialog.remove();
        if (choice === "later")
          $("wb-recovery-status").textContent =
            "이전 복구본 결정 대기 · 자동 보관 보류";
        if (choice === "later")
          notice(
            "이전 복구본을 보존했습니다. 문서 탭에서 복구를 결정하면 자동 보관을 시작합니다.",
          );
        scheduleRecovery();
      });
    } catch (e) {
      notice(`복구 확인: ${e.message}`, true);
    }
  }
  function scheduleRecovery() {
    if (
      !desktop?.recovery ||
      !recoveryReady ||
      !store.isDirty ||
      recoveryWriting
    )
      return;
    const key = `${store.sessionId}:${store.revision}:${store.isDirty}`;
    if (key === lastRecovery) return;
    clearTimeout(recoveryTimer);
    recoveryTimer = setTimeout(async () => {
      if (!recoveryReady || !store.isDirty) return;
      const nowKey = `${store.sessionId}:${store.revision}:${store.isDirty}`;
      try {
        recoveryWriting = true;
        const result = await desktop.recovery.write({
          sessionId: store.sessionId,
          revision: store.revision,
          title: store.document.title,
          document: cloneDocument(store.document),
        });
        if (result?.written !== false) lastRecovery = nowKey;
        $("wb-recovery-status").textContent =
          `작업 자동 보관 · ${new Date().toLocaleTimeString("ko-KR")}`;
      } catch (e) {
        $("wb-recovery-status").textContent = `자동 보관 실패: ${e.message}`;
      } finally {
        recoveryWriting = false;
        if (
          `${store.sessionId}:${store.revision}:${store.isDirty}` !==
          lastRecovery
        )
          scheduleRecovery();
      }
    }, 900);
  }
  $("wb-recovery-check").addEventListener("click", checkRecovery);
  let agentEnabled = false;
  async function refreshAgent() {
    if (!desktop?.agent) return;
    try {
      const status = await desktop.agent.getStatus();
      agentEnabled = status.enabled;
      $("wb-agent-config").closest("label").hidden = !status.enabled;
      $("wb-agent-toggle").textContent = status.enabled
        ? "연결 허용 해제"
        : "이 문서에 연결 허용";
      $("wb-agent-status").textContent = status.enabled
        ? `연결 허용 · ${status.instanceId}`
        : "연결 꺼짐";
      $("wb-agent-config").value = status.launchConfig
        ? JSON.stringify(
            { mcpServers: { vividly: status.launchConfig } },
            null,
            2,
          )
        : status.descriptorPath || "";
    } catch (e) {
      $("wb-agent-status").textContent = e.message;
    }
  }
  $("wb-agent-toggle").addEventListener("click", async () => {
    try {
      await desktop?.agent?.setEnabled(!agentEnabled);
      await refreshAgent();
    } catch (e) {
      notice(e.message, true);
    }
  });
  if (desktop?.agent) {
    desktop.agent.onRequest(async request=>{const result=hostOperation&&request.method?.startsWith('io')?await hostOperation(request):await dispatchAgentRequest(request,{store,render,notice});desktop.agent.respond({requestId:request.requestId,result});});
    desktop.agent.onStatus?.(refreshAgent);
    refreshAgent();
  } else {
    $("wb-agent-panel").hidden = true;
  }
  if (!desktop?.recovery) $("wb-recovery-panel").hidden = true;
  for (const [container, kind] of [
    [design, "design"],
    [crop, "crop"],
  ])
    container.addEventListener("input", () => {
      pending.add(kind);
      updateStatus();
    });
  for (const key of ["primary", "secondary", "background", "text", "font"])
    $(`wb-theme-${key}`).addEventListener("input", () => {
      pending.add("theme");
      updateStatus();
    });
  function commitPending() {
    if (pending.has("design")) applyDesign();
    if (pending.has("crop") && store.selectedElement?.type === "image")
      applyCrop();
    if (pending.has("theme")) applyTheme();
  }
  for (const type of ["pointerdown", "focusin"])
    document.addEventListener(
      type,
      (event) => {
        const field = event.target.closest?.("input[type=color]");
        if (field && panel.contains(field))
          colorLease = { field, sessionId: store.sessionId };
        else if (!field) colorLease = null;
      },
      true,
    );
  enginesReady = true;
  return {
    commitPending,
    get pendingChanges() {
      return pending.size > 0;
    },
    activity() {
      return {
        active:
          pending.size > 0 ||
          Boolean(colorLease?.sessionId === store.sessionId) ||
          Boolean(
            !document.activeElement?.closest('#agent-io-permissions') &&
              !document.activeElement?.readOnly &&
              !document.activeElement?.disabled &&
              editable(document.activeElement)?.closest(
                ".inspector-page,.workbench-toolbar",
              ),
          ),
        colorActive: colorLease?.sessionId === store.sessionId,
        pending: pending.size > 0,
      };
    },
    draftSignature() {
      return pending.size
        ? JSON.stringify({
            kinds: [...pending],
            stops,
            values: [...panel.querySelectorAll("input,select")].map((n) => [
              n.id,
              n.value,
              n.checked,
            ]),
          })
        : null;
    },
    sync,
    syncEngine,
    cancel,
    showTab,
    get activePage(){return activePage;},
    get activeGroup(){return activeGroup;},
    addInspectorPage,
    selectCreatedSlides,
    onSlideClick,
    copy,
    paste,
    remove,
    duplicate,
    clearBindings,
    get selectedSlideIds() {
      return [...selectedSlides];
    },
    duplicateSlides: () =>
      run(() =>
        selectCreatedSlides(store.duplicateSlides([...selectedSlides])),
      ),
    deleteSlides: () => run(() => store.deleteSlides([...selectedSlides])),
    moveSlides: (delta) =>
      run(() => {
        const list = store.document.slides,
          first = list.findIndex((s) => selectedSlides.has(s.id));
        store.moveSlides(
          [...selectedSlides],
          Math.max(0, Math.min(list.length, first + delta)),
        );
      }),
    clearImageReplacement() {
      imageReplacement = null;
    },
    takeImageReplacement() {
      const captured = imageReplacement;
      imageReplacement = null;
      return captured;
    },
    onReady() {
      sync();
      setTimeout(checkRecovery, 300);
    },
    onSaved(savedSession) {
      if (savedSession !== store.sessionId) return;
      clearTimeout(recoveryTimer);
      lastRecovery = "";
      if (store.isDirty) scheduleRecovery();
      else {
        desktop?.recovery
          ?.clear({ sessionId: savedSession })
          .catch((e) => notice(e.message, true));
        if (restoredRecovery?.sessionId === savedSession) {
          desktop.recovery
            .clear({ recoveryId: restoredRecovery.recoveryId })
            .catch((e) => notice(e.message, true));
          restoredRecovery = null;
        }
      }
    },
    get dragging() {
      return dragging;
    },
  };
}
