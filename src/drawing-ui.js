/** Canvas drawing keeps all uncommitted geometry local; one completed gesture is one command batch. */
import {shapeAdjustmentHandles,solveShapeHandle} from './shapes.js';
import {anchorPoint,resolveConnectorGeometry} from './business-model.js';
import {renderSlideContent} from './render.js';
import {distance,simplifyDrawnPoints,normalizeDrawnPath,elementLocalPoint,elementWorldPoint,reboxFreeform,nearestPathSegment,nearestConnectorPort,constrainPoint45,translatedConnector,insertConnectorWaypoint} from './drawing-geometry.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone=value=>structuredClone(value);
const editable=target=>target?.closest?.('input,textarea,select,[contenteditable=true],dialog[open]');
const anchors=['top','right','bottom','left'];
const emptyText=()=>({paragraphs:[],textStyle:{fontFamily:'Malgun Gothic',fontSize:28,lineHeight:1.2,color:'#182037',align:'center',verticalAlign:'middle'}});

export function createDrawingWorkbench({store,action,render,notice,scale=()=>1,prepareGesture=()=>{},composing=()=>Boolean(store.textSession?.composing),blocked=()=>false}){
  const stage=document.getElementById('stage');
  const overlay=document.createElement('div');overlay.id='dw-overlay';overlay.setAttribute('aria-label','도형 편집 핸들');
  stage.append(overlay);
  let mode=null,gesture=null,polygon=null,connection=null,hover=null,snap=null,session=store.sessionId,slide=store.activeSlideId,lastPointClick=null,selectedPointIndex=null,selectedWaypointIndex=null,waypointElementId=null,lastConnectorClick=null,suppressDoubleClickUntil=0;
  const current=()=>store.selectedIds.length===1?store.selectedElement:null;
  const context=()=>JSON.stringify({sessionId:store.sessionId,slideId:store.activeSlideId,revision:store.revision,ids:[...store.selectedIds]});
  const screenScale=()=>Math.max(.01,scale());
  const point=event=>{const rect=stage.getBoundingClientRect(),s=screenScale();return{x:Math.max(0,Math.min(store.document.canvas.width,(event.clientX-rect.left)/s)),y:Math.max(0,Math.min(store.document.canvas.height,(event.clientY-rect.top)/s))};};
  const localPoints=element=>element.path.points.map(p=>({x:p.x*element.geometry.width,y:p.y*element.geometry.height}));
  const route=()=>document.getElementById('draw-connector-route')?.value||'straight';
  const consume=event=>{event.preventDefault();event.stopImmediatePropagation();};
  function restoreOriginal(){if(gesture?.elementId){const node=stage.querySelector(`#slide-content [data-element-id="${CSS.escape(gesture.elementId)}"]`);if(node)node.style.visibility='';}}
  function release(){if(gesture?.pointerId!==undefined&&stage.hasPointerCapture(gesture.pointerId))try{stage.releasePointerCapture(gesture.pointerId);}catch{}}
  function classes(){stage.classList.toggle('dw-tool-active',Boolean(mode&&mode!=='points'));stage.classList.toggle('dw-point-edit',mode==='points');stage.classList.toggle('dw-gesture',Boolean(gesture));stage.style.setProperty('--dw-scale',String(screenScale()));}
  function cancel(quiet=false){restoreOriginal();release();gesture=null;polygon=null;connection=null;hover=null;snap=null;mode=null;lastPointClick=null;selectedPointIndex=null;selectedWaypointIndex=null;waypointElementId=null;lastConnectorClick=null;classes();paint();if(!quiet)notice('그리기를 취소했습니다. 문서는 변경하지 않았습니다.');}
  function arm(next){
    cancel(true);
    if(!next)return;
    if(blocked()||document.querySelector('dialog[open]')||store.textSession?.composing||!document.getElementById('presentation').hidden)return;
    if(next==='points'&&!(current()?.type==='shape'&&current()?.shape==='freeform')){notice('점을 편집할 자유형 도형을 먼저 선택하세요.');return;}
    if(!['freehand','freeform','connector','points'].includes(next))return;
    mode=next;classes();paint();stage.focus({preventScroll:true});
    notice({freehand:'캔버스를 드래그해 자유롭게 그리세요. Esc는 취소합니다.',freeform:'클릭으로 점을 추가하세요. 첫 점 클릭은 닫기, 두 번 클릭·Enter는 완료, Ctrl+Enter는 닫기입니다.',connector:'드래그하거나 시작·끝을 차례로 클릭하세요. Alt는 자유점, Shift는 45° 맞춤, Esc는 취소입니다.',points:'점을 드래그해 모양을 바꾸세요. 선을 두 번 누르면 점 추가, 점에서 Delete는 삭제, Esc는 완료합니다.'}[next]);
  }
  function renderedPort(element,p,fallback){
    if(element.type!=='shape'||['rectangle','ellipse','freeform'].includes(element.shape))return fallback;
    const node=stage.querySelector(`#slide-content [data-element-id="${CSS.escape(element.id)}"] .element-shape-geometry`);if(!node)return fallback;
    const local=elementLocalPoint(element,p);let best=null;
    for(const path of node.querySelectorAll('g path'))try{
      if(path.closest('defs'))continue;const length=path.getTotalLength();if(!length)continue;
      const inset=Math.min((element.stroke?.width||0)/2,element.geometry.width/2-.000001,element.geometry.height/2-.000001),at=t=>{const q=path.getPointAtLength(t);return{x:q.x+inset,y:q.y+inset};},steps=48;
      let position=0,d=Infinity;for(let i=0;i<=steps;i++){const value=length*i/steps,extent=distance(local,at(value));if(extent<d){d=extent;position=value;}}
      let lo=Math.max(0,position-length/steps),hi=Math.min(length,position+length/steps);for(let i=0;i<18;i++){const a=lo+(hi-lo)/3,b=hi-(hi-lo)/3;if(distance(local,at(a))<distance(local,at(b)))hi=b;else lo=a;}
      const q=at((lo+hi)/2),positionValue={x:Math.max(0,Math.min(1,q.x/element.geometry.width)),y:Math.max(0,Math.min(1,q.y/element.geometry.height))},world=anchorPoint(element,'custom',positionValue),extent=distance(p,world);
      if(!best||extent<best.distance)best={position:positionValue,point:world,distance:extent,inside:fallback.inside};
    }catch{ /* A path without geometry keeps the finite bounding-edge port. */ }
    return best||fallback;
  }
  function snapEndpoint(p,{altKey=false}={}){
    if(altKey){snap=null;return{point:{x:p.x,y:p.y}};}
    let best=null;
    for(const element of [...store.activeSlide.elements].reverse()){
      if(element.type==='connector'||element.hidden||element.locked||element.semanticRole==='decorative')continue;
      const candidate=nearestConnectorPort(element,p);if(!candidate.inside&&candidate.distance>14/screenScale())continue;
      const port=renderedPort(element,p,candidate),inside=port.inside;
      if((port.distance<=14/screenScale()||inside)&&(!best||inside&&!best.inside||inside===best.inside&&port.distance<best.distance))best={element,position:port.position,point:port.point,distance:port.distance,inside};
      if(best?.inside)break;
    }
    snap=best;
    return best?{elementId:best.element.id,anchor:'custom',position:best.position}:{point:{x:p.x,y:p.y}};
  }
  function endpointAt(p,event,origin){
    const next=event?.shiftKey&&origin?constrainPoint45(origin,p):p,endpoint=snapEndpoint(next,event||{});
    if(event?.shiftKey&&origin&&endpoint.elementId){const target=store.activeSlide.elements.find(e=>e.id===endpoint.elementId),actual=anchorPoint(target,endpoint.anchor,endpoint.position),dx=next.x-origin.x,dy=next.y-origin.y;if(Math.abs(dx*(actual.y-origin.y)-dy*(actual.x-origin.x))>1e-4*Math.max(1,Math.hypot(dx,dy))){snap=null;return{point:next};}}
    return endpoint;
  }
  function connectorPreview(element){
    const resolved=resolveConnectorGeometry(element,store.activeSlide),g=resolved.geometry;
    return `<svg class="dw-preview-svg" width="${store.document.canvas.width}" height="${store.document.canvas.height}" aria-hidden="true"><defs><marker id="dw-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${esc(element.connector.stroke.color)}"/></marker></defs><path transform="translate(${g.x} ${g.y})" d="${esc(resolved.path)}" fill="none" stroke="${esc(element.connector.stroke.color)}" stroke-width="${element.connector.stroke.width}" stroke-linecap="round" ${element.connector.arrow!=='none'?'marker-end="url(#dw-arrow)"':''} ${element.connector.arrow==='both'?'marker-start="url(#dw-arrow)"':''}/></svg>`;
  }
  function shapePreview(element){return renderSlideContent({...store.activeSlide,elements:[element]},store.document,{interactive:false});}
  function button(kind,p,label,extra=''){
    const size=12/screenScale();return `<button type="button" class="dw-handle dw-handle-${kind}" data-drawing-handle="${kind}" ${extra} aria-label="${esc(label)}" title="${esc(label)}" style="left:${p.x}px;top:${p.y}px;width:${size}px;height:${size}px"></button>`;
  }
  function selectionHandles(element){
    if(!element||element.locked||element.hidden||store.textSession)return '';
    if(element.type==='connector'){
      const resolved=resolveConnectorGeometry(element,store.activeSlide);
      return button('connector-from',resolved.from,'연결선 시작점 · Alt 자유점 · Shift 45°')+button('connector-to',resolved.to,'연결선 끝점 · Alt 자유점 · Shift 45°')+(['elbow','curve'].includes(element.connector.route)?button('connector-control',resolved.control,'연결선 굽힘점'):'')+(element.connector.route==='polyline'?(element.connector.waypoints||[]).map((p,index)=>button('connector-waypoint',p,`${index+1}번째 연결선 꺾임점 · Delete 삭제`,`data-waypoint-index="${index}" aria-pressed="${index===selectedWaypointIndex}"`)).join(''):'');
    }
    if(element.type!=='shape')return '';
    if(element.shape==='freeform')return mode==='points'?localPoints(element).map((p,index)=>button('point',elementWorldPoint(element,p),`${index+1}번째 자유형 점 · Delete 삭제`,`data-point-index="${index}" aria-pressed="${index===selectedPointIndex}"`)).join(''):'';
    const g=element.geometry,inset=Math.min((element.stroke?.width||0)/2,g.width/2-.000001,g.height/2-.000001),width=Math.max(.000002,g.width-inset*2),height=Math.max(.000002,g.height-inset*2);
    return shapeAdjustmentHandles(element.shape,width,height,element.adjustments||{}).map(handle=>button('adjustment',elementWorldPoint(element,{x:handle.x+inset,y:handle.y+inset}),'도형 조절점',`data-handle-id="${esc(handle.id)}"`)).join('');
  }
  function paint(){
    classes();let preview='',handles='';
    if(gesture?.preview){if(gesture.elementId){const source=stage.querySelector(`#slide-content [data-element-id="${CSS.escape(gesture.elementId)}"]`);if(source)source.style.visibility='hidden';}preview=gesture.preview.type==='connector'?connectorPreview(gesture.preview):shapePreview(gesture.preview);handles=selectionHandles(gesture.preview);}
    else if(connection)preview=connectorPreview(connection.preview);
    else if(polygon?.points.length){const points=[...polygon.points,...(hover?[hover]:[])],d=points.map((p,i)=>(i?'L':'M')+p.x+' '+p.y).join(' ');preview=`<svg class="dw-preview-svg" width="${store.document.canvas.width}" height="${store.document.canvas.height}" aria-hidden="true"><path d="${d}" fill="none" stroke="#3162dc" stroke-width="2" stroke-linejoin="round"/><circle cx="${points[0].x}" cy="${points[0].y}" r="${5/screenScale()}" fill="#fff" stroke="#3162dc" stroke-width="${1.5/screenScale()}"/></svg>`;}
    else if(!mode||mode==='points')handles=selectionHandles(current());
    const snapMarkup=snap?anchors.map(anchor=>{const p=anchorPoint(snap.element,anchor);return `<circle cx="${p.x}" cy="${p.y}" r="${3/screenScale()}"/>`;}).join('')+`<circle cx="${snap.point.x}" cy="${snap.point.y}" r="${5/screenScale()}"/>`:'';
    overlay.innerHTML=`<div id="dw-preview">${preview}</div><svg id="dw-snap-target" width="${store.document.canvas.width}" height="${store.document.canvas.height}" aria-hidden="true">${snapMarkup}</svg><div id="dw-handles">${handles}</div>`;
    for(const[id,value]of [['draw-freehand','freehand'],['draw-freeform','freeform'],['draw-connector','connector'],['draw-edit-points','points']])document.getElementById(id)?.setAttribute('aria-pressed',String(mode===value));
  }
  async function commit(commands,label,token=context(),after){
    restoreOriginal();release();gesture=null;polygon=null;connection=null;hover=null;snap=null;if(mode!=='points')mode=null;paint();
    await action(()=>{if(token!==context())throw new Error('그리는 동안 자료나 선택이 바뀌었습니다. 다시 시도하세요.');store.runBatch(commands,label);after?.();});
    stage.focus({preventScroll:true});
    if(mode==='points'&&selectedPointIndex!==null)overlay.querySelector(`[data-drawing-handle="point"][data-point-index="${selectedPointIndex}"]`)?.focus({preventScroll:true});
    if(selectedWaypointIndex!==null&&waypointElementId===current()?.id)overlay.querySelector(`[data-drawing-handle="connector-waypoint"][data-waypoint-index="${selectedWaypointIndex}"]`)?.focus({preventScroll:true});
  }
  function insert(element,label,token){return commit([{id:'elements.insert',params:{slideId:store.activeSlideId,elements:[element],assets:[]}}],label,token,()=>store.selectElements([element.id],{expandGroups:false}));}
  function makeFreeform(points,closed){const result=normalizeDrawnPath(points,closed),primary=store.document.theme?.colors.primary||'#2563eb';return{id:'element-'+crypto.randomUUID(),type:'shape',shape:'freeform',...result,fill:closed?'#dce7ff':'#00000000',stroke:{color:primary,width:3},text:emptyText(),name:closed?'자유형 도형':'자유 곡선'};}
  function finishPolygon(closed=false){if(!polygon)return;const needed=closed?3:2;if(polygon.points.length<needed){notice(`${needed}개 이상의 점을 추가하세요.`);return;}const element=makeFreeform(polygon.points,closed),token=polygon.token;insert(element,'자유형 그리기',token);}
  function startHandle(handle,event){
    if(composing())return;
    try{prepareGesture();}catch(error){notice(error.message,true);return;}
    const element=current();if(!element||element.locked||element.hidden)return;
    const p=point(event),kind=handle.dataset.drawingHandle;
    if(kind==='point')selectedPointIndex=Number(handle.dataset.pointIndex);
    if(kind==='connector-waypoint'){selectedWaypointIndex=Number(handle.dataset.waypointIndex);waypointElementId=element.id;}else selectedWaypointIndex=null;
    gesture={kind,pointerId:event.pointerId,elementId:element.id,base:clone(element),preview:clone(element),token:context(),start:p,handleId:handle.dataset.handleId,index:Number(kind==='connector-waypoint'?handle.dataset.waypointIndex:handle.dataset.pointIndex)};
    stage.setPointerCapture(event.pointerId);paint();
  }
  function updateGesture(p,event={}){
    if(!gesture)return;
    if(gesture.kind==='freehand'){
      if(distance(gesture.points.at(-1),p)>1/screenScale())gesture.points.push(p);
      if(gesture.points.length>4096)gesture.points=simplifyDrawnPoints(gesture.points,1/screenScale(),2048);
      if(gesture.points.length>1)gesture.preview=makeFreeform(simplifyDrawnPoints(gesture.points,1/screenScale()),false);
    }else if(gesture.kind==='connector-new'){const origin=resolveConnectorGeometry(gesture.preview,store.activeSlide).from;gesture.preview.connector.to=endpointAt(p,event,origin);}
    else if(gesture.kind==='connector-from'||gesture.kind==='connector-to'){const resolved=resolveConnectorGeometry(gesture.base,store.activeSlide),key=gesture.kind==='connector-from'?'from':'to',origin=key==='from'?resolved.to:resolved.from;gesture.preview.connector[key]=endpointAt(p,event,origin);}
    else if(gesture.kind==='connector-control')gesture.preview.connector.control={x:p.x,y:p.y};
    else if(gesture.kind==='connector-waypoint')gesture.preview.connector.waypoints[gesture.index]={x:p.x,y:p.y};
    else if(gesture.kind==='connector-body'){const delta={x:p.x-gesture.start.x,y:p.y-gesture.start.y},next=event.shiftKey?constrainPoint45({x:0,y:0},delta):delta;gesture.preview.connector=translatedConnector(gesture.base.connector,resolveConnectorGeometry(gesture.base,store.activeSlide),next.x,next.y);}
    else if(gesture.kind==='point'){
      const points=localPoints(gesture.base);points[gesture.index]=elementLocalPoint(gesture.base,p);Object.assign(gesture.preview,reboxFreeform(gesture.base,points));
    }else if(gesture.kind==='adjustment'){
      const element=gesture.base,g=element.geometry,inset=Math.min((element.stroke?.width||0)/2,g.width/2-.000001,g.height/2-.000001),local=elementLocalPoint(element,p);
      gesture.preview.adjustments=solveShapeHandle(element.shape,Math.max(.000002,g.width-inset*2),Math.max(.000002,g.height-inset*2),element.adjustments||{},gesture.handleId,{x:local.x-inset,y:local.y-inset});
    }
    paint();
  }
  function focusWaypoint(){if(selectedWaypointIndex!==null)overlay.querySelector(`[data-drawing-handle="connector-waypoint"][data-waypoint-index="${selectedWaypointIndex}"]`)?.focus({preventScroll:true});}
  function startConnectorBody(element,event){
    try{prepareGesture();}catch(error){notice(error.message,true);return;}
    const same=current()?.id===element.id;
    if(event.shiftKey&&!same){store.toggleSelection(element.id);render();return;}
    if(!same){store.selectElements([element.id],{expandGroups:false});render();}
    const selected=current();if(!selected||selected.id!==element.id)return;
    const p=point(event),last=lastConnectorClick;selectedWaypointIndex=null;waypointElementId=element.id;
    const doubleClickCandidate=Boolean(last&&last.id===element.id&&last.token===context()&&event.timeStamp-last.time<450&&distance(last.p,p)<7/screenScale());
    gesture={kind:'connector-body',pointerId:event.pointerId,elementId:element.id,base:clone(selected),preview:clone(selected),start:p,token:context(),doubleClickCandidate};
    stage.setPointerCapture(event.pointerId);stage.focus({preventScroll:true});paint();
  }
  function pointerDown(event){
    if(event.button!==0||blocked()||composing()||document.querySelector('dialog[open]')||editable(event.target)||document.getElementById('presentation').hidden===false)return;
    const handle=event.target.closest('[data-drawing-handle]');if(handle){consume(event);startHandle(handle,event);return;}
    if(!stage.contains(event.target)){if(mode&&!event.target.closest('#draw-connector-route'))cancel(true);return;}
    if(mode==='points'){
      const selected=current(),node=event.target.closest('.slide-element[data-element-id]');if(!selected||node?.dataset.elementId!==selected.id){cancel(true);return;}
      consume(event);const p=point(event),last=lastPointClick;lastPointClick={p,time:event.timeStamp};selectedPointIndex=null;
      if(last&&event.timeStamp-last.time<400&&distance(last.p,p)<7/screenScale()){
        const local=elementLocalPoint(selected,p),points=localPoints(selected),nearest=nearestPathSegment(points,local,selected.path.closed);
        if(nearest&&nearest.distance<=10/screenScale()&&points.length<512){points.splice(nearest.index+1,0,nearest.point);selectedPointIndex=nearest.index+1;const result=reboxFreeform(selected,points);commit([{id:'element.set_geometry',params:{elementId:selected.id,geometry:result.geometry}},{id:'shape.set_path',params:{elementId:selected.id,path:result.path}}],'자유형 점 추가');}
      }return;
    }
    if(!mode){const node=event.target.closest('.element-connector[data-element-id]'),element=node&&store.activeSlide.elements.find(e=>e.id===node.dataset.elementId);if(element&&!element.locked&&!element.hidden){consume(event);startConnectorBody(element,event);}return;}
    consume(event);
    if(!polygon&&!connection)try{prepareGesture();}catch(error){cancel(true);notice(error.message,true);return;}
    const p=point(event);
    if(mode==='freeform'){
      if(!polygon)polygon={points:[],token:context()};
      const points=polygon.points,last=points.at(-1);
      if(points.length>=3&&distance(points[0],p)<9/screenScale()){finishPolygon(true);return;}
      if(last&&lastPointClick&&event.timeStamp-lastPointClick.time<400&&distance(last,p)<7/screenScale()){finishPolygon(false);return;}
      if(points.length>=512){notice('최대 512개 점을 사용할 수 있습니다. Enter로 완료하세요.');return;}
      const next=event.shiftKey&&last?constrainedPoint(last,p):p;points.push(next);lastPointClick={p:next,time:event.timeStamp};hover=null;paint();return;
    }
    if(mode==='freehand')gesture={kind:'freehand',points:[p],start:p,pointerId:event.pointerId,token:context()};
    else if(mode==='connector'){
      if(connection){gesture={kind:'connector-new',start:p,pointerId:event.pointerId,token:connection.token,preview:clone(connection.preview),fromClick:true};connection=null;updateGesture(p,event);}
      else{const from=snapEndpoint(p,event);gesture={kind:'connector-new',start:p,pointerId:event.pointerId,token:context(),preview:{id:'element-'+crypto.randomUUID(),type:'connector',geometry:{x:p.x,y:p.y,width:1,height:1},name:'연결선',connector:{from,to:clone(from),route:route(),stroke:{color:store.document.theme?.colors.primary||'#3564dd',width:3},arrow:'end'}}};}
    }
    stage.setPointerCapture(event.pointerId);paint();
  }
  const constrainedPoint=constrainPoint45;
  function pointerMove(event){
    if(gesture){consume(event);try{updateGesture(point(event),event);}catch(error){cancel(true);notice(error.message,true);}return;}
    if(mode==='freeform'&&polygon&&stage.contains(event.target)){consume(event);const p=point(event);hover=event.shiftKey?constrainedPoint(polygon.points.at(-1),p):p;paint();}
    else if(mode==='connector'&&stage.contains(event.target)){if(connection){const from=resolveConnectorGeometry(connection.preview,store.activeSlide).from;connection.preview.connector.to=endpointAt(point(event),event,from);}else snapEndpoint(point(event),event);paint();}
  }
  function pointerUp(event){
    if(!gesture||gesture.pointerId!==event.pointerId)return;consume(event);
    if(!['freehand','connector-new'].includes(gesture.kind)&&distance(gesture.start,point(event))<(gesture.kind==='connector-body'?3:.5)/screenScale()){
      const captured=gesture;restoreOriginal();release();gesture=null;snap=null;
      if(captured.kind==='connector-body'&&captured.doubleClickCandidate){
        lastConnectorClick=null;suppressDoubleClickUntil=event.timeStamp+700;
        try{const element=current(),inserted=insertConnectorWaypoint(element.connector,resolveConnectorGeometry(element,store.activeSlide),point(event));selectedWaypointIndex=inserted.index;commit([{id:'connector.set_data',params:{elementId:element.id,connector:inserted.connector}}],'연결선 꺾임점 추가',captured.token);}catch(error){notice(error.message,true);paint();}return;
      }
      if(captured.kind==='connector-body')lastConnectorClick={id:captured.elementId,p:point(event),time:event.timeStamp,token:captured.token};
      paint();if(mode==='points'&&selectedPointIndex!==null)overlay.querySelector(`[data-point-index="${selectedPointIndex}"]`)?.focus({preventScroll:true});focusWaypoint();return;
    }
    try{updateGesture(point(event),event);}catch(error){cancel(true);notice(error.message,true);return;}const captured=gesture,element=captured.preview;
    if(captured.kind==='freehand'){
      const points=simplifyDrawnPoints(captured.points,1.5/screenScale(),512);if(points.length<2||distance(captured.start,point(event))<2/screenScale()&&points.length<3){cancel(true);return;}insert(makeFreeform(points,false),'자유 곡선 그리기',captured.token);
    }else if(captured.kind==='connector-new'){
      const resolved=resolveConnectorGeometry(element,store.activeSlide);if((!captured.fromClick&&distance(captured.start,point(event))<3/screenScale())||distance(resolved.from,resolved.to)<3/screenScale()){release();connection={preview:clone(element),token:captured.token};gesture=null;snap=null;paint();notice('끝점을 클릭하세요. Alt는 자유점, Shift는 45° 맞춤, Esc는 취소입니다.');return;}lastConnectorClick=null;insert(element,'연결선 그리기',captured.token);
    }else if(captured.kind.startsWith('connector-'))commit([{id:'connector.set_data',params:{elementId:element.id,connector:element.connector}}],'연결선 조절',captured.token);
    else if(captured.kind==='adjustment')commit([{id:'shape.set_adjustments',params:{elementId:element.id,adjustments:element.adjustments||{}}}],'도형 조절점',captured.token);
    else if(captured.kind==='point')commit([{id:'element.set_geometry',params:{elementId:element.id,geometry:element.geometry}},{id:'shape.set_path',params:{elementId:element.id,path:element.path}}],'자유형 점 이동',captured.token);
  }
  function keyDown(event){
    if(blocked()||editable(event.target)||event.isComposing||store.textSession?.composing||document.getElementById('presentation').hidden===false)return;
    const handle=event.target.closest('[data-drawing-handle]')||(mode==='points'&&selectedPointIndex!==null?overlay.querySelector(`[data-drawing-handle="point"][data-point-index="${selectedPointIndex}"]`):selectedWaypointIndex!==null&&waypointElementId===current()?.id?overlay.querySelector(`[data-drawing-handle="connector-waypoint"][data-waypoint-index="${selectedWaypointIndex}"]`):null);
    if(event.key==='Escape'&&(mode||gesture||connection)){consume(event);cancel(true);stage.focus({preventScroll:true});return;}
    if(event.key==='Escape'&&selectedWaypointIndex!==null){consume(event);selectedWaypointIndex=null;paint();stage.focus({preventScroll:true});return;}
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'&&(gesture||polygon||connection)){consume(event);if(polygon){polygon.points.pop();if(!polygon.points.length)polygon=null;paint();}else cancel(true);return;}
    if((gesture||connection||polygon)&&(event.ctrlKey||event.metaKey)&&['s','o','n','y'].includes(event.key.toLowerCase())){consume(event);notice('그리기를 마치거나 Esc로 취소한 뒤 실행하세요.');return;}
    if(connection&&event.key==='Enter'){consume(event);const resolved=resolveConnectorGeometry(connection.preview,store.activeSlide);if(distance(resolved.from,resolved.to)>=3/screenScale())insert(connection.preview,'연결선 그리기',connection.token);return;}
    if(mode==='connector'&&['Delete','Backspace','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){consume(event);return;}
    if(mode==='freeform'&&polygon&&event.key==='Enter'){consume(event);finishPolygon(event.ctrlKey||event.metaKey);return;}
    if(mode==='points'&&!handle&&['Delete','Backspace','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){consume(event);notice('편집할 점을 먼저 선택하세요.');return;}
    if(handle?.dataset.drawingHandle==='point'){
      const element=current(),index=Number(handle.dataset.pointIndex);if(!element?.path)return;const points=localPoints(element),minimum=element.path.closed?3:2;
      if(event.key==='Delete'||event.key==='Backspace'){consume(event);if(points.length<=minimum){notice(`이 도형은 최소 ${minimum}개의 점이 필요합니다.`);return;}points.splice(index,1);selectedPointIndex=Math.min(index,points.length-1);}
      else{const direction={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];if(!direction)return;consume(event);const step=event.shiftKey?10:1;points[index].x+=direction[0]*step;points[index].y+=direction[1]*step;}
      const result=reboxFreeform(element,points);commit([{id:'element.set_geometry',params:{elementId:element.id,geometry:result.geometry}},{id:'shape.set_path',params:{elementId:element.id,path:result.path}}],'자유형 점 편집').then(()=>{if(mode==='points')overlay.querySelector(`[data-drawing-handle="point"][data-point-index="${Math.min(index,points.length-1)}"]`)?.focus({preventScroll:true});});
      return;
    }
    const element=current(),direction={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];
    if(!stage.contains(event.target)&&event.target!==document.body)return;
    if(element?.type!=='connector'||element.locked||element.hidden)return;
    if(handle?.dataset.drawingHandle==='connector-waypoint'){
      const index=Number(handle.dataset.waypointIndex),connector=clone(element.connector),points=connector.waypoints;if(!points?.[index])return;
      if(event.key==='Delete'||event.key==='Backspace'){consume(event);points.splice(index,1);selectedWaypointIndex=points.length?Math.min(index,points.length-1):null;}
      else if(direction){consume(event);const step=event.shiftKey?10:1;points[index].x+=direction[0]*step;points[index].y+=direction[1]*step;}else return;
      commit([{id:'connector.set_data',params:{elementId:element.id,connector}}],'연결선 꺾임점 편집');return;
    }
    if(direction){
      consume(event);const amount=event.shiftKey?10:1,kind=handle?.dataset.drawingHandle;
      if(kind==='connector-from'||kind==='connector-to'||kind==='connector-control'){
        const resolved=resolveConnectorGeometry(element,store.activeSlide),connector=clone(element.connector),key=kind==='connector-from'?'from':kind==='connector-to'?'to':'control',p=key==='control'?resolved.control:resolved[key],next={x:p.x+direction[0]*amount,y:p.y+direction[1]*amount};connector[key]=key==='control'?next:{point:next};commit([{id:'connector.set_data',params:{elementId:element.id,connector}}],'연결선 점 이동');
      }else nudge(direction[0]*amount,direction[1]*amount);
    }
  }
  async function nudge(dx,dy){
    if(blocked()||composing()||!Number.isFinite(dx)||!Number.isFinite(dy)||dx===0&&dy===0)return false;
    try{prepareGesture();}catch(error){notice(error.message,true);return false;}
    const element=current();if(element?.type!=='connector'||element.locked||element.hidden)return false;selectedWaypointIndex=null;
    const connector=translatedConnector(element.connector,resolveConnectorGeometry(element,store.activeSlide),dx,dy);await commit([{id:'connector.set_data',params:{elementId:element.id,connector}}],'연결선 이동');return true;
  }
  document.addEventListener('pointerdown',pointerDown,true);document.addEventListener('pointermove',pointerMove,true);document.addEventListener('pointerup',pointerUp,true);
  document.addEventListener('pointercancel',()=>{if(gesture)cancel(true);},true);document.addEventListener('keydown',keyDown,true);
  document.addEventListener('dblclick',event=>{if(stage.contains(event.target)&&(mode||connection||event.timeStamp<suppressDoubleClickUntil&&event.target.closest('.element-connector')))consume(event);},true);
  window.addEventListener('blur',()=>{if(gesture||polygon||connection)cancel(true);});
  function sync(){
    if(session!==store.sessionId||slide!==store.activeSlideId){cancel(true);session=store.sessionId;slide=store.activeSlideId;}
    else if(gesture&&gesture.token!==context()||polygon&&polygon.token!==context()||connection&&connection.token!==context())cancel(true);
    else if(mode==='points'&&current()?.shape!=='freeform')cancel(true);
    if(waypointElementId!==current()?.id){selectedWaypointIndex=null;waypointElementId=null;}else if(selectedWaypointIndex!==null&&selectedWaypointIndex>=(current()?.connector?.waypoints?.length||0))selectedWaypointIndex=null;
    paint();
  }
  paint();return{arm,cancel,sync,nudge,get active(){return mode;},get busy(){return Boolean(mode||gesture||polygon||connection);},get pendingChanges(){return Boolean(gesture||polygon||connection);},get dragging(){return Boolean(gesture);},get preview(){return gesture?.preview?clone(gesture.preview):connection?.preview?clone(connection.preview):null;}};
}
