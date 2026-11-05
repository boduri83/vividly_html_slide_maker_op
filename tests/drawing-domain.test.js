import test from 'node:test';
import assert from 'node:assert/strict';
import {createBlankDocument,normalizeDocument} from '../src/model.js';
import {CommandController} from '../src/controller.js';
import {normalizeFreeformPath,freeformGeometry,FREEFORM_POINT_LIMIT} from '../src/drawing-model.js';
import {resolveConnectorGeometry} from '../src/business-model.js';
import {normalizeSvgPath} from '../src/svg-path.js';
import {renderSlideContent} from '../src/render.js';
import {exportPresentation,parsePresentation} from '../src/format.js';

const copy=structuredClone;
const freeform=(id='freeform-a')=>({id,type:'shape',shape:'freeform',geometry:{x:80,y:100,width:300,height:200},fill:'#aabbcc',stroke:{color:'#123456',width:3},path:{points:[{x:0,y:0},{x:1,y:.2},{x:.4,y:1}],closed:true}});
const shape=(id,x=100)=>({id,type:'shape',shape:'rectangle',geometry:{x,y:200,width:160,height:120},fill:'#ddeeff',stroke:{color:'#334466',width:2}});
const connector=(id,from={point:{x:20,y:40}},to={point:{x:420,y:320}},route='straight',control)=>({id,type:'connector',geometry:{x:0,y:0,width:1,height:1},connector:{from,to,route,...(control?{control}:{}),stroke:{color:'#3755bb',width:3},arrow:'both'}});
const find=(store,id)=>store.activeSlide.elements.find(element=>element.id===id);
function insert(store,elements){store.run('elements.insert',{slideId:store.activeSlideId,elements,assets:[]});}
const state=store=>copy({document:store.document,revision:store.revision,undo:store.undoCount,redo:store.redoCount,selection:store.selectedIds});

test('freeform data is detached, bounded, closed when requested and cannot carry arbitrary author code',()=>{
  const source=freeform().path,normalized=normalizeFreeformPath(source);normalized.points[0].x=.2;assert.equal(source.points[0].x,0);
  assert.match(freeformGeometry(source,300,200).paths[0].d,/^M 0 0 L 300 40 L 120 200 Z$/);
  assert.equal(freeformGeometry({...source,closed:false},300,200).paths[0].fill,false);
  for(const bad of [
    {...source,script:'alert(1)'}, {...source,closed:'true'}, {...source,points:[{x:0,y:0}]},
    {...source,points:[{x:0,y:0},{x:1,y:1}]}, {...source,points:[{x:0,y:0},{x:NaN,y:.4},{x:1,y:1}]},
    {...source,points:[{x:0,y:0},{x:1.1,y:.4},{x:1,y:1}]},
    {...source,points:Array.from({length:FREEFORM_POINT_LIMIT+1},()=>({x:0,y:0}))},
    {...source,points:[{x:0,y:0,control:'script'},{x:1,y:0},{x:1,y:1}]},
  ])assert.throws(()=>normalizeFreeformPath(bad));
});

test('freeform point edits and format changes retain one shared history and editable HTML',()=>{
  const store=new CommandController(createBlankDocument());insert(store,[freeform()]);const before=state(store),path={points:[{x:.1,y:.15},{x:.9,y:.1},{x:.8,y:.9},{x:.2,y:1}],closed:true};
  store.runBatch([{id:'shape.set_path',params:{elementId:'freeform-a',path}},{id:'shape.set_stroke',params:{elementId:'freeform-a',stroke:{color:'#ee4477',width:5}}}],'자유형 점과 서식');
  assert.equal(store.undoCount,before.undo+1);assert.deepEqual(find(store,'freeform-a').path,path);assert.equal(find(store,'freeform-a').stroke.width,5);
  const markup=renderSlideContent(store.activeSlide,store.document);assert.match(markup,/<svg class="element-shape-geometry"/);assert.doesNotMatch(markup,/NaN|Infinity|undefined/);
  assert.deepEqual(parsePresentation(exportPresentation(store.document)),store.document);
  const after=copy(store.document);store.undo();assert.deepEqual(store.document,before.document);store.redo();assert.deepEqual(store.document,after);
  const stable=state(store);assert.throws(()=>store.setShapeAdjustments('freeform-a',{adj:30}));assert.deepEqual(state(store),stable);
  const invalid=copy(store.document);invalid.slides[0].elements[0].adjustments={adj:5};assert.throws(()=>normalizeDocument(invalid));
});

