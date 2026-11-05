/** Closed local media data. No remote URLs, scripts, browser state or filesystem paths. */
import {canonicalBase64} from './safe-base64.js';
export const VIDEO_MIME_TYPES=Object.freeze(['video/mp4','video/webm','video/ogg']);
export const VIDEO_MAX_BYTES=50*1024*1024;
export const MEDIA_TOTAL_MAX_BYTES=64*1024*1024;
const identifier={type:'string',minLength:1,maxLength:256,pattern:'\\S'};
const bool={type:'boolean'};
export const videoSchemas={settings:{type:'object',additionalProperties:false,properties:{controls:bool,muted:bool,loop:bool,autoplay:bool,fit:{type:'string',enum:['contain','cover']},posterAssetId:identifier},required:['controls','muted','loop','autoplay','fit']}};
export const DEFAULT_VIDEO_SETTINGS=Object.freeze({controls:true,muted:false,loop:false,autoplay:false,fit:'contain'});
export function normalizeVideoSettings(value,assets){
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('video: 재생 설정이 필요합니다.');
  const allowed=Object.keys(videoSchemas.settings.properties);for(const key of Object.keys(value))if(!allowed.includes(key))throw Error(`video.${key}: 지원하지 않는 설정입니다.`);
  for(const key of ['controls','muted','loop','autoplay'])if(typeof value[key]!=='boolean')throw Error(`video.${key}: 켜기/끄기 값이 필요합니다.`);
  if(!['contain','cover'].includes(value.fit))throw Error('video.fit: contain 또는 cover를 선택하세요.');
  const result={controls:value.controls,muted:value.muted,loop:value.loop,autoplay:value.autoplay,fit:value.fit};
  if(value.posterAssetId!==undefined){if(typeof value.posterAssetId!=='string'||!value.posterAssetId.trim()||value.posterAssetId.length>256)throw Error('video.posterAssetId: 올바른 이미지 ID가 필요합니다.');if(assets&&!assets.some(a=>a.id===value.posterAssetId&&['image/png','image/jpeg','image/webp'].includes(a.mimeType)))throw Error('video.posterAssetId: 포스터 이미지 자산을 찾을 수 없습니다.');result.posterAssetId=value.posterAssetId;}
  return result;
}
export function mediaSignatureMatches(mime,bytes){
  if(!(bytes instanceof Uint8Array)||bytes.length<4)return false;
  if(mime==='video/webm')return bytes[0]===0x1a&&bytes[1]===0x45&&bytes[2]===0xdf&&bytes[3]===0xa3;
  if(mime==='video/mp4')return bytes.length>=12&&String.fromCharCode(...bytes.slice(4,8))==='ftyp';
  if(mime==='video/ogg')return String.fromCharCode(...bytes.slice(0,4))==='OggS';
  return false;
}
export function validateMediaAsset(asset){
  if(!asset||!VIDEO_MIME_TYPES.includes(asset.mimeType))throw Error('동영상은 MP4·WebM·Ogg 파일을 지원합니다.');
  if(!Number.isSafeInteger(asset.bytes)||asset.bytes<1||asset.bytes>VIDEO_MAX_BYTES)throw Error('동영상 한 파일은 50MB 이하로 선택하세요.');
  if(!Number.isFinite(asset.width)||!Number.isFinite(asset.height)||asset.width<=0||asset.height<=0||asset.width>16384||asset.height>16384)throw Error('동영상 크기는 1~16384px 범위여야 합니다.');
  if(!canonicalBase64(asset.dataBase64))throw Error('동영상 base64 데이터가 잘못되었습니다.');
  const length=asset.dataBase64.length/4*3-(asset.dataBase64.endsWith('==')?2:asset.dataBase64.endsWith('=')?1:0);if(length!==asset.bytes)throw Error('동영상 byte 수와 base64 데이터 길이가 일치하지 않습니다.');
  const prefix=asset.dataBase64.slice(0,Math.min(64,asset.dataBase64.length));
  const binary=globalThis.atob(prefix),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
  if(!mediaSignatureMatches(asset.mimeType,bytes))throw Error('동영상 파일의 실제 형식과 MIME 유형이 일치하지 않습니다.');
  return asset;
}
export function validateMediaBudget(assets){const videos=assets.filter(a=>VIDEO_MIME_TYPES.includes(a.mimeType));if(videos.reduce((n,a)=>n+a.bytes,0)>MEDIA_TOTAL_MAX_BYTES)throw Error('자료에 포함한 동영상 총합은 64MB 이하로 줄여 주세요.');for(const video of videos)validateMediaAsset(video);return true;}
/** Only explicit delete commands call this; Undo retains the original assets in its snapshot. */
export function pruneUnreferencedVideoAssets(document){
  const referenced=new Set([...document.slides.flatMap(s=>s.elements),...(document.layouts||[]).flatMap(l=>l.elements),...(document.layoutMasters||[]).flatMap(l=>l.elements),...(document.componentLibrary||[]).flatMap(component=>component.elements)].filter(e=>e.type==='video').map(e=>e.assetId));
  const removed=document.assets.filter(a=>VIDEO_MIME_TYPES.includes(a.mimeType)&&!referenced.has(a.id)).map(a=>a.id);
  if(removed.length){const ids=new Set(removed);document.assets=document.assets.filter(a=>!ids.has(a.id));}
  return removed;
}
