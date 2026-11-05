/** Host-only approved PNG injection. Public commands keep their original 256KiB limit. */
import{evaluateCommands,validateCommands}from'./commands.js';
import{normalizeDocument}from'./model.js';
import{decodeCanonicalBase64}from'./safe-base64.js';
export const TRUSTED_ASSET_LIMITS=Object.freeze({perAsset:20*1024*1024,total:40*1024*1024,count:8,axis:16384,pixels:64*1024*1024});
const fail=(code,message)=>{throw Object.assign(Error(message),{code});};
function data(value,keys,label){if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail('INVALID_STAGED_ASSET',label+' JSON 객체가 필요합니다.');for(const key of Reflect.ownKeys(value)){const d=Object.getOwnPropertyDescriptor(value,key);if(typeof key!=='string'||!keys.includes(key)||!d?.enumerable||!Object.hasOwn(d,'value'))fail('INVALID_STAGED_ASSET',label+' 데이터 필드만 허용합니다.');}}
export function freezeStagedAssets(input=[]){
  if(!Array.isArray(input)||input.length>TRUSTED_ASSET_LIMITS.count)fail('INVALID_STAGED_ASSET','승인한 자산은 한 번에 최대 8개입니다.');
  let total=0;const ids=new Set();
  const result=input.map(entry=>{data(entry,['asset'],'stagedAssets');const a=entry.asset;data(a,['id','mimeType','width','height','bytes','sha256','dataBase64'],'asset');
    if(typeof a.id!=='string'||!a.id.trim()||a.id.length>256||ids.has(a.id))fail('INVALID_STAGED_ASSET','중복 없는 자산 ID가 필요합니다.');ids.add(a.id);
    if(a.mimeType!=='image/png'||!Number.isSafeInteger(a.bytes)||a.bytes<1||a.bytes>TRUSTED_ASSET_LIMITS.perAsset||typeof a.sha256!=='string'||!/^[a-f0-9]{64}$/.test(a.sha256))fail('INVALID_STAGED_ASSET','20MiB 이하의 승인된 PNG metadata가 필요합니다.');
    if(![a.width,a.height].every(n=>Number.isSafeInteger(n)&&n>0&&n<=TRUSTED_ASSET_LIMITS.axis)||a.width*a.height>TRUSTED_ASSET_LIMITS.pixels)fail('INVALID_STAGED_ASSET','PNG 크기 한도를 벗어났습니다.');
    if(typeof a.dataBase64!=='string'||a.dataBase64.length>Math.ceil(TRUSTED_ASSET_LIMITS.perAsset/3)*4)fail('INVALID_STAGED_ASSET','PNG payload 한도를 벗어났습니다.');
    total+=a.bytes;if(total>TRUSTED_ASSET_LIMITS.total)fail('INVALID_STAGED_ASSET','한 묶음의 승인 자산 총량은 40MiB 이하입니다.');
    return Object.freeze({asset:Object.freeze({...a})});
  });return Object.freeze(result);
}
export function stagedAssetManifest(entries){return JSON.stringify(entries.map(({asset:{dataBase64,...metadata}})=>metadata).sort((a,b)=>a.id.localeCompare(b.id)));}
export async function createTrustedAssetBundle(document,commands,stagedAssets=[]){
  const entries=freezeStagedAssets(stagedAssets),checked=validateCommands(commands);if(!checked.ok)throw Object.assign(Error(checked.error.message),checked.error);
  for(const command of checked.value)if(command.params.assets?.length)fail('PUBLIC_ASSET_BYTES_FORBIDDEN','외부 명령에는 자산 원문을 넣을 수 없습니다. 승인한 staging handle을 사용하세요.');
  for(const{asset}of entries){const bytes=decodeCanonicalBase64(asset.dataBase64);if(bytes.length!==asset.bytes)fail('INVALID_STAGED_ASSET','승인 PNG의 byte 수가 다릅니다.');
    const signature=[137,80,78,71,13,10,26,10];if(bytes.length<33||signature.some((b,i)=>bytes[i]!==b)||String.fromCharCode(...bytes.slice(12,16))!=='IHDR')fail('INVALID_STAGED_ASSET','PNG header가 올바르지 않습니다.');
    const view=new DataView(bytes.buffer);if(view.getUint32(16)!==asset.width||view.getUint32(20)!==asset.height)fail('INVALID_STAGED_ASSET','승인 PNG의 실제 크기가 다릅니다.');
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');if(hash!==asset.sha256)fail('INVALID_STAGED_ASSET','승인 PNG의 SHA-256이 다릅니다.');
    const old=document.assets.find(a=>a.id===asset.id);if(old&&(old.mimeType!==asset.mimeType||old.bytes!==asset.bytes||old.sha256!==asset.sha256||old.width!==asset.width||old.height!==asset.height||old.dataBase64!==asset.dataBase64))fail('STAGED_ASSET_CONFLICT','기존 자산 ID와 승인 자산의 내용이 다릅니다.');
  }
  return Object.freeze({entries,manifest:stagedAssetManifest(entries)});
}
export function evaluateCommandsWithAssets(document,commands,bundle,options={}){
  const incoming=bundle.entries.filter(({asset})=>!document.assets.some(old=>old.id===asset.id)).map(({asset})=>asset);
  let base;try{base=normalizeDocument({...document,assets:[...document.assets,...incoming]});}catch(error){return{ok:false,error:{code:'INVALID_STAGED_ASSET',message:error.message,path:'$.trusted.stagedAssets'}};}
  const evaluated=evaluateCommands(base,commands,options);if(!evaluated.ok)return evaluated;
  const used=new Set([...evaluated.value.document.slides,...(evaluated.value.document.layouts||[]),...(evaluated.value.document.layoutMasters||[])].flatMap(s=>s.elements).filter(e=>e.type==='image').map(e=>e.assetId));
  // Library images may deliberately remain unused until a human places them from the gallery.
  for(const command of commands)if(command.id==='library.import')for(const id of command.params.assetIds||[])if(evaluated.value.document.assets.some(asset=>asset.id===id&&asset.mimeType==='image/png'))used.add(id);
  if(bundle.entries.some(({asset})=>!used.has(asset.id)))return{ok:false,error:{code:'UNUSED_STAGED_ASSET',message:'명령 결과에서 사용하지 않는 승인 자산은 넣을 수 없습니다.',path:'$.trusted.stagedAssets'}};
  return{ok:true,value:{document:evaluated.value.document,changed:JSON.stringify(document)!==JSON.stringify(evaluated.value.document),...(evaluated.value.createdIds?{createdIds:evaluated.value.createdIds}:{})}};
}
