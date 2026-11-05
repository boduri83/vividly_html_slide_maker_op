// SPDX-License-Identifier: MPL-2.0
// Original Vividly sample: every visible part is an ordinary editable object.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {normalizeDocument} from '../src/model.js';

const root=path.resolve(import.meta.dirname,'..');
const C={ink:'#090a18',navy:'#101329',surface:'#181b37',white:'#f5f6ff',muted:'#a2aacb',violet:'#8060ff',cyan:'#51f4ee',lime:'#d8ff68',paper:'#f0f1eb',black:'#121623'};
const ids=['first-cover','first-results','showcase-design','showcase-choice','showcase-play','showcase-story','first-actions'];
const slides=[];
const geom=(x,y,width,height)=>({x,y,width,height});
const textValue=(words,size=24,color=C.white,bold=false,align='left',verticalAlign='top',fontFamily='Malgun Gothic',lineHeight=1.22)=>({paragraphs:Array.isArray(words)?words:[words],textStyle:{fontFamily,fontSize:size,lineHeight,color,align,verticalAlign,bold}});
function text(s,id,words,x,y,w,h,size=24,color=C.white,bold=false,extra={}){const e={id,type:'text',geometry:geom(x,y,w,h),text:textValue(words,size,color,bold,extra.align||'left',extra.verticalAlign||'top',extra.fontFamily||'Malgun Gothic',extra.lineHeight||1.22),name:extra.name||String(Array.isArray(words)?words.join(' '):words),semanticRole:extra.role||'body',...extra};delete e.align;delete e.verticalAlign;delete e.fontFamily;delete e.lineHeight;delete e.role;s.elements.push(e);return e;}
function box(s,id,x,y,w,h,fill,style={},extra={}){const e={id,type:'shape',geometry:geom(x,y,w,h),shape:'rectangle',fill,stroke:{color:fill,width:0},name:id,semanticRole:'decorative',style,...extra};s.elements.push(e);return e;}
function circle(s,id,x,y,d,fill,style={},extra={}){return box(s,id,x,y,d,d,fill,{radius:d/2,...style},{shape:'ellipse',...extra});}
const grad=(type,angle,colors)=>({type,angle,stops:colors.map((color,i)=>({offset:i/(colors.length-1),color}))});
function svg(s,id,x,y,w,h,shapes,title=id,extra={}){const e={id,type:'svg',geometry:geom(x,y,w,h),name:title,svg:{viewBox:{width:w,height:h},shapes,title},semanticRole:'decorative',...extra};s.elements.push(e);return e;}
function button(s,id,label,x,y,w=230,h=56,fill=C.violet,color=C.white){return box(s,id,x,y,w,h,fill,{radius:12,shadow:{x:0,y:10,blur:26,spread:0,color:fill+'35'}},{name:label,semanticRole:'body',text:textValue(label,18,color,true,'center','middle'),component:{kind:'button'}});}
function action(s,id,sourceId,actions,event='click',trigger){s.interactions.push({id,sourceId,event,actions,...(trigger?{trigger}: {})});}
function nav(s,id,label,target,x=64,y=595,w=250,fill=C.violet,color=C.white){button(s,id,label,x,y,w,54,fill,color);action(s,id+'-go',id,[{type:'goToSlide',targetId:target}]);}
function enter(s,targetId,delay=0,preset='slideInUp',duration=900){s.motions.push({id:targetId+'-entrance',targetId,preset,start:'withPrevious',duration,delay,easing:'ease-out',iterations:1,at:0});}
function float(s,targetId,duration=8000,amount=14){s.motions.push({id:targetId+'-float',targetId,preset:'keyframes',start:'withPrevious',duration,delay:0,easing:'ease-in-out',iterations:4,at:0,keyframes:[{offset:0,x:0,y:0,scale:1,rotate:0,opacity:1,blur:0},{offset:.5,x:8,y:-amount,scale:1.025,rotate:3,opacity:1,blur:0},{offset:1,x:0,y:0,scale:1,rotate:0,opacity:1,blur:0}]});}
function slide(id,name,bg=C.ink){const s={id,background:bg,elements:[],name,notes:'Vividly의 수동 편집 기능으로 만든 원본 예제입니다. 모든 글자·도형·벡터·차트는 개별 수정할 수 있습니다. 수치는 가상의 데모 데이터이며 실제 성과를 주장하지 않습니다.',motions:[],interactions:[],transition:{type:'fade',duration:550,easing:'ease-in-out',navigation:'sequential'}};slides.push(s);return s;}
function footer(s,page,light=false){const p=s.id,c=light?'#687080':'#7e87ad';box(s,p+'-footer-line',64,666,1152,1,light?'#d8dad4':'#2b2e49');text(s,p+'-footer-brand','VIVIDLY  /  BORVIS STUDIO',64,681,450,22,12,c,true,{fontFamily:'Arial'});text(s,p+'-footer-count',String(page).padStart(2,'0')+' — 07',1112,680,104,24,13,c,false,{align:'right',fontFamily:'Arial'});}
function kicker(s,label,light=false){text(s,s.id+'-kicker',label,64,43,1000,25,14,light?'#50576a':C.cyan,true,{fontFamily:'Arial'});box(s,s.id+'-topdot',1204,48,10,10,light?C.black:C.cyan,{radius:5});}
function orbit(s,id,x,y,w,h,stroke=C.cyan,rotation=0){return svg(s,id,x,y,w,h,[{kind:'path',d:`M ${w*.04} ${h*.5} C ${w*.04} ${-h*.05} ${w*.96} ${-h*.05} ${w*.96} ${h*.5} C ${w*.96} ${h*1.05} ${w*.04} ${h*1.05} ${w*.04} ${h*.5} Z`,fill:'none',stroke,strokeWidth:1.3}], '편집 가능한 궤도',{rotation});}
function plus(s,id,x,y,color=C.cyan,scale=1){return svg(s,id,x,y,22*scale,22*scale,[{kind:'path',d:`M ${11*scale} 0 L ${11*scale} ${22*scale} M 0 ${11*scale} L ${22*scale} ${11*scale}`,fill:'none',stroke:color,strokeWidth:1.3}],'빛의 십자');}

