/** Ten editable page types with empty typed slots, sharing one common brand master. */
export const BUILTIN_LAYOUT_MASTER_ID='vividly-master-studio';
export const LAYOUT_PRESET_TYPES=Object.freeze(['title','section','body','two-columns','comparison','image','chart','video','menu','blank']);
export function createLayoutPresets(canvas={width:1280,height:720}){
  const w=canvas.width,h=canvas.height,scale=Math.min(w/1280,h/720),font=Math.max(12,Math.round(26*scale)),large=Math.max(26,Math.round(52*scale)),small=Math.max(10,Math.round(15*scale)),x=w*.065,right=w*.935,contentY=h*.31,contentH=h*.55,gap=w*.035;
  const geometry=(a,b,c,d)=>({x:a,y:b,width:c,height:d});
  const text=(id,g,size=font,color='#1b2946',bold=false)=>({id,type:'text',geometry:g,text:{paragraphs:[''],textStyle:{fontFamily:'Malgun Gothic',fontSize:size,lineHeight:1.3,color,align:'left',verticalAlign:'top',bold}},semanticRole:bold?'heading':'body'});
  const decor=(id,g,fill)=>({id,type:'shape',shape:'round-rect',geometry:g,fill,stroke:{color:fill,width:0},style:{radius:Math.max(6,14*scale)},semanticRole:'decorative'});
  const master={id:BUILTIN_LAYOUT_MASTER_ID,name:'Vividly · 공통 디자인',version:1,canvas:{width:w,height:h},background:'#f8f9fe',elements:[
    {...text('vividly-common-brand',geometry(x,h*.055,w*.72,Math.max(16,h*.04)),small,'#7384a5',true),text:{paragraphs:['VIVIDLY  /  PRESENT VIVIDLY.'],textStyle:{fontFamily:'Malgun Gothic',fontSize:small,lineHeight:1.2,color:'#7384a5',align:'left',verticalAlign:'top',bold:true}},semanticRole:'decorative'},
    decor('vividly-common-accent',geometry(x,h*.12,w*.045,Math.max(3,h*.006)),'#7460ed'),
    {...text('vividly-common-footer',geometry(x,h*.945,w*.82,Math.max(15,h*.03)),Math.max(10,small-2),'#8a97af'),text:{paragraphs:['Present Vividly.'],textStyle:{fontFamily:'Malgun Gothic',fontSize:Math.max(10,small-2),lineHeight:1.2,color:'#8a97af',align:'left',verticalAlign:'top'}},semanticRole:'decorative'}]};
  function make(type,name,{dark=false,blank=false}={}){
    const prefix='vividly-'+type+'-',elements=[],slots=[];
    const add=(key,role,g,prompt,{size=font,color=dark?'#d7dff2':'#405473',bold=false}={})=>{const e=text(prefix+key,g,size,color,bold);e.name=prompt;if(['image','chart','table','video'].includes(role)){Object.assign(e,{type:'shape',shape:'round-rect',fill:dark?'#1c2a46':'#edf1fa',stroke:{color:dark?'#41516e':'#c5d0e7',width:1},style:{radius:Math.max(8,18*scale)}});e.text.textStyle.align='center';e.text.textStyle.verticalAlign='middle';}elements.push(e);slots.push({elementId:e.id,key,role,prompt});return e;};
    if(!blank){
      if(type==='title'){elements.push(decor(prefix+'halo',geometry(w*.67,h*.18,w*.25,w*.25),'#302b60'));add('title','title',geometry(x,h*.26,w*.7,h*.24),'제목을 입력하세요',{size:large,color:'#ffffff',bold:true});add('subtitle','subtitle',geometry(x,h*.59,w*.67,h*.15),'부제목을 입력하세요',{size:Math.max(18,30*scale)});}
      else if(type==='section'){add('title','title',geometry(x,h*.34,w*.86,h*.2),'섹션 제목을 입력하세요',{size:large,color:'#ffffff',bold:true});add('subtitle','subtitle',geometry(x,h*.6,w*.8,h*.13),'섹션 설명을 입력하세요');}
      else{
        add('title','title',geometry(x,h*.17,w*.87,h*.1),'제목을 입력하세요',{size:Math.max(22,36*scale),color:'#1b2946',bold:true});
        if(type==='body')add('body','body',geometry(x,contentY,w*.87,contentH),'내용을 입력하세요');
        if(type==='two-columns'||type==='comparison'){const cw=(right-x-gap)/2;if(type==='comparison'){elements.push(decor(prefix+'left-card',geometry(x-12*scale,contentY-10*scale,cw+24*scale,contentH+20*scale),'#ffffff'),decor(prefix+'right-card',geometry(x+cw+gap-12*scale,contentY-10*scale,cw+24*scale,contentH+20*scale),'#e9e8fb'));}add('body-left','body',geometry(x,contentY,cw,contentH),'왼쪽 내용을 입력하세요');add('body-right','body',geometry(x+cw+gap,contentY,cw,contentH),'오른쪽 내용을 입력하세요');}
        if(type==='image'){const left=w*.53;add('image','image',geometry(x,contentY,left,contentH),'이미지를 추가하세요');add('body','body',geometry(x+left+gap,contentY,right-x-left-gap,contentH),'설명을 입력하세요');}
        if(type==='chart'){add('chart','chart',geometry(x,contentY,w*.6,contentH),'차트를 추가하세요');add('body','body',geometry(w*.72,contentY,w*.215,contentH),'분석 내용을 입력하세요');}
        if(type==='video')add('video','video',geometry(x,contentY,w*.87,contentH),'동영상을 추가하세요');
        if(type==='menu'){const cw=(right-x-gap)/2,ch=(contentH-h*.035)/2;for(let i=0;i<4;i++){const e=add('menu-'+(i+1),'text',geometry(x+(i%2)*(cw+gap),contentY+Math.floor(i/2)*(ch+h*.035),cw,ch),'메뉴 '+(i+1)+' 제목');Object.assign(e,{type:'shape',shape:'round-rect',fill:i%2?'#147e7d':'#6552df',stroke:{color:'#ffffff00',width:0},style:{radius:Math.max(8,16*scale)},component:{kind:'button'}});e.text.textStyle.color='#ffffff';e.text.textStyle.align='center';e.text.textStyle.verticalAlign='middle';}}
      }
    }
    return{id:'vividly-layout-'+type,name,version:1,canvas:{width:w,height:h},background:dark?'#111b32':'#f8f9fe',elements,placeholderIds:slots.map(s=>s.elementId),slots,...(!blank?{masterId:BUILTIN_LAYOUT_MASTER_ID,inheritBackground:!dark}:{})};
  }
  return{layoutMasters:[master],layouts:[make('title','표지',{dark:true}),make('section','구분',{dark:true}),make('body','제목과 본문'),make('two-columns','두 열'),make('comparison','비교'),make('image','이미지와 설명'),make('chart','차트와 설명'),make('video','동영상'),make('menu','인터랙티브 메뉴'),make('blank','빈 슬라이드',{blank:true})]};
}
export const getLayoutPresets=createLayoutPresets;
