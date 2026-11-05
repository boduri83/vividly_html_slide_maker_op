import path from 'node:path';
import {atomicWriteDocument} from './files.mjs';

export const MAX_FORM_DATA_BYTES=512*1024;
/** Runtime answers are exported through a dialog; they never adopt the editable HTML target. */
export class DesktopFormDataService{
  constructor({dialog,getWindow=()=>undefined,withDialog=operation=>operation(),write=atomicWriteDocument}={}){if(!dialog)throw TypeError('입력 내용 저장창이 필요합니다.');Object.assign(this,{dialog,getWindow,withDialog,write});}
  encode(input){
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['name','values'].includes(key))||typeof input.name!=='string'||input.name.length>160)throw TypeError('입력 내용의 이름과 값이 필요합니다.');
    const values=input.values;if(!values||typeof values!=='object'||Array.isArray(values)||![Object.prototype,null].includes(Object.getPrototypeOf(values)))throw TypeError('폼의 필드 값이 필요합니다.');
    const entries=Object.entries(values);if(!entries.length||entries.length>32)throw TypeError('입력 항목은 1~32개입니다.');
    for(const[key,value]of entries)if(!/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(key)||!['string','number','boolean'].includes(typeof value)||typeof value==='string'&&value.length>4096||typeof value==='number'&&!Number.isFinite(value))throw TypeError('입력 항목의 키·값·길이를 확인하세요.');
    const text=JSON.stringify(Object.fromEntries(entries),null,2)+'\n';if(Buffer.byteLength(text,'utf8')>MAX_FORM_DATA_BYTES)throw TypeError('입력 내용은 512KiB 이하여야 합니다.');
    const stem=input.name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/g,'').trim().slice(0,120)||'입력-내용';
    return{text,fileName:(/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)?'_':'')+stem+'.json'};
  }
  async save(input){const encoded=this.encode(input);return this.withDialog(async()=>{
    const selected=await this.dialog.showSaveDialog(this.getWindow(),{title:'입력 내용 JSON 내보내기',defaultPath:encoded.fileName,filters:[{name:'JSON 입력 내용',extensions:['json']}]});
    if(selected.canceled||!selected.filePath)return{canceled:true};
    const destination=path.resolve(selected.filePath);if(path.extname(destination).toLowerCase()!=='.json')throw Error('입력 내용은 .json 파일로 저장하세요.');
    await this.write(destination,encoded.text);return{canceled:false,fileName:path.basename(destination)};
  });}
}