// 01: A luminous orbital sculpture supports the oversized editorial typography.
{
 const s=slide(ids[0],'01 · PRESENT VIVIDLY.');
 box(s,'cover-gradient',0,0,1280,720,C.ink,{gradient:grad('linear',125,['#070b1a','#19122f','#090b1d'])});
 circle(s,'cover-aura',722,55,510,'#4431c8',{gradient:grad('radial',0,['#7061ff80','#6a29d516','#28144b00']),blur:22});
 for(let i=0;i<11;i++){const x=780+((i*137)%430),y=86+((i*79)%455);circle(s,'cover-star-'+i,x,y,i%3===0?4:2,i%2?C.cyan:'#c8baff',{opacity:.35+(i%4)*.13});}
 orbit(s,'cover-orbit-back',690,158,530,230,'#8073e6',-24);
 circle(s,'cover-sphere',819,146,326,C.violet,{gradient:grad('radial',130,['#e8deff','#a58bff','#5a43bd','#14152f']),shadow:{x:-12,y:14,blur:75,spread:2,color:'#6355ed55'}});
 circle(s,'cover-sphere-shade',840,172,274,'#352966',{gradient:grad('linear',115,['#c6bcff20','#27253f00','#15132dba']),opacity:.85});
 orbit(s,'cover-orbit-front',718,225,495,176,C.cyan,-24);
 svg(s,'first-cover-logo',905,228,151,151,[{kind:'path',d:'M 19 30 L 75 128 L 131 30',fill:'none',stroke:'#ffffff',strokeWidth:19,strokeLinecap:'round',strokeLinejoin:'round'},{kind:'circle',cx:137,cy:16,r:10,fill:C.cyan}],'Vividly V 심벌 · 드래그해 이동');
 float(s,'cover-sphere',10500,13);float(s,'cover-orbit-front',12500,9);
 kicker(s,'BORVIS STUDIO PRESENTS  /  AN EDITABLE HTML EXPERIENCE');
 text(s,'first-cover-title',['PRESENT','VIVIDLY.'],62,132,735,240,107,C.white,true,{fontFamily:'Arial',lineHeight:.96,role:'heading',name:'표지 큰 제목 · 두 번 눌러 수정'});
 text(s,'cover-subtitle','슬라이드를 넘어, 하나의 경험으로.',67,402,706,48,29,'#c3c7ed',true);
 text(s,'cover-body',['직접 배치한 글자와 도형에','깊이와 움직임, 선택의 순간을 더하세요.'],68,467,650,70,20,C.muted,false,{lineHeight:1.4});
 nav(s,'first-cover-next','경험 시작하기  ↗','first-results',68,583,270,C.cyan,C.black);
 text(s,'cover-next-note','7개의 장면 · 모두 직접 편집 가능',363,597,390,30,15,'#a8afd4');
 text(s,'cover-art-label','SIGNAL → SPECTACLE',845,514,350,24,14,'#beb9fa',true,{fontFamily:'Arial'});
 plus(s,'cover-cross',1185,527,'#beadff',1.3);footer(s,1);enter(s,'first-cover-title',90,'slideInUp',1100);enter(s,'cover-subtitle',310);enter(s,'cover-body',430);enter(s,'first-cover-next',560);
}

