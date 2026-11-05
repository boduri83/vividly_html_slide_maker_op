import { cloneDocument, createBlankDocument, normalizeDocument } from './model.js';
import { CommandController } from './controller.js';
import { CONTENT_CSS, renderSlideContent, resolveElementAppearance, renderPresentationSlides, isPresetShape, presetShapeTextInsets, presetShapeEditorBackground, updatePresetShapeAppearance } from './render.js';
import { createWorkbench } from './workbench-ui.js';
import { createMotionWorkbench } from './motion-ui.js';
import { createBusinessWorkbench } from './business-ui.js';
import { createKitPicker } from './kit-picker-ui.js';
import { createReuseLibraryUI } from './reuse-library-ui.js';
import { createResponsiveWorkbench } from './responsive-ui.js';
import { projectResponsiveSlide } from './responsive-model.js';
import { createWebRuntime } from './web-authoring-runtime.js';
import { createComponentLibraryUI } from './component-library-ui.js';
import { createWebAuthoringUI } from './web-authoring-ui.js';
import { createTimelineWorkbench } from './timeline-ui.js';
import { createAdvancedInteractionWorkbench } from './advanced-interaction-ui.js';
import { createAuthoringStart } from './authoring-start.js';
import { createProductivityWorkbench } from './productivity-ui.js';
import { createRibbon } from './ribbon-ui.js';
import {createBehaviorStudio}from './behavior-studio-ui.js';
import {createSceneStudio}from './scene-studio-ui.js';
import{createAvatarUI}from './avatar-ui.js';
import{createDataConnectorUI}from './data-connector-ui.js';
import{createAgentIOPermissionsUI}from './agent-io-permissions-ui.js';
import{createAgentIOEditor}from './agent-io-editor.js';
import {createSceneRuntime}from './scene-runtime.js';
import {installScenePhysics}from './scene-vendor.js';
import {createBehaviorRuntime}from './behavior-runtime.js';
import {createBehaviorEvaluator}from './behavior-model.js';
import { resolveDesignElement,resolveFlowSlide } from './design-model.js';
import { createShapeGallery } from './shape-gallery-ui.js';
import { createDrawingWorkbench } from './drawing-ui.js';
import { createIconGallery } from './icon-gallery-ui.js';
import { SHAPE_DEFINITIONS } from './shapes.js';
import { createSystemFonts } from './system-fonts-ui.js';
import { createMasterWorkbench } from './master-ui.js';
import { createLayoutPlaceholderWorkbench } from './layout-placeholder-ui.js';
import { createSlideNavigator } from './slide-navigator-ui.js';
import { createCssStudio } from './css-studio-ui.js';
import { createInteractiveStudioWorkbench } from './interactive-studio-ui.js';
import { installChartJs } from './chart-vendor.js';
import { createChartRuntime } from './chart-runtime.js';
import { fontStack } from './font-names.js';
import { createMasterWorkspace } from './master-workspace-ui.js';
import { createTextFormatWorkbench,readPlainTextSelection } from './text-format-ui.js';
import { createMediaWorkbench } from './media-ui.js';
import { createMediaRuntime } from './media-runtime.js';
import { createAlignmentGuides } from './alignment-guides-ui.js';
import { resolveConnectorGeometry } from './business-model.js';
import { connectorContent } from './business-render.js';
import { createPresentationRuntime, PRESENTATION_RUNTIME_CSS } from './presentation-runtime.js';
import { createRichTextEditor } from './rich-text-editor.js';
import { exportPresentation, parsePresentation, validateAssetBytes } from './format.js';
import {createPublicSupport} from './public-support-ui.js';

const $ = id => document.getElementById(id);
const contentStyle = document.createElement('style');
contentStyle.textContent = CONTENT_CSS + PRESENTATION_RUNTIME_CSS;
document.head.append(contentStyle);
let workbench = null;
let motionWorkbench = null;
let businessWorkbench = null;
let kitPicker=null,reuseLibrary=null;
let responsiveWorkbench=null,componentLibraryUI=null,webAuthoringUI=null;
let timelineWorkbench = null;
let advancedInteractionWorkbench = null;
let authoringStart = null;
let productivityWorkbench = null;
let ribbon = null;
let shapeGallery = null;
let drawingWorkbench = null;
let iconGallery = null;
let systemFonts=null,masterWorkbench=null,masterWorkspace=null,textFormats=null,mediaWorkbench=null,alignmentGuides=null,slideNavigator=null,cssStudio=null,interactiveStudio=null,editorCharts=null,layoutPlaceholders=null,layoutImageTarget=null,behaviorStudio=null,sceneStudio=null,avatarUI=null,dataConnectorUI=null,agentIOUI=null;
installChartJs();globalThis.createVividlyChartRuntime=createChartRuntime;globalThis.createVividlyMediaRuntime=createMediaRuntime;
globalThis.projectVividlyResponsiveSlide=projectResponsiveSlide;globalThis.createVividlyWebRuntime=createWebRuntime;
let outputRequests = 0;
let richEditor = null;
let richEditorSession = null;
document.addEventListener('keydown',event=>{if(masterWorkspace?.active){masterWorkspace.handleKeydown(event);event.stopImmediatePropagation();}},true);
const store = new CommandController(undefined, { activityProvider: readUiActivity });
const desktop = window.htmlSlideDesktop || null;
let initializing = true;
let desktopRequests = 0;
let desktopFile = null;
let lastDesktopState = '';
let scale = 1;
let gesture = null;
let lastCanvasClick = null;
let live = null;
let externalComposing = false;
let openGeneration = 0;
const readyQueue = [];
const saveQueues = new Map();
const propertyHandlers = new Map();
const propertyContexts = new Map();
const colorProperties = new Set(['property-fill', 'property-stroke', 'property-text-color', 'property-slide-background']);
let activeColorControl = null;
let colorRenderPending = false;
let titleSessionId = store.sessionId;
const stage = $('stage');
const editor = $('text-editor');
const editableTarget = target => target instanceof Element && !!target.closest('input,textarea,select,[contenteditable="true"]');

