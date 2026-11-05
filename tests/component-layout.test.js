import test from 'node:test';
import assert from 'node:assert/strict';
import {CommandController} from '../src/controller.js';
import {normalizeDocument} from '../src/model.js';
import {projectResponsiveSlide} from '../src/responsive-model.js';
import {evaluateCommand} from '../src/commands.js';
import {exportPresentation,parsePresentation} from '../src/format.js';
import {createPortfolioTemplate} from '../src/portfolio-template.js';

const copy=structuredClone;
const grid={direction:'grid',columns:2,gap:20,padding:16,align:'start',justify:'start'};
function setup(){const c=new CommandController(),box=c.addShape('round-rect'),title=c.addText();c.setGeometry(box,{x:60,y:70,width:250,height:160});c.setGeometry(title,{x:80,y:95,width:210,height:60});c.run('text.set_content',{elementId:title,paragraphs:['프로젝트 카드']});c.selectElements([box,title]);const componentId=c.captureComponent({name:'카드'}),ids=[c.insertComponent(componentId,{x:60,y:320}),c.insertComponent(componentId,{x:400,y:320}),c.insertComponent(componentId,{x:740,y:320})];return{c,componentId,ids};}
const item=(c,id)=>c.activeSlide.componentInstances.find(i=>i.id===id);
const geometry=(c,id)=>copy(c.activeSlide.elements.find(e=>e.id===id).geometry);
const members=(c,instanceId)=>{const instance=item(c,instanceId);return[instance.wrapperId,...Object.values(instance.elementMap)];};
function relative(c,id){const instance=item(c,id);return Object.values(instance.elementMap).map(id=>{const g=geometry(c,id);return{x:g.x-instance.frame.x,y:g.y-instance.frame.y,width:g.width,height:g.height};});}

test('three selected component cards become three grid items while all internal offsets and shared Undo remain intact',()=>{
  const{c,ids}=setup(),before=c.snapshot(),offsets=ids.map(id=>relative(c,id)),undo=c.undoCount,flowId=c.createFlow(ids.flatMap(id=>members(c,id)),grid),flow=c.activeSlide.elements.find(e=>e.id===flowId);
  assert.deepEqual(flow.flow.children,ids.map(id=>item(c,id).wrapperId));assert.equal(c.undoCount,undo+1);ids.forEach((id,index)=>assert.deepEqual(relative(c,id),offsets[index]));
  const after=c.snapshot();assert.deepEqual(normalizeDocument(after),after);c.undo();assert.deepEqual(c.snapshot(),before);c.redo();assert.deepEqual(c.snapshot(),after);
  const previous=ids.map(id=>copy(item(c,id).frame)),g=geometry(c,flowId);c.setGeometry(flowId,{x:g.x+45,y:g.y-180});ids.forEach((id,index)=>{assert.equal(item(c,id).frame.x,previous[index].x+45);assert.equal(item(c,id).frame.y,previous[index].y-180);assert.deepEqual(relative(c,id),offsets[index]);});
  assert.deepEqual(parsePresentation(exportPresentation(c.snapshot())),c.snapshot());
});

test('normal editor group move/resize adopts the frame once, while frame-only resizing projects members once',()=>{
  const{c,ids}=setup(),id=ids[0],targets=members(c,id),before=targets.map(id=>({elementId:id,geometry:geometry(c,id)})),original=c.snapshot();
  c.beginMultiTransform(targets,'move');c.previewMultiGeometry(before.map(item=>({elementId:item.elementId,geometry:{...item.geometry,x:item.geometry.x+85,y:item.geometry.y+35}})));c.commitTransform();
  targets.forEach((id,index)=>{assert.equal(geometry(c,id).x,before[index].geometry.x+85);assert.equal(geometry(c,id).y,before[index].geometry.y+35);});assert.deepEqual(normalizeDocument(c.snapshot()),c.snapshot());
  const moved=c.snapshot(),frame=copy(item(c,id).frame),sx=1.3,sy=1.2,expected=targets.map(id=>{const g=geometry(c,id);return{elementId:id,geometry:{x:frame.x+(g.x-frame.x)*sx,y:frame.y+(g.y-frame.y)*sy,width:g.width*sx,height:g.height*sy}};});
  c.beginMultiTransform(targets,'resize');c.previewMultiGeometry(expected);c.commitTransform();for(const update of expected)assert.deepEqual(geometry(c,update.elementId),update.geometry);assert.deepEqual(normalizeDocument(c.snapshot()),c.snapshot());c.undo();assert.deepEqual(c.snapshot(),moved);c.undo();assert.deepEqual(c.snapshot(),original);
  const wrapper=item(c,id).wrapperId,prior=targets.map(id=>geometry(c,id)),oldFrame=copy(item(c,id).frame);c.setGeometry(wrapper,{width:oldFrame.width*1.5,height:oldFrame.height*1.5});targets.slice(1).forEach((id,index)=>{const old=prior[index+1],g=geometry(c,id);assert.equal(g.x,oldFrame.x+(old.x-oldFrame.x)*1.5);assert.equal(g.y,oldFrame.y+(old.y-oldFrame.y)*1.5);assert.equal(g.width,old.width*1.5);});assert.deepEqual(normalizeDocument(c.snapshot()),c.snapshot());
});

