/** Optional fluid projection. Authored coordinates and shared history remain canonical. */
const number=(minimum,maximum)=>({type:'number',minimum,maximum});
const object=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
const choice=(...values)=>({type:'string',enum:values});
const flowProperties={direction:choice('row','column','grid'),columns:{type:'integer',minimum:1,maximum:100},gap:number(0,100000),padding:number(0,100000),wrap:{type:'boolean'},minChildWidth:number(24,10000)};
export const responsiveSchemas={
  document:object({enabled:{type:'boolean'},minWidth:number(240,2560),maxWidth:number(240,10000),showControls:{type:'boolean'}},['enabled','minWidth','maxWidth']),
  element:object({width:choice('scale','fixed','stretch'),anchor:choice('left','center','right'),minHeight:number(0,100000),fontSize:object({phone:number(6,240),tablet:number(6,240)}),sticky:object({top:number(0,100000)},['top']),tablet:object(flowProperties),phone:object(flowProperties)}),
};
const fail=message=>{throw Error(message);};
function exact(value,keys,label){if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail(label+': 객체가 필요합니다.');for(const key of Object.keys(value))if(!keys.includes(key))fail(label+'.'+key+': 지원하지 않는 설정입니다.');}
function finite(value,min,max,label){if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)fail(label+': '+min+'~'+max+' 범위의 수가 필요합니다.');return value;}
function enumeration(value,values,label){if(!values.includes(value))fail(label+': 지원하지 않는 값입니다.');return value;}
export function normalizeResponsiveDocument(value){exact(value,Object.keys(responsiveSchemas.document.properties),'responsive');if(typeof value.enabled!=='boolean')fail('responsive.enabled: Boolean이 필요합니다.');const result={enabled:value.enabled,minWidth:finite(value.minWidth,240,2560,'responsive.minWidth'),maxWidth:finite(value.maxWidth,240,10000,'responsive.maxWidth')};if(result.maxWidth<result.minWidth)fail('반응형 최대 너비는 최소 너비 이상이어야 합니다.');if(value.showControls!==undefined){if(typeof value.showControls!=='boolean')fail('responsive.showControls: Boolean이 필요합니다.');result.showControls=value.showControls;}return result;}
export function normalizeResponsiveElement(value){
  exact(value,Object.keys(responsiveSchemas.element.properties),'element.responsive');const result={};
  if(value.width!==undefined)result.width=enumeration(value.width,['scale','fixed','stretch'],'responsive.width');
  if(value.anchor!==undefined)result.anchor=enumeration(value.anchor,['left','center','right'],'responsive.anchor');
  if(value.minHeight!==undefined)result.minHeight=finite(value.minHeight,0,100000,'responsive.minHeight');
  if(value.fontSize!==undefined){exact(value.fontSize,['phone','tablet'],'responsive.fontSize');result.fontSize={};for(const[key,size]of Object.entries(value.fontSize))result.fontSize[key]=finite(size,6,240,'responsive.fontSize.'+key);}
  if(value.sticky!==undefined){exact(value.sticky,['top'],'responsive.sticky');result.sticky={top:finite(value.sticky.top,0,100000,'responsive.sticky.top')};}
  for(const profile of ['tablet','phone'])if(value[profile]!==undefined){const input=value[profile],settings={};exact(input,Object.keys(flowProperties),'responsive.'+profile);for(const[key,entry]of Object.entries(input)){
    if(key==='direction')settings[key]=enumeration(entry,['row','column','grid'],profile+'.direction');
    else if(key==='wrap'){if(typeof entry!=='boolean')fail(profile+'.wrap: Boolean이 필요합니다.');settings[key]=entry;}
    else{const schema=flowProperties[key];settings[key]=finite(entry,schema.minimum,schema.maximum,profile+'.'+key);if(key==='columns'&&!Number.isInteger(entry))fail(profile+'.columns: 정수가 필요합니다.');}
  }result[profile]=settings;}
  return result;
}
export function validateResponsiveReferences(document){
  for(const slide of [...document.slides,...(document.layouts||[]),...(document.layoutMasters||[])])for(const element of slide.elements){const settings=element.responsive;if(!settings)continue;if(settings.fontSize&&!element.text)fail('화면별 글자 크기는 텍스트가 있는 개체에서 사용하세요.');if((settings.tablet||settings.phone)&&!element.flow)fail('화면별 배치 설정은 자동 배치 컨테이너에서 사용하세요.');if(settings.sticky&&(element.type==='connector'||element.rotation))fail('고정 헤더는 회전하지 않은 일반 개체를 선택하세요.');}
}

