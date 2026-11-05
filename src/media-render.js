import { VIDEO_MIME_TYPES,normalizeVideoSettings,validateMediaAsset } from './media-model.js';
import {canonicalBase64} from './safe-base64.js';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dataUrl=asset=>{if(![...VIDEO_MIME_TYPES,'image/png','image/jpeg','image/webp'].includes(asset.mimeType)||!canonicalBase64(asset.dataBase64))throw Error('동영상 또는 포스터 데이터가 잘못되었습니다.');return `data:${asset.mimeType};base64,${asset.dataBase64}`;};
export const MEDIA_CONTENT_CSS=`
.slide-element.element-video{background:#111827;overflow:hidden}
.vividly-video-surface{position:relative;width:100%;height:100%;background:#111827;color:#e2e8f0}
.vividly-video-surface video,.vividly-video-surface>img{display:block;width:100%;height:100%;object-fit:contain}
.vividly-video-surface[data-media-editor] video{pointer-events:none}
.vividly-video-label{position:absolute;left:10px;bottom:10px;max-width:calc(100% - 20px);padding:5px 9px;border-radius:5px;background:#101827b8;color:#fff;font:14px/1.4 system-ui,sans-serif;pointer-events:none}
.vividly-media-status{position:absolute;inset:auto 10px 10px;padding:7px 10px;border-radius:6px;background:#101827df;color:#fff;font:14px/1.5 system-ui,sans-serif;pointer-events:none}
.vividly-media-status[hidden]{display:none}.vividly-video-static{display:flex;flex-direction:column;justify-content:center;align-items:center;width:100%;height:100%;background:#111827;color:#e2e8f0;text-align:center}
.vividly-video-static img{width:100%;height:100%;object-fit:contain}.vividly-video-static>span{padding:15px;font:18px/1.5 system-ui,sans-serif}
`;
export function videoContent(element,document,{interactive=false,staticState}={}){
  const asset=document.assets.find(a=>a.id===element.assetId&&VIDEO_MIME_TYPES.includes(a.mimeType));if(!asset)throw Error('동영상 자산을 찾을 수 없습니다.');
  validateMediaAsset(asset);
  const settings=normalizeVideoSettings(element.video,document.assets),poster=settings.posterAssetId?document.assets.find(a=>a.id===settings.posterAssetId):null,label=element.alt||element.name||'동영상';
  if(staticState)return `<div class="vividly-video-static" role="img" aria-label="${escape(label)}">${poster?`<img src="${dataUrl(poster)}" alt="${escape(label)}" style="object-fit:${settings.fit}">`:`<span>▶ ${escape(label)}<br>발표에서 재생되는 동영상</span>`}</div>`;
  return `<div class="vividly-video-surface"${interactive?' data-media-editor="true"':''}><video data-runtime-video="${escape(element.id)}" data-video-asset-id="${escape(asset.id)}" aria-label="${escape(label)}"${poster?` poster="${dataUrl(poster)}"`:''} preload="metadata" playsinline${settings.muted?' muted':''}${settings.loop?' loop':''}${!interactive&&settings.controls?' controls':''} style="object-fit:${settings.fit}">이 환경에서는 동영상을 재생할 수 없습니다.</video>${interactive?`<span class="vividly-video-label">▶ ${escape(label)}</span>`:''}<output class="vividly-media-status" aria-live="polite" hidden></output></div>`;
}
