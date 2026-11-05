// SPDX-License-Identifier: MPL-2.0
// Original bounded interpreter for the bundled, trusted DrawingML preset dataset.
export const SHAPE_KINDS = Object.freeze(SHAPE_DEFINITIONS.map(shape=>shape.id));
export const SHAPE_ADJUSTMENT_NAMES = Object.freeze([...new Set(Object.values(PRESETS).flatMap(preset=>preset.adjustments||[]))].sort());
const shapeById = new Map(SHAPE_DEFINITIONS.map(shape=>[shape.id,shape]));
const geometryCache = new Map();
const geometryFits = new WeakMap();
const angleUnit = Math.PI / 10800000;
const numeric = /^-?\d+(?:\.\d+)?$/;
const finite = value=>{if(!Number.isFinite(value))throw new Error('도형 좌표를 계산하지 못했습니다.');return value;};
const clean = value=>{const rounded=Math.round(finite(value)*100000)/100000;return Object.is(rounded,-0)?0:rounded;};

export function getShapeDefinition(kind) {
  const definition=shapeById.get(kind);
  if(!definition)throw new Error('지원하지 않는 도형입니다.');
  return definition;
}

function guideValues(preset,width,height,adjustments={}) {
  const ss=Math.min(width,height),g=Object.assign(Object.create(null),{w:width,h:height,l:0,t:0,r:width,b:height,hc:width/2,vc:height/2,ss,cd2:10800000,cd4:5400000,'3cd4':16200000});
  for(const divisor of [2,3,4,5,6,8,12,16,32]){g['wd'+divisor]=width/divisor;g['hd'+divisor]=height/divisor;g['ssd'+divisor]=ss/divisor;}
  const value=token=>numeric.test(token)?Number(token):Object.hasOwn(g,token)?g[token]:(()=>{throw new Error('지원하지 않는 도형 좌표 참조입니다.');})();
  for(const [name,[operation,...tokens]]of preset.guides){
    const [x=0,y=0,z=0]=tokens.map(value);let result;
    switch(operation){
      case 'val':result=x;break;
      case '*/':result=z===0?0:x*y/z;break;
      case '+-':result=x+y-z;break;
      case '+/':result=z===0?0:(x+y)/z;break;
      case '?:':result=x>0?y:z;break;
      case 'abs':result=Math.abs(x);break;
      case 'at2':result=Math.atan2(y,x)/angleUnit;break;
      case 'cat2':result=x*Math.cos(Math.atan2(z,y));break;
      case 'sat2':result=x*Math.sin(Math.atan2(z,y));break;
      case 'cos':result=x*Math.cos(y*angleUnit);break;
      case 'sin':result=x*Math.sin(y*angleUnit);break;
      case 'tan':result=x*Math.tan(y*angleUnit);break;
      case 'max':result=Math.max(x,y);break;
      case 'min':result=Math.min(x,y);break;
      case 'mod':result=Math.hypot(x,y,z);break;
      case 'pin':result=Math.min(Math.max(y,x),z);break;
      case 'sqrt':result=Math.sqrt(Math.max(0,x));break;
      default:throw new Error('지원하지 않는 도형 계산식입니다.');
    }
    g[name]=finite((preset.adjustments||[]).includes(name)&&Object.hasOwn(adjustments,name)?adjustments[name]:result);
  }
  return value;
}

const handleAxes=[['gdRefX','minX','maxX','x'],['gdRefY','minY','maxY','y'],['gdRefR','minR','maxR','radius'],['gdRefAng','minAng','maxAng','angle']];
function adjustmentBounds(preset,value) {
  const bounds={};
  for(const handle of preset.handles||[])for(const [ref,min,max,axis]of handleAxes)if(handle[ref]){
    const name=handle[ref],low=handle[min]===undefined?-2147483647:finite(value(handle[min])),high=handle[max]===undefined?2147483647:finite(value(handle[max]));
    const prior=bounds[name];bounds[name]={min:Math.max(prior?.min??-1000000000,Math.min(low,high),-1000000000),max:Math.min(prior?.max??1000000000,Math.max(low,high),1000000000),axis};
  }
  return bounds;
}

