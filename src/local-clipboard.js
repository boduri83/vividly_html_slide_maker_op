/** Clipboard transport planning and resolution. Document values remain in the Controller. */
export const LOCAL_CLIPBOARD_KIND='vividly-local-clipboard';
export const CLIPBOARD_TEXT_LIMIT=32*1024*1024;
function markerText(token){if(typeof token!=='string'||!token.trim()||token.length>256)throw Error('클립보드 참조가 잘못되었습니다.');return JSON.stringify({kind:LOCAL_CLIPBOARD_KIND,version:1,token});}
export function planClipboardWrite(payload,token,maxBytes=CLIPBOARD_TEXT_LIMIT){
  if(!payload||typeof payload!=='object')throw Error('복사할 개체가 필요합니다.');
  const marker=markerText(token),knownBytes=(payload.assets||[]).reduce((sum,a)=>sum+(typeof a.dataBase64==='string'?a.dataBase64.length:0),0);
  // Large media already exceeds the native text cap; avoid serializing another full video copy.
  if(knownBytes>maxBytes)return{mode:'marker',marker,text:null};
  const text=JSON.stringify(payload),large=text.length>maxBytes||new TextEncoder().encode(text).byteLength>maxBytes;
  return{mode:large?'marker':'full',marker,text:large?null:text};
}
export async function publishClipboard(payload,{writeText,token,maxBytes=CLIPBOARD_TEXT_LIMIT}){
  const plan=planClipboardWrite(payload,token,maxBytes),errors=[];
  if(typeof writeText!=='function')throw Error('클립보드 쓰기 기능이 필요합니다.');
  if(plan.mode==='full')try{await writeText(plan.text);return{payload,token,status:'confirmed',mode:'full'};}catch(error){errors.push(error?.message||String(error));}
  try{await writeText(plan.marker);return{payload,token,status:'confirmed',mode:'marker',fallbackErrors:errors};}catch(error){errors.push(error?.message||String(error));return{payload,token,status:'failed',mode:'marker',errors};}
}
export function canCommitClipboardCut(captured,current){return captured.sessionId===current.sessionId&&captured.slideId===current.slideId&&captured.revision===current.revision&&JSON.stringify(captured.selected)===JSON.stringify(current.selected);}
export function resolveClipboardContents(contents,state){
  if(state?.status==='failed')throw Error('클립보드에 쓰지 못해 이전 내용을 붙여넣지 않았습니다. 원본은 유지했습니다. 복사를 다시 시도하세요.');
  if(!contents)return state?.status==='confirmed'?{kind:'local',payload:state.payload}:{kind:'empty'};
  const text=typeof contents.text==='string'?contents.text:'';
  let marker=null;if(text.length<=2048){try{const value=JSON.parse(text);if(value?.kind===LOCAL_CLIPBOARD_KIND)marker=value;}catch{}}
  if(marker){if(marker.version!==1||typeof marker.token!=='string'||Object.keys(marker).some(k=>!['kind','version','token'].includes(k)))throw Error('이 로컬 클립보드 참조를 읽을 수 없습니다.');if(state?.status!=='confirmed'||marker.token!==state.token)throw Error('큰 개체는 복사한 Vividly 창에서 붙여넣으세요. 이 창에는 원본 클립보드 데이터가 없습니다.');return{kind:'local',payload:state.payload};}
  return{kind:'external',contents};
}
