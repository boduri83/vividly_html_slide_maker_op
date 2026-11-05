import test from 'node:test';
import assert from 'node:assert/strict';
import {projectResponsiveSlide,normalizeResponsiveDocument,normalizeResponsiveElement,validateResponsiveReferences} from '../src/responsive-model.js';
import {CommandController} from '../src/controller.js';
import {exportPresentation,parsePresentation} from '../src/format.js';
import {renderSlide} from '../src/render.js';

const clone=value=>structuredClone(value);
function fixture(){
  const c=new CommandController(),ids=[];
  for(let i=0;i<4;i++){const id=c.addShape('rectangle');c.setGeometry(id,{x:40+i*280,y:100,width:260,height:180});c.run('text.set_content',{elementId:id,paragraphs:['업무 프로젝트 '+(i+1),'사람이 직접 편집하는 카드의 본문입니다. 화면 너비에 따라 읽기 좋은 크기로 배치합니다.']});ids.push(id);}
  const container=c.createFlow(ids,{direction:'grid',columns:4,gap:20,padding:20,align:'stretch',justify:'start'});c.setGeometry(container,{x:40,y:80,width:1200,height:240});
  return{c,ids,container};
}
const responsive={enabled:true,minWidth:320,maxWidth:1600};

test('fixed documents preserve every canonical coordinate, source object and requested device projection',()=>{
  const {c}=fixture(),before=c.snapshot(),slide=c.activeSlide,result=projectResponsiveSlide(slide,c.document,390);
  assert.equal(result.responsive,false);assert.equal(result.width,1280);assert.equal(result.height,720);assert.deepEqual(result.slide,slide);assert.deepEqual(c.snapshot(),before);
});

test('fluid projection reflows cards, grows height and keeps text readable without source changes',()=>{
  const {c,ids,container}=fixture(),before=c.snapshot(),document={...c.snapshot(),responsive},desktop=projectResponsiveSlide(c.activeSlide,document,1280),phone=projectResponsiveSlide(c.activeSlide,document,390);
  assert.equal(desktop.profile,'desktop');assert.equal(phone.profile,'phone');assert.equal(phone.width,390);
  const cards=ids.map(id=>phone.slide.elements.find(e=>e.id===id));assert.ok(cards.every(card=>card.geometry.width>300));assert.ok(cards.every((card,i)=>!i||card.geometry.y>=cards[i-1].geometry.y+cards[i-1].geometry.height));
  assert.equal(cards[0].text.textStyle.fontSize,c.activeSlide.elements.find(e=>e.id===ids[0]).text.textStyle.fontSize);assert.ok(phone.height>desktop.height);
  assert.ok(phone.slide.elements.find(e=>e.id===container).geometry.height>desktop.slide.elements.find(e=>e.id===container).geometry.height);assert.deepEqual(c.snapshot(),before);
  const html=renderSlide(c.activeSlide,document,{viewportWidth:390});assert.match(html,/width:390px/);assert.match(html,/업무 프로젝트 1/);
});

test('responsive grid overrides wrap by minimum card width and filtered members release space',()=>{
  const {c,ids,container}=fixture(),document={...c.snapshot(),responsive},slide=clone(c.activeSlide),frame=slide.elements.find(e=>e.id===container);frame.responsive={phone:{direction:'grid',columns:2,minChildWidth:140,gap:12,padding:12}};
  const first=projectResponsiveSlide(slide,document,390),cards=ids.map(id=>first.slide.elements.find(e=>e.id===id));assert.equal(cards[0].geometry.y,cards[1].geometry.y);assert.ok(cards[2].geometry.y>cards[0].geometry.y);
  slide.elements.filter(e=>ids.slice(2).includes(e.id)).forEach(e=>e.hidden=true);const filtered=projectResponsiveSlide(slide,document,390);assert.ok(filtered.slide.elements.find(e=>e.id===container).geometry.height<first.slide.elements.find(e=>e.id===container).geometry.height);
});