function notice(message, error = false) {
  $('status-message').textContent = message;
  $('status-message').classList.toggle('error', error);
}
function composing() { return externalComposing || Boolean(store.textSession?.composing); }
function whenReady(fn, waitGeometry = false) {
  if (composing() || (waitGeometry && store.transformSession)) {
    notice(composing() ? '입력 조합이 끝나면 요청을 처리합니다.' : '개체 조작이 끝나면 HTML을 만듭니다.');
    return new Promise((resolve, reject) => readyQueue.push({ fn, resolve, reject, sessionId: store.sessionId, waitGeometry }));
  }
  try { return Promise.resolve(fn()); } catch (error) { return Promise.reject(error); }
}
function flushReady() {
  while (readyQueue.length) {
    const next = readyQueue[0];
    if (composing() || (next.waitGeometry && store.transformSession)) break;
    readyQueue.shift();
    if (next.sessionId !== store.sessionId) { next.reject(new Error('문서가 바뀌어 이전 요청을 취소했습니다.')); continue; }
    try { next.resolve(next.fn()); } catch (error) { next.reject(error); }
  }
  if (desktop) updateStatus();
}
function cancelGesture() {
  if (workbench?.dragging) { workbench.cancel(); return; }
  if (!store.transformSession) return;
  const pointerId = gesture?.pointerId;
  const captureElement = gesture?.captureElement;
  gesture = null;
  store.cancelTransform();
  if (pointerId !== undefined && captureElement?.hasPointerCapture(pointerId)) captureElement.releasePointerCapture(pointerId);
  render();
  flushReady();
}
async function action(fn) {
  if(masterWorkspace?.active&&!masterWorkspace.executing){notice('마스터 편집을 적용하거나 닫은 뒤 실행하세요.');return;}

  lastCanvasClick = null;
  cancelGesture();
  try {
    return await whenReady(() => {
      commitFocusedControls();
      store.finishText();
      const result = fn();
      render();
      flushReady();
      return result;
    });
  } catch (error) { render(); updateProperties(true); notice(error.message, true); return undefined; }
}
function commitTitle(value = $('document-title').value, sessionId = titleSessionId) {
  if (sessionId !== store.sessionId) return;
  if (value !== store.document.title) store.setTitle(value);
}
function captureProperty(field) {
  const context = propertyContexts.get(field.id);
  return context ? { ...context, contextToken: context, fieldId: field.id, raw: field.value } : null;
}
function samePropertyTarget(first, second) {
  return !!first && !!second && first.elementId === second.elementId && first.slideId === second.slideId && JSON.stringify(first.elementIds||[])===JSON.stringify(second.elementIds||[]);
}
function currentPropertyTarget(context) {
  return context?.sessionId === store.sessionId && (context.slideId
    ? context.slideId === store.activeSlideId : context.elementId === store.selectedId && (!context.elementIds || JSON.stringify(context.elementIds)===JSON.stringify(store.selectedIds)));
}
function applyProperty(captured) {
  if (!captured || captured.sessionId !== store.sessionId) return;
  const current = propertyContexts.get(captured.fieldId);
  if (colorProperties.has(captured.fieldId) && current !== captured.contextToken) return;
  const sameContext = current?.sessionId === captured.sessionId && samePropertyTarget(current, captured);
  if (sameContext && captured.inputVersion < current.inputVersion) return;
  if (captured.raw === captured.committedRaw) {
    if (sameContext && current.pendingRaw === captured.raw) delete current.pendingRaw;
    return;
  }
  if (current?.committedRaw === captured.raw && samePropertyTarget(current, captured)) return;
  if(captured.elementIds?.length>1 && !captured.slideId){
    const commands=captured.elementIds.flatMap(elementId=>propertyCommand(captured.fieldId,elementId,captured.raw)||[]);
    if(commands.length)store.runBatch(commands,'선택한 개체 속성');
  }else propertyHandlers.get(captured.fieldId)?.(captured.slideId ?? captured.elementId, captured.raw);
  if (sameContext) {
    current.committedRaw = captured.raw;
    if (current.pendingRaw === captured.raw) delete current.pendingRaw;
  }
}
function propertyCommand(fieldId,elementId,raw){
  const element=store.activeSlide.elements.find(e=>e.id===elementId);if(!element)return null;
  const wrap=(id,params)=>({id,params:{elementId,...params}});
  const geometry={ 'property-x':'x','property-y':'y','property-width':'width','property-height':'height' };
  if(geometry[fieldId])return element.type==='connector'?null:wrap('element.set_geometry',{geometry:{[geometry[fieldId]]:Number(raw)}});
  const text={'property-font-family':'fontFamily','property-font-size':'fontSize','property-text-color':'color','property-align':'align','property-line-height':'lineHeight','property-vertical-align':'verticalAlign'};
  if(text[fieldId]&&element.text)return wrap('text.set_style',{style:{[text[fieldId]]:['fontSize','lineHeight'].includes(text[fieldId])?Number(raw):raw}});
  if(element.type==='shape'){
    if(fieldId==='property-fill')return solidFillCommands(elementId,raw);
    if(fieldId==='property-shape')return wrap('shape.set_kind',{shape:raw});
    if(fieldId==='property-stroke')return wrap('shape.set_stroke',{stroke:{color:raw}});
    if(fieldId==='property-stroke-width')return wrap('shape.set_stroke',{stroke:{width:Number(raw)}});
  }
  if(element.type==='connector'&&['property-stroke','property-stroke-width'].includes(fieldId))return wrap('connector.set_data',{connector:{...element.connector,stroke:{...element.connector.stroke,...(fieldId==='property-stroke'?{color:raw}:{width:Number(raw)})}}});
  if(element.type==='image'&&['property-image-fit','property-image-alt'].includes(fieldId))return wrap('image.set_properties',{properties:{[fieldId==='property-image-fit'?'fit':'alt']:raw}});
  return null;
}
function solidFillCommands(elementId,fill){
  const element=store.activeSlide.elements.find(item=>item.id===elementId);
  if(element?.type!=='shape')return [];
  return [{id:'shape.set_fill',params:{elementId,fill}},...(element.style?.gradient?[{id:'element.set_style',params:{elementId,style:{gradient:null}}}]:[])];
}
function setOutline(elementId,stroke){const element=store.activeSlide.elements.find(e=>e.id===elementId);if(element?.type==='connector')store.setConnector(elementId,{...element.connector,stroke:{...element.connector.stroke,...stroke}});else store.setStroke(elementId,stroke);}
function commitPendingColors() {
  for (const id of colorProperties) {
    const context = propertyContexts.get(id);
    if (context?.sessionId === store.sessionId && $(id).value !== context.committedRaw) applyProperty(captureProperty($(id)));
  }
}
function commitFocusedControls() {
  const revision = store.revision;
  workbench?.commitPending?.();
  motionWorkbench?.commitPending?.();
  businessWorkbench?.commitPending?.();
  timelineWorkbench?.commitPending?.();
  advancedInteractionWorkbench?.commitPending?.();
  behaviorStudio?.commitPending?.();
  sceneStudio?.commitPending?.();
  interactiveStudio?.commitPending?.();
  cssStudio?.commitPending?.();
  responsiveWorkbench?.commitPending?.();
  webAuthoringUI?.commitPending?.();
  mediaWorkbench?.commitPending?.();
  commitPendingColors();
  const field = document.activeElement;
  if (field === $('document-title')) commitTitle(field.value, titleSessionId);
  else if (field?.id && propertyHandlers.has(field.id)) applyProperty(captureProperty(field));
  return revision !== store.revision;
}
function pendingControlValues() {
  return [...propertyContexts].flatMap(([fieldId, context]) => context.sessionId === store.sessionId
    && $(fieldId).value !== context.committedRaw ? [{ fieldId, elementId: context.elementId, raw: $(fieldId).value }] : []);
}
function hasPendingChanges() {
  return store.isDirty || Boolean(workbench?.pendingChanges) || Boolean(motionWorkbench?.pendingChanges) || Boolean(businessWorkbench?.pendingChanges) || Boolean(timelineWorkbench?.pendingChanges) || (Boolean(advancedInteractionWorkbench?.pendingChanges)||(Boolean(behaviorStudio?.pendingChanges)||Boolean(sceneStudio?.pendingChanges))) || Boolean(interactiveStudio?.pendingChanges) || Boolean(cssStudio?.pendingChanges) || Boolean(responsiveWorkbench?.pendingChanges) || Boolean(webAuthoringUI?.pendingChanges) || Boolean(mediaWorkbench?.pendingChanges) || Boolean(masterWorkspace?.pendingChanges) || (titleSessionId === store.sessionId && $('document-title').value !== store.document.title) || pendingControlValues().length > 0;
}
function readUiActivity() {
  // Read metadata only. Never flush controls, wait for IME, render, focus, or return raw values.
  const active = document.activeElement, controls = [];
  const titlePending = titleSessionId === store.sessionId && $('document-title').value !== store.document.title;
  if (titleSessionId === store.sessionId && (active === $('document-title') || titlePending)) controls.push({ fieldId: 'document-title' });
  let propertyPending = false;
  for (const [fieldId, context] of propertyContexts) {
    if (context.sessionId !== store.sessionId) continue;
    const pending = $(fieldId).value !== context.committedRaw;
    propertyPending ||= pending;
    if (active === $(fieldId) || pending) controls.push({ fieldId, elementId: context.elementId, slideId: context.slideId });
  }
  // Native popups may blur into an OS surface without a DOM focus destination. Keep a conservative
  // activity lease until the user explicitly focuses/clicks another DOM control, even with no value change.
  const colorContext = activeColorControl && propertyContexts.get(activeColorControl.fieldId);
  if (activeColorControl?.sessionId === store.sessionId && samePropertyTarget(colorContext, activeColorControl))
    controls.push({ fieldId: activeColorControl.fieldId, elementId: activeColorControl.elementId, slideId: activeColorControl.slideId });
  const workbenchActivity = workbench?.activity?.();
  if (workbenchActivity?.active) controls.push({ fieldId: 'workbench-properties', elementId: store.selectedId });
  if (workbenchActivity?.colorActive) controls.push({ fieldId:'workbench-color', elementId:store.selectedId });
  if (motionWorkbench?.pendingChanges) controls.push({fieldId:'workbench-properties',elementId:store.selectedId});
  if (businessWorkbench?.pendingChanges || businessWorkbench?.activity?.().active) controls.push({fieldId:'business-properties',elementId:store.selectedId});
  if (authoringStart?.busy || productivityWorkbench?.busy || kitPicker?.busy) controls.push({fieldId:'workbench-properties',elementId:store.selectedId});
  if (shapeGallery?.busy) controls.push({fieldId:'workbench-properties',elementId:store.selectedId});
  if (iconGallery?.busy || drawingWorkbench?.busy) controls.push({fieldId:'workbench-properties',elementId:store.selectedId});
  if(masterWorkspace?.active||textFormats?.busy||mediaWorkbench?.busy||mediaWorkbench?.pendingChanges)controls.push({fieldId:'workspace-properties',elementId:store.selectedId});
  if(masterWorkbench?.busy||slideNavigator?.busy||cssStudio?.busy||interactiveStudio?.busy||interactiveStudio?.pendingChanges||cssStudio?.pendingChanges)controls.push({fieldId:'studio-properties',elementId:store.selectedId});
  if (timelineWorkbench?.pendingChanges) controls.push({fieldId:'timeline-properties',elementId:store.selectedId});
  if (advancedInteractionWorkbench?.pendingChanges) controls.push({fieldId:'interaction-properties',elementId:store.selectedId});
  if(responsiveWorkbench?.busy||responsiveWorkbench?.pendingChanges||webAuthoringUI?.busy||webAuthoringUI?.pendingChanges)controls.push({fieldId:'studio-properties',elementId:store.selectedId});
  if(behaviorStudio?.busy||behaviorStudio?.pendingChanges||sceneStudio?.busy||sceneStudio?.pendingChanges)controls.push({fieldId:'studio-properties',elementId:store.selectedId});
  return { controls, pendingChanges: titlePending || propertyPending || workbenchActivity?.pending === true || Boolean(motionWorkbench?.pendingChanges) || Boolean(businessWorkbench?.pendingChanges) || Boolean(timelineWorkbench?.pendingChanges) || (Boolean(advancedInteractionWorkbench?.pendingChanges)||(Boolean(behaviorStudio?.pendingChanges)||Boolean(sceneStudio?.pendingChanges))) || Boolean(interactiveStudio?.pendingChanges) || Boolean(cssStudio?.pendingChanges) || Boolean(responsiveWorkbench?.pendingChanges) || Boolean(webAuthoringUI?.pendingChanges) || Boolean(mediaWorkbench?.pendingChanges) || Boolean(masterWorkspace?.pendingChanges), composing: externalComposing,
    initializing, libraryImport:Boolean(reuseLibrary?.busy), componentLibrary:Boolean(componentLibraryUI?.busy), saving: saveQueues.size > 0 || outputRequests > 0, opening: desktopRequests > 0, pendingAction: readyQueue.length > 0 };
}
function changeToken() {
  return JSON.stringify({ sessionId: store.sessionId, document: effectiveDocument(),
    title: $('document-title').value, properties: pendingControlValues(), workbench: workbench?.draftSignature?.(),motion:motionWorkbench?.draftSignature?.(),business:businessWorkbench?.draftSignature?.(),timeline:timelineWorkbench?.draftSignature?.(),behavior:advancedInteractionWorkbench?.draftSignature?.(),logic:behaviorStudio?.draftSignature?.(),scene:sceneStudio?.draftSignature?.(),web:interactiveStudio?.draftSignature?.(),css:cssStudio?.draftSignature?.(),media:mediaWorkbench?.draftSignature?.(),master:masterWorkspace?.draftSignature?.(),responsive:responsiveWorkbench?.draftSignature?.(),webAuthoring:webAuthoringUI?.draftSignature?.() });
}
function checkOpenToken(token) {
  if (token !== changeToken()) throw new Error('파일을 읽는 동안 현재 자료가 바뀌었습니다. 변경을 보관한 뒤 파일을 다시 열어 주세요.');
}
function effectiveDocument({designPreview=false}={}) {
  const doc = cloneDocument(store.document);
  for (const slide of doc.slides) for (const element of slide.elements) {
    if (store.textSession?.elementId === element.id) element.text = cloneDocument(store.textSession.draft);
    if (store.transformSession?.previews) { const preview=store.transformSession.previews.find(p=>p.elementId===element.id); if(preview){ element.geometry=cloneDocument(preview.geometry); if(preview.rotation!==undefined)element.rotation=preview.rotation; } } else if (store.transformSession?.elementId === element.id) element.geometry = cloneDocument(store.transformSession.preview);
  }
  if(store.transformSession)doc.slides=doc.slides.map(slide=>slide.elements.some(e=>e.flow)?resolveFlowSlide(slide):slide);
  if(designPreview){
    const preview=cssStudio?.getPreview?.();
    if(preview?.tokens)doc.styleTokens=cloneDocument(preview.tokens);
    const merge=(base,patch)=>{const out=cloneDocument(base||{});for(const[k,v]of Object.entries(patch||{}))out[k]=v&&typeof v==='object'&&!Array.isArray(v)?merge(out[k],v):cloneDocument(v);return out;};
    if(preview)for(const slide of doc.slides)for(const element of slide.elements)if(preview.elementIds.includes(element.id)){
      element.__designPreviewState=preview.state||'base';
      const appearance=preview.elementAppearances?.[element.id]||preview.appearance;
      if(appearance){element.design||={};if(preview.state&&preview.state!=='base'){element.design.states||={};element.design.states[preview.state]=merge(element.design.states[preview.state],appearance);}else element.design.overrides=merge(element.design.overrides,appearance);}
    }
  }
  return doc;
}
function titleForSlide(slide) {
  return slide.elements.find(element => element.text?.paragraphs.some(Boolean))?.text.paragraphs.find(Boolean) || '빈 슬라이드';
}
function updateStatus() {
  if($('rt-open'))$('rt-open').disabled=!store.selectedElement||!['text','shape'].includes(store.selectedElement.type)||store.selectedElement.locked===true||composing();
  if (titleSessionId !== store.sessionId || document.activeElement !== $('document-title')) {
    $('document-title').value = store.document.title; titleSessionId = store.sessionId;
  }
  const dirty = hasPendingChanges();
  $('dirty-indicator').textContent = dirty ? (desktop ? '변경 내용 있음 · 저장하세요' : '변경 내용 있음 · HTML로 보관하세요') : '현재 내용에 변경 없음';
  $('dirty-indicator').classList.toggle('dirty', dirty);
  $('undo-button').disabled = !store.canUndo;
  $('redo-button').disabled = !store.canRedo;
  $('history-summary').textContent = `실행 취소 ${store.undoCount} · 다시 실행 ${store.redoCount}`;
  $('mode-hint').textContent = store.textSession
    ? (store.textSession.composing ? '문자를 조합하고 있습니다.' : 'Enter 줄바꿈 · Ctrl+Enter 새 문단 · Esc 편집 종료')
    : '개체를 선택해 이동하고, 텍스트는 두 번 눌러 편집하세요.';
  if (desktop) {
    const file = desktopFile?.sessionId === store.sessionId ? desktopFile : null;
    $('desktop-file-name').textContent = file?.name || '아직 저장하지 않은 자료';
    $('desktop-file-name').title = file?.path || '';
    const state = { sessionId: store.sessionId, documentId:store.document.id, title: String($('document-title').value || store.document.title).slice(0, 160), dirty,
      busy: initializing || desktopRequests > 0 || saveQueues.size > 0 || outputRequests > 0 || readyQueue.length > 0 || Boolean(store.transformSession) || Boolean(reuseLibrary?.busy) || Boolean(kitPicker?.busy) || Boolean(componentLibraryUI?.busy) || Boolean(responsiveWorkbench?.busy) || Boolean(webAuthoringUI?.busy),
      composing: composing() };
    const signature = JSON.stringify(state);
    if (signature !== lastDesktopState) { desktop.setDocumentState(state); lastDesktopState = signature; }
  }
  ribbon?.sync();
}
function renderThumbnails() {
  const doc = effectiveDocument();
  const list = $('slide-list');
  list.replaceChildren();
  const width = window.innerWidth <= 950 ? 116 : window.innerWidth <= 1200 ? 134 : 154;
  for (const [index, slide] of doc.slides.entries()) {
    const button = document.createElement('button');
    button.className = `slide-card${slide.id === store.activeSlideId ? ' active' : ''}`;
    button.dataset.slideId = slide.id;
    button.setAttribute('aria-label', `슬라이드 ${index + 1}: ${titleForSlide(slide)}`);
    button.setAttribute('aria-current', slide.id === store.activeSlideId ? 'true' : 'false');
    const frame = document.createElement('div'); frame.className = 'thumb-frame';
    const canvas = document.createElement('div'); canvas.className = 'thumb-canvas';
    canvas.style.cssText = `width:${doc.canvas.width}px;height:${doc.canvas.height}px;background:${slide.background};transform:scale(${(width - 2) / doc.canvas.width})`;
    canvas.innerHTML = renderSlideContent(slide, doc);
    frame.append(canvas);
    const label = document.createElement('div'); label.className = 'thumb-label';
    const number = document.createElement('span'); number.textContent = String(index + 1).padStart(2, '0');
    const caption = document.createElement('span'); caption.className = 'thumb-caption'; caption.textContent = (slide.section ? `${slide.section} · ` : '') + (slide.name || titleForSlide(slide));
    label.append(number, caption); button.append(frame, label);
    button.addEventListener('click', event => workbench ? workbench.onSlideClick(event, slide.id) : action(() => store.switchSlide(slide.id)));
    list.append(button);
  }
  $('slide-count').textContent = String(doc.slides.length);
  const index = doc.slides.findIndex(slide => slide.id === store.activeSlideId);
  $('current-slide-label').textContent = `슬라이드 ${index + 1} / ${doc.slides.length}`;
  $('slide-up').disabled = index === 0;
  $('slide-down').disabled = index === doc.slides.length - 1;
  $('delete-slide').disabled = doc.slides.length === 1;
}
function applyZoom() {
  const canvas = store.document.canvas;
  const viewport = $('stage-viewport');
  const value = $('zoom-select').value;
  scale = value === 'fit' ? Math.min((viewport.clientWidth - 88) / canvas.width, (viewport.clientHeight - 86) / canvas.height, 1.5) : Number(value) / 100;
  scale = Math.max(0.1, scale);
  store.setViewport({ mode: value === 'fit' ? 'fit' : 'fixed', scale });
  $('stage-holder').style.width = `${canvas.width * scale}px`;
  $('stage-holder').style.height = `${canvas.height * scale}px`;
  stage.style.width = `${canvas.width}px`; stage.style.height = `${canvas.height}px`;
  stage.style.transform = `scale(${scale})`;
  $('zoom-value').textContent = `${Math.round(scale * 100)}%`;
  $('canvas-summary').textContent = `${canvas.width} × ${canvas.height} · ${Math.round(scale * 100)}%`;
  if (store.selectedElement) updateOverlay();
  workbench?.syncEngine();
  drawingWorkbench?.sync();
  layoutPlaceholders?.sync();
}
function geometryStyle(node, geometry) {
  Object.assign(node.style, { left: `${geometry.x}px`, top: `${geometry.y}px`, width: `${geometry.width}px`, height: `${geometry.height}px` });
}
function updateOverlay() {
  if (workbench) { $('selection-overlay').hidden = true; return; }
  const selected = store.selectedElement;
  const overlay = $('selection-overlay');
  overlay.hidden = !selected || Boolean(store.textSession);
  if (!selected || store.textSession) return;
  const geometry = store.transformSession?.preview || selected.geometry;
  geometryStyle(overlay, geometry);
  overlay.style.borderWidth = `${1.5 / scale}px`;
  for (const handle of overlay.children) {
    handle.style.width = `${8 / scale}px`; handle.style.height = `${8 / scale}px`;
    handle.style.borderWidth = `${1.3 / scale}px`;
  }
}
function updateProperties(force = false) {
  const element = store.selectedElement?resolveDesignElement(store.selectedElement,store.document).element:null;
  $('empty-selection').hidden = !!element;
  $('property-controls').hidden = !element;
  $('selection-kind').textContent = element ? ({ text: '텍스트', shape: '도형', image: '이미지',table:'표',chart:'차트',connector:'연결선',svg:'SVG',video:'동영상' }[element.type]) : '선택 없음';
  $('duplicate-element').disabled = !element;
  $('delete-element').disabled = !element;
  const assign = (id, value, target = { elementId: element.id, elementIds: store.selectedIds }) => {
    const field = $(id);
    const context = propertyContexts.get(id);
    if (!force && context?.sessionId === store.sessionId && samePropertyTarget(context, target)
        && context.pendingRaw !== undefined && context.pendingRaw !== context.committedRaw) {
      field.value = context.pendingRaw;
      return;
    }
    if (force || (colorProperties.has(id) && (context?.pendingRaw === undefined || context.pendingRaw === context.committedRaw))
        || document.activeElement !== field || propertyContexts.get(id)?.sessionId !== store.sessionId
        || !samePropertyTarget(context, target)) {
      field.value = value;
      propertyContexts.set(id, { sessionId: store.sessionId, ...target, committedRaw: field.value,
        inputVersion: context?.sessionId === store.sessionId && samePropertyTarget(context, target) ? context.inputVersion || 0 : 0 });
    }
  };
  assign('property-slide-background', htmlColor(store.activeSlide.background), { slideId: store.activeSlideId });
  if (!element) {
    for (const id of propertyContexts.keys()) if (id !== 'property-slide-background') propertyContexts.delete(id);
    return;
  }
  const geometry = store.transformSession?.preview || element.geometry;
  const flowMember=store.activeSlide.elements.some(e=>e.flow?.children.includes(element.id));
  for (const name of ['x', 'y', 'width', 'height']) {
    const values=store.selectedIds.length>1?store.selectedElements.map(e=>Number(resolveDesignElement(e,store.document).element.geometry[name].toFixed(2))):[Number(geometry[name].toFixed(2))];
    const value=values.every(v=>v===values[0])?values[0]:'';
    assign(`property-${name}`,value);$(`property-${name}`).placeholder=value===''?'혼합':'';
    $(`property-${name}`).disabled=element.type==='connector'||flowMember;$(`property-${name}`).title=flowMember?'자동 배치 구성원입니다. 스타일의 자동 배치에서 순서·간격을 조절하거나 배치를 해제하세요.':'';
  }
  $('text-properties').hidden = !element.text;
  $('shape-properties').hidden = element.type !== 'shape';
  $('image-properties').hidden = element.type !== 'image';
  const appearance=resolveElementAppearance(element,store.document);
  if (element.text) {
    const style = {...element.text.textStyle,fontFamily:appearance.fontFamily,color:appearance.textColor};
    assign('property-font-family', style.fontFamily);
    assign('property-font-size', style.fontSize);
    assign('property-text-color', htmlColor(style.color));
    assign('property-align', style.align);
    assign('property-line-height', style.lineHeight);
    assign('property-vertical-align', style.verticalAlign);
    $('property-bold').setAttribute('aria-pressed', String(Boolean(style.bold)));
  }
  if (element.type === 'shape') {
    assign('property-fill', htmlColor(appearance.fill)); assign('property-stroke', htmlColor(element.stroke.color));
    assign('property-stroke-width', element.stroke.width); assign('property-shape', element.shape);
  }
  if(element.type==='connector'){assign('property-stroke',htmlColor(element.connector.stroke.color));assign('property-stroke-width',element.connector.stroke.width);}
  $('property-stroke-width').min=element.type==='connector'?'0.1':'0';
  if (element.type === 'image') { assign('property-image-fit', element.fit); assign('property-image-alt', element.alt); }
}
function htmlColor(color) {
  if (color.length === 4 || color.length === 5) return '#' + [...color.slice(1, 4)].map(char => char + char).join('');
  return color.slice(0, 7);
}
function render() {
  if(richEditor && store.textSession!==richEditorSession)disposeRichTextEditor();
  const doc = effectiveDocument({designPreview:true});
  const slide = doc.slides.find(item => item.id === store.activeSlideId);
  stage.style.background = slide.background;
  editorCharts?.destroy();
  $('slide-content').innerHTML = renderSlideContent(slide, doc, { interactive: true });
  editorCharts=createChartRuntime({root:$('slide-content'),document:doc,interactive:false,animate:false});editorCharts.sync({slideId:slide.id,animate:false});
  if (store.textSession) {
    const activeNode = [...$('slide-content').children].find(node => node.dataset.elementId === store.textSession.elementId);
    if (activeNode) setEditedSourceVisibility(activeNode,true);
  } else { editor.hidden = true; editor.replaceChildren(); }
  renderThumbnails();
  applyZoom(); updateOverlay(); updateProperties(); updateStatus();
  workbench?.sync();
  motionWorkbench?.sync();
  businessWorkbench?.sync();
  kitPicker?.sync();reuseLibrary?.sync();responsiveWorkbench?.sync();componentLibraryUI?.sync();webAuthoringUI?.sync();
  timelineWorkbench?.sync();
  advancedInteractionWorkbench?.sync();
  behaviorStudio?.sync();
  sceneStudio?.sync();
  dataConnectorUI?.sync();
  agentIOUI?.sync();
  authoringStart?.sync();
  productivityWorkbench?.sync();
  shapeGallery?.sync();
  drawingWorkbench?.sync();
  iconGallery?.sync();
  masterWorkbench?.sync();masterWorkspace?.sync();layoutPlaceholders?.sync();systemFonts?.sync();cssStudio?.sync();interactiveStudio?.sync();textFormats?.sync();mediaWorkbench?.sync();alignmentGuides?.sync();
  ribbon?.sync();
  if (live) renderLive();
}
for (const direction of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
  const handle = document.createElement('button');
  handle.dataset.resizeHandle = direction;
  handle.setAttribute('aria-label', `${direction} 방향 크기 조절`);
  handle.tabIndex = -1;
  $('selection-overlay').append(handle);
}
function resizeTextarea(textarea) {
  if (!store.textSession) return;
  textarea.style.height = '0px';
  const line = store.textSession.draft.textStyle.fontSize * store.textSession.draft.textStyle.lineHeight;
  textarea.style.minHeight = `${line}px`;
  textarea.style.height = `${Math.max(line, textarea.scrollHeight)}px`;
}
function readDraft() {
  if (!store.textSession) return;
  if(richEditor && store.textSession===richEditorSession){const {textStyle,...content}=richEditor.read();store.updateRichText(content);return;}
  store.updateText([...editor.querySelectorAll('textarea')].map(field => field.value));
}
function disposeRichTextEditor(){
  const previous=richEditor;richEditor=null;richEditorSession=null;previous?.destroy();
}
function setEditedSourceVisibility(node,editing){
  const text=node.querySelector('.element-shape-text');
  if(node.dataset.presetShape==='true'&&text){node.style.visibility='';text.style.visibility=editing?'hidden':'';}
  else node.style.visibility=editing?'hidden':'';
}
function textEditorShapeAppearance(element,appearance){
  if(element.type==='shape'&&isPresetShape(element.shape)){
    const inset=presetShapeTextInsets(element);
    return {background:'transparent',backgroundImage:'none',backgroundSize:'100% 100%',backgroundRepeat:'no-repeat',borderRadius:'0',boxShadow:'none',padding:`${inset.top}px ${inset.right}px ${inset.bottom}px ${inset.left}px`};
  }
  return {background:element.type==='shape'?appearance.background:store.activeSlide.background,backgroundImage:'none',backgroundSize:'auto',backgroundRepeat:'repeat',borderRadius:element.type==='shape'&&element.shape==='ellipse'?'50%':`${appearance.radius||0}px`,boxShadow:appearance.boxShadow,padding:element.type==='shape'?`${element.stroke.width}px`:'0'};
}
const editorDesignTextProperties=['color','font-family','font-size','font-weight','font-style','line-height','letter-spacing','word-spacing','text-align','text-transform','text-decoration','text-decoration-color','text-decoration-style','text-decoration-thickness','text-underline-offset','text-shadow','text-indent','white-space','overflow-wrap','word-break','writing-mode','text-orientation'];
function applyEditorDesignCss(node,appearance){for(const key of editorDesignTextProperties)if(appearance.css?.[key]!==undefined)node.style.setProperty(key,appearance.css[key]);}
function clearEditorDesignCss(){for(const key of editorDesignTextProperties)editor.style.removeProperty(key);}
function buildTextEditor(focusIndex=0,{rich=false}={}){
  const session=store.textSession;
  if(!session)return;
  const formatted=session.draft.runs!==undefined||session.draft.paragraphStyles!==undefined;
  if(!rich&&!formatted){disposeRichTextEditor();return buildPlainTextEditor(focusIndex);}
  if(richEditor&&richEditorSession===session){richEditor.focus();return;}
  disposeRichTextEditor();
  const element=store.selectedElement,appearance=resolveElementAppearance(element,store.document);
  const style={...session.draft.textStyle,...resolveDesignElement(element,store.document).element.text.textStyle,fontFamily:appearance.fontFamily,color:appearance.textColor};
  clearEditorDesignCss();editor.hidden=false;geometryStyle(editor,element.geometry);
  Object.assign(editor.style,{fontFamily:fontStack(style.fontFamily),fontSize:`${style.fontSize}px`,lineHeight:String(style.lineHeight),transform:`rotate(${element.rotation||0}deg)`,opacity:String(element.style?.opacity??1),color:style.color,
    ...textEditorShapeAppearance(element,appearance),fontWeight:'400',textAlign:style.align});
  richEditorSession=session;
  richEditor=createRichTextEditor({mount:editor,text:session.draft,style,
    onUpdate:text=>{if(store.textSession!==session)return;const {textStyle,...content}=text;store.updateRichText(content);updateStatus();renderThumbnails();},
    onComposition:value=>{if(store.textSession!==session)return;store.setComposing(value);updateStatus();if(!value)setTimeout(flushReady,0);},
    onFinish:()=>{if(store.textSession!==session)return;try{readDraft();store.finishText();render();stage.focus();notice('텍스트와 부분 서식을 확정했습니다.');flushReady();}catch(error){notice(error.message,true);}},
    onStatus:notice,onLayout:applyZoom});
  applyEditorDesignCss(editor,appearance);for(const node of editor.querySelectorAll('.tiptap'))applyEditorDesignCss(node,appearance);
  richEditor.focus();updateOverlay();updateStatus();
}
function buildPlainTextEditor(focusIndex = 0) {
  const session = store.textSession;
  if (!session) return;
  const element = store.selectedElement;
  const appearance = resolveElementAppearance(element,store.document);
  const style = {...session.draft.textStyle,...resolveDesignElement(element,store.document).element.text.textStyle,fontFamily:appearance.fontFamily,color:appearance.textColor};
  clearEditorDesignCss();editor.replaceChildren(); editor.hidden = false;
  geometryStyle(editor, element.geometry);
  Object.assign(editor.style, { fontFamily: fontStack(style.fontFamily), fontSize: `${style.fontSize}px`, lineHeight: String(style.lineHeight),
    transform: `rotate(${element.rotation||0}deg)`, opacity:String(element.style?.opacity??1),
    color: style.color, ...textEditorShapeAppearance(element,appearance),
    fontStyle:style.italic?'italic':'normal',textDecoration:[style.underline?'underline':'',style.strike?'line-through':''].filter(Boolean).join(' ')||'none',fontWeight: style.bold ? '700' : '400', textAlign: style.align });
  const paragraphs = session.draft.paragraphs.length ? session.draft.paragraphs : [''];
  const paragraphFields = document.createElement('div'); paragraphFields.className = 'paragraph-fields';
  const paragraphStack = document.createElement('div'); paragraphStack.className = 'paragraph-stack';
  paragraphStack.style.marginTop = style.verticalAlign === 'top' ? '0' : 'auto';
  paragraphStack.style.marginBottom = style.verticalAlign === 'bottom' ? '0' : 'auto';
  paragraphFields.append(paragraphStack); editor.append(paragraphFields);

  function updateParagraphIndices() {
    [...editor.querySelectorAll('textarea')].forEach((field, index) => {
      field.dataset.paragraphIndex = index;
      field.setAttribute('aria-label', `${index + 1}번째 문단 편집`);
    });
  }
  function insertParagraph(at) {
    if (store.textSession !== session) return;
    readDraft();
    const fields = [...editor.querySelectorAll('textarea')];
    at = Math.max(0, Math.min(fields.length, at));
    const next = [...session.draft.paragraphs];
    next.splice(at, 0, '');
    store.updateText(next);
    const field = createParagraphField('', at);
    paragraphStack.insertBefore(field, fields[at] || null);
    updateParagraphIndices(); resizeTextarea(field);
    field.focus(); field.setSelectionRange(0, 0);
    updateStatus(); renderThumbnails();
  }
  function createParagraphField(paragraph, index) {
    const textarea = document.createElement('textarea');
    textarea.dataset.paragraphIndex = index; textarea.value = paragraph; textarea.rows = 1;
    textarea.setAttribute('aria-label', `${index + 1}번째 문단 편집`);
    Object.assign(textarea.style, { fontFamily: fontStack(style.fontFamily), fontSize: `${style.fontSize}px`, lineHeight: String(style.lineHeight), color: style.color, textAlign: style.align, fontWeight: style.bold ? '700' : '400' });
    applyEditorDesignCss(textarea,appearance);
    textarea.addEventListener('input', () => { readDraft(); resizeTextarea(textarea); updateStatus(); renderThumbnails(); });
    textarea.addEventListener('compositionstart', () => { store.setComposing(true); updateStatus(); });
    textarea.addEventListener('compositionend', () => { readDraft(); store.setComposing(false); updateStatus(); setTimeout(flushReady, 0); });
    textarea.addEventListener('keydown', event => {
      if (event.isComposing || store.textSession?.composing) return;
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault(); event.stopPropagation();
        insertParagraph(Number(textarea.dataset.paragraphIndex) + 1);
      } else if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation();
        try {
          store.finishText(); render(); stage.focus(); notice('텍스트를 확정하고 개체 선택으로 돌아왔습니다.'); flushReady();
        } catch (error) { notice(error.message, true); }
      }
    });
    return textarea;
  }
  paragraphs.forEach((paragraph, index) => {
    const field = createParagraphField(paragraph, index);
    paragraphStack.append(field); resizeTextarea(field);
  });
  const actions = document.createElement('div'); actions.className = 'paragraph-actions';
  const add = document.createElement('button'); add.textContent = '+ 문단'; add.addEventListener('click', () => whenReady(() => {
    insertParagraph(editor.querySelectorAll('textarea').length);
  }).catch(error => notice(error.message, true)));
  const done = document.createElement('button'); done.textContent = '편집 완료'; done.addEventListener('click', () => action(() => stage.focus()));
  for (const button of [add, done]) button.addEventListener('pointerdown', event => event.preventDefault());
  actions.append(add, done); editor.append(actions);
  const field = editor.querySelector(`textarea[data-paragraph-index="${focusIndex}"]`) || editor.querySelector('textarea');
  field.focus(); field.setSelectionRange(field.value.length, field.value.length);
  updateOverlay();
}
function beginText(id,{rich=false}={}) {
  store.beginText(id); render(); buildTextEditor(0,{rich}); updateStatus();
}
const richTextLauncher=document.createElement('button');richTextLauncher.id='rt-open';richTextLauncher.textContent='부분 서식';richTextLauncher.title='선택 문자·목록·링크를 편집합니다';richTextLauncher.disabled=true;
$('add-text').after(richTextLauncher);richTextLauncher.addEventListener('pointerdown',event=>event.preventDefault());
richTextLauncher.addEventListener('click',()=>action(()=>{const element=store.selectedElement;if(!element||!['text','shape'].includes(element.type))throw new Error('텍스트나 도형을 먼저 선택하세요.');beginText(element.id,{rich:true});}));

