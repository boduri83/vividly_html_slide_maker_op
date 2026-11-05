import { normalizeDocument } from './model.js';
import { canonicalBase64 } from './safe-base64.js';
import { CONTENT_CSS, renderSlide } from './render.js';
import { installChartJs } from './chart-vendor.js';
import { createChartRuntime } from './chart-runtime.js';
import { fontStack } from './font-names.js';
import { createMediaRuntime } from './media-runtime.js';
import { createPresentationRuntime, PRESENTATION_RUNTIME_CSS } from './presentation-runtime.js';
import { staticDocument,normalizeOutputState } from './business-render.js';
import {createBehaviorRuntime}from './behavior-runtime.js';
import {createBehaviorEvaluator}from './behavior-model.js';
import {resolveConnectorGeometry}from './business-model.js';
import {createSceneRuntime}from './scene-runtime.js';
import {installScenePhysics}from './scene-vendor.js';
import {projectResponsiveSlide}from './responsive-model.js';
import {createWebRuntime}from './web-authoring-runtime.js';
import {exportLicenseNotices}from './export-license-notices.js';
import {getExportRuntimeSourceBundle}from './export-source-bundle.js';

const METADATA_ID = 'html-slide-document';
const RUNTIME_SOURCE_ID = 'vividly-runtime-source';
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const SHA256_K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

function safeJson(value) {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function decodeBase64(value) {
  if (!canonicalBase64(value)) throw new Error('자산 base64 데이터가 손상됐습니다.');
  const length = value.length / 4 * 3 - (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0);
  const result = new Uint8Array(length);
  let position = 0;
  for (let index = 0; index < value.length; index += 4) {
    const a = BASE64.indexOf(value[index]);
    const b = BASE64.indexOf(value[index + 1]);
    const c = value[index + 2] === '=' ? 0 : BASE64.indexOf(value[index + 2]);
    const d = value[index + 3] === '=' ? 0 : BASE64.indexOf(value[index + 3]);
    if ((value[index + 2] === '=' && (b & 15)) || (value[index + 3] === '=' && value[index + 2] !== '=' && (c & 3))) throw new Error('이미지 base64 padding이 올바르지 않습니다.');
    const word = (a << 18) | (b << 12) | (c << 6) | d;
    if (position < length) result[position++] = (word >>> 16) & 255;
    if (position < length) result[position++] = (word >>> 8) & 255;
    if (position < length) result[position++] = word & 255;
  }
  return result;
}

// A small portable fallback keeps synchronous export/parse byte checks available offline.
function sha256(bytes) {
  const length = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(length);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(length - 8, Math.floor(bytes.length / 0x20000000));
  view.setUint32(length - 4, (bytes.length * 8) >>> 0);
  const hash = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const words = new Uint32Array(64);
  const rotate = (word, count) => (word >>> count) | (word << (32 - count));
  for (let offset = 0; offset < length; offset += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4);
    for (let index = 16; index < 64; index += 1) {
      const a = words[index - 15]; const b = words[index - 2];
      const first = rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3);
      const second = rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10);
      words[index] = (words[index - 16] + first + words[index - 7] + second) >>> 0;
    }
    let [a,b,c,d,e,f,g,h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sum = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
      const choice = (e & f) ^ (~e & g);
      const first = (h + sum + choice + SHA256_K[index] + words[index]) >>> 0;
      const sigma = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const second = (sigma + majority) >>> 0;
      h = g; g = f; f = e; e = (d + first) >>> 0;
      d = c; c = b; b = a; a = (first + second) >>> 0;
    }
    const state = [a,b,c,d,e,f,g,h];
    for (let index = 0; index < 8; index += 1) hash[index] = (hash[index] + state[index]) >>> 0;
  }
  return hash.map((word) => word.toString(16).padStart(8, '0')).join('');
}

function checkedSnapshot(document) {
  const snapshot = normalizeDocument(document);
  for (const asset of snapshot.assets) {
    const bytes = decodeBase64(asset.dataBase64);
    if (bytes.length !== asset.bytes || sha256(bytes) !== asset.sha256) throw new Error(`자산 byte 수 또는 SHA-256이 일치하지 않습니다: ${asset.id}`);
  }
  return snapshot;
}

