import test from 'node:test';
import assert from 'node:assert/strict';
import { textToRichDocument,richDocumentToText } from '../src/rich-text-conversion.js';
import { textFormatCommands,objectHyperlinkCommands,isObjectHyperlink } from '../src/text-format-ui.js';
import { CommandController } from '../src/controller.js';
import { exportPresentation,parsePresentation } from '../src/format.js';

const style={fontFamily:'Malgun Gothic',fontSize:32,lineHeight:1.2,color:'#182037',align:'left',verticalAlign:'top'};
test('all four base text marks retain false run exceptions through a rich editor roundtrip',()=>{
  const text={paragraphs:['가나다라마바사'],textStyle:{...style,bold:true,italic:true,underline:true,strike:true},runs:[{paragraph:0,start:1,end:3,bold:false,italic:false,underline:false,strike:false,href:'https://example.test'},{paragraph:0,start:4,end:6,fontSize:48,color:'#ff0000'}]};
  const rich=textToRichDocument(text);assert.deepEqual(richDocumentToText(rich,text),text);const exceptions=rich.content[0].content.find(n=>n.text==='나다');assert.ok(!exceptions.marks.some(m=>['bold','italic','underline','strike'].includes(m.type)));assert.equal(exceptions.marks.find(m=>m.type==='link').attrs.href,'https://example.test');
});
test('whole-object mark changes preserve other styles and links while clearing only the chosen run exception',()=>{
  const e={id:'text-1',text:{paragraphs:['매출 보고서'],textStyle:style,runs:[{paragraph:0,start:0,end:2,italic:false,href:'https://example.test',color:'#ff0000'},{paragraph:0,start:3,end:5,italic:true}]}};
  const before=structuredClone(e),commands=textFormatCommands([e],'italic',true);assert.equal(commands.length,2);assert.deepEqual(commands[1].params.runs,[{paragraph:0,start:0,end:2,href:'https://example.test',color:'#ff0000'}]);assert.deepEqual(e,before);assert.throws(()=>textFormatCommands([e],'code',true));
});
test('whole-object hyperlinks replace a simple link and preserve conditional or multi-action behavior',()=>{
  const conditional={id:'threshold',sourceId:'text-1',event:'click',condition:{variableId:'score',operator:'greaterOrEqual',value:'5'},actions:[{type:'goToSlide',targetId:'slide-2'}]};
  const old={id:'imported-navigation-id',sourceId:'text-1',event:'click',actions:[{type:'goToSlide',targetId:'slide-2'}]},document={slides:[{id:'slide-1',elements:[{id:'text-1',text:{paragraphs:['연결']}}],interactions:[conditional,old]},{id:'slide-2',elements:[]} ]};
  const before=structuredClone(document),commands=objectHyperlinkCommands(document,'slide-1','text-1',{kind:'url',href:'https://example.test/report'});assert.deepEqual(commands[0].params.interactions[0],conditional);assert.equal(commands[0].params.interactions[1].id,old.id);assert.deepEqual(commands[0].params.interactions[1].actions,[{type:'openLink',href:'https://example.test/report'}]);assert.deepEqual(document,before);
  assert.deepEqual(objectHyperlinkCommands(document,'slide-1','text-1',null)[0].params.interactions,[conditional]);assert.equal(isObjectHyperlink(conditional,'text-1'),false);
});
test('hyperlink creation rejects unsafe external protocols and missing internal destinations before mutation',()=>{
  const document={slides:[{id:'slide-1',elements:[{id:'text-1'}]}]},before=structuredClone(document);
  for(const href of ['javascript:alert(1)','data:text/html,x','file:///C:/secret','https://name:secret@example.test','https://example.test/\nfoo'])assert.throws(()=>objectHyperlinkCommands(document,'slide-1','text-1',{kind:'url',href}));
  assert.throws(()=>objectHyperlinkCommands(document,'slide-1','text-1',{kind:'slide',slideId:'missing'}));assert.deepEqual(document,before);
});
test('all four whole-object styles share one Undo boundary and remain editable after HTML reopen',()=>{
  const c=new CommandController(),id=c.addText();c.run('text.set_content',{elementId:id,paragraphs:['업무 제안서']});c.setRuns(id,[{paragraph:0,start:0,end:2,italic:false,href:'https://example.test'}]);
  for(const mark of ['bold','italic','underline','strike']){const before=c.snapshot(),history=c.undoCount;c.runBatch(textFormatCommands([c.selectedElement],mark,true),'글자 서식');assert.equal(c.undoCount,history+1);const after=c.snapshot();assert.equal(c.selectedElement.text.textStyle[mark],true);c.undo();assert.deepEqual(c.snapshot(),before);c.redo();assert.deepEqual(c.snapshot(),after);}
  const after=c.snapshot(),text=c.selectedElement.text;for(const mark of ['bold','italic','underline','strike'])assert.equal(text.textStyle[mark],true);assert.equal(text.runs[0].href,'https://example.test');assert.equal(text.runs[0].italic,undefined);assert.deepEqual(parsePresentation(exportPresentation(after)),after);
});
