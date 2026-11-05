/** Dedicated owned stdio app-server transport. No auth-file reads or shared application daemon. */
import fs from'node:fs/promises';import path from'node:path';import{spawn}from'node:child_process';import{StringDecoder}from'node:string_decoder';
import{AvatarError}from'./avatar-provider.mjs';
import{sanitizeCodexEnvironment}from'./codex-environment.mjs';
export const CODEX_CLIENT_LIMITS=Object.freeze({lineBytes:4*1024*1024,writeBytes:1024*1024,requestMs:20000,shutdownMs:2000});
const error=(code,message)=>new AvatarError(code,message);
export async function findCodexCommand({env=process.env,platform=process.platform,io=fs}={}){
 const pathValue=Object.entries(env).find(([key])=>key.toLowerCase()==='path')?.[1]||'',names=platform==='win32'?['codex.exe']:['codex'],candidates=[];
 if(platform==='win32'&&env.APPDATA)candidates.push(path.join(env.APPDATA,'npm/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe'));
 for(const directory of pathValue.split(path.delimiter).filter(Boolean))for(const name of names)candidates.push(path.join(directory,name));
 if(platform==='win32'&&env.APPDATA)candidates.push(path.join(env.APPDATA,'npm/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe'));
 if(platform==='win32'&&env.LOCALAPPDATA){const directory=path.join(env.LOCALAPPDATA,'OpenAI/Codex/bin');try{const entries=await io.readdir(directory,{withFileTypes:true});for(const entry of entries.filter(item=>item.isDirectory()))candidates.push(path.join(directory,entry.name,'codex.exe'));}catch{}}
 for(const candidate of[...new Set(candidates)])try{if((await io.stat(candidate)).isFile())return candidate;}catch{}
 throw error('CODEX_NOT_INSTALLED','설치된 Codex 실행 파일을 찾지 못했습니다. Codex를 설치하고 로그인한 뒤 다시 확인하세요.');
}
export function readCodexVersion({command,cwd,env=process.env,spawnImpl=spawn,signal}={}){
 if(signal?.aborted)return Promise.reject(error('CANCELLED','Codex 버전 확인을 중단했습니다.'));
 return new Promise((resolve,reject)=>{let child,text='',settled=false,requestedError=null,terminationTimer;const complete=(failure,value)=>{if(settled)return;settled=true;clearTimeout(timer);clearTimeout(terminationTimer);signal?.removeEventListener('abort',abort);failure?reject(failure):resolve(value);},stop=failure=>{if(settled)return;requestedError=requestedError||failure;if(!child){complete(requestedError);return;}try{child.kill();}catch{}if(!terminationTimer)terminationTimer=setTimeout(()=>complete(error('CODEX_SHUTDOWN','Codex 버전 확인 프로세스의 종료를 확인하지 못했습니다.')),CODEX_CLIENT_LIMITS.shutdownMs);},abort=()=>stop(error('CANCELLED','Codex 버전 확인을 중단했습니다.')),timer=setTimeout(()=>stop(error('CODEX_TIMEOUT','Codex 버전을 확인하지 못했습니다.')),10000);
  try{child=spawnImpl(command,['--version'],{cwd,env:sanitizeCodexEnvironment(env),windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});}catch{complete(error('CODEX_START_FAILED','Codex 버전을 확인하지 못했습니다.'));return;}
  signal?.addEventListener('abort',abort,{once:true});child.stdout.on('data',chunk=>{text+=chunk.toString('utf8');if(Buffer.byteLength(text)>2048)stop(error('CODEX_PROTOCOL','Codex 버전 응답이 올바르지 않습니다.'));});child.stderr.on('data',()=>{});for(const stream of[child.stdout,child.stderr])stream.on('error',()=>stop(error('CODEX_TRANSPORT','Codex 버전 연결이 종료됐습니다.')));child.on('error',()=>stop(error('CODEX_START_FAILED','Codex 버전을 확인하지 못했습니다.')));child.on('close',code=>{if(requestedError){complete(requestedError);return;}const match=/^codex-cli ([0-9][0-9A-Za-z.+-]*)$/.exec(text.trim());if(code!==0||!match)complete(error('CODEX_PROTOCOL','Codex CLI 버전을 확인하지 못했습니다.'));else complete(null,match[1]);});
 });
}
export class CodexClient{
 constructor({command,cwd,args=['app-server','--listen','stdio://'],env=process.env,spawnImpl=spawn,requestMs=CODEX_CLIENT_LIMITS.requestMs,onNotification=()=>{},onRequest=()=>{}}={}){
  if(typeof command!=='string'||!path.isAbsolute(command)||typeof cwd!=='string'||!path.isAbsolute(cwd)||!Array.isArray(args)||args.some(item=>typeof item!=='string'))throw TypeError('Absolute owned Codex command/cwd required');
  this.command=command;this.cwd=cwd;this.args=args;this.env=sanitizeCodexEnvironment(env);
  this.spawnImpl=spawnImpl;this.requestMs=requestMs;this.onNotification=onNotification;this.onRequest=onRequest;this.pending=new Map();this.serverRequests=new Set();this.nextId=0;this.buffer='';this.decoder=new StringDecoder('utf8');this.child=null;this.closed=false;this.starting=null;this.closing=null;this.fatal=null;
 }
 start(){
  if(this.starting)return this.starting;if(this.closed)return Promise.reject(error('CODEX_CLOSED','Codex 연결이 종료됐습니다.'));if(this.child)return Promise.resolve();this.starting=(async()=>{await fs.mkdir(this.cwd,{recursive:true});if(this.closed)throw error('CODEX_CLOSED','Codex 연결이 종료됐습니다.');
  let child;try{child=this.spawnImpl(this.command,this.args,{cwd:this.cwd,env:this.env,windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});}catch{throw error('CODEX_START_FAILED','Codex app-server를 시작하지 못했습니다.');}
  this.child=child;const streamFailure=()=>{this.fail(error('CODEX_TRANSPORT','Codex 입출력 연결이 종료됐습니다.'));void this.close();};for(const stream of[child.stdin,child.stdout,child.stderr])stream?.on('error',streamFailure);child.stderr?.on('data',()=>{});child.stdout.on('data',bytes=>this.read(bytes));child.on('error',()=>this.fail(error('CODEX_START_FAILED','Codex app-server를 시작하지 못했습니다.')));child.on('exit',()=>{this.closed=true;this.fail(error('CODEX_EXITED','Codex 연결이 종료됐습니다. 다시 요청하세요.'));});
  })();return this.starting;
 }
 fail(failure){if(!this.fatal)this.fatal=failure;for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(this.fatal);}this.pending.clear();try{this.onNotification({method:'vividly/connectionError',params:{code:this.fatal.code,message:this.fatal.message}});}catch{}}
 read(bytes){
  if(this.closed)return;this.buffer+=this.decoder.write(bytes);if(Buffer.byteLength(this.buffer)>CODEX_CLIENT_LIMITS.lineBytes){this.fail(error('CODEX_PROTOCOL_LIMIT','Codex 응답이 허용 크기를 넘었습니다.'));void this.close();return;}
  let at;while((at=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,at);this.buffer=this.buffer.slice(at+1);if(!line.trim())continue;let message;try{message=JSON.parse(line);}catch{this.fail(error('CODEX_PROTOCOL','Codex 응답 형식이 올바르지 않습니다.'));void this.close();return;}
   if(!message||typeof message!=='object'||Array.isArray(message)){this.fail(error('CODEX_PROTOCOL','Codex 응답 형식이 올바르지 않습니다.'));void this.close();return;}
   if(typeof message.method==='string'){
    if(Object.hasOwn(message,'id')){if(!['string','number'].includes(typeof message.id)||this.serverRequests.has(JSON.stringify(message.id))){this.fail(error('CODEX_PROTOCOL','Codex 도구 요청 ID가 중복되거나 잘못됐습니다.'));void this.close();return;}this.serverRequests.add(JSON.stringify(message.id));try{this.onRequest(message);}catch{this.fail(error('CODEX_PROTOCOL','Codex 도구 요청을 처리하지 못했습니다.'));void this.close();}}
    else try{this.onNotification(message);}catch{this.fail(error('CODEX_PROTOCOL','Codex 알림을 처리하지 못했습니다.'));void this.close();}
   }else if(Object.hasOwn(message,'id')){const pending=this.pending.get(message.id);if(!pending)continue;this.pending.delete(message.id);clearTimeout(pending.timer);if(message.error)pending.reject(error('CODEX_RPC_ERROR','Codex가 '+pending.method+' 요청을 완료하지 못했습니다.'));else if(Object.hasOwn(message,'result'))pending.resolve(message.result);else pending.reject(error('CODEX_PROTOCOL','Codex 응답에 결과가 없습니다.'));}
  }
 }
 write(message){if(this.closed||this.fatal)throw this.fatal||error('CODEX_CLOSED','Codex 연결이 종료됐습니다.');const text=JSON.stringify(message)+'\n';if(Buffer.byteLength(text)>CODEX_CLIENT_LIMITS.writeBytes)throw error('CONTEXT_LIMIT','Codex 요청이 너무 큽니다. 범위를 줄이세요.');try{this.child.stdin.write(text,failure=>{if(failure){this.fail(error('CODEX_TRANSPORT','Codex에 요청을 전달하지 못했습니다.'));void this.close();}});}catch{throw error('CODEX_TRANSPORT','Codex에 요청을 전달하지 못했습니다.');}}
 async request(method,params={},options={}){
  await this.start();if(this.fatal)throw this.fatal;if(options.signal?.aborted)throw error('CANCELLED','요청을 중단했습니다.');
  const id=++this.nextId;return new Promise((resolve,reject)=>{const abort=()=>{const pending=this.pending.get(id);if(!pending)return;this.pending.delete(id);clearTimeout(pending.timer);reject(error('CANCELLED','요청을 중단했습니다.'));},finish=callback=>value=>{options.signal?.removeEventListener('abort',abort);callback(value);},timer=setTimeout(()=>{this.pending.delete(id);options.signal?.removeEventListener('abort',abort);reject(error('CODEX_TIMEOUT','Codex 응답 시간이 초과됐습니다.'));},Math.max(1,Math.min(60000,this.requestMs)));this.pending.set(id,{method,resolve:finish(resolve),reject:finish(reject),timer});options.signal?.addEventListener('abort',abort,{once:true});try{this.write({id,method,params});}catch(failure){this.pending.delete(id);clearTimeout(timer);options.signal?.removeEventListener('abort',abort);reject(failure);}});
 }
 notify(method,params={}){this.write({method,params});}
 reply(id,result){const key=JSON.stringify(id);if(!this.serverRequests.has(key))throw error('CODEX_PROTOCOL','이미 처리했거나 만료된 도구 요청입니다.');this.write({id,result});this.serverRequests.delete(key);}
 rejectRequest(id){const key=JSON.stringify(id);if(!this.serverRequests.has(key))return;try{this.write({id,error:{code:-32601,message:'Only declared Vividly tools are available.'}});}finally{this.serverRequests.delete(key);}}
 async initialize(options={}){const value=await this.request('initialize',{clientInfo:{name:'vividly',title:'Vividly',version:'0.18.0-desktop.1'},capabilities:{experimentalApi:true}},options);this.notify('initialized',{});return value;}
 getVersion({signal}={}){return readCodexVersion({command:this.command,cwd:this.cwd,env:this.env,spawnImpl:this.spawnImpl,signal});}
 close(){
  if(this.closing)return this.closing;this.closed=true;this.closing=Promise.resolve().then(async()=>{await this.starting?.catch(()=>{});const child=this.child;if(!child)return;this.fail(error('CODEX_CLOSED','Codex 연결을 종료했습니다.'));await new Promise(resolve=>{if(child.exitCode!==null&&child.exitCode!==undefined){resolve();return;}const timer=setTimeout(()=>{try{child.kill();}catch{}resolve();},CODEX_CLIENT_LIMITS.shutdownMs);child.once('exit',()=>{clearTimeout(timer);resolve();});try{child.stdin.end();}catch{try{child.kill();}catch{}clearTimeout(timer);resolve();}});});return this.closing;
 }
}