// 02: A genuine animated Chart.js object, with deliberately illustrative data.
{
 const s=slide(ids[1],'02 · 데이터가 이야기가 되는 순간',C.paper);kicker(s,'01 / LIVE DATA   —   숫자를 고치면, 표현도 바뀝니다.',true);
 text(s,'results-title',['데이터에도','장면이 필요하니까.'],62,107,820,137,54,C.black,true,{lineHeight:1.16,role:'heading'});
 box(s,'results-chart-card',64,286,768,321,'#ffffff',{radius:20,shadow:{x:0,y:12,blur:38,spread:0,color:'#1b273511'}});
 text(s,'results-chart-caption','콘텐츠 반응 추이',90,307,420,30,19,C.black,true);text(s,'results-chart-unit','DEMO DATA  /  단위: 건',580,310,230,23,12,'#6e7481',false,{align:'right'});
 const old=JSON.parse(await fs.readFile(path.join(root,'examples/first-deck.json'),'utf8'));const chart=structuredClone(old.slides.find(x=>x.id==='first-results').elements.find(e=>e.type==='chart'));
 chart.id='first-results-chart';chart.geometry=geom(90,352,710,224);chart.name='월별 반응 차트 · 두 번 눌러 데이터 편집';chart.chart.series[0].color='#7255ee';chart.chart.presentation.duration=1400;s.elements.push(chart);
 box(s,'results-kpi-card',860,108,356,499,C.lime,{radius:24});text(s,'results-kpi-overline','THE SIGNAL IS RISING',887,139,300,23,14,'#384322',true,{fontFamily:'Arial'});
 text(s,'results-kpi','2.3×',882,196,310,126,99,C.black,true,{fontFamily:'Arial'});text(s,'results-kpi-caption',['1월 대비 4월','데모 반응 지표'],890,340,290,77,26,C.black,true);
 box(s,'results-kpi-rule',889,443,270,1,'#7f9750');text(s,'results-kpi-fine',['실제 성과가 아닌 예시입니다.','내 수치와 메시지로 바꾸세요.'],890,467,285,78,16,'#46512f',false,{lineHeight:1.6});
 text(s,'results-edit-hint','차트를 두 번 눌러 2월의 165를 190으로 바꾸어 보세요.',67,625,760,25,14,'#606776');
 nav(s,'first-results-next','CSS 아트워크 보기  →','showcase-design',935,600,280,C.black,C.white);footer(s,2,true);enter(s,'results-title',40);enter(s,'results-chart-card',190,'zoomIn');enter(s,'results-kpi-card',270,'slideInRight');
}

