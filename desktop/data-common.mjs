/** Main-only JSON source policy; independent of model providers and external MCP. */
export class DataError extends Error {
 constructor(code,message,details={}){super(message);this.code=code;Object.assign(this,details);}
}
export const DATA_LIMITS=Object.freeze({responseBytes:2*1024*1024,deadlineMs:15000,sources:100,bindings:1000,settingsBytes:2*1024*1024,sampleRows:10,sampleColumns:30,pathDepth:8,chartRows:128,chartSeries:12,tableRows:100,tableColumns:30,tableCells:2000});
export const clone=value=>structuredClone(value);
export function exact(value,fields,message='입력 항목을 확인하세요.'){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!fields.includes(key)))throw new DataError('INVALID_REQUEST',message);
}
export function identifier(value,label='ID'){
 if(typeof value!=='string'||!value.trim()||value.length>256)throw new DataError('INVALID_REQUEST',label+'를 확인하세요.');
 return value;
}
export function normalizeDataUrl(value){
 if(typeof value!=='string'||value.length>4096||/[\u0000-\u0020\u007f]/.test(value))throw new DataError('INVALID_SOURCE','공백 없는 JSON API 주소를 입력하세요.');
 let url;try{url=new URL(value);}catch{throw new DataError('INVALID_SOURCE','올바른 JSON API 주소를 입력하세요.');}
 const host=url.hostname.replace(/^\[|\]$/g,''),loopback=host==='localhost'||host==='::1'||/^127(?:\.\d{1,3}){3}$/.test(host)&&host.split('.').every(n=>Number(n)<=255);
 if(url.username||url.password||url.hash||url.protocol!=='https:'&&!(url.protocol==='http:'&&loopback))throw new DataError('INVALID_SOURCE','외부 주소는 HTTPS, 로컬 HTTP는 loopback만 사용할 수 있습니다. URL 안의 인증 정보는 허용하지 않습니다.');
 if([...url.searchParams.keys()].some(key=>/^(?:api[-_]?key|service[-_]?key|access[-_]?token|refresh[-_]?token|token|secret|password|authorization|credential)$/i.test(key)))throw new DataError('INVALID_SOURCE','인증 정보는 URL 대신 전용 키 입력란에 입력하세요.');
 return url.href;
}
export function normalizeAuth(type='none',headerName,keyName){
 if(!['none','bearer','header','query'].includes(type))throw new DataError('INVALID_SOURCE','인증 방식을 선택하세요.');
 if(type==='query'){if(typeof keyName!=='string'||!keyName||keyName.length>128||!/^[A-Za-z][A-Za-z0-9_.-]*$/.test(keyName))throw new DataError('INVALID_SOURCE','인증 쿼리 키 이름을 확인하세요.');return{authType:type,keyName};}
 if(type!=='header')return{authType:type};
 if(typeof headerName!=='string'||!headerName||headerName.length>128||!/^[!#$%&'*+.^_\x60|~0-9A-Za-z-]+$/.test(headerName)||/^(?:authorization|proxy-.*|sec-.*|host|cookie|set-cookie|connection|content-.*|transfer-encoding|accept|range|origin|referer|user-agent)$/i.test(headerName))throw new DataError('INVALID_SOURCE','인증용 사용자 지정 헤더 이름을 확인하세요.');
 return{authType:type,headerName};
}
export function normalizeKey(value){
 if(typeof value!=='string'||value.length>16384||/[\r\n\u0000]/.test(value))throw new DataError('INVALID_SOURCE','API 키 형식을 확인하세요.');
 return value.trim();
}
export function credentialScope(source){return[new URL(source.url).origin,source.authType,source.headerName?.toLowerCase()||source.keyName||''].join('\n');}
export function secretForms(secret=''){return secret?[...new Set([secret,encodeURIComponent(secret),new URLSearchParams({v:secret}).toString().slice(2)])]:[];}
export function containsSecret(value,secret=''){const text=typeof value==='string'?value:JSON.stringify(value);return secretForms(secret).some(form=>text.includes(form));}
export function redact(value,secret=''){
 if(typeof value==='string'){for(const form of secretForms(secret))value=value.replaceAll(form,'[보호된 인증 정보]');return value;}
 if(Array.isArray(value))return value.map(item=>redact(item,secret));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!['apiKey','authorization','encryptedCredential','ciphertext'].includes(key)).map(([key,item])=>[redact(key,secret),redact(item,secret)]));
 return value;
}
export function resultError(error){return{ok:false,error:{code:error.code||'DATA_ERROR',message:error.message||'데이터 작업을 완료하지 못했습니다.',...(error.outcomeUnknown?{outcomeUnknown:true}:{mutated:false})}};}
