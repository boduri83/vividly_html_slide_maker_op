/** Linear validation for large immutable payloads; avoids repeated-group regexp stack growth. */
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function canonicalBase64(value){
  if(typeof value!=='string'||!value.length||value.length%4)return false;
  const padding=value.endsWith('==')?2:value.endsWith('=')?1:0,end=value.length-padding;
  if(/[^A-Za-z0-9+/]/.test(value.slice(0,end)))return false;
  if(padding===2&&alphabet.indexOf(value[end-1])%16!==0||padding===1&&alphabet.indexOf(value[end-1])%4!==0)return false;
  return true;
}
export function decodeCanonicalBase64(value){if(!canonicalBase64(value))throw Error('올바른 canonical base64가 필요합니다.');const raw=atob(value),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);return bytes;}