async function saveTo(adapter) {
  const captured = await whenReady(() => {
    if (commitFocusedControls()) render();
    commitTitle();
    const snapshot = store.snapshot();
    return { snapshot, sessionId: store.sessionId, html: exportPresentation(snapshot) };
  }, true);
  const key = String(adapter.targetId || 'download');
  const previous = saveQueues.get(key) || Promise.resolve();
  const job = previous.catch(() => {}).then(async () => {
    const result = await adapter.write(captured.html, { snapshot: captured.snapshot, sessionId: captured.sessionId });
    if (result?.confirmed) store.markSaved(captured.snapshot, captured.sessionId);
      if(result?.confirmed)workbench?.onSaved(captured.sessionId);
    updateStatus();
    return { ...captured, result };
  });
  saveQueues.set(key, job);
  updateStatus();
  try { return await job; } finally { if (saveQueues.get(key) === job) saveQueues.delete(key); updateStatus(); }
}
async function downloadHtml() {
  try {
    const captured = await saveTo({ targetId: 'browser-download', write: async (html, context) => {
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `${(context.snapshot.title || 'presentation').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')}.html`;
      document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 3000);
      return { confirmed: false, downloadRequested: true };
    } });
    if (captured.sessionId === store.sessionId) notice('HTML 내려받기를 요청했습니다. 내려받은 파일은 HTML 열기로 다시 편집할 수 있습니다.');
  } catch (error) { notice(error.message, true); }
}
async function saveDesktop(saveAs = false) {
  try {
    const captured = await saveTo({ targetId: 'desktop-file', write: async (html, context) => {
      const result = await desktop.saveDocument({ html, sessionId: context.sessionId, title: context.snapshot.title, saveAs });
      if (result?.confirmed && context.sessionId === store.sessionId) {
        desktopFile = { sessionId: context.sessionId, name: result.name, path: result.path };
      }
      return result;
    } });
    if (captured.sessionId === store.sessionId) {
      notice(captured.result?.confirmed
        ? `${captured.result.name} 파일에 저장했습니다.${hasPendingChanges() ? ' 저장 요청 후의 추가 변경은 아직 저장하지 않았습니다.' : ''}`
        : '저장을 취소했습니다.');
    }
    return captured;
  } catch (error) { notice(`저장하지 못했습니다: ${error.message}`, true); return undefined; }
}
function saveDocument(saveAs = false) { return desktop ? saveDesktop(saveAs) : downloadHtml(); }
async function openDesktopDocument() {
  if (!mayReplace()) return;
  const generation = ++openGeneration;
  const token = changeToken();
  ++desktopRequests; updateStatus();
  try {
    const opened = await desktop.openDocument();
    if (generation !== openGeneration || opened?.canceled) return;
    if (!opened || typeof opened.contents !== 'string' || typeof opened.name !== 'string') throw new Error('파일 내용을 받지 못했습니다.');
    const json = opened.name.toLowerCase().endsWith('.json');
    const normalized = await validateAssetBytes(json ? normalizeDocument(JSON.parse(opened.contents)) : parsePresentation(opened.contents));
    if (generation !== openGeneration) return;
    let openedSession;
    await whenReady(() => {
      if (generation !== openGeneration) return;
      checkOpenToken(token);
      if (live) endLive();
      store.loadDocument(normalized); openedSession = store.sessionId;
      desktopFile = { sessionId: openedSession, name: opened.name, path: '' };
      render(); notice(`${opened.name} 파일을 열었습니다.`);
    }, true);
    if (!openedSession) return;
    try {
      const target = await desktop.adoptDocument({ openToken: opened.openToken, sessionId: openedSession });
      if (store.sessionId === openedSession) desktopFile = { sessionId: openedSession, name: target.name, path: target.path };
    } catch (error) {
      if (store.sessionId === openedSession) notice(`자료는 열었지만 저장 경로를 연결하지 못했습니다. 저장할 때 위치를 다시 선택하세요: ${error.message}`, true);
    }
  } catch (error) { if (generation === openGeneration) notice(`열지 못했습니다: ${error.message}`, true); }
  finally { --desktopRequests; updateStatus(); }
}
function openDocument() {
  if (desktop) return openDesktopDocument();
  if (mayReplace()) $('open-file').click();
}
function newDocument() {
  authoringStart?.open();
}
async function createAuthoringDocument(document,{isCurrent=()=>true}={}){
  if(!mayReplace())return false;
  const generation=++openGeneration,token=changeToken(),normalized=normalizeDocument(document);
  return whenReady(()=>{if(!isCurrent())return false;if(generation!==openGeneration)throw new Error('더 최근의 자료 열기 요청이 있습니다.');checkOpenToken(token);if(live)endLive();timelineWorkbench?.stopPreview();store.loadDocument(normalized);store.markUnsaved();desktopFile=null;workbench.showTab('properties');render();stage.focus();notice('새 자료를 만들었습니다. 제목과 내용을 편집한 뒤 저장하세요.');return true;},true);
}
async function importHtml(html) {
  const generation = ++openGeneration;
  const token = changeToken();
  const document = await validateAssetBytes(parsePresentation(html));
  if (generation !== openGeneration) throw new Error('더 최근의 파일 열기 요청이 있습니다.');
  await whenReady(() => { if (generation !== openGeneration) throw new Error('더 최근의 파일 열기 요청이 있습니다.'); checkOpenToken(token); if (desktop && live) endLive(); store.loadDocument(document); live = null; $('presentation').hidden = true; render(); notice('HTML의 슬라이드·텍스트·이미지를 불러왔습니다.'); }, true);
  return store.document;
}
function mayReplace() {
  return !hasPendingChanges() || window.confirm(desktop
    ? '저장하지 않은 변경 내용이 있습니다. 변경을 버리고 다른 자료를 여시겠습니까?'
    : '저장하지 않은 변경 내용이 있습니다. 내려받은 파일을 보관했는지 확인한 뒤 다른 자료를 여시겠습니까?');
}
$('open-file').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  const generation = ++openGeneration;
  const token = changeToken();
  try {
    if (file.size > 100 * 1024 * 1024) throw new Error('이번 실험판은 100MB 이하 자료를 열 수 있습니다.');
    const content = await file.text();
    const json = file.name.toLowerCase().endsWith('.json');
    const normalized = await validateAssetBytes(json ? normalizeDocument(JSON.parse(content)) : parsePresentation(content));
    if (generation !== openGeneration) return;
    await whenReady(() => {
      if (generation !== openGeneration) return;
      checkOpenToken(token); store.loadDocument(normalized); live = null; $('presentation').hidden = true; render();
      notice(json ? '문서 데이터 표본을 불러왔습니다.' : 'HTML의 슬라이드·텍스트·이미지를 불러왔습니다.');
    }, true);
  } catch (error) { if (generation === openGeneration) notice(`열지 못했습니다: ${error.message}`, true); }
  event.target.value = '';
});
$('image-file').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  const sessionId = store.sessionId;
  const replacement = workbench?.takeImageReplacement(),slot=layoutImageTarget;layoutImageTarget=null;
  try {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('PNG, JPEG, WebP 이미지를 선택해 주세요.');
    if (file.size > 20 * 1024 * 1024) throw new Error('이번 실험판은 20MB 이하 이미지를 넣을 수 있습니다.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const bitmap = await createImageBitmap(file);
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    const asset = { id: crypto.randomUUID(), mimeType: file.type, width: bitmap.width, height: bitmap.height, bytes: bytes.length, sha256: hash, dataBase64: btoa(binary) };
    bitmap.close();
    if (sessionId !== store.sessionId) throw new Error('자료가 바뀌어 이미지 삽입을 취소했습니다.');
    const alreadyStored = store.document.assets.some(item => item.sha256 === hash && item.mimeType === asset.mimeType);
    if (!alreadyStored && store.document.assets.reduce((total, item) => total + item.bytes, 0) + bytes.length > 20 * 1024 * 1024) throw new Error('이번 실험판은 자료 안의 이미지 합계 20MB까지 지원합니다.');
    await action(() => { if(slot){if(slot.sessionId!==store.sessionId||slot.revision!==store.revision||slot.slideId!==store.activeSlideId)throw Error('레이아웃 자리가 바뀌었습니다. 다시 선택하세요.');const target=store.activeSlide.elements.find(e=>e.id===slot.elementId);if(!target)throw Error('이미지를 넣을 자리를 찾을 수 없습니다.');store.fillLayoutSlot(slot.slideId,slot.slotKey,{id:slot.elementId,type:'image',geometry:{...target.geometry},assetId:asset.id,fit:'cover',alt:file.name||'이미지'},[asset]);}else if (replacement?.sessionId === store.sessionId) store.replaceImage(replacement.id, asset); else store.addImage(asset); notice(replacement ? '원본 이미지를 교체했습니다. 이전 자산은 Undo를 위해 보존합니다.' : '이미지를 자료 안에 보관했습니다.'); });
  } catch (error) { notice(error.message, true); }
  event.target.value = '';
});

