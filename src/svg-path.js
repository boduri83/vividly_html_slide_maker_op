/** Validate only bounded SVG path numbers/commands; no markup, URLs, scripts or transforms. */
export function normalizeSvgPath(input){
  if(typeof input!=='string'||!input.trim()||input.length>32768)throw new Error('SVG path는 32 KiB 이하의 경로여야 합니다.');
  const tokens=[],regexp=/[MmLlHhVvCcSsQqTtAaZz]|[+-]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][+-]?\d+)?/g;let end=0,match;
  while((match=regexp.exec(input))){if(!/^[\s,]*$/.test(input.slice(end,match.index)))throw new Error('지원하지 않는 SVG 경로 구문입니다.');tokens.push(match[0]);end=regexp.lastIndex;if(tokens.length>8192)throw new Error('SVG path가 너무 복잡합니다.');}
  if(!/^[\s,]*$/.test(input.slice(end))||!/^m$/i.test(tokens[0]||''))throw new Error('SVG path는 이동 명령으로 시작해야 합니다.');
  const sizes={m:2,l:2,h:1,v:1,c:6,s:4,q:4,t:2,a:7,z:0};
  for(let i=0;i<tokens.length;){const command=tokens[i++];if(!/^[a-z]$/i.test(command))throw new Error('SVG 경로 명령이 필요합니다.');const size=sizes[command.toLowerCase()],values=[];
    while(i<tokens.length&&!/^[a-z]$/i.test(tokens[i])){const value=Number(tokens[i++]);if(!Number.isFinite(value)||Math.abs(value)>1000000)throw new Error('SVG 경로 좌표 범위를 벗어났습니다.');values.push(value);}
    if(size===0?values.length>0:!values.length||values.length%size)throw new Error('SVG 경로 좌표 수가 올바르지 않습니다.');
    if(command.toLowerCase()==='a')for(let j=0;j<values.length;j+=7)if(values[j]<0||values[j+1]<0||![0,1].includes(values[j+3])||![0,1].includes(values[j+4]))throw new Error('SVG 원호의 반지름·방향이 올바르지 않습니다.');
  }
  return input.trim();
}