/** Document values are names from avLst only, never executable guide expressions. */
export function normalizeShapeAdjustments(kind,input={},width=100,height=100) {
  getShapeDefinition(kind);
  if(!input||typeof input!=='object'||Array.isArray(input)||![Object.prototype,null].includes(Object.getPrototypeOf(input)))throw new Error('도형 조절값 객체가 필요합니다.');
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw new Error('도형의 양수 너비와 높이가 필요합니다.');
  const preset=PRESETS[kind],names=preset.adjustments||[],result={};
  for(const key of Object.keys(input)){
    if(!names.includes(key))throw new Error('지원하지 않는 도형 조절값입니다.');
    if(typeof input[key]!=='number'||!Number.isFinite(input[key])||Math.abs(input[key])>1000000000)throw new Error('도형 조절값은 유효한 유한 숫자여야 합니다.');
  }
  for(const name of names)if(Object.hasOwn(input,name))result[name]=input[name];
  // Limits such as an arrow head length can depend on another adjustment or aspect ratio.
  for(let pass=0;pass<3;pass++){
    const limits=adjustmentBounds(preset,guideValues(preset,width,height,result));let changed=false;
    for(const name of Object.keys(result)){const bound=limits[name];if(!bound)continue;const value=Math.max(bound.min,Math.min(bound.max,result[name]));if(value!==result[name]){result[name]=value;changed=true;}}
    if(!changed)break;
  }
  return result;
}

// DrawingML angles are rays through an ellipse, rather than SVG's ellipse parameter angle.
// See ISO/IEC 29500-1 arcTo and LibreOffice EnhancedCustomShape2d.cxx ARCANGLETO.
function ellipseVector(rx,ry,angle) {
  if(rx===0||ry===0)return[rx*Math.cos(angle),ry*Math.sin(angle)];
  const parameter=Math.atan2(rx*Math.sin(angle),ry*Math.cos(angle));
  return[rx*Math.cos(parameter),ry*Math.sin(parameter)];
}

