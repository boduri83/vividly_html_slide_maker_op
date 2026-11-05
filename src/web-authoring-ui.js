/** Human web controls use existing behavior variables and one shared command batch. */
const copy=value=>structuredClone(value);
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fresh=prefix=>prefix+'-'+crypto.randomUUID();
const types={text:'한 줄',textarea:'여러 줄',email:'이메일',number:'숫자',checkbox:'체크',select:'선택 목록'};
const option=(value,label)=>`<option value="${escape(value)}">${escape(label)}</option>`;
const label=(name,id,html)=>`<label class="stacked-label">${name}${html||`<input id="${id}">`}</label>`;
const select=(name,id,choices)=>label(name,id,`<select id="${id}">${choices.map(([value,title])=>option(value,title)).join('')}</select>`);

export function buildWebFormCommands(document,slideId,definition,{createId=fresh}={}){
  const slide=document.slides.find(slide=>slide.id===slideId);if(!slide)throw Error('입력 폼을 넣을 장을 선택하세요.');
  const name=String(definition.name||'').trim();if(!name||name.length>160)throw Error('폼 이름은 1~160자로 입력하세요.');
  const fields=definition.fields;if(!Array.isArray(fields)||!fields.length||fields.length>12)throw Error('입력 항목은 1~12개로 구성하세요.');
  if((document.webForms||[]).length>=32)throw Error('자료에는 입력 폼을 32개까지 등록할 수 있습니다.');
  if(!['none','local','session'].includes(definition.persistence))throw Error('입력값을 보관할 위치를 선택하세요.');
  const formId=createId('form'),groupId=createId('form-group'),variables=[],inputs=[],elements=[],controls=[],keys=new Set();
  const columns=fields.length>5&&document.canvas.width>document.canvas.height?2:1,columnRows=Math.ceil(fields.length/columns),rowHeights=[];
  for(let row=0;row<columnRows;row++)rowHeights.push(fields.slice(row*columns,(row+1)*columns).some(field=>field.type==='textarea')?122:82);
  const rawWidth=columns===2?900:620,rawHeight=110+rowHeights.reduce((sum,height)=>sum+height,0),scale=Math.min(1,(document.canvas.width-64)/rawWidth,(document.canvas.height-80)/rawHeight);
  if(scale<=0)throw Error('슬라이드 크기를 먼저 확인하세요.');
  const width=rawWidth*scale,height=rawHeight*scale,x=(document.canvas.width-width)/2,y=Math.max(24,(document.canvas.height-height)/2),fontFamily=document.theme?.fontFamily||'Malgun Gothic',accent=document.theme?.colors?.primary||'#4f46e5';
  const geometry=(left,top,w,h)=>({x:x+left*scale,y:y+top*scale,width:w*scale,height:h*scale});
  const text=(id,title,left,top,w,h,size=20)=>({id,type:'text',name:title,groupId,geometry:geometry(left,top,w,h),text:{paragraphs:[title],textStyle:{fontFamily,fontSize:Math.max(12,size*scale),lineHeight:1.3,color:'#24324d',align:'left',verticalAlign:'middle'}}});
  const shape=(id,title,left,top,w,h,fill='#ffffff')=>({id,type:'shape',shape:'round-rect',name:title,groupId,geometry:geometry(left,top,w,h),fill,stroke:{color:'#ccd5e4',width:1},style:{radius:8*scale},text:{paragraphs:[title],textStyle:{fontFamily,fontSize:Math.max(12,18*scale),lineHeight:1.3,color:'#24324d',align:'left',verticalAlign:'middle'}}});
  const titleId=createId('form-title');elements.push(text(titleId,name,26,16,rawWidth-52,40,26));
  const normalizedFields=fields.map((field,index)=>{
    const title=String(field.label||'').trim(),key=field.key||'field'+(index+1),kind=field.type;
    if(!title||title.length>160||!Object.hasOwn(types,kind))throw Error('입력 항목의 이름과 종류를 확인하세요.');
    if(!/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(key)||keys.has(key))throw Error('입력 항목의 저장 키가 중복되거나 올바르지 않습니다.');keys.add(key);
    const variableId=createId('field-value'),targetId=createId('field-input'),row=Math.floor(index/columns),column=index%columns,left=26+column*(rawWidth-52)/columns,top=62+rowHeights.slice(0,row).reduce((sum,height)=>sum+height,0),cellWidth=(rawWidth-52)/columns-16;
    const variable={id:variableId,name:(name+' · '+title).slice(0,256),type:{number:'number',checkbox:'boolean',select:'choice'}[kind]||'text',initial:field.initial??(kind==='number'?0:kind==='checkbox'?false:'')};
    if(kind==='number'){variable.initial=Number(variable.initial);if(!Number.isFinite(variable.initial)||Math.abs(variable.initial)>1e9)throw Error('숫자 초기값은 -10억~10억으로 입력하세요.');Object.assign(variable,{minimum:-1e9,maximum:1e9,step:1});}
    else if(kind==='checkbox')variable.initial=Boolean(field.initial);
    else if(kind==='select'){
      const choices=(Array.isArray(field.options)?field.options:String(field.options||'선택 1, 선택 2').split(',')).map(value=>String(value).trim()).filter(Boolean);
      if(!choices.length||choices.length>128||new Set(choices).size!==choices.length||choices.some(value=>value.length>256))throw Error('선택 목록은 중복 없는 이름을 쉼표로 구분해 입력하세요.');
      variable.options=choices.map(value=>({value,label:value}));variable.initial=String(field.initial||choices[0]);if(!choices.includes(variable.initial))throw Error('선택 목록의 초기값을 목록 안에서 골라 주세요.');
    }else variable.initial=String(variable.initial);
    if(typeof variable.initial==='string'&&variable.initial.length>4096)throw Error('입력 초기값은 4096자 이하로 입력하세요.');
    variables.push(variable);
    elements.push(text(createId('field-label'),title+(field.required?' *':''),left,top,cellWidth,24,17));
    const placeholder=String(field.placeholder||'');if(placeholder.length>512)throw Error('입력 안내문은 512자 이하로 입력하세요.');
    elements.push(shape(targetId,placeholder||title+' 입력',left,top+27,cellWidth,kind==='textarea'?78:42));
    inputs.push({id:createId('field-control'),targetId,variableId,kind,...(kind==='number'?{minimum:-1e9,maximum:1e9,step:1}:{})});
    const result={key,variableId,label:title,type:kind,required:Boolean(field.required),...(placeholder?{placeholder}:{})};
    if(['text','textarea','email'].includes(kind)){const maxLength=Number(field.maxLength??(kind==='textarea'?2048:256));if(!Number.isInteger(maxLength)||maxLength<1||maxLength>4096)throw Error('최대 글자 수는 1~4096으로 입력하세요.');result.maxLength=maxLength;if(variable.initial.length>maxLength)throw Error('초기값이 최대 글자 수를 넘었습니다.');}
    return result;
  });
  const panelId=definition.modal?createId('form-panel'):null;
  for(const[action,title,index]of[['save','저장',0],['export','JSON 내보내기',1],['reset','초기화',2]]){
    const id=createId('form-'+action),button=shape(id,title,26+index*170,rawHeight-52,158,38,action==='save'?accent:'#f2f5fa');button.component={kind:'button'};button.text.textStyle.align='center';if(action==='save')button.text.textStyle.color='#ffffff';elements.push(button);controls.push({elementId:id,web:{kind:'formAction',formId,action,...(action==='save'&&panelId?{closePanelId:panelId}:{})}});
  }
  const interactions=[];
  if(panelId){
    const closeId=createId('form-close'),close=shape(closeId,'닫기',rawWidth-92,18,66,32,'#f2f5fa');close.component={kind:'button'};close.text.textStyle.align='center';elements.push(close);
    interactions.push({id:createId('form-close-rule'),sourceId:closeId,event:'click',actions:[{type:'closePanel',targetId:panelId}]});
    const panel=shape(panelId,'',0,0,rawWidth,rawHeight);panel.name=name+' · 입력 창';panel.component={kind:'panel',initiallyOpen:false,dim:true,placement:'center',contentIds:elements.map(element=>element.id)};elements.unshift(panel);
    const openId=createId('form-open'),open=shape(openId,name+' 열기',0,0,190,42,accent);open.geometry={x:32,y:32,width:190*scale,height:42*scale};delete open.groupId;open.component={kind:'button'};open.text.textStyle.color='#ffffff';open.text.textStyle.align='center';elements.push(open);
    interactions.push({id:createId('form-open-rule'),sourceId:openId,event:'click',actions:[{type:'openPanel',targetId:panelId}]});
  }
  const form={id:formId,name,persistence:definition.persistence,fields:normalizedFields};
  const commands=[{id:'elements.insert',params:{slideId,elements,assets:[],behaviorVariables:variables,behavior:{inputs},...(interactions.length?{interactions}:{})}},{id:'document.set_web_forms',params:{forms:[...(document.webForms||[]),form]}},...controls.map(control=>({id:'element.set_web',params:control}))];
  return {commands,form,elementIds:elements.map(element=>element.id),panelId};
}

