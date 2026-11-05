/** One close attempt drains owned edits once, then asks about the current author state. */
export async function confirmWindowClose(event,{getWindow,getState,isClosing,setClosing,hosts=[],files,progress,dialog,readEditorState,setDirty}){
  if(isClosing()){event.preventDefault();return;}
  const initial=getState(),services=hosts.filter(Boolean),drain=services.some(host=>host.needsStop);
  const busy=()=>Boolean(files.busy||progress?.busy||getState().busy);
  if(!drain&&!busy()&&!initial.dirty&&!initial.composing)return;
  event.preventDefault();
  const window=getWindow(),sessionId=initial.sessionId;
  setClosing(true);
  const mayDestroy=()=>getState().sessionId===sessionId&&!busy()&&getWindow()===window&&window&&!window.isDestroyed();
  try{
    if(drain){
      await Promise.all(services.map(host=>host.stopAndDrain()));
      const fresh=await readEditorState();
      if(!fresh?.ok)throw Error('편집 결과를 확인하지 못했습니다. 현재 자료를 저장한 뒤 다시 닫아 주세요.');
      if(getState().sessionId!==sessionId)return;
      setDirty(Boolean(fresh.value.state.dirty));
    }
    if(busy()){
      await dialog.showMessageBox(window,{type:'info',title:'파일 작업 중',message:'파일 작업이 끝난 뒤 창을 닫아 주세요.',buttons:['계속 편집'],defaultId:0,cancelId:0});
      return;
    }
    const unknown=services.some(host=>host.outcomeUnknown),state=getState();
    if(unknown||state.dirty||state.composing){
      const decision=await dialog.showMessageBox(window,{type:'warning',title:unknown?'실행 결과 확인':'변경 내용 보관',
        message:unknown?'일부 외부 요청의 완료 여부를 확인하지 못했습니다.':'저장하지 않은 변경 내용이 있습니다.',
        detail:unknown?'계속 편집으로 돌아가 요청 결과와 현재 자료를 확인한 뒤 저장할 수 있습니다. 닫기를 선택하면 현재 HTML 파일에는 저장하지 않습니다. 기기의 자동 복구본은 남을 수 있으며 다음 실행 또는 문서의 복구 도구에서 확인할 수 있습니다.':'현재 HTML 파일에 저장하지 않고 닫을 수 있습니다. 기기의 자동 복구본은 남을 수 있으며 다음 실행 또는 문서의 복구 도구에서 확인할 수 있습니다.',
        buttons:['계속 편집','저장하지 않고 닫기'],defaultId:0,cancelId:0,noLink:true});
      if(decision.response!==1)return;
    }
    if(mayDestroy())window.destroy();
  }catch(error){
    if(window&&!window.isDestroyed())await dialog.showMessageBox(window,{type:'info',title:'편집 결과 확인',message:error.message,buttons:['계속 편집'],defaultId:0,cancelId:0});
  }finally{setClosing(false);}
}
