/** Self-contained player hook serialized into independent HTML. It never writes author data. */
export function createMediaRuntime({root,document:authored,onStatus}={}){
  if(!root||!authored?.slides)throw Error('동영상 실행 루트와 문서가 필요합니다.');
  const records=new Map(),resumeIds=new Set(),assetUrls=new Map(),win=root.ownerDocument.defaultView||globalThis;let activeSlide=null,destroyed=false;
  function sourceUrl(assetId){if(assetUrls.has(assetId))return assetUrls.get(assetId);const asset=authored.assets?.find(a=>a.id===assetId);if(!asset||!['video/mp4','video/webm','video/ogg'].includes(asset.mimeType))throw Error('동영상 자산을 찾을 수 없습니다.');const data=win.atob(asset.dataBase64),bytes=new Uint8Array(data.length);for(let i=0;i<data.length;i++)bytes[i]=data.charCodeAt(i);const url=win.URL.createObjectURL(new win.Blob([bytes],{type:asset.mimeType}));assetUrls.set(assetId,url);return url;}
  function status(record,message=''){const node=record.node.parentElement?.querySelector('.vividly-media-status');if(node){node.textContent=message;node.hidden=!message;}onStatus?.({elementId:record.element.id,message});}
  function pauseRecord(record,reset=false){record.generation++;try{record.node.pause();if(reset&&Number.isFinite(record.node.duration))record.node.currentTime=0;}catch{}status(record);}
  function visible(record){const node=record.node,element=node.closest('.slide-element');return root.contains(node)&&!node.closest('[hidden]')&&element?.style.visibility!=='hidden'&&element?.style.display!=='none';}
  function refresh(){
    const nodes=new Map([...root.querySelectorAll('video[data-runtime-video]')].map(n=>[n.dataset.runtimeVideo,n]));
    for(const [id,record]of records)if(nodes.get(id)!==record.node){pauseRecord(record,true);record.remove();records.delete(id);}
    for(const slide of authored.slides)for(const element of slide.elements.filter(e=>e.type==='video'&&!e.hidden)){
      const node=nodes.get(element.id);if(!node||records.has(element.id))continue;
      const settings=element.video,record={node,element,slideId:slide.id,generation:0};records.set(element.id,record);
      node.controls=settings.controls;node.muted=settings.muted;node.defaultMuted=settings.muted;node.loop=settings.loop;node.autoplay=false;node.playsInline=true;node.style.objectFit=settings.fit;
      const failed=()=>status(record,'이 동영상의 코덱을 재생할 수 없습니다. 다른 MP4 또는 WebM 파일을 선택하세요.'),playing=()=>status(record);node.addEventListener('error',failed);node.addEventListener('playing',playing);record.remove=()=>{node.removeEventListener('error',failed);node.removeEventListener('playing',playing);node.removeAttribute('src');node.load();};pauseRecord(record,true);try{node.src=sourceUrl(element.assetId);}catch(error){status(record,error.message);}
    }
  }
  async function playVideo(id){const record=records.get(id);if(destroyed||!record||record.slideId!==activeSlide||!visible(record))return false;const generation=++record.generation;try{const result=record.node.play();if(result?.then)await result;if(destroyed||record.slideId!==activeSlide||!visible(record)){record.node.pause();return false;}if(record.generation!==generation)return false;status(record);return true;}catch(error){if(!destroyed&&record.generation===generation){const message=error?.name==='NotAllowedError'?'재생 버튼을 눌러 동영상을 시작하세요.':'동영상을 재생하지 못했습니다. 파일 형식과 코덱을 확인하세요.';status(record,message);}return false;}}
  function pauseVideo(id){const record=records.get(id);if(destroyed||!record)return false;pauseRecord(record);return true;}
  function stopVideo(id){const record=records.get(id);if(destroyed||!record)return false;pauseRecord(record,true);return true;}
  function sync({slideId,reset=false,autoplay=true}={}){if(destroyed)return;refresh();resumeIds.clear();const changed=activeSlide!==slideId;activeSlide=slideId;for(const record of records.values()){if(record.slideId!==slideId)pauseRecord(record,true);else if(changed||reset){pauseRecord(record,true);if(autoplay&&record.element.video.autoplay)void playVideo(record.element.id);}}}
  function pauseHidden(){if(destroyed)return;for(const record of records.values())if(!visible(record)&&!record.node.paused)pauseRecord(record);}
  function pauseAll({remember=false}={}){if(destroyed)return;resumeIds.clear();for(const record of records.values()){if(remember&&!record.node.paused&&record.slideId===activeSlide)resumeIds.add(record.element.id);pauseRecord(record);}}
  function resume(){if(destroyed)return;const ids=[...resumeIds];resumeIds.clear();for(const id of ids)void playVideo(id);}
  function getState(){return[...records.values()].map(({element,node,slideId})=>({elementId:element.id,slideId,paused:node.paused,currentTime:node.currentTime,duration:Number.isFinite(node.duration)?node.duration:null,ended:node.ended,muted:node.muted,loop:node.loop,error:node.error?.code||null}));}
  function destroy(){if(destroyed)return;for(const record of records.values()){pauseRecord(record,true);record.remove();}destroyed=true;records.clear();resumeIds.clear();for(const url of assetUrls.values())win.URL.revokeObjectURL(url);assetUrls.clear();}
  return{sync,playVideo,pauseVideo,stopVideo,pauseAll,pauseHidden,resume,getState,destroy};
}
