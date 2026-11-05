import { cloneDocument } from "./model.js";
import {
  BUSINESS_TEMPLATES,
  createBusinessTemplate,
} from "./business-templates.js";
import { renderSlideContent } from "./render.js";
import { colorInputRgb, mergeColorInput } from "./workbench-colors.js";
import { parseStaticSvg } from "./svg-import.js";
import { parseTsvBlock, pasteChartValues, pasteChartTable } from "./business-data-editing.js";

const $ = (id) => document.getElementById(id);
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const uid = (prefix) => `${prefix}-${crypto.randomUUID()}`;
const option = (value, label) =>
  `<option value="${escape(value)}">${escape(label)}</option>`;
const select = (id, label, values) =>
  `<label class="stacked-label">${label}<select id="${id}">${values.map(([v, l]) => option(v, l)).join("")}</select></label>`;
const input = (id, label, value = "", type = "text", extra = "") =>
  `<label class="stacked-label">${label}<input id="${id}" type="${type}" value="${escape(value)}" ${extra}></label>`;

export function createBusinessWorkbench({
  store,
  workbench,
  action,
  render,
  notice,
  updateStatus,
  output,
  presentWithNotes,
  desktop,
  onDrawConnector,
  onOpenIconGallery,
  getLayoutSlot=()=>null,
  chooseKit,
}) {
  let session = store.sessionId,
    selectedId = null,
    slideId = store.activeSlideId,
    context = null,
    syncing = false;
  let tableDraft = null,
    chartDraft = null,
    cell = { row: 0, col: 0 },
    chartCell = { row: 0, col: 0 },
    chartChoice = "base",
    previewContext = null,
    svgPaintDirty = false,
    outputKey = '';
  const pending = new Set(),
    colors = new WeakMap();
  const get = (id) => {
    const field = $(id);
    return field.type === "color"
      ? mergeColorInput(colors.get(field) || field.value, field.value)
      : field.value;
  };
  const num = (id) => Number(get(id));
  const set = (id, value) => {
    const field = $(id);
    if (document.activeElement === field) return;
    if (field.type === "color") {
      colors.set(field, value || "#000000");
      field.value = colorInputRgb(value || "#000000");
    } else field.value = value ?? "";
  };
  const current = () => store.selectedElement;
  const named = (e) =>
    e.name ||
    e.text?.paragraphs.find(Boolean) ||
    { table: "표", chart: "차트", connector: "연결선", svg: "SVG" }[e.type] ||
    e.id;
  const run = (fn) => action(fn);
  const bind = (id, fn) => $(id).addEventListener("click", () => run(fn));
  function mark(kind) {
    if (syncing) return;
    pending.add(kind);
    context = {
      sessionId: store.sessionId,
      slideId: store.activeSlideId,
      elementId: store.selectedId,
    };
    $("bu-cancel").hidden = false;
    updateStatus();
  }
  function choices(id, rows, empty = "선택하세요") {
    const field = $(id),
      prior = field.value,
      html = option("", empty) + rows.map(([v, l]) => option(v, l)).join("");
    if (field.innerHTML !== html) field.innerHTML = html;
    if (rows.some(([value]) => value === prior)) field.value = prior;
  }
  const page = document.createElement("div");
  page.id = "bu-business";
  page.innerHTML = `<div class="wb-panel-intro">자료에 표·차트·연결선을 추가하고 공통 디자인과 발표 메모를 편집합니다.</div>
 <section class="property-section"><h3>업무 템플릿 · 장 추가</h3><div id="bu-template-gallery" class="bu-template-gallery"></div><p class="property-help">키트에서 필요한 장을 골라 현재 자료 끝에 추가합니다. 기존 내용은 유지됩니다.</p><button id="bu-detach-template" class="wb-wide">현재 장의 템플릿 관계 해제</button></section>
 <section class="property-section"><h3>자료 요소 추가</h3><div class="bu-insert-grid"><button id="bu-add-table">표</button><button id="bu-add-chart">차트</button><button id="bu-add-connector">연결선</button><button id="bu-add-svg">SVG 아이콘</button></div><button id="bu-import-svg" class="wb-wide">정적 SVG 가져오기</button><input id="bu-svg-file" type="file" accept=".svg,image/svg+xml" hidden><p class="property-help">SVG는 rect·circle·ellipse·line·polygon·polyline을 지원합니다. 스크립트·외부 참조·그 밖의 요소는 거부합니다.</p></section>
 <section id="bu-table-panel" class="property-section" hidden><h3>표 데이터 <span id="bu-table-size"></span></h3><div id="bu-table-grid" class="bu-grid-scroll"></div><div class="bu-insert-grid"><button id="bu-table-add-row">행 추가</button><button id="bu-table-remove-row">선택 행 삭제</button><button id="bu-table-add-col">열 추가</button><button id="bu-table-remove-col">선택 열 삭제</button></div><p class="property-help">셀에 스프레드시트의 여러 셀을 붙여넣을 수 있습니다. 선택 셀의 서식을 아래에서 고칩니다.</p>
 ${input("bu-table-header", "제목 행 수", 1, "number", 'min="0" max="10"')}<div class="property-grid">${input("bu-table-font", "글자 크기", 24, "number", 'min="6" max="240"')}${input("bu-cell-width", "선택 열 너비 비중", 1, "number", 'min="0.01" step="0.1"')}</div>
 <div class="property-grid">${input("bu-cell-fill", "셀 배경", "#ffffff", "color")}${input("bu-cell-color", "글자 색", "#182037", "color")}</div><label class="wb-check"><input id="bu-cell-bold" type="checkbox">선택 셀 굵게</label>${select(
   "bu-cell-align",
   "선택 셀 정렬",
   [
     ["left", "왼쪽"],
     ["center", "가운데"],
     ["right", "오른쪽"],
   ],
 )}<button id="bu-table-apply" class="wb-wide primary-button">표 적용</button></section>
 <section id="bu-chart-panel" class="property-section" hidden><h3>데이터 차트</h3>${select(
   "bu-chart-kind",
   "종류",
   [
     ["bar", "막대"],
     ["line", "선"],
     ["doughnut", "도넛"],
     ["pie", "원형"],
     ["radar", "방사형"],
     ["polarArea", "극좌표 영역"],
   ],
 )}<label class="wb-check"><input id="bu-chart-legend" type="checkbox" checked>범례 표시</label><details><summary>재생과 표현</summary><label class="wb-check"><input id="bu-chart-animated" type="checkbox" checked>차트 등장 애니메이션</label>${input('bu-chart-duration','재생 시간 ms',700,'number','min="0" max="5000" step="50"')}<label class="wb-check"><input id="bu-chart-tooltip" type="checkbox" checked>발표 중 수치 툴팁</label>${select('bu-chart-legend-position','범례 위치',[['bottom','아래'],['top','위'],['left','왼쪽'],['right','오른쪽']])}<label class="wb-check"><input id="bu-chart-stacked" type="checkbox">막대·선 계열 누적</label><label class="wb-check"><input id="bu-chart-smooth" type="checkbox" checked>선을 부드럽게</label><label class="wb-check"><input id="bu-chart-fill" type="checkbox">선 아래 영역 채우기</label></details>${select("bu-chart-variable", "선택 값에 차트 연동", [])}${select("bu-chart-choice", "편집할 데이터", [["base", "기본 데이터"]])}<div id="bu-chart-grid" class="bu-grid-scroll"></div><div class="bu-insert-grid"><button id="bu-chart-add-category">항목 추가</button><button id="bu-chart-remove-category">마지막 항목 삭제</button><button id="bu-chart-add-series">계열 추가</button><button id="bu-chart-remove-series">마지막 계열 삭제</button></div><p class="property-help">빈 수치는 결측값입니다. 원형·방사형은 0 이상의 수치를 사용합니다. 연동 데이터를 선택하면 각 선택 값의 차트를 따로 수정합니다.</p><button id="bu-chart-apply" class="wb-wide primary-button">차트 적용</button></section>
 <section id="bu-connector-panel" class="property-section" hidden><h3>개체에 연결된 선</h3>${select("bu-connector-from", "시작 개체", [])}${select(
   "bu-connector-from-anchor",
   "시작 연결점",
   [
     ["right", "오른쪽"],
     ["left", "왼쪽"],
     ["top", "위쪽"],
     ["bottom", "아래쪽"],
     ["center", "중앙"],["custom", "마우스로 지정한 점"],
   ],
 )}${select("bu-connector-to", "끝 개체", [])}${select(
   "bu-connector-to-anchor",
   "끝 연결점",
   [
     ["left", "왼쪽"],
     ["right", "오른쪽"],
     ["top", "위쪽"],
     ["bottom", "아래쪽"],
     ["center", "중앙"],["custom", "마우스로 지정한 점"],
   ],
 )}<div class="property-grid">${input("bu-connector-color", "선 색", "#5367f7", "color")}${input("bu-connector-width", "선 굵기", 3, "number", 'min="0.1" max="100" step="0.5"')}</div>${select(
   "bu-connector-arrow",
   "화살표",
   [
     ["none", "없음"],
     ["end", "끝"],
     ["both", "양쪽"],
   ],
 )}<button id="bu-connector-apply" class="wb-wide">연결선 적용</button><p class="property-help">대상을 이동·회전하면 연결점이 따라갑니다. 선의 위치는 연결점으로 정합니다.</p></section>
 <section id="bu-svg-panel" class="property-section" hidden><h3>SVG 설정</h3>${input("bu-svg-title", "그림 설명", "", "text", 'maxlength="512"')}${input("bu-svg-color", "바꿀 색", "#5367f7", "color")}<label class="wb-check"><input id="bu-svg-strokes" type="checkbox" checked>테두리 색도 변경</label><button id="bu-svg-apply" class="wb-wide">SVG 설정 적용</button><button id="bu-svg-unify" class="wb-wide">전체를 이 색으로 맞추기</button></section>
 <section class="property-section"><h3>공통 로고·바닥글</h3><label class="wb-check"><input id="bu-master-enabled" type="checkbox" checked>공통 요소 표시</label>${input("bu-master-logo", "로고 글자", "Vividly", "text", 'maxlength="256"')}${input("bu-master-footer", "바닥글", "Present Vividly.", "text", 'maxlength="1024"')}${input("bu-master-color", "강조 색", "#5367f7", "color")}<label class="wb-check"><input id="bu-master-page" type="checkbox" checked>쪽 번호 표시</label><button id="bu-master-apply" class="wb-wide">전체 자료에 적용</button><div class="wb-button-row"><button id="bu-master-local">현재 장만 적용</button><button id="bu-master-reset">현재 장 예외 해제</button></div><label class="wb-check"><input id="bu-master-hide" type="checkbox">현재 장의 공통 요소 숨기기</label><p id="bu-master-status" class="property-help"></p></section>
 <section class="property-section"><h3>제목 글꼴과 간격 토큰</h3>${input("bu-heading-font", "테마 제목 글꼴", "Malgun Gothic", "text", 'maxlength="256"')}<div class="property-grid">${["xs", "sm", "md", "lg", "xl"].map((key, i) => input("bu-spacing-" + key, key.toUpperCase(), [8, 16, 24, 40, 64][i], "number", 'min="0" max="1000"')).join("")}</div><button id="bu-theme-apply" class="wb-wide">테마 토큰 적용</button><p class="property-help">제목 의미와 테마 글꼴에 연결한 개체에 제목 글꼴을 적용합니다. 간격은 새 레이아웃의 기준 값입니다.</p></section>
 <section class="property-section"><h3>현재 장 발표 메모</h3><label class="stacked-label"><textarea id="bu-notes" rows="6" maxlength="65536" aria-label="발표 메모"></textarea></label><button id="bu-notes-apply" class="wb-wide">메모 적용</button><button id="bu-presenter" class="wb-wide">발표자 화면으로 시작</button><p class="property-help">편집용 HTML 저장에는 메모가 포함됩니다. 배포용 출력에서는 기본으로 제외합니다.</p></section>
 <section class="property-section"><h3>읽기 순서와 의미</h3>${select(
   "bu-role",
   "선택 개체 의미",
   [
     ["auto", "자동"],
     ["heading", "제목"],
     ["body", "본문"],
     ["decorative", "장식 · 읽기에서 제외"],
   ],
 )}<button id="bu-role-apply" class="wb-wide">의미 적용</button><div id="bu-reading-order" class="mo-list"></div></section>
 <section class="property-section"><h3>문서 진단 <span id="bu-diagnostic-revision"></span></h3><button id="bu-diagnostics-refresh" class="wb-wide">진단 새로 확인</button><div id="bu-diagnostics" class="bu-diagnostics"></div></section>
 <button id="bu-cancel" class="mo-cancel" hidden>자료 설정 변경 취소</button>`;
  workbench.addInspectorPage("business", "자료", page);
  const selectedEditors = document.createElement('div');
  selectedEditors.id = 'bu-selected-editors';
  page.querySelector('.wb-panel-intro').after(selectedEditors);
  for (const type of ['table','chart','connector','svg']) selectedEditors.append($('bu-'+type+'-panel'));
  const chartSettings=document.createElement('details');chartSettings.id='bu-chart-axis-settings';
  chartSettings.innerHTML=`<summary>축·단위·값 표시</summary>${select('bu-chart-direction','막대 방향',[['vertical','세로 막대'],['horizontal','가로 막대']])}<div class="property-grid">${input('bu-chart-minimum','값 최솟값 · 빈칸은 자동','','number','step="any"')}${input('bu-chart-maximum','값 최댓값 · 빈칸은 자동','','number','step="any"')}${input('bu-chart-step','눈금 간격 · 빈칸은 자동','','number','min=".000000001" step="any"')}${input('bu-chart-decimals','소수 자릿수 · 빈칸은 자동','','number','min="0" max="6" step="1"')}</div>${input('bu-chart-category-title','항목 축 제목','','text','maxlength="256"')}${input('bu-chart-value-title','값 축 제목','','text','maxlength="256"')}<div class="property-grid">${input('bu-chart-prefix','숫자 앞 단위','','text','maxlength="32" placeholder="예: ₩"')}${input('bu-chart-suffix','숫자 뒤 단위','','text','maxlength="32" placeholder="예: 만원, %"')}</div><label class="wb-check"><input id="bu-chart-grid-lines" type="checkbox" checked>값 축 격자 표시</label><label class="wb-check"><input id="bu-chart-category-labels" type="checkbox" checked>항목 이름 표시</label><label class="wb-check"><input id="bu-chart-grouping" type="checkbox" checked>천 단위 구분</label><label class="wb-check"><input id="bu-chart-data-labels" type="checkbox">차트 위에 수치 표시</label><p class="property-help">축 설정은 막대·선 차트에 적용합니다. 단위는 표시만 바꾸며 원본 수치는 유지합니다.</p>`;
  $('bu-chart-variable').closest('label').before(chartSettings);
  const chartPasteHelp=document.createElement('p');chartPasteHelp.className='property-help';chartPasteHelp.textContent='엑셀 표 전체를 복사한 뒤 첫 항목 이름 셀에 붙여넣으면 계열 이름·항목·수치를 함께 가져옵니다. 숫자 셀에서는 수치만 붙여넣습니다.';$('bu-chart-grid').after(chartPasteHelp);
  const templateSection = $('bu-template-gallery').closest('section'), templates = document.createElement('details');
  templates.id='bu-template-details';templates.className='bu-template-details';templates.open=true;
  templates.innerHTML='<summary>업무 템플릿 · 장 추가</summary>';
  templateSection.before(templates);templateSection.querySelector('h3').remove();templates.append(templateSection);
  for(const type of ['table','chart']){
    const button=document.createElement('button');button.id='bu-'+type+'-expand';button.className='wb-wide bu-data-expand';button.textContent='데이터 크게 편집';
    button.addEventListener('click',()=>openDataEditor(type));$('bu-'+type+'-panel').querySelector('h3').after(button);
    const position=document.createElement('p');position.id='bu-'+type+'-position';position.className='property-help bu-data-position';button.after(position);
  }
  const dataDialog=document.createElement('dialog');dataDialog.id='bu-data-dialog';dataDialog.className='bu-data-dialog inspector-page';dataDialog.setAttribute('aria-labelledby','bu-data-title');
  dataDialog.innerHTML='<header class="bu-data-heading"><div><h2 id="bu-data-title">데이터 편집</h2><p id="bu-data-position" role="status"></p></div><button id="bu-data-close" aria-label="데이터 편집 취소하고 닫기">닫기</button></header><div id="bu-data-body" class="bu-data-body"></div><footer class="bu-data-actions"><span>Tab 다음 셀 · Enter 아래 셀 · Ctrl+Enter 적용 · Esc 취소</span><button id="bu-data-cancel">취소</button><button id="bu-data-apply" class="primary-button">적용하고 닫기</button></footer>';
  document.body.append(dataDialog);
  let dataSession=null;
  function activeEditor(){const type=current()?.type;return ['table','chart','connector','svg'].includes(type)?$('bu-'+type+'-panel'):null;}
  function dataPosition(){
    const tableText=`${cell.row+1}행 · ${cell.col+1}열`, location=chartCell.row<0?`${chartCell.col+1}계열 이름`:chartCell.col<0?`${chartCell.row+1}항목 이름`:`${chartCell.row+1}항목 · ${chartCell.col+1}계열`,chartText=`${$('bu-chart-choice').selectedOptions[0]?.textContent||'기본 데이터'} · ${location}`;
    $('bu-table-position').textContent=tableText;$('bu-chart-position').textContent=chartText;
    if(dataSession)$('bu-data-position').textContent=dataSession.type==='table'?tableText:chartText;
  }
  function openDataEditor(type=current()?.type){
    if(!['table','chart'].includes(type)||current()?.type!==type)return;
    if(dataSession){focusDataCell(type);return;}
    sync();
    const panel=$('bu-'+type+'-panel'),placeholder=document.createComment('data-editor-home');panel.before(placeholder);
    dataSession={type,elementId:store.selectedId,slideId:store.activeSlideId,sessionId:store.sessionId,placeholder,panel,returnFocus:document.activeElement};
    $('bu-data-title').textContent=`${type==='table'?'표':'차트'} · ${named(current())}`;
    $('bu-data-body').append(panel);$('bu-'+type+'-expand').hidden=true;$('bu-'+type+'-apply').hidden=true;
    dataDialog.showModal();dataPosition();focusDataCell(type);updateStatus();
  }
  function closeDataEditor({cancel=false,restoreFocus=true,resync=true}={}){
    const session=dataSession;if(!session)return;dataSession=null;
    if(cancel)pending.delete(session.type);
    session.placeholder.replaceWith(session.panel);$('bu-'+session.type+'-expand').hidden=false;$('bu-'+session.type+'-apply').hidden=false;
    delete dataDialog.dataset.composing;dataDialog.close();if(resync)sync(true);updateStatus();
    if(restoreFocus&&session.returnFocus?.isConnected)session.returnFocus.focus({preventScroll:true});
  }
  $('bu-data-apply').addEventListener('click',()=>run(()=>closeDataEditor()));
  $('bu-data-cancel').addEventListener('click',()=>closeDataEditor({cancel:true}));
  $('bu-data-close').addEventListener('click',()=>closeDataEditor({cancel:true}));
  dataDialog.addEventListener('compositionstart',()=>{dataDialog.dataset.composing='true';});
  dataDialog.addEventListener('compositionend',()=>{delete dataDialog.dataset.composing;});
  dataDialog.addEventListener('cancel',event=>{event.preventDefault();if(dataDialog.dataset.composing!=='true')closeDataEditor({cancel:true});});
  dataDialog.addEventListener('keydown',event=>{
    if(event.isComposing||dataDialog.dataset.composing==='true'){event.stopPropagation();if(event.key==='Escape')event.preventDefault();return;}
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeDataEditor({cancel:true});}
    else if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();event.stopPropagation();$('bu-data-apply').click();}
  },true);
  const deliver = document.createElement("div");
  deliver.id = "bu-delivery";
  deliver.innerHTML = `<div class="wb-panel-intro">선택한 장과 정적 장면을 미리 본 뒤 PDF·PNG·배포용 HTML로 출력합니다.</div><section class="property-section"><h3>출력 설정</h3>${select(
    "bu-output-format",
    "형식",
    [
      ["pdf", "PDF 문서"],
      ["png", "PNG 이미지"],
      ["html", "배포용 HTML"],
    ],
  )}${select("bu-output-range", "장 범위", [
    ["all", "모든 장"],
    ["selected", "왼쪽 목록의 선택 장"],
    ["current", "현재 장"],
  ])}${select("bu-output-scene", "정적 장면", [
    ["complete", "등장 효과가 끝난 장면"],
    ["initial", "처음 표시 상태"],
  ])}<label class="wb-check"><input id="bu-output-notes" type="checkbox">발표 메모 포함</label><label class="wb-check"><input id="bu-output-font-fallback" type="checkbox">누락된 글꼴의 대체 허용</label><div id="bu-output-variables"></div><h3>열어 둘 상세 패널</h3><div id="bu-output-panels"></div><h3>추가로 표시할 개체</h3><div id="bu-output-shown"></div><button id="bu-output-preview" class="wb-wide primary-button">납품 미리보기</button><button id="bu-output-write" class="wb-wide">파일 내보내기</button><p id="bu-output-status" class="property-help"></p></section>`;
  workbench.addInspectorPage("delivery", "납품", deliver);
  const dialog = document.createElement("dialog");
  dialog.id = "bu-output-dialog";
  dialog.className = "bu-output-dialog";
  dialog.innerHTML = `<div class="bu-output-heading"><div><h2>납품 미리보기</h2><p id="bu-preview-caption"></p></div><button id="bu-preview-close">닫기</button></div><div id="bu-preview-diagnostics"></div><div id="bu-preview-pages"></div><div class="bu-output-actions"><button id="bu-preview-write" class="primary-button">이 자료 내보내기</button></div>`;
  document.body.append(dialog);
  $("bu-preview-close").addEventListener("click", () => dialog.close());
  const exportButton = document.createElement("button");
  exportButton.id = "bu-export";
  exportButton.textContent = "내보내기";
  exportButton.className = "secondary-button";
  $("mo-preview").before(exportButton);
  exportButton.addEventListener("click", () => workbench.showTab("delivery"));
  $("bu-presenter").addEventListener("click", () => run(presentWithNotes));
  for (const template of BUSINESS_TEMPLATES) {
    const doc = createBusinessTemplate(template.id, store.document),
      button = document.createElement("button");
    button.dataset.businessTemplate = template.id;
    button.className = "bu-template-card";
    const factor=Math.min(226/doc.canvas.width,128/doc.canvas.height);
    button.innerHTML = `<div class="bu-template-thumb"><div style="width:${doc.canvas.width}px;height:${doc.canvas.height}px;left:${(226-doc.canvas.width*factor)/2}px;top:${(128-doc.canvas.height*factor)/2}px;background:${doc.slides[0].background};transform:scale(${factor})">${renderSlideContent(doc.slides[0], doc)}</div></div><strong>${escape(template.name)}</strong><span>${escape(template.description)}</span>`;
    button.addEventListener("click", () =>
      run(async () => {
        const source = createBusinessTemplate(template.id, store.document);
        const owner={session:store.sessionId,revision:store.revision};
        const ids=chooseKit?await chooseKit(source,template.name):source.slides.map(s=>s.id);
        if(!ids?.length)return;
        await run(()=>{
          if(owner.session!==store.sessionId||owner.revision!==store.revision)throw Error('자료가 바뀌어 장을 추가하지 않았습니다. 다시 선택하세요.');
          const created=store.importSlides(source,ids);
          workbench.selectCreatedSlides(created);
          notice(`${template.name} 키트에서 ${created.length}장을 추가했습니다.`);
        });
      }).catch(error=>notice(error.message,true)),
    );
    $("bu-template-gallery").append(button);
  }
  bind("bu-detach-template", () =>
    store.setSlideBusiness(store.activeSlideId, { template: null }),
  );
  function insert(type, data, name, geometry) {
    const e = {
      id: uid("business"),
      type,
      name,
      geometry: geometry || {
        x: 100,
        y: 130,
        width: Math.min(900, store.document.canvas.width - 200),
        height: Math.min(450, store.document.canvas.height - 220),
      },
      [type]: data,
    };
    const slot=getLayoutSlot(type);
    if(slot){store.fillLayoutSlot(slot.slideId,slot.slotKey,e);workbench.showTab('business');return;}
    const created = store.pasteElements(
      {
        kind: "vividly-elements",
        version: 2,
        documentId: store.document.id,
        elements: [e],
        assets: [],
        variables: [],
        motions: [],
        interactions: [],
      },
      { offsetX: 0, offsetY: 0 },
    );
    if (created?.[0])
      store.selectElements([created[0]], { expandGroups: false });
    workbench.showTab("business");
  }
  bind("bu-add-table", () =>
    insert(
      "table",
      {
        rows: [
          ["항목", "계획", "실적"],
          ["브랜드 캠페인", "120", "138"],
          ["콘텐츠 제작", "80", "96"],
          ["참여 전환", "45", "58"],
        ].map((row, r) =>
          row.map((text) => ({
            text,
            fill: r ? "#ffffff" : "#eef1ff",
            color: "#182037",
            bold: r === 0,
            align: "left",
          })),
        ),
        columnWidths: [2, 1, 1],
        headerRows: 1,
        fontSize: 24,
      },
      "업무 표",
    ),
  );
  bind("bu-add-chart", () =>
    insert(
      "chart",
      {
        kind: "bar",
        categories: ["1분기", "2분기", "3분기", "4분기"],
        series: [
          {
            id: uid("series"),
            name: "계획",
            color: "#98a6ef",
            values: [80, 100, 120, 140],
          },
          {
            id: uid("series"),
            name: "실적",
            color: "#5367f7",
            values: [85, 112, 138, 168],
          },
        ],
        showLegend: true,
      },
      "성과 차트",
    ),
  );
  function newConnector() {
    const available = store.activeSlide.elements.filter(
        (e) => e.type !== "connector" && !e.hidden,
      ),
      selected = store.selectedElements.filter((e) => e.type !== "connector");
    const from = selected[0] || available[0],
      to = selected[1] || available.find((e) => e.id !== from?.id);
    if (!from || !to) throw new Error("연결할 개체 두 개가 필요합니다.");
    insert(
      "connector",
      {
        from: { elementId: from.id, anchor: "right" },
        to: { elementId: to.id, anchor: "left" },
        stroke: { color: "#5367f7", width: 3 },
        arrow: "end",
      },
      "개체 연결선",
      { x: 1, y: 1, width: 1, height: 1 },
    );
  }
  bind("bu-add-connector", () => onDrawConnector ? onDrawConnector() : newConnector());
  bind("bu-add-svg", () => onOpenIconGallery?.());
  $("bu-import-svg").addEventListener("click", () => $("bu-svg-file").click());
  $("bu-svg-file").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file) return;
    const capturedSession = store.sessionId;
    try {
      if (file.size > 524288) throw new Error("512 KiB 이하 SVG를 사용하세요.");
      const data = parseStaticSvg(await file.text());
      if (capturedSession !== store.sessionId)
        throw new Error("자료가 바뀌어 SVG 가져오기를 취소했습니다.");
      run(() =>
        insert("svg", data, file.name, {
          x: 120,
          y: 180,
          width: 240,
          height: Math.max(
            40,
            (240 * data.viewBox.height) / data.viewBox.width,
          ),
        }),
      );
    } catch (error) {
      notice(error.message, true);
    }
  });

  function focusDataCell(type, position) {
    const point=position||(type==='table'?cell:chartCell);
    const selector=type==='table'?`[data-table-row="${point.row}"][data-table-col="${point.col}"]`:point.row<0?`[data-series-name="${point.col}"]`:point.col<0?`[data-chart-category="${point.row}"]`:`[data-chart-row="${point.row}"][data-chart-series="${point.col}"]`;
    const field=$('bu-'+type+'-grid').querySelector(selector);if(!field)return;
    field.focus({preventScroll:true});field.scrollIntoView({block:'nearest',inline:'nearest'});try{field.select();}catch{}
  }
  function gridKey(event,type) {
    if(event.isComposing||event.ctrlKey||event.metaKey||event.altKey)return;
    const field=event.target,d=field.dataset;
    let row,col;
    if(type==='table'){if(d.tableRow===undefined)return;row=+d.tableRow;col=+d.tableCol;}
    else if(d.chartRow!==undefined){row=+d.chartRow;col=+d.chartSeries;}
    else if(d.chartCategory!==undefined){row=+d.chartCategory;col=-1;}
    else if(d.seriesName!==undefined){row=-1;col=+d.seriesName;}
    else return;
    const height=type==='table'?tableDraft.rows.length:chartDraft.categories.length,width=type==='table'?tableDraft.columnWidths.length:chartDraft.series.length,minCol=type==='chart'?-1:0;
    let nextRow=row,nextCol=col;
    if(event.key==='Tab'){
      nextCol+=event.shiftKey?-1:1;
      if(nextCol>=width){nextCol=minCol;nextRow++;}
      if(nextCol<minCol){nextCol=width-1;nextRow--;}
      if(nextRow>=height)return;
    }else if(event.key==='Enter')nextRow+=event.shiftKey?-1:1;
    else if(event.key==='ArrowUp')nextRow--;
    else if(event.key==='ArrowDown')nextRow++;
    else if(event.key==='ArrowLeft'||event.key==='ArrowRight'){
      const left=event.key==='ArrowLeft';
      if(field.type!=='number'&&(field.selectionStart!==field.selectionEnd||(left?field.selectionStart!==0:field.selectionEnd!==field.value.length)))return;
      nextCol+=left?-1:1;
    }else return;
    if(nextRow < (type==='chart'&&nextCol>=0?-1:0)||nextRow>=height||nextCol<minCol||nextCol>=width||nextRow<0&&nextCol<0)return;
    event.preventDefault();event.stopPropagation();focusDataCell(type,{row:nextRow,col:nextCol});
  }
  $('bu-table-grid').addEventListener('keydown',event=>gridKey(event,'table'));
  $('bu-chart-grid').addEventListener('keydown',event=>gridKey(event,'chart'));
  function tableGrid(focus=false) {
    if (!tableDraft) return;
    $("bu-table-size").textContent =
      `${tableDraft.rows.length} × ${tableDraft.columnWidths.length}`;
    $("bu-table-grid").innerHTML =
      `<table><tbody>${tableDraft.rows.map((row, r) => `<tr>${row.map((value, c) => `<td class="${r === cell.row && c === cell.col ? "active" : ""}"><input data-table-row="${r}" data-table-col="${c}" aria-label="${r + 1}행 ${c + 1}열" value="${escape(value.text)}"></td>`).join("")}</tr>`).join("")}</tbody></table>`;
    syncCell();dataPosition();if(focus)focusDataCell('table');
  }
  function syncCell() {
    if (!tableDraft) return;
    cell.row = Math.min(cell.row, tableDraft.rows.length - 1);
    cell.col = Math.min(cell.col, tableDraft.columnWidths.length - 1);
    const value = tableDraft.rows[cell.row][cell.col];
    set("bu-cell-fill", value.fill || "#ffffff");
    set("bu-cell-color", value.color || "#182037");
    set("bu-cell-width", tableDraft.columnWidths[cell.col]);
    set("bu-cell-align", value.align || "left");
    $("bu-cell-bold").checked = value.bold === true;
  }
  $("bu-table-grid").addEventListener("focusin", (event) => {
    if (!event.target.dataset.tableRow) return;
    cell = {
      row: Number(event.target.dataset.tableRow),
      col: Number(event.target.dataset.tableCol),
    };
    for (const td of $("bu-table-grid").querySelectorAll("td"))
      td.classList.remove("active");
    event.target.parentElement.classList.add("active");
    syncCell();dataPosition();
  });
  $("bu-table-grid").addEventListener("input", (event) => {
    const { tableRow: r, tableCol: c } = event.target.dataset;
    if (r !== undefined) {
      tableDraft.rows[+r][+c].text = event.target.value;
      mark("table");
    }
  });
  $("bu-table-grid").addEventListener("paste", (event) => {
    const field = event.target;
    if (field.dataset.tableRow === undefined) return;
    const text = event.clipboardData.getData("text/plain");
    if (!/[\t\n]/.test(text)) return;
    event.preventDefault();
    let rows;
    try{rows=parseTsvBlock(text,{maxRows:100,maxColumns:30,allowRagged:true});}catch(error){notice(error.message,true);return;}
    if (
      rows.length + cell.row > 100 ||
      Math.max(...rows.map((r) => r.length)) + cell.col > 30
    ) {
      notice("표는 100행·30열까지 붙여넣을 수 있습니다.", true);
      return;
    }
    const width = Math.max(
      tableDraft.columnWidths.length,
      cell.col + Math.max(...rows.map((r) => r.length)),
    );
    if(width*Math.max(tableDraft.rows.length,cell.row+rows.length)>2000){notice('한 표에 2,000셀까지 붙여넣을 수 있습니다.',true);return;}
    while (tableDraft.columnWidths.length < width) {
      tableDraft.columnWidths.push(1);
      for (const row of tableDraft.rows) row.push({ text: "" });
    }
    while (tableDraft.rows.length < cell.row + rows.length)
      tableDraft.rows.push(Array.from({ length: width }, () => ({ text: "" })));
    rows.forEach((row, r) =>
      row.forEach(
        (text, c) => (tableDraft.rows[cell.row + r][cell.col + c].text = text),
      ),
    );
    mark("table");
    tableGrid(true);
  });
  for (const [id, fn] of Object.entries({
    "bu-table-add-row": () => {
      if(tableDraft.rows.length>=100||(tableDraft.rows.length+1)*tableDraft.columnWidths.length>2000)throw new Error('표는 100행·2,000셀까지 만들 수 있습니다.');
      tableDraft.rows.splice(
        cell.row + 1,
        0,
        tableDraft.columnWidths.map(() => ({ text: "" })),
      );cell.row++;},
    "bu-table-remove-row": () => {
      if (tableDraft.rows.length === 1)
        throw new Error("마지막 행은 삭제할 수 없습니다.");
      tableDraft.rows.splice(cell.row, 1);
      tableDraft.headerRows=Math.min(tableDraft.headerRows,tableDraft.rows.length);set('bu-table-header',tableDraft.headerRows);
    },
    "bu-table-add-col": () => {
      if(tableDraft.columnWidths.length>=30||tableDraft.rows.length*(tableDraft.columnWidths.length+1)>2000)throw new Error('표는 30열·2,000셀까지 만들 수 있습니다.');
      tableDraft.columnWidths.splice(cell.col + 1, 0, 1);
      for (const row of tableDraft.rows)
        row.splice(cell.col + 1, 0, { text: "" });
      cell.col++;
    },
    "bu-table-remove-col": () => {
      if (tableDraft.columnWidths.length === 1)
        throw new Error("마지막 열은 삭제할 수 없습니다.");
      tableDraft.columnWidths.splice(cell.col, 1);
      for (const row of tableDraft.rows) row.splice(cell.col, 1);
    },
  }))
    $(id).addEventListener("click", () => {
      try {
        fn();
        mark("table");
        tableGrid(true);
      } catch (error) {
        notice(error.message, true);
      }
    });
  for (const id of [
    "bu-cell-fill",
    "bu-cell-color",
    "bu-cell-bold",
    "bu-cell-align",
    "bu-cell-width",
  ])
    $(id).addEventListener("input", () => {
      if (!tableDraft) return;
      const value = tableDraft.rows[cell.row][cell.col];
      if (id === "bu-cell-fill") value.fill = get(id);
      else if (id === "bu-cell-color") value.color = get(id);
      else if (id === "bu-cell-bold") value.bold = $(id).checked;
      else if (id === "bu-cell-align") value.align = get(id);
      else tableDraft.columnWidths[cell.col] = num(id);
      mark("table");
    });
  for (const id of ["bu-table-header", "bu-table-font"])
    $(id).addEventListener("input", () => mark("table"));
  function applyTable() {
    if (current()?.type !== "table") return;
    tableDraft.fontSize = num("bu-table-font");
    tableDraft.headerRows = num("bu-table-header");
    store.setTable(current().id, tableDraft);
    pending.delete("table");
  }
  bind("bu-table-apply", applyTable);

  function chartValues(series) {
    if (chartChoice === "base" || !chartDraft.variants) return series.values;
    const row = chartDraft.variants.values.find(
      (v) => v.value === chartChoice.slice(6),
    );
    return (
      row?.series.find((s) => s.seriesId === series.id)?.values || series.values
    );
  }
  function chartGrid(focus=false) {
    if (!chartDraft) return;
    $("bu-chart-grid").innerHTML =
      `<table><thead><tr><th>항목</th>${chartDraft.series.map((s, i) => `<th><input data-series-name="${i}" aria-label="계열 이름" value="${escape(s.name)}"><input type="color" data-series-color="${i}" aria-label="계열 색" value="${colorInputRgb(s.color)}"></th>`).join("")}</tr></thead><tbody>${chartDraft.categories.map((category, r) => `<tr><th><input data-chart-category="${r}" aria-label="항목 이름" value="${escape(category)}"></th>${chartDraft.series.map((s, c) => `<td><input type="number" step="any" data-chart-row="${r}" data-chart-series="${c}" aria-label="${escape(category)} ${escape(s.name)} 수치" value="${chartValues(s)[r] ?? ""}"></td>`).join("")}</tr>`).join("")}</tbody></table>`;
    $("bu-chart-grid").querySelector("th").textContent = "항목";
    dataPosition();if(focus)focusDataCell('chart');
  }
  $('bu-chart-grid').addEventListener('focusin',event=>{
    const d=event.target.dataset;
    if(d.chartRow!==undefined)chartCell={row:+d.chartRow,col:+d.chartSeries};
    else if(d.chartCategory!==undefined)chartCell={row:+d.chartCategory,col:-1};
    else if(d.seriesName!==undefined)chartCell={row:-1,col:+d.seriesName};
    else return;
    dataPosition();
  });
  $("bu-chart-grid").addEventListener("input", (event) => {
    const field = event.target,
      d = field.dataset;
    if (d.seriesName !== undefined)
      chartDraft.series[+d.seriesName].name = field.value;
    else if (d.seriesColor !== undefined) {
      const s = chartDraft.series[+d.seriesColor];
      s.color = mergeColorInput(s.color, field.value);
    } else if (d.chartCategory !== undefined)
      chartDraft.categories[+d.chartCategory] = field.value;
    else if (d.chartSeries !== undefined)
      chartValues(chartDraft.series[+d.chartSeries])[+d.chartRow] =
        field.value === "" ? null : Number(field.value);
    else return;
    mark("chart");
  });
  $('bu-chart-grid').addEventListener('paste',event=>{
    const field=event.target,text=event.clipboardData.getData('text/plain');
    if(field.dataset.chartCategory==='0'&&/\t/.test(text)){
      event.preventDefault();try{chartDraft=pasteChartTable(chartDraft,{text,choice:chartChoice,createSeriesId:()=>uid('series')});chartCell={row:0,col:-1};mark('chart');chartGrid(true);notice('항목과 계열 이름을 포함한 표를 읽었습니다. 차트 적용으로 반영하세요.');}catch(error){notice(error.message,true);}return;
    }
    if(field.dataset.chartRow===undefined||!/[\t\n]/.test(text))return;
    event.preventDefault();
    try{
      const next=pasteChartValues(chartDraft,{text,row:+field.dataset.chartRow,col:+field.dataset.chartSeries,choice:chartChoice,createSeriesId:()=>uid('series')});
      chartDraft=next;chartCell={row:+field.dataset.chartRow,col:+field.dataset.chartSeries};mark('chart');chartGrid(true);
    }catch(error){notice(error.message,true);}
  });
  function chartChoices() {
    const v = (store.document.variables || []).find(
      (v) => v.id === chartDraft?.variants?.variableId,
    );
    const field = $("bu-chart-choice");
    field.innerHTML =
      option("base", "기본 데이터") +
      (v?.options || [])
        .map((o) => option("value:" + o.value, o.label))
        .join("");
    if ([...field.options].some((o) => o.value === chartChoice))
      field.value = chartChoice;
    else {
      chartChoice = "base";
      field.value = "base";
    }
  }
  $("bu-chart-choice").addEventListener("change", () => {
    chartChoice = get("bu-chart-choice");
    chartGrid();
  });
  $("bu-chart-variable").addEventListener("change", () => {
    const variable = (store.document.variables || []).find(
      (v) => v.id === get("bu-chart-variable"),
    );
    if (!variable) delete chartDraft.variants;
    else {
      const prior = chartDraft.variants;
      chartDraft.variants = {
        variableId: variable.id,
        values: variable.options.map((o) => ({
          value: o.value,
          series: chartDraft.series.map((s) => ({
            seriesId: s.id,
            values: cloneDocument(
              prior?.values
                .find((v) => v.value === o.value)
                ?.series.find((row) => row.seriesId === s.id)?.values ||
                s.values,
            ),
          })),
        })),
      };
    }
    chartChoice = "base";
    mark("chart");
    chartChoices();
    chartGrid();
  });
  for (const [id, fn] of Object.entries({
    "bu-chart-add-category": () => {
      if(chartDraft.categories.length>=128)throw new Error('차트 항목은 128개까지 만들 수 있습니다.');
      chartDraft.categories.push(`항목 ${chartDraft.categories.length + 1}`);
      for (const s of chartDraft.series) s.values.push(0);
      for (const v of chartDraft.variants?.values || [])
        for (const s of v.series) s.values.push(0);
      chartCell={row:chartDraft.categories.length-1,col:0};
    },
    "bu-chart-remove-category": () => {
      if (chartDraft.categories.length === 1)
        throw new Error("마지막 항목은 삭제할 수 없습니다.");
      chartDraft.categories.pop();
      for (const s of chartDraft.series) s.values.pop();
      for (const v of chartDraft.variants?.values || [])
        for (const s of v.series) s.values.pop();
      chartCell.row=Math.min(chartCell.row,chartDraft.categories.length-1);
    },
    "bu-chart-add-series": () => {
      if(chartDraft.series.length>=12)throw new Error('차트 계열은 12개까지 만들 수 있습니다.');
      const series = {
        id: uid("series"),
        name: `계열 ${chartDraft.series.length + 1}`,
        color: "#9b7cf4",
        values: chartDraft.categories.map(() => 0),
      };
      chartDraft.series.push(series);
      for (const v of chartDraft.variants?.values || [])
        v.series.push({
          seriesId: series.id,
          values: chartDraft.categories.map(() => 0),
        });
      chartCell={row:0,col:chartDraft.series.length-1};
    },
    "bu-chart-remove-series": () => {
      if (chartDraft.series.length === 1)
        throw new Error("마지막 계열은 삭제할 수 없습니다.");
      const removed = chartDraft.series.pop();
      for (const v of chartDraft.variants?.values || [])
        v.series = v.series.filter((s) => s.seriesId !== removed.id);
      chartCell.col=Math.min(chartCell.col,chartDraft.series.length-1);
    },
  }))
    $(id).addEventListener("click", () => {
      try {
        fn();
        mark("chart");
        chartGrid(true);
      } catch (error) {
        notice(error.message, true);
      }
    });
  for (const id of ["bu-chart-kind", "bu-chart-legend",'bu-chart-animated','bu-chart-duration','bu-chart-tooltip','bu-chart-legend-position','bu-chart-stacked','bu-chart-smooth','bu-chart-fill','bu-chart-direction','bu-chart-minimum','bu-chart-maximum','bu-chart-step','bu-chart-category-title','bu-chart-value-title','bu-chart-decimals','bu-chart-prefix','bu-chart-suffix','bu-chart-grid-lines','bu-chart-category-labels','bu-chart-grouping','bu-chart-data-labels'])
    $(id).addEventListener("input", () => mark("chart"));
  function applyChart() {
    if (current()?.type !== "chart") return;
    chartDraft.kind = get("bu-chart-kind");
    chartDraft.showLegend = $("bu-chart-legend").checked;
    chartDraft.presentation={animated:$('bu-chart-animated').checked,duration:num('bu-chart-duration'),showTooltip:$('bu-chart-tooltip').checked,legendPosition:get('bu-chart-legend-position'),stacked:$('bu-chart-stacked').checked,smooth:$('bu-chart-smooth').checked,fill:$('bu-chart-fill').checked};
    const optionalNumber=id=>get(id).trim()===''?null:num(id);
    chartDraft.axes={direction:get('bu-chart-direction'),minimum:optionalNumber('bu-chart-minimum'),maximum:optionalNumber('bu-chart-maximum'),step:optionalNumber('bu-chart-step'),showGrid:$('bu-chart-grid-lines').checked,showCategoryLabels:$('bu-chart-category-labels').checked,categoryTitle:get('bu-chart-category-title'),valueTitle:get('bu-chart-value-title')};
    chartDraft.labels={show:$('bu-chart-data-labels').checked,decimals:optionalNumber('bu-chart-decimals'),prefix:get('bu-chart-prefix'),suffix:get('bu-chart-suffix'),grouping:$('bu-chart-grouping').checked};
    store.setChart(current().id, chartDraft);
    pending.delete("chart");
  }
  bind("bu-chart-apply", applyChart);
  function chosenEndpoint(side){const prior=current().connector[side],elementId=get('bu-connector-'+side),anchor=get('bu-connector-'+side+'-anchor');if(!elementId)return prior;if(anchor==='custom')return prior.elementId===elementId&&prior.position?structuredClone(prior):{elementId,anchor:'center'};return{elementId,anchor};}
  function applyConnector() {
    if (current()?.type !== "connector") return;
    store.setConnector(current().id, {
      ...current().connector,
      from: chosenEndpoint("from"),
      to: chosenEndpoint("to"),
      stroke: {
        color: get("bu-connector-color"),
        width: num("bu-connector-width"),
      },
      arrow: get("bu-connector-arrow"),
    });
    pending.delete("connector");
  }
  bind("bu-connector-apply", applyConnector);
  function applySvg() {
    if (current()?.type !== "svg") return;
    const svg = cloneDocument(current().svg);
    svg.title = get("bu-svg-title");
    if (svgPaintDirty) {
      const color = get("bu-svg-color");
      for (const shape of svg.shapes) {
        if (shape.fill && shape.fill !== "none") shape.fill = color;
        if (
          $("bu-svg-strokes").checked &&
          shape.stroke &&
          shape.stroke !== "none"
        )
          shape.stroke = color;
      }
    }
    store.setSvg(current().id, svg);
    pending.delete("svg");
    svgPaintDirty = false;
  }
  $("bu-svg-color").addEventListener("input", () => {
    svgPaintDirty = true;
  });
  $("bu-svg-apply").addEventListener("click", () => {
    pending.delete("svg");
    run(applySvg);
  });
  $("bu-svg-unify").addEventListener("click", () => {
    pending.delete("svg");
    svgPaintDirty = true;
    run(applySvg);
  });
  function master() {
    return {
      enabled: $("bu-master-enabled").checked,
      footer: get("bu-master-footer"),
      logoText: get("bu-master-logo"),
      accentColor: get("bu-master-color"),
      showPageNumber: $("bu-master-page").checked,
    };
  }
  function applyMaster() {
    store.setMaster(master());
    pending.delete("master");
  }
  bind("bu-master-apply", applyMaster);
  $("bu-master-local").addEventListener("click", () => {
    pending.delete("master");
    run(() =>
      store.setSlideBusiness(store.activeSlideId, {
        masterOverride: master(),
        hideMaster: false,
      }),
    );
  });
  bind("bu-master-reset", () =>
    store.setSlideBusiness(store.activeSlideId, {
      masterOverride: null,
      hideMaster: false,
    }),
  );
  $("bu-master-hide").addEventListener("change", () => {
    const hideMaster = $("bu-master-hide").checked;
    run(() => store.setSlideBusiness(store.activeSlideId, { hideMaster }));
  });
  function applyTheme() {
    const theme = cloneDocument(
      store.document.theme || {
        colors: {
          primary: "#5367f7",
          secondary: "#9b7cf4",
          background: "#ffffff",
          text: "#182037",
        },
        fontFamily: "Malgun Gothic",
      },
    );
    theme.headingFontFamily = get("bu-heading-font");
    theme.spacing = Object.fromEntries(
      ["xs", "sm", "md", "lg", "xl"].map((k) => [k, num("bu-spacing-" + k)]),
    );
    store.setTheme(theme);
    pending.delete("theme");
  }
  bind("bu-theme-apply", applyTheme);
  function applyNotes() {
    store.setSlideBusiness(store.activeSlideId, { notes: get("bu-notes") });
    pending.delete("notes");
  }
  bind("bu-notes-apply", applyNotes);
  bind("bu-role-apply", () => {
    if (current()) store.setSemantics(current().id, get("bu-role"));
    pending.delete("role");
  });
  $("bu-reading-order").addEventListener("click", (event) => {
    const b = event.target.closest("button");
    if (!b) return;
    run(() => {
      const list = [
          ...(store.activeSlide.readingOrder ||
            store.activeSlide.elements.map((e) => e.id)),
        ],
        index = list.indexOf(b.dataset.readingId),
        next = index + Number(b.dataset.direction);
      if (index < 0 || next < 0 || next >= list.length) return;
      [list[index], list[next]] = [list[next], list[index]];
      store.setSlideBusiness(store.activeSlideId, { readingOrder: list });
    });
  });
  function diagnostics() {
    const result = store.readDiagnostics();
    if (!result.ok) return;
    const value = result.value;
    $("bu-diagnostic-revision").textContent = `확정본 ${value.contentRevision}`;
    $("bu-diagnostics").innerHTML = value.diagnostics.length
      ? value.diagnostics
          .map(
            (item, i) =>
              `<button data-diagnostic="${i}" class="bu-diagnostic ${escape(item.severity)}"><strong>${escape(item.code)}</strong><span>${escape(item.message)}</span></button>`,
          )
          .join("")
      : '<p class="property-help">현재 지원 검사에서 발견된 항목이 없습니다.</p>';
    $("bu-diagnostics")
      .querySelectorAll("button")
      .forEach((button) =>
        button.addEventListener("click", () =>
          run(() => {
            const row = value.diagnostics[+button.dataset.diagnostic];
            if (row.slideId) store.switchSlide(row.slideId);
            if (row.elementId)
              store.selectElements([row.elementId], {
                expandGroups: false,
                includeLocked: true,
                includeHidden: true,
              });
          }),
        ),
      );
  }
  $("bu-diagnostics-refresh").addEventListener("click", diagnostics);
  function outputChoices() {
    const prior = new Map(
      [...$("bu-output-variables").querySelectorAll("select")].map((field) => [
        field.dataset.variableId,
        field.value,
      ]),
    );
    $("bu-output-variables").innerHTML = (store.document.variables || [])
      .map(v=>{const preferred=v.options.some(o=>o.value===prior.get(v.id))?prior.get(v.id):v.initialValue;return `<label class="stacked-label">${escape(v.name)}<select data-variable-id="${escape(v.id)}">${v.options.map(o=>`<option value="${escape(o.value)}" ${o.value===preferred?'selected':''}>${escape(o.label)}</option>`).join('')}</select></label>`;})
      .join("");
    const previouslyOpen = new Map(
      [...$("bu-output-panels").querySelectorAll("input")].map(
        (f) => [f.value,f.checked],
      ),
    );
    $("bu-output-panels").innerHTML =
      store.document.slides
        .flatMap((s) =>
          s.elements
            .filter((e) => e.component?.kind === "panel")
            .map(
              (e) =>
                `<label class="wb-check"><input type="checkbox" value="${escape(e.id)}" ${(previouslyOpen.has(e.id)?previouslyOpen.get(e.id):e.component.initiallyOpen) ? "checked" : ""}>${escape(named(e))}</label>`,
            ),
        )
        .join("") || '<p class="property-help">상세 패널 없음</p>';
    const previouslyShown = new Set(
      [...$("bu-output-shown").querySelectorAll("input:checked")].map(
        (f) => f.value,
      ),
    );
    $("bu-output-shown").innerHTML =
      store.document.slides
        .flatMap((s) =>
          s.elements
            .filter((e) => e.initiallyHidden && !e.hidden)
            .map(
              (e) =>
                `<label class="wb-check"><input type="checkbox" value="${escape(e.id)}" ${previouslyShown.has(e.id) ? "checked" : ""}>${escape(named(e))}</label>`,
            ),
        )
        .join("") || '<p class="property-help">초기 숨김 개체 없음</p>';
  }
  function outputOptions() {
    const range = get("bu-output-range"),
      slideIds =
        range === "all"
          ? store.document.slides.map((s) => s.id)
          : range === "selected"
            ? workbench.selectedSlideIds
            : [store.activeSlideId];
    return {
      format: get("bu-output-format"),
      slideIds,
      scene: get("bu-output-scene"),
      includeNotes: $("bu-output-notes").checked,
      allowFontFallback: $("bu-output-font-fallback").checked,
      state: {
        variables: Object.fromEntries(
          [...$("bu-output-variables").querySelectorAll("select")].map((f) => [
            f.dataset.variableId,
            f.value,
          ]),
        ),
        openPanels: [
          ...$("bu-output-panels").querySelectorAll("input:checked"),
        ].map((f) => f.value),
        shownIds: [
          ...$("bu-output-shown").querySelectorAll("input:checked"),
        ].map((f) => f.value),
      },
    };
  }
  async function previewOutput() {
    try {
      const options = outputOptions(),
        result = await output("preview", options);
      previewContext = { options, source: result.source };
      $("bu-preview-caption").textContent =
        `${result.pages.length}장 · 미리보기 시점의 자료를 출력합니다.`;
      $("bu-preview-diagnostics").textContent = (result.diagnostics || [])
        .map((d) => d.message)
        .join("\n");
      $("bu-preview-pages").innerHTML = result.pages
        .map(
          (p, i) =>
            `<figure><img src="${p.dataUrl}" alt="출력 ${i + 1}번째 장"><figcaption>${i + 1} · ${p.width} × ${p.height}</figcaption></figure>`,
        )
        .join("");
      dialog.showModal();
    } catch (error) {
      notice(error.message, true);
    }
  }
  async function writeOutput(options = outputOptions(), expected) {
    try {
      const result = await output("write", options, expected);
      $("bu-output-status").textContent = result.canceled
        ? "내보내기를 취소했습니다."
        : `${result.pageCount}장 · ${(result.files || []).map((f) => f.name).join(", ")}`;
      notice($("bu-output-status").textContent);
      if (!result.canceled) dialog.close();
    } catch (error) {
      notice(error.message, true);
    }
  }
  $("bu-output-preview").addEventListener("click", previewOutput);
  $("bu-output-write").addEventListener("click", () => writeOutput());
  $("bu-preview-write").addEventListener(
    "click",
    () =>
      previewContext &&
      writeOutput(previewContext.options, previewContext.source),
  );
  if (!desktop?.output) {
    $("bu-output-preview").disabled = true;
    $("bu-output-write").disabled = true;
    $("bu-output-status").textContent =
      "PDF·PNG 출력은 데스크톱 앱에서 사용합니다.";
  }
  const fields = {
    connector: [
      "bu-connector-from",
      "bu-connector-from-anchor",
      "bu-connector-to",
      "bu-connector-to-anchor",
      "bu-connector-color",
      "bu-connector-width",
      "bu-connector-arrow",
    ],
    svg: ["bu-svg-title", "bu-svg-color", "bu-svg-strokes"],
    master: [
      "bu-master-enabled",
      "bu-master-footer",
      "bu-master-logo",
      "bu-master-color",
      "bu-master-page",
    ],
    theme: [
      "bu-heading-font",
      ...["xs", "sm", "md", "lg", "xl"].map((k) => "bu-spacing-" + k),
    ],
    notes: ["bu-notes"],
    role: ["bu-role"],
  };
  for (const [kind, ids] of Object.entries(fields))
    for (const id of ids) $(id).addEventListener("input", () => mark(kind));
  function applyRole() {
    if (current()) store.setSemantics(current().id, get("bu-role"));
    pending.delete("role");
  }
  function commitPending() {
    if (context && context.sessionId !== store.sessionId) {
      pending.clear();
      return;
    }
    if(context&&[...pending].some(kind=>['table','chart','connector','svg','role'].includes(kind))&&(context.elementId!==store.selectedId||context.slideId!==store.activeSlideId))throw new Error('선택이 바뀌어 이전 개체의 편집을 적용할 수 없습니다. 변경을 취소하고 다시 선택하세요.');
    for (const kind of [...pending])
      ({
        table: applyTable,
        chart: applyChart,
        connector: applyConnector,
        svg: applySvg,
        master: applyMaster,
        theme: applyTheme,
        notes: applyNotes,
        role: applyRole,
      })[kind]();
    $("bu-cancel").hidden = !pending.size;
  }
  function cancel() {
    document.activeElement?.blur();
    pending.clear();
    if(dataSession)closeDataEditor({cancel:true,resync:false});
    sync(true);
    updateStatus();
  }
  $("bu-cancel").addEventListener("click", cancel);
  function sync(force = false) {
    if (syncing) return;
    syncing = true;
    try {
      if(dataSession&&(dataSession.sessionId!==store.sessionId||dataSession.slideId!==store.activeSlideId||dataSession.elementId!==store.selectedId))closeDataEditor({cancel:true,restoreFocus:false,resync:false});
      const changed =
        session !== store.sessionId ||
        selectedId !== store.selectedId ||
        slideId !== store.activeSlideId;
      session = store.sessionId;
      selectedId = store.selectedId;
      slideId = store.activeSlideId;
      if (changed && context && context.sessionId !== session) pending.clear();
      const e = current();
      if(changed)templates.open=!e;
      for (const type of ["table", "chart", "connector", "svg"])
        $("bu-" + type + "-panel").hidden = e?.type !== type;
      if (
        e?.type === "table" &&
        !pending.has("table") &&
        (changed ||
          force ||
          JSON.stringify(tableDraft) !== JSON.stringify(e.table))
      ) {
        tableDraft = cloneDocument(e.table);
        if(changed)cell = { row: 0, col: 0 };
        set("bu-table-font", tableDraft.fontSize);
        set("bu-table-header", tableDraft.headerRows);
        tableGrid();
      }
      if (
        e?.type === "chart" &&
        !pending.has("chart") &&
        (changed ||
          force ||
          JSON.stringify(chartDraft) !== JSON.stringify(e.chart))
      ) {
        chartDraft = cloneDocument(e.chart);
        if(changed){chartChoice = "base";chartCell={row:0,col:0};}
        set("bu-chart-kind", chartDraft.kind);
        $("bu-chart-legend").checked = chartDraft.showLegend;
        const presentation={animated:true,duration:700,showTooltip:true,legendPosition:'bottom',stacked:false,smooth:true,fill:false,...chartDraft.presentation};
        set('bu-chart-duration',presentation.duration);set('bu-chart-legend-position',presentation.legendPosition);
        for(const [id,key]of [['animated','animated'],['tooltip','showTooltip'],['stacked','stacked'],['smooth','smooth'],['fill','fill']])$('bu-chart-'+id).checked=presentation[key];
        const axes={direction:'vertical',minimum:null,maximum:null,step:null,showGrid:true,showCategoryLabels:true,categoryTitle:'',valueTitle:'',...chartDraft.axes},labels={show:false,decimals:null,prefix:'',suffix:'',grouping:true,...chartDraft.labels};
        for(const key of ['direction','minimum','maximum','step'])set('bu-chart-'+key,axes[key]);
        set('bu-chart-category-title',axes.categoryTitle);set('bu-chart-value-title',axes.valueTitle);$('bu-chart-grid-lines').checked=axes.showGrid;$('bu-chart-category-labels').checked=axes.showCategoryLabels;
        for(const key of ['decimals','prefix','suffix'])set('bu-chart-'+key,labels[key]);$('bu-chart-grouping').checked=labels.grouping;$('bu-chart-data-labels').checked=labels.show;
        choices(
          "bu-chart-variable",
          (store.document.variables || []).filter(v=>v.kind!=='number').map((v) => [v.id, v.name]),
          "연동하지 않음",
        );
        set("bu-chart-variable", chartDraft.variants?.variableId || "");
        chartChoices();
        chartGrid();
      }
      if (e?.type === "connector" && !pending.has("connector")) {
        const rows = store.activeSlide.elements
          .filter((e) => e.type !== "connector" && !e.hidden)
          .map((e) => [e.id, named(e)]);
        choices("bu-connector-from", rows,"현재 위치 유지");
        choices("bu-connector-to", rows,"현재 위치 유지");
        set("bu-connector-from", e.connector.from.elementId);
        set("bu-connector-to", e.connector.to.elementId);
        set("bu-connector-from-anchor", e.connector.from.anchor||'center');
        set("bu-connector-to-anchor", e.connector.to.anchor||'center');
        set("bu-connector-color", e.connector.stroke.color);
        set("bu-connector-width", e.connector.stroke.width);
        set("bu-connector-arrow", e.connector.arrow);
      }
      if (e?.type === "svg" && !pending.has("svg")) {
        svgPaintDirty = false;
        set("bu-svg-title", e.svg.title || "");
        set(
          "bu-svg-color",
          e.svg.shapes.find((s) => s.fill && s.fill !== "none")?.fill ||
            "#5367f7",
        );
      }
      if (!pending.has("master")) {
        const m = {
          enabled: true,
          footer: "Present Vividly.",
          logoText: "Vividly",
          accentColor: "#5367f7",
          showPageNumber: true,
          ...store.document.master,
          ...store.activeSlide.masterOverride,
        };
        $("bu-master-enabled").checked = m.enabled;
        set("bu-master-footer", m.footer);
        set("bu-master-logo", m.logoText);
        set("bu-master-color", m.accentColor);
        $("bu-master-page").checked = m.showPageNumber;
        $("bu-master-hide").checked = store.activeSlide.hideMaster === true;
        $("bu-master-status").textContent = store.activeSlide.masterOverride
          ? "현재 장의 예외 설정이 있습니다."
          : "현재 장은 공통 설정을 따릅니다.";
      }
      if (!pending.has("theme")) {
        set(
          "bu-heading-font",
          store.document.theme?.headingFontFamily ||
            store.document.theme?.fontFamily ||
            "Malgun Gothic",
        );
        for (const [k, v] of Object.entries({
          xs: 8,
          sm: 16,
          md: 24,
          lg: 40,
          xl: 64,
        }))
          set("bu-spacing-" + k, store.document.theme?.spacing?.[k] ?? v);
      }
      if (!pending.has("notes")) set("bu-notes", store.activeSlide.notes || "");
      if (!pending.has("role")) set("bu-role", e?.semanticRole || "auto");
      $("bu-role-apply").disabled = !e;
      $("bu-detach-template").disabled = !store.activeSlide.template;
      const reading =
        store.activeSlide.readingOrder ||
        store.activeSlide.elements.map((e) => e.id);
      $("bu-reading-order").innerHTML = reading
        .map(
          (id, i) =>
            `<div class="bu-reading-row"><span>${i + 1}. ${escape(named(store.activeSlide.elements.find((e) => e.id === id)))}</span><button data-reading-id="${escape(id)}" data-direction="-1" aria-label="읽기 순서 위로" ${i === 0 ? "disabled" : ""}>↑</button><button data-reading-id="${escape(id)}" data-direction="1" aria-label="읽기 순서 아래로" ${i === reading.length - 1 ? "disabled" : ""}>↓</button></div>`,
        )
        .join("");
      diagnostics();
      const nextOutputKey=JSON.stringify({documentId:store.document.id,variables:store.document.variables,items:store.document.slides.flatMap(s=>s.elements.filter(e=>e.component?.kind==='panel'||e.initiallyHidden).map(e=>[e.id,e.name,e.component?.initiallyOpen,e.hidden,e.initiallyHidden]))});
      if (changed || force || outputKey!==nextOutputKey) {outputChoices();outputKey=nextOutputKey;}
      $("bu-cancel").hidden = !pending.size;
    } finally {
      syncing = false;
    }
  }
  sync(true);
  return {
    sync,
    commitPending,
    cancelPending: cancel,
    show({focusEditor=false,expanded=false}={}) {
      workbench.showTab("business");
      sync();
      if(expanded&&['table','chart'].includes(current()?.type)){openDataEditor();return;}
      const panel=activeEditor();
      if(panel){panel.scrollIntoView({block:'start',inline:'nearest'});if(focusEditor){if(['table','chart'].includes(current().type))focusDataCell(current().type);else panel.querySelector('input,select')?.focus({preventScroll:true});}}
    },
    showDelivery(){workbench.showTab('delivery');},
    activity(){return {active:dataDialog.open,pending:pending.size>0};},
    get pendingChanges() {
      return pending.size > 0;
    },
    draftSignature() {
      return pending.size
        ? JSON.stringify({
            pending: [...pending],
            context,
            tableDraft,
            chartDraft,
            values: [...page.querySelectorAll("input,select,textarea"),...dataDialog.querySelectorAll('input,select,textarea')].map(
              (f) => [f.id, f.value, f.checked],
            ),
          })
        : null;
    },
  };
}
