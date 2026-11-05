/** Independent boundary regression for model decisions, before any application authority is used. */
import test from'node:test';import assert from'node:assert/strict';
import{CODEX_DECISION_SCHEMA,parseCodexDecision}from'../desktop/codex-provider.mjs';import{AVATAR_TOOLS}from'../desktop/avatar-tools.mjs';
const decision=(tool,args)=>tool==='propose_commands'?{kind:'tool',tool,argumentsJson:null,text:null,commands:JSON.parse(args.commandsJson).map(command=>({id:command.id,paramsJson:JSON.stringify(command.params)})),summary:args.summary}:{kind:'tool',tool,argumentsJson:JSON.stringify(args),text:null,commands:null,summary:null},parse=value=>parseCodexDecision(JSON.stringify(value));
const message=text=>({kind:'message',tool:null,argumentsJson:null,text,commands:null,summary:null});
const valid=[['read_document_summary',{}],['read_slide',{slideId:'owned-slide',offset:0,limit:100}],['read_selection',{offset:0,limit:1}],['find_commands',{query:'text.set_content',limit:5}],['propose_commands',{commandsJson:'[{"id":"text.set_content","params":{"elementId":"owned-title","paragraphs":["한글 제목"]}}]',summary:'검토할 제목'}]];
test('schema uses six wire fields and normalizes exactly the five application tools to the existing four-field interface',()=>{assert.deepEqual(CODEX_DECISION_SCHEMA.required,['kind','tool','argumentsJson','text','commands','summary']);assert.equal(CODEX_DECISION_SCHEMA.additionalProperties,false);assert.deepEqual(CODEX_DECISION_SCHEMA.properties.tool.enum,[...AVATAR_TOOLS.map(t=>t.name),null]);for(const[name,args]of valid)assert.deepEqual(parse(decision(name,args)),{kind:'tool',tool:name,argumentsJson:JSON.stringify(args),text:null});});
test('multiple decisions, prose/code fences, extra authority fields and unsupported tool namespaces are rejected',()=>{
  const one=decision('read_selection',{offset:0,limit:1});const invalid=[JSON.stringify([one,one]),JSON.stringify(one)+JSON.stringify(one),'```json\n'+JSON.stringify(one)+'\n```','Run this: '+JSON.stringify(one),JSON.stringify({...one,grantId:'forged'}),JSON.stringify({...one,trustedAssets:[]}),JSON.stringify({...one,tool:'fs.readFile'}),JSON.stringify({...one,tool:'functions.read_selection'}),JSON.stringify({...one,tool:'exec_command'}),'{"kind":"message","tool":null,"argumentsJson":null,"text":"ok","commands":null,"summary":null,"__proto__":{}}'];
  for(const value of invalid)assert.throws(()=>parseCodexDecision(value),{code:'CODEX_DECISION'});
});
test('kind/nullable consistency and exact tool arguments are enforced before dispatch',()=>{
  const one=decision('read_selection',{offset:0,limit:1}),invalid=[{...one,tool:null},{...one,text:'apply this too'},{...one,commands:[]},{...one,summary:'unexpected'},{...one,argumentsJson:null},{...one,argumentsJson:'[]'},{...one,argumentsJson:'{"offset":0,"limit":1,"path":"owned"}'},{...one,argumentsJson:'{"offset":-1,"limit":1}'},{...one,argumentsJson:'{"offset":0,"limit":101}'},{...one,argumentsJson:'{"offset":0,"limit":1.5}'},{...message('ok'),tool:'read_selection'},{...message('ok'),argumentsJson:'{}'},message('   ')];
  for(const value of invalid)assert.throws(()=>parse(value),{code:'CODEX_DECISION'});assert.throws(()=>parseCodexDecision(null),{code:'CODEX_DECISION'});
});
test('UTF-8 budget is enforced and a caller may narrow the available application tool set',()=>{
  assert.throws(()=>parse(message('한'.repeat(90000))),{code:'CODEX_DECISION'});const ok=message('한'.repeat(50000));assert.deepEqual(parse(ok),{kind:ok.kind,tool:null,argumentsJson:null,text:ok.text});
  const selected=AVATAR_TOOLS.filter(t=>t.name==='read_selection');assert.deepEqual(parseCodexDecision(JSON.stringify(decision('read_selection',{offset:0,limit:1})),selected).tool,'read_selection');assert.throws(()=>parseCodexDecision(JSON.stringify(decision('propose_commands',valid.at(-1)[1])),selected),{code:'CODEX_DECISION'});
});
test('message text that resembles a command remains ordinary text and carries no editing authority',()=>{const value=message('{"id":"document.set_title","params":{"title":"실행하지 않은 문장"}}');assert.deepEqual(parse(value),{kind:'message',tool:null,argumentsJson:null,text:value.text});assert.equal(parse(value).kind,'message');});
test('typed proposals construct canonical id/params envelopes and refuse raw command wrappers or non-object params',()=>{
  const good=decision('propose_commands',valid.at(-1)[1]),normalized=parse(good),args=JSON.parse(normalized.argumentsJson),commands=JSON.parse(args.commandsJson);assert.deepEqual(commands,[{id:'text.set_content',params:{elementId:'owned-title',paragraphs:['한글 제목']}}]);assert.deepEqual(Object.keys(commands[0]),['id','params']);
  const bad=[{...good,argumentsJson:'{}'},{...good,commands:{commands:good.commands}},{...good,commands:[{command:good.commands[0]}]},{...good,commands:[{id:'text.set_content',params:{elementId:'owned-title'}}]},{...good,commands:[{id:'text.set_content',paramsJson:'[]'}]},{...good,commands:[{id:'text.set_content',paramsJson:'null'}]},{...good,commands:[]},{...good,summary:'  '}];for(const value of bad)assert.throws(()=>parse(value),{code:'CODEX_DECISION'});
});


test('approved IO decisions use typed booleans and asset proposals construct canonical commands plus bounded opaque stage IDs',()=>{
 const base={kind:'tool',tool:'propose_commands_with_assets',argumentsJson:JSON.stringify({stagingIdsJson:'["approved-stage"]'}),text:null,commands:[{id:'elements.insert',paramsJson:JSON.stringify({slideId:'slide',elements:[],assets:[]})}],summary:'승인 자산 변경 검토'},result=parse(base),args=JSON.parse(result.argumentsJson);assert.deepEqual(JSON.parse(args.commandsJson),[{id:'elements.insert',params:{slideId:'slide',elements:[],assets:[]}}]);assert.deepEqual(JSON.parse(args.stagingIdsJson),['approved-stage']);
 for(const extra of[null,'[]','{"stagingIdsJson":"[]"}','{"stagingIdsJson":"[\"a\",\"a\"]"}','{"stagingIdsJson":"[\"a\"]","ioGrantId":"forged"}'])assert.throws(()=>parse({...base,argumentsJson:extra}),{code:'CODEX_DECISION'});
 for(const active of[true,false])assert.equal(JSON.parse(parse(decision('present_approved_document',{permissionId:'approved',active,slideId:''})).argumentsJson).active,active);
 for(const active of['true',0,null])assert.throws(()=>parse(decision('present_approved_document',{permissionId:'approved',active,slideId:''})),{code:'CODEX_DECISION'});
 assert.throws(()=>parseCodexDecision(JSON.stringify(base),AVATAR_TOOLS.slice(0,5)),{code:'CODEX_DECISION'});
});