/** Returns a detached validated document; usable with browser or Node Web Crypto. */
export async function validateAssetBytes(document) {
  const snapshot = normalizeDocument(document);
  for (const asset of snapshot.assets) {
    const bytes = decodeBase64(asset.dataBase64);
    let hash;
    if (globalThis.crypto?.subtle) {
      const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
      hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    } else hash = sha256(bytes);
    if (bytes.length !== asset.bytes || hash !== asset.sha256) throw new Error(`자산 byte 수 또는 SHA-256이 일치하지 않습니다: ${asset.id}`);
  }
  return snapshot;
}

const PRESENTATION_CSS = `
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#111827;color:#f8fafc;font-family:system-ui,sans-serif}
.presentation-viewport{position:fixed;inset:0 0 58px;display:flex;align-items:center;justify-content:center;overflow:hidden}
.presentation-stage{position:relative;flex:none;transform-origin:center center;box-shadow:0 12px 70px #0008}
.presentation-slide[hidden]{display:none!important}
body[data-web-presentation=true] .presentation-controls,body[data-web-presentation=true] #presentation-runtime-tools{display:none}body[data-web-presentation=true] .presentation-viewport{inset:0}
.presentation-controls{position:fixed;bottom:0;left:0;right:0;height:58px;display:flex;align-items:center;justify-content:center;gap:16px;background:#182235;padding:8px}
.presentation-controls button,#presentation-resume{border:1px solid #60718a;background:#26364e;color:#fff;border-radius:6px;padding:8px 16px;font:inherit;cursor:pointer}
.presentation-controls button:disabled{opacity:.4;cursor:default}.presentation-controls button:focus-visible,#presentation-resume:focus-visible{outline:3px solid #93c5fd;outline-offset:2px}
#presentation-counter{min-width:70px;text-align:center}#presentation-ended{position:fixed;inset:0;display:grid;place-content:center;text-align:center;gap:16px;background:#111827;z-index:3}#presentation-ended[hidden]{display:none}
@media print{html,body{overflow:visible;background:#fff}.presentation-viewport{position:static;display:block;overflow:visible}.presentation-stage{transform:none!important;width:auto!important;height:auto!important;box-shadow:none}.presentation-slide,.presentation-slide[hidden]{display:block!important;position:relative!important;break-after:page}.presentation-controls,#presentation-ended{display:none!important}}
`;

const PRESENTATION_SCRIPT = `(() => {
  'use strict';
  const slides = Array.from(document.querySelectorAll('.presentation-slide[data-slide-id]'));
  const stage = document.getElementById('presentation-stage');
  const viewport = document.querySelector('.presentation-viewport');
  const counter = document.getElementById('presentation-counter');
  const previous = document.getElementById('presentation-prev');
  const next = document.getElementById('presentation-next');
  const ended = document.getElementById('presentation-ended');
  let index = 0;
  function fit() {
    const width = Number(stage.dataset.width); const height = Number(stage.dataset.height);
    const scale = Math.min(viewport.clientWidth / width, viewport.clientHeight / height);
    stage.style.transform = 'scale(' + Math.max(0.01, scale) + ')';
  }
  function fromHash() {
    let id; try { id = decodeURIComponent(location.hash.slice(1)); } catch { return 0; }
    const found = slides.findIndex(slide => slide.dataset.slideId === id);
    return found < 0 ? 0 : found;
  }
  function show(value, updateHash = true) {
    index = Math.max(0, Math.min(slides.length - 1, value));
    slides.forEach((slide, at) => { slide.hidden = at !== index; slide.setAttribute('aria-hidden', String(at !== index)); });
    counter.textContent = (index + 1) + ' / ' + slides.length;
    previous.disabled = index === 0; next.disabled = index === slides.length - 1;
    if (updateHash) {
      const hash = '#' + encodeURIComponent(slides[index].dataset.slideId);
      if (location.hash !== hash) { try { history.replaceState(null, '', hash); } catch { location.hash = hash; } }
    }
  }
  function finish() { ended.hidden = false; document.getElementById('presentation-resume').focus(); }
  function resume() { ended.hidden = true; (previous.disabled ? (next.disabled ? document.getElementById('presentation-exit') : next) : previous).focus(); fit(); }
  previous.addEventListener('click', () => show(index - 1));
  next.addEventListener('click', () => show(index + 1));
  document.getElementById('presentation-exit').addEventListener('click', finish);
  document.getElementById('presentation-resume').addEventListener('click', resume);
  addEventListener('hashchange', () => { ended.hidden = true; show(fromHash(), false); });
  addEventListener('resize', fit);
  addEventListener('keydown', event => {
    if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'Escape') { event.preventDefault(); finish(); return; }
    if (!ended.hidden) return;
    const keys = ['ArrowRight','ArrowDown','PageDown','ArrowLeft','ArrowUp','PageUp','Home','End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home') show(0);
    else if (event.key === 'End') show(slides.length - 1);
    else if (['ArrowLeft','ArrowUp','PageUp'].includes(event.key)) show(index - 1);
    else show(index + 1);
  });
  show(fromHash()); fit();
})();`;

