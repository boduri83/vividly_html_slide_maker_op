import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeClipboardService,MAX_CLIPBOARD_TEXT_BYTES} from '../desktop/clipboard.mjs';
import {LOCAL_CLIPBOARD_KIND,planClipboardWrite,publishClipboard,resolveClipboardContents,canCommitClipboardCut} from '../src/local-clipboard.js';
const payload=()=>({kind:'vividly-elements',version:1,documentId:'source',elements:[{id:'copied-object'}],assets:[]});
const provider=()=>({text:'old native content',writes:[],async writeText(text){this.text=text;this.writes.push(text);},async read(){return[{types:['text/plain'],getType:async()=>new Blob([this.text],{type:'text/plain'})}];}});
test('a media payload beyond the native 32MiB text cap writes a tiny marker and resolves the held bytes',async()=>{
  const p=payload();p.assets=[{id:'large-video',dataBase64:'A'.repeat(MAX_CLIPBOARD_TEXT_BYTES+4)}];const target=provider(),native=new NativeClipboardService({clipboard:target});const plan=planClipboardWrite(p,'owned-token');assert.equal(plan.mode,'marker');assert.equal(plan.text,null);
  const state=await publishClipboard(p,{writeText:text=>native.writeText(text),token:'owned-token'});assert.equal(state.status,'confirmed');assert.equal(state.mode,'marker');assert.equal(target.writes.length,1);assert.ok(target.text.length<200);assert.equal(JSON.parse(target.text).kind,LOCAL_CLIPBOARD_KIND);assert.strictEqual(resolveClipboardContents(await native.read(),state).payload,p);assert.equal(p.assets[0].dataBase64.length,MAX_CLIPBOARD_TEXT_BYTES+4);
});
test('a native full-payload write failure falls back to a confirmed marker without losing the local selection',async()=>{
  const p=payload();p.elements[0].text='내용'.repeat(600);const target=provider(),native=new NativeClipboardService({clipboard:target,maxTextBytes:256}),attempts=[];const state=await publishClipboard(p,{token:'fallback-token',writeText:text=>{attempts.push(text.length);return native.writeText(text);}});assert.equal(attempts.length,2);assert.equal(state.status,'confirmed');assert.equal(state.mode,'marker');assert.equal(state.fallbackErrors.length,1);assert.strictEqual(resolveClipboardContents(await native.read(),state).payload,p);
});
test('a marker from another app window is explicit unavailable data, never pasted as JSON text',async()=>{
  const p=payload(),target=provider(),state=await publishClipboard(p,{token:'this-window',writeText:text=>target.writeText(text),maxBytes:1});const incoming={text:JSON.stringify({kind:LOCAL_CLIPBOARD_KIND,version:1,token:'other-window'})};assert.throws(()=>resolveClipboardContents(incoming,state),/복사한 Vividly 창/);assert.throws(()=>resolveClipboardContents(incoming,null),/원본 클립보드/);assert.equal(p.elements.length,1);
});
test('new external text, image or a normal Vividly payload takes precedence over a local marker state',async()=>{
  const p=payload(),state={payload:p,token:'local',status:'confirmed',mode:'marker'};for(const contents of [{text:'새로 복사한 외부 텍스트'},{text:'',image:{mimeType:'image/png',dataBase64:'fresh'}},{text:JSON.stringify({...payload(),documentId:'new-source'})}]){const result=resolveClipboardContents(contents,state);assert.equal(result.kind,'external');assert.strictEqual(result.contents,contents);}
});
test('two failed writes block stale native content and preserve the local data instead of confirming a cut',async()=>{
  const p=payload(),before=structuredClone(p);let calls=0;const state=await publishClipboard(p,{token:'failed',writeText:async()=>{calls++;throw Error('native write denied');}});assert.equal(calls,2);assert.equal(state.status,'failed');assert.deepEqual(p,before);assert.throws(()=>resolveClipboardContents({text:'old native content'},state),/이전 내용을 붙여넣지/);assert.throws(()=>resolveClipboardContents(null,state),/원본은 유지/);
});
test('read failure uses a held payload only after a confirmed publication and marker fields are closed',()=>{
  const p=payload(),state={payload:p,token:'known',status:'confirmed'};assert.strictEqual(resolveClipboardContents(null,state).payload,p);assert.equal(resolveClipboardContents(null,null).kind,'empty');assert.throws(()=>resolveClipboardContents({text:JSON.stringify({kind:LOCAL_CLIPBOARD_KIND,version:99,token:'known'})},state),/참조/);assert.throws(()=>resolveClipboardContents({text:JSON.stringify({kind:LOCAL_CLIPBOARD_KIND,version:1,token:'known',script:'bad'})},state),/참조/);
});
test('the cap counts UTF-8 bytes and cut commits require the exact captured document and selection',()=>{
  const p=payload();p.elements[0].text='한'.repeat(100);assert.equal(planClipboardWrite(p,'unicode',300).mode,'marker');const capture={sessionId:'session',slideId:'slide',revision:5,selected:['one','two']};assert.equal(canCommitClipboardCut(capture,{...capture}),true);for(const change of [{sessionId:'new'},{slideId:'different'},{revision:6},{selected:['two']},{selected:['two','one']}])assert.equal(canCommitClipboardCut(capture,{...capture,...change}),false);
});
