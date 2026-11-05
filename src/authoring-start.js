import { createBlankDocument } from './model.js';
import { BUSINESS_TEMPLATES, BUSINESS_TEMPLATE_SLIDE_COUNT, createBusinessTemplate } from './business-templates.js';
import { renderSlideContent } from './render.js';
import { createPortfolioTemplate } from './portfolio-template.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sizes={wide:{width:1280,height:720,unit:'logical-px'},standard:{width:1200,height:900,unit:'logical-px'},portrait:{width:720,height:1280,unit:'logical-px'},square:{width:1080,height:1080,unit:'logical-px'},portrait34:{width:900,height:1200,unit:'logical-px'}};

export function createAuthoringStart({store,createDocument,openFile,notice,startWithAgent}){
  const dialog=document.createElement('dialog');dialog.id='wf-start-dialog';dialog.className='wf-start-dialog';dialog.setAttribute('aria-labelledby','wf-start-heading');
  dialog.innerHTML=`<div class="wf-dialog-heading"><div><h2 id="wf-start-heading">새 프레젠테이션</h2><p>빈 자료에서 시작하거나, 편집 가능한 업무 구성을 선택하세요.</p></div><button id="wf-start-close" aria-label="새 자료 창 닫기">닫기</button></div><div class="wf-start-options"><label>자료 제목<input id="wf-start-title" maxlength="160" placeholder="예: 11월 캠페인 성과 보고"></label><label>슬라이드 비율<select id="wf-start-size"><option value="wide">와이드 16:9</option><option value="standard">일반 4:3</option><option value="square">정사각 1:1</option><option value="portrait34">세로 3:4</option><option value="portrait">세로 9:16</option></select></label></div><div class="wf-start-choices"><button id="wf-start-blank"><img src="/assets/brand/vividly-mark.png" width="38" height="38" alt=""><strong>빈 자료</strong><span>한 장부터 직접 구성합니다.</span></button><button id="wf-start-open"><strong>저장한 자료 열기</strong><span>HTML 자료를 이어서 편집합니다.</span></button></div><h3 class="wf-start-section-title">업무 키트 ${BUSINESS_TEMPLATE_SLIDE_COUNT}장 · 웹 페이지로 시작</h3><div id="wf-start-templates" class="wf-start-templates"></div><p class="wf-start-note">키트의 제목·본문·표·차트·모션을 모두 수정할 수 있습니다. 웹 포트폴리오는 길게 스크롤하는 페이지로 시작합니다. 현재 자료에 장을 추가하려면 자료 패널의 키트를 사용하세요.</p><p id="wf-start-error" role="status"></p>`;
  document.body.append(dialog);
  const empty=document.createElement('section');empty.id='wf-empty-start';empty.className='wf-empty-start';empty.setAttribute('aria-label','빈 자료 시작 안내');
  empty.innerHTML=`<img src="/assets/brand/vividly-mark.png" alt="" width="48" height="48"><h2>아이디어를 첫 장으로.</h2><p>텍스트·이미지를 넣거나 업무 키트로 시작하세요.</p><div><button id="wf-start-launch" class="primary-button">자료 구성 선택</button><button id="wf-empty-text">텍스트 추가</button><button id="wf-empty-open">저장한 자료 열기</button></div><p class="wf-empty-tip">도구 찾기 Ctrl+Shift+P · 선택 개체 편집 F2</p>`;
  document.getElementById('stage-viewport').append(empty);
  const examples=document.createElement('details');examples.id='wf-examples';examples.className='wf-examples';examples.innerHTML='<summary>예제 보기</summary><div class="wf-example-menu"></div>';
  const buttons=['bu-open-example','mo-open-example','tl-example','wb-open-example'].map(id=>document.getElementById(id)).filter(Boolean);
  buttons.forEach(button=>examples.lastElementChild.append(button));document.querySelector('.toolbar').append(examples);
  for(const button of buttons)button.addEventListener('click',()=>{examples.open=false;});
  const $=id=>document.getElementById(id);
  if(typeof startWithAgent==='function'){
    const choice=document.createElement('button');choice.id='wf-start-agent';choice.type='button';
    choice.innerHTML='<strong>에이전트와 만들기</strong><span>대화로 새 자료를 구성하고 개체별로 수정합니다.</span>';
    $('wf-start-open').before(choice);choice.addEventListener('click',()=>choose('agent'));
    dialog.querySelector('.wf-start-choices').classList.add('with-agent');
  }
  let context=null,priorFocus=null,busy=false,request=0,opening=false;
  const token=()=>JSON.stringify({session:store.sessionId,revision:store.revision});
  const canvas=()=>structuredClone(sizes[$('wf-start-size').value]||sizes.wide);
  function renderTemplates(){
    $('wf-start-templates').innerHTML=BUSINESS_TEMPLATES.map(template=>{const doc=createBusinessTemplate(template.id,{canvas:canvas()}),scale=Math.min(270/doc.canvas.width,153/doc.canvas.height),left=(270-doc.canvas.width*scale)/2,top=(153-doc.canvas.height*scale)/2;return `<button data-start-template="${template.id}" class="wf-start-template"><div class="wf-template-preview"><div style="width:${doc.canvas.width}px;height:${doc.canvas.height}px;left:${left}px;top:${top}px;transform:scale(${scale});background:${doc.slides[0].background}">${renderSlideContent(doc.slides[0],doc)}</div></div><strong>${escape(template.name)}</strong><span>${escape(template.description)}</span></button>`;}).join('');
    const portfolio=createPortfolioTemplate(),scale=270/portfolio.canvas.width,button=document.createElement('button');button.dataset.startTemplate='portfolio';button.className='wf-start-template';
    button.innerHTML=`<div class="wf-template-preview"><div style="width:${portfolio.canvas.width}px;height:${portfolio.canvas.height}px;left:0;top:0;transform:scale(${scale});background:${portfolio.slides[0].background}">${renderSlideContent(portfolio.slides[0],portfolio)}</div></div><strong>웹 포트폴리오</strong><span>긴 페이지 · 반응형 카드·상세 창·프로필 입력</span>`;$('wf-start-templates').append(button);
  }
  function close(restore=true){request++;if(dialog.open)dialog.close();busy=false;context=null;if(restore&&priorFocus?.isConnected)priorFocus.focus();}
  function open(){
    if(document.querySelector('dialog[open]')&& !dialog.open){notice('현재 편집 창을 먼저 마치세요.');return;}
    request++;opening=true;priorFocus=document.activeElement;context=null;$('wf-start-title').value='';$('wf-start-error').textContent='';
    const {width,height}=store.document.canvas;$('wf-start-size').value=Math.abs(width/height-1)<.02?'square':Math.abs(width/height-3/4)<.02?'portrait34':width<height?'portrait':Math.abs(width/height-4/3)<.05?'standard':'wide';renderTemplates();busy=true;if(!dialog.open)dialog.showModal();$('wf-start-title').focus();context=token();opening=false;
  }
  async function choose(kind){
    if(busy==='creating')return;
    if(context!==token()){$('wf-start-error').textContent='자료가 바뀌었습니다. 창을 닫고 다시 시작해 주세요.';return;}
    const agent=kind==='agent',web=kind==='portfolio',doc=web?createPortfolioTemplate():kind==='blank'||agent?createBlankDocument():createBusinessTemplate(kind,{canvas:canvas()});if(!web)doc.canvas=canvas();const title=$('wf-start-title').value.trim();if(title)doc.title=title;
    const selectedRequest=++request,isCurrent=()=>request===selectedRequest&&dialog.open;
    busy='creating';try{const created=await createDocument(doc,{isCurrent});if(created&&isCurrent()){const sessionId=store.sessionId;close(false);if(agent&&store.sessionId===sessionId)await startWithAgent({sessionId,documentId:store.document.id});}}catch(error){if(isCurrent())$('wf-start-error').textContent=error.message;else if(agent)notice('새 자료는 열었습니다. 에이전트 연결을 확인하세요: '+error.message,true);}finally{if(request===selectedRequest)busy=dialog.open;}
  }
  $('wf-start-close').addEventListener('click',()=>close());$('wf-start-launch').addEventListener('click',open);
  $('wf-empty-text').addEventListener('click',()=>$('add-text').click());$('wf-empty-open').addEventListener('click',openFile);
  $('wf-start-blank').addEventListener('click',()=>choose('blank'));
  $('wf-start-templates').addEventListener('click',event=>{const button=event.target.closest('[data-start-template]');if(button)choose(button.dataset.startTemplate);});
  $('wf-start-size').addEventListener('change',renderTemplates);
  $('wf-start-open').addEventListener('click',()=>{close(false);openFile();});
  dialog.addEventListener('cancel',event=>{event.preventDefault();if(dialog.dataset.composing!=='true')close();});
  dialog.addEventListener('compositionstart',()=>{dialog.dataset.composing='true';});dialog.addEventListener('compositionend',()=>{delete dialog.dataset.composing;});
  dialog.addEventListener('keydown',event=>{event.stopPropagation();if(event.isComposing||dialog.dataset.composing==='true'){if(event.key==='Escape')event.preventDefault();return;}if(event.key==='Escape'){event.preventDefault();close();}});
  function sync(){empty.hidden=Boolean(store.activeSlide.elements.length)||Boolean(document.getElementById('presentation')&&!document.getElementById('presentation').hidden);if(dialog.open&&!opening&&context!==token())$('wf-start-error').textContent='자료가 바뀌었습니다. 창을 닫고 다시 시작해 주세요.';}
  sync();return{open,close,sync,get busy(){return Boolean(busy||dialog.open);}};
}
