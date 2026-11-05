import { cloneDocument, normalizeDocument } from './model.js';
import { ADVANCED_SCHEMA, planMotionTimeline } from './advanced-motion-model.js';
import { createPresentationRuntime } from './presentation-runtime.js';
import { renderPresentationSlides } from './render.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = prefix => `${prefix}-${crypto.randomUUID()}`;
const properties = {x:'X 이동',y:'Y 이동',scale:'크기 배율',rotate:'회전 °',opacity:'불투명도',blur:'흐림 px'};
const pose = {x:0,y:0,scale:1,rotate:0,opacity:1,blur:0};
const frame = (offset,values={}) => ({offset,...pose,...values});
const names = {fadeIn:'등장',slideInLeft:'왼쪽 등장',slideInRight:'오른쪽 등장',slideInUp:'위로 등장',zoomIn:'확대 등장',fadeOut:'퇴장',slideOutRight:'오른쪽 퇴장',pulse:'강조',spin:'회전',keyframes:'키프레임'};

export function createTimelineWorkbench({store,workbench,action,notice,render,updateStatus,commitControls,preview,openExample}) {
  const page=document.createElement('div');page.id='tl-inspector';
  page.innerHTML=`<section class="property-section"><h3>시간과 움직임</h3><p class="property-help">아래 시간축에서 효과를 고르고 시작 시각·키프레임을 편집하세요. 재생 커서는 문서를 바꾸지 않습니다.</p><button id="tl-add" class="wb-wide">선택 개체에 키프레임 모션 추가</button><button id="tl-convert" class="wb-wide">선택 효과를 키프레임으로 전환</button><div id="tl-empty" class="property-help">효과를 선택하세요.</div><div id="tl-fields"><label class="stacked-label">대상<select id="tl-target"></select></label><label class="stacked-label">시작 단계<select id="tl-start"><option value="withPrevious">이전 효과와 같은 단계</option><option value="onClick">클릭으로 새 단계</option><option value="afterPrevious">이전 효과 완료 다음</option></select></label><div class="property-grid"><label>시작 ms<input id="tl-at" type="number" min="0" max="600000" step="10"></label><label>길이 ms<input id="tl-duration" type="number" min="1" max="60000" step="10"></label><label>반복<input id="tl-iterations" type="number" min="1" max="20" step="1"></label></div><label class="stacked-label">속도 곡선<select id="tl-easing"><option value="linear">일정하게</option><option value="ease">부드럽게</option><option value="ease-in">천천히 시작</option><option value="ease-out">천천히 마침</option><option value="ease-in-out">천천히 시작·마침</option></select></label><label class="stacked-label">텍스트 순차 재생<select id="tl-stagger"><option value="none">개체 전체</option><option value="character">글자별</option><option value="word">단어별</option><option value="paragraph">문단별</option></select></label><label class="stacked-label">글자/단어/문단 간격 ms<input id="tl-stagger-delay" type="number" value="70" min="0" max="2000"></label><div id="tl-keyframe-editor"><h3>키프레임</h3><div id="tl-frame-list" class="tl-frame-list"></div><label class="stacked-label">효과 내 시각 ms<input id="tl-frame-time" type="number" min="0" step="10"></label><div class="property-grid">${Object.entries(properties).map(([key,label])=>`<label>${label}<input id="tl-frame-${key}" type="number" step="${['scale','opacity'].includes(key)?'.05':'1'}"></label>`).join('')}</div><div class="wb-button-row"><button id="tl-frame-update">지점 적용</button><button id="tl-frame-add">지점 추가</button><button id="tl-frame-delete">지점 삭제</button></div><p class="property-help">시작·끝 지점은 유지합니다. 중간 지점을 추가해 경로·크기·회전·흐림을 함께 조절할 수 있습니다.</p></div><div class="wb-button-row"><button id="tl-apply">효과 적용</button><button id="tl-discard">변경 취소</button><button id="tl-delete">효과 삭제</button></div></div></section><section class="property-section"><h3>재사용 모션 씬</h3><label class="stacked-label">씬 이름<input id="tl-clip-name" maxlength="160" placeholder="예: 세 카드 소개"></label><button id="tl-save-clip" class="wb-wide">선택 개체의 모션을 씬으로 저장</button><label class="stacked-label">저장한 씬<select id="tl-clips"></select></label><p id="tl-clip-info" class="property-help"></p><div class="wb-button-row"><button id="tl-apply-clip">선택 개체에 씬 추가</button><button id="tl-delete-clip">씬 삭제</button></div><p class="property-help">서로 다른 대상 개수만큼 개체를 선택합니다. 레이어 순서로 연결하며 원래 효과는 보존합니다.</p></section>`;
  workbench.addInspectorPage('timeline','타임라인',page);
  const dock=document.createElement('section');dock.id='tl-dock';dock.className='tl-dock';dock.hidden=true;dock.setAttribute('aria-label','모션 타임라인');
  dock.innerHTML=`<div class="tl-dock-heading"><strong>타임라인</strong><span id="tl-duration-label"></span><label class="wb-check tl-pin-control"><input id="tl-pin" type="checkbox">작업 중 고정</label><button id="tl-play">▶ 재생</button><button id="tl-pause">일시정지</button><button id="tl-stop">원본 보기</button><button id="tl-full-preview">큰 미리보기</button><button id="tl-close" aria-label="타임라인 닫기">×</button></div><div class="tl-cursor-row"><label>재생 위치 <input id="tl-cursor" type="range" min="0" max="5000" step="10" value="0"></label><output id="tl-time">0.00초</output><label>확대 <select id="tl-zoom"><option value="60">60 px/초</option><option value="100" selected>100 px/초</option><option value="180">180 px/초</option></select></label></div><div id="tl-scroll" class="tl-scroll"><div id="tl-ruler" class="tl-ruler"></div><div id="tl-tracks"></div></div>`;
  document.querySelector('.workspace-footer').before(dock);
  const opener=document.createElement('button');opener.id='tl-open';opener.textContent='타임라인';document.querySelector('.toolbar').append(opener);
  const example=document.createElement('button');example.id='tl-example';example.textContent='고급 동작 예제';document.querySelector('.toolbar').append(example);
  const $=id=>document.getElementById(id),get=id=>$(id).value,num=id=>Number(get(id));
  let selected=null,draft=null,frameIndex=0,frameDirty=false,pending=false,context=null,drag=null,visible=false,pinned=false,player=null,previewHolder=null,previewSignature='',cursor=0,clockFrame=0,drawKey='',clipSelection=null;
  const current=()=>store.activeSlide.motions||[];
  const identity=()=>`${store.sessionId}:${store.activeSlideId}:${store.revision}`;
  const selectedMotion=()=>current().find(m=>m.id===selected);
  const run=fn=>action(fn);
  const bind=(id,fn)=>$(id).addEventListener('click',()=>run(fn));
  const title=id=>store.activeSlide.elements.find(e=>e.id===id)?.name||store.activeSlide.elements.find(e=>e.id===id)?.text?.paragraphs.find(Boolean)||id;
  let layoutCache=null;
  const layout=()=>{const key=identity();if(layoutCache?.key===key)return layoutCache.value;let base=0;const rows=[];for(const [groupIndex,group]of planMotionTimeline(store.activeSlide).entries()){for(const item of group.items)rows.push({...item,group:groupIndex,global:base+item.start});base+=group.duration;}const value={rows,total:Math.max(1000,base)};layoutCache={key,value};return value;};
  function stopPreview(){if(clockFrame)cancelAnimationFrame(clockFrame);clockFrame=0;const old=player;player=null;old?.destroy();previewHolder?.remove();previewHolder=null;previewSignature='';$('stage').classList.remove('tl-previewing');}
  function syncCursor(value){cursor=Math.max(0,Math.min(layout().total,Number(value)||0));$('tl-cursor').value=cursor;$('tl-time').textContent=(cursor/1000).toFixed(2)+'초';}
  function ensurePreview(){
    if(pending){readFields();if(frameDirty)readFrame();}
    const signature=previewKey();if(player&&previewSignature===signature)return player;
    stopPreview();previewSignature=signature;
    // Keep cross-slide action references valid; only paint the current section.
    let source=store.snapshot();if(pending&&draft){if(!['0.12-design.1','0.13-behavior.1','0.14-scene.1','0.15-authoring.1'].includes(source.schemaVersion))source.schemaVersion=ADVANCED_SCHEMA;source.slides.find(s=>s.id===store.activeSlideId).motions=current().map(m=>m.id===draft.id?cloneDocument(draft):m);source=normalizeDocument(source);}
    previewHolder=document.createElement('div');previewHolder.className='tl-preview';previewHolder.style.width=source.canvas.width+'px';previewHolder.style.height=source.canvas.height+'px';previewHolder.innerHTML=renderPresentationSlides(source);
    for(const type of ['pointerdown','mousedown','click','dblclick'])previewHolder.addEventListener(type,event=>event.stopPropagation());
    previewHolder.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Escape'&&!player?.getState().openPanels.length){event.preventDefault();queueMicrotask(stopPreview);}});
    $('stage').append(previewHolder);$('stage').classList.add('tl-previewing');
    player=createPresentationRuntime({root:previewHolder,document:source,initialSlideId:store.activeSlideId,reducedMotion:false,onChange:state=>{syncCursor(state.elapsed);$('tl-pause').textContent=state.paused?'계속 재생':'일시정지';}});
    return player;
  }
  function previewKey(){return identity()+(pending?JSON.stringify(draft):'');}
  function scrub(value){const at=Number(value);const runtime=ensurePreview();runtime.seekTimeline(at);syncCursor(at);}
  function setDockVisible(next){
    opener.setAttribute('aria-expanded',String(next));
    if(visible===next&&dock.hidden===!next)return;
    visible=next;dock.hidden=!next;if(!next)stopPreview();drawKey='';
    window.dispatchEvent(new Event('resize'));
  }
  function show(){workbench.showTab('timeline');setDockVisible(true);sync();}
  function hide(){pinned=false;$('tl-pin').checked=false;stopPreview();cancelDrag();setDockVisible(false);if(workbench.activePage==='timeline')workbench.showTab('motion');}
  opener.setAttribute('aria-expanded','false');opener.setAttribute('aria-controls','tl-dock');
  opener.addEventListener('click',show);
  $('tl-close').addEventListener('click',hide);example.addEventListener('click',openExample);
  $('tl-pin').addEventListener('change',()=>{pinned=$('tl-pin').checked;if(!pinned&&workbench.activePage!=='timeline')setDockVisible(false);});
  document.querySelector('[data-inspector-tab="timeline"]').addEventListener('click',show);
  $('tl-cursor').addEventListener('input',event=>{try{scrub(event.target.value);}catch(error){stopPreview();notice(error.message,true);}});
  $('tl-play').addEventListener('click',()=>{try{const runtime=ensurePreview();runtime.seekTimeline(cursor>=layout().total?0:cursor);runtime.play();}catch(error){stopPreview();notice(error.message,true);}});
  $('tl-pause').addEventListener('click',()=>{if(player)player.getState().paused?player.play():player.pause();});
  $('tl-stop').addEventListener('click',stopPreview);$('tl-full-preview').addEventListener('click',()=>run(()=>{stopPreview();preview(cursor);}));
  $('tl-zoom').addEventListener('change',()=>{drawKey='';draw();});
  function loadDraft(force=false){const motion=selectedMotion();if(!motion){selected=null;draft=null;pending=false;frameDirty=false;return;}if(force||!pending){draft=cloneDocument(motion);frameDirty=false;context=identity();frameIndex=Math.min(frameIndex,(draft.keyframes?.length||1)-1);}}
  function mark(){if(!draft)return;player?.pause();pending=true;context??=identity();updateStatus();}
  function readFields(){
    if(!draft)return;
    draft.targetId=get('tl-target');draft.start=get('tl-start');draft.duration=num('tl-duration');draft.at=num('tl-at');draft.delay=0;draft.easing=get('tl-easing');draft.iterations=num('tl-iterations');
    if(get('tl-stagger')==='none')delete draft.stagger;else draft.stagger={by:get('tl-stagger'),delay:num('tl-stagger-delay')};
  }
  function checkContext(){if(context!==identity())throw Error('모션을 편집하는 동안 자료가 바뀌었습니다. 변경을 취소하고 다시 선택하세요.');}
  function commitPending(){if(!pending)return;checkContext();readFields();const next=cloneDocument(draft);store.setMotions(store.activeSlideId,current().map(m=>m.id===next.id?next:m));pending=false;context=identity();draft=next;stopPreview();}
  function cancelPending(){pending=false;drag=null;loadDraft(true);drawKey='';sync();updateStatus();}
  for(const field of page.querySelectorAll('#tl-fields > label select,#tl-fields > label input,#tl-fields > .property-grid input'))field.addEventListener('input',()=>{if(frameDirty)readFrame();const duration=draft?.duration;readFields();if(duration!==draft?.duration)drawFrames();mark();});
  for(const field of page.querySelectorAll('#tl-keyframe-editor input'))field.addEventListener('input',()=>{frameDirty=true;mark();});
  // Pose controls are a local keyframe draft until "지점 적용"; saving commits them too.
  function readFrame(){if(!draft?.keyframes)return;const point=draft.keyframes[frameIndex];if(!point)return;for(const f of draft.keyframes)for(const key of Object.keys(properties))f[key]??=pose[key];const at=num('tl-frame-time')/draft.duration;point.offset=frameIndex===0?0:frameIndex===draft.keyframes.length-1?1:at;for(const key of Object.keys(properties))point[key]=num('tl-frame-'+key);frameDirty=false;}
  const originalCommit=commitPending;
  function commitAll(){if(drag)throw Error('타임라인 이동을 마친 뒤 저장하거나 다른 작업을 실행하세요.');if(pending&&frameDirty&&draft?.keyframes)readFrame();originalCommit();}
  function selectMotion(id){return run(()=>{stopPreview();selected=id;frameIndex=0;pending=false;loadDraft(true);if(draft)store.selectElements([draft.targetId],{expandGroups:false});});}
  bind('tl-add',()=>{
    const targets=store.selectedElements.filter(e=>!e.hidden&&!e.locked);if(!targets.length)throw Error('캔버스나 레이어에서 개체를 먼저 선택하세요.');
    const added=targets.map(e=>({id:uid('motion'),targetId:e.id,preset:'keyframes',start:'withPrevious',duration:1200,delay:0,at:0,easing:'ease-out',iterations:1,keyframes:[frame(0,{x:-120,opacity:0}),frame(.65,{x:18}),frame(1)]}));
    store.setMotions(store.activeSlideId,[...current(),...added]);selected=added[0].id;pending=false;loadDraft(true);show();
  });
  bind('tl-convert',()=>{const old=selectedMotion();if(!old)throw Error('시간축에서 효과를 선택하세요.');store.setMotions(store.activeSlideId,current().map(m=>m.id===old.id?{...m,preset:'keyframes',duration:Math.max(1,m.duration),keyframes:[frame(0),frame(1)]}:m));pending=false;loadDraft(true);});
  bind('tl-apply',commitAll);$('tl-discard').addEventListener('click',cancelPending);
  $('tl-delete').addEventListener('click',()=>{pending=false;frameDirty=false;run(()=>{store.setMotions(store.activeSlideId,current().filter(m=>m.id!==selected));selected=null;draft=null;});});
  // Frame edits stay within one effect edit until committed through the Controller.
  $('tl-frame-update').addEventListener('click',()=>{try{readFrame();mark();drawFrames();}catch(error){notice(error.message,true);}});
  $('tl-frame-add').addEventListener('click',()=>{
    if(!draft?.keyframes)return;const time=Math.max(0,Math.min(1,num('tl-frame-time')/draft.duration));
    if(draft.keyframes.some(k=>Math.abs(k.offset-time)<.000001)){notice('해당 시각에 이미 지점이 있습니다.',true);return;}
    for(const f of draft.keyframes)for(const key of Object.keys(properties))f[key]??=pose[key];const added=frame(time,Object.fromEntries(Object.keys(properties).map(key=>[key,num('tl-frame-'+key)])));draft.keyframes.push(added);draft.keyframes.sort((a,b)=>a.offset-b.offset);frameIndex=draft.keyframes.indexOf(added);frameDirty=false;mark();drawFrames();
  });
  $('tl-frame-delete').addEventListener('click',()=>{if(!draft?.keyframes||frameIndex===0||frameIndex===draft.keyframes.length-1)return;draft.keyframes.splice(frameIndex,1);frameIndex=Math.max(0,frameIndex-1);mark();drawFrames();});
  $('tl-frame-list').addEventListener('click',event=>{const button=event.target.closest('[data-frame-index]');if(!button)return;if(frameDirty)readFrame();frameIndex=Number(button.dataset.frameIndex);drawFrames();});
  function drawFrames(){
    $('tl-keyframe-editor').hidden=!draft?.keyframes;if(!draft?.keyframes)return;
    $('tl-frame-list').innerHTML=draft.keyframes.map((f,i)=>`<button data-frame-index="${i}" class="${i===frameIndex?'active':''}">${Math.round(f.offset*draft.duration)} ms</button>`).join('');
    const point=draft.keyframes[frameIndex];$('tl-frame-time').value=Math.round(point.offset*draft.duration);$('tl-frame-time').max=draft.duration;
    for(const key of Object.keys(properties))$('tl-frame-'+key).value=point[key]??pose[key];
    $('tl-frame-delete').disabled=frameIndex===0||frameIndex===draft.keyframes.length-1;
  }
  bind('tl-save-clip',()=>{
    const ids=store.activeSlide.elements.filter(e=>store.selectedIds.includes(e.id)).map(e=>e.id),tracks=current().filter(m=>ids.includes(m.targetId));
    if(!tracks.length)throw Error('모션이 있는 개체를 선택하세요.');const targets=[...new Set(tracks.map(m=>m.targetId))].sort((a,b)=>ids.indexOf(a)-ids.indexOf(b));
    const clip={id:uid('clip'),name:get('tl-clip-name').trim()||'새 모션 씬',tracks:tracks.map(({id,targetId,...m})=>({slot:targets.indexOf(targetId),...cloneDocument(m)}))};
    store.setMotionClips([...(store.document.motionClips||[]),clip]);clipSelection=clip.id;notice(`${targets.length}개 대상의 모션 씬을 저장했습니다.`);
  });
  bind('tl-apply-clip',()=>{
    const clip=store.document.motionClips?.find(c=>c.id===get('tl-clips'));if(!clip)throw Error('저장한 씬을 선택하세요.');
    const slots=Math.max(...clip.tracks.map(t=>t.slot))+1,targets=store.activeSlide.elements.filter(e=>store.selectedIds.includes(e.id)&&!e.hidden&&!e.locked);
    if(targets.length!==slots)throw Error(`이 씬에는 잠금/숨김이 없는 개체 ${slots}개를 선택하세요.`);
    const tracks=clip.tracks.map(({slot,...m})=>({...cloneDocument(m),id:uid('motion'),targetId:targets[slot].id}));store.setMotions(store.activeSlideId,[...current(),...tracks]);selected=tracks[0].id;loadDraft(true);notice('선택 개체에 씬을 추가했습니다. 실행 취소 한 번으로 되돌릴 수 있습니다.');
  });
  bind('tl-delete-clip',()=>{store.setMotionClips((store.document.motionClips||[]).filter(c=>c.id!==get('tl-clips')));clipSelection=null;});
  $('tl-clips').addEventListener('change',()=>{clipSelection=get('tl-clips');syncClipInfo();});
  function syncClipInfo(){const clip=store.document.motionClips?.find(c=>c.id===get('tl-clips'));$('tl-clip-info').textContent=clip?`${Math.max(...clip.tracks.map(t=>t.slot))+1}개 대상 · ${clip.tracks.length}개 효과`:'씬을 저장해 다른 장의 개체에도 적용할 수 있습니다.';}
  function draw(){
    if(!visible)return;const planned=layout(),scale=num('tl-zoom')/1000,width=Math.max(420,planned.total*scale+40);$('tl-cursor').max=planned.total;$('tl-duration-label').textContent=(planned.total/1000).toFixed(2)+'초 · '+planned.rows.length+'개 효과';
    const key=JSON.stringify([identity(),selected,width,planned.rows]);if(key===drawKey)return;drawKey=key;
    $('tl-ruler').style.width=(width+144)+'px';$('tl-ruler').innerHTML=`<span class="tl-track-label">개체 · 클릭 단계</span>${Array.from({length:Math.floor(planned.total/1000)+1},(_,i)=>`<span style="left:${144+i*1000*scale}px">${i}초</span>`).join('')}`;
    $('tl-tracks').innerHTML=planned.rows.length?planned.rows.map(row=>`<div class="tl-track" style="width:${width+144}px"><button class="tl-track-label" data-tl-select="${escape(row.motion.id)}" title="${escape(title(row.motion.targetId))}">${escape(title(row.motion.targetId))}<small>단계 ${row.group} · ${escape(names[row.motion.preset])}</small></button><div class="tl-track-lane" style="width:${width}px"><button class="tl-bar${selected===row.motion.id?' active':''}" data-tl-select="${escape(row.motion.id)}" data-tl-drag="${escape(row.motion.id)}" aria-label="${escape(title(row.motion.targetId))} 효과 이동" style="left:${row.global*scale}px;width:${Math.max(12,row.motion.duration*row.motion.iterations*scale)}px">${(row.motion.keyframes||[]).map((f,i)=>`<span class="tl-diamond" style="left:${f.offset*100}%" data-tl-frame="${i}"></span>`).join('')}<span class="tl-bar-label">${escape(names[row.motion.preset])}</span></button></div></div>`).join(''):'<p class="property-help tl-no-effects">개체 선택 → 키프레임 모션 추가. 기존 모션도 이 시간축에 표시됩니다.</p>';
  }
  $('tl-tracks').addEventListener('click',event=>{const button=event.target.closest('[data-tl-select]');if(button&&!drag)selectMotion(button.dataset.tlSelect);});
  $('tl-tracks').addEventListener('pointerdown',event=>{
    const bar=event.target.closest('[data-tl-drag]');if(!bar||event.button!==0)return;
    try{commitControls();store.finishText();stopPreview();const row=layout().rows.find(row=>row.motion.id===bar.dataset.tlDrag);if(!row)return;event.preventDefault();bar.setPointerCapture(event.pointerId);drag={id:row.motion.id,context:identity(),x:event.clientX,at:row.start,groupBase:row.global-row.start,bar,pointerId:event.pointerId,moved:false,next:row.start};updateStatus();}catch(error){notice(error.message,true);}
  });
  $('tl-tracks').addEventListener('pointermove',event=>{if(!drag||event.pointerId!==drag.pointerId)return;const dx=event.clientX-drag.x;drag.moved ||= Math.abs(dx)>3;drag.next=Math.max(0,Math.min(600000,Math.round((drag.at+dx/(num('tl-zoom')/1000))/10)*10));drag.bar.style.left=(drag.groupBase+drag.next)*(num('tl-zoom')/1000)+'px';});
  $('tl-tracks').addEventListener('pointerup',event=>{if(!drag||event.pointerId!==drag.pointerId)return;const ended=drag;drag=null;if(ended.bar.hasPointerCapture(event.pointerId))ended.bar.releasePointerCapture(event.pointerId);if(!ended.moved){selectMotion(ended.id);return;}run(()=>{if(ended.context!==identity())throw Error('자료가 바뀌어 모션 이동을 취소했습니다.');store.setMotions(store.activeSlideId,current().map(m=>m.id===ended.id?{...m,at:ended.next,delay:0}:m));selected=ended.id;loadDraft(true);});});
  function cancelDrag(){if(drag){const old=drag;drag=null;if(old.bar.hasPointerCapture(old.pointerId))old.bar.releasePointerCapture(old.pointerId);drawKey='';draw();updateStatus();}}
  $('tl-tracks').addEventListener('pointercancel',cancelDrag);window.addEventListener('blur',()=>{cancelDrag();player?.pause();});
  window.addEventListener('vividly:inspector-change',event=>{
    if(event.detail?.name==='timeline'){setDockVisible(true);sync();}
    else{stopPreview();cancelDrag();if(!pinned)setDockVisible(false);}
  });
  function sync(){
    if(!page.hidden&&!visible)setDockVisible(true);
    if(page.hidden&&visible&&!pinned)setDockVisible(false);
    if(player&&previewSignature!==previewKey())stopPreview();
    if(context&&!context.startsWith(`${store.sessionId}:${store.activeSlideId}:`)){pending=false;draft=null;selected=null;context=null;stopPreview();}
    if(selected&&!selectedMotion()){selected=null;draft=null;pending=false;}
    if(!pending){const selectedIds=store.selectedIds,old=selectedMotion();if(!old||!selectedIds.includes(old.targetId)){const next=current().find(m=>selectedIds.includes(m.targetId))?.id||null;if(next!==selected){selected=next;frameIndex=0;stopPreview();}}}
    if(!pending)loadDraft(true);
    $('tl-empty').hidden=Boolean(draft);$('tl-fields').hidden=!draft;$('tl-convert').disabled=!draft||draft.preset==='keyframes';
    if(draft&&!pending){
      $('tl-target').innerHTML=store.activeSlide.elements.filter(e=>!e.hidden).map(e=>`<option value="${escape(e.id)}">${escape(title(e.id))}</option>`).join('');
      for(const [id,value]of Object.entries({'tl-target':draft.targetId,'tl-start':draft.start,'tl-duration':draft.duration,'tl-at':draft.at??layout().rows.find(r=>r.motion.id===draft.id)?.start??0,'tl-easing':draft.easing,'tl-iterations':draft.iterations,'tl-stagger':draft.stagger?.by||'none','tl-stagger-delay':draft.stagger?.delay??70}))$(id).value=value;
      $('tl-stagger').disabled=!store.activeSlide.elements.find(e=>e.id===draft.targetId)?.text;drawFrames();
    }
    const clip=clipSelection||get('tl-clips');$('tl-clips').innerHTML=(store.document.motionClips||[]).map(c=>`<option value="${escape(c.id)}">${escape(c.name)}</option>`).join('');if([...$('tl-clips').options].some(o=>o.value===clip))$('tl-clips').value=clip;else clipSelection=null;syncClipInfo();draw();
  }
  sync();
  return {sync,show,stopPreview,commitPending:commitAll,cancelPending,get visible(){return visible;},get pinned(){return pinned;},get pendingChanges(){return pending||Boolean(drag);},draftSignature(){return pending||drag?JSON.stringify({context,draft,drag:drag?{id:drag.id,next:drag.next}:null}):null;}};
}
