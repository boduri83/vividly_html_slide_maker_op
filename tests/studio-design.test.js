import test from 'node:test';
import assert from 'node:assert/strict';
import { CommandController } from '../src/controller.js';
import { cssPresetCommands } from '../src/css-studio-ui.js';
import { fontStack,isFontFamily } from '../src/font-names.js';
import { renderSlideContent } from '../src/render.js';
import { exportPresentation,parsePresentation,createStaticExport } from '../src/format.js';
import { summarizeChanges,changedTargetIds } from '../src/document-diff.js';

test('CSS design preserves content and geometry, commits one shared history entry and round trips',()=>{
  const c=new CommandController();const id=c.addShape('round-rect');c.run('text.set_content',{elementId:id,paragraphs:['기획 제안']});const before=c.snapshot(),history=c.undoCount;
  c.runBatch(cssPresetCommands([c.selectedElement],'glass'),'CSS 디자인');const after=c.snapshot();assert.equal(c.undoCount,history+1);assert.deepEqual(c.selectedElement.geometry,before.slides[0].elements[0].geometry);assert.deepEqual(c.selectedElement.text,before.slides[0].elements[0].text);
  assert.equal(c.selectedElement.style.backdropBlur,18);assert.match(renderSlideContent(c.activeSlide,c.document),/backdrop-filter:blur\(18px\)/);assert.deepEqual(parsePresentation(exportPresentation(after)),after);
  c.undo();assert.deepEqual(c.snapshot(),before);c.redo();assert.deepEqual(c.snapshot(),after);
});
test('CSS preset batch does not partially apply on a locked element or invalid numeric effect',()=>{
  const c=new CommandController();const first=c.addShape('rectangle'),second=c.addShape('ellipse');c.setElementFlags(second,{locked:true});const before=c.snapshot();assert.throws(()=>c.runBatch(cssPresetCommands(c.activeSlide.elements,'aurora'),'CSS'));assert.deepEqual(c.snapshot(),before);assert.throws(()=>c.run('element.set_style',{elementId:first,style:{backdropBlur:101}}),/범위|지원|수/);assert.deepEqual(c.snapshot(),before);
});
test('installed font punctuation is literal data in normal, static and editable HTML',()=>{
  const c=new CommandController(),id=c.addText();const name='Designer (OTF) & Co.\";color:red;</style><script>x</script>';
  assert.equal(isFontFamily(name),true);assert.equal(isFontFamily('bad\u0000font'),false);assert.equal(isFontFamily('a'.repeat(257)),false);c.setTextStyle(id,{fontFamily:name});
  const style=fontStack(name);assert.ok(style.includes('\\";color:red;\\3c /style\\3e '));const content=renderSlideContent(c.activeSlide,c.document);assert.ok(!content.includes('</style><script>x'));
  const html=exportPresentation(c.document);assert.deepEqual(parsePresentation(html),c.snapshot());const output=createStaticExport(c.document);assert.ok(!output.html.includes('</style><script>x'));
});
test('layout-only changes include the document in the guarded batch change summary',()=>{
  const c=new CommandController();c.addShape('rectangle');c.captureLayout(c.activeSlideId,'본문 레이아웃');const before=c.snapshot(),after=structuredClone(before);after.layouts[0].name='새 이름';assert.equal(summarizeChanges(before,after).layoutsChanged,true);assert.ok(changedTargetIds(before,after).includes(before.id));
});