// 03: Native gradients, blur, transparency, backdrop blur and many editable layers.
{
 const s=slide(ids[2],'03 · CSS DESIGN LAB');
 box(s,'lab-background',0,0,1280,720,C.ink,{gradient:grad('linear',135,['#0b0c20','#19122e','#070b20'])});
 kicker(s,'02 / CSS DESIGN LAB   —   한 장 안에, 다른 차원의 깊이');
 text(s,'lab-title',['FLAT IS','A CHOICE.'],62,123,590,168,72,C.white,true,{fontFamily:'Arial',lineHeight:1.04,role:'heading'});
 text(s,'lab-korean','깊이는 당신이 만듭니다.',67,325,590,49,32,C.cyan,true);
 text(s,'lab-copy',['그라데이션, 글로우, 반투명 레이어.','이미지 한 장이 아니라,','하나씩 선택하고 바꾸는 디자인입니다.'],68,399,595,112,22,'#aab2d5',false,{lineHeight:1.5});
 const tagNames=['GRADIENT','GLOW','GLASS','VECTOR'];tagNames.forEach((name,i)=>{box(s,'lab-tag-'+i,67+i*126,539,114,30,'#252344',{radius:15});text(s,'lab-tag-label-'+i,name,67+i*126,546,114,19,11,'#b9b3ed',true,{fontFamily:'Arial',align:'center'});});
 circle(s,'lab-pink-aura',759,111,355,'#e560ff',{gradient:grad('radial',0,['#c95afb88','#c45afa22','#c45afa00']),blur:20});
 circle(s,'lab-cyan-aura',953,347,230,C.cyan,{gradient:grad('radial',0,['#51f4ee77','#51f4ee00']),blur:14});
 orbit(s,'lab-orbit-1',702,183,486,239,'#625dba',-28);orbit(s,'lab-orbit-2',754,137,410,342,'#54b6c0',30);
 box(s,'lab-back-card',809,157,295,326,'#4a3a80',{radius:26,gradient:grad('linear',143,['#7f69ce','#343259']),shadow:{x:0,y:22,blur:45,spread:0,color:'#00000070'}},{rotation:12});
 box(s,'lab-glass-card',750,243,360,265,'#ffffff12',{radius:26,backdropBlur:18,shadow:{x:0,y:20,blur:50,spread:0,color:'#03041550'}},{stroke:{color:'#e0d9ff66',width:1.4},rotation:-7});
 text(s,'lab-art-number','Aa',785,279,260,130,104,'#eee8ff',true,{fontFamily:'Arial',rotation:-7});
 box(s,'lab-chip',960,439,217,69,C.cyan,{radius:17,shadow:{x:0,y:10,blur:34,spread:0,color:'#51f4ee30'}},{rotation:7});
 text(s,'lab-chip-label','100% EDITABLE',977,462,180,30,15,C.black,true,{fontFamily:'Arial',rotation:7});
 plus(s,'lab-plus-a',1170,151,C.cyan,1.4);plus(s,'lab-plus-b',735,539,'#a287ff',.7);circle(s,'lab-dot',1157,351,14,'#d8ff68');
 nav(s,'lab-next','클릭하는 이야기  →','showcase-choice',68,595,270);footer(s,3);enter(s,'lab-title',50);enter(s,'lab-back-card',50,'slideInRight',1100);float(s,'lab-glass-card',11000,10);float(s,'lab-chip',9000,8);
}