/** Geometry is evaluated only from bundled data. Returned SVG path tokens contain finite numbers. */
export function shapeGeometry(kind,width=100,height=100,adjustments={}) {
  getShapeDefinition(kind);
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw new Error('도형의 양수 너비와 높이가 필요합니다.');
  const normalized=normalizeShapeAdjustments(kind,adjustments,width,height);
  const key=kind+':'+width+':'+height+':'+JSON.stringify(normalized);
  if(geometryCache.has(key))return geometryCache.get(key);
  const preset=PRESETS[kind],value=guideValues(preset,width,height,normalized),paths=[];
  const bounds={minX:0,minY:0,maxX:width,maxY:height};
  const point=(x,y)=>{finite(x);finite(y);bounds.minX=Math.min(bounds.minX,x);bounds.minY=Math.min(bounds.minY,y);bounds.maxX=Math.max(bounds.maxX,x);bounds.maxY=Math.max(bounds.maxY,y);return[x,y];};
  for(const source of preset.paths){
    if(source.fill==='none'&&source.stroke==='false')continue;
    const sx=source.w?width/Number(source.w):1,sy=source.h?height/Number(source.h):1,commands=[];
    let current=[0,0],start=[0,0];
    for(const [operation,...tokens]of source.commands){
      if(operation==='Z'){commands.push(['Z']);current=[...start];continue;}
      const numbers=tokens.map(value);
      if(operation==='M'||operation==='L'||operation==='Q'||operation==='C'){
        const scaled=[];
        for(let i=0;i<numbers.length;i+=2)scaled.push(finite(numbers[i]*sx),finite(numbers[i+1]*sy));
        point(...scaled.slice(-2));
        if(operation==='Q'||operation==='C'){
          const points=[current];for(let i=0;i<scaled.length;i+=2)points.push(scaled.slice(i,i+2));
          const evaluate=t=>points[0].map((_,axis)=>points.length===3?(1-t)**2*points[0][axis]+2*(1-t)*t*points[1][axis]+t*t*points[2][axis]:(1-t)**3*points[0][axis]+3*(1-t)**2*t*points[1][axis]+3*(1-t)*t*t*points[2][axis]+t**3*points[3][axis]);
          for(const axis of [0,1]){
            const [p0,p1,p2,p3]=points.map(p=>p[axis]);let candidates=[];
            if(points.length===3){const divisor=p0-2*p1+p2;if(Math.abs(divisor)>1e-12)candidates=[(p0-p1)/divisor];}
            else{
              const a=-p0+3*p1-3*p2+p3,b=2*(p0-2*p1+p2),c=p1-p0;
              if(Math.abs(a)<1e-12){if(Math.abs(b)>1e-12)candidates=[-c/b];}
              else{const delta=b*b-4*a*c;if(delta>=0)candidates=[(-b+Math.sqrt(delta))/(2*a),(-b-Math.sqrt(delta))/(2*a)];}
            }
            for(const t of candidates)if(t>0&&t<1)point(...evaluate(t));
          }
        }
        commands.push([operation,...scaled]);current=scaled.slice(-2);if(operation==='M')start=[...current];continue;
      }
      if(operation!=='A')throw new Error('지원하지 않는 도형 경로입니다.');
      const rx=Math.abs(numbers[0]*sx),ry=Math.abs(numbers[1]*sy),a=numbers[2]*angleUnit,sweep=Math.max(-2*Math.PI,Math.min(2*Math.PI,numbers[3]*angleUnit));
      const offset=ellipseVector(rx,ry,a),center=[current[0]-offset[0],current[1]-offset[1]];
      // Split full turns and large sweeps so SVG never drops a full-circle arc.
      const count=Math.max(1,Math.ceil(Math.abs(sweep)/(Math.PI/2)));
      for(let index=1;index<=count;index++){
        const vector=ellipseVector(rx,ry,a+sweep*index/count),end=point(center[0]+vector[0],center[1]+vector[1]);
        commands.push(rx===0||ry===0?['L',...end]:['A',rx,ry,0,0,sweep>=0?1:0,...end]);current=end;
      }
      // Cardinal rays give exact arc extrema; include only those crossed by this arc.
      const low=Math.min(a,a+sweep),high=Math.max(a,a+sweep);
      for(let step=Math.ceil(low/(Math.PI/2));step<=Math.floor(high/(Math.PI/2));step++){
        const v=ellipseVector(rx,ry,step*Math.PI/2);point(center[0]+v[0],center[1]+v[1]);
      }
    }
    if(commands.length)paths.push({commands,...(source.fill==='none'?{fill:false}:source.fill&&source.fill!=='norm'?{fillMode:source.fill}:{}),...(source.stroke==='false'?{stroke:false}:{})});
  }
  // Some standard callout tails extend outside the nominal box. Fit that authored preset as a
  // whole, retaining its text rectangle, instead of clipping the tail or changing selection bounds.
  // Preserve old default framing. Once adjusted, keep that framing fixed so a callout
  // tail can follow the pointer outside the box rather than shrinking its text body.
  const reference=Object.keys(normalized).length?geometryFits.get(shapeGeometry(kind,width,height,{})):{minX:bounds.minX,minY:bounds.minY,fitX:width/(bounds.maxX-bounds.minX),fitY:height/(bounds.maxY-bounds.minY)};
  const {minX,minY,fitX,fitY}=reference;
  const x=v=>clean((v-minX)*fitX),y=v=>clean((v-minY)*fitY);
  const compiled=paths.map(({commands,...paint})=>Object.freeze({...paint,d:commands.map(([op,...v])=>{
    if(op==='Z')return'Z';
    if(op==='A')return'A'+[clean(v[0]*fitX),clean(v[1]*fitY),0,v[3],v[4],x(v[5]),y(v[6])].join(' ');
    return op+v.map((number,index)=>index%2?y(number):x(number)).join(' ');
  }).join(' ')}));
  const rect=preset.rect?preset.rect.map(value):[0,0,width,height];
  const left=Math.max(0,Math.min(width,x(rect[0]))),top=Math.max(0,Math.min(height,y(rect[1]))),right=Math.max(left,Math.min(width,x(rect[2]))),bottom=Math.max(top,Math.min(height,y(rect[3])));
  const result=Object.freeze({paths:Object.freeze(compiled),textRect:Object.freeze({x:left,y:top,width:clean(right-left),height:clean(bottom-top)})});
  geometryFits.set(result,{minX,minY,fitX,fitY});
  if(!compiled.length)throw new Error('도형 경로가 비어 있습니다.');
  geometryCache.set(key,result);if(geometryCache.size>256)geometryCache.delete(geometryCache.keys().next().value);
  return result;
}

