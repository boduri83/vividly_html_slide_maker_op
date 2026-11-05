import test from 'node:test';
import assert from 'node:assert/strict';
import {CommandController} from '../src/controller.js';
import {buildWebFormCommands} from '../src/web-authoring-ui.js';
import {partialInput} from '../desktop/mcp-tools.mjs';

test('new author libraries have bounded paged committed reads through the existing MCP input schema',()=>{
  const c=new CommandController(),text=c.addText();
  c.run('text.set_content',{elementId:text,paragraphs:['확정된 카드 원문']});
  const first=c.captureComponent({slideId:c.activeSlideId,elementIds:[text],name:'카드 하나'});
  const second=c.captureComponent({slideId:c.activeSlideId,elementIds:[text],name:'카드 둘'});
  const before=c.snapshot(),revision=c.revision,undo=c.undoCount;
  const request=partialInput.parse({projection:'componentLibrary',limit:1}),page=c.readProjection(request);
  assert.equal(page.ok,true);assert.equal(page.value.items[0].id,first);assert.equal(page.value.items[0].elements,undefined);assert.equal(page.value.page.total,2);
  const next=c.readProjection({...request,cursor:page.value.page.nextCursor});assert.equal(next.value.items[0].id,second);assert.equal(next.value.page.nextCursor,null);
  const source=c.readProjection({projection:'componentLibrary',fields:['content'],limit:1});assert.equal(source.value.items[0].elements[0].text.paragraphs[0],'확정된 카드 원문');
  assert.equal(JSON.stringify(source).includes('dataBase64'),false);
  c.beginText(text);c.updateText(['아직 확정하지 않은 글자']);c.setComposing(true);
  assert.equal(c.readProjection({projection:'componentLibrary',fields:['content'],limit:1}).value.items[0].elements[0].text.paragraphs[0],'확정된 카드 원문');
  assert.equal(c.revision,revision);assert.equal(c.undoCount,undo);assert.deepEqual(c.readCommittedSnapshot().value.document,before);
  c.setComposing(false);c.finishText();c.setTitle('revision 변경');assert.equal(c.readProjection({...request,cursor:page.value.page.nextCursor}).error.code,'REVISION_CONFLICT');
  assert.equal(c.readProjection({projection:'componentLibrary',fields:['geometry']}).error.code,'INVALID_READ');
});
test('web form and H2 variable projections expose authored definitions and preserve existing document summary shape',()=>{
  const c=new CommandController(),oldSummary=c.readProjection({projection:'documentSummary'}).value.document;
  assert.equal(Object.hasOwn(oldSummary,'componentCount'),false);assert.equal(Object.hasOwn(oldSummary,'webFormCount'),false);assert.equal(Object.hasOwn(oldSummary,'responsiveEnabled'),false);
  let n=0;const created=buildWebFormCommands(c.snapshot(),c.activeSlideId,{name:'연락 폼',persistence:'local',modal:false,fields:[{key:'email',label:'이메일',type:'email',initial:'',maxLength:150}]},{createId:prefix=>prefix+'-read-'+(++n)});c.runBatch(created.commands,'폼 생성');
  const before=c.snapshot(),count=c.undoCount;
  for(const projection of ['webForms','behaviorVariables'])assert.doesNotThrow(()=>partialInput.parse({projection,limit:1}));
  const forms=c.readProjection({projection:'webForms',limit:1});assert.equal(forms.value.items[0].fields[0].variableId,created.form.fields[0].variableId);
  const variables=c.readProjection({projection:'behaviorVariables',limit:1});assert.equal(variables.value.items[0].initial,'');
  assert.equal(c.readProjection({projection:'documentSummary'}).value.document.webFormCount,1);assert.deepEqual(c.snapshot(),before);assert.equal(c.undoCount,count);
  assert.equal(c.readProjection({projection:'webForms',fields:['content']}).error.code,'INVALID_READ');
});