const MOTION_PRESENTATION_CSS = `
.presentation-controls{gap:10px;font-size:13px}.presentation-controls button{padding:7px 12px}
#presentation-step{min-width:68px;color:#b9c9df;font-size:11px}#presentation-seek{width:min(18vw,220px);accent-color:#7b9cff}
@media(max-width:760px){.presentation-controls{justify-content:flex-start;overflow-x:auto}.presentation-controls>*{flex-shrink:0;white-space:nowrap}#presentation-seek{width:90px}.presentation-controls{gap:6px}.presentation-controls button{padding:7px 8px;font-size:11px}#presentation-step{min-width:0}}
`;

function motionPresentationScript(hasCharts=false,hasMedia=false,hasScene=false) {
  return `(() => {
  'use strict';
  ${hasMedia?'globalThis.createVividlyMediaRuntime='+createMediaRuntime.toString()+';':''}
  ${hasCharts?installChartJs.toString()+';installChartJs();globalThis.createVividlyChartRuntime='+createChartRuntime.toString()+';':''}
  globalThis.createVividlyBehaviorEvaluator=${createBehaviorEvaluator.toString()};
  globalThis.createVividlyBehaviorRuntime=${createBehaviorRuntime.toString()};
  globalThis.projectVividlyResponsiveSlide=${projectResponsiveSlide.toString()};
  globalThis.createVividlyWebRuntime=${createWebRuntime.toString()};
  ${hasScene?'('+installScenePhysics.toString()+')(globalThis);globalThis.createVividlySceneRuntime='+createSceneRuntime.toString()+';':''}
  const createPresentationRuntime = ${createPresentationRuntime.toString()};
  const authored = JSON.parse(document.getElementById('${METADATA_ID}').textContent);
  const stage = document.getElementById('presentation-stage'), viewport = document.querySelector('.presentation-viewport');
  const counter = document.getElementById('presentation-counter'), previous = document.getElementById('presentation-prev'), next = document.getElementById('presentation-next');
  const pause = document.getElementById('presentation-pause'), seek = document.getElementById('presentation-seek'), step = document.getElementById('presentation-step'), ended = document.getElementById('presentation-ended');
  let player, resumePlaying = true;
  function fit() {
    if(authored.responsive?.enabled){
      const frame=player?.resizeViewport(viewport.clientWidth,viewport.clientHeight);if(!frame)return;if(authored.responsive.showControls===false)viewport.style.background=authored.slides[player.getState().index].background;
      viewport.style.alignItems='flex-start';viewport.style.overflow='auto';stage.style.width=frame.width+'px';stage.style.height=frame.height+'px';stage.style.transformOrigin='top center';stage.style.transform='scale('+frame.scale+')';
    }else{const scale=Math.min(viewport.clientWidth/authored.canvas.width,viewport.clientHeight/authored.canvas.height);stage.style.transform='scale('+Math.max(.01,scale)+')';}
  }
  function initial() { try { return decodeURIComponent(location.hash.slice(1)); } catch { return undefined; } }
  function finish() { resumePlaying = !player.getState().paused; player.pause(); ended.hidden = false; document.getElementById('presentation-resume').focus(); }
  player = createPresentationRuntime({ root: stage, document: authored, initialSlideId: initial(), onEnd: finish,
    onChange(state) {
      counter.textContent = (state.index + 1) + ' / ' + authored.slides.length;
      previous.disabled = !state.canPrevious; next.disabled = !state.canNext;
      pause.textContent = state.paused ? '재생' : '일시정지'; pause.setAttribute('aria-pressed', String(state.paused));
      step.textContent = '단계 ' + state.step + ' / ' + state.stepCount;
      seek.max = String(Math.max(1, state.duration)); if (document.activeElement !== seek) seek.value = String(Math.min(state.elapsed, state.duration));
      const hash = '#' + encodeURIComponent(state.slideId); if (location.hash !== hash) { try { history.replaceState(null, '', hash); } catch { location.hash = hash; } }
      fit();
    }
  });
  Object.defineProperty(window, 'vividlyPresentation', { value: player });
  const runtimeTools=document.getElementById('presentation-runtime-tools'),runtimeStatus=document.getElementById('presentation-runtime-status');
  if(runtimeTools){
    const report=message=>runtimeStatus.textContent=message;
    document.getElementById('presentation-progress-save').addEventListener('click',async()=>{try{const dto=await player.exportProgress(),url=URL.createObjectURL(new Blob([JSON.stringify(dto,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='Vividly-progress.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);report('진행을 저장했습니다.');}catch(e){report(e.message);}});
    const file=document.getElementById('presentation-progress-file');document.getElementById('presentation-progress-open').addEventListener('click',()=>file.click());file.addEventListener('change',async()=>{try{const selected=file.files[0];if(!selected)return;if(selected.size>2*1024*1024)throw Error('진행 파일은 2MB 이하여야 합니다.');await player.importProgress(JSON.parse(await selected.text()));report('진행을 불러왔습니다. 재생을 눌러 계속하세요.');}catch(e){report(e.message);}finally{file.value='';}});
    const mute=document.getElementById('presentation-mute');mute?.addEventListener('click',async()=>{try{if(player.getState().scene?.muted){await player.enableAudio();mute.textContent='음소거';mute.setAttribute('aria-pressed','false');const errors=Object.values(player.getState().scene?.audio||{}).filter(a=>a.error).map(a=>a.error);report(errors[0]||'음향을 사용할 수 있습니다.');}else{player.setMuted(true);mute.textContent='소리 켜기';mute.setAttribute('aria-pressed','true');report('음소거했습니다.');}}catch(e){report(e.message);}});
  }
  previous.addEventListener('click', () => player.previous()); next.addEventListener('click', () => player.next());
  pause.addEventListener('click', () => player.getState().paused ? player.play() : player.pause());
  document.getElementById('presentation-reset').addEventListener('click', () => player.reset());
  seek.addEventListener('input', () => { player.pause(); player.seek(Number(seek.value)); });
  document.getElementById('presentation-exit').addEventListener('click', finish);
  document.getElementById('presentation-resume').addEventListener('click', () => { ended.hidden = true; if (resumePlaying) player.play(); (previous.disabled ? pause : previous).focus(); fit(); });
  addEventListener('hashchange', () => { const id = initial(); if (id && id !== player.getState().slideId) { ended.hidden = true; player.goTo(id); } });
  addEventListener('resize', fit);
  addEventListener('keydown', event => {
    if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || authored.responsive?.enabled&&authored.responsive.showControls===false) return;
    if (event.key === 'Escape') { if (event.target?.matches?.('select')) return; event.preventDefault(); finish(); return; }
    if (!ended.hidden || player.isInteractiveTarget(event.target)) return;
    if (['ArrowRight','ArrowDown','PageDown','Enter',' '].includes(event.key)) { event.preventDefault(); player.next(); }
    else if (['ArrowLeft','ArrowUp','PageUp'].includes(event.key)) { event.preventDefault(); player.previous(); }
    else if (event.key === 'Home') { event.preventDefault(); player.goTo(0); }
    else if (event.key === 'End') { event.preventDefault(); player.goTo(authored.slides.length - 1); }
  });
  addEventListener('pagehide', () => player.destroy(), { once: true });
  fit();
})();`;
}

