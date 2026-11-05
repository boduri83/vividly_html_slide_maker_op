/** Pure, bounded semantic closure for approved document reuse. Author initials only. */
import {compositeIds} from './component-library-model.js';

const fail=message=>{throw Object.assign(Error(message),{code:'INVALID_LIBRARY_IMPORT'});};
const collections={masters:'layoutMasters',layouts:'layouts',components:'componentLibrary',slides:'slides',forms:'webForms',recipes:'styleRecipes',assets:'assets',clips:'motionClips',variables:'variables'};
const names={masters:'공통 마스터',layouts:'페이지 유형',components:'컴포넌트',slides:'연결 페이지',forms:'폼 설정',recipes:'스타일',assets:'자산',clips:'모션 씬',variables:'변수',behaviorVariables:'입력 변수'};

export function collectReuseDependencies(source,selection={}){
  const rows={...Object.fromEntries(Object.entries(collections).map(([key,field])=>[key,source[field]||[]])),behaviorVariables:source.behavior?.variables||[]};
  const indexes=Object.fromEntries(Object.entries(rows).map(([key,values])=>[key,new Map(values.map(row=>[row.id,row]))]));
  const required=Object.fromEntries(Object.keys(rows).map(key=>[key,new Set()])),queue=[],reasons={slides:new Map(),forms:new Map()};
  const owners=new Map(source.slides.flatMap(slide=>slide.elements.map(element=>[element.id,slide.id])));
  const explicit={masters:'masterIds',layouts:'layoutIds',components:'componentIds',slides:'slideIds',forms:'formIds',recipes:'recipeIds',assets:'assetIds'};
  function add(kind,id,reason){
    if(!indexes[kind].has(id))fail(names[kind]+'에 필요한 원본 항목이 없습니다: '+id);
    if(reasons[kind]&&!reasons[kind].has(id))reasons[kind].set(id,reason);
    if(!required[kind].has(id)){required[kind].add(id);queue.push([kind,id]);}
  }
  for(const[kind,key]of Object.entries(explicit)){
    const ids=selection[key]||[];
    if(!Array.isArray(ids)||ids.length>1000||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'))fail('가져올 항목을 원본 목록에서 선택하세요: '+key);
    for(const id of ids)add(kind,id,'직접 선택한 '+names[kind]);
  }
  // An explicitly selected master includes its family; a required parent does not.
  for(const layout of rows.layouts)if((selection.masterIds||[]).includes(layout.masterId))add('layouts',layout.id,'선택한 공통 마스터의 페이지 유형');
  function variable(id,reason){add(indexes.behaviorVariables.has(id)?'behaviorVariables':'variables',id,reason);}
  function scan(value,local,ownerName){
    if(!value||typeof value!=='object')return;
    if(value.type==='variable'&&typeof value.id==='string')variable(value.id,ownerName+'의 계산/입력 연결');
    if(value.type==='goToSlide')add('slides',value.targetId,ownerName+'에서 이동하는 페이지');
    if(value.type==='navigate')add('slides',value.slideId,ownerName+'의 동작으로 이동하는 페이지');
    if(value.kind==='scrollLink'&&!local.has(value.targetId)){
      const owner=owners.get(value.targetId);if(!owner)fail('구간 이동의 원본 개체를 찾을 수 없습니다.');
      add('slides',owner,ownerName+'에서 구간 이동하는 페이지');
    }
    for(const[key,item]of Object.entries(value)){
      if(typeof item==='string'){
        if(key==='formId')add('forms',item,ownerName+'의 폼 동작');
        if(key==='variableId')variable(item,ownerName+'의 입력/데이터 연결');
        if(key==='assetId'||key==='posterAssetId')add('assets',item,ownerName+'의 자산');
        if(key==='recipeId')add('recipes',item,ownerName+'의 스타일');
        if(key==='layoutId')add('layouts',item,ownerName+'의 페이지 유형');
        if(key==='masterId')add('masters',item,ownerName+'의 공통 마스터');
        if(key==='componentId')add('components',item,ownerName+'의 컴포넌트 원본');
        if(key==='clipId'&&!local.has(item)&&indexes.clips.has(item))add('clips',item,ownerName+'의 모션 씬');
        if(['closePanelId','emptyPanelId'].includes(key)&&!local.has(item)){
          const owner=owners.get(item);if(!owner)fail('폼 동작의 원본 패널을 찾을 수 없습니다.');
          add('slides',owner,ownerName+'의 연결 패널이 있는 페이지');
        }
      }else if(item&&typeof item==='object')scan(item,local,ownerName);
    }
  }
  for(let cursor=0;cursor<queue.length;cursor++){
    const[kind,id]=queue[cursor],row=indexes[kind].get(id),name=row.name||names[kind];
    if(kind==='forms')for(const field of row.fields)variable(field.variableId,name+'의 전체 필드');
    else if(kind==='behaviorVariables'){
      // Input presentation/validation is defined by its form even without a save button.
      for(const form of rows.forms)if(form.fields.some(field=>field.variableId===id))add('forms',form.id,name+'에 연결된 폼 설정');
    }else if(['masters','layouts','components','slides'].includes(kind))scan(row,compositeIds(row),name);
    if(required.slides.size>1000||required.forms.size>32)fail('연결된 페이지/폼 수가 문서의 가져오기 한도를 넘습니다.');
  }
  return{required,requiredItems:Object.fromEntries(['slides','forms'].map(kind=>[kind,rows[kind].filter(row=>required[kind].has(row.id)).map(row=>({id:row.id,name:row.name||names[kind],reason:reasons[kind].get(row.id)}))]))};
}