function bind(id, fn) { $(id).addEventListener('click', () => action(fn)); }
bind('undo-button', () => store.undo()); bind('redo-button', () => store.redo());
bind('add-text', () => { const id = store.addText(); beginText(id); });
bind('add-shape', () => shapeGallery?.open('insert'));
bind('add-ellipse', () => store.addShape('ellipse'));
bind('duplicate-element', () => { if (workbench) { if(store.selectedIds.length) store.pasteElements(store.copyElements(store.selectedIds),{offsetX:24,offsetY:24}); } else if (store.selectedId) store.duplicateElement(store.selectedId); });
bind('delete-element', () => { if (workbench) store.deleteElements(store.selectedIds); else if (store.selectedId) store.deleteElement(store.selectedId); });
$('add-slide').addEventListener('click',()=>masterWorkbench?.open({mode:'new'}));
bind('duplicate-slide', () => workbench ? workbench.selectCreatedSlides(store.duplicateSlides(workbench.selectedSlideIds)) : store.duplicateSlide(store.activeSlideId));
bind('delete-slide', () => workbench ? store.deleteSlides(workbench.selectedSlideIds) : store.deleteSlide(store.activeSlideId));
bind('slide-up', () => workbench ? store.moveSlides(workbench.selectedSlideIds,Math.max(0,store.document.slides.findIndex(s=>workbench.selectedSlideIds.includes(s.id))-1)) : store.moveSlide(store.activeSlideId, -1));
bind('slide-down', () => workbench ? store.moveSlides(workbench.selectedSlideIds,Math.min(store.document.slides.length,store.document.slides.findIndex(s=>workbench.selectedSlideIds.includes(s.id))+1)) : store.moveSlide(store.activeSlideId, 1));
for (const [id, direction] of [['element-back', -1], ['element-front', 1]]) bind(id, () => {
  store.moveElements(store.selectedIds, direction);
});
$('save-button').addEventListener('click', () => saveDocument());
$('save-as-button').addEventListener('click', () => saveDocument(true));
$('open-button').addEventListener('click', openDocument);
$('add-image').addEventListener('click', () => {layoutImageTarget=layoutPlaceholders?.selectedSlot('image')||null;workbench?.clearImageReplacement();$('image-file').click();});
$('image-file').addEventListener('cancel',()=>{layoutImageTarget=null;workbench?.clearImageReplacement();});
$('new-button').addEventListener('click', newDocument);
$('document-title').addEventListener('focus', () => { titleSessionId = store.sessionId; lastCanvasClick = null; });
$('document-title').addEventListener('input', updateStatus);
$('document-title').addEventListener('change', event => {
  const value = event.target.value, sessionId = titleSessionId;
  if (sessionId === store.sessionId && value !== store.document.title) action(() => commitTitle(value, sessionId));
});
$('zoom-select').addEventListener('change', () => { cancelGesture(); applyZoom(); });
for (const key of ['x', 'y', 'width', 'height']) propertyHandlers.set(`property-${key}`, (id, raw) => store.setGeometry(id, { [key]: Number(raw) }));
for (const [id, property] of [['property-font-family', 'fontFamily'], ['property-text-color', 'color'], ['property-align', 'align'], ['property-font-size', 'fontSize'],
  ['property-line-height', 'lineHeight'], ['property-vertical-align', 'verticalAlign']]) {
  propertyHandlers.set(id, (elementId, raw) => store.setTextStyle(elementId, { [property]: ['fontSize', 'lineHeight'].includes(property) ? Number(raw) : raw }));
}
propertyHandlers.set('property-fill', (id, raw) => store.runBatch(solidFillCommands(id,raw),'도형 채우기'));
propertyHandlers.set('property-stroke', (id, raw) => setOutline(id, { color: raw }));
propertyHandlers.set('property-stroke-width', (id, raw) => setOutline(id, { width: Number(raw) }));
propertyHandlers.set('property-shape', (id, raw) => store.setShapeKind(id, raw));
propertyHandlers.set('property-slide-background', (id, raw) => store.setSlideBackground(id, raw));
propertyHandlers.set('property-image-fit', (id, raw) => store.setImageProperties(id, { fit: raw }));
propertyHandlers.set('property-image-alt', (id, raw) => store.setImageProperties(id, { alt: raw }));
for (const [id] of propertyHandlers) {
  $(id).addEventListener('focus', event => {
    lastCanvasClick = null;
    const context = propertyContexts.get(id);
    // Returning from a native picker must not promote its uncommitted DOM value
    // to the model baseline. The baseline belongs to the rendered element/session.
    if (currentPropertyTarget(context)) {
      if (colorProperties.has(id)) {
        context.pendingRaw = event.target.value;
        if (context.pendingRaw === context.committedRaw) delete context.pendingRaw;
      }
    } else updateProperties(true);
  });
  $(id).addEventListener('input', event => {
    if (colorProperties.has(id)) {
      const context = propertyContexts.get(id);
      if (context?.sessionId === store.sessionId) {
        context.pendingRaw = event.target.value;
        context.inputVersion = (context.inputVersion || 0) + 1;
      }
    }
    updateStatus();
  });
  $(id).addEventListener('change', event => {
    const captured = captureProperty(event.target);
    if (captured && captured.raw !== captured.committedRaw) action(() => applyProperty(captured));
  });
  if (colorProperties.has(id)) $(id).addEventListener('blur', event => {
    // null means focus may be in the OS picker/window: keep its draft pending.
    // A real DOM focus destination is a final boundary. Do not rebuild click
    // targets during blur; the subsequent click refreshes the complete view.
    if (!event.relatedTarget || event.relatedTarget.closest?.('#agent-io-permissions')) return;
    const captured = captureProperty(event.target);
    if (!captured || captured.raw === captured.committedRaw) return;
    whenReady(() => {
      const revision = store.revision;
      const editingElementId = store.textSession?.elementId;
      applyProperty(captured);
      if (editingElementId && !store.textSession) {
        editor.hidden = true;
        editor.replaceChildren();
        const sourceNode = [...$('slide-content').children].find(node => node.dataset.elementId === editingElementId);
        if (sourceNode) setEditedSourceVisibility(sourceNode,false);
        updateOverlay();
      }
      colorRenderPending ||= revision !== store.revision;
      paintCommittedColors(); updateStatus();
    }).catch(error => notice(error.message, true));
  });
}
function paintCommittedColors() {
  stage.style.background = store.activeSlide.background;
  for (const card of document.querySelectorAll('#slide-list .slide-card')) {
    const slide = store.document.slides.find(item => item.id === card.dataset.slideId);
    if (slide) card.querySelector('.thumb-canvas').style.background = slide.background;
  }
  const elements = new Map(store.document.slides.flatMap(slide => slide.elements.map(element => [element.id, element])));
  for (const node of document.querySelectorAll('#slide-content .slide-element,#slide-list .slide-element')) {
    const element = elements.get(node.dataset.elementId);
    if (element?.type === 'shape') {
      if(isPresetShape(element.shape))updatePresetShapeAppearance(node,element,store.document);
      else {node.style.background = resolveElementAppearance(element,store.document).background; node.style.borderColor = element.stroke.color;}
    }
    const content = node.querySelector('.element-text-content');
    if (element?.text && content) content.style.color = element.text.textStyle.color;
  }
}
document.addEventListener('click', event => {
  if(event.target.closest('#agent-io-permissions'))return;
  if (event.target.closest('input[type="color"]')) return;
  if (!colorRenderPending && ![...colorProperties].some(id => {
    const context = propertyContexts.get(id);
    return context?.sessionId === store.sessionId && $(id).value !== context.committedRaw;
  })) return;
  whenReady(() => {
    const revision = store.revision;
    commitPendingColors();
    if (colorRenderPending || revision !== store.revision) { colorRenderPending = false; render(); }
  }).catch(error => notice(error.message, true));
});
for (const id of colorProperties) {
  const retainColorActivity = () => {
    const context = propertyContexts.get(id);
    if (context?.sessionId === store.sessionId) activeColorControl = { fieldId: id, elementId: context.elementId, elementIds: context.elementIds, slideId: context.slideId, sessionId: context.sessionId };
  };
  $(id).addEventListener('pointerdown', retainColorActivity);
  $(id).addEventListener('focus', retainColorActivity);
}
for (const eventName of ['pointerdown', 'focusin']) document.addEventListener(eventName, event => {
  if (!event.target.closest('input[type="color"]')) activeColorControl = null;
}, true);