/** Standalone offline presentation and editable metadata from one detached snapshot. */
export function exportPresentation(document,{includeNotes=true}={}) {
  const snapshot = checkedSnapshot(document);
  if(typeof includeNotes!=='boolean')throw new Error('노트 포함 설정이 올바르지 않습니다.');
  if(!includeNotes)for(const slide of snapshot.slides)delete slide.notes;
  const { width, height } = snapshot.canvas;
  const slides = snapshot.slides.map((slide, index) => renderSlide(slide, snapshot).replace('<section ', `<section${index ? ' hidden' : ''} `)).join('\n');
  const motion = ['0.3-motion.1','0.4-business.1','0.5-motion.1','0.12-design.1','0.13-behavior.1','0.14-scene.1','0.15-authoring.1'].includes(snapshot.schemaVersion),hasScene=snapshot.slides.some(s=>s.scene),hasRuntimeTools=hasScene||snapshot.behavior||snapshot.slides.some(s=>s.behavior);
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">${exportLicenseNotices(snapshot)}<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="generator" content="Vividly ${escapeHtml(snapshot.schemaVersion)}"><title>${escapeHtml(snapshot.title)}</title><style>${CONTENT_CSS}\n${PRESENTATION_CSS}${motion ? '\n' + PRESENTATION_RUNTIME_CSS + '\n' + MOTION_PRESENTATION_CSS : ''}</style></head>
<body${snapshot.responsive?.enabled&&snapshot.responsive.showControls===false?' data-web-presentation="true"':''}><main aria-label="${escapeHtml(snapshot.title)}"><div class="presentation-viewport"><div id="presentation-stage" class="presentation-stage" data-width="${width}" data-height="${height}" style="width:${width}px;height:${height}px">${slides}</div></div></main>
<nav class="presentation-controls" aria-label="발표 이동"><button id="presentation-prev" type="button" disabled>이전</button><output id="presentation-counter" aria-live="polite">1 / ${snapshot.slides.length}</output><button id="presentation-next" type="button"${snapshot.slides.length === 1 && !motion ? ' disabled' : ''}>다음</button>${motion ? '<output id="presentation-step" aria-live="polite">단계 0</output><button id="presentation-pause" type="button" aria-pressed="false">일시정지</button><button id="presentation-reset" type="button">처음부터</button><input id="presentation-seek" type="range" min="0" max="1" value="0" aria-label="현재 단계 재생 위치">' : ''}<button id="presentation-exit" type="button">발표 종료</button></nav>
${hasRuntimeTools?'<details id="presentation-runtime-tools" style="position:fixed;right:16px;bottom:70px;z-index:4;padding:8px 12px;border:1px solid #60718a;border-radius:8px;background:#182235;color:white;font:14px/1.5 system-ui;max-width:min(360px,calc(100vw - 32px))"><summary style="cursor:pointer">진행'+(hasScene?' · 소리':'')+'</summary><div style="display:flex;gap:6px;flex-wrap:wrap;padding-top:8px"><button id="presentation-progress-save" type="button">진행 저장</button><button id="presentation-progress-open" type="button">진행 불러오기</button><input id="presentation-progress-file" type="file" accept=".json,application/json" hidden>'+(hasScene?'<button id="presentation-mute" type="button" aria-pressed="true">소리 켜기</button>':'')+'<p id="presentation-runtime-status" role="status" style="width:100%;margin:4px 0 0;overflow-wrap:anywhere"></p></div></details>':''}
<section id="presentation-ended" hidden aria-label="발표 종료"><h1>발표를 종료했습니다</h1><p>Vividly에서 이 HTML 파일을 다시 열어 편집할 수 있습니다.</p><button id="presentation-resume" type="button">발표로 돌아가기</button></section>
<script type="application/json" id="${METADATA_ID}">${safeJson(snapshot)}</script>
<script type="application/json" id="${RUNTIME_SOURCE_ID}">${safeJson(getExportRuntimeSourceBundle())}</script>
<script>${motion ? motionPresentationScript(snapshot.slides.some(s=>s.elements.some(e=>e.type==='chart')),snapshot.slides.some(s=>s.elements.some(e=>e.type==='video')),hasScene) : PRESENTATION_SCRIPT}</script></body></html>`;
}

/** Detached, script-free pages for PDF/PNG preview. The author document is never changed. */
function initialBehaviorProjection(document,state){
  const copy=JSON.parse(JSON.stringify(document)),shown=new Set(state.shownIds||[]),opened=new Set(state.openPanels||[]),poses=new Map();
  let physics;
  for(const slide of copy.slides){if(!slide.behavior&&!slide.scene)continue;const indexed=new Map(slide.elements.map(e=>[e.id,e])),visible=new Map(slide.elements.map(e=>[e.id,!e.hidden&&!e.initiallyHidden]));
    for(const panel of slide.elements.filter(e=>e.component?.kind==='panel'&&!e.component.initiallyOpen))for(const id of[panel.id,...(panel.component.contentIds||[])])visible.set(id,false);
    const setVisible=(id,wanted)=>{const element=indexed.get(id);if(!element||element.hidden)return false;visible.set(id,wanted);if(wanted){shown.add(id);element.initiallyHidden=false;}else{shown.delete(id);element.initiallyHidden=true;}if(element.component?.kind==='panel'){if(wanted)opened.add(id);else opened.delete(id);for(const child of element.component.contentIds||[])setVisible(child,wanted);}return true;};
    const spatial=slide.scene?createSceneRuntime({document:copy,Matter:physics??=installScenePhysics({}),isVisible:id=>visible.get(id)===true}):null;spatial?.enterSlide(slide.id);
    const player=createBehaviorRuntime({document:copy,createEvaluator:createBehaviorEvaluator,sceneRuntime:spatial,canSource:id=>!id||visible.get(id)===true&&indexed.get(id)?.design?.disabled!==true,applyEffect(action){
      if(['show','hide','toggle'].includes(action.type))return setVisible(action.targetId,action.type==='show'?true:action.type==='hide'?false:!visible.get(action.targetId));
      if(action.type==='setStyleState'||action.type==='resetStyleState'){const element=indexed.get(action.targetId);if(!element)return false;const style=action.type==='setStyleState'?element.states?.find(s=>s.id===action.stateId)?.style:null;if(style){element.__staticBehaviorStyle=JSON.parse(JSON.stringify(style));poses.set(element.id,style);}else{delete element.__staticBehaviorStyle;poses.delete(element.id);}return true;}
      return true;
    }});
    player.enterSlide(slide.id,{isPaused:true});slide.__behaviorInitialValues=player.getState().variables;
    if(spatial){const initial=spatial.getState();slide.__sceneInitialBodies=initial.bodies;slide.__sceneInitialSprites=initial.sprites;slide.__sceneInitialCamera=initial.camera;for(const[id,p]of Object.entries(initial.bodies)){const e=indexed.get(id);e.geometry={...e.geometry,x:p.x,y:p.y};e.rotation=p.angle;}spatial.destroy();}player.destroy();
  }
  return{document:copy,state:{...state,shownIds:[...shown],openPanels:[...opened]},poses};
}
export function createStaticExport(document,{slideIds,scene='complete',includeNotes=false,state={}}={}) {
  const snapshot=checkedSnapshot(document);
  if(typeof includeNotes!=='boolean')throw new Error('노트 포함 설정이 올바르지 않습니다.');
  const ids=slideIds===undefined?snapshot.slides.map(s=>s.id):slideIds;
  if(!Array.isArray(ids)||!ids.length||ids.length>200||new Set(ids).size!==ids.length||ids.some(id=>!snapshot.slides.some(s=>s.id===id)))throw new Error('출력할 슬라이드를 1~200장 선택하세요.');
  const resolved=normalizeOutputState(snapshot,state),behaviorInitial=initialBehaviorProjection(snapshot,resolved),staticCopy=staticDocument(behaviorInitial.document,{scene,state:behaviorInitial.state});
  for(const slide of staticCopy.slides){for(const element of slide.elements){const behavior=behaviorInitial.poses.get(element.id);if(!behavior)continue;const pose=element.__staticMotionPose||{};if(['x','y','rotate','scale'].some(key=>behavior[key]!==undefined))element.__staticMotionPose={...pose,x:(behavior.x||0)+(pose.x||0),y:(behavior.y||0)+(pose.y||0),rotate:(behavior.rotate||0)+(pose.rotate||0),scale:(behavior.scale??1)*(pose.scale??1)};}
    const posed={elements:slide.elements.map(element=>{const p=element.__staticMotionPose;if(!p)return element;const g=element.geometry,s=p.scale??1;return{...element,rotation:(element.rotation||0)+(p.rotate||0),geometry:{x:g.x+(p.x||0)+g.width*(1-s)/2,y:g.y+(p.y||0)+g.height*(1-s)/2,width:g.width*s,height:g.height*s}};})};for(const element of slide.elements)if(element.type==='connector')element.__staticConnector=resolveConnectorGeometry(element,posed);
  }
  const selected=ids.map(id=>staticCopy.slides.find(s=>s.id===id)),{width,height}=snapshot.canvas;
  const columns=Math.max(1,Math.floor((width-80)/32));
  const notesHeight=includeNotes?Math.max(0,...selected.map(s=>s.notes?72+s.notes.split('\n').reduce((sum,line)=>sum+Math.max(1,Math.ceil([...line].length/columns)),0)*24:0)):0;
  const pageHeight=height+notesHeight;
  if(width>8192||pageHeight>8192||width*pageHeight>64*1024*1024)throw new Error('출력 한 장은 8192px 및 64M 픽셀 이하로 줄여 주세요. 긴 노트는 노트 제외로 출력할 수 있습니다.');
  const pages=selected.map(slide=>`<article class="business-output-page" data-slide-id="${escapeHtml(slide.id)}">${renderSlide(slide,staticCopy,{staticState:behaviorInitial.state})}${includeNotes&&slide.notes?`<aside class="business-output-notes" aria-label="발표자 노트"><h2>발표자 노트</h2><p>${escapeHtml(slide.notes)}</p></aside>`:''}</article>`).join('\n');
  const html=`<!doctype html><html lang="ko"><head><meta charset="utf-8">${exportLicenseNotices({slides:selected})}<template id="${RUNTIME_SOURCE_ID}" data-format="application/json">${escapeHtml(JSON.stringify(getExportRuntimeSourceBundle()))}</template><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'"><title>${escapeHtml(snapshot.title)}</title><style>${CONTENT_CSS}${PRESENTATION_RUNTIME_CSS}\n*{box-sizing:border-box}html,body{margin:0;padding:0;width:${width}px;background:#fff;font-family:${fontStack(snapshot.theme?.fontFamily||'Malgun Gothic,Arial,sans-serif')}}.business-output-page{position:relative;width:${width}px;height:${pageHeight}px;overflow:hidden;break-after:page;page-break-after:always}.business-output-page:last-child{break-after:auto;page-break-after:auto}.business-output-notes{position:absolute;top:${height}px;left:0;width:100%;padding:20px 40px;font:16px/24px "Malgun Gothic",Arial,sans-serif;color:#182037}.business-output-notes h2{font-size:16px;margin:0 0 12px}.business-output-notes p{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}.presentation-slide{overflow:hidden}@page{size:${width}px ${pageHeight}px;margin:0}@media print{html,body{width:${width}px;-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body>${pages}</body></html>`;
  return {html,width,height:pageHeight,canvasHeight:height,slideIds:[...ids],scene,includeNotes,state:behaviorInitial.state};
}

