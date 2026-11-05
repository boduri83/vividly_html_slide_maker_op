/** Self-contained typed behavior executor. Embedded with its evaluator factory in offline HTML. */
export function createBehaviorRuntime({document:source,createEvaluator,applyEffect=()=>true,canSource=()=>true,onChange=()=>{},sceneRuntime}={}){
  if(!source?.slides||typeof createEvaluator!=='function')throw Error('동작 실행 모델과 식 계산기가 필요합니다.');
  const authored=JSON.parse(JSON.stringify(source)),evaluator=createEvaluator(),definitions=new Map((authored.behavior?.variables||[]).map(v=>[v.id,v]));
  const dictionary=value=>Object.assign(Object.create(null),value||{}),clone=value=>JSON.parse(JSON.stringify(value));
  const initialValues=()=>dictionary(Object.fromEntries([...definitions].map(([id,v])=>[id,v.initial])));
  let values=initialValues(),machines=dictionary(),clock=0,remainder=0,paused=false,destroyed=false,current=null,generation=0,sequence=0,error=null,processing=false;
  let timers=new Map(),held=new Set(),heldDue=new Map(),releasedKeys=new Set(),queue=[],trace=[];
  let inputErrors=new Map();
  const eventDefaults={x:0,y:0,dx:0,dy:0,worldX:0,worldY:0,worldDx:0,worldDy:0,otherId:'',normalX:0,normalY:0,value:'',elapsed:0,delta:0,key:'',down:false};
  let lastEvent={...eventDefaults},bindingVersion=0,bindingCacheVersion=-1,bindingCache=[];
  const STEP=16,MAX_DELTA=100,MAX_EVENTS=128,MAX_ACTIONS=256,MAX_TRACE=200;
  const normalKey=key=>key===' '||String(key).toLowerCase()==='space'?'Space':String(key).length===1?String(key).toLowerCase():String(key);
  const rules=()=>current?.behavior?.rules||[],stateMachines=()=>current?.behavior?.machines||[];
  const eventContext=event=>({...lastEvent,...event,elapsed:clock});
  function rememberEvent(event){lastEvent=Object.fromEntries(Object.keys(eventDefaults).map(key=>[key,event[key]??lastEvent[key]]));}
  const clockExpression=expression=>Boolean(expression&&(expression.type==='event'&&['elapsed','delta'].includes(expression.name)||(expression.args||[]).some(clockExpression)));
  const hasClockBinding=()=>Boolean(current?.behavior?.bindings?.some(b=>clockExpression(b.expression)));
  const notify=()=>{if(!destroyed)onChange();};
  function log(kind,message,details={}){const item={sequence:++sequence,time:clock,kind,message,...details};trace.push(item);if(trace.length>MAX_TRACE)trace.splice(0,trace.length-MAX_TRACE);return item;}
  function fail(message,details={}){error={code:'BEHAVIOR_ERROR',message};log('error',message,details);}
  function evaluate(expression,candidate=values,event={},bodies=sceneRuntime?.getBodies()||{}){const result=evaluator.evaluate(expression,candidate,event,bodies);if(!result.ok)throw Error(result.error?.message||'식을 계산하지 못했습니다.');return result.value;}
  function validValue(variable,value){
    if(!variable)throw Error('변수를 찾을 수 없습니다.');
    if(variable.type==='number'){if(typeof value!=='number'||!Number.isFinite(value)||value<(variable.minimum??-1e12)||value>(variable.maximum??1e12))throw Error(variable.name+': 허용 범위의 유한 숫자가 필요합니다.');}
    else if(variable.type==='boolean'){if(typeof value!=='boolean')throw Error(variable.name+': 참/거짓 값이 필요합니다.');}
    else if(typeof value!=='string'||value.length>4096||variable.type==='choice'&&!variable.options?.some(o=>o.value===value))throw Error(variable.name+': 올바른 텍스트/선택 값이 필요합니다.');
    return value;
  }
  function sourceAllowed(rule){return canSource(rule.sourceId||null);}
  function matching(eventName,event){return rules().filter(rule=>rule.event===eventName&&(!event.__ruleId||rule.id===event.__ruleId)&&(['keyDown','keyUp','keyHeld','timer','enter','custom','audioEnd'].includes(eventName)||!rule.sourceId||rule.sourceId===event.sourceId)&&sourceAllowed(rule)&&(eventName!=='custom'||rule.trigger?.eventName===event.name)&&(!rule.trigger?.otherId||rule.trigger.otherId===event.otherId)&&(!rule.trigger?.clipId||rule.trigger.clipId===event.clipId)&&(!rule.trigger?.audioId||rule.trigger.audioId===event.audioId)&&(!['keyDown','keyUp','keyHeld'].includes(eventName)||normalKey(rule.trigger?.key||'')===normalKey(event.key||'')));}
  function preflight(actions,candidate,event,details,budget){
    const effects=[];
    function run(list,depth=0){if(depth>16)throw Error('상태 전이가 너무 깊습니다.');for(const action of list||[]){if(--budget.remaining<0)throw Error('한 규칙의 동작 실행 한도를 넘었습니다.');
      if(action.type==='set'){candidate.values[action.variableId]=validValue(definitions.get(action.variableId),evaluate(action.value,candidate.values,event,candidate.scene?.bodies));}
      else if(action.type==='transition'){
        const machine=stateMachines().find(m=>m.id===action.machineId),next=machine?.states.find(s=>s.id===action.stateId);if(!next)throw Error('전이할 상태를 찾을 수 없습니다.');
        if(candidate.machines[machine.id]===next.id)continue;
        const previous=machine.states.find(s=>s.id===candidate.machines[machine.id]);
        run(previous?.exitActions,depth+1);candidate.machines[machine.id]=next.id;effects.push({type:'traceTransition',machineId:machine.id,stateId:next.id,message:machine.name+' → '+next.name});run(next.enterActions,depth+1);
      }else{const computed=sceneRuntime?.preflightAction(action,candidate.scene,expr=>evaluate(expr,candidate.values,event,candidate.scene.bodies));effects.push(computed?{...computed,__sceneAction:true}:clone(action));}
    }}run(actions);return effects;
  }
  function commitActions(actions,event={},details={}){
    const candidate={values:dictionary(values),machines:dictionary(machines),scene:sceneRuntime?.createCandidate()},startGeneration=generation;
    let effects;try{effects=preflight(actions,candidate,event,details,{remaining:MAX_ACTIONS});}catch(cause){fail(cause.message,details);return false;}
    if(Object.keys(candidate.values).some(id=>candidate.values[id]!==values[id]))bindingVersion++;
    values=candidate.values;machines=candidate.machines;error=null;
    for(const action of effects){if(destroyed||generation!==startGeneration)break;
      if(action.type==='traceTransition')log('transition',action.message,{machineId:action.machineId,stateId:action.stateId,...details});
      else if(action.type==='timerStart'){const timer=timers.get(action.ruleId);if(timer){timer.active=true;timer.due=clock+timer.interval;log('timer','타이머를 시작했습니다.',{ruleId:action.ruleId});}}
      else if(action.type==='timerStop'){const timer=timers.get(action.ruleId);if(timer){timer.active=false;log('timer','타이머를 멈췄습니다.',{ruleId:action.ruleId});}}
      else if(action.type==='emit')queue.push({name:'custom',event:{...Object.fromEntries(Object.keys(eventDefaults).filter(key=>event[key]!==undefined).map(key=>[key,event[key]])),name:action.name},generation});
      else if(action.__sceneAction){sceneRuntime.commitAction(action);bindingVersion++;if(action.noop)log('condition',action.message,details);}
      else{try{if(applyEffect(action,{event,variables:{...values},machines:{...machines}})===false)log('effect','동작 대상이 현재 실행 화면에 없습니다.',{...details,action:action.type});}catch(cause){fail('표시 동작 오류: '+cause.message,details);}}
    }
    return true;
  }
  function eligible(rule,event,eventValues=values,eventMachines=machines,eventBodies=sceneRuntime?.getBodies()||{}){
    if(rule.inState&&eventMachines[rule.inState.machineId]!==rule.inState.stateId){log('condition',rule.name+': 현재 단계에서는 실행하지 않습니다.',{ruleId:rule.id});return false;}
    if(rule.condition){try{const condition=evaluate(rule.condition,eventValues,event,eventBodies);if(typeof condition!=='boolean')throw Error('조건은 참/거짓이어야 합니다.');if(!condition){log('condition',rule.name+': 조건이 맞지 않습니다.',{ruleId:rule.id});return false;}}catch(cause){fail(rule.name+': '+cause.message,{ruleId:rule.id});return false;}}
    return true;
  }
  function runRule(rule,event){
    const ok=commitActions(rule.actions,event,{ruleId:rule.id});if(ok)log('rule',rule.name,{ruleId:rule.id});return ok;
  }
  function drain(){
    if(processing||destroyed)return;processing=true;let budget=MAX_EVENTS;
    try{while(queue.length){if(--budget<0){queue=[];paused=true;fail('이벤트가 순환하여 실행을 멈췄습니다. 규칙의 조건을 확인하세요.');break;}
      const item=queue.shift();if(item.generation!==generation)continue;
      const event=eventContext({delta:0,...item.event});rememberEvent(event);bindingVersion++;
      const eventBodies=sceneRuntime?.getBodies()||{},candidates=matching(item.name,event).filter(rule=>eligible(rule,event,values,machines,eventBodies));
      for(const rule of candidates){if(item.generation!==generation)break;runRule(rule,event);}
    }}finally{processing=false;notify();}
  }
  function dispatch(eventName,event={}){if(destroyed||!current)return false;const candidates=matching(eventName,event);if(!candidates.length){if(queue.length)drain();return false;}queue.push({name:eventName,event:{...event},generation});drain();return true;}
  function enterSlide(id,{isPaused=paused,restoring=false}={}){
    const next=authored.slides.find(s=>s.id===id);if(!next)return false;
    generation++;current=next;clock=0;remainder=0;for(const key of held)releasedKeys.add(key);held.clear();heldDue.clear();queue=[];timers=new Map();inputErrors.clear();machines=dictionary();paused=Boolean(isPaused);error=null;lastEvent={...eventDefaults};bindingVersion++;
    for(const machine of stateMachines())machines[machine.id]=machine.initialStateId;
    for(const rule of rules())if(rule.event==='timer')timers.set(rule.id,{ruleId:rule.id,interval:rule.trigger?.intervalMs||1000,due:rule.trigger?.intervalMs||1000,active:rule.trigger?.autoStart!==false,repeat:rule.trigger?.repeat===true});
    if(restoring){notify();return true;}log('scene',next.name||'장면 시작',{slideId:next.id});
    const enteringGeneration=generation;for(const machine of stateMachines()){if(generation!==enteringGeneration)break;const initial=machine.states.find(s=>s.id===machine.initialStateId);commitActions(initial?.enterActions||[],{elapsed:0,delta:0},{machineId:machine.id});}
    dispatch('enter',{elapsed:0,delta:0});notify();return true;
  }
  function key(type,key,event={}){
    if(destroyed||!current)return false;key=normalKey(key);const down=type==='keyDown';
    if(!down&&releasedKeys.delete(key))return true;if(down)releasedKeys.delete(key);
    const wasHeld=held.has(key),relevant=rules().some(r=>['keyDown','keyUp','keyHeld'].includes(r.event)&&normalKey(r.trigger?.key||'')===key&&sourceAllowed(r));if(!relevant&&!wasHeld)return false;
    if(down){if(held.has(key))return true;held.add(key);for(const rule of rules().filter(r=>r.event==='keyHeld'&&normalKey(r.trigger?.key||'')===key))heldDue.set(rule.id,clock);}
    else{held.delete(key);for(const rule of rules().filter(r=>r.event==='keyHeld'&&normalKey(r.trigger?.key||'')===key))heldDue.delete(rule.id);}
    const context=eventContext({...event,key,down,delta:0});rememberEvent(context);bindingVersion++;dispatch(type,context);notify();return true;
  }
  function tick(delta){
    clock+=delta;const startGeneration=generation,event={elapsed:clock,delta};
    if(hasClockBinding()){lastEvent={...lastEvent,...event};bindingVersion++;}
    for(const rule of rules()){
      if(startGeneration!==generation||destroyed)break;
      if(rule.event==='keyHeld'&&held.has(normalKey(rule.trigger?.key||''))&&sourceAllowed(rule)&&clock>=(heldDue.get(rule.id)??clock)){
        heldDue.set(rule.id,clock+(rule.trigger?.intervalMs||STEP));queue.push({name:'keyHeld',event:{...event,key:normalKey(rule.trigger?.key),down:true,sourceId:rule.sourceId,__ruleId:rule.id},generation});
      }
      if(rule.event==='timer'){const timer=timers.get(rule.id);if(timer?.active&&clock>=timer.due){timer.active=timer.repeat;timer.due=clock+timer.interval;queue.push({name:'timer',event:{...event,sourceId:rule.sourceId,__ruleId:rule.id},generation});}}
    }
    // Timer/held rules are scheduled independently; retain only their own matches.
    if(queue.length)drain();
    if(startGeneration===generation&&!destroyed&&sceneRuntime){for(const item of sceneRuntime.advance(delta))if(matching(item.name,item.event).length)queue.push({...item,generation});bindingVersion++;if(queue.length)drain();}
  }
  function advance(ms,{manual=false}={}){
    if(destroyed||!current||paused&&!manual||typeof ms!=='number'||!Number.isFinite(ms)||ms<0)return false;
    remainder+=Math.min(MAX_DELTA,ms);let steps=0;while(remainder>=STEP&&steps++<7){remainder-=STEP;tick(STEP);if(destroyed||paused&&!manual)break;}notify();return true;
  }
  function setInput(inputId,value){
    const input=current?.behavior?.inputs?.find(i=>i.id===inputId);if(!input||!canSource(input.targetId)||destroyed)return false;
    try{const variable=definitions.get(input.variableId);value=validValue(variable,value);if(['number','range'].includes(input.kind)&&(value<(input.minimum??variable.minimum??0)||value>(input.maximum??variable.maximum??100)))throw Error('입력 범위를 확인하세요.');}catch(cause){inputErrors.set(inputId,cause.message);fail(cause.message,{inputId});notify();return false;}
    const hadError=inputErrors.delete(inputId);if(values[input.variableId]===value){if(hadError){error=null;notify();}return false;}
    bindingVersion++;values[input.variableId]=value;const context=eventContext({sourceId:input.targetId,value,delta:0});rememberEvent(context);bindingVersion++;error=null;log('input',definitions.get(input.variableId).name+' 값 변경',{inputId,variableId:input.variableId});dispatch('change',context);notify();return true;
  }
  function setRuntimeValues(patch){
    if(destroyed||!patch||typeof patch!=='object'||Array.isArray(patch)||![Object.prototype,null].includes(Object.getPrototypeOf(patch)))return false;
    const entries=Object.entries(patch);if(entries.length>128)return false;const prepared=[];
    try{for(const [id,value]of entries){const variable=definitions.get(id);if(!variable)throw Error('없는 동작 변수입니다.');prepared.push([id,validValue(variable,value)]);}}catch{return false;}
    if(!prepared.some(([id,value])=>values[id]!==value))return true;
    for(const [id,value]of prepared)values[id]=value;
    for(const input of current?.behavior?.inputs||[])if(Object.hasOwn(patch,input.variableId))inputErrors.delete(input.id);
    bindingVersion++;error=null;notify();return true;
  }
  function bindingValues(){if(bindingCacheVersion===bindingVersion)return bindingCache;const output=[];for(const binding of current?.behavior?.bindings||[]){let value,text,valid=true;try{value=evaluate(binding.expression,values,eventContext({}));if(binding.format==='number'||binding.format==='percent'){if(typeof value!=='number'||!Number.isFinite(value))throw Error('숫자 표시에는 숫자 식이 필요합니다.');text=new Intl.NumberFormat('ko-KR',{...(binding.format==='percent'?{style:'percent'}:{}),minimumFractionDigits:binding.decimals??0,maximumFractionDigits:binding.decimals??0}).format(value);}else text=String(value);text=(binding.prefix||'')+text+(binding.suffix||'');}catch(cause){valid=false;text='—';const signature=binding.id+':'+cause.message;if(!trace.some(t=>t.bindingError===signature))log('binding',cause.message,{bindingId:binding.id,bindingError:signature});}output.push({id:binding.id,targetId:binding.targetId,text,valid,value});}bindingCache=output;bindingCacheVersion=bindingVersion;return bindingCache;}
  function releaseInputs({dispatchKeyUp=false}={}){const active=generation;for(const released of[...held]){if(dispatchKeyUp)key('keyUp',released);releasedKeys.add(released);if(active!==generation)break;}for(const released of held)releasedKeys.add(released);held.clear();heldDue.clear();if(lastEvent.down||lastEvent.key){lastEvent={...lastEvent,down:false,key:''};bindingVersion++;}notify();}
  function needsTick(){return !destroyed&&!paused&&(sceneRuntime?.needsTick()||hasClockBinding()||[...timers.values()].some(t=>t.active)||rules().some(r=>r.event==='keyHeld'&&held.has(normalKey(r.trigger?.key||''))&&sourceAllowed(r)));}
  function getState(){return{variables:{...values},machines:{...machines},clock,timers:[...timers.values()].map(t=>({...t})),trace:clone(trace),paused,heldKeys:[...held],inputErrors:Object.fromEntries(inputErrors),...(error?{error:clone(error)}:{})};}
  function snapshot(){return{variables:{...values},machines:{...machines},clock,remainder,timers:[...timers.values()].map(t=>({ruleId:t.ruleId,remaining:Math.max(0,t.due-clock),active:t.active}))};}
  function validateSnapshot(s,slideId=current?.id){const target=authored.slides.find(s=>s.id===slideId);if(!target||!s||typeof s!=='object'||Array.isArray(s)||Object.keys(s).some(k=>!['variables','machines','clock','remainder','timers'].includes(k)))throw Error('행동 진행 형식을 확인하세요.');for(const key of['clock','remainder'])if(typeof s[key]!=='number'||!Number.isFinite(s[key])||s[key]<0||s[key]>(key==='clock'?1e12:16))throw Error('행동 진행 시간을 확인하세요.');if(!s.variables||Object.keys(s.variables).length!==definitions.size||Object.keys(s.variables).some(id=>!definitions.has(id)))throw Error('진행 변수 구성이 다릅니다.');for(const[id,def]of definitions)validValue(def,s.variables[id]);const ms=target.behavior?.machines||[];if(!s.machines||Object.keys(s.machines).length!==ms.length||Object.keys(s.machines).some(id=>!ms.some(m=>m.id===id)))throw Error('진행 단계 구성이 다릅니다.');for(const m of ms)if(!m.states.some(state=>state.id===s.machines[m.id]))throw Error('진행 단계를 확인하세요.');const timerRules=(target.behavior?.rules||[]).filter(r=>r.event==='timer');if(!Array.isArray(s.timers)||s.timers.length!==timerRules.length||new Set(s.timers.map(t=>t.ruleId)).size!==s.timers.length)throw Error('진행 타이머 구성이 다릅니다.');for(const t of s.timers){const rule=timerRules.find(r=>r.id===t.ruleId);if(!rule||Object.keys(t).some(k=>!['ruleId','remaining','active'].includes(k))||typeof t.active!=='boolean'||typeof t.remaining!=='number'||!Number.isFinite(t.remaining)||t.remaining<0||t.remaining>rule.trigger.intervalMs)throw Error('진행 타이머 값을 확인하세요.');}return clone(s);}
  function restore(s,slideId){s=validateSnapshot(s,slideId);enterSlide(slideId,{isPaused:true,restoring:true});values=dictionary(s.variables);machines=dictionary(s.machines);clock=s.clock;remainder=s.remainder;for(const t of s.timers){const current=timers.get(t.ruleId);current.active=t.active;current.due=clock+t.remaining;}trace=[];bindingVersion++;notify();return true;}
  return{enterSlide,dispatch,key,advance,setInput,setRuntimeValues,bindingValues,getState,needsTick,releaseInputs,snapshot,validateSnapshot,restore,getInputError:id=>inputErrors.get(id)||null,
    hasPointerBindings(sourceId){return rules().some(r=>['pointerDown','pointerUp','drag'].includes(r.event)&&(!r.sourceId||r.sourceId===sourceId)&&sourceAllowed(r));},
    hasClickBindings(sourceId){return rules().some(r=>['click','pointerDown','pointerUp','drag'].includes(r.event)&&(!r.sourceId||r.sourceId===sourceId)&&sourceAllowed(r));},
    pause(){paused=true;releaseInputs({dispatchKeyUp:true});notify();},play(){paused=false;notify();},step(ms=STEP){return advance(ms,{manual:true});},clearTrace(){trace=[];error=null;notify();},
    reset(){generation++;values=initialValues();machines=dictionary();timers.clear();for(const released of held)releasedKeys.add(released);held.clear();heldDue.clear();inputErrors.clear();queue=[];trace=[];clock=0;remainder=0;error=null;bindingVersion++;notify();},
    destroy(){destroyed=true;generation++;timers.clear();held.clear();heldDue.clear();queue=[];current=null;},evaluate};
}
