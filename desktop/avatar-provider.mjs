/** Main-only Responses adapter. No credentials, paid calls or default model are bundled. */
export class AvatarError extends Error{constructor(code,message,extra={}){super(message);this.code=code;Object.assign(this,extra);}}
export const PROVIDER_LIMITS=Object.freeze({responseBytes:2*1024*1024,requestBytes:1024*1024,deadlineMs:60000,maxOutputTokens:16384});
const invalid=message=>{throw new AvatarError('INVALID_SETTINGS',message);};
export function normalizeProviderProfile(input={}){
 const provider=input.provider??'openai';if(provider==='codex'){const model=input.model??'';if(typeof model!=='string'||model.length>256||model&&!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(model))invalid('Codex 모델 목록에서 사용할 모델을 선택하세요.');if(input.endpoint!==undefined&&input.endpoint!=='')invalid('Codex 직접 연결에는 API 주소가 필요하지 않습니다.');return{provider,endpoint:'',model};}if(!['openai','local'].includes(provider))invalid('지원하는 API 연결을 선택하세요.');
 const endpoint=input.endpoint??(provider==='openai'?'https://api.openai.com/v1/responses':'http://127.0.0.1:1234/v1/responses');if(typeof endpoint!=='string'||endpoint.length>2048)invalid('API 주소를 확인하세요.');let url;try{url=new URL(endpoint);}catch{invalid('API 주소를 확인하세요.');}
 if(url.username||url.password||url.search||url.hash||!url.pathname.endsWith('/responses'))invalid('인증 정보나 쿼리가 없는 Responses API 주소를 입력하세요.');
 const hostname=url.hostname.replace(/^\[|\]$/g,''),loopback=hostname==='localhost'||hostname==='::1'||/^127(?:\.\d{1,3}){3}$/.test(hostname)&&hostname.split('.').every(n=>Number(n)<=255);
 if(provider==='openai'&&url.protocol!=='https:'||provider==='local'&&(!loopback||!['http:','https:'].includes(url.protocol)))invalid('외부 API에는 HTTPS, 로컬 연결에는 loopback 주소를 사용하세요.');
 const model=input.model??'';if(typeof model!=='string'||model.length>256||model&&!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(model))invalid('사용할 모델 ID를 직접 입력하세요.');
 return{provider,endpoint:url.href,model};
}
export function createResponsesProvider({fetchImpl=globalThis.fetch,deadlineMs=PROVIDER_LIMITS.deadlineMs,responseBytes=PROVIDER_LIMITS.responseBytes}={}){
 if(typeof fetchImpl!=='function')throw TypeError('fetch dependency is required');
 return{async respond({connection,input,tools,signal}={}){
  const profile=normalizeProviderProfile(connection);if(profile.provider==='codex')throw new AvatarError('PROVIDER_MISMATCH','Codex 직접 연결 provider를 사용하세요.');if(!profile.model)throw new AvatarError('NOT_CONFIGURED','사용할 모델 ID를 입력하세요.');const apiKey=connection.apiKey??'';
  if(typeof apiKey!=='string'||apiKey.length>16384||/[\r\n]/.test(apiKey))throw new AvatarError('INVALID_SETTINGS','API 인증 정보를 확인하세요.');
  if(profile.provider==='openai'&&!apiKey)throw new AvatarError('NOT_CONFIGURED','API 키를 설정하세요.');
  const body=JSON.stringify({model:profile.model,input,tools,tool_choice:'auto',parallel_tool_calls:false,store:false,stream:false,max_output_tokens:PROVIDER_LIMITS.maxOutputTokens});if(Buffer.byteLength(body)>PROVIDER_LIMITS.requestBytes)throw new AvatarError('CONTEXT_LIMIT','요청 내용이 너무 큽니다. 범위를 줄여 주세요.');
  const controller=new AbortController(),abort=()=>controller.abort(),timer=setTimeout(()=>controller.abort(new Error('deadline')),Math.min(60000,Math.max(1,deadlineMs)));if(signal?.aborted)controller.abort();else signal?.addEventListener('abort',abort,{once:true});let reader;
  try{
   const response=await fetchImpl(profile.endpoint,{method:'POST',headers:{'Content-Type':'application/json',...(apiKey?{Authorization:'Bearer '+apiKey}:{})},body,redirect:'error',signal:controller.signal});
   if(!response.ok)throw new AvatarError(response.status===429?'PROVIDER_LIMIT':'PROVIDER_HTTP','API 요청을 완료하지 못했습니다. HTTP '+response.status,{status:response.status});
   const declared=Number(response.headers.get('content-length'));if(Number.isFinite(declared)&&declared>responseBytes)throw new AvatarError('RESPONSE_LIMIT','API 응답이 허용 크기를 넘었습니다.');
   if(!response.body?.getReader)throw new AvatarError('PROVIDER_PROTOCOL','API 응답 본문이 없습니다.');reader=response.body.getReader();const chunks=[];let size=0;
   for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>responseBytes)throw new AvatarError('RESPONSE_LIMIT','API 응답이 허용 크기를 넘었습니다.');chunks.push(Buffer.from(part.value));}
   let data;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new AvatarError('PROVIDER_PROTOCOL','API가 올바른 JSON 응답을 반환하지 않았습니다.');}
   if(data.status==='incomplete')throw new AvatarError('PROVIDER_INCOMPLETE','API 응답이 완료되기 전에 중단됐습니다.');if(data.status!=='completed'||!Array.isArray(data.output))throw new AvatarError('PROVIDER_PROTOCOL','완료된 Responses API 응답이 필요합니다.');
   if(data.output.some(item=>item?.type==='message'&&item.content?.some(c=>c.type==='refusal')))throw new AvatarError('PROVIDER_REFUSAL','모델이 이 요청의 처리를 거절했습니다.');
   const calls=data.output.filter(item=>item?.type==='function_call');if(calls.length>1)throw new AvatarError('PROVIDER_PROTOCOL','한 응답에는 하나의 도구 호출만 허용합니다.');
   for(const call of calls)if(typeof call.name!=='string'||typeof call.call_id!=='string'||!call.call_id||call.call_id.length>256||typeof call.arguments!=='string')throw new AvatarError('PROVIDER_PROTOCOL','도구 호출 형식이 올바르지 않습니다.');
   for(const item of data.output)if(!item||!['reasoning','function_call','message'].includes(item.type))throw new AvatarError('PROVIDER_PROTOCOL','지원하지 않는 API 출력 종류입니다.');
   return{output:structuredClone(data.output),responseId:typeof data.id==='string'?data.id:null,usage:data.usage?structuredClone(data.usage):undefined};
  }catch(error){if(signal?.aborted)throw new AvatarError('CANCELLED','요청을 중단했습니다.');if(controller.signal.aborted)throw new AvatarError('PROVIDER_TIMEOUT','API 응답 시간이 초과됐습니다.');if(error instanceof AvatarError)throw error;throw new AvatarError('PROVIDER_NETWORK','API 연결을 완료하지 못했습니다.');}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);try{await reader?.cancel();}catch{}}
 }};
}