for (const button of document.querySelectorAll('.toolbar button,.file-actions button')) button.addEventListener('pointerdown', event => event.preventDefault());

function renderLive() {
  if(!live)return;
  const doc=live.document;
  if(!live.runtime){
    live.holder=document.createElement('div');live.holder.className='live-slide-holder';
    live.deck=document.createElement('div');live.deck.className='live-deck';live.deck.tabIndex=0;
    live.deck.style.width=`${doc.canvas.width}px`;live.deck.style.height=`${doc.canvas.height}px`;
    live.deck.innerHTML=renderPresentationSlides(doc);live.holder.append(live.deck);$('presentation-content').replaceChildren(live.holder);
    live.runtime=createPresentationRuntime({root:live.deck,document:doc,saveFormData:desktop?.formData?value=>desktop.formData.save(value):undefined,behaviorRuntimeFactory:createBehaviorRuntime,sceneRuntimeFactory:createSceneRuntime,scenePhysics:installScenePhysics({}),createBehaviorEvaluatorFactory:createBehaviorEvaluator,initialSlideId:doc.slides[live.index].id,onChange:updateLiveChrome,onOpenLink:url=>desktop?.openExternal?desktop.openExternal({url}).catch(error=>notice(error.message,true)):window.open(url,'_blank','noopener'),onEnd:()=>notice('마지막 슬라이드입니다. 편집으로 돌아가려면 Esc를 누르세요.')});
  }
  sizeLiveViewport();
  if(!live.resizeObserver){const owner=live;owner.resizeObserver=new ResizeObserver(()=>{if(live===owner)sizeLiveViewport();});owner.resizeObserver.observe(owner.deck);}
  behaviorStudio?.observeRuntime?.(live.runtime.getState(),{active:true,isPreview:live.preview});
  sceneStudio?.observeRuntime?.(live.runtime.getState(),{active:true,isPreview:live.preview});
}
function sizeLiveViewport(){
  if(!live?.runtime)return;
  const width=Math.max(1,window.innerWidth-(live.preview?48:0)),height=Math.max(1,window.innerHeight-(live.preview?120:0));
  const frame=live.runtime.resizeViewport(width,height),fluid=Boolean(frame.responsive);
  $('presentation').classList.toggle('is-fluid',fluid);const web=fluid&&live.document.responsive?.showControls===false;$('presentation').classList.toggle('is-web-page',web);$('presentation-content').style.background=web?live.document.slides[live.index].background:'';
  const zoom=fluid?frame.scale:Math.min(width/live.document.canvas.width,height/live.document.canvas.height);
  const w=fluid?frame.width:live.document.canvas.width,h=fluid?frame.height:live.document.canvas.height;
  live.deck.style.width=w+'px';live.deck.style.height=h+'px';live.deck.style.transform=`scale(${zoom})`;
  live.holder.style.width=w*zoom+'px';live.holder.style.height=h*zoom+'px';
}
function updateLiveChrome(state){
  if(!live)return;
  behaviorStudio?.observeRuntime?.(state,{active:true,isPreview:live.preview});
  sceneStudio?.observeRuntime?.(state,{active:true,isPreview:live.preview});
  live.index=state.index;
  if(live.reportedSlide!==state.slideId){live.reportedSlide=state.slideId;store.setPresentation({slideId:state.slideId});}
  $('scene-live-tools').hidden=!live.document.behavior&&!live.document.slides.some(s=>s.scene);
  const hasSceneAudio=Boolean(live.document.slides.some(s=>s.scene?.audio?.length));$('scene-audio-enable').hidden=!hasSceneAudio;$('scene-audio-mute').hidden=!hasSceneAudio;
  $('scene-audio-mute').textContent=state.scene?.muted?'음소거 해제':'음소거';$('scene-audio-mute').setAttribute('aria-pressed',String(Boolean(state.scene?.muted)));
  $('live-counter').textContent=`${state.index+1} / ${live.document.slides.length}`;
  $('live-step').textContent=`클릭 ${state.step} / ${state.stepCount} · ${(state.elapsed/1000).toFixed(1)}초`;
  $('live-prev').disabled=!state.canPrevious;$('live-next').disabled=!state.canNext;
  $('live-pause').textContent=state.paused?'재생':'일시정지';$('live-pause').setAttribute('aria-pressed',String(state.paused));
  $('live-seek').max=String(Math.max(1,Math.ceil(state.duration)));$('live-seek').value=String(Math.round(state.elapsed));$('live-seek').disabled=state.duration===0;
  if(live.presenter&&desktop?.presenter){const info=presenterState(state),signature=JSON.stringify(info);if(signature!==live.presenterSignature){live.presenterSignature=signature;desktop.presenter.update(info).catch(error=>notice(error.message,true));}}
}
function presenterState(state){const doc=live.document,slide=doc.slides[state.index],next=doc.slides[state.index+1];return {title:doc.title,slideName:slide.name||titleForSlide(slide),notes:slide.notes||'',index:state.index,total:doc.slides.length,step:state.step,canNext:state.canNext,canPrevious:state.canPrevious,nextTitle:next?(next.name||titleForSlide(next)):''};}
async function beginPresenter(){if(!desktop?.presenter)throw new Error('발표자 창은 데스크톱 앱에서 사용할 수 있습니다.');beginLive(false);live.presenter=true;await desktop.presenter.open(presenterState(live.runtime.getState()));}
function nextLive(delta) { if(live?.runtime)delta>0?live.runtime.next():live.runtime.previous(); }
async function syncDesktopPresentation(active) {
  if (!desktop) return;
  try { await desktop.setPresentation(active); }
  catch (error) { notice(`전체 화면을 전환하지 못했습니다: ${error.message}`, true); }
}
function endLive() { sceneStudio?.observeRuntime?.(null,{active:false,isPreview:false}); behaviorStudio?.observeRuntime?.(null,{active:false,isPreview:false});const previous=live;live=null;syncAvatarChrome();previous?.resizeObserver?.disconnect();previous?.runtime?.destroy();if(previous?.presenter)desktop?.presenter?.close().catch(error=>notice(error.message,true));store.setPresentation(null);$('presentation').hidden=true;$('presentation-content').replaceChildren();syncDesktopPresentation(false);stage.focus();notice('재생을 마치고 편집으로 돌아왔습니다.'); }
function beginLive(preview=false) {
  drawingWorkbench?.cancel(true);
  timelineWorkbench?.stopPreview();
  if(live)endLive();
  live={document:store.snapshot(),index:store.document.slides.findIndex(slide=>slide.id===store.activeSlideId),preview};
  $('presentation').hidden=false;$('presentation').classList.toggle('is-preview',preview);$('live-mode').textContent=preview?'동작 미리보기':'발표';
  renderLive();live.deck.focus();if(!preview)syncDesktopPresentation(true);
}
bind('present-button', beginLive);
$('live-prev').addEventListener('click', () => nextLive(-1)); $('live-next').addEventListener('click', () => nextLive(1)); $('end-presentation').addEventListener('click', endLive);
$('live-pause').addEventListener('click',()=>{const player=live?.runtime;if(player)player.getState().paused?player.play():player.pause();});
$('live-reset').addEventListener('click',()=>live?.runtime?.reset());
$('live-seek').addEventListener('input',event=>live?.runtime?.seek(Number(event.target.value)));
for(const[id,method]of[['scene-progress-save','exportProgress'],['scene-progress-load','importProgress'],['scene-audio-enable','enableAudio'],['scene-audio-mute','toggleMute']])$(id).addEventListener('click',async()=>{const owner=live;try{const result=await sceneStudio?.[method]?.();if(live===owner)$('scene-live-status').textContent=result?.canceled?'작업을 취소했습니다.':method==='importProgress'?'진행을 불러왔습니다. 재생을 누르면 이어집니다.':method==='exportProgress'?'진행 저장 작업을 마쳤습니다.':'소리 설정을 적용했습니다.';}catch(error){if(live===owner)$('scene-live-status').textContent=error.message;}});