export function buildWebFormUpdateCommands(document,formId,definition){
  const original=document.webForms?.find(form=>form.id===formId);if(!original)throw Error('수정할 입력 폼을 다시 선택하세요.');
  const name=String(definition.name||'').trim();if(!name||name.length>160)throw Error('폼 이름은 1~160자로 입력하세요.');
  if(!['none','local','session'].includes(definition.persistence))throw Error('입력값을 보관할 위치를 선택하세요.');
  if(definition.fields.length!==original.fields.length)throw Error('기존 폼의 입력 항목 수는 유지하세요. 새 입력은 별도 폼으로 만들 수 있습니다.');
  const variables=copy(document.behavior?.variables||[]);
  const fields=original.fields.map((field,index)=>{
    const draft=definition.fields[index],title=String(draft.label||'').trim(),placeholder=String(draft.placeholder||'');
    if(draft.type!==field.type||draft.key!==field.key||!title||title.length>160||placeholder.length>512)throw Error('기존 항목의 종류와 저장 키를 유지하고 이름·안내문을 확인하세요.');
    const variable=variables.find(variable=>variable.id===field.variableId);if(!variable)throw Error('입력값 변수를 찾을 수 없습니다.');
    variable.name=(name+' · '+title).slice(0,256);
    variable.initial=field.type==='checkbox'?Boolean(draft.initial):field.type==='number'?Number(draft.initial):String(draft.initial??'');
    if(field.type==='number'&&(!Number.isFinite(variable.initial)||variable.initial<(variable.minimum??-1e12)||variable.initial>(variable.maximum??1e12)))throw Error('숫자 초기값을 기존 범위 안에서 지정하세요.');
    if(field.type==='select'&&!variable.options.some(option=>option.value===variable.initial))throw Error('선택 목록의 초기값을 목록 안에서 골라 주세요.');
    if(typeof variable.initial==='string'&&variable.initial.length>4096)throw Error('초기값은 4096자 이하로 입력하세요.');
    const next={...field,label:title,required:Boolean(draft.required),...(placeholder?{placeholder}:{})};if(!placeholder)delete next.placeholder;
    if(['text','textarea','email'].includes(field.type)){next.maxLength=Number(draft.maxLength??field.maxLength??256);if(!Number.isInteger(next.maxLength)||next.maxLength<1||next.maxLength>4096||variable.initial.length>next.maxLength)throw Error('초기값을 포함하도록 최대 글자 수를 1~4096으로 지정하세요.');}
    return next;
  });
  const form={...original,name,persistence:definition.persistence,fields};
  return{form,commands:[{id:'document.set_web_forms',params:{forms:document.webForms.map(value=>value.id===formId?form:value)}},{id:'behavior.set_variables',params:{variables}}]};
}

