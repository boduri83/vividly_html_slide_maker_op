/** Pointer geometry shared by the drawing surface; all coordinates remain document-local. */
export const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const clean=value=>Number(value.toFixed(6));
export function simplifyDrawnPoints(points,tolerance=1.5,maxPoints=512){
  if(points.length<3)return points.map(point=>({...point}));
  const distanceToSegment=(p,a,b)=>{const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy,t=length?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/length)):0;return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);};
  const keep=new Set([0,points.length-1]),queue=[[0,points.length-1]];
  while(queue.length){const[start,end]=queue.pop();let furthest=-1,extent=tolerance;for(let i=start+1;i<end;i++){const d=distanceToSegment(points[i],points[start],points[end]);if(d>extent){extent=d;furthest=i;}}if(furthest>=0){keep.add(furthest);queue.push([start,furthest],[furthest,end]);}}
  let result=[...keep].sort((a,b)=>a-b).map(index=>({...points[index]}));
  if(result.length>maxPoints)result=Array.from({length:maxPoints},(_,i)=>result[Math.round(i*(result.length-1)/(maxPoints-1))]);
  return result;
}
export function normalizeDrawnPath(points,closed=false){
  if(points.length<2)throw new Error('두 개 이상의 점이 필요합니다.');
  const minX=Math.min(...points.map(p=>p.x)),minY=Math.min(...points.map(p=>p.y));
  const width=Math.max(1,Math.max(...points.map(p=>p.x))-minX),height=Math.max(1,Math.max(...points.map(p=>p.y))-minY);
  return {geometry:{x:clean(minX),y:clean(minY),width:clean(width),height:clean(height)},path:{closed,points:points.map(point=>({x:clean((point.x-minX)/width),y:clean((point.y-minY)/height)}))}};
}
export function elementLocalPoint(element,point){
  const g=element.geometry,angle=-(element.rotation||0)*Math.PI/180,cx=g.x+g.width/2,cy=g.y+g.height/2,dx=point.x-cx,dy=point.y-cy;
  return {x:g.width/2+dx*Math.cos(angle)-dy*Math.sin(angle),y:g.height/2+dx*Math.sin(angle)+dy*Math.cos(angle)};
}
export function elementWorldPoint(element,point){
  const g=element.geometry,angle=(element.rotation||0)*Math.PI/180,dx=point.x-g.width/2,dy=point.y-g.height/2;
  return {x:g.x+g.width/2+dx*Math.cos(angle)-dy*Math.sin(angle),y:g.y+g.height/2+dx*Math.sin(angle)+dy*Math.cos(angle)};
}
export function reboxFreeform(element,points){
  const g=element.geometry,local=normalizeDrawnPath(points,element.path.closed),center={x:local.geometry.x+local.geometry.width/2,y:local.geometry.y+local.geometry.height/2},world=elementWorldPoint(element,center);
  return {geometry:{x:clean(world.x-local.geometry.width/2),y:clean(world.y-local.geometry.height/2),width:local.geometry.width,height:local.geometry.height},path:local.path};
}
export function nearestPathSegment(points,point,closed){
  let nearest=null;
  for(let i=0;i<points.length-(closed?0:1);i++){const a=points[i],b=points[(i+1)%points.length],dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy,t=length?Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/length)):0,projected={x:a.x+dx*t,y:a.y+dy*t},d=distance(point,projected);if(!nearest||d<nearest.distance)nearest={index:i,point:projected,distance:d};}
  return nearest;
}