test('phone layout stacks complete cards and source updates keep card layout, individual text and canonical document unchanged',()=>{
  const{c,componentId,ids}=setup(),flowId=c.createFlow(ids.flatMap(id=>members(c,id)),grid);c.run('document.set_responsive',{responsive:{enabled:true,minWidth:320,maxWidth:1440}});c.run('element.set_responsive',{elementId:flowId,responsive:{width:'stretch',phone:{direction:'column',columns:1,gap:18,padding:12}}});c.setGeometry(flowId,{x:50,y:250,width:1180});
  const second=item(c,ids[1]),textSource=c.document.componentLibrary[0].elements.find(e=>e.type==='text'),secondText=second.elementMap[textSource.id];c.run('text.set_content',{elementId:secondText,paragraphs:['사람이 수정한 두 번째 카드']});
  const first=item(c,ids[0]),shapeSource=c.document.componentLibrary[0].elements.find(e=>e.type==='shape');c.setFill(first.elementMap[shapeSource.id],'#7755aa');assert.equal(c.updateComponent(componentId,{slideId:c.activeSlideId,instanceId:first.id}).ok,true);assert.deepEqual(c.activeSlide.elements.find(e=>e.id===secondText).text.paragraphs,['사람이 수정한 두 번째 카드']);
  const before=c.snapshot(),projected=projectResponsiveSlide(c.activeSlide,c.document,390),wrappers=ids.map(id=>projected.slide.elements.find(e=>e.id===item(c,id).wrapperId));assert.equal(projected.profile,'phone');assert.ok(wrappers.every(e=>e.geometry.x===wrappers[0].geometry.x));assert.ok(wrappers.every((e,index)=>!index||e.geometry.y>=wrappers[index-1].geometry.y+wrappers[index-1].geometry.height));
  for(const id of ids){const instance=item(c,id),wrapper=projected.slide.elements.find(e=>e.id===instance.wrapperId);for(const target of Object.values(instance.elementMap)){const element=projected.slide.elements.find(e=>e.id===target);assert.ok(element.geometry.x>=wrapper.geometry.x-.001);assert.ok(element.geometry.x+element.geometry.width<=wrapper.geometry.x+wrapper.geometry.width+.001);}}
  assert.deepEqual(c.snapshot(),before);assert.deepEqual(parsePresentation(exportPresentation(c.snapshot())),c.snapshot());
});

test('detaching and deleting sources keeps free-position frames functional inside a flow and after copying',()=>{
  const{c,componentId,ids}=setup(),flowId=c.createFlow(ids.flatMap(id=>members(c,id)),grid),wrapperIds=ids.map(id=>item(c,id).wrapperId),bodyIds=ids.map(id=>Object.values(item(c,id).elementMap));c.detachComponent(c.activeSlideId,ids[0]);c.removeComponent(componentId);assert.equal(c.activeSlide.componentInstances,undefined);const before=geometry(c,wrapperIds[0]),g=geometry(c,flowId);c.setGeometry(flowId,{x:g.x+35,y:g.y+22});assert.equal(geometry(c,wrapperIds[0]).x,before.x+35);assert.equal(geometry(c,wrapperIds[0]).y,before.y+22);
  const originals=[wrapperIds[0],...bodyIds[0]],relativeBefore=originals.slice(1).map(id=>{const g=geometry(c,id),w=geometry(c,wrapperIds[0]);return{x:g.x-w.x,y:g.y-w.y};});c.selectElements(originals);const copies=c.pasteElements(c.copyElements(),{offsetX:30,offsetY:40}),wrapper=c.activeSlide.elements.find(e=>copies.includes(e.id)&&e.composition);assert.ok(wrapper);const descendants=wrapper.composition.children.map(id=>c.activeSlide.elements.find(e=>e.id===id));assert.deepEqual(descendants.map(e=>({x:e.geometry.x-wrapper.geometry.x,y:e.geometry.y-wrapper.geometry.y})),relativeBefore);assert.deepEqual(normalizeDocument(c.snapshot()),c.snapshot());
});