// 04: The visitor chooses a direction; data-bound copy changes without navigation.
{
 const s=slide(ids[3],'04 · 선택에 반응하는 이야기');kicker(s,'03 / CHOOSE YOUR SIGNAL   —   발표도, 대화처럼');
 text(s,'choice-title',['보여주는 데서,','함께 고르는 경험으로.'],62,114,1000,139,52,C.white,true,{lineHeight:1.18,role:'heading'});
 text(s,'choice-intro','아래 버튼을 눌러 보세요. 같은 장면에서 메시지가 달라집니다.',67,281,1050,36,21,C.muted);
 box(s,'choice-surface',64,351,1152,224,'#171b35',{radius:24,gradient:grad('linear',125,['#1e2043','#121b2c']),shadow:{x:0,y:16,blur:45,spread:0,color:'#00000033'}});
 const modes=[['clarity','선명하게',C.cyan],['energy','대담하게',C.violet],['warmth','따뜻하게',C.lime]];
 modes.forEach(([value,label,color],i)=>{const bid='choice-'+value;button(s,bid,label,91+i*180,383,166,56,'#282a47',C.white);action(s,bid+'-select',bid,[{type:'setVariable',variableId:'showcase-tone',value},...modes.map(([v])=>({type:v===value?'setState':'resetState',targetId:'choice-'+v,...(v===value?{stateId:'choice-'+v+'-active'}:{})}))]);const e=s.elements.find(e=>e.id===bid);e.states=[{id:bid+'-active',name:'선택됨',style:{fill:color,color:C.black,shadow:{x:0,y:0,blur:24,color:color+'65'}}}];});
 text(s,'choice-selection','CLEAR / 선명한 한 문장',94,468,590,45,28,C.white,true,{binding:{variableId:'showcase-tone',values:[{value:'clarity',text:'CLEAR / 선명한 한 문장'},{value:'energy',text:'BOLD / 강렬한 첫인상'},{value:'warmth',text:'HUMAN / 공감하는 이야기'}],format:'text'}});
 text(s,'choice-detail','복잡한 생각을 정리해, 핵심에 시선을 모읍니다.',95,524,790,30,18,C.muted,false,{binding:{variableId:'showcase-tone',values:[{value:'clarity',text:'복잡한 생각을 정리해, 핵심에 시선을 모읍니다.'},{value:'energy',text:'큰 타이포와 과감한 색으로, 메시지의 에너지를 전합니다.'},{value:'warmth',text:'익숙한 말과 부드러운 흐름으로, 사람의 마음을 움직입니다.'}],format:'text'}});
 circle(s,'choice-art-orb',972,373,127,C.cyan,{gradient:grad('linear',145,['#e4ffad','#51f4ee','#6958ec'])});orbit(s,'choice-art-ring',926,388,220,97,'#a4a0eb',-24);float(s,'choice-art-orb',8500,8);
 nav(s,'choice-next','반응하는 장면 직접 체험  →','showcase-play',64,595,335,C.cyan,C.black);footer(s,4);enter(s,'choice-title',60);enter(s,'choice-surface',180,'zoomIn');
}