/** Continuous local edge attachment, transformed back to the rotated element's document space. */
export function nearestConnectorPort(element,point,outline){
  const g=element.geometry,q=elementLocalPoint(element,point),clamp=(v,max)=>Math.max(0,Math.min(max,v));
  const inside=q.x>=0&&q.y>=0&&q.x<=g.width&&q.y<=g.height;
  let local;
  if(outline?.length>1)local=nearestPathSegment(outline,q,false)?.point;
  else if(element.type==='shape'&&element.shape==='freeform')local=nearestPathSegment(element.path.points.map(p=>({x:p.x*g.width,y:p.y*g.height})),q,element.path.closed)?.point;
  else if(element.type==='shape'&&element.shape==='ellipse'){
    const at=t=>({x:g.width/2+g.width/2*Math.cos(t),y:g.height/2+g.height/2*Math.sin(t)}),step=Math.PI/16;
    let best=0,d=Infinity;for(let i=0;i<32;i++){const next=distance(q,at(i*step));if(next<d){d=next;best=i*step;}}
    let lo=best-step,hi=best+step;for(let i=0;i<28;i++){const a=lo+(hi-lo)/3,b=hi-(hi-lo)/3;if(distance(q,at(a))<distance(q,at(b)))hi=b;else lo=a;}
    local=at((lo+hi)/2);
  }else{
    const candidates=[{x:clamp(q.x,g.width),y:0},{x:g.width,y:clamp(q.y,g.height)},{x:clamp(q.x,g.width),y:g.height},{x:0,y:clamp(q.y,g.height)}];
    local=candidates.reduce((best,next)=>distance(q,next)<distance(q,best)?next:best);
  }
  local||={x:clamp(q.x,g.width),y:clamp(q.y,g.height)};
  const position={x:clean(clamp(local.x,g.width)/g.width),y:clean(clamp(local.y,g.height)/g.height)},world=elementWorldPoint(element,{x:position.x*g.width,y:position.y*g.height});
  return {position,point:world,distance:distance(point,world),inside};
}

export function constrainPoint45(origin,point){const angle=Math.round(Math.atan2(point.y-origin.y,point.x-origin.x)/(Math.PI/4))*Math.PI/4,length=distance(origin,point);return{x:origin.x+Math.cos(angle)*length,y:origin.y+Math.sin(angle)*length};}

/** Moving a complete line explicitly detaches both ends while retaining the same visible route. */
export function translatedConnector(connector,resolved,dx,dy){
  if(!Number.isFinite(dx)||!Number.isFinite(dy))throw new Error('유효한 연결선 이동량이 필요합니다.');
  const offset=p=>({x:clean(p.x+dx),y:clean(p.y+dy)}),next=structuredClone(connector);
  next.from={point:offset(resolved.from)};next.to={point:offset(resolved.to)};
  if(connector.control||['elbow','curve'].includes(connector.route))next.control=offset(connector.control||resolved.control);
  if(connector.waypoints)next.waypoints=connector.waypoints.map(offset);
  return next;
}

/** Convert an authored route to a finite editable polygon without mutating its endpoints. */
export function connectorPolylinePoints(connector,resolved){
  let points;
  if(connector.route==='curve')points=Array.from({length:17},(_,i)=>{const t=i/16,u=1-t;return{x:u*u*resolved.from.x+2*u*t*resolved.control.x+t*t*resolved.to.x,y:u*u*resolved.from.y+2*u*t*resolved.control.y+t*t*resolved.to.y};});
  else points=resolved.points;
  return points.filter((p,i)=>!i||distance(p,points[i-1])>1e-7).map(p=>({...p}));
}
export function insertConnectorWaypoint(connector,resolved,point){
  const points=connectorPolylinePoints(connector,resolved);if(points.length-2>=32)throw new Error('연결선은 최대 32개의 꺾임점을 사용할 수 있습니다.');
  const nearest=nearestPathSegment(points,point,false);if(!nearest)throw new Error('점을 추가할 연결선 구간을 찾을 수 없습니다.');
  const matching=points.findIndex((p,i)=>i>0&&i<points.length-1&&distance(p,nearest.point)<1e-6);if(matching<0)points.splice(nearest.index+1,0,nearest.point);
  const next=structuredClone(connector);next.route='polyline';next.waypoints=points.slice(1,-1).map(p=>({x:clean(p.x),y:clean(p.y)}));delete next.control;
  return {connector:next,index:matching<0?nearest.index:matching-1,point:nearest.point};
}