test('free frames reject cycles and multiple parents atomically, and ordinary non-component selection order stays unchanged',()=>{
  const{c,ids}=setup(),wrapper=item(c,ids[0]).wrapperId,member=Object.values(item(c,ids[0]).elementMap)[0],before=c.snapshot();const malformed=copy(before),frame=malformed.slides[0].elements.find(e=>e.id===wrapper);frame.composition.children.push(wrapper);assert.throws(()=>normalizeDocument(malformed));
  const failed=evaluateCommand(c.document,{id:'flow.create',params:{slideId:c.activeSlideId,elementIds:[member,c.activeSlide.elements.find(e=>e.type==='text'&&!e.groupId).id],containerId:'bad-parent',flow:grid}});assert.equal(failed.ok,false);assert.deepEqual(c.snapshot(),before);
  const plain=new CommandController(),a=plain.addShape('rectangle'),b=plain.addText(),flowId=plain.createFlow([b,a],{...grid,direction:'row'});assert.deepEqual(plain.activeSlide.elements.find(e=>e.id===flowId).flow.children,[b,a]);
});

test('composed cards remain editable layout sources and scale once across canvas ratios with unrelated navigation components stored',()=>{
  const c=new CommandController(),button=c.addShape('rectangle'),text=c.addText(),first=c.activeSlideId,destination=c.addSlide();c.switchSlide(first);c.setInteractions(first,[{id:'stored-navigation',sourceId:button,event:'click',actions:[{type:'goToSlide',targetId:destination}]}]);c.selectElements([button,text]);const componentId=c.captureComponent({name:'이동 카드'}),instanceId=c.insertComponent(componentId,{x:70,y:70});
  const cleanPage=c.addSlide();c.insertComponent(componentId,{x:120,y:100});c.captureLayout(cleanPage,'카드 레이아웃','component-layout',[]);const source=copy(c.document.layouts.find(l=>l.id==='component-layout'));
  c.run('document.resize_canvas',{width:720,height:1280,policy:'keep'});const pageId=c.createSlideFromLayout('component-layout'),page=c.document.slides.find(s=>s.id===pageId),sourceFrame=source.elements.find(e=>e.composition),frame=page.elements.find(e=>e.id===page.layout.elementMap[sourceFrame.id]);assert.ok(frame.composition);assert.ok(Math.abs(frame.geometry.width-sourceFrame.geometry.width*720/1280)<1e-8);assert.ok(Math.abs(frame.geometry.height-sourceFrame.geometry.height*1280/720)<1e-8);
  for(const childId of sourceFrame.composition.children){const original=source.elements.find(e=>e.id===childId),actual=page.elements.find(e=>e.id===page.layout.elementMap[childId]);assert.ok(Math.abs(actual.geometry.x-original.geometry.x*720/1280)<1e-8);assert.ok(Math.abs(actual.geometry.y-original.geometry.y*1280/720)<1e-8);}
  assert.deepEqual(normalizeDocument(c.snapshot()),c.snapshot());assert.deepEqual(parsePresentation(exportPresentation(c.snapshot())),c.snapshot());
});

test('editing a reusable portfolio card keeps its local external detail action and every instance category',()=>{
  const c=new CommandController(createPortfolioTemplate()),instances=c.activeSlide.componentInstances,first=instances[0],second=instances[1],source=c.document.componentLibrary.find(item=>item.id===first.componentId),shape=source.elements.find(e=>e.type==='shape'),a=first.elementMap[shape.id],b=second.elementMap[shape.id],panel=c.activeSlide.elements.find(e=>e.component?.kind==='panel');
  c.run('element.set_web',{elementId:a,web:{kind:'filterItem',group:'local-card-test',value:'marketing'}});c.run('element.set_web',{elementId:b,web:{kind:'filterItem',group:'local-card-test',value:'design'}});c.setInteractions(c.activeSlideId,[...(c.activeSlide.interactions||[]),{id:'local-card-detail',sourceId:a,event:'click',actions:[{type:'openPanel',targetId:panel.id}]}]);const localRule=copy(c.activeSlide.interactions.find(i=>i.id==='local-card-detail')),categories=c.activeSlide.elements.filter(e=>e.web?.kind==='filterItem').map(e=>({id:e.id,web:copy(e.web)}));
  c.setFill(a,'#4455aa');const before=c.snapshot(),preview=c.previewComponentUpdate(first.componentId,{slideId:c.activeSlideId,instanceId:first.id});assert.equal(preview.ok,true);assert.deepEqual(c.snapshot(),before);assert.equal(c.updateComponent(first.componentId,{slideId:c.activeSlideId,instanceId:first.id}).ok,true);
  assert.deepEqual(c.activeSlide.interactions.find(i=>i.id==='local-card-detail'),localRule);assert.deepEqual(c.activeSlide.elements.filter(e=>e.web?.kind==='filterItem').map(e=>({id:e.id,web:copy(e.web)})),categories);assert.ok(!c.document.componentLibrary.find(i=>i.id===source.id).interactions?.some(i=>i.actions.some(a=>a.targetId===panel.id)));assert.deepEqual(normalizeDocument(c.snapshot()),c.snapshot());
});
