/** Process-local policy for the tested Codex CLI. Never reads auth/config files directly. */
import path from'node:path';
import {spawn} from'node:child_process';
import {StringDecoder} from'node:string_decoder';
import {AvatarError} from'./avatar-provider.mjs';
import {sanitizeCodexEnvironment} from'./codex-environment.mjs';

export const CODEX_POLICY_VERSION='0.156.1';
export const CODEX_POLICY_LIMITS=Object.freeze({metadataBytes:1024*1024,servers:128,timeoutMs:10000});
const features=Object.freeze({shell_tool:false,view_image:false,apps:false,hooks:false,memories:false,multi_agent:false,plugins:false,browser_use:false,computer_use:false,image_generation:false,code_mode_host:false,skill_search:false,workspace_dependencies:false,goals:false,skip_host_skill_discovery:true});
const fail=message=>new AvatarError('CODEX_POLICY_UNAVAILABLE',message);
const baseConfig=()=>({features:{...features},web_search:'disabled',apps:{_default:{enabled:false}}});
const baseArgs=()=>[...Object.entries(features).flatMap(([key,value])=>['-c',`features.${key}=${value}`]),'-c','web_search="disabled"','-c','apps._default.enabled=false'];
function freeze(value){if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}

async function metadata(command,args,{cwd,env,signal,spawnImpl}){
  if(signal?.aborted)throw new AvatarError('CANCELLED','Codex 연결 준비를 중단했습니다.');
  return new Promise((resolve,reject)=>{
    let child,settled=false,stopping=null,stopTimer,text='',bytes=0;const decoder=new StringDecoder('utf8');
    const settle=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);clearTimeout(stopTimer);signal?.removeEventListener('abort',abort);if(error)reject(error);else resolve(value);};
    const finish=(error,value)=>{
      if(settled||stopping)return;
      if(error&&child){
        stopping=error;clearTimeout(timer);signal?.removeEventListener('abort',abort);
        // Startup is not drained until the owned metadata child closes.
        stopTimer=setTimeout(()=>settle(fail('Codex 연결 준비 프로세스를 종료하지 못했습니다.')),2000);
        try{child.kill();}catch{settle(fail('Codex 연결 준비 프로세스를 종료하지 못했습니다.'));}
      }else settle(error,value);
    };
    const abort=()=>finish(new AvatarError('CANCELLED','Codex 연결 준비를 중단했습니다.'));
    const timer=setTimeout(()=>finish(fail('Codex 실행 범위 확인 시간이 초과됐습니다.')),CODEX_POLICY_LIMITS.timeoutMs);
    try{child=spawnImpl(command,args,{cwd,env,windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});}
    catch{finish(fail('Codex 실행 범위를 확인하지 못했습니다.'));return;}
    signal?.addEventListener('abort',abort,{once:true});
    child.stdout.on('data',chunk=>{if(settled||stopping)return;bytes+=Buffer.byteLength(chunk);if(bytes>CODEX_POLICY_LIMITS.metadataBytes){finish(fail('Codex 연결 설정이 너무 커서 실행하지 않았습니다.'));return;}text+=decoder.write(chunk);});
    // CLI metadata can contain private environment/config values. Never log it.
    child.stderr.on('data',()=>{});
    for(const stream of[child.stdout,child.stderr])stream.on('error',()=>finish(fail('Codex 실행 범위를 확인하지 못했습니다.')));
    child.on('error',()=>finish(fail('Codex 실행 범위를 확인하지 못했습니다.')));
    child.on('close',code=>{if(stopping){settle(stopping);return;}if(code!==0){settle(fail('Codex 실행 범위를 확인하지 못했습니다.'));return;}settle(null,text+decoder.end());});
  });
}

/** Discover only MCP names, disable each explicitly, then start the same executable.
 * `mcp_servers={}` merges with existing tables and does not disable inherited MCP.
 */
export async function createCodexPolicy({command,cwd,signal,env=process.env,spawnImpl=spawn}={}){
  if(typeof command!=='string'||!path.isAbsolute(command)||typeof cwd!=='string'||!path.isAbsolute(cwd)||typeof spawnImpl!=='function')throw fail('Codex 전용 실행 파일과 작업 폴더가 필요합니다.');
  const childEnv=sanitizeCodexEnvironment(env);
  const options={cwd,env:childEnv,signal,spawnImpl};
  const version=(await metadata(command,['--version'],options)).trim();
  if(version!==`codex-cli ${CODEX_POLICY_VERSION}`)throw fail('이 Codex 버전의 실행 범위를 검증하지 못했습니다. 검증된 0.156.1 버전으로 다시 확인하세요.');
  let rows;try{rows=JSON.parse(await metadata(command,[...baseArgs(),'mcp','list','--json'],options));}catch(error){if(error instanceof AvatarError)throw error;throw fail('Codex MCP 설정 이름을 확인하지 못했습니다.');}
  if(!Array.isArray(rows)||rows.length>CODEX_POLICY_LIMITS.servers)throw fail('Codex MCP 설정 범위를 확인하지 못했습니다.');
  const names=rows.map(row=>row?.name);
  if(names.some(name=>typeof name!=='string'||!name.trim()||name.length>256)||new Set(names).size!==names.length)throw fail('Codex MCP 설정 이름을 확인하지 못했습니다.');
  const servers=Object.fromEntries(names.map(name=>[name,{enabled:false}]));
  // Inline-table quoted keys preserve opaque names, including dots and spaces.
  const disabled='{'+names.map(name=>`${JSON.stringify(name)}={enabled=false}`).join(',')+'}';
  const config={...baseConfig(),mcp_servers:servers};
  return freeze({executionBoundaryVerified:true,allowedBuiltinTools:['request_user_input','skills.list','skills.read'],config,spawnArgs:['--strict-config',...baseArgs(),'-c','mcp_servers='+disabled],testedVersion:CODEX_POLICY_VERSION,requiresRuntimeVerification:true,mcpServerCount:names.length});
}

/** Run after initialize/config-read, before any model turn; never store this raw response. */
export function assertCodexPolicyConfig(response,policy){
  const value=response?.config;
  if(policy?.executionBoundaryVerified!==true||!value||value.web_search!=='disabled'||value.apps?._default?.enabled!==false||Object.entries(features).some(([key,expected])=>value.features?.[key]!==expected))throw fail('Codex의 실제 도구 제한을 확인하지 못해 실행하지 않았습니다.');
  if(!value.mcp_servers||typeof value.mcp_servers!=='object'||Array.isArray(value.mcp_servers)||Object.values(value.mcp_servers).some(server=>server?.enabled!==false))throw fail('Codex의 다른 MCP 연결을 차단하지 못해 실행하지 않았습니다.');
  return true;
}

/** Check all pages for this exact ephemeral thread before turn/start. */
export function assertCodexMcpInventory(response){
  if(!Array.isArray(response?.data)||response.data.some(server=>!server||typeof server!=='object'||!server.tools||typeof server.tools!=='object'||Array.isArray(server.tools)||Object.keys(server.tools).length>0||server.resources?.length||server.resourceTemplates?.length))throw fail('Codex에 다른 도구가 남아 있어 실행하지 않았습니다.');
  return{complete:response.nextCursor==null,nextCursor:response.nextCursor??null};
}