test('grown sections push later content while long dialog content does not enlarge the page',()=>{
  const {c,container}=fixture(),footer=c.addText();c.setGeometry(footer,{x:40,y:400,width:1000,height:60});const document={...c.snapshot(),responsive},phone=projectResponsiveSlide(c.activeSlide,document,390),frame=phone.slide.elements.find(e=>e.id===container),end=phone.slide.elements.find(e=>e.id===footer);assert.ok(end.geometry.y>=frame.geometry.y+frame.geometry.height);
  const withPanel=clone(c.activeSlide),panel=clone(withPanel.elements.find(e=>e.id===footer));panel.id='long-detail-panel';panel.geometry={x:100,y:100,width:1000,height:4000};panel.component={kind:'panel',contentIds:[],placement:'center',dim:true,initiallyOpen:true};withPanel.elements.push(panel);assert.equal(projectResponsiveSlide(withPanel,document,390).height,phone.height);
});

test('screen settings reject incompatible references and preserve explicit fixed/header anchors',()=>{
  assert.throws(()=>normalizeResponsiveDocument({...responsive,minWidth:2000,maxWidth:600}),/최대 너비/);assert.throws(()=>normalizeResponsiveElement({phone:{columns:1.5}}),/정수/);assert.throws(()=>normalizeResponsiveElement({phone:{unknown:true}}),/지원하지/);
  const {c,ids}=fixture(),doc={...c.snapshot(),responsive},element=doc.slides[0].elements.find(e=>e.id===ids[0]);element.responsive={phone:{direction:'column'}};assert.throws(()=>validateResponsiveReferences(doc),/컨테이너/);element.responsive={width:'fixed',anchor:'right',sticky:{top:0}};validateResponsiveReferences(doc);
  const copy=clone(doc.slides[0]);copy.elements=[element];const projected=projectResponsiveSlide(copy,doc,390).slide.elements[0];assert.equal(projected.geometry.width,element.geometry.width);assert.equal(projected.responsive.sticky.top,0);
});

test('device typography preserves relative rich-text sizes and intrinsic layouts shrink after filtering',()=>{
  const {c,ids,container}=fixture(),slide=clone(c.activeSlide),element=slide.elements.find(e=>e.id===ids[0]);
  element.responsive={fontSize:{phone:16,tablet:20}};element.text.runs=[{paragraph:0,start:0,end:2,fontSize:48,bold:true}];
  const document={...c.snapshot(),responsive},phone=projectResponsiveSlide(slide,document,390),copy=phone.slide.elements.find(e=>e.id===element.id);
  assert.equal(copy.text.textStyle.fontSize,16);assert.equal(copy.text.runs[0].fontSize,48*16/element.text.textStyle.fontSize);assert.equal(element.text.runs[0].fontSize,48);
  const before=projectResponsiveSlide(slide,document,1280),frame=slide.elements.find(e=>e.id===container);frame.responsive={minHeight:80};slide.elements.filter(e=>ids.includes(e.id)).forEach(e=>e.hidden=true);const empty=projectResponsiveSlide(slide,document,1280);
  assert.equal(empty.slide.elements.find(e=>e.id===container).geometry.height,80);assert.ok(empty.height<before.height);
});

test('responsive configuration uses one common batch Undo, exact HTML reopening and a self-contained fluid player',()=>{
  const {c,container}=fixture(),before=c.snapshot(),history=c.undoCount;
  c.runBatch([{id:'document.set_responsive',params:{responsive}},{id:'element.set_responsive',params:{elementId:container,responsive:{phone:{direction:'column',gap:16,padding:16,wrap:true,minChildWidth:240}}}}],'화면별 배치');
  assert.equal(c.undoCount,history+1);assert.equal(c.document.schemaVersion,'0.15-authoring.1');const after=c.snapshot(),html=exportPresentation(after);assert.deepEqual(parsePresentation(html),after);assert.match(html,/projectVividlyResponsiveSlide/);assert.match(html,/resizeViewport\(viewport.clientWidth,viewport.clientHeight\)/);
  c.undo();assert.deepEqual(c.snapshot(),before);c.redo();assert.deepEqual(c.snapshot(),after);c.loadDocument(parsePresentation(html));c.run('document.set_title',{title:'다시 편집한 반응형 자료'});assert.equal(c.document.responsive.enabled,true);assert.equal(c.document.schemaVersion,'0.15-authoring.1');
});