// 05: A native key/click-controlled signal: simple stateful interaction, no script.
{
 const s=slide(ids[4],'05 · PLAY THE IDEA', '#0a1520');
 box(s,'play-background',0,0,1280,720,'#0a1520',{gradient:grad('linear',100,['#07151d','#122737','#08151f'])});kicker(s,'04 / PLAY THE IDEA   —   스크린 위의 관객을, 참여자로');
 text(s,'play-title','PLAY THE IDEA.',62,106,1150,99,78,C.white,true,{fontFamily:'Arial',role:'heading'});
 text(s,'play-caption','단계 버튼 또는 숫자 키 1 · 2 · 3을 눌러 신호를 이동하세요.',67,229,1100,35,23,'#a9c6cd');
 box(s,'play-track',122,363,992,3,'#31555d');
 for(let i=0;i<3;i++){const x=183+i*401;circle(s,'play-node-'+i,x,344,43,'#0c1d28',{},{stroke:{color:'#4e6d76',width:2}});text(s,'play-node-caption-'+i,['01 / IDEA','02 / DESIGN','03 / EXPERIENCE'][i],x-99,418,242,28,16,'#89a8b4',true,{align:'center',fontFamily:'Arial'});}
 const orb=circle(s,'play-signal',183,344,43,C.cyan,{shadow:{x:0,y:0,blur:40,spread:5,color:'#51f4ee80'}},{name:'반응하는 신호 · 상태의 위치를 직접 수정',states:[{id:'signal-state-idea',name:'아이디어',style:{x:0,y:0,scale:1,fill:C.cyan}},{id:'signal-state-design',name:'디자인',style:{x:401,y:0,scale:1.3,fill:C.violet}},{id:'signal-state-experience',name:'경험',style:{x:802,y:0,scale:1.5,fill:C.lime}}]});
 text(s,'play-status','아이디어가 빛나는 순간.',66,475,1000,49,34,C.white,true,{binding:{variableId:'showcase-phase',values:[{value:'idea',text:'아이디어가 빛나는 순간.'},{value:'design',text:'생각에 색과 움직임을 더합니다.'},{value:'experience',text:'이제, 보는 사람이 이야기에 참여합니다.'}],format:'text'}});
 const phases=[['idea','아이디어'],['design','디자인'],['experience','경험']];
 phases.forEach(([value,label],i)=>{const bid='play-step-'+(i+1);button(s,bid,(i+1)+'  '+label,67+i*161,550,145,51,'#163340',C.cyan);const actions=[{type:'setState',targetId:'play-signal',stateId:'signal-state-'+value},{type:'setVariable',variableId:'showcase-phase',value}];action(s,bid+'-click',bid,actions);action(s,bid+'-key',bid,actions,'key',{key:String(i+1),once:false});});
 nav(s,'play-next','장면을 설계하는 방법  →','showcase-story',922,594,294,C.lime,C.black);footer(s,5);enter(s,'play-title',30);enter(s,'play-track',180,'fadeIn');enter(s,'play-caption',160);enter(s,'play-signal',380,'zoomIn');
}

// 06: A quiet but bold editorial spread shows a reusable business-story rhythm.
{
 const s=slide(ids[5],'06 · DESIGN THE STORY',C.paper);kicker(s,'05 / DESIGN THE STORY   —   예쁘게, 그리고 명확하게',true);
 box(s,'story-lime-surface',0,97,510,555,C.lime);text(s,'story-left-title',['BE BOLD.','STAY','CLEAR.'],61,144,430,259,76,C.black,true,{fontFamily:'Arial',lineHeight:1.02,role:'heading'});
 text(s,'story-left-copy',['화려함은 시선을 붙잡고,','명확함은 메시지를 남깁니다.'],65,460,400,100,24,'#394a20',true,{lineHeight:1.5});
 const rows=[['01','한 장, 하나의 메시지.','큰 제목과 여백으로 핵심에 먼저 시선을 모으세요.'],['02','움직임에는 이유를.','중요한 순서와 관계를 모션으로 설명하세요.'],['03','관객에게 선택권을.','클릭·질문·갈림길을 통해 자기 이야기를 찾게 하세요.']];
 rows.forEach(([n,heading,copy],i)=>{const y=143+i*155;text(s,'story-index-'+i,n,556,y,54,48,35,'#7360bf',true,{fontFamily:'Arial'});text(s,'story-head-'+i,heading,625,y+1,575,47,29,C.black,true);text(s,'story-body-'+i,copy,626,y+64,565,56,18,'#656b76',false,{lineHeight:1.5});if(i<2)box(s,'story-rule-'+i,558,y+132,658,1,'#d9dcd4');enter(s,'story-head-'+i,200+i*170);enter(s,'story-body-'+i,310+i*170);});
 nav(s,'story-next','내 이야기로 바꿔보기  →','first-actions',910,599,306,C.black,C.white);footer(s,6,true);enter(s,'story-left-title',40,'slideInLeft',1000);
}