document.addEventListener('compositionstart', event => { if (!event.target.closest('#text-editor')) { externalComposing = true; updateStatus(); } });
document.addEventListener('compositionend', event => { if (!event.target.closest('#text-editor')) { externalComposing = false; updateStatus(); setTimeout(flushReady, 0); } });
document.addEventListener('keydown', event => {
  if(event.defaultPrevented)return;
  if (live) {
    if(event.defaultPrevented||event.isComposing)return;
    if(event.key!=='Escape'&&event.target.closest('#bs-runtime-inspector,#scene-live-tools'))return;
    if(event.key==='Escape'&&event.target.closest('select'))return;
    if(event.key!=='Escape'&&(editableTarget(event.target)||live.runtime?.isInteractiveTarget(event.target)))return;
    if(live.document.responsive?.showControls===false&&event.key!=='Escape')return;
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(event.key)) { event.preventDefault(); nextLive(1); }
    if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(event.key)) { event.preventDefault(); nextLive(-1); }
    if (event.key === 'Home') { event.preventDefault(); live.runtime.goTo(0); }
    if (event.key === 'End') { event.preventDefault(); live.runtime.goTo(live.document.slides.length-1); }
    if (event.key === 'Escape') { event.preventDefault(); endLive(); }
    return;
  }
  const ctrl = event.ctrlKey || event.metaKey;
  if(document.querySelector('dialog[open]'))return;
  if (ctrl && event.key.toLowerCase() === 's') { event.preventDefault(); saveDocument(event.shiftKey); return; }
  if (ctrl && event.key.toLowerCase() === 'o') { event.preventDefault(); openDocument(); return; }
  if (desktop && ctrl && event.key.toLowerCase() === 'n') { event.preventDefault(); newDocument(); return; }
  if (desktop && event.key === 'F5') { event.preventDefault(); action(beginLive); return; }
  if (event.isComposing || composing() || event.defaultPrevented) return;
  if (editableTarget(event.target)) {
    if (event.key === 'Escape' && !event.target.closest('#text-editor')) {
      event.preventDefault();
      if(event.target.closest('#mo-motion,#mo-interaction'))motionWorkbench.cancelPending();
      if(event.target.closest('#bu-business,#bu-delivery'))businessWorkbench.cancelPending();
      if(event.target.closest('#tl-inspector,#tl-dock'))timelineWorkbench.cancelPending();
      if(event.target.closest('#ai-behavior'))advancedInteractionWorkbench.cancelPending();
      if(event.target.closest('#bs-studio'))behaviorStudio.cancelPending();
      if(event.target.closest('#scene-studio'))sceneStudio.cancelPending();
      if(event.target.closest('#responsive-workbench'))responsiveWorkbench.cancelPending();
      if(event.target.closest('#web-authoring'))webAuthoringUI.cancelPending();
      if (colorProperties.has(event.target.id)) {
        const context = propertyContexts.get(event.target.id);
        if (context?.sessionId === store.sessionId) {
          event.target.value = context.committedRaw;
          delete context.pendingRaw;
          context.inputVersion = (context.inputVersion || 0) + 1;
        }
      }
      updateProperties(); updateStatus(); stage.focus();
    }
    return;
  }
  if(ctrl&&event.key.toLowerCase()==='m'){event.preventDefault();masterWorkbench?.open({mode:'new'});return;}
  if (event.key === 'Escape') { event.preventDefault(); if (gesture) cancelGesture(); else action(() => store.selectElement(null)); return; }
  if (ctrl && event.key.toLowerCase() === 'z') { event.preventDefault(); action(() => event.shiftKey ? store.redo() : store.undo()); return; }
  if (ctrl && event.key.toLowerCase() === 'y') { event.preventDefault(); action(() => store.redo()); return; }
  if (ctrl && event.key.toLowerCase() === 'd') { event.preventDefault(); workbench.duplicate(); return; }
  if ((event.key === 'Delete' || event.key === 'Backspace') && store.selectedId) { event.preventDefault(); action(() => store.deleteElements(store.selectedIds)); return; }
  if (event.key === 'F2' && store.selectedId) { event.preventDefault();if(store.selectedIds.length!==1){notice('내용을 편집할 개체 한 개를 선택하세요.');return;}action(() => beginElementEdit(store.selectedId)); return; }
  const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
  if (direction && store.selectedId) { event.preventDefault();if(store.selectedElement?.type==='connector'&&store.selectedIds.length===1){businessWorkbench.show();notice('연결선은 시작·끝 개체와 연결점으로 위치를 정합니다.');return;} action(() => { const amount = event.shiftKey ? 10 : 1; store.transformElements(store.selectedIds, { dx: direction[0] * amount, dy: direction[1] * amount }); }); }
});
window.addEventListener('resize', () => { drawingWorkbench?.cancel(true);if (live) renderLive(); else { cancelGesture(); renderThumbnails(); applyZoom(); } });
window.addEventListener('blur', cancelGesture);
window.addEventListener('beforeunload', event => { if (!desktop && hasPendingChanges()) { event.preventDefault(); event.returnValue = ''; } });

