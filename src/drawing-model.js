/** Closed, normalized freeform author data. Gesture samples never become a second document. */
export const FREEFORM_KIND='freeform';
export const FREEFORM_POINT_LIMIT=512;
const point={type:'object',properties:{x:{type:'number',minimum:0,maximum:1},y:{type:'number',minimum:0,maximum:1}},required:['x','y'],additionalProperties:false};
export const drawingSchemas={path:{type:'object',properties:{points:{type:'array',items:point,minItems:2,maxItems:FREEFORM_POINT_LIMIT},closed:{type:'boolean'}},required:['points','closed'],additionalProperties:false}};
export function normalizeFreeformPath(input){
  if(!input||Object.getPrototypeOf(input)!==Object.prototype||Object.keys(input).some(key=>!['points','closed'].includes(key))||typeof input.closed!=='boolean'||!Array.isArray(input.points)||input.points.length<2||input.points.length>FREEFORM_POINT_LIMIT)throw new Error('자유형은 닫힘 여부와 2~512개의 점이 필요합니다.');
  const points=input.points.map(p=>{if(!p||Object.getPrototypeOf(p)!==Object.prototype||Object.keys(p).length!==2||!Object.hasOwn(p,'x')||!Object.hasOwn(p,'y')||![p.x,p.y].every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1))throw new Error('자유형 점은 0~1 범위의 유한한 좌표여야 합니다.');return{x:p.x,y:p.y};});
  if(input.closed&&points.length<3)throw new Error('닫힌 자유형은 세 개 이상의 점이 필요합니다.');
  return{points,closed:input.closed};
}
export function freeformGeometry(path,width,height){
  const value=normalizeFreeformPath(path);
  if(![width,height].every(n=>Number.isFinite(n)&&n>0))throw new Error('자유형 크기는 양수여야 합니다.');
  const n=value=>String(Number(value.toFixed(7)));
  return{paths:[{d:value.points.map((p,i)=>`${i?'L':'M'} ${n(p.x*width)} ${n(p.y*height)}`).join(' ')+(value.closed?' Z':''),fill:value.closed,stroke:true}],textRect:{x:0,y:0,width,height}};
}