/** Self-contained: the same function is embedded in independent HTML. */
export function projectResponsiveSlide(input,document,requestedWidth){
  const slide=JSON.parse(JSON.stringify(input)),baseWidth=document.canvas.width,baseHeight=document.canvas.height,settings=document.responsive;
  if(!settings?.enabled)return{slide,width:baseWidth,height:baseHeight,profile:'desktop',responsive:false};
  const width=Math.max(settings.minWidth,Math.min(settings.maxWidth,Number.isFinite(requestedWidth)?requestedWidth:baseWidth)),ratio=width/baseWidth,profile=width<=640?'phone':width<=1024?'tablet':'desktop';
  const indexed=new Map(slide.elements.map(element=>[element.id,element])),originals=new Map(input.elements.map(element=>[element.id,element])),parents=new Set(slide.elements.flatMap(element=>[...(element.flow?.children||[]),...(element.composition?.children||[])])),done=new Set(),active=new Set();
  const overlays=new Set(),overlayParents=new Map();function collectOverlay(id,panelId){if(overlays.has(id))return;overlays.add(id);overlayParents.set(id,panelId);for(const child of indexed.get(id)?.flow?.children||[])collectOverlay(child,panelId);}
  for(const element of slide.elements)if(element.component?.kind==='panel'){collectOverlay(element.id,element.id);for(const child of element.component.contentIds||[])collectOverlay(child,element.id);}
  const rounded=value=>Math.round(value*1000)/1000;
  for(const element of slide.elements){const size=element.responsive?.fontSize?.[profile];if(size&&element.text){const original=element.text.textStyle.fontSize,ratio=size/original;element.text.textStyle.fontSize=size;for(const run of element.text.runs||[])if(run.fontSize!==undefined)run.fontSize=rounded(run.fontSize*ratio);}}
  function textHeight(element,available){
    if(!element.text)return element.geometry.height;const t=element.text.textStyle,font=t.fontSize||24,line=(t.lineHeight||1.3)*font,usable=Math.max(font,available-8),runs=element.text.runs||[];
    let lines=0;for(const paragraph of element.text.paragraphs)for(const part of paragraph.split('\n')){let length=0;for(const char of part)length+=/[\u2e80-\uffff]/.test(char)?font:font*.55;lines+=Math.max(1,Math.ceil(length/usable));}
    const maxRun=Math.max(font,...runs.map(run=>run.fontSize||font));
    const source=originals.get(element.id),minimum=element.responsive?.fontSize?.[profile]?source.geometry.height*font/(source.text?.textStyle?.fontSize||font):element.geometry.height;return Math.max(element.responsive?.minHeight||0,minimum,lines*Math.max(line,maxRun*(t.lineHeight||1.3))+6);
  }
  function place(element,x,y,availableWidth){
    const original=originals.get(element.id),g=element.geometry;g.x=rounded(x);g.y=rounded(y);g.width=rounded(Math.max(1,availableWidth));
    if(element.composition)compose(element);else if(element.flow)arrange(element);else if(['image','svg','video'].includes(element.type))g.height=rounded(Math.max(1,original.geometry.height*g.width/original.geometry.width));else if(element.text)g.height=rounded(textHeight(element,g.width));
  }
  function compose(container){
    if(done.has(container.id))return;if(active.has(container.id))throw Error('반응형 컴포넌트에 순환 참조가 있습니다.');active.add(container.id);
    const original=originals.get(container.id),scale=container.geometry.width/original.geometry.width,members=new Set();
    function collect(id){if(members.has(id))return;members.add(id);const element=indexed.get(id);for(const child of [...(element?.flow?.children||[]),...(element?.composition?.children||[])])collect(child);}
    for(const child of container.composition.children)collect(child);
    for(const id of members){const member=indexed.get(id),source=originals.get(id);if(!member||!source)continue;member.geometry={x:container.geometry.x+(source.geometry.x-original.geometry.x)*scale,y:container.geometry.y+(source.geometry.y-original.geometry.y)*scale,width:Math.max(1,source.geometry.width*scale),height:Math.max(1,source.geometry.height*scale)};}
    for(const id of container.composition.children){const member=indexed.get(id);if(member&&!member.hidden)place(member,member.geometry.x,member.geometry.y,member.geometry.width);}
    container.geometry.height=rounded(Math.max(1,container.responsive?.minHeight||0,...[...members].map(id=>indexed.get(id)).filter(member=>member&&!member.hidden).map(member=>member.geometry.y+member.geometry.height-container.geometry.y)));
    active.delete(container.id);done.add(container.id);
  }
  function arrange(container){
    if(done.has(container.id))return;if(active.has(container.id))throw Error('반응형 자동 배치에 순환 참조가 있습니다.');active.add(container.id);
    const source=originals.get(container.id),base=container.flow,override=container.responsive?.[profile]||{},f={...base,...override};
    if(profile==='phone'&&!Object.hasOwn(override,'direction')&&(f.direction==='row'||f.direction==='grid')){f.direction='column';f.columns=1;}
    const padding=Math.min(f.padding,Math.max(0,(container.geometry.width-1)/2)),gap=f.gap,inner=Math.max(1,container.geometry.width-padding*2),children=f.children.map(id=>indexed.get(id)).filter(child=>child&&!child.hidden),startX=container.geometry.x+padding,startY=container.geometry.y+padding;
    const childWidth=child=>child.responsive?.width==='fixed'?Math.min(inner,originals.get(child.id).geometry.width):inner;
    let contentHeight=0;
    if(f.direction==='grid'){
      const minimum=f.minChildWidth||240,autoColumns=f.wrap===false?f.columns:Math.max(1,Math.floor((inner+gap)/(minimum+gap))),columns=Math.max(1,Math.min(children.length,f.columns,autoColumns)),cell=Math.max(1,(inner-gap*(columns-1))/columns);let y=startY;
      for(let index=0;index<children.length;index+=columns){const row=children.slice(index,index+columns);for(const[at,child]of row.entries())place(child,startX+at*(cell+gap),y,child.responsive?.width==='fixed'?Math.min(cell,originals.get(child.id).geometry.width):cell);const h=Math.max(0,...row.map(child=>child.geometry.height));y+=h+gap;}contentHeight=children.length?y-startY-gap:0;
    }else if(f.direction==='column'){
      let y=startY;for(const child of children){const w=childWidth(child),x=startX+(f.align==='center'?(inner-w)/2:f.align==='end'?inner-w:0);place(child,x,y,w);y+=child.geometry.height+gap;}contentHeight=children.length?y-startY-gap:0;
    }else{
      let x=startX,y=startY,rowHeight=0;for(const child of children){const natural=originals.get(child.id).geometry.width,w=Math.min(inner,natural);if((f.wrap??true)&&x>startX&&x+w>startX+inner+.01){x=startX;y+=rowHeight+gap;rowHeight=0;}place(child,x,y,w);rowHeight=Math.max(rowHeight,child.geometry.height);x+=w+gap;}contentHeight=y-startY+rowHeight;
    }
    container.geometry.height=rounded(Math.max(1,container.responsive?.minHeight||0,contentHeight+padding*2));active.delete(container.id);done.add(container.id);
  }
  const growth=[];
  for(const element of slide.elements.filter(element=>!parents.has(element.id)&&(!overlays.has(element.id)||element.component?.kind==='panel')).sort((a,b)=>a.geometry.y-b.geometry.y)){
    const original=originals.get(element.id);if(element.hidden){if((element.flow||element.composition)&&!overlays.has(element.id))growth.push({end:original.geometry.y+original.geometry.height,delta:-original.geometry.height});continue;}
    const g=element.geometry,r=element.responsive||{},newWidth=r.width==='fixed'?g.width:r.width==='stretch'?Math.max(1,g.width+width-baseWidth):Math.max(1,g.width*ratio);
    let x=r.anchor==='right'?width-(baseWidth-g.x-g.width)-newWidth:r.anchor==='center'?width/2+(g.x+g.width/2-baseWidth/2)*ratio-newWidth/2:g.x*ratio;
    const y=g.y+growth.filter(event=>event.end<=original.geometry.y+.01).reduce((sum,event)=>sum+event.delta,0);
    if(element.component?.kind==='panel')place(element,16,16,Math.min(original.geometry.width,Math.max(1,width-32)));
    else place(element,x,y,newWidth);
    if((element.flow||element.composition)&&!overlays.has(element.id)&&Math.abs(g.height-original.geometry.height)>.01)growth.push({end:original.geometry.y+original.geometry.height,delta:g.height-original.geometry.height});
  }
  for(const element of slide.elements)if(overlays.has(element.id)&&element.component?.kind!=='panel'&&!parents.has(element.id)&&!element.hidden){
    const parent=indexed.get(overlayParents.get(element.id)),original=originals.get(element.id),parentOriginal=originals.get(parent.id),scale=parent.geometry.width/parentOriginal.geometry.width;
    place(element,parent.geometry.x+(original.geometry.x-parentOriginal.geometry.x)*scale,parent.geometry.y+original.geometry.y-parentOriginal.geometry.y,Math.max(1,original.geometry.width*scale));
  }
  for(const element of slide.elements)if(element.flow&&!done.has(element.id))arrange(element);
  for(const element of slide.elements)if(element.composition&&!done.has(element.id))compose(element);
  const height=rounded(Math.max(1,...slide.elements.filter(element=>!element.hidden&&!overlays.has(element.id)).map(element=>element.geometry.y+element.geometry.height+16)));
  return{slide,width,height,profile,responsive:true};
}
