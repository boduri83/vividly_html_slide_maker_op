import { cloneDocument } from "./model.js";

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
const presets = {
  fadeIn: "서서히 등장",
  slideInLeft: "왼쪽에서 등장",
  slideInRight: "오른쪽에서 등장",
  slideInUp: "아래에서 등장",
  zoomIn: "확대 등장",
  fadeOut: "서서히 퇴장",
  slideOutRight: "오른쪽으로 퇴장",
  pulse: "맥박 강조",
  spin: "회전 강조",
  keyframes: "타임라인 키프레임",
};
const starts = {
  onClick: "클릭할 때",
  withPrevious: "이전 효과와 함께",
  afterPrevious: "이전 효과 다음에",
};
const easings = {
  ease: "부드럽게",
  linear: "일정하게",
  "ease-in": "천천히 시작",
  "ease-out": "천천히 마침",
  "ease-in-out": "천천히 시작·마침",
};
const options = (values) =>
  Object.entries(values)
    .map(
      ([value, label]) =>
        `<option value="${escape(value)}">${escape(label)}</option>`,
    )
    .join("");
const input = (id, label, value, type = "text", extra = "") =>
  `<label class="stacked-label">${label}<input id="${id}" type="${type}" value="${escape(value)}" ${extra}></label>`;
const select = (id, label, values) =>
  `<label class="stacked-label">${label}<select id="${id}">${options(values)}</select></label>`;