if (desktop) {
  document.documentElement.dataset.host = 'desktop';
  document.querySelector('.prototype-badge').textContent = '데스크톱 실험판';
  $('save-button').textContent = '저장'; $('save-button').title = '저장 (Ctrl+S)';
  $('save-as-button').hidden = false;
  $('open-button').textContent = '열기'; $('open-button').title = '열기 (Ctrl+O)';
  $('desktop-file-name').hidden = false;
  $('file-note-copy').innerHTML = 'HTML에 내용과 이미지를 담습니다.<br>저장한 파일은 다시 열어 편집할 수 있습니다.';
  desktop.onCommand(command => {
    if(masterWorkspace?.active){masterWorkspace.fileHint();return;}
      if (initializing) { notice('자료를 불러오는 중입니다. 잠시 후 다시 시도해 주세요.'); return; }
    if(document.querySelector('dialog[open]')){notice('현재 편집 창을 먼저 마치세요.');return;}
    if (command === 'new') newDocument();
    else if (command === 'open') openDocument();
    else if (command === 'save') saveDocument();
    else if (command === 'save-as') saveDocument(true);
    else if (command === 'present') { if (!live) action(beginLive); }
    else if (command === 'end-presentation' && live) endLive();
    else if(command==='export')businessWorkbench.showDelivery();
    else if(command==='presenter'&&!live)action(beginPresenter);
    else if(command==='presenter-next'&&live)nextLive(1);
    else if(command==='presenter-previous'&&live)nextLive(-1);
    else if(command==='presenter-end'&&live)endLive();
  });
} else document.documentElement.dataset.host = 'browser';

// A small inspection boundary for repeatable local technical checks. No file access or network bridge.
window.__htmlSlideTest = { store, render, get systemFonts(){return systemFonts?.inventory;}, exportHtml: () => exportPresentation(store.snapshot()), importHtml, saveTo,
  get pendingSaves() { return saveQueues.size; }, get pendingInputRequests() { return readyQueue.length; },
  get presentation() { return live ? { index: live.index, slideId: live.document.slides[live.index].id } : null; },
  get presentationRuntime(){return live?.runtime?{getState:()=>live.runtime.getState()}:null;} };

async function openWorkbenchExample(){
  if(!mayReplace())return;
  const generation=++openGeneration,token=changeToken();
  try{
    const response=await fetch('/examples/workbench-showcase.json');if(!response.ok)throw new Error('작업대 예제를 읽지 못했습니다.');
    const document=await validateAssetBytes(normalizeDocument(await response.json()));
    if(generation!==openGeneration)return;
    await whenReady(()=>{checkOpenToken(token);if(live)endLive();store.loadDocument(document);store.markUnsaved();desktopFile=null;render();notice('편집 가능한 작업대 예제입니다. 모든 텍스트·개체·디자인을 직접 고칠 수 있습니다.');},true);
  }catch(error){notice(error.message,true);}
}
async function openMotionExample(){
  if(!mayReplace())return;
  const generation=++openGeneration,token=changeToken();
  try{
    const response=await fetch('/examples/motion-showcase.json');if(!response.ok)throw new Error('동작 예제를 읽지 못했습니다.');
    const document=await validateAssetBytes(normalizeDocument(await response.json()));
    if(generation!==openGeneration)return;
    await whenReady(()=>{checkOpenToken(token);if(live)endLive();store.loadDocument(document);store.markUnsaved();desktopFile=null;render();notice('동작 예제입니다. 모션·인터랙션 탭에서 효과와 연결을 직접 바꿀 수 있습니다.');},true);
  }catch(error){notice(error.message,true);}
}
async function openBusinessExample(){
  if(!mayReplace())return;
  const generation=++openGeneration,token=changeToken();
  try{const response=await fetch('/examples/business-showcase.json');if(!response.ok)throw new Error('업무 예제를 읽지 못했습니다.');const document=await validateAssetBytes(normalizeDocument(await response.json()));if(generation!==openGeneration)return;await whenReady(()=>{checkOpenToken(token);if(live)endLive();store.loadDocument(document);store.markUnsaved();desktopFile=null;render();notice('표·차트·부분 서식과 발표 메모를 수정할 수 있는 업무 예제입니다.');},true);}catch(error){notice(error.message,true);}
}
async function openAdvancedExample(){
  if(!mayReplace())return;
  const generation=++openGeneration,token=changeToken();
  try{const response=await fetch('/examples/advanced-showcase.json');if(!response.ok)throw new Error('고급 동작 예제를 읽지 못했습니다.');const document=await validateAssetBytes(normalizeDocument(await response.json()));if(generation!==openGeneration)return;await whenReady(()=>{checkOpenToken(token);if(live)endLive();timelineWorkbench?.stopPreview();store.loadDocument(document);store.markUnsaved();desktopFile=null;render();timelineWorkbench.show();notice('키프레임·상태·조건·슬라이더를 직접 편집하는 예제입니다.');},true);}catch(error){notice(error.message,true);}
}
function beginElementEdit(id){const element=store.activeSlide.elements.find(e=>e.id===id);if(!element||element.locked||element.hidden)return;if(store.selectedIds.length!==1||store.selectedId!==id)store.selectElements([id],{expandGroups:false});if(element.type==='video'){mediaWorkbench.show();return;}if(['table','chart','connector','svg'].includes(element.type)){businessWorkbench?.show({focusEditor:true,expanded:['table','chart'].includes(element.type)});return;}if(element.type==='image'){workbench.showTab('properties');requestAnimationFrame(()=>{const control=$('wb-replace-image');control?.scrollIntoView({block:'center'});control?.focus();});return;}beginText(id);}
function refreshConnections(){const doc=effectiveDocument(),slide=doc.slides.find(s=>s.id===store.activeSlideId);const members=new Set(slide.elements.flatMap(e=>e.flow?.children||[]));if(store.transformSession)for(const element of slide.elements.filter(e=>members.has(e.id))){const node=[...$('slide-content').children].find(n=>n.dataset.elementId===element.id);if(node)geometryStyle(node,element.geometry);}for(const element of slide.elements.filter(e=>e.type==='connector'&&!e.hidden)){const node=[...$('slide-content').children].find(n=>n.dataset.elementId===element.id);if(node){const resolved=resolveConnectorGeometry(element,slide);geometryStyle(node,resolved.geometry);node.innerHTML=connectorContent(element,resolved);}}}
async function requestOutput(kind,options,expected){
  if(!desktop?.output)throw new Error('출력은 데스크톱 앱에서 사용할 수 있습니다.');
  outputRequests++;updateStatus();
  try{const captured=await whenReady(()=>{commitFocusedControls();store.finishText();if(expected&&(expected.sessionId!==store.sessionId||expected.revision!==store.revision))throw new Error('자료가 변경되었습니다. 납품 미리보기를 다시 확인하세요.');return {document:store.snapshot(),source:{sessionId:store.sessionId,revision:store.revision,documentId:store.document.id}};},true);const result=await desktop.output[kind]({...options,document:captured.document});return {...result,source:captured.source};}finally{outputRequests--;updateStatus();}
}
async function restoreRecoveredDocument(document){
  if(!mayReplace())return false;
  ++openGeneration;
  return action(()=>{if(live)endLive();store.loadDocument(normalizeDocument(document));store.markUnsaved();desktopFile=null;notice('이전 작업을 복구했습니다. 새 파일로 저장하세요.');return true;});
}
async function start() {
  try {
    const response=await fetch('/examples/first-deck.json');
    if(!response.ok)throw new Error('첫 자료 예제를 읽지 못했습니다.');
    const example={...await validateAssetBytes(normalizeDocument(await response.json())),id:createBlankDocument().id};
    store.loadDocument(example);
    render(); notice('7장 쇼케이스입니다. 슬라이드 쇼에서 움직임과 반응을 확인하고, 큰 제목을 두 번 눌러 바꿔보세요. 도움말에 5분 안내가 있습니다.');
    document.documentElement.dataset.ready = 'true';
  } catch (error) { store.loadDocument(createBlankDocument());render(); notice(error.message+' 새 자료에서 시작할 수 있습니다.', true); document.documentElement.dataset.ready = 'true'; }
  finally { initializing = false; updateStatus(); }
}
const agentIOEditor=createAgentIOEditor({store,render,updateStatus,onSaved:({name,sessionId})=>{desktopFile={sessionId,name,path:''};workbench?.onSaved(sessionId);notice(`${name} 파일에 확정 내용을 저장했습니다.`);},onOpened:({name,sessionId})=>{++openGeneration;desktopFile={sessionId,name,path:''};notice(`${name} 파일을 열었습니다. 새 자료의 파일 허용은 다시 선택하세요.`);},isPresenting:()=>Boolean(live),present:({active,slideId})=>{if(active){beginLive(false);if(slideId)live.runtime.goTo(live.document.slides.findIndex(slide=>slide.id===slideId));}else if(live)endLive();}});
workbench = createWorkbench({store, action, render, notice, beginText:beginElementEdit, composing, flushReady, commitControls:commitFocusedControls, scale:()=>scale, updateStatus, refreshSelection:()=>{updateProperties();updateStatus();drawingWorkbench?.sync();behaviorStudio?.sync();sceneStudio?.sync();dataConnectorUI?.sync();syncAvatarChrome();},refreshConnections, restoreDocument:restoreRecoveredDocument, openExample:openWorkbenchExample,importLibrary:()=>reuseLibrary?.show(), applyZoom, desktop,hostOperation:agentIOEditor,interactionBusy:()=>Boolean(drawingWorkbench?.busy||masterWorkspace?.active||(behaviorStudio?.modalActive||sceneStudio?.modalActive)),showObjectStyle:()=>cssStudio?.show(),openLink:()=>textFormats?.openLink('object')});
motionWorkbench=createMotionWorkbench({store,workbench,action,render,notice,updateStatus,preview:()=>beginLive(true),openExample:openMotionExample});
kitPicker=createKitPicker({store,notice,updateStatus});
businessWorkbench=createBusinessWorkbench({store,workbench,action,render,notice,updateStatus,output:requestOutput,presentWithNotes:beginPresenter,desktop,onDrawConnector:()=>drawingWorkbench?.arm('connector'),onOpenIconGallery:()=>iconGallery?.open('insert'),getLayoutSlot:role=>layoutPlaceholders?.selectedSlot(role),chooseKit:(source,name)=>kitPicker.choose(source,name)});
timelineWorkbench=createTimelineWorkbench({store,workbench,action,render,notice,updateStatus,commitControls:commitFocusedControls,preview:time=>{beginLive(true);live.runtime.seekTimeline(time);},openExample:openAdvancedExample});
advancedInteractionWorkbench=createAdvancedInteractionWorkbench({store,workbench,action,render,notice,updateStatus});
const businessExampleButton=document.createElement('button');businessExampleButton.id='bu-open-example';businessExampleButton.textContent='업무 예제';businessExampleButton.addEventListener('click',openBusinessExample);document.querySelector('.toolbar').append(businessExampleButton);
authoringStart=createAuthoringStart({store,createDocument:createAuthoringDocument,openFile:openDocument,notice,startWithAgent:desktop?.avatar?async({sessionId})=>{if(store.sessionId!==sessionId)return;await avatarUI?.openForGeneration({expectedSessionId:sessionId,returnFocus:$('new-button')});if(store.sessionId!==sessionId)return;syncAvatarChrome();notice('새 자료에서 에이전트와 작업합니다. 필요한 내용과 장 수를 요청하세요.');}:undefined});
productivityWorkbench=createProductivityWorkbench({store,workbench,action,notice,editSelected:()=>action(()=>beginElementEdit(store.selectedId)),openStart:newDocument,composing});
shapeGallery=createShapeGallery({store,action,notice});
iconGallery=createIconGallery({store,action,notice});
drawingWorkbench=createDrawingWorkbench({store,action,render,notice,scale:()=>scale,composing,blocked:()=>Boolean(masterWorkspace?.active||live||(behaviorStudio?.modalActive||sceneStudio?.modalActive)),prepareGesture:()=>{commitFocusedControls();store.finishText();}});
$('property-shape').replaceChildren(...SHAPE_DEFINITIONS.map(shape=>{const option=document.createElement('option');option.value=shape.id;option.textContent=shape.label;return option;}));
const freeformOption=document.createElement('option');freeformOption.value='freeform';freeformOption.textContent='자유형 · 점 편집';freeformOption.disabled=true;$('property-shape').append(freeformOption);
systemFonts=createSystemFonts({desktop,notice});
masterWorkspace=createMasterWorkspace({store,action,notice,onActivityChange:updateStatus});
masterWorkbench=createMasterWorkbench({store,workbench,action,notice,openWorkspace:id=>masterWorkspace.open(id)});
const layoutStartButton=document.createElement('button');layoutStartButton.id='wf-empty-layout';layoutStartButton.className='primary-button';layoutStartButton.textContent='레이아웃으로 시작';layoutStartButton.addEventListener('click',()=>masterWorkbench.open({mode:'apply'}));
$('wf-start-launch').classList.remove('primary-button');$('wf-start-launch').before(layoutStartButton);
$('wf-empty-start').querySelector('p').textContent='페이지 유형을 고르고 내용을 채우거나 자유롭게 배치하세요.';
slideNavigator=createSlideNavigator({store,workbench,action,notice,newSlide:()=>masterWorkbench.open({mode:'new'}),changeLayout:()=>masterWorkbench.open({mode:'apply'}),resetLayout:()=>masterWorkbench.reset()});
cssStudio=createCssStudio({store,workbench,action,notice,updateStatus,renderPreview:()=>render()});
responsiveWorkbench=createResponsiveWorkbench({store,workbench,action,render,notice,updateStatus});
componentLibraryUI=createComponentLibraryUI({store,action,render,notice,updateStatus});
webAuthoringUI=createWebAuthoringUI({store,workbench,action,render,notice,updateStatus});
reuseLibrary=createReuseLibraryUI({store,render,notice,updateStatus,
  insertAsset:(assetId,{expectedRevision,expectedSessionId})=>{
    if(expectedSessionId!==store.sessionId||expectedRevision!==store.revision)throw Error('자료가 바뀌었습니다. 이미지를 다시 선택하세요.');
    const state=store.readEditorState();
    if(!state.ok||state.value.state.busy.active)throw Error('현재 입력이나 파일 작업을 마친 뒤 이미지를 넣으세요.');
    const asset=store.document.assets.find(item=>item.id===assetId);
    if(!asset||!asset.mimeType.startsWith('image/'))throw Error('이 자료에서 이미지를 찾을 수 없습니다.');
    const id=store.addImage(asset);render();notice('자료의 이미지를 추가했습니다.');return {ok:true,value:{elementId:id}};
  },showImportedPage:slideId=>workbench.onSlideClick({},slideId),showLayouts:()=>masterWorkbench.open({mode:'apply'}),showStyles:()=>cssStudio.show(),showComponents:()=>action(()=>componentLibraryUI.show())});
