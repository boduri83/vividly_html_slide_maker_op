import fs from 'node:fs/promises';
import path from 'node:path';
import {atomicWriteDocument} from './files.mjs';
export const MAX_PROGRESS_BYTES=2*1024*1024;

/** Dialog-selected progress files are separate from editable HTML document authority. */
export class DesktopProgressService {
  constructor({dialog,getWindow=()=>undefined,withDialog=operation=>operation(),io=fs,write=atomicWriteDocument}={}){
    if(!dialog)throw new TypeError('진행 파일 선택창이 필요합니다.');
    Object.assign(this,{dialog,getWindow,withDialog,io,write});this.pending=0;
  }
  get busy(){return this.pending>0;}
  encode(value){
    if(!value||typeof value!=='object'||Array.isArray(value))throw Error('진행 데이터가 올바르지 않습니다.');
    const text=JSON.stringify(value,null,2)+'\n';
    if(Buffer.byteLength(text,'utf8')>MAX_PROGRESS_BYTES)throw Error('진행 파일은2MB 이하여야 합니다.');
    return text;
  }
  async save(value){
    const text=this.encode(value);this.pending++;
    try{return await this.withDialog(async()=>{
      const result=await this.dialog.showSaveDialog(this.getWindow(),{title:'실행 진행 저장',defaultPath:'Vividly-progress.json',filters:[{name:'Vividly 실행 진행',extensions:['json']}]});
      if(result.canceled||!result.filePath)return{canceled:true};
      const destination=path.resolve(result.filePath);if(path.extname(destination).toLowerCase()!=='.json')throw Error('진행은.json 파일로 저장하세요.');
      await this.write(destination,text);return{canceled:false,fileName:path.basename(destination)};
    });}finally{this.pending--;}
  }
  async open(){
    this.pending++;try{return await this.withDialog(async()=>{
      const result=await this.dialog.showOpenDialog(this.getWindow(),{title:'실행 진행 불러오기',properties:['openFile'],filters:[{name:'Vividly 실행 진행',extensions:['json']}]});
      if(result.canceled||!result.filePaths?.length)return{canceled:true};
      const source=path.resolve(result.filePaths[0]);if(path.extname(source).toLowerCase()!=='.json')throw Error('진행.json 파일을 선택하세요.');
      const handle=await this.io.open(source,'r');let text;
      try{const stat=await handle.stat();if(!stat.isFile()||stat.size<2||stat.size>MAX_PROGRESS_BYTES)throw Error('진행 파일은2MB 이하여야 합니다.');const buffer=Buffer.alloc(MAX_PROGRESS_BYTES+1);let total=0;for(;;){const{bytesRead}=await handle.read(buffer,total,buffer.length-total,total);total+=bytesRead;if(total>MAX_PROGRESS_BYTES)throw Error('진행 파일은2MB 이하여야 합니다.');if(!bytesRead)break;}try{text=new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,total));}catch{throw Error('진행 파일은UTF-8 JSON이어야 합니다.');}}finally{await handle.close();}
      let progress;try{progress=JSON.parse(text);}catch{throw Error('진행 파일의JSON 형식이 올바르지 않습니다.');}this.encode(progress);
      return{canceled:false,fileName:path.basename(source),progress};
    });}finally{this.pending--;}
  }
}
