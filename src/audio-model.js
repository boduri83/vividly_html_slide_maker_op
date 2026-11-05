/** Local audio author assets. Decoding is performed by the file preparation/runtime adapter. */
import {canonicalBase64} from './safe-base64.js';
export const AUDIO_MIME_TYPES=Object.freeze(['audio/wav','audio/mpeg','audio/ogg']);
export const AUDIO_MAX_BYTES=20*1024*1024;
export const AUDIO_TOTAL_MAX_BYTES=32*1024*1024;
export const AUDIO_MAX_DURATION=3600;
const id={type:'string',minLength:1,maxLength:256,pattern:'\\S'};
export const audioAssetSchema={type:'object',additionalProperties:false,properties:{id,mimeType:{type:'string',enum:AUDIO_MIME_TYPES},duration:{type:'number',exclusiveMinimum:0,maximum:AUDIO_MAX_DURATION},bytes:{type:'integer',minimum:1,maximum:AUDIO_MAX_BYTES},sha256:{type:'string',pattern:'^[a-fA-F0-9]{64}$'},dataBase64:{type:'string'}},required:['id','mimeType','duration','bytes','sha256','dataBase64']};
export function audioSignatureMatches(mime,bytes){
 if(!(bytes instanceof Uint8Array)||bytes.length<4)return false;
 if(mime==='audio/wav')return bytes.length>=12&&String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WAVE';
 if(mime==='audio/ogg')return String.fromCharCode(...bytes.slice(0,4))==='OggS';
 if(mime==='audio/mpeg')return String.fromCharCode(...bytes.slice(0,3))==='ID3'||bytes[0]===0xff&&(bytes[1]&0xe0)===0xe0&&(bytes[1]&0x06)!==0;
 return false;
}
export function normalizeAudioAsset(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('음향 자산 객체가 필요합니다.');
 for(const key of Object.keys(value))if(!Object.hasOwn(audioAssetSchema.properties,key))throw Error('audio.'+key+': 지원하지 않는 필드입니다.');
 if(typeof value.id!=='string'||!value.id.trim()||value.id.length>256)throw Error('음향 자산 ID를 확인하세요.');
 if(!AUDIO_MIME_TYPES.includes(value.mimeType))throw Error('음향은 WAV·MP3·Ogg 파일을 지원합니다.');
 if(!Number.isSafeInteger(value.bytes)||value.bytes<1||value.bytes>AUDIO_MAX_BYTES)throw Error('음향 한 파일은 20MB 이하로 선택하세요.');
 if(typeof value.duration!=='number'||!Number.isFinite(value.duration)||value.duration<=0||value.duration>AUDIO_MAX_DURATION)throw Error('음향 길이는 0초 초과·1시간 이하여야 합니다.');
 if(typeof value.sha256!=='string'||!/^[a-fA-F0-9]{64}$/.test(value.sha256))throw Error('음향 SHA-256 형식을 확인하세요.');
 const encoded=value.dataBase64;
 if(!canonicalBase64(encoded)||encoded.length>Math.ceil(AUDIO_MAX_BYTES/3)*4)throw Error('음향 base64 데이터를 확인하세요.');
 const bytes=encoded.length/4*3-(encoded.endsWith('==')?2:encoded.endsWith('=')?1:0);if(bytes!==value.bytes)throw Error('음향 byte 수와 데이터 길이가 일치하지 않습니다.');
 const prefix=atob(encoded.slice(0,Math.min(64,encoded.length))),signature=Uint8Array.from(prefix,c=>c.charCodeAt(0));if(!audioSignatureMatches(value.mimeType,signature))throw Error('음향 파일의 실제 형식과 MIME 유형이 일치하지 않습니다.');
 return{id:value.id,mimeType:value.mimeType,duration:value.duration,bytes:value.bytes,sha256:value.sha256.toLowerCase(),dataBase64:encoded};
}
export function validateAudioAsset(value){normalizeAudioAsset(value);return value;}
export function validateAudioBudget(assets){const audio=assets.filter(a=>AUDIO_MIME_TYPES.includes(a.mimeType));if(audio.reduce((n,a)=>n+a.bytes,0)>AUDIO_TOTAL_MAX_BYTES)throw Error('자료의 음향 총합은 32MB 이하로 줄여 주세요.');for(const a of audio)normalizeAudioAsset(a);return true;}
export function pruneUnreferencedAudioAssets(document){const used=new Set([...document.slides,...(document.layouts||[]),...(document.layoutMasters||[])].flatMap(s=>(s.scene?.audio||[]).map(a=>a.assetId))),removed=document.assets.filter(a=>AUDIO_MIME_TYPES.includes(a.mimeType)&&!used.has(a.id)).map(a=>a.id);if(removed.length){const ids=new Set(removed);document.assets=document.assets.filter(a=>!ids.has(a.id));}return removed;}
