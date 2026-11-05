/**
 * Shared, self-contained player. Its source is embedded verbatim in exported HTML.
 * It owns transient DOM/clock state only; authored document data is never changed.
 */
export function createPresentationRuntime({ root, document: source, initialSlideId, onChange, onEnd, onOpenLink, reducedMotion, chartRuntimeFactory = globalThis.createVividlyChartRuntime, mediaRuntimeFactory = globalThis.createVividlyMediaRuntime,behaviorRuntimeFactory=globalThis.createVividlyBehaviorRuntime,createBehaviorEvaluatorFactory=globalThis.createVividlyBehaviorEvaluator,sceneRuntimeFactory=globalThis.createVividlySceneRuntime,scenePhysics=globalThis.VividlyPhysics,responsiveProjector=globalThis.projectVividlyResponsiveSlide,webRuntimeFactory=globalThis.createVividlyWebRuntime,saveFormData } = {}) {
  if (!root || !source?.slides?.length) throw new Error('발표 루트와 문서가 필요합니다.');
  const authored = JSON.parse(JSON.stringify(source));
  const hasScene=authored.slides.some(slide=>slide.scene),hasBehavior=Boolean(hasScene||authored.behavior||authored.slides.some(slide=>slide.behavior));
  if(hasScene&&typeof sceneRuntimeFactory!=='function')throw Error('이 문서에는 장면 실행 엔진이 필요합니다.');
  if(hasBehavior&&(typeof behaviorRuntimeFactory!=='function'||typeof createBehaviorEvaluatorFactory!=='function'))throw Error('이 문서에는 동작 실행 엔진이 필요합니다.');
  const owner = root.ownerDocument, win = owner.defaultView || globalThis;
  const sections = [...root.querySelectorAll('.presentation-slide[data-slide-id]')];
  const lookup = new Map(sections.map(section => [section.dataset.slideId, section]));
  if (authored.slides.some(slide => !lookup.has(slide.id))) throw new Error('모든 슬라이드의 발표 DOM이 필요합니다.');
  if(authored.responsive?.enabled&&typeof responsiveProjector!=='function')throw Error('반응형 배치 실행 함수가 필요합니다.');
  const responsiveRootStyle=authored.responsive?.enabled?root.getAttribute('style'):undefined;
  let lastViewport={width:authored.canvas.width,height:authored.canvas.height},responsiveFrame=null;
  const reduce = reducedMotion ?? Boolean(win.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const hadRootClass = root.classList.contains('vividly-runtime-root');
  root.classList.add('vividly-runtime-root');
  const originals = sections.map(section => ({ section, style:section.getAttribute('style'), hidden: section.hidden, aria: section.getAttribute('aria-hidden'), inert: section.inert,
    nodes: [...section.querySelectorAll('.slide-element[data-element-id]')].map(node => ({ node, attributes: [...node.attributes].map(a => [a.name, a.value]), html: node.innerHTML })) }));
  let index = Math.max(0, authored.slides.findIndex(slide => slide.id === initialSlideId));
  let elapsed = 0, step = 0, paused = false, destroyed = false, frame = 0, lastTick = 0, ended = false, dispatching = false;
  let records = [], numbers = [], groups = [], nodes = new Map(), elements = new Map(), panels = new Map(), openPanels = [], manualVisibility = new Map();
  let elementStates = new Map(), triggerCounts = new Map(), wheelDistances = new Map(), viewObserver = null, viewInside = new Map(), textSegments = new Map(), customBaselines = new Map();
  let designVisuals = new Map(), designInputs = new Map();
  let behaviorPlayer=null,behaviorPointer=null,behaviorConsumedClick=false,behaviorInputScope=false,behaviorLastTick=0;
  let scenePlayer=null,sceneLayer=null,sceneGeneration=0,progressToken=0,presentationGeneration=0,restoringProgress=false,motionRuns=[];
  const sceneAudio=new Map();let sceneAudioEnabled=false,sceneMuted=true,transportAudioResume=new Set();
  const behaviorComposing=new Set();
  const activationKeys=new Set();
  const chartPlayer=chartRuntimeFactory?.({root,document:authored,Chart:win.Chart,interactive:true,animate:!reduce,reducedMotion:reduce});
  const mediaPlayer=mediaRuntimeFactory?.({root,document:authored});
  const webPlayer=webRuntimeFactory?.({root,document:authored,onLayout:()=>resizeViewport(lastViewport.width,lastViewport.height),goTo:slideId=>goTo(slideId,{interaction:true}),getValues:()=>behaviorPlayer?.getState().variables||{},setValues:patch=>{if(!behaviorPlayer?.setRuntimeValues)throw Error('입력 값 실행 엔진이 필요합니다.');const changed=behaviorPlayer.setRuntimeValues(patch);syncBehaviorBindings();emit();return changed;},openPanel,closePanel,saveData:saveFormData,openLink:href=>onOpenLink?onOpenLink(href):win.open?.(href,'_blank','noopener')});
  const interactionOnly=()=>slide().transition?.navigation==='interaction';
  let variables = Object.fromEntries((authored.variables || []).map(variable => [variable.id, variable.initialValue]));
  const listeners = [];
  const now = () => win.performance?.now?.() ?? Date.now();
  const slide = () => authored.slides[index];
  const section = () => lookup.get(slide().id);
  const listen = (target, type, handler, options) => { target.addEventListener(type, handler, options); listeners.push(() => target.removeEventListener(type, handler, options)); };
  const entrance = preset => ['fadeIn', 'slideInLeft', 'slideInRight', 'slideInUp', 'zoomIn'].includes(preset);
  const exit = preset => ['fadeOut', 'slideOutRight'].includes(preset);
  const recordEnd = record => record.start + record.delay + record.duration * record.iterations;
  const duration = () => Math.max(0, ...records.map(recordEnd), ...numbers.map(number => number.start + number.duration));
  function plan(motions) {
    const result = [{ items: [], duration: 0 }];
    let group = result[0], blockStart = 0, blockEnd = 0;
    for (const motion of motions || []) {
      if (motion.start === 'onClick') { group = { items: [], duration: 0 }; result.push(group); blockStart = 0; blockEnd = 0; }
      if (!nodes.has(motion.targetId)) continue;
      if (motion.start === 'afterPrevious') { blockStart = blockEnd; }
      const start = (motion.at ?? blockStart) + motion.delay;
      group.items.push({ motion, start });
      const extra = motion.stagger ? Math.max(0, segmentCount(elements.get(motion.targetId), motion.stagger.by) - 1) * motion.stagger.delay : 0;
      blockEnd = Math.max(blockEnd, start + motion.duration * motion.iterations + extra);
      group.duration = Math.max(group.duration, blockEnd);
    }
    return result.filter((group, at) => at === 0 || group.items.length > 0);
  }
  function state() {
    return { slideId: slide().id, index, step, stepCount: Math.max(0, groups.length - 1), paused, elapsed, duration: duration(),
      variables: { ...variables }, openPanels: [...openPanels], elementStates: Object.fromEntries(elementStates), reducedMotion: reduce, ended,
      navigation: interactionOnly()?'interaction':'sequential', canNext: step < groups.length - 1 || !interactionOnly()&&index < authored.slides.length - 1,
      canPrevious: step > 0 || !interactionOnly()&&index > 0,
      activeAnimations: records.filter(record => elapsed < recordEnd(record)).length,...(responsiveFrame?{viewport:{width:responsiveFrame.width,height:responsiveFrame.height,profile:responsiveFrame.profile}}:{}),...(behaviorPlayer?{behavior:behaviorPlayer.getState()}:{}),...(scenePlayer?{scene:scenePlayer.getState()}:{}) };
  }
  function emit() { if (!destroyed&&!restoringProgress) onChange?.(state()); }
  function sceneAudioChanged(){if(!destroyed){emit();schedule();}}
  function clearSceneAudio(){sceneGeneration++;transportAudioResume.clear();for(const r of sceneAudio.values()){r.generation++;r.node.pause();r.remove();r.node.removeAttribute('src');r.node.load();win.URL.revokeObjectURL(r.url);}sceneAudio.clear();}
  async function playSceneAudio(id){const r=sceneAudio.get(id);if(!r||destroyed)return false;r.requested=true;if(!sceneAudioEnabled){r.error='소리 켜기를 눌러 음향을 시작하세요.';sceneAudioChanged();return false;}if([...sceneAudio.values()].filter(r=>!r.node.paused).length>=16&&r.node.paused){r.error='음향은 동시에 16개까지 재생할 수 있습니다.';sceneAudioChanged();return false;}const active=sceneGeneration,token=++r.generation;r.node.muted=sceneMuted;try{if(r.pendingPosition!==undefined&&Number.isFinite(r.node.duration)){r.node.currentTime=r.pendingPosition;delete r.pendingPosition;}await r.node.play();if(destroyed||active!==sceneGeneration||token!==r.generation){if(active!==sceneGeneration||!r.requested)r.node.pause();return false;}r.error=null;sceneAudioChanged();return true;}catch(error){if(active===sceneGeneration&&token===r.generation){r.error=error?.name==='NotAllowedError'?'소리 켜기를 눌러 다시 시작하세요.':'음향을 재생하지 못했습니다. 파일 형식과 코덱을 확인하세요.';sceneAudioChanged();}return false;}}
  function pauseSceneAudio(id,reset=false){transportAudioResume.delete(id);const r=sceneAudio.get(id);if(!r)return false;r.generation++;r.node.pause();r.requested=false;if(reset){try{r.node.currentTime=0;}catch{}r.pendingPosition=0;}sceneAudioChanged();return true;}
  const sceneAudioAdapter={
    clear:clearSceneAudio,
    configure(definitions,muted){sceneMuted=muted;for(const def of definitions){const asset=authored.assets.find(a=>a.id===def.assetId);if(!asset)continue;const raw=win.atob(asset.dataBase64),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);const url=win.URL.createObjectURL(new win.Blob([bytes],{type:asset.mimeType})),audio=new win.Audio(),r={node:audio,url,definition:def,generation:0,requested:false,error:null};audio.preload='metadata';audio.loop=def.loop;audio.volume=def.volume;audio.muted=muted;const ended=()=>{r.requested=false;behaviorPlayer?.dispatch('audioEnd',{audioId:def.id});sceneAudioChanged();},failed=()=>{r.error='음향을 읽을 수 없습니다. 다른 파일을 선택하세요.';sceneAudioChanged();},loaded=()=>{if(r.pendingPosition!==undefined){try{audio.currentTime=r.pendingPosition;delete r.pendingPosition;}catch{}}};audio.addEventListener('ended',ended);audio.addEventListener('error',failed);audio.addEventListener('loadedmetadata',loaded);r.remove=()=>{audio.removeEventListener('ended',ended);audio.removeEventListener('error',failed);audio.removeEventListener('loadedmetadata',loaded);};sceneAudio.set(def.id,r);audio.src=url;}},
    playAudio:playSceneAudio,pauseAudio:id=>pauseSceneAudio(id),stopAudio:id=>pauseSceneAudio(id,true),pauseAll({remember=false}={}){const resume=remember?new Set([...sceneAudio].filter(([,r])=>r.requested||!r.node.paused).map(([id])=>id)):new Set();for(const id of sceneAudio.keys())pauseSceneAudio(id);transportAudioResume=resume;},resume(){const ids=[...transportAudioResume];transportAudioResume.clear();for(const id of ids)void playSceneAudio(id);},
    async enableAudio(){sceneAudioEnabled=true;sceneMuted=false;scenePlayer?.setMuted(false);return Promise.all([...sceneAudio].filter(([,r])=>r.requested&&r.node.paused).map(([id])=>playSceneAudio(id)));},
    setMuted(value){sceneMuted=value;for(const r of sceneAudio.values())r.node.muted=value;sceneAudioChanged();},
    getState(){return Object.fromEntries([...sceneAudio].map(([id,r])=>[id,{playing:!r.node.paused,position:r.node.currentTime||0,requested:r.requested,...(r.error?{error:r.error}:{})}]));},
    snapshot(){return Object.fromEntries([...sceneAudio].map(([id,r])=>[id,{position:r.node.currentTime||r.pendingPosition||0}]));},
    restore(dto){for(const[id,p]of Object.entries(dto)){const r=sceneAudio.get(id);if(r){pauseSceneAudio(id);r.pendingPosition=p.position;try{r.node.currentTime=p.position;}catch{}}}},destroy:clearSceneAudio
  };
  function sceneVisible(id){const node=nodes.get(id);if(!node||node.closest('[hidden]'))return false;const style=win.getComputedStyle(node);return style.visibility!=='hidden'&&style.display!=='none';}
  function setupSceneLayer(){sceneLayer=null;if(!slide().scene)return;const hud=new Set(slide().scene.hudIds||[]),layer=owner.createElement('div');layer.dataset.vividlyOwned='scene-world';layer.style.cssText='position:absolute;inset:0;transform-origin:0 0;pointer-events:none';for(const child of [...section().children]){if(child.matches?.('.slide-element')&&!hud.has(child.dataset.elementId)||child.matches?.('[data-runtime-panel]')&&![...child.querySelectorAll('.slide-element')].some(n=>hud.has(n.dataset.elementId))){child.style.pointerEvents='auto';layer.append(child);}}section().prepend(layer);sceneLayer=layer;}
  function syncSceneProjection(){if(!scenePlayer)return;const scene=scenePlayer.getState();for(const[id,p]of Object.entries(scene.bodies)){const node=nodes.get(id);if(node){node.style.left=p.x+'px';node.style.top=p.y+'px';node.style.transform='rotate('+p.angle+'deg)';}}
    if(sceneLayer){const c=scene.camera;sceneLayer.style.transform='translate('+(-c.x*c.zoom)+'px,'+(-c.y*c.zoom)+'px) scale('+c.zoom+')';}
    for(const[id,s]of Object.entries(scene.sprites)){const svg=nodes.get(id)?.querySelector('[data-scene-sprite]'),clip=slide().scene?.sprites?.find(s=>s.targetId===id)?.clips.find(c=>c.id===s.clipId),f=clip?.frames[s.frame];if(svg&&f){const view=[f.x,f.y,f.width,f.height].join(' ');if(svg.getAttribute('viewBox')!==view)svg.setAttribute('viewBox',view);}}
  }
  function restore(entry) {
    for (const item of entry.nodes) {
      for (const attr of [...item.node.attributes]) item.node.removeAttribute(attr.name);
      for (const [name, value] of item.attributes) item.node.setAttribute(name, value);
      item.node.innerHTML = item.html;
      entry.section.append(item.node);
    }
    entry.section.querySelectorAll('[data-vividly-owned]').forEach(node => node.remove());
    if(entry.style===null)entry.section.removeAttribute('style');else entry.section.setAttribute('style',entry.style);
    entry.section.hidden = entry.hidden;
    if (entry.aria === null) entry.section.removeAttribute('aria-hidden'); else entry.section.setAttribute('aria-hidden', entry.aria);
    entry.section.inert = entry.inert;
  }
  function cancel() {
    if (frame) win.cancelAnimationFrame(frame);
    frame = 0;
    for (const record of records) record.animation?.cancel();
    records = []; numbers = []; lastTick = 0;
    viewObserver?.disconnect(); viewObserver = null;
  }
  function activeStyle(id) { return elements.get(id)?.states?.find(item => item.id === elementStates.get(id))?.style || {}; }
  const disabledSource=id=>elements.get(id)?.design?.disabled===true;
  function originalStyleFor(id) {
    const node=nodes.get(id),original=originals.flatMap(item=>item.nodes).find(item=>item.node===node);
    const style=owner.createElement('div');style.setAttribute('style',designVisuals.get(id)?.current?.style||original?.attributes.find(([name])=>name==='style')?.[1]||'');
    return style.style;
  }
  function applyDesignVisual(id,initial=false) {
    const node=nodes.get(id),entry=designVisuals.get(id);if(!node||!entry)return false;
    const input=designInputs.get(id)||{},mode=disabledSource(id)?'disabled':[['pressed',input.pressed||input.keyPressed],['focus',input.focus],['hover',input.hover]].find(([name,active])=>active&&entry.visuals[name])?.[0]||'base';
    if(!initial&&entry.mode===mode)return false;
    entry.mode=mode;entry.current=entry.visuals[mode]||entry.visuals.base;
    node.style.cssText=entry.current.style;applyResponsiveGeometry(id);node.dataset.designState=mode;
    if(entry.current.textStyle!==null)for(const text of node.querySelectorAll('.element-text-content'))text.style.cssText=entry.current.textStyle;
    if(entry.current.shape){const svg=node.querySelector('.element-shape-geometry');if(svg)svg.outerHTML=entry.current.shape;}
    if(!initial)setState(id,elementStates.get(id)||null);
    return true;
  }
  function designInput(event,kind,value) {
    const node=sourceNode(event.target,'design');if(!node||node.contains(event.relatedTarget)||sourceNode(event.relatedTarget,'design')===node)return;
    const id=node.dataset.elementId;if(!designVisuals.has(id)||disabledSource(id))return;
    const input=designInputs.get(id)||{};input[kind]=value;designInputs.set(id,input);applyDesignVisual(id);
  }
  function releaseDesignInputs(clearAll=false,keyOnly=false) {
    for(const[id,input]of designInputs){if(keyOnly)input.keyPressed=false;else input.pressed=false;if(clearAll){input.hover=false;input.focus=false;input.keyPressed=false;}applyDesignVisual(id);}
  }
  function setupDesignStates() {
    for(const[id,node]of nodes){
      if(node.dataset.designVisuals){
        const visuals=JSON.parse(node.dataset.designVisuals);
        if(!visuals?.base||typeof visuals.base.style!=='string')throw new Error('디자인 상태의 표시 데이터가 올바르지 않습니다.');
        designVisuals.set(id,{visuals,mode:null,current:visuals.base});designInputs.set(id,{});applyDesignVisual(id,true);
        if(visuals.focus&&!disabledSource(id)&&!node.hasAttribute('tabindex'))node.tabIndex=0;
      }
      if(disabledSource(id)){
        node.setAttribute('aria-disabled','true');node.tabIndex=-1;
        for(const child of node.querySelectorAll('button,input,select,textarea,a,[tabindex]')){if('disabled'in child)child.disabled=true;child.tabIndex=-1;}
      }
    }
  }
  function setState(id, stateId) {
    const node = nodes.get(id), element = elements.get(id);
    if (!node || !element || stateId !== null && !element.states?.some(item => item.id === stateId)) return false;
    if (stateId === null) elementStates.delete(id); else elementStates.set(id, stateId);
    const originalStyle = {style:originalStyleFor(id)};
    const style = activeStyle(id);
    // Named states sit above the automatic appearance, including a CSS-painted
    // SVG fill. Rebuild only its visual SVG so reset restores the active recipe.
    const designShape=designVisuals.get(id)?.current?.shape;
    if(designShape){const svg=node.querySelector('.element-shape-geometry');if(svg)svg.outerHTML=designShape;}
    if(node.dataset.presetShape==='true'){
      node.style.background=originalStyle.style.background;
      node.style.setProperty('--vividly-shape-fill',style.fill??originalStyle.style.getPropertyValue('--vividly-shape-fill'));
      if(style.fill!==undefined)for(const paint of node.querySelectorAll('foreignObject[data-design-shape-paint] > div'))paint.style.background=style.fill;
    }else node.style.background = style.fill ?? originalStyle.style.background;
    node.style.opacity = style.opacity ?? originalStyle.style.opacity;
    node.style.borderRadius = node.dataset.presetShape==='true'?'0px':style.radius !== undefined ? `${style.radius}px` : originalStyle.style.borderRadius;
    node.style.transform = `${style.x!==undefined||style.y!==undefined?`translate(${style.x||0}px,${style.y||0}px) `:''}${originalStyle.style.transform || `rotate(${element.rotation || 0}deg)`}${style.rotate!==undefined?` rotate(${style.rotate}deg)`:''}${style.scale !== undefined ? ` scale(${style.scale})` : ''}`;
    node.style.filter = [originalStyle.style.filter,style.blur!==undefined?`blur(${style.blur}px)`:'',style.shadow?`drop-shadow(${style.shadow.x}px ${style.shadow.y}px ${style.shadow.blur}px ${style.shadow.color})`:''].filter(Boolean).join(' ');
    if (style.color) { node.dataset.runtimeStateColor = ''; node.style.setProperty('--vividly-state-color', style.color); }
    else { delete node.dataset.runtimeStateColor; node.style.removeProperty('--vividly-state-color'); }
    if (stateId === null) delete node.dataset.runtimeState; else node.dataset.runtimeState = stateId;
    if (customBaselines.has(node)) {
      // A state changes the underlying appearance. Tracks keep ownership only of
      // their animated properties; unanimated opacity/filter must use this state.
      customBaselines.set(node, { transform: node.style.transform, opacity: node.style.opacity, filter: node.style.filter });
      for (const record of records.filter(record => record.custom && record.node === node)) {
        record.keyframes = customFrames(record.motion, node);
        record.animation?.effect?.setKeyframes(record.keyframes);
      }
    }
    update(); emit(); return true;
  }
  function graphemes(value) {
    return typeof Intl.Segmenter === 'function' ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].map(item => item.segment) : Array.from(value);
  }
  function segmentCount(element, by) {
    const paragraphs = element?.text?.paragraphs || [];
    if (by === 'paragraph') return Math.max(1, paragraphs.length);
    const text = paragraphs.join('\n');
    if (typeof Intl.Segmenter === 'function') {
      const parts = [...new Intl.Segmenter(undefined, { granularity: by === 'word' ? 'word' : 'grapheme' }).segment(text)];
      return Math.max(1, by === 'word' ? parts.filter(part => part.isWordLike).length : parts.length);
    }
    return Math.max(1, by === 'word' ? text.split(/\s+/u).filter(Boolean).length : Array.from(text).length);
  }
  function segmentsFor(node, by) {
    const key = `${node?.dataset.elementId}:${by}`;
    if (textSegments.has(key)) return textSegments.get(key);
    const target = node?.querySelector('.element-paragraphs');
    if (!target) return [];
    let result = [], ordinal = 0;
    if (by === 'paragraph') result = [...target.querySelectorAll('p')].map((part, index) => { part.dataset.runtimeSegment = ''; part.dataset.runtimeSegmentIndex = String(index); return part; });
    else {
      // Segment whole paragraphs, then wrap text-node intersections in place.
      // A word across bold/link boundaries shares one time index without flattening marks.
      for (const paragraph of target.querySelectorAll('p')) {
        const value = paragraph.textContent, granularity = by === 'word' ? 'word' : 'grapheme';
        const parts = typeof Intl.Segmenter === 'function' ? [...new Intl.Segmenter(undefined, { granularity }).segment(value)] :
          (by === 'word' ? [...value.matchAll(/\S+|\s+/gu)].map(match => ({ segment: match[0], index: match.index, isWordLike: /\S/u.test(match[0]) })) : (() => { let offset = 0; return graphemes(value).map(segment => { const part = { segment, index: offset }; offset += segment.length; return part; }); })());
        const ranges = parts.filter(part => by !== 'word' || part.isWordLike).map(part => ({ start: part.index, end: part.index + part.segment.length, index: ordinal++ }));
        const walker = owner.createTreeWalker(paragraph, 4), textNodes = []; let offset = 0;
        while (walker.nextNode()) textNodes.push(walker.currentNode);
        for (const text of textNodes) {
          const start = offset, end = start + text.data.length, fragment = owner.createDocumentFragment(); let cursor = start;
          for (const range of ranges.filter(range => range.start < end && range.end > start)) {
            const first = Math.max(start, range.start), last = Math.min(end, range.end);
            if (first > cursor) fragment.append(owner.createTextNode(text.data.slice(cursor - start, first - start)));
            const part = text.data.slice(first - start, last - start);
            if (/^\s+$/u.test(part)) { fragment.append(owner.createTextNode(part)); cursor = last; continue; }
            const span = owner.createElement('span');
            span.dataset.runtimeSegment = ''; span.dataset.runtimeSegmentIndex = String(range.index); span.style.display = 'inline-block'; span.style.whiteSpace = 'pre'; span.textContent = part;
            fragment.append(span); result.push(span); cursor = last;
          }
          if (cursor < end) fragment.append(owner.createTextNode(text.data.slice(cursor - start)));
          offset = end; text.replaceWith(fragment);
        }
        if (by === 'character') ordinal++; // The authored paragraph separator is one grapheme.
      }
    }
    // A document may contain a large pasted text; cap animation work while retaining every character.
    result = result.filter(segment => Number(segment.dataset.runtimeSegmentIndex || 0) < 1000); textSegments.set(key, result); return result;
  }
  function framesFor(preset, node) {
    const rotation = elements.get(node.dataset.elementId)?.rotation || 0;
    const stateStyle = activeStyle(node.closest?.('[data-element-id]')?.dataset.elementId);
    const base = `rotate(${rotation}deg)${stateStyle.scale !== undefined ? ` scale(${stateStyle.scale})` : ''}`, opacity = stateStyle.opacity ?? Number(originalStyleFor(node.dataset.elementId).opacity||1);
    const from = { transform: base, opacity }, to = { transform: base, opacity };
    if (entrance(preset)) from.opacity = 0;
    if (exit(preset)) to.opacity = 0;
    if (preset === 'slideInLeft') from.transform = `${base} translateX(-70px)`;
    if (preset === 'slideInRight') from.transform = `${base} translateX(70px)`;
    if (preset === 'slideInUp') from.transform = `${base} translateY(55px)`;
    if (preset === 'slideOutRight') to.transform = `${base} translateX(70px)`;
    if (preset === 'zoomIn') from.transform = `${base} scale(.72)`;
    if (preset === 'spin') return [{ transform: base }, { transform: `rotate(${rotation + 360}deg)` }];
    if (preset === 'pulse') return [{ transform: base }, { transform: `${base} scale(1.12)`, offset: .5 }, { transform: base }];
    return [from, to];
  }
  function customFrames(motion, target, textChild = false) {
    const element = elements.get(target.dataset.elementId), rotation = textChild ? 0 : element?.rotation || 0, stateStyle = textChild ? {} : activeStyle(element?.id);
    const transform = motion.keyframes.some(frame => ['x', 'y', 'scale', 'rotate'].some(key => key in frame));
    return motion.keyframes.map(frame => ({ offset: frame.offset,
      ...(transform ? { transform: `translate(${(frame.x || 0) + (stateStyle.x || 0)}px,${(frame.y || 0) + (stateStyle.y || 0)}px) rotate(${rotation + (frame.rotate || 0) + (stateStyle.rotate || 0)}deg) scale(${(frame.scale ?? 1) * (stateStyle.scale ?? 1)})` } : {}),
      ...(frame.opacity !== undefined ? { opacity: frame.opacity } : {}), ...(frame.blur !== undefined ? { filter: `blur(${frame.blur}px)` } : {}) }));
  }
  function animation(node, keyframes, timing, extra = {}) {
    const record = { node, ...timing, ...extra, keyframes };
    if (extra.custom && !customBaselines.has(node)) customBaselines.set(node, { transform: node.style.transform, opacity: node.style.opacity, filter: node.style.filter });
    if (typeof node.animate === 'function') {
      // Before/after phases must not override another effect on the same target.
      // Presets finish at the author appearance; exit visibility is tracked below.
      record.animation = node.animate(keyframes, { duration: timing.duration, delay: timing.delay, iterations: timing.iterations, easing: timing.easing, fill: 'none' });
      record.animation.pause();
      record.animation.currentTime = 0;
    }
    records.push(record);
    return record;
  }
  function runGroup(at, start = elapsed) {
    for (const { motion, start: local } of groups[at]?.items || []) {
      const node = nodes.get(motion.targetId);
      if (!node) continue;
      runMotion(motion, node, start, local);
    }
  }
  function runMotion(motion, node, start, delay) {
    motionRuns.push({motionId:motion.id,start,delay});
    const targets = motion.stagger ? segmentsFor(node, motion.stagger.by) : [node];
    for (const [position, target] of targets.entries()) {
      const at = motion.stagger ? Number(target.dataset.runtimeSegmentIndex || 0) : position;
      const keyframes = motion.preset === 'keyframes' ? customFrames(motion, node, target !== node) : framesFor(motion.preset, target === node ? node : target);
      animation(target, keyframes, { start, delay: reduce ? 0 : delay + at * (motion.stagger?.delay || 0), duration: reduce ? 0 : motion.duration,
        iterations: reduce ? 1 : motion.iterations, easing: motion.easing }, { motion, kind: 'motion', custom: motion.preset === 'keyframes' });
    }
  }
  function setBoundText(node, text) {
    const target = node.querySelector('.element-paragraphs');
    if (!target || target.textContent === text) return false;
    const paragraph = owner.createElement('p'); paragraph.textContent = text; target.replaceChildren(paragraph);return true;
  }
  const numberText = value => new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 20 }).format(value);
  const boundText = (binding, value) => `${binding.prefix || ''}${binding.format === 'number' ? numberText(Number(value)) : value}${binding.suffix || ''}`;
  function formulaValue(binding, value) {
    const formula = binding.formula; if (!formula) return { text: value, valid: true };
    const input = String(value).trim() ? Number(value) : NaN, operand = formula.operand;
    const result = formula.operation === 'multiply' ? input * operand : formula.operation === 'add' ? input + operand : formula.operation === 'subtract' ? input - operand : operand === 0 ? NaN : input / operand;
    return Number.isFinite(result) ? { text: String(result), valid: true } : { text: formula.fallback, valid: false };
  }
  function displayBound(binding, value, valid) {
    return valid ? boundText(binding, value) : value;
  }
  function updateBindings(animate = false, priorValues = {}) {
    for(const element of slide().elements){
      const variableId=element.chart?.variants?.variableId,node=nodes.get(element.id);if(!variableId||!node)continue;
      const figure=node.querySelector('[data-chart-variable]'),output=figure?.querySelector('[data-chart-output]');
      const template=[...(figure?.querySelectorAll('template[data-chart-value]')||[])].find(candidate=>candidate.dataset.chartValue===variables[variableId]);
      if(output&&template&&output.dataset.chartCurrent!==variables[variableId]){output.replaceChildren(template.content.cloneNode(true));output.dataset.chartCurrent=variables[variableId];}
    }
    for (const element of slide().elements) {
      const binding = element.binding, node = nodes.get(element.id);
      if (!binding || !node) continue;
      const raw = binding.source==='variable'?variables[binding.variableId]??'':binding.values.find(item => item.value === variables[binding.variableId])?.text ?? '';
      const prior = binding.source==='variable'?priorValues[binding.variableId]:binding.values.find(item => item.value === priorValues[binding.variableId])?.text;
      const computed = formulaValue(binding, raw), priorComputed = prior === undefined ? undefined : formulaValue(binding, prior);
      const value = computed.text, previous = priorComputed?.text;
      numbers = numbers.filter(item => item.node !== node);
      if (animate && binding.animate && binding.format === 'number' && computed.valid && priorComputed?.valid && Number.isFinite(Number(previous)) && Number.isFinite(Number(value)) && !reduce && !paused && Number(previous) !== Number(value)) {
        numbers.push({ node, binding, from: Number(previous), to: Number(value), start: elapsed, duration: 450 });
        setBoundText(node, boundText(binding, previous));
      } else setBoundText(node, displayBound(binding, value, computed.valid));
    }
    for (const element of slide().elements) {
      const component = element.component, node = nodes.get(element.id);
      if (!component?.variableId || !node) continue;
      const current = variables[component.variableId];
      for (const button of node.querySelectorAll('[data-runtime-value]')) {
        const chosen = button.dataset.runtimeValue === current;
        button.setAttribute('aria-selected', String(chosen)); button.tabIndex = chosen ? 0 : -1;
      }
      const select = node.querySelector('select[data-runtime-variable]'); if (select) select.value = current;
      const slider = node.querySelector('input[data-runtime-slider]');
      if (slider) { const variable = authored.variables.find(item => item.id === component.variableId); slider.value = variable.kind==='number'?current:String(variable.options.findIndex(option => option.value === current)); node.querySelector('output').textContent = variable.kind==='number'?numberText(Number(current)):variable.options.find(option => option.value === current)?.label || ''; }
    }
    chartPlayer?.sync({slideId:slide().id,variables,animate:animate&&!reduce&&!paused});
  }
  function numberValue(variable,value){
    if(variable?.kind!=='number'||!String(value).trim()||!Number.isFinite(Number(value)))return null;
    const count=Math.max(0,Math.min(Math.floor((variable.maximum-variable.minimum)/variable.step+1e-7),Math.round((Number(value)-variable.minimum)/variable.step)));
    return String(Math.max(variable.minimum,Math.min(variable.maximum,Number((variable.minimum+count*variable.step).toPrecision(15)))));
  }
  function setVariable(id, value) {
    const variable = (authored.variables || []).find(item => item.id === id);
    if(variable?.kind==='number')value=numberValue(variable,value);
    if (!variable || value===null || variable.kind!=='number'&&!variable.options.some(option => option.value === value) || variables[id] === value) return false;
    syncClock(); const before = { ...variables }; variables[id] = value; updateBindings(true, before); update(); emit(); schedule(); return true;
  }
  function focusables(wrapper) {
    return [...wrapper.querySelectorAll('button,select,input,textarea,[tabindex]:not([tabindex="-1"])')]
      .filter(node => node.tabIndex >= 0 && !node.disabled && !node.closest('[hidden]') && node.getClientRects().length);
  }
  function openPanel(id) {
    const panel = panels.get(id); if (!panel || !panel.wrapper.hidden) return false;
    if(panel.component.dim)releaseBehaviorInputs({dispatchKeyUp:true});
    syncClock(); panel.returnFocus = owner.activeElement; panel.wrapper.hidden = false;
    openPanels = openPanels.filter(value => value !== id); openPanels.push(id);
    panel.wrapper.style.zIndex = String(1000 + openPanels.length * 2);resizeViewport(lastViewport.width,lastViewport.height);
    for (const member of panel.members) manualVisibility.set(member.dataset.elementId, true);
    const direction = { left: 'translateX(-45px)', right: 'translateX(45px)', top: 'translateY(-35px)', bottom: 'translateY(35px)', center: 'scale(.94)' }[panel.component.placement] || 'scale(.94)';
    if (!reduce) for (const member of panel.members) {
      const base = `rotate(${elements.get(member.dataset.elementId)?.rotation || 0}deg)`;
      animation(member, [{ opacity: 0, transform: `${base} ${direction}` }, { opacity: elements.get(member.dataset.elementId)?.style?.opacity ?? 1, transform: base }],
        { start: elapsed, delay: 0, duration: 220, iterations: 1, easing: 'ease-out' }, { kind: 'panel' });
    }
    update(); (focusables(panel.wrapper)[0] || panel.wrapper).focus(); emit(); schedule(); return true;
  }
  function closePanel(id, returnFocus = true) {
    const panel = panels.get(id); if (!panel || panel.wrapper.hidden) return false;
    panel.wrapper.hidden = true; openPanels = openPanels.filter(value => value !== id);
    for (const record of records.filter(record => record.kind === 'panel' && panel.members.includes(record.node))) record.animation?.cancel();
    records = records.filter(record => record.kind !== 'panel' || !panel.members.includes(record.node));
    resizeViewport(lastViewport.width,lastViewport.height);update();
    if (returnFocus && panel.returnFocus?.isConnected && !panel.returnFocus.closest('[hidden]')) panel.returnFocus.focus();
    emit(); return true;
  }
  function setupComponents() {
    for (const element of slide().elements) {
      const node = nodes.get(element.id), component = element.component;
      if (!node || !component) continue;
      const label = element.name || element.text?.paragraphs?.join(' ') || '인터랙티브 요소';
      node.dataset.runtimeComponent = component.kind;
      if (component.kind === 'button') { node.setAttribute('role', 'button'); node.tabIndex = 0; node.setAttribute('aria-label', label); }
      if (['tabs', 'select', 'slider'].includes(component.kind)) {
        const variable = (authored.variables || []).find(variable => variable.id === component.variableId);
        if (!variable) continue;
        const content = owner.createElement('div'); content.className = `vividly-runtime-${component.kind}`;
        const textContent = node.querySelector('.element-text-content');
        if (textContent) {
          const appearance = win.getComputedStyle(textContent);
          for (const property of ['fontFamily', 'fontSize', 'fontWeight', 'color']) content.style[property] = appearance[property];
        }
        if (component.kind === 'tabs') {
          content.setAttribute('role', 'tablist'); content.setAttribute('aria-label', variable.name);
          for (const option of variable.options) {
            const button = owner.createElement('button'); button.type = 'button'; button.setAttribute('role', 'tab'); button.dataset.runtimeValue = option.value;
            button.dataset.runtimeVariable = variable.id; button.textContent = option.label; content.append(button);
          }
        } else if (component.kind === 'slider') {
          const range = owner.createElement('input'); range.type = 'range'; range.min = variable.kind==='number'?String(variable.minimum):'0'; range.max = variable.kind==='number'?String(variable.maximum):String(variable.options.length - 1); range.step = variable.kind==='number'?String(variable.step):'1';
          range.dataset.runtimeVariable = variable.id; range.dataset.runtimeSlider = ''; range.setAttribute('aria-label', variable.name);
          const output = owner.createElement('output'); content.append(range, output);
        } else {
          const select = owner.createElement('select'); select.dataset.runtimeVariable = variable.id; select.setAttribute('aria-label', variable.name);
          for (const option of variable.options) { const item = owner.createElement('option'); item.value = option.value; item.textContent = option.label; select.append(item); }
          content.append(select);
        }
        node.replaceChildren(content);
      }
      if (component.kind === 'panel') {
        const wrapper = owner.createElement('div'); wrapper.className = 'vividly-runtime-panel'; wrapper.dataset.vividlyOwned = 'panel'; wrapper.dataset.runtimePanel = element.id;
        wrapper.setAttribute('role', 'dialog'); wrapper.setAttribute('aria-modal', String(component.dim)); wrapper.setAttribute('aria-label', label); wrapper.tabIndex = -1; wrapper.hidden = true;
        if (component.dim) { const dim = owner.createElement('button'); dim.type = 'button'; dim.className = 'vividly-runtime-dim'; dim.dataset.runtimeClose = element.id; dim.setAttribute('aria-label', '패널 닫기'); dim.tabIndex = -1; wrapper.append(dim); }
        const memberIds=new Set();
        const collect=id=>{if(memberIds.has(id))return;memberIds.add(id);const member=elements.get(id);for(const child of [...(member?.flow?.children||[]),...(member?.composition?.children||[])])collect(child);};
        collect(element.id);for(const id of component.contentIds||[])collect(id);
        const members=[...memberIds].map(id=>nodes.get(id)).filter(Boolean);
        for (const [at,member] of members.entries()){member.style.zIndex=String(at+1);wrapper.append(member);}
        const close = owner.createElement('button'); close.type = 'button'; close.className = 'vividly-runtime-close'; close.dataset.runtimeClose = element.id;
        close.textContent = '×'; close.setAttribute('aria-label', '패널 닫기');
        close.style.zIndex=String(members.length+2);close.style.left = `${element.geometry.x + element.geometry.width - 34}px`; close.style.top = `${element.geometry.y + 8}px`; wrapper.append(close);
        section().append(wrapper); panels.set(element.id, { wrapper, component, members, returnFocus: null });
      }
    }
    for (const rule of slide().interactions || []) {
      const node = nodes.get(rule.sourceId);
      if (!node || node.dataset.runtimeComponent || !['click', 'focus'].includes(rule.event)) continue;
      node.tabIndex = 0; if (rule.event === 'click') node.setAttribute('role', 'button');
    }
    for(const rule of slide().behavior?.rules||[]){
      const node=nodes.get(rule.sourceId),element=elements.get(rule.sourceId);
      if(rule.event!=='click'||!node||node.dataset.runtimeComponent&&node.dataset.runtimeComponent!=='button'||node.querySelector('input,textarea,select,button,a,video,[contenteditable="true"]'))continue;
      node.setAttribute('role','button');node.tabIndex=disabledSource(rule.sourceId)?-1:0;
      node.removeAttribute('aria-hidden');node.removeAttribute('aria-level');
      node.setAttribute('aria-label',element?.name||element?.text?.paragraphs?.join(' ')||'인터랙티브 요소');
    }
    updateBindings();
    for (const [id, panel] of panels) if (panel.component.initiallyOpen) { panel.wrapper.hidden = false; openPanels.push(id); panel.wrapper.style.zIndex = String(1000 + openPanels.length * 2); }
  }
  function update() {
    for (const [node, baseline] of customBaselines) for (const [property, value] of Object.entries(baseline)) node.style[property] = value;
    const held = new Map();
    for (const record of [...records].filter(record => record.custom).sort((a,b) => a.start + a.delay - b.start - b.delay)) {
      const started = elapsed >= record.start + record.delay;
      if (!started && held.has(record.node)) continue;
      const local = Math.max(0, elapsed - record.start - record.delay);
      const progress = !started ? 0 : record.duration === 0 ? 1 : local >= record.duration * record.iterations ? 1 : (local % record.duration) / record.duration;
      // WAAPI supplies easing/interpolation during the active interval. Inline endpoints
      // only hold deterministic before/after poses without future tracks masking a prior one.
      const pose = progress >= 1 ? record.keyframes.at(-1) : record.keyframes[0];
      for (const property of ['transform', 'opacity', 'filter']) if (pose[property] !== undefined) record.node.style[property] = pose[property];
      held.set(record.node, true);
    }
    const byTarget = new Map();
    for (const motion of slide().motions || []) if (!byTarget.has(motion.targetId)) byTarget.set(motion.targetId, !entrance(motion.preset));
    for (const record of records) {
      const local = elapsed - record.start;
      if (record.animation) record.animation.currentTime = local;
      if (record.node.dataset.runtimeSegment !== undefined && record.kind === 'motion') record.node.style.visibility = elapsed < record.start + record.delay && entrance(record.motion.preset) ? 'hidden' : 'visible';
      if (record.kind === 'motion' && elapsed >= record.start + record.delay) byTarget.set(record.motion.targetId,
        !(exit(record.motion.preset) && elapsed >= recordEnd(record)));
    }
    for (const [id, visible] of byTarget) if (nodes.has(id)) nodes.get(id).style.visibility = visible ? 'visible' : 'hidden';
    for (const [id, visible] of manualVisibility) { const node = nodes.get(id); if (node) { node.hidden = !visible; node.style.visibility = visible ? 'visible' : 'hidden'; } }
    for (const number of numbers) {
      const progress = Math.max(0, Math.min(1, (elapsed - number.start) / number.duration));
      const eased = 1 - (1 - progress) ** 3;
      const intermediate = number.from + (number.to - number.from) * eased;
      const integer = number.binding.source==='variable'?Number.isInteger(Number(number.from))&&Number.isInteger(Number(number.to)):number.binding.values.every(item => Number.isInteger(Number(item.text)));
      setBoundText(number.node, boundText(number.binding, progress === 1 ? number.to : integer ? Math.round(intermediate) : Math.round(intermediate * 10000) / 10000));
    }
    syncLogicalVisibility();syncBehaviorBindings();syncSceneProjection();updateConnectors();mediaPlayer?.pauseHidden();
  }
  function syncLogicalVisibility(reflow=true){
    const parents=new Map(),rows=slide().elements;
    const add=(parent,child)=>{if(parent===child)return;const list=parents.get(child)||[];if(!list.includes(parent))list.push(parent);parents.set(child,list);};
    for(const element of rows)for(const child of [...(element.flow?.children||[]),...(element.composition?.children||[])])add(element.id,child);
    for(const instance of slide().componentInstances||[])if(instance.wrapperId)for(const child of Object.values(instance.elementMap))add(instance.wrapperId,child);
    if(!parents.size)return;
    const hidden=new Map(),visiting=new Set();
    const ownHidden=id=>{const node=nodes.get(id);return !node||node.hidden||node.style.visibility==='hidden'||node.dataset.webFiltered==='true'||Boolean(node.closest('[hidden]'));};
    function inherited(id){if(hidden.has(id))return hidden.get(id);if(visiting.has(id))return false;visiting.add(id);const result=(parents.get(id)||[]).some(parent=>ownHidden(parent)||inherited(parent));visiting.delete(id);hidden.set(id,result);return result;}
    let changed=false;
    for(const [id,node]of nodes){const value=inherited(id);if((node.dataset.flowHidden==='true')!==value){if(value)node.dataset.flowHidden='true';else delete node.dataset.flowHidden;changed=true;}}
    if(changed&&reflow&&authored.responsive?.enabled)resizeViewport(lastViewport.width,lastViewport.height);
  }
  function updateConnectors() {
    const connectors = slide().elements.filter(element => element.type === 'connector'), positions = new Map();
    if (!connectors.length) return;
    for (const id of new Set(connectors.flatMap(element => [element.connector.from.elementId, element.connector.to.elementId]).filter(Boolean))) {
      const node = nodes.get(id), element = elements.get(id); if (!node || !element) continue;
      const style = win.getComputedStyle(node), matrix = typeof win.DOMMatrix === 'function' ? new win.DOMMatrix(style.transform === 'none' ? undefined : style.transform) : null,base=element.geometry,read=(key,fallback)=>Number.isFinite(parseFloat(node.style[key]))?parseFloat(node.style[key]):fallback,g={x:read('left',base.x),y:read('top',base.y),width:read('width',base.width),height:read('height',base.height)};
      positions.set(id, { visible: !node.closest('[hidden]') && style.visibility !== 'hidden' && style.display !== 'none', point(anchor,position) {
        const [x,y] = anchor==='custom'&&position?[g.width*position.x,g.height*position.y]:{ top:[g.width/2,0], bottom:[g.width/2,g.height], left:[0,g.height/2], right:[g.width,g.height/2], center:[g.width/2,g.height/2] }[anchor] || [g.width/2,g.height/2];
        const dx=x-g.width/2,dy=y-g.height/2,angle=(element.rotation||0)*Math.PI/180;
        const value = matrix ? matrix.transformPoint({x:dx,y:dy}) : {x:dx*Math.cos(angle)-dy*Math.sin(angle),y:dx*Math.sin(angle)+dy*Math.cos(angle)};
        return {x:g.x+g.width/2+value.x,y:g.y+g.height/2+value.y};
      } });
    }
    const endpoint=value=>value.point?{visible:true,point:{x:value.point.x,y:value.point.y}}:positions.has(value.elementId)?{visible:positions.get(value.elementId).visible,point:positions.get(value.elementId).point(value.anchor,value.position)}:null;
    const num=value=>Number(value.toFixed(7)),different=(first,second)=>Math.hypot(first.x-second.x,first.y-second.y)>.001;
    for (const element of connectors) {
      const node = nodes.get(element.id), svg = node?.querySelector('svg'), a = endpoint(element.connector.from), b = endpoint(element.connector.to); if (!node || !svg) continue;
      node.hidden = manualVisibility.get(element.id) === false || !a?.visible || !b?.visible; if (!a || !b) continue;
      const from=a.point,to=b.point,route=element.connector.route||'straight',control=element.connector.control||(route==='curve'?{x:(from.x+to.x)/2,y:Math.min(from.y,to.y)-Math.max(40,Math.abs(to.x-from.x)*.2)}:{x:(from.x+to.x)/2,y:(from.y+to.y)/2});
      const points=route==='polyline'?[from,...(element.connector.waypoints||[]),to]:route==='elbow'?[from,{x:control.x,y:from.y},{x:control.x,y:to.y},to]:[from,to],bounds=route==='curve'?[from,to,control]:points,pad=Math.max(4,element.connector.stroke.width*3);
      const x=Math.min(...bounds.map(point=>point.x))-pad,y=Math.min(...bounds.map(point=>point.y))-pad,width=Math.max(1,Math.max(...bounds.map(point=>point.x))-x-pad)+2*pad,height=Math.max(1,Math.max(...bounds.map(point=>point.y))-y-pad)+2*pad;
      Object.assign(node.style,{left:`${x}px`,top:`${y}px`,width:`${width}px`,height:`${height}px`}); svg.setAttribute('viewBox',`0 0 ${width} ${height}`);
      const pair=point=>`${num(point.x-x)} ${num(point.y-y)}`,path=route==='curve'?`M ${pair(from)} Q ${pair(control)} ${pair(to)}`:points.map((point,index)=>`${index?'L':'M'} ${pair(point)}`).join(' ');
      const visual=svg.querySelector('[data-connector-stroke]')||svg.querySelector('line'),x1=from.x-x,y1=from.y-y,x2=to.x-x,y2=to.y-y;
      if(visual?.tagName.toLowerCase()==='line')for(const [key,value]of Object.entries({x1,y1,x2,y2}))visual.setAttribute(key,String(value));else visual?.setAttribute('d',path);
      svg.querySelector('.connector-hit')?.setAttribute('d',path);
      const size=Math.max(8,element.connector.stroke.width*3),arrows=[...svg.querySelectorAll('polygon')];
      const nearStart=route==='curve'&&different(control,from)?control:points.find(point=>different(point,from))||to;
      const nearEnd=route==='curve'&&different(control,to)?control:[...points].reverse().find(point=>different(point,to))||from;
      function arrow(polygon,ax,ay,toward){const dx=ax-(toward.x-x),dy=ay-(toward.y-y),length=Math.hypot(dx,dy)||1,ux=dx/length,uy=dy/length;polygon?.setAttribute('points',`${num(ax)},${num(ay)} ${num(ax-ux*size+uy*size*.48)},${num(ay-uy*size-ux*size*.48)} ${num(ax-ux*size-uy*size*.48)},${num(ay-uy*size+ux*size*.48)}`);}
      if(element.connector.arrow==='end'||element.connector.arrow==='both')arrow(arrows[0],x2,y2,nearEnd);if(element.connector.arrow==='both')arrow(arrows[1],x1,y1,nearStart);
    }
  }
  function syncClock() { if (!paused && lastTick) elapsed += Math.max(0, now() - lastTick); lastTick = now(); }
  function schedule() {
    if (destroyed || paused || frame || ended) return;
    const auto = !interactionOnly() && slide().advanceAfter !== undefined && step >= groups.length - 1;
    if (elapsed >= duration() && !auto&&!behaviorPlayer?.needsTick()){behaviorLastTick=0;return;}
    if (!lastTick) lastTick = now();
    frame = win.requestAnimationFrame(tick);
  }
  function tick(timestamp) {
    frame = 0; if (destroyed || paused) return;
    if(behaviorPlayer&&owner.hidden){lastTick=timestamp;behaviorLastTick=0;schedule();return;}
    const delta=Math.max(0,timestamp-lastTick);elapsed += delta; lastTick = timestamp;
    if(behaviorPlayer?.needsTick()){const behaviorDelta=behaviorLastTick?Math.max(0,timestamp-behaviorLastTick):0;behaviorLastTick=timestamp;behaviorPlayer.advance(behaviorDelta);}else behaviorLastTick=0;
    update(); emit();
    if (!interactionOnly() && slide().advanceAfter !== undefined && step >= groups.length - 1 && elapsed >= Math.max(slide().advanceAfter, duration())) {
      if (index < authored.slides.length - 1) goTo(index + 1);
      else { ended = true; emit(); onEnd?.(state()); }
      return;
    }
    schedule();
  }
  function prepare(nextIndex, transition = true,{restoring=false}={}) {
    presentationGeneration++;motionRuns=[];
    releaseBehaviorInputs();
    behaviorComposing.clear();
    behaviorLastTick=0;
    mediaPlayer?.pauseAll();cancel(); for (const entry of originals) restore(entry);
    index = nextIndex; elapsed = 0; step = 0; ended = false; openPanels = []; panels = new Map(); manualVisibility = new Map();
    elementStates = new Map(); triggerCounts = new Map(); wheelDistances = new Map(); viewInside = new Map(); textSegments = new Map(); customBaselines = new Map();designVisuals=new Map();designInputs=new Map();
    const current = section(); elements = new Map(slide().elements.map(element => [element.id, element]));
    nodes = new Map([...current.querySelectorAll('.slide-element[data-element-id]')].map(node => [node.dataset.elementId, node]));
    for (const element of slide().elements) if (element.initiallyHidden && nodes.has(element.id)) manualVisibility.set(element.id, false);
    for (const candidate of sections) { candidate.hidden = candidate !== current; candidate.setAttribute('aria-hidden', String(candidate !== current)); candidate.inert = candidate !== current; }
    groups = plan(slide().motions); setupComponents();resizeViewport(lastViewport.width,lastViewport.height);setupDesignStates();runGroup(0, 0);mediaPlayer?.sync({slideId:slide().id,reset:true,autoplay:!paused&&!restoring});
    update();setupSceneLayer();scenePlayer?.enterSlide(slide().id);
    behaviorPlayer?.enterSlide(slide().id,{isPaused:paused,restoring});webPlayer?.sync?.({slideId:slide().id,nodes});syncBehaviorBindings();syncSceneProjection();resizeViewport(lastViewport.width,lastViewport.height);
    const setting = slide().transition;
    if (transition && setting && setting.type !== 'none' && !reduce) {
      const from = setting.type === 'push' ? { transform: 'translateX(100%)', opacity: 1 } : setting.type === 'zoom' ? { transform: 'scale(.88)', opacity: 0 } : setting.type === 'wipe' ? { clipPath: 'inset(0 100% 0 0)', opacity: 1 } : setting.type === 'flip' ? { transform: 'perspective(1200px) rotateY(-80deg)', opacity: 0 } : { transform: 'none', opacity: 0 };
      animation(current, [from, { transform: 'none', opacity: 1, ...(setting.type === 'wipe' ? { clipPath: 'inset(0 0% 0 0)' } : {}) }], { start: 0, delay: 0, duration: setting.duration, iterations: 1, easing: setting.easing }, { kind: 'transition' });
    }
    setupViewTriggers();
    lastTick = now(); update(); emit(); schedule();
  }
  function goTo(value,{interaction=false}={}) {
    if (destroyed || interactionOnly()&&!interaction) return false;
    const at = typeof value === 'number' ? value : authored.slides.findIndex(slide => slide.id === value);
    if (!Number.isInteger(at) || at < 0 || at >= authored.slides.length) return false;
    prepare(at); return true;
  }
  function next() {
    if (destroyed) return false;
    syncClock();
    if (step < groups.length - 1) {
      elapsed = Math.max(elapsed, duration()); ++step; runGroup(step, elapsed); lastTick = now(); update(); emit(); schedule(); return true;
    }
    if(interactionOnly())return false;
    if (index < authored.slides.length - 1) return goTo(index + 1);
    ended = true; emit(); onEnd?.(state()); return false;
  }
  function previous() {
    if (destroyed) return false;
    if (step > 0) {
      const previousStep = step - 1; prepare(index, false);
      for (let at = 1; at <= previousStep; ++at) { const start = duration(); runGroup(at, start); step = at; }
      elapsed = duration(); update(); emit(); schedule(); return true;
    }
    return !interactionOnly()&&index > 0 ? goTo(index - 1) : false;
  }
  function reset() {
    variables = Object.fromEntries((authored.variables || []).map(variable => [variable.id, variable.initialValue]));
    behaviorPlayer?.reset();
    prepare(index, false);
  }
  function pause() { if (destroyed || paused) return; syncClock(); paused = true;withBehaviorInput(()=>behaviorPlayer?.pause());scenePlayer?.pause({remember:true});releaseBehaviorInputs({dispatchKeyUp:true});mediaPlayer?.pauseAll({remember:true}); if (frame) win.cancelAnimationFrame(frame); frame = 0; update(); emit(); }
  function play() { if (destroyed) return; paused = false; ended = false;behaviorPlayer?.play();scenePlayer?.resume();mediaPlayer?.resume(); lastTick = now(); emit(); schedule(); }
  function seek(value) {
    if (destroyed || !Number.isFinite(value)) return;
    elapsed = Math.max(0, Math.min(duration(), value)); lastTick = now(); update(); emit(); schedule();
  }
  function seekTimeline(value, { step: requestedStep } = {}) {
    if (destroyed || !Number.isFinite(value)) return false;
    paused = true; prepare(index, false);
    behaviorPlayer?.pause();
    const targetStep = Math.max(0, Math.min(groups.length - 1, Number.isInteger(requestedStep) ? requestedStep : groups.length - 1));
    for (let at = 1; at <= targetStep; ++at) { const start = duration(); runGroup(at, start); step = at; }
    elapsed = Math.max(0, Math.min(duration(), value)); update(); emit(); return true;
  }
  function playMotion(id) {
    const motion = (slide().motions || []).find(item => item.id === id), node = nodes.get(motion?.targetId); if (!motion || !node) return false;
    syncClock(); manualVisibility.delete(motion.targetId);
    runMotion(motion, node, elapsed, motion.delay);
    update(); emit(); schedule(); return true;
  }
  function eligible(rule) {
    const condition = rule.condition;
    if(condition){
      const variable=(authored.variables||[]).find(v=>v.id===condition.variableId),numeric=variable?.kind==='number',a=numeric?Number(variables[condition.variableId]):variables[condition.variableId],b=numeric?Number(condition.value):condition.value;
      const matches={equals:()=>a===b,notEquals:()=>a!==b,less:()=>a<b,lessOrEqual:()=>a<=b,greater:()=>a>b,greaterOrEqual:()=>a>=b}[condition.operator];
      if(!matches?.())return false;
    }
    return !(['scroll', 'inView', 'key'].includes(rule.event) && rule.trigger?.once !== false && triggerCounts.has(rule.id));
  }
  function dispatch(sourceId, eventName, acceptedRule) {
    if (dispatching || destroyed || disabledSource(sourceId)) return false;
    const rules = (slide().interactions || []).filter(rule => rule.sourceId === sourceId && rule.event === eventName && (!acceptedRule || rule.id === acceptedRule) && eligible(rule));
    if (!rules.length) return false;
    dispatching = true;
    try {
      for (const rule of rules) { if (['scroll', 'inView', 'key'].includes(rule.event)) triggerCounts.set(rule.id, (triggerCounts.get(rule.id) || 0) + 1); for (const action of rule.actions) {
        if (action.type === 'setVariable') setVariable(action.variableId, action.value);
        else if (action.type === 'addVariable') setVariable(action.variableId,Number(variables[action.variableId])+action.amount);
        else if (action.type === 'goToSlide') { goTo(action.targetId,{interaction:true}); return true; }
        else if (action.type === 'playMotion') playMotion(action.motionId);
        else if(action.type==='playVideo')void mediaPlayer?.playVideo(action.targetId);
        else if(action.type==='pauseVideo')mediaPlayer?.pauseVideo(action.targetId);
        else if(action.type==='stopVideo')mediaPlayer?.stopVideo(action.targetId);
        else if(action.type==='openLink'){try{const url=new URL(action.href);if(!['http:','https:','mailto:'].includes(url.protocol)||url.username||url.password||/[\u0000-\u0020\u007f]/u.test(action.href))continue;if(onOpenLink){const result=onOpenLink(url.href);if(result?.catch)result.catch(()=>{});}else win.open(url.href,'_blank','noopener,noreferrer');}catch{}} 
        else if (action.type === 'openPanel') openPanel(action.targetId);
        else if (action.type === 'closePanel') closePanel(action.targetId);
        else if (action.type === 'setState') setState(action.targetId, action.stateId);
        else if (action.type === 'resetState') setState(action.targetId, null);
        else {
          if (panels.has(action.targetId)) {
            const visible = !panels.get(action.targetId).wrapper.hidden;
            const wanted = action.type === 'show' || (action.type === 'toggle' && !visible);
            if (wanted) openPanel(action.targetId); else closePanel(action.targetId);
            continue;
          }
          const node = nodes.get(action.targetId); if (!node) continue;
          const visible = manualVisibility.has(action.targetId) ? manualVisibility.get(action.targetId) : !node.hidden && node.style.visibility !== 'hidden';
          const nextVisible = action.type === 'show' ? true : action.type === 'hide' ? false : !visible;
          manualVisibility.set(action.targetId, nextVisible); update(); emit();
        }
      }}
    } finally { dispatching = false; }
    return true;
  }
  function behaviorSourceAllowed(id){
    const top=panels.get(openPanels.at(-1));if(!id)return !behaviorInputScope||!top?.component.dim;
    const node=nodes.get(id);if(!node||disabledSource(id)||node.closest('[hidden]'))return false;
    const style=win.getComputedStyle(node);if(style.display==='none'||style.visibility==='hidden')return false;
    return !behaviorInputScope||!top?.component.dim||top.wrapper.contains(node);
  }
  function withBehaviorInput(fn){const previous=behaviorInputScope;behaviorInputScope=true;try{return fn();}finally{behaviorInputScope=previous;}}
  function syncBehaviorBindings(){
    if(!behaviorPlayer){webPlayer?.refresh?.();return;}
    let contentChanged=false;
    for(const binding of behaviorPlayer.bindingValues()){const node=nodes.get(binding.targetId);if(node){contentChanged=setBoundText(node,binding.text)||contentChanged;node.dataset.behaviorBindingValid=String(binding.valid);}}
    const values=behaviorPlayer.getState().variables;
    for(const input of slide().behavior?.inputs||[]){const node=nodes.get(input.targetId),control=node?.querySelector('[data-behavior-input]');if(!control||behaviorComposing.has(control))continue;
      const value=values[input.variableId],variable=authored.behavior.variables.find(v=>v.id===input.variableId),outside=['number','range'].includes(input.kind)&&(value<(input.minimum??variable.minimum??0)||value>(input.maximum??variable.maximum??100));
      const inputError=behaviorPlayer.getInputError(input.id),warning=inputError||(outside?'현재 값 '+value+'은 입력 범위를 벗어났습니다. 범위 안의 값으로 수정하세요.':''),message=node.querySelector('[data-behavior-error]');control.setAttribute('aria-invalid',String(Boolean(warning)));if(message){if(message.textContent!==warning)message.textContent=warning;message.hidden=!warning;}if(inputError)continue;
      if(input.kind==='checkbox')control.checked=value===true;else if(!(input.kind==='number'&&owner.activeElement===control&&control.value==='')){const text=String(value??'');if(control.value!==text)control.value=text;}
      const output=node.querySelector('output[data-behavior-output]');if(output)output.textContent=String(value??'');
    }
    webPlayer?.refresh?.();if(contentChanged&&authored.responsive?.enabled)resizeViewport(lastViewport.width,lastViewport.height);
  }
  function applyBehaviorEffect(action){
    if(action.type==='navigate')return goTo(action.slideId,{interaction:true});
    if(action.type==='setStyleState')return setState(action.targetId,action.stateId);
    if(action.type==='resetStyleState')return setState(action.targetId,null);
    if(action.type==='playMotion')return playMotion(action.motionId);
    if(['playVideo','pauseVideo','stopVideo'].includes(action.type)){const result=mediaPlayer?.[action.type]?.(action.targetId);if(result?.catch)result.catch(()=>{});return Boolean(mediaPlayer);}
    if(['show','hide','toggle'].includes(action.type)){
      if(panels.has(action.targetId)){const visible=!panels.get(action.targetId).wrapper.hidden,wanted=action.type==='show'||action.type==='toggle'&&!visible;return wanted?openPanel(action.targetId):closePanel(action.targetId);}
      const node=nodes.get(action.targetId);if(!node)return false;const visible=manualVisibility.has(action.targetId)?manualVisibility.get(action.targetId):!node.hidden&&node.style.visibility!=='hidden';manualVisibility.set(action.targetId,action.type==='show'?true:action.type==='hide'?false:!visible);update();emit();return true;
    }
    return false;
  }
  function behaviorInputChanged(event){
    const control=event.target.closest?.('[data-behavior-input]');if(!control)return false;if(behaviorComposing.has(control)||event.isComposing){event.stopPropagation();return true;}
    const definition=slide().behavior?.inputs?.find(i=>i.id===control.dataset.behaviorInput);if(!definition)return false;
    if(definition.kind==='number'&&event.type==='input'&&!Number.isFinite(control.valueAsNumber))return true;
    const value=definition.kind==='checkbox'?control.checked:['range','number'].includes(definition.kind)?control.valueAsNumber:control.value;
    withBehaviorInput(()=>behaviorPlayer?.setInput(definition.id,value));syncBehaviorBindings();event.stopPropagation();return true;
  }
  function behaviorPoint(event){const rect=root.getBoundingClientRect(),logical=responsiveFrame||authored.canvas,x=(event.clientX-rect.left)*logical.width/(rect.width||logical.width),y=(event.clientY-rect.top)*logical.height/(rect.height||logical.height),c=scenePlayer?.camera()||{x:0,y:0,zoom:1};return{x,y,worldX:x/c.zoom+c.x,worldY:y/c.zoom+c.y};}
  function applyResponsiveGeometry(id){
    const node=nodes.get(id),element=elements.get(id);if(!node||!element)return;const panelNode=node.closest('[data-runtime-panel]'),panel=panelNode?panels.get(panelNode.dataset.runtimePanel):null;if(panel)node.style.zIndex=String(panel.members.indexOf(node)+1);if(!responsiveFrame)return;const g=element.geometry,wrapper=node.closest('[data-responsive-sticky]'),parent=wrapper?elements.get(wrapper.dataset.responsiveSticky):null;
    Object.assign(node.style,{left:(g.x-(parent?.geometry.x||0))+'px',top:(g.y-(parent?.geometry.y||0))+'px',width:g.width+'px',height:g.height+'px'});if(wrapper)node.style.pointerEvents='auto';const overrideFont=element.responsive?.fontSize?.[responsiveFrame.profile],sourceFont=slide().elements.find(e=>e.id===id)?.text?.textStyle?.fontSize,font=overrideFont||sourceFont;if(font&&(overrideFont||node.dataset.responsiveFont==='true')){node.dataset.responsiveFont=String(Boolean(overrideFont));for(const content of node.querySelectorAll('.element-text-content')){content.style.fontSize=font+'px';const base=sourceFont||font,ratio=font/base;for(const span of content.querySelectorAll('span[style]')){const original=span.dataset.responsiveRunFont??parseFloat(span.style.fontSize);if(Number.isFinite(Number(original))){span.dataset.responsiveRunFont=String(original);span.style.fontSize=Number(original)*ratio+'px';}}}}
  }
  /** Resize only the visual projection. Scores, variables, player state and author data remain intact. */
  function resizeViewport(width,height){
    lastViewport={width:Number.isFinite(width)&&width>0?width:authored.canvas.width,height:Number.isFinite(height)&&height>0?height:authored.canvas.height};
    if(!authored.responsive?.enabled)return{responsive:false,width:authored.canvas.width,height:authored.canvas.height,scale:Math.min(lastViewport.width/authored.canvas.width,lastViewport.height/authored.canvas.height)};
    syncLogicalVisibility(false);
    const input=JSON.parse(JSON.stringify(slide())),bindingIds=new Set([...(slide().behavior?.bindings||[]).map(binding=>binding.targetId),...slide().elements.filter(element=>element.binding).map(element=>element.id)]);
    for(const element of input.elements)if(element.text&&bindingIds.has(element.id)){const paragraphs=nodes.get(element.id)?.querySelector('.element-paragraphs');if(paragraphs)element.text.paragraphs=[paragraphs.textContent];}
    for(const element of input.elements){const node=nodes.get(element.id);if(node&&(node.hidden||node.closest('[hidden]')||node.dataset.webFiltered==='true'||node.dataset.flowHidden==='true'||node.closest('[data-web-filtered="true"]')))element.hidden=true;}
    const projection=responsiveProjector(input,authored,lastViewport.width),current=section();
    const scale=Math.min(1,lastViewport.width/projection.width);projection.height=Math.max(projection.height,lastViewport.height/scale);responsiveFrame={...projection,scale};
    current.style.width=projection.width+'px';current.style.height=projection.height+'px';current.style.overflow='visible';
    root.style.width=projection.width+'px';root.style.height=projection.height+'px';root.style.overflow='visible';
    root.dataset.responsiveProfile=projection.profile;
    elements=new Map(projection.slide.elements.map(element=>[element.id,element]));
    for(const element of projection.slide.elements){const node=nodes.get(element.id);if(!node)continue;const g=element.geometry;Object.assign(node.style,{left:g.x+'px',top:g.y+'px',width:g.width+'px',height:g.height+'px'});applyResponsiveGeometry(element.id);}
    for(const element of projection.slide.elements.filter(element=>element.responsive?.sticky&&!element.hidden)){
      const node=nodes.get(element.id);if(!node||node.closest('[data-runtime-panel]'))continue;
      let wrapper=[...current.querySelectorAll('[data-responsive-sticky]')].find(candidate=>candidate.dataset.responsiveSticky===element.id);
      if(!wrapper){wrapper=owner.createElement('div');wrapper.dataset.vividlyOwned='responsive-sticky';wrapper.dataset.responsiveSticky=element.id;current.append(wrapper);}
      const ids=new Set(),collect=id=>{if(ids.has(id))return;ids.add(id);for(const child of [...(elements.get(id)?.flow?.children||[]),...(elements.get(id)?.composition?.children||[])])collect(child);};collect(element.id);
      const g=element.geometry;wrapper.style.cssText='position:sticky;top:'+element.responsive.sticky.top+'px;left:'+g.x+'px;margin-top:'+g.y+'px;width:'+g.width+'px;height:'+g.height+'px;z-index:900;pointer-events:none';
      for(const id of ids){const child=nodes.get(id),model=elements.get(id);if(!child||!model)continue;wrapper.append(child);child.style.left=(model.geometry.x-g.x)+'px';child.style.top=(model.geometry.y-g.y)+'px';child.style.pointerEvents='auto';}
    }
    positionResponsivePanels();
    for(const chart of chartPlayer?.instances||[])chart.resize?.();
    return{responsive:true,width:projection.width,height:projection.height,profile:projection.profile,scale:responsiveFrame.scale};
  }
  function positionResponsivePanels(){
    if(!responsiveFrame)return;const viewport=root.closest('.presentation-viewport')||root.closest('#presentation-content')||root.parentElement,rect=root.getBoundingClientRect(),view=viewport?.getBoundingClientRect?.()||{top:0},scale=responsiveFrame.scale||1,top=Math.max(0,(view.top-rect.top)/scale);
    for(const[id,panel]of panels){const model=elements.get(id);if(!model)continue;Object.assign(panel.wrapper.style,{top:top+'px',bottom:'auto',width:responsiveFrame.width+'px',height:lastViewport.height/scale+'px',overflow:'auto',overscrollBehavior:'contain'});const close=panel.wrapper.querySelector('.vividly-runtime-close');if(close){close.style.left=(model.geometry.x+model.geometry.width-34)+'px';close.style.top=(model.geometry.y+8)+'px';}}
  }
  function releaseBehaviorInputs({dispatchKeyUp=false}={}){
    activationKeys.clear();
    if(behaviorPointer){try{behaviorPointer.capture?.releasePointerCapture?.(behaviorPointer.id);}catch{}behaviorPointer=null;}
    behaviorConsumedClick=false;withBehaviorInput(()=>behaviorPlayer?.releaseInputs({dispatchKeyUp}));
  }
  function behaviorPointerDown(event){
    if(!behaviorPlayer||event.button!==0||event.target.closest?.('input,textarea,select,video,a,[contenteditable="true"]'))return;
    const node=sourceNode(event.target),sourceId=node?.dataset.elementId;
    if(!withBehaviorInput(()=>behaviorPlayer.hasPointerBindings(sourceId)))return;
    const point=behaviorPoint(event),capture=node||root;behaviorPointer={id:event.pointerId,sourceId,start:point,capture};behaviorConsumedClick=true;
    try{capture.setPointerCapture?.(event.pointerId);}catch{}
    withBehaviorInput(()=>behaviorPlayer.dispatch('pointerDown',{sourceId,...point,dx:0,dy:0,worldDx:0,worldDy:0,down:true}));event.preventDefault();schedule();
  }
  function behaviorPointerMove(event){
    if(!behaviorPointer||event.pointerId!==behaviorPointer.id)return;const point=behaviorPoint(event),gesture=behaviorPointer;
    withBehaviorInput(()=>behaviorPlayer.dispatch('drag',{sourceId:gesture.sourceId,...point,dx:point.x-gesture.start.x,dy:point.y-gesture.start.y,worldDx:point.worldX-gesture.start.worldX,worldDy:point.worldY-gesture.start.worldY,down:true}));event.preventDefault();schedule();
  }
  function behaviorPointerUp(event){
    if(!behaviorPointer||event.pointerId!==behaviorPointer.id)return;const gesture=behaviorPointer,point=behaviorPoint(event);behaviorPointer=null;
    withBehaviorInput(()=>behaviorPlayer.dispatch('pointerUp',{sourceId:gesture.sourceId,...point,dx:point.x-gesture.start.x,dy:point.y-gesture.start.y,worldDx:point.worldX-gesture.start.worldX,worldDy:point.worldY-gesture.start.worldY,down:false}));try{gesture.capture.releasePointerCapture?.(event.pointerId);}catch{}schedule();
  }
  function behaviorKeyup(event){
    activationKeys.delete(event.key);
    if(!behaviorPlayer||event.isComposing||event.altKey||event.ctrlKey||event.metaKey)return;
    if(event.target.closest?.('input,textarea,select,[contenteditable="true"]')){withBehaviorInput(()=>behaviorPlayer.releaseInputs({dispatchKeyUp:true}));return;}
    if(!root.contains(event.target)&&event.target.closest?.('button,a,video,summary,#presentation-runtime-tools')){withBehaviorInput(()=>behaviorPlayer.releaseInputs({dispatchKeyUp:true}));return;}
    if(withBehaviorInput(()=>behaviorPlayer.key('keyUp',event.key))){event.preventDefault();event.stopPropagation();schedule();}
  }
  function sourceNode(target,kind='') {
    const original=target?.closest?.('.slide-element[data-element-id]');if(!original||!section().contains(original))return null;if(!kind)return original;
    const matches=id=>kind==='design'?Boolean(designVisuals.get(id)?.visuals.hover||designVisuals.get(id)?.visuals.pressed||designVisuals.get(id)?.visuals.focus):Boolean(elements.get(id)?.component||elements.get(id)?.web&&elements.get(id).web.kind!=='filterItem'||behaviorPlayer?.hasClickBindings(id)||(slide().interactions||[]).some(rule=>rule.sourceId===id&&rule.event==='click'));
    if(matches(original.dataset.elementId))return original;
    let id=original.dataset.elementId;const seen=new Set();while(!seen.has(id)){seen.add(id);let parent=slide().elements.find(element=>element.flow?.children.includes(id)||element.composition?.children.includes(id));if(!parent){const instance=slide().componentInstances?.find(item=>item.wrapperId&&Object.values(item.elementMap).includes(id));parent=instance?elements.get(instance.wrapperId):null;}if(!parent)break;if(matches(parent.id))return nodes.get(parent.id)||original;id=parent.id;}return original;
  }
  function isInteractiveTarget(target) {
    if (!target?.closest) return false;
    if (target.closest('button,select,input,textarea,video,a,summary,#presentation-runtime-tools,[data-runtime-panel],[data-runtime-chart-interactive="true"],[role="button"],[role="tab"],[role="tablist"]')) return true;
    const node = sourceNode(target,'click');
    return Boolean(node && (elements.get(node.dataset.elementId)?.component || designVisuals.get(node.dataset.elementId)?.visuals.focus || behaviorPlayer?.hasClickBindings(node.dataset.elementId) || (slide().interactions || []).some(rule => rule.sourceId === node.dataset.elementId)));
  }
  function clicked(event) {
    const download=event.target.closest?.('a[download]');
    if(download&&webPlayer?.ownsDownload?.(download)){event.stopPropagation();return;}
    if(disabledSource(sourceNode(event.target,'click')?.dataset.elementId)){event.preventDefault();event.stopPropagation();return;}
    if (event.target.closest?.('video,select,input,textarea,option')) { event.stopPropagation(); return; }
    const webNode=sourceNode(event.target,'click');
    if(webNode&&webPlayer?.activate?.(webNode.dataset.elementId)){event.preventDefault();event.stopPropagation();return;}
    const behaviorNode=sourceNode(event.target,'click');
    const consumedBehaviorPointer=behaviorConsumedClick;behaviorConsumedClick=false;
    if(dispatchBehaviorClick(behaviorNode,behaviorPoint(event))){event.preventDefault();event.stopPropagation();return;}
    const link=event.target.closest?.('a[href]');
    if(link&&root.contains(link)){
      const href=link.getAttribute('href');
      if(href?.startsWith('#')){event.preventDefault();event.stopPropagation();let target;try{target=decodeURIComponent(href.slice(1));}catch{return;}goTo(target,{interaction:true});return;}
      if(onOpenLink){event.preventDefault();event.stopPropagation();onOpenLink(href);return;}
      event.stopPropagation();return;
    }
    const close = event.target.closest?.('[data-runtime-close]');
    if (close) { event.preventDefault(); event.stopPropagation(); closePanel(close.dataset.runtimeClose); return; }
    const option = event.target.closest?.('button[data-runtime-value]');
    if (option) {
      event.preventDefault(); event.stopPropagation(); setVariable(option.dataset.runtimeVariable, option.dataset.runtimeValue);
      dispatch(sourceNode(option)?.dataset.elementId, 'change'); return;
    }
    const node = sourceNode(event.target,'click');
    if (node && (dispatch(node.dataset.elementId, 'click') || isInteractiveTarget(event.target))) { event.preventDefault(); event.stopPropagation(); return; }
    if (isInteractiveTarget(event.target)) return;
    if(consumedBehaviorPointer){event.preventDefault();event.stopPropagation();return;}
    event.preventDefault(); next();
  }
  function dispatchBehaviorClick(node,point){return withBehaviorInput(()=>behaviorPlayer?.dispatch('click',{sourceId:node?.dataset.elementId,...point,down:false}));}
  function changed(event) {
    if(behaviorInputChanged(event))return;
    const select = event.target.closest?.('select[data-runtime-variable]'), slider = event.target.closest?.('input[data-runtime-slider]'), node = sourceNode(event.target);
    if(disabledSource(node?.dataset.elementId)){event.preventDefault();event.stopPropagation();updateBindings();return;}
    if (select) setVariable(select.dataset.runtimeVariable, select.value);
    if (slider) { const variable = authored.variables.find(item => item.id === slider.dataset.runtimeVariable); const value = variable?.kind==='number'?slider.value:variable?.options[Number(slider.value)]?.value; if (value !== undefined) setVariable(variable.id, value); }
    if (node) dispatch(node.dataset.elementId, 'change');
    if (select || slider || node) event.stopPropagation();
  }
  function entered(event, type) {
    const node = sourceNode(event.target);
    if (node && !node.contains(event.relatedTarget)) dispatch(node.dataset.elementId, type);
  }
  function keydown(event) {
    if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    if(!root.contains(event.target)&&!['Escape','Tab'].includes(event.key)&&event.target.closest?.('button,a,video,input,textarea,select,summary,#presentation-runtime-tools'))return;
    if(disabledSource(sourceNode(event.target)?.dataset.elementId)){if(event.key!=='Escape'){event.preventDefault();event.stopPropagation();}return;}
    if(behaviorPlayer&&!event.target.closest?.('input,textarea,select,[contenteditable="true"]')&&(root.contains(event.target)||!event.target.closest?.('button,a,video'))&&withBehaviorInput(()=>behaviorPlayer.key('keyDown',event.key))){event.preventDefault();event.stopPropagation();schedule();return;}
    if(['Enter',' '].includes(event.key)&&sourceNode(event.target)===event.target)designInput(event,'keyPressed',true);
    const top = panels.get(openPanels.at(-1));
    if (!event.target.closest?.('input,textarea,select,[contenteditable="true"]') && /^[a-z0-9]$/i.test(event.key)) {
      let handled = false;
      for (const rule of slide().interactions || []) if (rule.event === 'key' && rule.trigger?.key?.toLowerCase() === event.key.toLowerCase() && (!top || top.wrapper.contains(nodes.get(rule.sourceId)))) handled = dispatch(rule.sourceId, 'key', rule.id) || handled;
      if (handled) { event.preventDefault(); event.stopPropagation(); return; }
    }
    if (event.key === 'Escape' && event.target?.matches?.('select')) return;
    if (event.key === 'Escape' && top) { event.preventDefault(); event.stopPropagation(); closePanel(openPanels.at(-1)); return; }
    if (event.key === 'Tab' && top) {
      const available = focusables(top.wrapper), first = available[0], last = available.at(-1);
      if (!available.length) { event.preventDefault(); top.wrapper.focus(); }
      else if (event.shiftKey && (owner.activeElement === first || !top.wrapper.contains(owner.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (owner.activeElement === last || !top.wrapper.contains(owner.activeElement))) { event.preventDefault(); first.focus(); }
      return;
    }
    const tab = event.target.closest?.('button[role="tab"]');
    if (tab && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation(); const tabs = [...tab.parentElement.querySelectorAll('button[role="tab"]')], at = tabs.indexOf(tab);
      const wanted = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (at + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[wanted].focus(); setVariable(tabs[wanted].dataset.runtimeVariable, tabs[wanted].dataset.runtimeValue); dispatch(sourceNode(tab)?.dataset.elementId, 'change'); return;
    }
    const node = sourceNode(event.target);
    if (['Enter', ' '].includes(event.key) && node?.getAttribute('role') === 'button' && event.target === node) {
      event.preventDefault(); event.stopPropagation();
      if(event.repeat||activationKeys.has(event.key)||!withBehaviorInput(()=>behaviorSourceAllowed(node.dataset.elementId)))return;
      activationKeys.add(event.key);
      const rect=node.getBoundingClientRect(),point=behaviorPoint({clientX:rect.left+rect.width/2,clientY:rect.top+rect.height/2});
      if(!dispatchBehaviorClick(node,point))dispatch(node.dataset.elementId,'click');return;
    }
    if (isInteractiveTarget(event.target)) return;
    if (['ArrowRight', 'ArrowDown', 'PageDown', 'Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); next(); }
    else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); previous(); }
    else if (event.key === 'Home') { event.preventDefault(); event.stopPropagation(); goTo(0); }
    else if (event.key === 'End') { event.preventDefault(); event.stopPropagation(); goTo(authored.slides.length - 1); }
  }
  function wheeled(event) {
    if (event.ctrlKey || event.metaKey || event.altKey || event.target.closest?.('input,textarea,select,[data-runtime-panel]')) return;
    const node = sourceNode(event.target); if (!node) return;
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? authored.canvas.height : 1;
    let handled = false;
    for (const rule of slide().interactions || []) if (rule.sourceId === node.dataset.elementId && rule.event === 'scroll' && eligible(rule)) {
      const direction = rule.trigger?.direction || 'down', delta = event.deltaY * unit * (direction === 'up' ? -1 : 1);
      const distance = delta <= 0 ? 0 : (wheelDistances.get(rule.id) || 0) + delta;
      wheelDistances.set(rule.id, distance);
      if (distance >= Math.max(1, (rule.trigger?.threshold ?? .1) * authored.canvas.height)) { wheelDistances.set(rule.id, 0); handled = dispatch(rule.sourceId, 'scroll', rule.id) || handled; }
    }
    if (handled) { event.preventDefault(); event.stopPropagation(); }
  }
  function setupViewTriggers() {
    const rules = (slide().interactions || []).filter(rule => rule.event === 'inView');
    if (!rules.length || typeof win.IntersectionObserver !== 'function') return;
    const currentIndex = index;
    viewObserver = new win.IntersectionObserver(entries => {
      if (destroyed || index !== currentIndex) return;
      for (const entry of entries) for (const rule of rules) if (rule.sourceId === entry.target.dataset.elementId) {
        const inside = entry.isIntersecting && entry.intersectionRatio >= (rule.trigger?.threshold ?? .5) && entry.target.style.visibility !== 'hidden' && !entry.target.closest('[hidden]');
        const prior = viewInside.get(rule.id) || false; viewInside.set(rule.id, inside);
        if (inside && !prior) dispatch(rule.sourceId, 'inView', rule.id);
      }
    }, { root, threshold: [...new Set([0, ...rules.map(rule => rule.trigger?.threshold ?? .5)])] });
    for (const id of new Set(rules.map(rule => rule.sourceId))) if (nodes.has(id)) viewObserver.observe(nodes.get(id));
  }
  const progressExact=(value,keys,label)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))throw Error(label+': 알 수 없는 진행 필드입니다.');};
  const progressNumber=(value,label,min=0,max=1e12)=>{if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw Error(label+': 진행 숫자를 확인하세요.');};
  let fingerprintPromise;
  function documentFingerprint(){if(!fingerprintPromise)fingerprintPromise=(async()=>{if(!win.crypto?.subtle)throw Error('이 환경은 진행 파일의 SHA256 확인을 지원하지 않습니다.');const snapshot=JSON.parse(JSON.stringify(authored));snapshot.assets=(snapshot.assets||[]).map(({dataBase64,...metadata})=>metadata);const stable=v=>Array.isArray(v)?'['+v.map(stable).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v),digest=await win.crypto.subtle.digest('SHA-256',new win.TextEncoder().encode(stable(snapshot)));return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');})();return fingerprintPromise;}
  async function exportProgress(){if(destroyed)throw Error('발표가 종료됐습니다.');const active=presentationGeneration,dto={format:'vividly.progress',version:1,documentId:authored.id,documentHash:'',slideId:slide().id,legacy:{variables:{...variables},elapsed,step,openPanels:[...openPanels],manualVisibility:Object.fromEntries(manualVisibility),namedStyleStates:Object.fromEntries(elementStates),triggerCounts:Object.fromEntries(triggerCounts),wheelDistances:Object.fromEntries(wheelDistances),motionRuns:motionRuns.map(r=>({...r})),media:(mediaPlayer?.getState()||[]).filter(r=>r.slideId===slide().id).map(r=>({elementId:r.elementId,currentTime:r.currentTime,muted:r.muted}))},behavior:behaviorPlayer?.snapshot()||null,scene:scenePlayer?.snapshot()||null};dto.documentHash=await documentFingerprint();if(destroyed||active!==presentationGeneration)throw Error('진행을 준비하는 동안 장면이 변경됐습니다. 다시 저장하세요.');if(new win.TextEncoder().encode(JSON.stringify(dto)).byteLength>2*1024*1024)throw Error('진행 파일은 2MB 이하여야 합니다.');return dto;}
  function validateLegacyProgress(dto,target){progressExact(dto,['variables','elapsed','step','openPanels','manualVisibility','namedStyleStates','triggerCounts','wheelDistances','motionRuns','media'],'기존 발표 진행');const defs=authored.variables||[];progressExact(dto.variables,defs.map(v=>v.id),'기존 변수');if(Object.keys(dto.variables).length!==defs.length)throw Error('진행 변수 수가 다릅니다.');for(const variable of defs){const value=dto.variables[variable.id];if(variable.kind==='number'?typeof value!=='string'||numberValue(variable,value)!==value:!variable.options.some(o=>o.value===value))throw Error('기존 변수 값을 확인하세요.');}progressNumber(dto.elapsed,'발표 시간');if(!Number.isInteger(dto.step)||dto.step<0||dto.step>planMotionCount(target)-1)throw Error('발표 단계를 확인하세요.');const indexed=new Map(target.elements.map(e=>[e.id,e]));if(!Array.isArray(dto.openPanels)||new Set(dto.openPanels).size!==dto.openPanels.length||dto.openPanels.some(id=>indexed.get(id)?.component?.kind!=='panel'||indexed.get(id).hidden))throw Error('진행 패널을 확인하세요.');progressExact(dto.manualVisibility,[...indexed.keys()],'표시 상태');for(const value of Object.values(dto.manualVisibility))if(typeof value!=='boolean')throw Error('표시 상태 값이 필요합니다.');progressExact(dto.namedStyleStates,[...indexed.keys()],'서식 상태');for(const[id,stateId]of Object.entries(dto.namedStyleStates))if(!indexed.get(id).states?.some(s=>s.id===stateId))throw Error('이름 있는 서식 상태를 찾을 수 없습니다.');const rules=target.interactions||[];for(const[key,max]of[['triggerCounts',1e6],['wheelDistances',1e9]]){progressExact(dto[key],rules.map(r=>r.id),key);for(const value of Object.values(dto[key])){progressNumber(value,key,0,max);if(key==='triggerCounts'&&!Number.isInteger(value))throw Error('규칙 실행 수는 정수여야 합니다.');}}if(!Array.isArray(dto.motionRuns)||dto.motionRuns.length>1024)throw Error('진행 모션이 너무 많습니다.');for(const run of dto.motionRuns){progressExact(run,['motionId','start','delay'],'모션 진행');if(!target.motions?.some(m=>m.id===run.motionId))throw Error('진행 모션을 찾을 수 없습니다.');progressNumber(run.start,'모션 시작');progressNumber(run.delay,'모션 지연');}if(!Array.isArray(dto.media)||new Set(dto.media.map(m=>m.elementId)).size!==dto.media.length||dto.media.length>target.elements.filter(e=>e.type==='video').length)throw Error('동영상 진행 구성을 확인하세요.');for(const m of dto.media){progressExact(m,['elementId','currentTime','muted'],'동영상 진행');const e=indexed.get(m.elementId),asset=authored.assets.find(a=>a.id===e?.assetId);if(e?.type!=='video'||typeof m.muted!=='boolean')throw Error('동영상 대상을 확인하세요.');progressNumber(m.currentTime,'동영상 위치',0,asset?.duration||3600);}}
  function planMotionCount(target){let count=1;for(const m of target.motions||[])if(m.start==='onClick')count++;return count;}
  async function importProgress(value){if(destroyed)throw Error('발표가 종료됐습니다.');let serialized;try{serialized=JSON.stringify(value);}catch{throw Error('진행은 순환 없는 JSON이어야 합니다.');}if(!serialized||new win.TextEncoder().encode(serialized).byteLength>2*1024*1024)throw Error('진행 JSON은 2MB 이하여야 합니다.');const dto=JSON.parse(serialized);progressExact(dto,['format','version','documentId','documentHash','slideId','legacy','behavior','scene'],'진행 파일');if(dto.format!=='vividly.progress'||dto.version!==1||dto.documentId!==authored.id||typeof dto.documentHash!=='string')throw Error('이 문서의 지원되는 진행 파일이 아닙니다.');const token=++progressToken,active=presentationGeneration,hash=await documentFingerprint();if(destroyed||token!==progressToken||active!==presentationGeneration)throw Error('진행을 준비하는 동안 발표가 변경됐습니다. 다시 불러오세요.');if(dto.documentHash!==hash)throw Error('원본 문서가 변경되어 이 진행을 불러올 수 없습니다.');const at=authored.slides.findIndex(s=>s.id===dto.slideId),target=authored.slides[at];if(!target)throw Error('진행 장면을 찾을 수 없습니다.');validateLegacyProgress(dto.legacy,target);if(behaviorPlayer)behaviorPlayer.validateSnapshot(dto.behavior,target.id);else if(dto.behavior!==null)throw Error('이 문서는 행동 진행을 사용하지 않습니다.');if(scenePlayer){scenePlayer.validateSnapshot(dto.scene,target.id);if(dto.behavior&&dto.scene.clock!==dto.behavior.clock)throw Error('장면과 행동의 진행 시간이 다릅니다.');}else if(dto.scene!==null)throw Error('이 문서는 장면 진행을 사용하지 않습니다.');
    restoringProgress=true;try{paused=true;prepare(at,false,{restoring:true});variables=Object.assign(Object.create(null),dto.legacy.variables);updateBindings(false);cancel();motionRuns=[];customBaselines=new Map();for(const run of dto.legacy.motionRuns){const motion=slide().motions.find(m=>m.id===run.motionId);runMotion(motion,nodes.get(motion.targetId),run.start,run.delay);}elapsed=dto.legacy.elapsed;step=dto.legacy.step;manualVisibility=new Map(Object.entries(dto.legacy.manualVisibility));triggerCounts=new Map(Object.entries(dto.legacy.triggerCounts));wheelDistances=new Map(Object.entries(dto.legacy.wheelDistances));elementStates=new Map();for(const[id,stateId]of Object.entries(dto.legacy.namedStyleStates))setState(id,stateId);openPanels=[...dto.legacy.openPanels];for(const[id,panel]of panels){panel.wrapper.hidden=!openPanels.includes(id);panel.wrapper.style.zIndex=String(1000+Math.max(0,openPanels.indexOf(id)+1)*2);}if(scenePlayer)scenePlayer.restore(dto.scene,target.id);if(behaviorPlayer)behaviorPlayer.restore(dto.behavior,target.id);for(const p of dto.legacy.media){const video=nodes.get(p.elementId)?.querySelector('video');if(video){video.pause();video.muted=true;try{video.currentTime=p.currentTime;}catch{} }}ended=false;releaseBehaviorInputs();behaviorLastTick=0;lastTick=now();update();}finally{restoringProgress=false;}emit();return true;
  }
  if(hasScene)scenePlayer=sceneRuntimeFactory({document:authored,Matter:scenePhysics,isVisible:sceneVisible,audioAdapter:sceneAudioAdapter});
  if(hasBehavior)behaviorPlayer=behaviorRuntimeFactory({document:authored,createEvaluator:createBehaviorEvaluatorFactory,applyEffect:applyBehaviorEffect,canSource:behaviorSourceAllowed,sceneRuntime:scenePlayer,onChange(){
    if(destroyed)return;const status=behaviorPlayer?.getState();if(status?.paused&&status.error){paused=true;if(frame)win.cancelAnimationFrame(frame);frame=0;}
    if(behaviorPlayer?.needsTick()){if(!behaviorLastTick)behaviorLastTick=now();}else behaviorLastTick=0;
    syncBehaviorBindings();syncSceneProjection();updateConnectors();emit();schedule();
  }});
  listen(root,'pointerdown',behaviorPointerDown);listen(win,'pointermove',behaviorPointerMove,{passive:false});listen(win,'pointerup',behaviorPointerUp);listen(win,'pointercancel',releaseBehaviorInputs);listen(win,'blur',()=>{releaseBehaviorInputs({dispatchKeyUp:true});scenePlayer?.pause();});listen(owner,'keyup',behaviorKeyup,true);
  listen(owner,'visibilitychange',()=>{if(!behaviorPlayer)return;if(owner.hidden){releaseBehaviorInputs({dispatchKeyUp:true});scenePlayer?.pause();behaviorLastTick=0;}else{lastTick=now();behaviorLastTick=behaviorPlayer.needsTick()?now():0;schedule();}});
  listen(root,'compositionstart',event=>{if(event.target.matches?.('[data-behavior-input]'))behaviorComposing.add(event.target);});
  listen(root,'compositionend',event=>{if(behaviorComposing.delete(event.target))behaviorInputChanged(event);});
  listen(root,'focusin',event=>{if(event.target.matches?.('input,textarea,select,[contenteditable="true"]'))releaseBehaviorInputs({dispatchKeyUp:true});});
  listen(root,'ended',event=>{const node=sourceNode(event.target);if(event.target.matches?.('video[data-runtime-video]')&&node)dispatch(node.dataset.elementId,'ended');},true);
  listen(root, 'click', clicked); listen(root, 'change', changed); listen(root, 'input', event => { if(behaviorInputChanged(event))return;if (event.target.matches?.('input[data-runtime-slider]')) changed(event); }); listen(root, 'mouseover', event => entered(event, 'hover')); listen(root, 'mouseout', event => entered(event, 'leave'));
  listen(root, 'focusin', event => entered(event, 'focus')); listen(root, 'focusout', event => entered(event, 'blur')); listen(root, 'keydown', keydown); listen(root, 'wheel', wheeled, { passive: false });
  listen(root,'pointerover',event=>designInput(event,'hover',true));listen(root,'pointerout',event=>designInput(event,'hover',false));
  listen(root,'pointerdown',event=>{if(event.button===0)designInput(event,'pressed',true);});
  listen(root,'focusin',event=>designInput(event,'focus',true));listen(root,'focusout',event=>designInput(event,'focus',false));
  listen(win,'pointerup',()=>releaseDesignInputs());listen(win,'pointercancel',()=>releaseDesignInputs());listen(win,'blur',()=>releaseDesignInputs(true));
  listen(win,'keyup',event=>{if(['Enter',' '].includes(event.key))releaseDesignInputs(false,true);});
  // Presentation chrome can take focus outside the canvas. A modal still owns
  // Escape/Tab there, before the app's document-level presentation shortcuts.
  listen(owner, 'keydown', event => {
    if (openPanels.length && ['Escape', 'Tab'].includes(event.key) || !root.contains(event.target) && (/^[a-z0-9]$/i.test(event.key)||behaviorPlayer)) keydown(event);
  }, true);
  prepare(index, false);
  return { next, previous, goTo, reset, play, pause, seek, seekTimeline, resizeViewport, getState: state, setVariable, setState, dispatch, openPanel, closePanel, playMotion, isInteractiveTarget, getMediaState:()=>mediaPlayer?.getState()||[],exportProgress,importProgress,setMuted(value){scenePlayer?.setMuted(value);},enableAudio(){return scenePlayer?.enableAudio();},
    stepBehavior(ms=16){if(!behaviorPlayer||destroyed)return false;pause();const result=behaviorPlayer.step(ms);update();emit();return result;},clearBehaviorTrace(){behaviorPlayer?.clearTrace();},
    destroy() { if (destroyed) return; destroyed = true;presentationGeneration++;progressToken++;behaviorPlayer?.destroy();scenePlayer?.destroy();webPlayer?.destroy?.();behaviorComposing.clear();releaseBehaviorInputs(); chartPlayer?.destroy();mediaPlayer?.destroy(); cancel(); listeners.forEach(remove => remove()); originals.forEach(restore);if(responsiveRootStyle!==undefined){if(responsiveRootStyle===null)root.removeAttribute('style');else root.setAttribute('style',responsiveRootStyle);} if (!hadRootClass) root.classList.remove('vividly-runtime-root'); } };
}

export const PRESENTATION_RUNTIME_CSS = `
.vividly-runtime-root [data-flow-hidden=true]{display:none!important}
.vividly-runtime-root [data-layout-container=true]:not([role=button]):not([data-runtime-component]):not([data-web-control]){pointer-events:none!important}

.vividly-runtime-root [hidden]{display:none!important}
.vividly-runtime-root [data-runtime-component="button"],.vividly-runtime-root [role="button"]{cursor:pointer}
.vividly-runtime-root [role="button"]:focus-visible{outline:3px solid #93c5fd;outline-offset:3px}
.vividly-runtime-root [data-runtime-state-color] .element-text-content,.vividly-runtime-root [data-runtime-state-color] .element-text-content *{color:var(--vividly-state-color)!important}
.vividly-runtime-slider{display:flex;align-items:center;gap:12px;width:100%;height:100%;padding:10px;font:inherit}
.vividly-runtime-slider input{min-width:0;flex:1;accent-color:#6855ff}.vividly-runtime-slider output{min-width:40px;font:inherit;text-align:center}
.vividly-runtime-tabs,.vividly-runtime-select{display:flex;align-items:stretch;width:100%;height:100%;gap:5px;padding:5px;font:inherit}
.vividly-runtime-tabs button,.vividly-runtime-select select{min-width:0;flex:1;border:1px solid #ffffff33;border-radius:8px;background:#ffffff22;color:inherit;font:inherit;cursor:pointer;padding:8px 12px}
.vividly-runtime-tabs button[aria-selected="true"]{background:#ffffff;color:#182037;box-shadow:0 2px 8px #0002}
.vividly-runtime-tabs button:focus-visible,.vividly-runtime-select select:focus-visible{outline:3px solid #93c5fd;outline-offset:-3px}
.vividly-runtime-select select{background:#fff;color:#182037}.vividly-runtime-select option{background:#fff;color:#182037}
.vividly-runtime-panel{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.vividly-runtime-panel>.slide-element{pointer-events:auto;z-index:1}
.vividly-runtime-dim{position:absolute;inset:0;border:0;border-radius:0;background:#081226aa;width:100%;height:100%;pointer-events:auto;cursor:default;padding:0}
.vividly-runtime-close{position:absolute;width:28px;height:28px;min-height:0;padding:0;border:1px solid #ffffff66;border-radius:50%;background:#182037dd;color:white;font:22px/24px system-ui;pointer-events:auto;z-index:2;cursor:pointer}
.vividly-runtime-close:focus-visible{outline:3px solid #93c5fd;outline-offset:2px}
@media print{.vividly-runtime-root .slide-element{visibility:visible!important;opacity:1!important}.vividly-runtime-panel[hidden]{display:block!important}.vividly-runtime-dim,.vividly-runtime-close{display:none!important}}
`;
