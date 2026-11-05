import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {DesktopFormDataService} from '../desktop/form-data.mjs';

test('native form export writes an immutable JSON snapshot only to the selected target without adopting an HTML save path',async()=>{
  const calls=[];let release;const selected=new Promise(resolve=>release=resolve),destination=path.resolve('evidence','owned-profile.json');
  const service=new DesktopFormDataService({dialog:{showSaveDialog:async(_window,options)=>{calls.push(options);return selected;}},write:async(...args)=>calls.push(args)});
  const value={name:'내 프로필',values:{name:'김기획',bio:'한 줄\n두 줄',active:true,count:2}},pending=service.save(value);value.values.name='나중 변경';
  release({canceled:false,filePath:destination});const result=await pending;
  assert.equal(calls.length,2);assert.equal(calls[1][0],destination);assert.deepEqual(JSON.parse(calls[1][1]),{name:'김기획',bio:'한 줄\n두 줄',active:true,count:2});
  assert.deepEqual(result,{canceled:false,fileName:'owned-profile.json'});assert.equal(Object.hasOwn(service,'filePath'),false);assert.equal(calls[0].defaultPath,'내 프로필.json');
});
test('native export cancellation, invalid payload and extension do not write any file',async()=>{
  let writes=0,dialogs=0,result={canceled:true};const service=new DesktopFormDataService({dialog:{showSaveDialog:async()=>{dialogs++;return result;}},write:async()=>writes++});
  assert.deepEqual(await service.save({name:'폼',values:{field:'값'}}),{canceled:true});assert.equal(writes,0);
  for(const value of [{name:'폼',values:{field:{nested:true}}},{name:'폼',values:{field:'x'.repeat(4097)}},{name:'폼',values:{field:'값'},filePath:'unapproved.json'},{name:'폼',values:{field:Infinity}}])await assert.rejects(service.save(value));
  assert.equal(dialogs,1);result={canceled:false,filePath:path.resolve('evidence','owned-profile.txt')};await assert.rejects(service.save({name:'폼',values:{field:'값'}}),/json/);assert.equal(writes,0);
});