/** Actual DrawingML XY/polar handle locations, in the same fitted local coordinates as paths. */
export function shapeAdjustmentHandles(kind,width=100,height=100,adjustments={}) {
  if(!shapeById.has(kind))return[];
  const preset=PRESETS[kind],normalized=normalizeShapeAdjustments(kind,adjustments,width,height),geometry=shapeGeometry(kind,width,height,normalized),fit=geometryFits.get(geometry),value=guideValues(preset,width,height,normalized),allBounds=adjustmentBounds(preset,value);
  return (preset.handles||[]).map(handle=>{
    const refs=[...new Set(handleAxes.map(([ref])=>handle[ref]).filter(Boolean))];
    const bounds=Object.fromEntries(refs.map(ref=>[ref,Object.freeze({...allBounds[ref],value:value(ref)})]));
    return Object.freeze({id:handle.id,type:handle.type,x:clean((value(handle.pos[0])-fit.minX)*fit.fitX),y:clean((value(handle.pos[1])-fit.minY)*fit.fitY),refs:Object.freeze(refs),bounds:Object.freeze(bounds)});
  });
}

/** Invert trusted handle formulas numerically; proposals stay within their actual guide limits. */
export function solveShapeHandle(kind,width,height,adjustments={},handleId,point) {
  if(!point||!Number.isFinite(point.x)||!Number.isFinite(point.y))throw new Error('유효한 도형 조절점 위치가 필요합니다.');
  const base=normalizeShapeAdjustments(kind,adjustments,width,height),initial=shapeAdjustmentHandles(kind,width,height,base).find(handle=>handle.id===handleId);
  if(!initial)throw new Error('지원하지 않는 도형 조절점입니다.');
  const refs=initial.refs;
  const evaluate=candidate=>{
    try{const normalized=normalizeShapeAdjustments(kind,candidate,width,height),handle=shapeAdjustmentHandles(kind,width,height,normalized).find(item=>item.id===handleId);return{candidate:normalized,handle,loss:(handle.x-point.x)**2+(handle.y-point.y)**2};}catch{return null;}
  };
  let best=evaluate(base);
  // Angles wrap at a full turn; a few safe seeds avoid choosing the long side of the circle.
  for(const ref of refs)if(initial.bounds[ref].axis==='angle')for(let index=0;index<24;index++){
    const {min,max}=initial.bounds[ref],probe=evaluate({...base,[ref]:min+(max-min)*index/24});if(probe&&probe.loss<best.loss)best=probe;
  }
  for(let iteration=0;iteration<20&&best.loss>1e-8;iteration++){
    const current=best,columns=[];
    for(const ref of refs){
      const bound=current.handle.bounds[ref],center=Object.hasOwn(current.candidate,ref)?current.candidate[ref]:bound.value,range=bound.max-bound.min;
      const delta=Math.max(.01,Math.min(range||1,bound.axis==='angle'?21600000:100000)*.0001),low=Math.max(bound.min,center-delta),high=Math.min(bound.max,center+delta);
      const a=evaluate({...current.candidate,[ref]:low}),b=evaluate({...current.candidate,[ref]:high});
      columns.push(a&&b&&high>low?[(b.handle.x-a.handle.x)/(high-low),(b.handle.y-a.handle.y)/(high-low)]:[0,0]);
    }
    const error=[point.x-current.handle.x,point.y-current.handle.y];let deltas=[];
    if(refs.length===1){const [x,y]=columns[0],norm=x*x+y*y;deltas=[norm>1e-20?(x*error[0]+y*error[1])/norm:0];}
    else if(refs.length===2){const [[a,c],[b,d]]=columns,det=a*d-b*c;if(Math.abs(det)>1e-20)deltas=[(d*error[0]-b*error[1])/det,(-c*error[0]+a*error[1])/det];else deltas=columns.map(([x,y])=>{const norm=x*x+y*y;return norm>1e-20?(x*error[0]+y*error[1])/norm:0;});}
    if(!deltas.some(delta=>Number.isFinite(delta)&&Math.abs(delta)>1e-8))break;
    let improved=false;
    for(let scale=1;scale>=1/128;scale/=2){const proposal={...current.candidate};for(let index=0;index<refs.length;index++){const ref=refs[index],bound=current.handle.bounds[ref],center=Object.hasOwn(proposal,ref)?proposal[ref]:bound.value,natural=bound.axis==='angle'?21600000:400000;proposal[ref]=Math.max(bound.min,Math.min(bound.max,center+Math.max(-natural,Math.min(natural,deltas[index]))*scale));}const trial=evaluate(proposal);if(trial&&trial.loss<best.loss-1e-10){best=trial;improved=true;break;}}
    if(!improved)break;
  }
  return normalizeShapeAdjustments(kind,Object.fromEntries(Object.entries(best.candidate).map(([key,value])=>[key,clean(value)])),width,height);
}
