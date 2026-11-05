/** Editable no-code game. Runtime counters and routing never alter author snapshots. */
import {normalizeDocument} from './model.js';
import {ADVANCED_SCHEMA} from './motion-model.js';

export function createInteractiveGame(context){
  const p='vividly-click-game',id=k=>`${p}-${k}`;
  const font=context?.theme?.fontFamily||'Malgun Gothic';
  const text=(k,x,y,w,h,value,size=28,color='#e7ecff',bold=false)=>({id:id(k),type:'text',name:value.split('\n')[0],geometry:{x,y,width:w,height:h},text:{paragraphs:value.split('\n'),textStyle:{fontFamily:font,fontSize:size,lineHeight:1.3,color,align:'left',verticalAlign:'middle',bold}}});
  const button=(k,x,y,w,h,value,fill='#6057ff')=>({id:id(k),type:'shape',shape:'round-rect',name:value,geometry:{x,y,width:w,height:h},fill,stroke:{color:fill,width:0},text:{paragraphs:[value],textStyle:{fontFamily:font,fontSize:26,lineHeight:1.2,color:'#ffffff',align:'center',verticalAlign:'middle',bold:true}},component:{kind:'button'},style:{shadow:{x:0,y:14,blur:32,spread:0,color:'#060b2266'}}});
  const rule=(k,source,actions,extra={})=>({id:id(k),sourceId:id(source),event:'click',actions,...extra});
  const route=target=>({type:'goToSlide',targetId:id(target)}),set=value=>({type:'setVariable',variableId:id('score'),value:String(value)});
  const counter=(k,x,y)=>({...text(k,x,y,450,95,'0점',60,'#9fffe0',true),binding:{variableId:id('score'),source:'variable',values:[],format:'number',suffix:'점',animate:true}});
  const slide=(k,name,elements,interactions)=>({id:id(k),name,background:'#10172f',elements,transition:{type:'fade',duration:260,easing:'ease-out',navigation:'interaction'},interactions});
  const target=button('target',495,265,290,170,'클릭 +1','#10a78b');
  target.states=[{id:id('target-hover-state'),name:'웹 · 떠오르기',style:{y:-10,scale:1.06,shadow:{x:0,y:12,blur:24,color:'#23eec488'}}}];
  const hint=text('hint',180,570,920,50,'5점 이상이면 결과 화면을 열 수 있습니다.',23,'#a4afce');
  hint.states=[{id:id('hint-state'),name:'점수를 더 모아 주세요',style:{color:'#ffcb71',scale:1.03}}];
  const slides=[
    slide('intro','인터랙티브 · 시작',[text('intro-kicker',100,80,1000,45,'INTERACTIVE / NO-CODE',20,'#9c94ff',true),text('intro-heading',100,160,1060,180,'화면을 넘기는 자료에서,\n직접 참여하는 경험으로.',54,'#ffffff',true),text('intro-body',100,385,1030,100,'숫자 변수 · 조건 · 버튼 · CSS 상태를 연결한 작은 클릭 게임입니다.\n모든 요소와 동작은 편집 화면에서 직접 바꿀 수 있습니다.',25),button('start',100,550,310,85,'시작하기 →')],[rule('start-rule','start',[set(0),route('play')])]),
    slide('play','인터랙티브 · 점수 모으기',[text('play-heading',90,65,1050,70,'버튼을 눌러 5점을 모아 보세요.',40,'#ffffff',true),counter('score-text',90,150),target,button('finish',900,500,280,82,'결과 확인 →'),button('home',90,500,240,82,'처음으로','#344261'),hint],[rule('increment-rule','target',[{type:'addVariable',variableId:id('score'),amount:1}]),{id:id('target-hover-rule'),sourceId:id('target'),event:'hover',actions:[{type:'setState',targetId:id('target'),stateId:id('target-hover-state')}]},{id:id('target-leave-rule'),sourceId:id('target'),event:'leave',actions:[{type:'resetState',targetId:id('target')}]},rule('finish-rule','finish',[route('result')],{condition:{variableId:id('score'),operator:'greaterOrEqual',value:'5'}}),rule('hint-rule','finish',[{type:'setState',targetId:id('hint'),stateId:id('hint-state')}],{condition:{variableId:id('score'),operator:'less',value:'5'}}),rule('home-rule','home',[set(0),route('intro')])]),
    slide('result','인터랙티브 · 결과',[text('result-kicker',100,90,1050,50,'YOU MADE IT',22,'#a6ffdd',true),text('result-heading',100,170,1060,110,'참여가, 다음 페이지를 엽니다.',52,'#ffffff',true),text('result-label',100,330,500,50,'직접 만든 점수',24),counter('result-score',100,400),button('restart',100,555,320,88,'다시 시작 ↻')],[rule('restart-rule','restart',[set(0),route('intro')])]),
  ];
  const canvas=context?.canvas?structuredClone(context.canvas):{width:1280,height:720,unit:'logical-px'};
  const scale=Math.min(canvas.width/1280,canvas.height/720),dx=(canvas.width-1280*scale)/2,dy=(canvas.height-720*scale)/2;
  for(const s of slides)for(const e of s.elements){e.geometry={x:dx+e.geometry.x*scale,y:dy+e.geometry.y*scale,width:e.geometry.width*scale,height:e.geometry.height*scale};if(e.text)e.text.textStyle.fontSize*=scale;}
  return normalizeDocument({format:'html-slide-document',schemaVersion:ADVANCED_SCHEMA,id:id('deck'),title:'클릭으로 완성하는 작은 게임',canvas,slides,assets:[],variables:[{id:id('score'),name:'게임 점수',kind:'number',initialValue:'0',options:[],minimum:0,maximum:100,step:1}]});
}
