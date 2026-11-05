import {renderSlideContent} from './render.js';
import {createChartRuntime} from './chart-runtime.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/** Page selection is temporary UI state; only the final import enters shared history. */
export function createKitPicker({store,notice,updateStatus}){
  const style=document.createElement('style');
  style.textContent=`#kit-picker-dialog{width:min(1040px,94vw);max-height:88vh;padding:0;border:1px solid #d9e1ef;border-radius:12px;color:#243653}#kit-picker-dialog[open]{display:flex;flex-direction:column}#kit-picker-dialog::backdrop{background:#18203966}#kit-picker-dialog header,#kit-picker-dialog footer{display:flex;align-items:center;gap:12px;padding:17px 22px;background:#fff;flex:none}#kit-picker-dialog h2{margin:0;font-size:20px}#kit-picker-dialog p{margin:5px 0;font-size:12px;color:#718099}#kit-picker-dialog header>div{flex:1}#kit-picker-dialog button{font:inherit;padding:7px 12px;border:1px solid #d5deeb;border-radius:6px;background:#fff;cursor:pointer}#kit-picker-dialog button:disabled{opacity:.45;cursor:default}#kit-picker-dialog #kp-apply{background:#5047d8;color:white;border-color:#5047d8}#kp-pages{display:grid;grid-template-columns:repeat(auto-fill,minmax(218px,1fr));gap:14px;padding:18px 22px;overflow:auto;min-height:0;background:#f4f6fb}#kp-pages label{display:block;border:1px solid #d7e0ec;border-radius:8px;background:white;padding:8px;cursor:pointer;min-width:0}#kp-pages label:has(input:checked){border-color:#7b6ce3;box-shadow:0 0 0 1px #7b6ce3}#kp-pages .kp-thumb{height:128px;position:relative;overflow:hidden;pointer-events:none;background:#e9edf7;border-radius:4px}#kp-pages .kp-thumb>div{position:absolute;left:50%;top:50%;transform-origin:center}#kp-pages .kp-name{display:flex;align-items:flex-start;gap:7px;padding-top:9px;font-size:11px;line-height:1.5}#kp-pages .kp-name span{overflow-wrap:anywhere}#kp-pages input{accent-color:#6254dd}#kp-status{flex:1;font-size:12px;color:#718099}#kp-all,#kp-none{font-size:11px!important}`;
  document.head.append(style);
  const dialog=document.createElement('dialog');dialog.id='kit-picker-dialog';dialog.setAttribute('aria-labelledby','kp-title');
  dialog.innerHTML='<header><div><h2 id="kp-title">키트에서 장 선택</h2><p>필요한 장만 골라 현재 자료 끝에 추가합니다.</p></div><button id="kp-all">모두 선택</button><button id="kp-none">선택 해제</button><button id="kp-close" aria-label="장 선택 닫기">닫기</button></header><div id="kp-pages"></div><footer><span id="kp-status" role="status"></span><button id="kp-apply">선택한 장 추가</button></footer>';
  document.body.append(dialog);
  const $=id=>dialog.querySelector('#'+id);let settle=null,owner=null,focus=null,charts=[];
  const selected=()=>[...dialog.querySelectorAll('[data-kit-slide]:checked')].map(node=>node.value);
  const current=()=>owner?.session===store.sessionId&&owner?.revision===store.revision;
  function buttons(){const count=selected().length;$('kp-status').textContent=current()?`${count}장 선택`:'자료가 바뀌었습니다. 창을 닫고 다시 선택하세요.';$('kp-apply').disabled=!current()||!count;}
  function close(value=null){if(!settle)return;const resolve=settle;settle=null;charts.forEach(chart=>chart.destroy());charts=[];dialog.close();owner=null;$('kp-pages').replaceChildren();updateStatus();if(focus?.isConnected)focus.focus();resolve(value);}
  function choose(source,name){
    if(settle||document.querySelector('dialog[open]')){notice('현재 편집 창을 먼저 마치세요.');return Promise.resolve(null);}
    owner={session:store.sessionId,revision:store.revision};focus=document.activeElement;$('kp-title').textContent=name+' · 장 선택';
    $('kp-pages').innerHTML=source.slides.map((slide,index)=>{const scale=Math.min(218/source.canvas.width,128/source.canvas.height);return `<label><div class="kp-thumb"><div data-kit-preview="${escape(slide.id)}" style="width:${source.canvas.width}px;height:${source.canvas.height}px;background:${slide.background};transform:translate(-50%,-50%) scale(${scale})">${renderSlideContent(slide,source)}</div></div><span class="kp-name"><input type="checkbox" data-kit-slide value="${escape(slide.id)}" checked><span>${index+1}. ${escape(slide.name||slide.elements.find(e=>e.semanticRole==='heading')?.text?.paragraphs?.join(' ')||'슬라이드')}</span></span></label>`;}).join('');
    const promise=new Promise(resolve=>settle=resolve);dialog.showModal();
    for(const slide of source.slides){const root=[...dialog.querySelectorAll('[data-kit-preview]')].find(node=>node.dataset.kitPreview===slide.id),runtime=createChartRuntime({root,document:source,interactive:false,animate:false});runtime.sync({slideId:slide.id,animate:false});charts.push(runtime);}
    buttons();updateStatus();$('kp-apply').focus();return promise;
  }
  $('kp-close').onclick=()=>close();$('kp-apply').onclick=()=>{if(current()&&selected().length)close(selected());};
  $('kp-all').onclick=()=>{dialog.querySelectorAll('[data-kit-slide]').forEach(node=>node.checked=true);buttons();};$('kp-none').onclick=()=>{dialog.querySelectorAll('[data-kit-slide]').forEach(node=>node.checked=false);buttons();};
  dialog.addEventListener('change',buttons);dialog.addEventListener('cancel',event=>{event.preventDefault();close();});dialog.addEventListener('keydown',event=>event.stopPropagation());
  return{choose,close,sync(){if(dialog.open)buttons();},get busy(){return Boolean(settle||dialog.open);}};
}
