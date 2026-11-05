/** Separate an owned Codex child from its parent's app/task/tool-pipe authority. */
export function sanitizeCodexEnvironment(source=process.env){
 const result={};
 for(const key of Object.keys(source)){
  const normalized=key.toUpperCase();
  if(normalized.startsWith('CODEX_')&&normalized!=='CODEX_HOME'||['CODEX','OPENAI_API_KEY','OPENAI_BASE_URL'].includes(normalized))continue;
  // Filter names before reading values: inherited task/pipe/auth values are unnecessary.
  Object.defineProperty(result,key,{value:source[key],enumerable:true,writable:true,configurable:true});
 }
 return result;
}
