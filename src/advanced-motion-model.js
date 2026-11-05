/** Additional closed author invariants. No runtime state or evaluated expressions. */
import { ADVANCED_SCHEMA, validCondition } from './motion-model.js';
export { ADVANCED_SCHEMA } from './motion-model.js';

export function hasAdvancedMotion(document) {
  return (document.variables||[]).some(v=>v.kind==='number') || document.motionClips!==undefined || document.slides.some(slide=>
    ['wipe','flip'].includes(slide.transition?.type) || slide.transition?.navigation!==undefined || (slide.motions||[]).some(m=>m.preset==='keyframes'||m.at!==undefined||m.stagger!==undefined) ||
    (slide.interactions||[]).some(i=>['key','scroll','inView','leave','blur'].includes(i.event)||i.trigger!==undefined||i.condition!==undefined||i.actions.some(a=>['setState','resetState','addVariable'].includes(a.type))) ||
    slide.elements.some(e=>e.states!==undefined||e.component?.kind==='slider'||e.binding?.formula!==undefined));
}
export function motionSegmentCount(element, stagger) {
  if(!stagger)return 1;
  const paragraphs=element?.text?.paragraphs||[];
  if(stagger.by==='paragraph')return Math.max(1,paragraphs.length);
  const text=paragraphs.join('\n');
  if(typeof Intl.Segmenter==='function'){
    const parts=[...new Intl.Segmenter(undefined,{granularity:stagger.by==='word'?'word':'grapheme'}).segment(text)];
    return Math.max(1,stagger.by==='word'?parts.filter(p=>p.isWordLike).length:parts.length);
  }
  return Math.max(1,stagger.by==='word'?text.split(/\s+/u).filter(Boolean).length:Array.from(text).length);
}
export function planMotionTimeline(slide) {
  const result=[{items:[],duration:0}];let group=result[0],blockStart=0,blockEnd=0;
  const elements=new Map(slide.elements.map(e=>[e.id,e]));
  for(const motion of slide.motions||[]){
    if(motion.start==='onClick'){group={items:[],duration:0};result.push(group);blockStart=0;blockEnd=0;}
    if(motion.start==='afterPrevious')blockStart=blockEnd;
    const start=(motion.at??blockStart)+motion.delay;
    group.items.push({motion,start});
    const stagger=(motionSegmentCount(elements.get(motion.targetId),motion.stagger)-1)*(motion.stagger?.delay||0);
    blockEnd=Math.max(blockEnd,start+motion.duration*motion.iterations+stagger);group.duration=Math.max(group.duration,blockEnd);
  }
  return result.filter((g,i)=>i===0||g.items.length);
}
export function formulaValue(binding, text) {
  if(!binding.formula)return {text,valid:true};
  const {operation,operand,fallback}=binding.formula,source=String(text).trim()?Number(text):NaN;
  const value=operation==='multiply'?source*operand:operation==='add'?source+operand:operation==='subtract'?source-operand:operand===0?NaN:source/operand;
  return Number.isFinite(value)?{text:String(value),valid:true}:{text:fallback,valid:false};
}
function validateTrack(motion,element) {
  const frames=motion.keyframes;
  if(motion.preset==='keyframes'){
    if(!frames||frames[0].offset!==0||frames.at(-1).offset!==1)throw Error('keyframes: 첫 offset 0과 마지막 offset 1이 필요합니다.');
    const fields=Object.keys(frames[0]).filter(k=>k!=='offset').sort();
    if(!fields.length||frames.some((f,i)=>i&&f.offset<=frames[i-1].offset||JSON.stringify(Object.keys(f).filter(k=>k!=='offset').sort())!==JSON.stringify(fields)))throw Error('keyframes: 오름차순의 중복 없는 offset과 모든 프레임의 같은 속성이 필요합니다.');
  }else if(frames!==undefined)throw Error('keyframes: 사용자 키프레임 효과에서만 지정할 수 있습니다.');
  if(motion.stagger){
    if(element&&!element.text)throw Error('stagger: 텍스트가 있는 개체가 필요합니다.');
    if(element&&motionSegmentCount(element,motion.stagger)>1000)throw Error('stagger: 효과 단위는 최대 1000개입니다.');
  }
}
export function validateAdvancedReferences(document,usedIds) {
  if(![ADVANCED_SCHEMA,'0.12-design.1','0.13-behavior.1','0.14-scene.1','0.15-authoring.1'].includes(document.schemaVersion)){if(hasAdvancedMotion(document))throw Error('확장 모션은 0.5-motion.1 이상 schemaVersion이 필요합니다.');return;}
  const unique=(id,label)=>{if(usedIds.has(id))throw Error(`${label}: 중복 ID ${id}`);usedIds.add(id);};
  const variables=new Map((document.variables||[]).map(v=>[v.id,v]));
  for(const clip of document.motionClips||[]){unique(clip.id,'motionClip');for(const track of clip.tracks)validateTrack(track);}
  for(const slide of document.slides){
    const elements=new Map(slide.elements.map(e=>[e.id,e]));
    for(const motion of slide.motions||[])validateTrack(motion,elements.get(motion.targetId));
    for(const element of slide.elements){
      for(const state of element.states||[]){unique(state.id,'state');if(!Object.keys(state.style).length)throw Error('state.style: 하나 이상의 시각 속성이 필요합니다.');}
      if(element.binding?.formula&&element.binding.format!=='number')throw Error('formula: 숫자 바인딩에서만 계산할 수 있습니다.');
    }
    for(const interaction of slide.interactions||[]){
      if(interaction.event==='key'&&!interaction.trigger?.key)throw Error('key: 실행할 영문/숫자 키가 필요합니다.');
      const trigger=interaction.trigger;
      if(trigger){
        if(trigger.key!==undefined&&interaction.event!=='key'||trigger.direction!==undefined&&interaction.event!=='scroll'||trigger.threshold!==undefined&&!['scroll','inView'].includes(interaction.event)||trigger.once!==undefined&&!['key','scroll','inView'].includes(interaction.event))throw Error('trigger: 이벤트와 맞는 설정이 필요합니다.');
      }
      const condition=interaction.condition;
      if(condition&&!validCondition(condition,variables.get(condition.variableId)))throw Error('condition: 변수의 유효한 선택 값이 필요합니다.');
      for(const action of interaction.actions)if(action.type==='setState'&&!elements.get(action.targetId)?.states?.some(s=>s.id===action.stateId))throw Error('setState: 대상 개체의 상태가 필요합니다.');
    }
  }
}

export function cleanAdvancedReferences(document) {
  const variables=new Map((document.variables||[]).map(v=>[v.id,v]));
  for(const slide of document.slides){
    const elements=new Map(slide.elements.map(e=>[e.id,e]));
    if(slide.interactions)slide.interactions=slide.interactions.flatMap(interaction=>{
      if(interaction.condition&&!validCondition(interaction.condition,variables.get(interaction.condition.variableId)))return [];
      const actions=interaction.actions.filter(a=>a.type!=='setState'||elements.get(a.targetId)?.states?.some(s=>s.id===a.stateId));
      return actions.length?[{...interaction,actions}]:[];
    });
  }
}