test('free and attached connector endpoints are a closed union and all routes resolve finite scalable geometry',()=>{
  const store=new CommandController(createBlankDocument());insert(store,[shape('anchor'),...['straight','elbow','curve'].map((route,index)=>connector('line-'+route,{elementId:'anchor',anchor:'right'},{point:{x:560,y:420}},route,{x:390,y:70+index*10}))]);
  for(const route of ['straight','elbow','curve']){
    const line=find(store,'line-'+route),resolved=resolveConnectorGeometry(line,store.activeSlide);
    assert.deepEqual(resolved.from,{x:260,y:260});assert.deepEqual(resolved.to,{x:560,y:420});
    for(const value of Object.values(resolved.geometry))assert.ok(Number.isFinite(value));assert.ok(resolved.geometry.width>0&&resolved.geometry.height>0);
    assert.match(resolved.path,route==='curve'?/ Q /:/ L /);assert.doesNotMatch(resolved.path,/NaN|Infinity/);
  }
  const markup=renderSlideContent(store.activeSlide,store.document);assert.match(markup,/class="connector-hit"/);assert.match(markup,/data-connector-stroke="true"/);
  assert.deepEqual(parsePresentation(exportPresentation(store.document)),store.document);
  for(const endpoint of [{point:{x:1,y:2},elementId:'anchor',anchor:'left'},{point:{x:1,y:Infinity}},{elementId:'anchor'},{point:{x:1,y:2},script:'bad'}]){
    const stable=state(store),line=copy(find(store,'line-straight').connector);line.to=endpoint;assert.throws(()=>store.setConnector('line-straight',line));assert.deepEqual(state(store),stable);
  }
  const bad=copy(find(store,'line-straight').connector);bad.to={elementId:'line-curve',anchor:'left'};const stable=state(store);assert.throws(()=>store.setConnector('line-straight',bad));assert.deepEqual(state(store),stable);
});

test('drag-style detach, anchor motion and deletion retain only valid connector dependencies',()=>{
  const store=new CommandController(createBlankDocument());insert(store,[shape('left',100),shape('right',550),connector('attached',{elementId:'left',anchor:'right'},{elementId:'right',anchor:'left'}),connector('free')]);
  store.setSlideBusiness(store.activeSlideId,{readingOrder:store.activeSlide.elements.map(element=>element.id)});
  const before=resolveConnectorGeometry(find(store,'attached'),store.activeSlide);store.setGeometry('left',{x:160});assert.equal(resolveConnectorGeometry(find(store,'attached'),store.activeSlide).from.x,before.from.x+60);
  store.setRotation('right',90);const rotated=resolveConnectorGeometry(find(store,'attached'),store.activeSlide);assert.ok(Math.abs(rotated.to.x-630)<1e-8);assert.ok(Math.abs(rotated.to.y-180)<1e-8);
  const detached={...copy(find(store,'attached').connector),from:{point:{x:300,y:270}},to:{point:{x:600,y:300}}};store.setConnector('attached',detached);store.deleteElement('left');store.deleteElement('right');
  assert.ok(find(store,'attached'));assert.ok(find(store,'free'));assert.deepEqual(store.activeSlide.readingOrder,['attached','free']);
  const stable=state(store);store.undo();store.undo();assert.ok(find(store,'left'));assert.ok(find(store,'right'));store.undo();assert.ok(find(store,'attached').connector.from.elementId);
  store.deleteElement('left');assert.equal(find(store,'attached'),undefined);assert.ok(find(store,'free'));assert.ok(!store.activeSlide.readingOrder.includes('attached'));assert.notDeepEqual(state(store),stable);
});