const importLibraryButton=document.createElement('button');importLibraryButton.id='ms-import-library';importLibraryButton.className='wb-wide';importLibraryButton.textContent='다른 자료에서 가져오기';importLibraryButton.onclick=()=>reuseLibrary.show();$('ms-gallery-open').after(importLibraryButton);
const documentAssetsButton=document.createElement('button');documentAssetsButton.id='reuse-document-assets';documentAssetsButton.textContent='자료 이미지';documentAssetsButton.onclick=()=>reuseLibrary.show({tab:'assets'});
$('add-image').after(documentAssetsButton);
interactiveStudio=createInteractiveStudioWorkbench({store,workbench,action,render,notice,updateStatus});
behaviorStudio=createBehaviorStudio({store,workbench,action,notice,updateStatus,preview:()=>action(()=>beginLive(true)),getRuntime:()=>live?.runtime,openLegacy:page=>workbench.showTab(page)});
sceneStudio=createSceneStudio({store,workbench,action,notice,updateStatus,preview:()=>action(()=>beginLive(true)),getRuntime:()=>live?.runtime,saveProgress:desktop?.progress?dto=>desktop.progress.save(dto):undefined,loadProgress:desktop?.progress?()=>desktop.progress.open():undefined});
alignmentGuides=createAlignmentGuides({store,workbench});
mediaWorkbench=createMediaWorkbench({store,workbench,action,render,notice,updateStatus,preview:()=>beginLive(true),getLayoutSlot:role=>layoutPlaceholders?.selectedSlot(role)});
textFormats=createTextFormatWorkbench({store,action,notice,getRichEditor:()=>richEditor,ensureRichEditor:()=>{const range=readPlainTextSelection(editor);if(!store.textSession){if(!store.selectedElement?.text)return null;beginText(store.selectedId,{rich:true});}else{readDraft();buildTextEditor(0,{rich:true});}if(range)richEditor?.selectRange(range);return richEditor;},composing,blocked:()=>Boolean(masterWorkspace?.active||live||(behaviorStudio?.modalActive||sceneStudio?.modalActive)),updateStatus});
layoutPlaceholders=createLayoutPlaceholderWorkbench({store,action,notice,beginText:id=>action(()=>beginText(id)),insertImage:target=>{layoutImageTarget=target;workbench.clearImageReplacement();$('image-file').click();},insertVideo:target=>mediaWorkbench.openInsert(target),insertChart:()=>$('bu-add-chart').click(),insertTable:()=>$('bu-add-table').click(),blocked:()=>Boolean(masterWorkspace?.active||live||drawingWorkbench?.busy||(behaviorStudio?.modalActive||sceneStudio?.modalActive))});
ribbon=createRibbon({store,workbench,action,notice,openComponents:()=>action(()=>componentLibraryUI.show()),showResponsive:()=>responsiveWorkbench.show(),previewResponsive:()=>responsiveWorkbench.openPreview(),showWebTools:()=>webAuthoringUI?.show(),newSlide:()=>masterWorkbench.createSlide(),chooseNewLayout:()=>masterWorkbench.open({mode:'new'}),resetLayout:()=>masterWorkbench.reset(),insertVideo:()=>mediaWorkbench.openInsert(),openLink:()=>textFormats.openLink(),showMasterEditor:()=>masterWorkbench.show(),openMasters:()=>masterWorkbench.open(),showMasters:()=>masterWorkbench.show(),showCss:()=>cssStudio.show(),showWeb:()=>interactiveStudio.show(),showLogic:()=>action(()=>behaviorStudio.show()),showScene:()=>action(()=>sceneStudio.show()),showData:desktop?.data?()=>dataConnectorUI.show():undefined,openShapes:mode=>action(()=>shapeGallery.open(mode)),armDrawing:mode=>action(()=>drawingWorkbench.arm(mode)),openIcons:mode=>action(()=>iconGallery.open(mode))});
if(desktop?.data){dataConnectorUI=createDataConnectorUI({desktopData:desktop.data,workbench,notice,updateStatus,getDocumentContext:()=>({sessionId:store.sessionId,documentId:store.document.id,title:store.document.title,contentRevision:store.revision,slideId:store.activeSlideId,slideName:store.activeSlide?.name||titleForSlide(store.activeSlide),selectedIds:[...store.selectedIds]}),getSelectedElement:()=>store.selectedIds.length===1?store.selectedElement:null});dataConnectorUI.ready.catch(error=>notice(error.message,true));for(const type of ['chart','table']){const b=document.createElement('button');b.id='bu-'+type+'-connect';b.className='wb-wide';b.textContent='외부 데이터 연결';b.addEventListener('click',()=>dataConnectorUI.show());$('bu-'+type+'-expand').after(b);}}
if(desktop?.agentIO){agentIOUI=createAgentIOPermissionsUI({desktopAgentIO:desktop.agentIO,container:$('wb-agent-panel'),notice,updateStatus,getDocumentContext:()=>({sessionId:store.sessionId,documentId:store.document.id,title:store.document.title})});agentIOUI.ready.catch(error=>notice(error.message,true));}
function syncAvatarChrome(){avatarUI?.sync();const button=$('avatar-toggle');button.hidden=!desktop?.avatar;button.setAttribute('aria-pressed',String(Boolean(avatarUI?.enabled)));}
if(desktop?.avatar){avatarUI=createAvatarUI({desktopAvatar:desktop.avatar,notice,openPermissions:()=>{workbench.showTab('document');agentIOUI.page.open=true;agentIOUI.refresh();agentIOUI.page.scrollIntoView({block:'nearest'});agentIOUI.page.querySelector('summary').focus();},updateStatus:()=>{$('avatar-toggle').setAttribute('aria-pressed',String(Boolean(avatarUI?.enabled)));updateStatus();},getDocumentContext:()=>({sessionId:store.sessionId,documentId:store.document.id,title:store.document.title,contentRevision:store.revision,slideId:store.activeSlideId,slideName:store.activeSlide?.name||titleForSlide(store.activeSlide),selectedIds:[...store.selectedIds]}),isPresenting:()=>Boolean(live||masterWorkspace?.active)});avatarUI.ready.catch(error=>notice(error.message,true));$('avatar-toggle').addEventListener('click',async()=>{const button=$('avatar-toggle');button.disabled=true;try{await avatarUI.toggle({returnFocus:button});}catch(error){notice(error.message,true);}finally{button.disabled=false;syncAvatarChrome();}});}else $('avatar-toggle').hidden=true;
document.querySelector('.prototype-badge').textContent='프레젠테이션 편집기';
$('save-button').title='편집용 HTML 저장 · 내용과 노트를 보존합니다 (Ctrl+S)';
$('bu-export').title='PDF·PNG·공유용 HTML 내보내기';
async function openFirstExample(){
  if(!mayReplace())return false;
  const generation=++openGeneration,token=changeToken(),response=await fetch('/examples/first-deck.json');
  if(!response.ok)throw Error('첫 자료 예제를 읽지 못했습니다.');
  const document={...await validateAssetBytes(normalizeDocument(await response.json())),id:createBlankDocument().id};
  await whenReady(()=>{if(generation!==openGeneration)throw Error('더 최근의 자료 열기 요청이 있습니다.');checkOpenToken(token);if(live)endLive();store.loadDocument(document);store.markUnsaved();desktopFile=null;render();notice('첫 자료 예제를 새 편집 세션으로 열었습니다. 내 HTML 파일로 저장하세요.');},true);
  return true;
}
createPublicSupport({container:$('ribbon-help'),openExample:openFirstExample,openExternal:desktop?.openExternal,notice,isComposing:composing});
document.querySelector('.prototype-badge').textContent='공개 베타';
start().then(()=>workbench.onReady());