export function createMotionWorkbench({
  store,
  workbench,
  action,
  notice,
  render,
  updateStatus,
  preview,
  openExample,
}) {
  const pending = new Set();
  let session = store.sessionId,
    slideId = store.activeSlideId,
    selectedId = store.selectedId;
  let motionId = null,
    interactionId = null,
    actionIndex = 0,
    variableId = null;
  let formContext = null,
    syncing = false,
    bindingKey = "";
  const get = (id) => $(id).value;
  const num = (id) => Number(get(id));
  const set = (id, value) => {
    if (document.activeElement !== $(id)) $(id).value = value ?? "";
  };
  const run = (fn) => action(fn);
  const bind = (id, fn) => $(id).addEventListener("click", () => {
    // Add consumes the form as a new item; it does not also edit the selected item.
    if(id==='mo-add')pending.delete('motion');
    if(id==='mo-interaction-add')pending.delete('interaction');
    run(fn);
  });
  const label = (id) =>
    store.activeSlide.elements.find((e) => e.id === id)?.name ||
    store.activeSlide.elements
      .find((e) => e.id === id)
      ?.text?.paragraphs.find(Boolean) ||
    id;
  const motions = () => store.activeSlide.motions || [];
  const interactions = () => store.activeSlide.interactions || [];
  const variables = () => store.document.variables || [];
  const chosen = () => store.selectedElement;
  const requireElement = () => {
    const e = chosen();
    if (!e) throw new Error("캔버스나 레이어에서 개체를 먼저 선택하세요.");
    return e;
  };
  function choices(id, rows, empty = "대상을 선택하세요") {
    const field = $(id),
      before = field.value;
    const markup =
      `<option value="">${escape(empty)}</option>` +
      rows
        .map(
          ([value, label]) =>
            `<option value="${escape(value)}">${escape(label)}</option>`,
        )
        .join("");
    if (field.innerHTML !== markup) field.innerHTML = markup;
    if (rows.some(([value]) => value === before)) field.value = before;
  }
  function page(id) {
    const node = document.createElement("div");
    node.id = id;
    return node;
  }
  const motionPage = page("mo-motion");
  motionPage.innerHTML = `<div class="wb-panel-intro">개체를 선택하고 효과를 추가하세요. 목록 순서와 시작 조건으로 장면을 구성합니다.</div>
  <section class="property-section"><h3>개체 애니메이션 <span id="mo-motion-count"></span></h3><p id="mo-selection" class="property-help"></p>
  ${select("mo-preset", "효과", presets)}${select("mo-start", "시작", starts)}
  <div class="property-grid">${input("mo-duration", "지속 시간 ms", 650, "number", 'min="0" max="60000" step="50"')}${input("mo-delay", "지연 ms", 0, "number", 'min="0" max="60000" step="50"')}</div>
  <div class="property-grid">${select("mo-easing", "속도 곡선", easings)}${input("mo-iterations", "반복 횟수", 1, "number", 'min="1" max="20"')}</div>
  <div class="wb-button-row"><button id="mo-add" class="primary-button">효과 추가</button><button id="mo-update">선택 효과 적용</button></div>
  <div id="mo-motion-list" class="mo-list" aria-label="애니메이션 순서"></div><button id="mo-motion-new" class="wb-wide">새 효과 설정</button></section>
  <section class="property-section"><h3>슬라이드 전환</h3>${select("mo-transition", "전환 효과", { none: "전환 없음", fade: "페이드", push: "밀어내기", zoom: "확대" })}
  <div class="property-grid">${input("mo-transition-duration", "전환 시간 ms", 500, "number", 'min="0" max="10000" step="50"')}${select("mo-transition-easing", "속도 곡선", easings)}</div>
  <label class="wb-check"><input id="mo-auto" type="checkbox">자동으로 다음 장 이동</label>${input("mo-advance-after", "장 표시 시간 ms", 5000, "number", 'min="500" max="600000" step="500"')}
  <button id="mo-transition-apply" class="wb-wide">선택 슬라이드에 적용</button><p class="property-help">왼쪽 목록에서 여러 장을 선택해 함께 적용할 수 있습니다.</p></section>`;
  const interactionPage = page("mo-interaction");
  interactionPage.innerHTML = `<div class="wb-panel-intro">편집 중 클릭은 개체 선택입니다. 미리보기에서 버튼·탭·선택 입력과 상세 패널을 시험하세요.</div>
  <section class="property-section"><h3>인터랙티브 요소 삽입</h3><div class="mo-component-buttons"><button id="mo-insert-button">버튼</button><button id="mo-insert-tabs">탭</button><button id="mo-insert-select">선택 입력</button><button id="mo-insert-panel">상세 패널</button></div>
  <label class="wb-check"><input id="mo-initially-hidden" type="checkbox">재생 시작 시 숨기기</label><p class="property-help">표시 동작으로 나타낼 개체에 사용합니다. 레이어의 숨김과 별도로 재생 시작 상태를 정합니다.</p>
  <div id="mo-component-properties" hidden>${select("mo-component-var", "연결 데이터", {})}<div id="mo-panel-properties" hidden>
  <label class="wb-check"><input id="mo-panel-open" type="checkbox">처음부터 열기</label><label class="wb-check"><input id="mo-panel-dim" type="checkbox" checked>배경 어둡게</label>${select("mo-panel-placement", "진입 방향", { right: "오른쪽", left: "왼쪽", center: "가운데" })}
  <p id="mo-panel-content" class="property-help"></p><button id="mo-panel-include" class="wb-wide">함께 선택한 개체를 패널에 포함</button></div>
  <div class="wb-button-row"><button id="mo-component-apply">요소 설정 적용</button><button id="mo-component-clear">동작 요소 해제</button></div></div></section>
  <section class="property-section"><h3>트리거와 동작</h3>${select("mo-interaction-source", "이 개체에서", {})}${select("mo-interaction-event", "이벤트", { click: "클릭 / Enter / Space", hover: "포인터가 들어오면", focus: "키보드 포커스를 받으면", change: "선택 값이 바뀌면" })}
  ${select("mo-interaction-action", "실행할 동작", { show: "개체 표시", hide: "개체 숨김", toggle: "표시 / 숨김 전환", openPanel: "상세 패널 열기", closePanel: "상세 패널 닫기", goToSlide: "슬라이드 이동", playMotion: "애니메이션 재생", setVariable: "데이터 선택 값 변경" })}
  ${select("mo-interaction-target", "대상", {})}<div id="mo-action-value-wrap" hidden>${select("mo-action-value", "변경할 값", {})}</div>
  <div class="wb-button-row"><button id="mo-interaction-add" class="primary-button">동작 추가</button><button id="mo-interaction-apply">선택 동작 적용</button></div><div id="mo-interaction-list" class="mo-list"></div><button id="mo-interaction-new" class="wb-wide">새 동작 설정</button></section>
  <section class="property-section"><h3>연동 데이터</h3>${select("mo-var-select", "편집할 데이터", {})}${input("mo-var-name", "데이터 이름", "연도", "text", 'maxlength="80"')}
  <div id="mo-var-options" class="mo-data-table" aria-label="선택 값과 표시 이름"></div><button id="mo-var-option-add" class="wb-wide">선택 항목 추가</button>${select("mo-var-initial", "처음 선택할 값", {})}
  <div class="wb-button-row"><button id="mo-var-save">데이터 저장</button><button id="mo-var-delete">데이터 삭제</button></div><p class="property-help">예: 값 2025 · 표시 이름 2025년. 탭과 선택 입력이 이 데이터를 함께 사용합니다.</p></section>
  <section class="property-section"><h3>선택한 텍스트 / KPI 연동</h3>${select("mo-bind-var", "연결 데이터", {})}<div id="mo-bind-values" class="mo-data-table"></div>
  <div class="property-grid">${input("mo-bind-prefix", "앞에 붙일 글자", "")}${input("mo-bind-suffix", "뒤에 붙일 글자", "")}</div>${select("mo-bind-format", "표시 형식", { text: "텍스트", number: "숫자 · 천 단위 구분" })}
  <label class="wb-check"><input id="mo-bind-animate" type="checkbox" checked>숫자가 바뀔 때 애니메이션</label><div class="wb-button-row"><button id="mo-bind-apply">연동 적용</button><button id="mo-bind-clear">연동 해제</button></div><p class="property-help">각 선택 값에 표시할 내용과 숫자를 직접 입력합니다. 재생 중 선택은 문서 원본을 바꾸지 않습니다.</p></section>`;
  workbench.addInspectorPage("motion", "모션", motionPage);
  workbench.addInspectorPage("interaction", "인터랙션", interactionPage);
  const cancel = document.createElement("button");
  cancel.id = "mo-cancel";
  cancel.className = "mo-cancel";
  cancel.textContent = "설정 변경 취소";
  cancel.hidden = true;
  document.querySelector(".properties-panel .panel-title").after(cancel);
  cancel.addEventListener("click", () => {
    pending.clear();
    sync(true);
    updateStatus();
  });
  const previewButton = document.createElement("button");
  previewButton.id = "mo-preview";
  previewButton.textContent = "미리보기";
  previewButton.className = "secondary-button";
  previewButton.title = "동작 미리보기 · 편집 원본은 유지됩니다.";
  $("present-button").before(previewButton);
  previewButton.addEventListener("click", () => run(preview));
  const exampleButton = document.createElement("button");
  exampleButton.id = "mo-open-example";
  exampleButton.textContent = "동작 예제";
  exampleButton.title = "편집 가능한 모션·인터랙션 예제 열기";
  document.querySelector(".toolbar").append(exampleButton);
  exampleButton.addEventListener("click", openExample);
  document.documentElement.classList.add("motion-workbench");

  function readMotion(old = {}) {
    if (old.preset === 'keyframes' || get('mo-preset') === 'keyframes') throw new Error('키프레임 효과는 타임라인에서 편집하세요. 새 기본 효과는 새 효과 설정을 눌러 만드세요.');
    return {
      ...old,
      preset: get("mo-preset"),
      start: get("mo-start"),
      duration: num("mo-duration"),
      delay: num("mo-delay"),
      easing: get("mo-easing"),
      iterations: num("mo-iterations"),
    };
  }
  function applyMotion() {
    const list = motions(),
      old = list.find((m) => m.id === motionId);
    if (!old) return;
    store.setMotions(
      store.activeSlideId,
      list.map((m) => (m.id === motionId ? readMotion(m) : m)),
    );
    pending.delete("motion");
  }
  bind("mo-add", () => {
    const targets = store.selectedElements.filter(
      (e) => !e.locked && !e.hidden,
    );
    if (!targets.length) throw new Error("효과를 적용할 개체를 선택하세요.");
    const added = targets.map((e, i) =>
      readMotion({ id: uid("motion"), targetId: e.id }),
    );
    for (let i = 1; i < added.length; i++) added[i].start = "withPrevious";
    store.setMotions(store.activeSlideId, [...motions(), ...added]);
    motionId = added[0].id;
  });
  bind("mo-update", applyMotion);
  $("mo-motion-new").addEventListener("click", () =>
    run(() => {
      motionId = null;
      pending.delete("motion");
      $("mo-preset").value = "fadeIn";
    }),
  );
  function applyTransition() {
    const commands = workbench.selectedSlideIds.map((slideId) => ({
      id: "slide.set_transition",
      params: {
        slideId,
        transition:
          get("mo-transition") === "none"
            ? null
            : {
                type: get("mo-transition"),
                duration: num("mo-transition-duration"),
                easing: get("mo-transition-easing"),
              },
        advanceAfter: $("mo-auto").checked ? num("mo-advance-after") : null,
      },
    }));
    store.runBatch(commands, "슬라이드 전환");
    pending.delete("transition");
  }
  bind("mo-transition-apply", applyTransition);
  function syncMotionList() {
    $("mo-motion-count").textContent = `${motions().length}개`;
    $("mo-selection").textContent = chosen()
      ? `${store.selectedIds.length}개 선택 · ${label(chosen().id)}`
      : "캔버스에서 적용할 개체를 선택하세요.";
    $("mo-motion-list").innerHTML = motions()
      .map(
        (m, i) =>
          `<div class="mo-effect-row${m.id === motionId ? " active" : ""}" data-motion-id="${escape(m.id)}"><button class="mo-row-select" data-motion-select="${escape(m.id)}"><strong>${i + 1}. ${escape(presets[m.preset] || m.preset)}</strong><span>${escape(label(m.targetId))}</span><small>${escape(starts[m.start])} · ${m.duration}ms</small><i style="width:${Math.min(100, Math.max(8, m.duration / 60))}%"></i></button><div class="mo-row-actions"><button data-motion-up="${escape(m.id)}" aria-label="효과 위로" ${i === 0 ? "disabled" : ""}>↑</button><button data-motion-down="${escape(m.id)}" aria-label="효과 아래로" ${i === motions().length - 1 ? "disabled" : ""}>↓</button><button data-motion-delete="${escape(m.id)}" aria-label="효과 삭제">×</button></div></div>`,
      )
      .join("");
  }
  $("mo-motion-list").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.motionSelect) {
      run(() => {
        const motion=motions().find(m=>m.id===button.dataset.motionSelect);
        if(motion?.preset==='keyframes'){
          store.selectElements([motion.targetId],{expandGroups:false});
          workbench.showTab('timeline');
          notice('키프레임 효과는 타임라인에서 편집합니다.');
          return;
        }
        motionId = button.dataset.motionSelect;
      });
      return;
    }
    run(() => {
      const key = button.dataset.motionUp
          ? "motionUp"
          : button.dataset.motionDown
            ? "motionDown"
            : "motionDelete",
        id = button.dataset[key],
        list = [...motions()],
        index = list.findIndex((m) => m.id === id);
      if (index < 0) return;
      if (key === "motionDelete") {
        list.splice(index, 1);
        if (motionId === id) motionId = null;
      } else {
        const next = index + (key === "motionUp" ? -1 : 1);
        [list[index], list[next]] = [list[next], list[index]];
      }
      store.setMotions(store.activeSlideId, list);
    });
  });

  function defaultVariable() {
    return {
      id: uid("variable"),
      name: "연도",
      initialValue: "2025",
      options: [
        { value: "2024", label: "2024년" },
        { value: "2025", label: "2025년" },
        { value: "2026", label: "2026년" },
      ],
    };
  }
  function text(text, size = 28, color = "#182037", align = "left") {
    return {
      paragraphs: [text],
      textStyle: {
        fontFamily: store.document.theme?.fontFamily || "Malgun Gothic",
        fontSize: size,
        lineHeight: 1.3,
        color,
        align,
        verticalAlign: "middle",
      },
    };
  }
  function shape(id, name, g, fill, content, style = {}) {
    return {
      id,
      type: "shape",
      name,
      shape: "rectangle",
      geometry: g,
      fill,
      stroke: { color: fill, width: 0 },
      text: content,
      style,
    };
  }
  function insert(kind) {
    const w = store.document.canvas.width,
      h = store.document.canvas.height;
    const x = Math.max(24, w * 0.1),
      y = Math.max(24, h * 0.72),
      base = uid("component");
    const existing = variables()[0],
      variable = existing || defaultVariable(),
      newVariables =
        (kind === "tabs" || kind === "select") && !existing ? [variable] : [];
    let elements;
    if (kind === "panel") {
      const width = Math.min(480, w * 0.62),
        height = Math.min(530, h * 0.82),
        px = w - width - 40,
        py = (h - height) / 2,
        group = uid("group");
      elements = [
        shape(
          base,
          "상세 패널",
          { x: px, y: py, width, height },
          "#ffffff",
          text("", 24),
          {
            radius: 22,
            shadow: { x: 0, y: 18, blur: 50, spread: 0, color: "#00000044" },
          },
        ),
        {
          id: `${base}-title`,
          type: "text",
          name: "패널 제목",
          geometry: { x: px + 36, y: py + 48, width: width - 100, height: 64 },
          text: text("상세 내용을 소개합니다", 28),
        },
        {
          id: `${base}-body`,
          type: "text",
          name: "패널 설명",
          geometry: {
            x: px + 36,
            y: py + 140,
            width: width - 72,
            height: height - 190,
          },
          text: text(
            "이곳을 두 번 눌러 설명을 편집하세요.\n\n버튼을 클릭하면 이 패널이 열립니다. 닫기 버튼과 Esc로 돌아갈 수 있습니다.",
            23,
            "#52617c",
          ),
        },
      ];
      elements[0].component = {
        kind: "panel",
        contentIds: elements.slice(1).map((e) => e.id),
        initiallyOpen: false,
        dim: true,
        placement: "right",
      };
      for (const e of elements) e.groupId = group;
    } else {
      const content =
        kind === "button"
          ? "자세히 보기"
          : kind === "tabs"
            ? "연도 선택"
            : "선택하세요";
      elements = [
        shape(
          base,
          kind === "button"
            ? "인터랙션 버튼"
            : kind === "tabs"
              ? "연도 탭"
              : "선택 입력",
          {
            x,
            y,
            width: kind === "tabs" ? 450 : kind === "select" ? 300 : 210,
            height: 64,
          },
          kind === "button" ? "#4f63ff" : "#eaf0ff",
          text(
            content,
            24,
            kind === "button" ? "#ffffff" : "#25365c",
            "center",
          ),
          { radius: 12 },
        ),
      ];
      elements[0].component = {
        kind,
        ...(kind === "tabs" || kind === "select"
          ? { variableId: variable.id }
          : {}),
      };
    }
    const created = store.pasteElements(
      {
        kind: "vividly-elements",
        version: 2,
        documentId: store.document.id,
        elements,
        assets: [],
        variables: newVariables,
        motions: [],
        interactions: [],
      },
      { offsetX: 0, offsetY: 0 },
    );
    const primary = Array.isArray(created) ? created[0] : store.selectedIds[0];
    if (primary) store.selectElements([primary], { expandGroups: false });
    workbench.showTab("interaction");
    notice("동작 요소를 추가했습니다. 미리보기에서 시험할 수 있습니다.");
  }
  for (const kind of ["button", "tabs", "select", "panel"])
    bind(`mo-insert-${kind}`, () => insert(kind));
  $("mo-initially-hidden").addEventListener("change", () => {
    const initiallyHidden = $("mo-initially-hidden").checked;
    run(() => store.setElementFlags(requireElement().id, { initiallyHidden }));
  });
  function applyComponent() {
    const e = requireElement();
    if (!e.component) return;
    const component = cloneDocument(e.component);
    if (["tabs", "select"].includes(component.kind))
      component.variableId = get("mo-component-var");
    if (component.kind === "panel")
      Object.assign(component, {
        initiallyOpen: $("mo-panel-open").checked,
        dim: $("mo-panel-dim").checked,
        placement: get("mo-panel-placement"),
      });
    store.setComponent(e.id, component);
    pending.delete("component");
  }
  bind("mo-component-apply", applyComponent);
  bind("mo-component-clear", () =>
    store.setComponent(requireElement().id, null),
  );
  bind("mo-panel-include", () => {
    const panel = store.selectedElements.find(
      (e) => e.component?.kind === "panel",
    );
    if (!panel) throw new Error("패널과 포함할 개체를 함께 선택하세요.");
    const contentIds = [
      ...new Set([
        ...(panel.component.contentIds || []),
        ...store.selectedIds.filter((id) => id !== panel.id),
      ]),
    ];
    store.setComponent(panel.id, { ...panel.component, contentIds });
  });

  function actionTargets() {
    const type = get("mo-interaction-action");
    const rows =
      type === "goToSlide"
        ? store.document.slides.map((s, i) => [
            s.id,
            `${i + 1}. ${s.name || s.section || "슬라이드"}`,
          ])
        : type === "playMotion"
          ? motions().map((m, i) => [
              m.id,
              `${i + 1}. ${presets[m.preset]} · ${label(m.targetId)}`,
            ])
          : type === "setVariable"
            ? variables().map((v) => [v.id, v.name])
            : store.activeSlide.elements
                .filter(
                  (e) =>
                    !e.hidden &&
                    (!["openPanel", "closePanel"].includes(type) ||
                      e.component?.kind === "panel"),
                )
                .map((e) => [e.id, label(e.id)]);
    choices("mo-interaction-target", rows);
    $("mo-action-value-wrap").hidden = type !== "setVariable";
    if (type === "setVariable") {
      const v = variables().find((v) => v.id === get("mo-interaction-target"));
      choices(
        "mo-action-value",
        (v?.options || []).map((o) => [o.value, o.label]),
      );
    }
  }
  $("mo-interaction-action").addEventListener("change", actionTargets);
  $("mo-interaction-target").addEventListener("change", actionTargets);
  function readAction() {
    const type = get("mo-interaction-action"),
      target = get("mo-interaction-target");
    if (!target) throw new Error("동작의 대상을 선택하세요.");
    return type === "playMotion"
      ? { type, motionId: target }
      : type === "setVariable"
        ? { type, variableId: target, value: get("mo-action-value") }
        : { type, targetId: target };
  }
  function applyInteraction() {
    const list = interactions(),
      old = list.find((row) => row.id === interactionId);
    if (!old) return;
    const edited=readAction();
    const replacement = {
      ...old,
      sourceId: get("mo-interaction-source"),
      event: get("mo-interaction-event"),
      actions: old.actions.map((a, i) =>
        i === actionIndex ? edited : a,
      ),
    };
    const navigation=replacement.actions.filter(a=>a.type==='goToSlide');
    if(navigation.length>1)throw new Error('이 이벤트에 슬라이드 이동이 이미 연결되어 있습니다. 기존 이동 동작을 선택해 수정하세요.');
    replacement.actions=[...replacement.actions.filter(a=>a.type!=='goToSlide'),...navigation];
    actionIndex=replacement.actions.indexOf(edited);
    store.setInteractions(
      store.activeSlideId,
      list.map((row) => (row.id === old.id ? replacement : row)),
    );
    pending.delete("interaction");
  }
  bind("mo-interaction-add", () => {
    const sourceId = get("mo-interaction-source") || requireElement().id,
      event = get("mo-interaction-event"),
      a = readAction();
    if (!sourceId) throw new Error("이벤트를 받을 개체를 선택하세요.");
    const list = cloneDocument(interactions()),
      existing = list.find(
        (row) => row.sourceId === sourceId && row.event === event,
      );
    if (existing) {
      if (
        existing.actions.some(
          (old) => JSON.stringify(old) === JSON.stringify(a),
        )
      )
        throw new Error("같은 동작이 이미 연결되어 있습니다.");
      const navigationIndex=existing.actions.findIndex(old=>old.type==='goToSlide');
      if(a.type==='goToSlide'&&navigationIndex>=0)throw new Error('이 이벤트에 슬라이드 이동이 이미 연결되어 있습니다. 기존 이동 동작을 선택해 수정하세요.');
      const insertion=navigationIndex<0?existing.actions.length:navigationIndex;
      existing.actions.splice(insertion,0,a);
      interactionId = existing.id;
      actionIndex = insertion;
    } else {
      const row = { id: uid("interaction"), sourceId, event, actions: [a] };
      list.push(row);
      interactionId = row.id;
      actionIndex = 0;
    }
    store.setInteractions(store.activeSlideId, list);
  });
  bind("mo-interaction-apply", applyInteraction);
  $("mo-interaction-new").addEventListener("click", () =>
    run(() => {
      interactionId = null;
      pending.delete("interaction");
    }),
  );
  $("mo-interaction-list").addEventListener("click", (event) => {
    const b = event.target.closest("button");
    if (!b) return;
    run(() => {
      const id = b.dataset.interactionSelect || b.dataset.interactionDelete,
        index = Number(b.dataset.actionIndex || 0),
        list = cloneDocument(interactions()),
        row = list.find((r) => r.id === id);
      if (!row) return;
      if (b.dataset.interactionSelect) {
        if(row.trigger||row.condition||['key','scroll','inView','leave','blur'].includes(row.event)||row.actions.some(a=>['setState','resetState'].includes(a.type))){
          store.selectElements([row.sourceId],{expandGroups:false});
          workbench.showTab('behavior');
          notice('이 동작의 조건과 모양은 동작 확장 탭에서 편집합니다.');
          return;
        }
        interactionId = id;
        actionIndex = index;
      } else {
        row.actions.splice(index, 1);
        store.setInteractions(
          store.activeSlideId,
          list.filter((row) => row.actions.length),
        );
        interactionId = null;
      }
    });
  });

  function variableRows(items) {
    $("mo-var-options").innerHTML =
      `<div class="mo-grid-header"><span>값</span><span>표시 이름</span><span></span></div>` +
      items
        .map(
          (o) =>
            `<div class="mo-var-option"><input data-var-value aria-label="선택 값" value="${escape(o.value)}" maxlength="128"><input data-var-label aria-label="표시 이름" value="${escape(o.label)}" maxlength="160"><button data-var-remove aria-label="선택 항목 삭제">×</button></div>`,
        )
        .join("");
    initialChoices();
  }
  function readVariableOptions() {
    return [...$("mo-var-options").querySelectorAll(".mo-var-option")].map(
      (row) => ({
        value: row.querySelector("[data-var-value]").value,
        label: row.querySelector("[data-var-label]").value,
      }),
    );
  }
  function initialChoices() {
    const prior = get("mo-var-initial");
    choices(
      "mo-var-initial",
      readVariableOptions().map((o) => [o.value, o.label]),
    );
    if ([...$("mo-var-initial").options].some((o) => o.value === prior))
      $("mo-var-initial").value = prior;
    else if ($("mo-var-initial").options[1])
      $("mo-var-initial").selectedIndex = 1;
  }
  function applyVariable() {
    const old = variables().find((v) => v.id === variableId),
      v = {
        id: old?.id || uid("variable"),
        name: get("mo-var-name"),
        initialValue: get("mo-var-initial"),
        options: readVariableOptions(),
      };
    const updated = old
      ? variables().map((item) => (item.id === old.id ? v : item))
      : [...variables(), v];
    const structural =
      old &&
      JSON.stringify(old.options.map((o) => o.value).sort()) !==
        JSON.stringify(v.options.map((o) => o.value).sort());
    if (structural) {
      const allElements = store.document.slides.flatMap((s) => s.elements),
        bindings = allElements.filter((e) => e.binding?.variableId === old.id);
      const choices = new Set(v.options.map((o) => o.value));
      const rules = store.document.slides.filter((s) =>
        (s.interactions || []).some((r) =>
          r.actions.some(
            (a) =>
              a.type === "setVariable" &&
              a.variableId === old.id &&
              !choices.has(a.value),
          ),
        ),
      );
      const command = (id, params) => ({ id, params });
      const commands = [
        ...bindings.map((e) =>
          command("element.set_binding", { elementId: e.id, binding: null }),
        ),
        ...rules.map((s) =>
          command("slide.set_interactions", {
            slideId: s.id,
            interactions: [],
          }),
        ),
        command("document.set_variables", { variables: updated }),
        ...bindings.map((e) =>
          command("element.set_binding", {
            elementId: e.id,
            binding: {
              ...e.binding,
              values: v.options.map((o) => ({
                value: o.value,
                text:
                  e.binding.values.find((item) => item.value === o.value)
                    ?.text ?? (e.binding.format === "number" ? "0" : o.label),
              })),
            },
          }),
        ),
        ...rules.map((s) =>
          command("slide.set_interactions", {
            slideId: s.id,
            interactions: s.interactions.map((r) => ({
              ...r,
              actions: r.actions.map((a) =>
                a.type === "setVariable" &&
                a.variableId === old.id &&
                !choices.has(a.value)
                  ? { ...a, value: v.initialValue }
                  : a,
              ),
            })),
          }),
        ),
      ];
      store.runBatch(commands, "연동 데이터와 연결된 값 변경");
    } else store.setVariables(updated);
    variableId = v.id;
    pending.delete("variable");
  }
  $("mo-var-select").addEventListener("change", () => {
    const next = get("mo-var-select");
    run(() => {
      variableId = next || null;
      syncVariable(true);
    });
  });
  $("mo-var-option-add").addEventListener("click", () => {
    const rows = readVariableOptions(),
      next = String(rows.length + 1);
    rows.push({ value: next, label: `선택 ${next}` });
    variableRows(rows);
    if (variableId) pending.add("variable");
    updateStatus();
  });
  $("mo-var-options").addEventListener("click", (event) => {
    if (!event.target.closest("[data-var-remove]")) return;
    event.target.closest(".mo-var-option").remove();
    initialChoices();
    if (variableId) pending.add("variable");
    updateStatus();
  });
  $("mo-var-options").addEventListener("input", initialChoices);
  bind("mo-var-save", applyVariable);
  bind("mo-var-delete", () => {
    if (variableId)
      store.setVariables(variables().filter((v) => v.id !== variableId));
    variableId = null;
    syncVariable(true);
  });
  function syncVariable(force = false) {
    if (pending.has("variable") && !force) return;
    const v = variables().find((v) => v.id === variableId);
    if (!v && variableId) variableId = null;
    choices(
      "mo-var-select",
      variables().map((v) => [v.id, v.name]),
      "새 데이터 만들기",
    );
    set("mo-var-select", variableId || "");
    if (!v && !force && $("mo-var-options").children.length) return;
    set("mo-var-name", v?.name || "연도");
    variableRows(v?.options || defaultVariable().options);
    set("mo-var-initial", v?.initialValue || "2025");
  }
  function bindingRows(variable, binding) {
    const v = variables().find((v) => v.id === variable);
    $("mo-bind-values").innerHTML = (v?.options || [])
      .map(
        (o) =>
          `<label class="mo-binding-row"><span>${escape(o.label)}</span><input data-bind-value="${escape(o.value)}" aria-label="${escape(o.label)}에 표시할 내용" value="${escape(binding?.values.find((row) => row.value === o.value)?.text ?? o.label)}" maxlength="65536"></label>`,
      )
      .join("");
  }
  $("mo-bind-var").addEventListener("change", () =>
    bindingRows(get("mo-bind-var")),
  );
  function applyBinding() {
    const e = requireElement();
    if (!e.text) throw new Error("텍스트나 글자가 있는 도형을 선택하세요.");
    const variableId = get("mo-bind-var");
    if (!variableId)
      throw new Error("연결할 데이터를 먼저 저장하고 선택하세요.");
    if(e.binding?.formula&&get('mo-bind-format')!=='number')throw new Error('계산 연동은 숫자 형식입니다. 동작 확장 탭에서 계산을 해제한 뒤 형식을 바꾸세요.');
    store.setBinding(e.id, {
      ...(e.binding?.formula?{formula:cloneDocument(e.binding.formula)}:{}),
      variableId,
      values: [
        ...$("mo-bind-values").querySelectorAll("[data-bind-value]"),
      ].map((field) => ({ value: field.dataset.bindValue, text: field.value })),
      prefix: get("mo-bind-prefix"),
      suffix: get("mo-bind-suffix"),
      format: get("mo-bind-format"),
      animate: $("mo-bind-animate").checked,
    });
    pending.delete("binding");
  }
  bind("mo-bind-apply", applyBinding);
  bind("mo-bind-clear", () => store.setBinding(requireElement().id, null));

  function mark(kind, event) {
    if (syncing) return;
    if (kind === "motion" && !motionId) return;
    if (kind === "interaction" && !interactionId) return;
    if (kind === "variable" && !variableId) return;
    if (kind === "component" && !chosen()?.component) return;
    if (kind === "binding" && !chosen()?.text) return;
    pending.add(kind);
    formContext = {
      sessionId: store.sessionId,
      slideId: store.activeSlideId,
      elementId: store.selectedId,
    };
    cancel.hidden = false;
    updateStatus();
  }
  const fieldKinds = {
    motion: [
      "mo-preset",
      "mo-start",
      "mo-duration",
      "mo-delay",
      "mo-easing",
      "mo-iterations",
    ],
    transition: [
      "mo-transition",
      "mo-transition-duration",
      "mo-transition-easing",
      "mo-auto",
      "mo-advance-after",
    ],
    interaction: [
      "mo-interaction-source",
      "mo-interaction-event",
      "mo-interaction-action",
      "mo-interaction-target",
      "mo-action-value",
    ],
    variable: ["mo-var-name", "mo-var-initial"],
    component: [
      "mo-component-var",
      "mo-panel-open",
      "mo-panel-dim",
      "mo-panel-placement",
    ],
    binding: [
      "mo-bind-var",
      "mo-bind-prefix",
      "mo-bind-suffix",
      "mo-bind-format",
      "mo-bind-animate",
    ],
  };
  for (const [kind, fields] of Object.entries(fieldKinds))
    for (const id of fields)
      for (const type of ["input", "change"])
        $(id).addEventListener(type, (e) => mark(kind, e));
  $("mo-var-options").addEventListener("input", (e) => mark("variable", e));
  $("mo-bind-values").addEventListener("input", (e) => mark("binding", e));
  function commitPending() {
    if (formContext && formContext.sessionId !== store.sessionId) {
      pending.clear();
      return;
    }
    for (const kind of [...pending])
      ({
        motion: applyMotion,
        transition: applyTransition,
        interaction: applyInteraction,
        variable: applyVariable,
        component: applyComponent,
        binding: applyBinding,
      })[kind]();
    cancel.hidden = !pending.size;
  }
  function sync(force = false) {
    if (syncing) return;
    syncing = true;
    try {
      const changedSession = session !== store.sessionId,
        changedSlide = slideId !== store.activeSlideId,
        changedSelection = selectedId !== store.selectedId;
      if (changedSession) {
        pending.clear();
        motionId = null;
        interactionId = null;
        variableId = null;
        force = true;
      }
      if (changedSlide) {
        motionId = null;
        interactionId = null;
      }
      session = store.sessionId;
      slideId = store.activeSlideId;
      selectedId = store.selectedId;
      if (motionId && !motions().some((m) => m.id === motionId))
        motionId = null;
      const selectedMotion = motions().find((m) => m.id === motionId);
      if (selectedMotion && !pending.has("motion"))
        for (const key of [
          "preset",
          "start",
          "duration",
          "delay",
          "easing",
          "iterations",
        ])
          set(`mo-${key}`, selectedMotion[key]);
      $("mo-update").disabled = !selectedMotion;
      $("mo-add").disabled = !store.selectedIds.length;
      syncMotionList();
      if (!pending.has("transition")) {
        const t = store.activeSlide.transition;
        set("mo-transition", t?.type || "none");
        set("mo-transition-duration", t?.duration ?? 500);
        set("mo-transition-easing", t?.easing || "ease");
        $("mo-auto").checked = store.activeSlide.advanceAfter !== undefined;
        set("mo-advance-after", store.activeSlide.advanceAfter ?? 5000);
      }
      const e = chosen(),
        component = e?.component;
      $("mo-initially-hidden").checked = e?.initiallyHidden === true;
      $("mo-initially-hidden").disabled = !e || e.locked === true;
      $("mo-component-properties").hidden = !component;
      $("mo-panel-properties").hidden = component?.kind !== "panel";
      $("mo-component-var").closest("label").hidden = ![
        "tabs",
        "select",
      ].includes(component?.kind);
      choices(
        "mo-component-var",
        variables().map((v) => [v.id, v.name]),
      );
      if (component && !pending.has("component")) {
        if (component.variableId) set("mo-component-var", component.variableId);
        $("mo-panel-open").checked = component.initiallyOpen === true;
        $("mo-panel-dim").checked = component.dim !== false;
        set("mo-panel-placement", component.placement || "right");
        $("mo-panel-content").textContent =
          `포함된 개체 ${(component.contentIds || []).length}개 · 편집 화면에서는 모두 보입니다.`;
      }
      const elementRows = store.activeSlide.elements.map((e) => [
        e.id,
        label(e.id),
      ]);
      choices("mo-interaction-source", elementRows);
      if (changedSelection && !pending.has("interaction") && e)
        set("mo-interaction-source", e.id);
      const rule = interactions().find((row) => row.id === interactionId),
        a = rule?.actions[actionIndex];
      if (rule && a && !pending.has("interaction")) {
        set("mo-interaction-source", rule.sourceId);
        set("mo-interaction-event", rule.event);
        set("mo-interaction-action", a.type);
        actionTargets();
        set("mo-interaction-target", a.targetId || a.motionId || a.variableId);
        actionTargets();
        if (a.value !== undefined) set("mo-action-value", a.value);
      } else actionTargets();
      $("mo-interaction-apply").disabled = !rule;
      const actionLabels = {
        show: "표시",
        hide: "숨김",
        toggle: "표시 전환",
        openPanel: "패널 열기",
        closePanel: "패널 닫기",
        goToSlide: "슬라이드 이동",
        playMotion: "효과 재생",
        setVariable: "데이터 변경",
        setState: "모양 적용",
        resetState: "기본 모양 복귀",
      };
      $("mo-interaction-list").innerHTML = interactions()
        .flatMap((row) =>
          row.actions.map(
            (a, i) =>
              `<div class="mo-action-row${row.id === interactionId && i === actionIndex ? " active" : ""}" data-interaction-id="${escape(row.id)}"><button data-interaction-select="${escape(row.id)}" data-action-index="${i}"><strong>${escape(label(row.sourceId))}</strong><span>${escape({ click: "클릭", hover: "포인터 진입", leave:"포인터 이탈", focus: "포커스", blur:"포커스 이탈", change: "선택 변경",key:"지정 키",scroll:"휠",inView:"화면 진입" }[row.event]||row.event)} → ${escape(actionLabels[a.type] || a.type)} · ${escape(a.targetId ? label(a.targetId) : a.motionId || variables().find((v) => v.id === a.variableId)?.name || "")}${row.condition?' · 조건':''}</span></button><button data-interaction-delete="${escape(row.id)}" data-action-index="${i}" aria-label="동작 삭제">×</button></div>`,
          ),
        )
        .join("");
      syncVariable(force);
      const previousBind = get("mo-bind-var");
      choices(
        "mo-bind-var",
        variables().map((v) => [v.id, v.name]),
      );
      if (!pending.has("binding")) {
        set("mo-bind-var", e?.binding?.variableId || previousBind);
        const nextBindingKey = JSON.stringify({
          id: e?.id,
          binding: e?.binding,
          variable: variables().find((v) => v.id === get("mo-bind-var")),
        });
        if (
          changedSelection ||
          changedSession ||
          force ||
          nextBindingKey !== bindingKey ||
          !$("mo-bind-values").children.length
        )
          bindingRows(get("mo-bind-var"), e?.binding);
        bindingKey = nextBindingKey;
        set("mo-bind-prefix", e?.binding?.prefix || "");
        set("mo-bind-suffix", e?.binding?.suffix || "");
        set("mo-bind-format", e?.binding?.format || "text");
        $("mo-bind-animate").checked = e?.binding?.animate !== false;
      }
      $("mo-bind-apply").disabled = !e?.text;
      $("mo-bind-clear").disabled = !e?.binding;
      cancel.hidden = !pending.size;
    } finally {
      syncing = false;
    }
  }
  variableRows(defaultVariable().options);
  sync(true);
  return {
    sync,
    commitPending,
    get pendingChanges() {
      return pending.size > 0;
    },
    draftSignature() {
      return pending.size
        ? JSON.stringify({
            kinds: [...pending],
            context: formContext,
            values: [
              ...motionPage.querySelectorAll("input,select"),
              ...interactionPage.querySelectorAll("input,select"),
            ].map((n) => [n.id, n.value, n.checked]),
          })
        : null;
    },
    cancelPending() {
      if (document.activeElement?.closest("#mo-motion,#mo-interaction"))
        document.activeElement.blur();
      pending.clear();
      sync(true);
      updateStatus();
    },
  };
}