function metadataBlocks(html) {
  const blocks = [];
  const scripts = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let script;
  while ((script = scripts.exec(html))) {
    const attributes = new Map();
    const matcher = /(?:^|\s)([a-zA-Z][\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
    let attribute;
    while ((attribute = matcher.exec(script[1]))) {
      const name = attribute[1].toLowerCase();
      if (attributes.has(name)) throw new Error('중복된 HTML metadata 속성입니다.');
      attributes.set(name, attribute[2] ?? attribute[3] ?? attribute[4]);
    }
    if (attributes.get('id') === METADATA_ID) {
      if (attributes.get('type')?.toLowerCase() !== 'application/json') throw new Error('문서 metadata는 application/json이어야 합니다.');
      blocks.push(script[2]);
    }
  }
  return blocks;
}

/** Reads only typed document metadata. Imported HTML and scripts are never executed. */
export function parsePresentation(html) {
  if (typeof html !== 'string') throw new Error('HTML 문자열이 필요합니다.');
  const blocks = metadataBlocks(html);
  if (blocks.length === 0) throw new Error('Vividly 문서의 편집 정보가 없습니다. 임의 HTML은 가져올 수 없습니다.');
  if (blocks.length !== 1) throw new Error('문서 metadata가 여러 개여서 가져올 수 없습니다.');
  let decoded;
  try { decoded = JSON.parse(blocks[0]); } catch { throw new Error('문서 metadata JSON이 손상됐습니다.'); }
  const snapshot = checkedSnapshot(decoded);
  // Validate renderable styles without reading or importing the source HTML DOM.
  for (const slide of snapshot.slides) renderSlide(slide, snapshot);
  return snapshot;
}