test('connector clipboard offsets free points and controls while remapping attached targets together',()=>{
  const source=new CommandController(createBlankDocument());insert(source,[shape('source-shape',80),connector('mixed',{elementId:'source-shape',anchor:'right'},{point:{x:560,y:430}},'curve',{x:390,y:80}),connector('free')]);
  const payload=source.copyElements(['source-shape','mixed','free']),payloadBefore=copy(payload),destination=new CommandController(createBlankDocument());
  const inserted=destination.pasteElements(payload,{offsetX:30,offsetY:45}),items=inserted.map(id=>find(destination,id)),anchor=items.find(element=>element.type==='shape'),mixed=items.find(element=>element.connector?.from.elementId),free=items.find(element=>element.connector?.from.point);
  assert.equal(mixed.connector.from.elementId,anchor.id);assert.deepEqual(mixed.connector.to.point,{x:590,y:475});assert.deepEqual(mixed.connector.control,{x:420,y:125});assert.deepEqual(free.connector.from.point,{x:50,y:85});assert.deepEqual(free.connector.to.point,{x:450,y:365});assert.deepEqual(payload,payloadBefore);assert.equal(destination.undoCount,1);
  const pasted=copy(destination.document);destination.undo();assert.equal(destination.activeSlide.elements.length,0);destination.redo();assert.deepEqual(destination.document,pasted);
  const missing=source.copyElements(['mixed']),stable=state(destination);assert.throws(()=>destination.pasteElements(missing));assert.deepEqual(state(destination),stable);
  const onlyFree=source.copyElements(['free']);assert.doesNotThrow(()=>destination.pasteElements(onlyFree,{offsetX:0,offsetY:0}));
});

test('late invalid drawing commands and human activity protection preserve committed document and history',async()=>{
  let activity={};const store=new CommandController(createBlankDocument(),{activityProvider:()=>activity});insert(store,[freeform(),connector('free')]);const before=state(store),newPath={points:[{x:0,y:.2},{x:.7,y:0},{x:1,y:1}],closed:true};
  assert.throws(()=>store.runBatch([{id:'shape.set_path',params:{elementId:'freeform-a',path:newPath}},{id:'connector.set_data',params:{elementId:'free',connector:{...find(store,'free').connector,to:{elementId:'missing',anchor:'left'}}}}],'실패할 그리기 묶음'));
  assert.deepEqual(state(store),before);
  const snapshot=store.readCommittedSnapshot().value,target={instanceId:snapshot.instanceId,editorSessionId:snapshot.editorSessionId,documentId:snapshot.documentId},request={target,expectedRevision:store.revision,operationId:crypto.randomUUID(),targeting:'id',commands:[{id:'shape.set_path',params:{elementId:'freeform-a',path:newPath}}]};
  activity={controls:[{fieldId:'workbench-properties',elementId:'freeform-a'}],pendingChanges:true};const blocked=await store.applyCommands(request);assert.equal(blocked.error.code,'EDITOR_BUSY');assert.equal(blocked.error.mutated,false);assert.deepEqual(state(store),before);
  activity={};const dry=await store.applyCommands({...request,dryRun:true});assert.equal(dry.ok,true);assert.deepEqual(state(store),before);const committed=await store.applyCommands(request);assert.equal(committed.ok,true);assert.equal(store.undoCount,before.undo+1);store.undo();assert.deepEqual(store.document,before.document);
});

test('SVG paths reject executable, nonfinite, malformed arc and unsupported attribute data before a live change',()=>{
  for(const input of ['<script>','M0 0 L1e309 3','M0 0 A1 1 0 0 2 4 5','M0 0 Z 1','M0 0 L','M0 0 B2 2','M0 0 url(x)'])assert.throws(()=>normalizeSvgPath(input));
  const store=new CommandController(createBlankDocument()),svg={id:'path-svg',type:'svg',geometry:{x:0,y:0,width:24,height:24},svg:{viewBox:{width:24,height:24},shapes:[{kind:'path',d:'M 2 2 L 22 22',fill:'none',stroke:'#334455',strokeWidth:2,strokeLinecap:'round',strokeLinejoin:'round'}]}};
  insert(store,[svg]);assert.match(renderSlideContent(store.activeSlide,store.document),/stroke-linecap="round"/);
  for(const update of [path=>path.href='https://example.test',path=>path.strokeLinecap='round" onload="bad',path=>path.d='M0 0 <script>']){
    const value=copy(find(store,'path-svg').svg);update(value.shapes[0]);const stable=state(store);assert.throws(()=>store.setSvg('path-svg',value));assert.deepEqual(state(store),stable);
  }
});
