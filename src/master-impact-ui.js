const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/** A preview of the actual detached candidate, before shared history changes. */
export function createMasterImpactDialog(parent){
  const dialog=document.createElement('dialog');dialog.id='mw-impact-dialog';dialog.setAttribute('aria-labelledby','mw-impact-heading');
  dialog.style.cssText='width:min(530px,88vw);max-height:75vh;overflow:auto;border:1px solid #cfd8e9;border-radius:12px;padding:24px;color:#243653;box-shadow:0 12px 60px #17233b33';
  dialog.innerHTML='<h2 id="mw-impact-heading" style="margin:0 0 12px;font-size:19px">마스터 변경 내용 확인</h2><p id="mw-impact-summary"></p><ul id="mw-impact-pages" style="max-height:160px;overflow:auto;padding-left:20px;font-size:12px"></ul><p id="mw-impact-overrides" style="font-size:12px;color:#718099"></p><p style="font-size:12px;color:#718099">반영한 변경은 한 번 실행 취소로 되돌릴 수 있습니다.</p><div style="display:flex;justify-content:flex-end;gap:8px;margin-top:22px"><button id="mw-impact-cancel">계속 편집</button><button id="mw-impact-confirm" class="mw-primary">변경 내용 반영</button></div>';
  parent.append(dialog);let settle=null;
  function close(value=false){if(!settle)return;const resolve=settle;settle=null;dialog.close();resolve(value);}
  function show({impact}){
    if(settle)return Promise.resolve(false);
    const count=impact.slideIds.length;
    dialog.querySelector('#mw-impact-summary').textContent=count?`${count}장의 디자인과 ${impact.changedElementIds.length}개 개체에 변경이 반영됩니다.`:'현재 장의 내용은 바뀌지 않습니다. 마스터와 페이지 유형을 자료에 저장합니다.';
    dialog.querySelector('#mw-impact-pages').innerHTML=impact.slideNames.map(name=>'<li>'+escape(name)+'</li>').join('');
    dialog.querySelector('#mw-impact-pages').hidden=!count;
    dialog.querySelector('#mw-impact-overrides').textContent=`장별로 직접 지정한 서식·배치 ${impact.overrideCount}개와 입력한 내용은 유지합니다.`;
    const promise=new Promise(resolve=>settle=resolve);dialog.showModal();dialog.querySelector('#mw-impact-confirm').focus();return promise;
  }
  dialog.querySelector('#mw-impact-confirm').onclick=()=>close(true);dialog.querySelector('#mw-impact-cancel').onclick=()=>close(false);
  dialog.addEventListener('cancel',event=>{event.preventDefault();close(false);});
  return{show,close,get open(){return dialog.open;}};
}