// 07: A cinematic close that remains an ordinary human-editable Vividly slide.
{
 const s=slide(ids[6],'07 · 이제 당신의 이야기');
 box(s,'actions-background',0,0,1280,720,C.ink,{gradient:grad('linear',125,['#131435','#321c65','#080e27'])});
 circle(s,'actions-glow',822,38,498,C.violet,{gradient:grad('radial',0,['#ae68ff77','#8551f311','#624ee900']),blur:16});
 orbit(s,'actions-orbit-one',711,191,600,223,'#b29de3',-24);orbit(s,'actions-orbit-two',750,69,455,456,'#4ee5df',25);
 circle(s,'actions-sun',897,180,237,C.cyan,{gradient:grad('linear',130,['#ddff99','#60f4df','#6c55f4']),shadow:{x:0,y:0,blur:70,spread:1,color:'#5bf0df45'}});float(s,'actions-sun',12000,12);
 kicker(s,'06 / YOUR NEXT STORY   —   이제, 당신의 차례입니다.');
 text(s,'first-actions-title',['MAKE IT','YOURS.'],62,135,785,196,91,C.white,true,{fontFamily:'Arial',lineHeight:1.02,role:'heading'});
 text(s,'actions-subtitle','이 예제를, 당신의 이야기로.',67,374,860,52,34,C.cyan,true);
 text(s,'actions-copy',['편집 화면에서 제목을 두 번 누르세요.','도형 · 차트 · 색 · 모션 · 클릭 동작까지, 모두 내 손으로.'],68,449,900,80,22,'#b9b8d9',false,{lineHeight:1.5});
 nav(s,'first-actions-back','처음부터 다시 경험하기  ↗','first-cover',68,582,320,C.cyan,C.black);nav(s,'actions-chart-jump','차트 장면으로  →','first-results',412,582,230,'#3d326b',C.white);
 text(s,'actions-credit','Borvis Studio · 기획·제작: 보들이',760,608,455,30,16,'#adacd1',false,{align:'right'});
 text(s,'actions-orbit-caption','PRESENT VIVIDLY.',863,473,340,28,18,'#d5cff0',true,{fontFamily:'Arial'});
 plus(s,'actions-cross',1160,547,C.cyan,1.3);footer(s,7);enter(s,'first-actions-title',70,'slideInUp',1100);enter(s,'actions-subtitle',250);enter(s,'actions-copy',420);enter(s,'first-actions-back',550);
}

const document=normalizeDocument({format:'html-slide-document',schemaVersion:'0.15-authoring.1',id:'document-vividly-first-deck',title:'Vividly · Signal to Spectacle',canvas:{width:1280,height:720,unit:'logical-px'},slides,assets:[],theme:{colors:{primary:C.violet,secondary:C.cyan,background:C.ink,text:C.white},fontFamily:'Malgun Gothic',headingFontFamily:'Arial',spacing:{xs:8,sm:16,md:24,lg:40,xl:64}},variables:[{id:'showcase-tone',name:'이야기의 톤',initialValue:'clarity',options:[{value:'clarity',label:'선명하게'},{value:'energy',label:'대담하게'},{value:'warmth',label:'따뜻하게'}]},{id:'showcase-phase',name:'생각이 경험이 되는 과정',initialValue:'idea',options:[{value:'idea',label:'아이디어'},{value:'design',label:'디자인'},{value:'experience',label:'경험'}]}]});
assert.deepEqual(normalizeDocument(document),document);
const output=path.join(root,'examples/showcase-deck.json');
await fs.writeFile(output,JSON.stringify(document,null,2)+'\n');
console.log(JSON.stringify({path:path.relative(root,output),slides:document.slides.length,elements:document.slides.reduce((n,s)=>n+s.elements.length,0),motions:document.slides.reduce((n,s)=>n+s.motions.length,0),interactions:document.slides.reduce((n,s)=>n+s.interactions.length,0),variables:document.variables.length,slideIds:document.slides.map(s=>s.id)},null,2));