export function createWebAuthoringUI({store,workbench,action,render,notice,updateStatus=()=>{}}){
  const page=document.createElement('section');page.id='web-authoring-tools';page.className='web-authoring-tools';
  page.innerHTML=`<p class="wb-panel-intro">입력 폼·카테고리 필터·화면 안 이동을 개체에 연결합니다.</p><details open><summary>입력 폼</summary><div class="wa-section"><button id="wa-form-open" class="wb-wide primary-button">입력 폼 만들기</button>${select('등록한 폼','wa-form-select',[])}<button id="wa-form-edit" class="wb-wide">폼 설정</button><div id="wa-form-list" class="property-help"></div></div></details><details id="wa-selected-details" open><summary>선택 개체의 웹 동작</summary><div class="wa-section"><p id="wa-selection" class="property-help"></p>${select('클릭하거나 표시할 동작','wa-control-kind',[['none','연결 없음'],['filterButton','카테고리 선택 버튼'],['filterItem','필터할 카드·개체'],['scrollLink','이 개체가 있는 곳으로 이동'],['emailLink','입력한 이메일로 연결'],['formAction','입력 폼 저장·내보내기']])}<div data-wa-control="filterButton filterItem">${label('필터 묶음 이름','wa-control-group','<input id="wa-control-group" maxlength="80" placeholder="예: projects">')}<label id="wa-filter-all-label" class="wb-check"><input id="wa-filter-all" type="checkbox" checked>전체 카테고리 표시</label>${label('카테고리','wa-control-value','<input id="wa-control-value" maxlength="160" placeholder="예: 개발 또는 디자인">')}</div><div data-wa-control="scrollLink">${select('이동할 개체','wa-control-target',[])}</div><div data-wa-control="emailLink formAction">${select('입력 폼','wa-control-form',[])}</div><div data-wa-control="emailLink">${select('이메일 입력','wa-control-email',[])}</div><div data-wa-control="formAction">${select('실행할 일','wa-control-action',[['save','브라우저에 저장'],['export','JSON 내보내기'],['reset','초기값으로 되돌리기']])}</div><div data-wa-control="emailLink formAction">${select('저장 후 닫기 / 이메일이 비었을 때 열기','wa-control-panel',[['','패널 연결 없음']])}</div><button id="wa-control-apply" class="wb-wide">웹 동작 적용</button></div></details><details><summary>입력값을 텍스트에 표시</summary><div class="wa-section">${select('표시할 입력값','wa-bind-field',[['','연결 해제']])}<button id="wa-bind-apply" class="wb-wide">선택한 텍스트에 연결</button><p class="property-help">발표에서 입력값이 바뀌면 같은 텍스트의 내용도 바뀝니다.</p></div></details><button id="wa-cancel" class="wb-wide" hidden>웹 설정 변경 취소</button>`;
  workbench.addInspectorPage('webtools','웹 요소',page);
  const dialog=document.createElement('dialog');dialog.id='wa-form-dialog';dialog.className='wa-form-dialog';dialog.setAttribute('aria-labelledby','wa-form-heading');
  dialog.innerHTML=`<header><div><h2 id="wa-form-heading">입력 폼 만들기</h2><p>필드를 고르면 개체와 입력값·저장 버튼을 함께 만듭니다.</p></div><button id="wa-form-close">닫기</button></header><div class="wa-form-body"><div class="wa-form-options">${label('폼 이름','wa-form-name','<input id="wa-form-name" maxlength="160" value="프로필">')}${select('입력값 보관','wa-form-persistence',[['local','이 브라우저에 보관'],['session','탭이 열려 있는 동안'],['none','재생하는 동안만']])}<label class="wa-check"><input id="wa-form-modal" type="checkbox" checked>버튼으로 여는 입력 창</label></div><div id="wa-form-fields"></div><button id="wa-field-add">입력 항목 추가</button><p class="property-help">발표 중 입력한 값은 작성 문서와 별도로 보관합니다. 이메일 연결과 카드의 표시 내용은 폼을 만든 뒤 개체를 선택해 연결하세요.</p><p id="wa-form-error" role="alert"></p></div><footer><button id="wa-form-cancel">취소</button><button id="wa-form-apply" class="primary-button">폼 추가</button></footer>`;document.body.append(dialog);
  const $=id=>document.getElementById(id),fieldsRoot=$('wa-form-fields');let owner=null,returnFocus=null,rows=[],pending=false,context=null,syncing=false,applying=false,editId=null,session=store.sessionId,selected=store.selectedId,slideId=store.activeSlideId;
  const sameOwner=()=>owner&&owner.session===store.sessionId&&owner.revision===store.revision&&owner.slide===store.activeSlideId;
  const editable=()=>{const selected=store.selectedElements;if(selected.length===1)return selected[0].locked||selected[0].hidden?null:selected[0];if(selected.length>1&&selected[0].groupId&&selected.every(element=>element.groupId===selected[0].groupId))return selected.find(element=>!element.locked&&!element.hidden&&(element.component?.kind==='panel'||element.flow))||selected.find(element=>!element.locked&&!element.hidden&&element.type==='shape')||selected.find(element=>!element.locked&&!element.hidden)||null;return null;};
  const named=element=>element.name||element.text?.paragraphs.find(Boolean)||element.type;
  function choices(id,values){const field=$(id),prior=field.value;field.innerHTML=values.map(([value,title])=>option(value,title)).join('');if(values.some(([value])=>value===prior))field.value=prior;}
  function message(text,error=false){notice(text,error);updateStatus();}
  function close(restore=true){if(applying)return;dialog.close();owner=null;editId=null;rows=[];fieldsRoot.replaceChildren();if(restore&&returnFocus?.isConnected)returnFocus.focus();updateStatus();}
  function paintRows(){fieldsRoot.innerHTML=rows.map((field,index)=>`<section class="wa-field" data-wa-field="${index}"><div class="wa-field-heading"><strong>항목 ${index+1}</strong><button type="button" data-wa-remove="${index}" aria-label="항목 ${index+1} 삭제">삭제</button></div><div class="wa-field-grid"><label>이름<input data-wa-key="label" maxlength="160" value="${escape(field.label)}"></label><label>입력 종류<select data-wa-key="type">${Object.entries(types).map(([value,title])=>`<option value="${value}"${field.type===value?' selected':''}>${title}</option>`).join('')}</select></label><label>초기값<input data-wa-key="initial"${field.type==='checkbox'?' type="checkbox"'+(field.initial?' checked':''):field.type==='number'?' type="number" step="any"':' type="text" maxlength="4096"'}${field.type==='checkbox'?'':` value="${escape(field.initial??'')}"`}></label><label>입력 안내<input data-wa-key="placeholder" maxlength="512" value="${escape(field.placeholder||'')}"></label><label${['text','textarea','email'].includes(field.type)?'':' hidden'}>최대 글자 수<input data-wa-key="maxLength" type="number" min="1" max="4096" value="${field.maxLength||256}"></label><label${field.type==='select'?'':' hidden'}>선택 항목 · 쉼표로 구분<input data-wa-key="options" maxlength="4096" value="${escape(field.options||'선택 1, 선택 2')}"></label><label class="wa-check"><input data-wa-key="required" type="checkbox"${field.required?' checked':''}>필수 입력</label></div></section>`).join('');$('wa-field-add').disabled=rows.length>=12;$('wa-field-add').hidden=Boolean(editId);if(editId)for(const field of fieldsRoot.querySelectorAll('[data-wa-remove],[data-wa-key=type],[data-wa-key=options]'))field.disabled=true;}
  async function open(requested=null){
    if(dialog.open)return;if(document.querySelector('dialog[open]')){message('현재 편집 창을 먼저 마치세요.');return;}
    await action(()=>{
      returnFocus=document.activeElement;owner={session:store.sessionId,revision:store.revision,slide:store.activeSlideId};
      const original=typeof requested==='string'?store.document.webForms?.find(form=>form.id===requested):null;editId=original?.id||null;
      rows=original?original.fields.map(field=>{const variable=store.document.behavior.variables.find(variable=>variable.id===field.variableId);return{...copy(field),initial:variable.initial,options:variable.options?.map(option=>option.value).join(', ')||''};}):[{key:'name',label:'이름',type:'text',required:true,initial:'',maxLength:120},{key:'role',label:'역할',type:'text',initial:'',maxLength:160},{key:'email',label:'이메일',type:'email',initial:'',maxLength:256},{key:'bio',label:'소개',type:'textarea',initial:'',maxLength:2048}];
      $('wa-form-heading').textContent=original?'입력 폼 설정':'입력 폼 만들기';$('wa-form-apply').textContent=original?'설정 반영':'폼 추가';
      $('wa-form-name').value=original?.name||'프로필';$('wa-form-persistence').value=original?.persistence||'local';$('wa-form-modal').checked=true;$('wa-form-modal').closest('label').hidden=Boolean(original);
      $('wa-form-error').textContent='';paintRows();dialog.showModal();$('wa-form-name').focus();updateStatus();
    });
  }

  async function addForm(){
    if(applying)return;if(!sameOwner()){$('wa-form-error').textContent='자료가 바뀌었습니다. 창을 닫고 다시 만드세요.';return;}
    try{
      const definition={name:$('wa-form-name').value,persistence:$('wa-form-persistence').value,modal:$('wa-form-modal').checked,fields:rows},editing=Boolean(editId);
      const prepared=editing?buildWebFormUpdateCommands(store.document,editId,definition):buildWebFormCommands(store.document,owner.slide,definition),captured={...owner};applying=true;
      await action(()=>{if(captured.session!==store.sessionId||captured.revision!==store.revision||captured.slide!==store.activeSlideId)throw Error('자료가 바뀌어 입력 폼을 반영하지 않았습니다.');store.runBatch(prepared.commands,editing?'입력 폼 설정':'입력 폼 만들기');if(!editing)store.selectElements(prepared.panelId?[prepared.panelId]:[prepared.elementIds[0]],{expandGroups:false});});
      applying=false;close(false);render();message(editing?'입력 폼 설정을 반영했습니다. 한 번 실행 취소로 되돌릴 수 있습니다.':'입력 폼과 저장 버튼을 추가했습니다. 한 번 실행 취소로 되돌릴 수 있습니다.');
    }catch(error){applying=false;$('wa-form-error').textContent=error.message;}finally{updateStatus();}
  }

  function sections(){const kind=$('wa-control-kind').value;for(const element of page.querySelectorAll('[data-wa-control]'))element.hidden=!element.dataset.waControl.split(' ').includes(kind);$('wa-filter-all-label').hidden=kind!=='filterButton';$('wa-control-value').closest('label').hidden=kind==='filterButton'&&$('wa-filter-all').checked;const panelLabel=$('wa-control-panel').closest('label');panelLabel.childNodes[0].textContent=kind==='emailLink'?'이메일이 비었을 때 열 입력 창':'저장 후 닫을 입력 창';panelLabel.hidden=kind==='formAction'&&$('wa-control-action').value!=='save';emailChoices();}
  function emailChoices(){const form=store.document.webForms?.find(form=>form.id===$('wa-control-form').value);choices('wa-control-email',(form?.fields||[]).filter(field=>field.type==='email').map(field=>[field.variableId,field.label]));}
  function mark(){if(syncing)return;pending=true;context={session:store.sessionId,slide:store.activeSlideId,element:editable()?.id};$('wa-cancel').hidden=false;updateStatus();}
  function control(){const kind=$('wa-control-kind').value;if(kind==='none')return null;if(['filterButton','filterItem'].includes(kind))return{kind,group:$('wa-control-group').value.trim(),value:kind==='filterButton'&&$('wa-filter-all').checked?'all':$('wa-control-value').value.trim()};if(kind==='scrollLink')return{kind,targetId:$('wa-control-target').value};const formId=$('wa-control-form').value,panel=$('wa-control-panel').value;if(kind==='emailLink')return{kind,formId,variableId:$('wa-control-email').value,...(panel?{emptyPanelId:panel}:{})};return{kind:'formAction',formId,action:$('wa-control-action').value,...(panel&&$('wa-control-action').value==='save'?{closePanelId:panel}:{})};}
  function commitPending(){if(!pending)return;const target=editable();if(!context||context.session!==store.sessionId||context.slide!==store.activeSlideId||context.element!==target?.id)throw Error('선택이 바뀌었습니다. 웹 설정을 취소하고 다시 선택하세요.');store.run('element.set_web',{elementId:target.id,web:control()});pending=false;context=null;$('wa-cancel').hidden=true;}
  function cancelPending(){pending=false;context=null;$('wa-cancel').hidden=true;sync(true);updateStatus();}
  async function applyControl(){try{await action(commitPending);sync(true);message('선택한 개체의 웹 동작을 반영했습니다.');}catch(error){message(error.message,true);}}
  async function applyBinding(){const target=editable();if(store.selectedIds.length!==1||!target?.text){message('값을 표시할 텍스트 개체 하나를 선택하세요.');return;}const captured={session:store.sessionId,slide:store.activeSlideId,id:target.id},variableId=$('wa-bind-field').value;try{await action(()=>{if(captured.session!==store.sessionId||captured.slide!==store.activeSlideId)throw Error('자료가 바뀌었습니다.');const bindings=copy(store.activeSlide.behavior?.bindings||[]),prior=bindings.find(binding=>binding.targetId===captured.id),next=bindings.filter(binding=>binding.targetId!==captured.id);if(variableId)next.push({id:prior?.id||fresh('form-binding'),targetId:captured.id,expression:{type:'variable',id:variableId},format:store.document.behavior?.variables.find(variable=>variable.id===variableId)?.type==='number'?'number':'text'});store.run('behavior.set_bindings',{slideId:captured.slide,bindings:next});});message(variableId?'텍스트를 입력값에 연결했습니다.':'텍스트의 입력값 연결을 해제했습니다.');}catch(error){message(error.message,true);}}
  $('wa-form-open').onclick=()=>open();$('wa-form-edit').onclick=()=>open($('wa-form-select').value);$('wa-form-apply').onclick=addForm;$('wa-form-close').onclick=$('wa-form-cancel').onclick=()=>close();$('wa-field-add').onclick=()=>{if(rows.length>=12)return;let n=rows.length+1;while(rows.some(row=>row.key==='field'+n))n++;rows.push({key:'field'+n,label:'입력 '+n,type:'text',initial:'',maxLength:256});paintRows();};
  fieldsRoot.addEventListener('input',event=>{const key=event.target.dataset.waKey,index=Number(event.target.closest('[data-wa-field]')?.dataset.waField);if(!key||!rows[index])return;rows[index][key]=event.target.type==='checkbox'?event.target.checked:event.target.value;});
  fieldsRoot.addEventListener('change',event=>{if(event.target.dataset.waKey!=='type')return;const row=rows[Number(event.target.closest('[data-wa-field]').dataset.waField)];row.type=event.target.value;row.initial=row.type==='number'?0:row.type==='checkbox'?false:'';if(row.type==='textarea')row.maxLength=2048;paintRows();});
  fieldsRoot.addEventListener('click',event=>{const button=event.target.closest('[data-wa-remove]');if(!button)return;if(rows.length===1){$('wa-form-error').textContent='입력 항목을 하나 이상 남기세요.';return;}rows.splice(Number(button.dataset.waRemove),1);paintRows();});
  dialog.addEventListener('cancel',event=>{event.preventDefault();if(!event.isComposing)close();});dialog.addEventListener('keydown',event=>event.stopPropagation());
  for(const field of page.querySelectorAll('#wa-selected-details input,#wa-selected-details select'))field.addEventListener('input',mark);$('wa-control-kind').addEventListener('change',sections);$('wa-filter-all').addEventListener('change',sections);$('wa-control-action').addEventListener('change',sections);$('wa-control-form').addEventListener('change',emailChoices);$('wa-control-apply').onclick=applyControl;$('wa-bind-apply').onclick=applyBinding;$('wa-cancel').onclick=cancelPending;
  function sync(force=false){if(syncing)return;syncing=true;try{if(dialog.open&&!sameOwner()){$('wa-form-error').textContent='자료가 바뀌었습니다. 창을 닫고 다시 만드세요.';$('wa-form-apply').disabled=true;}else $('wa-form-apply').disabled=applying;const changed=session!==store.sessionId||selected!==store.selectedId||slideId!==store.activeSlideId;session=store.sessionId;selected=store.selectedId;slideId=store.activeSlideId;if(changed){pending=false;context=null;$('wa-cancel').hidden=true;}const forms=store.document.webForms||[];choices('wa-form-select',forms.map(form=>[form.id,form.name]));$('wa-form-edit').disabled=!forms.length;$('wa-form-list').textContent=forms.length?forms.map(form=>form.name+' · '+form.fields.length+'개 입력').join('\n'):'입력 폼을 만들고 텍스트·버튼에 값을 연결하세요.';const target=editable();$('wa-selection').textContent=target?named(target)+(store.selectedIds.length>1?' · 그룹 전체':''):'웹 동작을 연결할 개체 하나를 선택하세요.';for(const field of page.querySelectorAll('#wa-selected-details input,#wa-selected-details select,#wa-selected-details button'))field.disabled=!target;$('wa-bind-apply').disabled=store.selectedIds.length!==1||!target?.text;if(pending&&!force)return;
    choices('wa-control-target',store.activeSlide.elements.filter(element=>element.id!==target?.id).map(element=>[element.id,named(element)]));choices('wa-control-form',forms.map(form=>[form.id,form.name]));choices('wa-control-panel',[['','패널 연결 없음'],...store.activeSlide.elements.filter(element=>element.component?.kind==='panel').map(element=>[element.id,named(element)])]);choices('wa-bind-field',[['','연결 해제'],...forms.flatMap(form=>form.fields.map(field=>[field.variableId,form.name+' · '+field.label]))]);
    const web=target?.web;$('wa-control-kind').value=web?.kind||'none';$('wa-control-group').value=web?.group||'projects';$('wa-filter-all').checked=!web||web.kind==='filterButton'&&web.value==='all';$('wa-control-value').value=web?.value&&web.value!=='all'?web.value:'';if(web?.targetId)$('wa-control-target').value=web.targetId;if(web?.formId)$('wa-control-form').value=web.formId;if(web?.action)$('wa-control-action').value=web.action;$('wa-control-panel').value=web?.closePanelId||web?.emptyPanelId||'';sections();if(web?.variableId)$('wa-control-email').value=web.variableId;const binding=store.activeSlide.behavior?.bindings?.find(binding=>binding.targetId===target?.id);$('wa-bind-field').value=binding?.expression.type==='variable'?binding.expression.id:'';
  }finally{syncing=false;}}
  sync();return{page,show(){workbench.showTab('webtools');sync();},openForm:open,sync,commitPending,cancelPending,get busy(){return dialog.open||applying||page.contains(document.activeElement)&&document.activeElement.matches('input,select,textarea');},get modalActive(){return dialog.open;},get pendingChanges(){return pending;},draftSignature(){return pending||dialog.open?JSON.stringify({session,slideId,selected,pending,rows,formDialog:dialog.open?[$('wa-form-name').value,$('wa-form-persistence').value,$('wa-form-modal').checked]:null,form:[...page.querySelectorAll('input,select')].map(field=>[field.id,field.value])}):null;}};
}
