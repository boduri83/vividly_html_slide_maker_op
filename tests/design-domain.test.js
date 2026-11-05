import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CommandController} from '../src/controller.js';
import {normalizeDocument,DESIGN_SCHEMA} from '../src/model.js';
import {resolveDesignElement,captureDesignAppearance,resolveFlowSlide,flowParent} from '../src/design-model.js';
import {evaluateCommand,evaluateCommands,getCommandCatalog} from '../src/commands.js';
import {exportPresentation,parsePresentation} from '../src/format.js';
const fixture=JSON.parse(readFileSync(new URL('../examples/document-contract-v0.1.json',import.meta.url),'utf8'));
const id='element-shape-001',title='element-title-001',clone=v=>structuredClone(v);
const find=(c,key=id)=>c.document.slides.flatMap(s=>s.elements).find(e=>e.id===key);
const resolved=(c,key=id,state='base')=>resolveDesignElement(find(c,key),c.document,{state});
const recipe=(extra={})=>({id:'style-card',name:'브랜드 카드',appearance:{fill:'#112233',style:{radius:24,opacity:.9},css:{background:'linear-gradient(120deg,var(--v-accent),#7c3aed)','letter-spacing':'1px'}},states:{hover:{style:{opacity:.6}},pressed:{style:{radius:12}}},...extra});
const tokens=[{id:'accent',name:'주 색',type:'color',value:'#2563eb'},{id:'gap',name:'간격',type:'length',value:'16px'}];
const setup=()=>{const c=new CommandController(fixture);c.setStyleTokens(tokens);c.upsertStyleRecipe(recipe());c.applyStyleRecipe([id],'style-card');return c;};
const flow={direction:'row',gap:16,padding:24,align:'center',justify:'start',columns:2};
const guard=(c,commands,extra={})=>{const read=c.readCommittedSnapshot().value;return{target:{instanceId:read.instanceId,editorSessionId:read.editorSessionId,documentId:read.documentId},expectedRevision:c.revision,operationId:'design-test',targeting:'id',commands,...extra};};
const stable=c=>clone({document:c.document,revision:c.revision,undo:c.undoCount,redo:c.redoCount,selection:c.selectedIds});

test('legacy metadata stays identical until a meaningful design edit and design commands are advertised',()=>{
 const c=new CommandController(fixture);assert.deepEqual(c.document,fixture);c.setStyleTokens([]);assert.deepEqual(c.document,fixture);assert.equal(c.undoCount,0);
 c.setStyleTokens(tokens);assert.equal(c.document.schemaVersion,DESIGN_SCHEMA);assert.deepEqual(parsePresentation(exportPresentation(c.document)),c.document);
 c.undo();assert.deepEqual(c.document,fixture);c.redo();assert.equal(c.document.schemaVersion,DESIGN_SCHEMA);
 const catalog=getCommandCatalog();assert.equal(catalog.length,106);assert.equal(getCommandCatalog({includeReserved:true}).length,106);
 for(const name of ['design.recipe_upsert','design.recipe_apply','design.recipe_detach','design.set_overrides','design.set_state','design.set_enabled','flow.create','flow.set','flow.remove'])assert.ok(catalog.some(c=>c.id===name));
 assert.ok(c.readCapabilities().value.readableSchemaVersions.includes(DESIGN_SCHEMA));
});
test('linked recipes, tokens and states resolve without touching content and retain explicit local overrides',()=>{
 const c=setup(),beforeText=clone(find(c).text),initial=resolved(c);assert.equal(initial.element.fill,'#112233');assert.match(initial.css.background,/#2563eb/);assert.equal(resolved(c,id,'hover').element.style.opacity,.6);
 c.setFill(id,'#ff0055');assert.equal(resolved(c).element.fill,'#ff0055');assert.equal(resolved(c).css.background,undefined);
 c.upsertStyleRecipe(recipe({appearance:{fill:'#00aa88',style:{radius:40,opacity:.8},css:{background:'linear-gradient(var(--v-accent),#ffffff)','letter-spacing':'2px'}}}));
 assert.equal(resolved(c).element.fill,'#ff0055');assert.equal(resolved(c).element.style.radius,40);assert.equal(resolved(c).css['letter-spacing'],'2px');assert.deepEqual(find(c).text,beforeText);
 c.resetDesignOverrides([id],'fill');assert.equal(resolved(c).element.fill,'#00aa88');assert.match(resolved(c).css.background,/#2563eb/);
 c.setStyleTokens(tokens.map(t=>t.id==='accent'?{...t,value:'#ef4444'}:t));assert.match(resolved(c).css.background,/#ef4444/);
 const read=c.readCommittedSnapshot().value;assert.ok(read.resolvedStyles.some(s=>s.elementId===id));
});
test('direct text/stroke/effects override matching advanced CSS while untouched CSS remains inherited',()=>{
 const c=setup();c.setDesignOverrides([id],{css:{color:'#ff0000','font-size':'12px',filter:'blur(10px)','border-color':'#ff0000'}});
 c.setTextStyle(id,{color:'#00ff00',fontSize:48});c.setStroke(id,{color:'#00aaff'});c.setVisualStyle(id,{blur:3});
 const r=resolved(c);assert.equal(r.element.text.textStyle.color,'#00ff00');assert.equal(r.element.text.textStyle.fontSize,48);assert.equal(r.element.stroke.color,'#00aaff');assert.equal(r.element.style.blur,3);
 for(const key of['color','font-size','filter','border-color'])assert.equal(r.css[key],undefined);assert.equal(r.css['letter-spacing'],'1px');
 c.setDesignOverrides([id],{fill:'#abcdef',css:{background:'linear-gradient(#112233,#445566)'}});assert.match(resolved(c).css.background,/#112233/);
});
test('automatic states, per-state overrides and enabled state remain author data with one-step history',()=>{
 const c=setup(),before=stable(c);c.setDesignState([id],'hover',{fill:'#ffaa00',css:{'letter-spacing':'3px'}});assert.equal(c.undoCount,before.undo+1);assert.equal(resolved(c,id,'hover').element.fill,'#ffaa00');assert.equal(resolved(c,id,'hover').element.style.opacity,.6);assert.equal(resolved(c,id,'hover').css['letter-spacing'],'3px');
 c.undo();assert.deepEqual(c.document,before.document);c.redo();c.setDesignEnabled([id],false);assert.equal(find(c).design.disabled,true);c.setDesignEnabled([id],true);assert.equal(find(c).design.disabled,undefined);
 c.setDesignState([id],'hover',null);assert.equal(resolved(c,id,'hover').element.style.opacity,.6);assert.equal(resolved(c,id,'hover').element.fill,'#112233');
});
test('style detach/remove preserve resolved base and all automatic states without dangling IDs',()=>{
 const c=setup(),before=captureDesignAppearance(find(c),c.document),hover=captureDesignAppearance(resolved(c,id,'hover').element,c.document),css=resolved(c,id,'hover').css;
 c.detachStyleRecipe([id]);assert.equal(find(c).design?.recipeId,undefined);assert.deepEqual(captureDesignAppearance(find(c),c.document),before);assert.deepEqual(resolved(c,id,'hover').css,css);assert.deepEqual(captureDesignAppearance(resolved(c,id,'hover').element,c.document),hover);
 c.applyStyleRecipe([id],'style-card');const expected=captureDesignAppearance(find(c),c.document);c.removeStyleRecipe('style-card');assert.deepEqual(c.document.styleRecipes,[]);assert.equal(find(c).design?.recipeId,undefined);assert.deepEqual(captureDesignAppearance(find(c),c.document),expected);
 assert.deepEqual(parsePresentation(exportPresentation(c.document)),c.document);
});
test('invalid tokens, unknown references, unsupported geometry CSS and bad recipes reject atomically',()=>{
 const c=setup();for(const command of[
  {id:'design.set_tokens',params:{tokens:tokens.filter(t=>t.id!=='accent')}},
  {id:'design.set_tokens',params:{tokens:[{id:'a',name:'a',type:'color',value:'var(--v-b)'},{id:'b',name:'b',type:'color',value:'var(--v-a)'}]}},
  {id:'design.set_overrides',params:{elementIds:[id],appearance:{css:{transform:'translateX(2px)'}}}},
  {id:'design.set_overrides',params:{elementIds:[id],appearance:{css:{background:'url(https://example.test/image.png)'}}}},
  {id:'design.recipe_apply',params:{elementIds:[id],recipeId:'absent'}},
 ]){const before=stable(c),result=evaluateCommand(c.document,command);assert.equal(result.ok,false,command.id);assert.deepEqual(stable(c),before);}
 c.setElementFlags(id,{locked:true});const before=stable(c);assert.throws(()=>c.setDesignOverrides([id],{fill:'#112233'}),/잠긴/);assert.deepEqual(stable(c),before);
});
test('flow creation, nested layout, resize/order and remove materialize one shared canonical geometry',()=>{
 const c=setup(),before=stable(c),containerId=c.createFlow([id,title],flow);assert.equal(c.undoCount,before.undo+1);const container=find(c,containerId),children=container.flow.children;
 assert.deepEqual(children,[id,title]);assert.ok(c.document.slides[0].elements.indexOf(container)<c.document.slides[0].elements.indexOf(find(c)));
 assert.equal(find(c).geometry.x,container.geometry.x+24);assert.equal(find(c,title).geometry.x,find(c).geometry.x+find(c).geometry.width+16);assert.equal(flowParent(c.document.slides[0],id).id,containerId);
 const canonical=normalizeDocument(c.document);assert.deepEqual(canonical,c.document);assert.deepEqual(resolveFlowSlide(c.document.slides[0]),c.document.slides[0]);
 c.setGeometry(containerId,{x:container.geometry.x+100,y:container.geometry.y+50});assert.equal(find(c).geometry.x,container.geometry.x+124);assert.equal(find(c).geometry.y,container.geometry.y+74);
 c.setFlow(containerId,{...flow,direction:'grid',align:'stretch',columns:2,children:[title,id]});const grid=clone(c.document);assert.equal(find(c,title).geometry.x,find(c,containerId).geometry.x+24);assert.ok(find(c).geometry.x>find(c,title).geometry.x);
 assert.deepEqual(parsePresentation(exportPresentation(c.document)),c.document);c.removeFlow(containerId);assert.equal(find(c,containerId).flow,undefined);assert.deepEqual(find(c).geometry,grid.slides[0].elements.find(e=>e.id===id).geometry);c.undo();assert.deepEqual(c.document,grid);
});
test('flow geometry ownership, duplicate parents/cycles/cross-page members and locked members reject without mutation',()=>{
 const c=setup(),container=c.createFlow([id,title],flow);const before=stable(c);
 for(const command of[
  {id:'element.set_geometry',params:{elementId:id,geometry:{x:999}}},
  {id:'flow.set',params:{elementId:container,flow:{...flow,children:[id,id]}}},
  {id:'flow.set',params:{elementId:container,flow:{...flow,children:[container]}}},
  {id:'flow.set',params:{elementId:id,flow:{...flow,children:[container]}}},
  {id:'flow.set',params:{elementId:container,flow:{...flow,children:['missing']}}},
  {id:'element.set_rotation',params:{elementId:container,rotation:30}},
 ]){assert.equal(evaluateCommand(c.document,command).ok,false,command.id);assert.deepEqual(stable(c),before);}
 c.setGeometry(id,{width:520});assert.equal(find(c,title).geometry.x,find(c).geometry.x+520+16);
 c.setElementFlags(title,{locked:true});const locked=stable(c);assert.throws(()=>c.setGeometry(container,{width:1000}),/잠긴/);assert.deepEqual(stable(c),locked);
});
test('deleting a member or container cleans flow membership and duplication remaps all children',()=>{
 const c=setup(),container=c.createFlow([id,title],flow),before=clone(c.document);c.deleteElement(title);assert.deepEqual(find(c,container).flow.children,[id]);c.undo();assert.deepEqual(c.document,before);
 c.selectElements([container],{expandGroups:false});const payload=c.copyElements([container]);assert.equal(payload.version,3);assert.equal(payload.elements.length,3);const pasted=c.pasteElements(payload),copyContainer=pasted.map(key=>find(c,key)).find(e=>e.flow);assert.ok(copyContainer);assert.deepEqual(new Set(copyContainer.flow.children),new Set(pasted.filter(key=>key!==copyContainer.id)));assert.ok(copyContainer.flow.children.every(key=>![id,title].includes(key)));
 c.deleteElement(container);assert.ok(find(c,id));assert.equal(flowParent(c.document.slides[0],id),undefined);
});
test('same-document copy keeps style links while cross-document copy freezes resolved CSS/tokens and remaps flow',()=>{
 const source=setup(),container=source.createFlow([id,title],flow),payload=source.copyElements([container]);source.pasteElements(payload);assert.ok(source.selectedElements.find(e=>e.design?.recipeId==='style-card'));
 const dest=new CommandController(fixture),incoming=dest.pasteElements(payload),copied=incoming.map(key=>find(dest,key)).find(e=>e.design);assert.equal(copied.design.recipeId,undefined);assert.equal(dest.document.styleRecipes,undefined);assert.match(resolveDesignElement(copied,dest.document).css.background,/#2563eb/);
 assert.deepEqual(parsePresentation(exportPresentation(dest.document)),dest.document);
 const fromSlide=new CommandController(fixture);const imported=fromSlide.importSlides(source.document,[source.document.slides[0].id]);assert.equal(imported.length,1);assert.ok(fromSlide.document.slides.find(s=>s.id===imported[0]).elements.some(e=>e.flow));
});
test('guarded design batches preserve dryRun/atomic rollback and one Undo, with design library changes in receipt summaries',async()=>{
 const c=new CommandController(fixture),commands=[{id:'design.set_tokens',params:{tokens}},{id:'design.recipe_upsert',params:{recipe:recipe()}},{id:'design.recipe_apply',params:{elementIds:[id],recipeId:'style-card'}}],before=stable(c);
 const dry=await c.applyCommands(guard(c,commands,{dryRun:true}));assert.equal(dry.ok,true);assert.equal(dry.value.summary.styleRecipesChanged,true);assert.deepEqual(stable(c),before);
 const bad=await c.applyCommands(guard(c,[...commands,{id:'design.recipe_apply',params:{elementIds:['missing'],recipeId:'style-card'}}]));assert.equal(bad.ok,false);assert.deepEqual(stable(c),before);
 const result=await c.applyCommands(guard(c,commands));assert.equal(result.ok,true);assert.equal(c.undoCount,1);assert.equal(result.value.summary.styleTokensChanged,true);assert.ok(result.value.summary.affectedStyleElementIds.includes(id));const after=clone(c.document);c.undo();assert.deepEqual(c.document,before.document);c.redo();assert.deepEqual(c.document,after);
});
test('nested flow is canonical across raw load, outer moves and repeated normalization',()=>{
 const c=setup(),inner=c.createFlow([id,title],{...flow,direction:'column'});
 const extra=c.addShape('rectangle'),outer=c.createFlow([inner,extra],{...flow,direction:'row',align:'start'}),before=clone(c.document);
 const x=find(c).geometry.x,y=find(c).geometry.y;c.setGeometry(outer,{x:find(c,outer).geometry.x+100,y:find(c,outer).geometry.y+50});assert.equal(find(c).geometry.x,x+100);assert.equal(find(c).geometry.y,y+50);
 const stale=clone(c.document);stale.slides[0].elements.find(e=>e.id===id).geometry.x=-9999;assert.deepEqual(normalizeDocument(stale),c.document);assert.deepEqual(normalizeDocument(normalizeDocument(stale)),c.document);c.undo();assert.deepEqual(c.document,before);
});
test('ordinary editing and rich text snapshots never downgrade a design document or discard style links',()=>{
 const c=setup();c.setMotions(c.activeSlideId,[{id:'design-motion',targetId:id,preset:'keyframes',start:'withPrevious',duration:1000,delay:0,easing:'linear',iterations:1,keyframes:[{offset:0,x:0},{offset:1,x:50}]}]);
 c.beginText(id);c.updateRichText({paragraphs:['편집된 카드'],runs:[{paragraph:0,start:0,end:3,bold:true}]});const saved=c.snapshot();assert.equal(saved.schemaVersion,DESIGN_SCHEMA);assert.equal(saved.styleRecipes.length,1);assert.equal(saved.slides[0].motions[0].preset,'keyframes');c.finishText();assert.equal(c.document.schemaVersion,DESIGN_SCHEMA);assert.equal(find(c).design.recipeId,'style-card');assert.deepEqual(parsePresentation(exportPresentation(c.document)),c.document);
});
test('flow rejects arithmetic overflow rather than returning non-finite committed geometry',()=>{
 const c=setup(),container=c.createFlow([id,title],flow),raw=clone(c.document);raw.slides[0].elements.find(e=>e.id===container).geometry.x=1e308;for(const e of raw.slides[0].elements.filter(e=>[id,title].includes(e.id)))e.geometry.width=1e308;assert.throws(()=>normalizeDocument(raw),/기하 범위/);assert.ok(Number.isFinite(find(c).geometry.x));
});
test('changing flow direction/gap grows its owner while too-small direct resizing rejects clearly',()=>{
 const c=setup(),container=c.createFlow([id,title],flow),before=find(c,container).geometry;c.setFlow(container,{...flow,direction:'column',gap:100,children:[id,title]});const column=find(c,container);assert.ok(column.geometry.height>=find(c).geometry.height+find(c,title).geometry.height+100+48);assert.ok(column.geometry.width>=before.width);
 const stableBefore=stable(c);assert.throws(()=>c.setGeometry(container,{width:20,height:20}),/内容|내용|크기/);assert.deepEqual(stable(c),stableBefore);
 const parentWidth=column.geometry.width;c.setGeometry(id,{width:parentWidth+100});assert.ok(find(c,container).geometry.width>=parentWidth+148);
 c.setFlow(container,{...flow,direction:'grid',align:'stretch',columns:2,children:[id,title]});const g=find(c,container).geometry;assert.ok(find(c,title).geometry.x+find(c,title).geometry.width<=g.x+g.width-24+.00001);
});
test('format copy preserves resolved CSS/state appearance while excluding enabled behavior and flow membership',()=>{
 const c=setup();c.setDesignEnabled([id],false);const format=c.copyFormat(id);assert.equal(format.design?.disabled,undefined);assert.equal(format.flow,undefined);c.pasteFormat([title],format);assert.equal(find(c,title).design?.disabled,undefined);assert.equal(resolved(c,title).css.background,resolved(c).css.background);assert.equal(resolved(c,title,'hover').element.style.opacity,.6);
});
test('typed image placeholders and filling retain the full source design, disabled flag and stable owner geometry',()=>{
 const c=setup(),image='element-image-001',source=clone(find(c,image));c.switchSlide(c.document.slides.find(s=>s.elements.some(e=>e.id===image)).id);c.applyStyleRecipe([image],'style-card');c.setDesignOverrides([image],{css:{border:'2px solid #ffaa00'}});c.setDesignEnabled([image],false);const design=clone(find(c,image).design);c.captureLayout(c.activeSlideId,'스타일 이미지','styled-image-layout',[image]);const slideId=c.createSlideFromLayout('styled-image-layout'),slide=c.document.slides.find(s=>s.id===slideId),target=slide.layout.elementMap[image],before=clone(find(c,target)),slot=c.document.layouts.find(l=>l.id==='styled-image-layout').slots[0];assert.deepEqual(before.design,design);c.fillLayoutSlot(slideId,slot.key,source);assert.deepEqual(find(c,target).design,design);assert.equal(find(c,target).id,before.id);assert.deepEqual(find(c,target).geometry,before.geometry);assert.deepEqual(parsePresentation(exportPresentation(c.document)),c.document);
});
test('same document and recipe IDs across divergent branches do not replace copied source appearance with the target style',()=>{
 const source=setup(),target=setup();source.setDesignOverrides([id],{css:{color:'var(--v-accent)'}});target.upsertStyleRecipe(recipe({appearance:{fill:'#ff0000',style:{radius:99}}}));const expected=resolved(source),payload=source.copyElements([id]),copied=target.pasteElements(payload)[0];assert.equal(find(target,copied).design.recipeId,undefined);assert.equal(resolved(target,copied).element.fill,expected.element.fill);assert.equal(resolved(target,copied).element.style.radius,expected.element.style.radius);assert.deepEqual(resolved(target,copied).css,expected.css);
 const same=source.pasteElements(payload)[0];assert.equal(find(source,same).design.recipeId,'style-card');
});
test('same-ID fork imports retain an isolated source layout while exact local duplication keeps its existing family',()=>{
 const source=setup();source.captureLayout(source.activeSlideId,'분기 레이아웃','fork-layout',[id,title]);const sourceSlide=source.activeSlideId,emptyTarget=new CommandController(fixture),imported=emptyTarget.importSlides(source.document,[sourceSlide])[0];assert.ok(emptyTarget.document.layouts.some(layout=>layout.id===emptyTarget.document.slides.find(s=>s.id===imported).layout.layoutId));assert.ok(emptyTarget.document.slides.find(s=>s.id===imported).elements.some(e=>e.design));
 const differentTarget=new CommandController(source.document),layout=differentTarget.document.layouts.find(l=>l.id==='fork-layout');differentTarget.updateLayout(layout.id,{name:layout.name,canvas:clone(layout.canvas),background:'#ffeecc',elements:clone(layout.elements),placeholderIds:clone(layout.placeholderIds),slots:clone(layout.slots)});const other=differentTarget.importSlides(source.document,[sourceSlide])[0];assert.notEqual(differentTarget.document.slides.find(s=>s.id===other).layout.layoutId,'fork-layout');assert.equal(differentTarget.document.layouts.find(layout=>layout.id==='fork-layout').background,'#ffeecc');
 const duplicate=source.duplicateSlides([sourceSlide])[0];assert.equal(source.document.slides.find(s=>s.id===duplicate).layout.layoutId,'fork-layout');assert.ok(source.document.slides.find(s=>s.id===duplicate).elements.some(e=>e.design?.recipeId==='style-card'));
});
test('closed master imports retain source inheritance, shared styles and locking without replacing the target library',()=>{
 const c=setup(),element=clone(find(c));element.id='source-common-card';const masterId=c.createLayoutMaster({masterId:'source-common',name:'원본 공통',canvas:{width:1280,height:720},background:'#ffffff',elements:[element]}),layoutId=c.insertLayout({layoutId:'source-child',name:'하위',canvas:{width:1280,height:720},background:'#ffffff',elements:[],placeholderIds:[],masterId}),slideId=c.createSlideFromLayout(layoutId),slide=c.document.slides.find(s=>s.id===slideId);assert.equal(slide.elements[0].locked,true);const target=new CommandController(fixture),imported=target.importSlides(c.document,[slideId])[0],page=target.document.slides.find(s=>s.id===imported);assert.ok(target.document.layouts.some(layout=>layout.id===page.layout.layoutId));assert.equal(page.elements[0].locked,true);assert.ok(target.document.styleRecipes.some(recipe=>recipe.id===page.elements[0].design.recipeId));assert.equal(resolveDesignElement(page.elements[0],target.document).element.style.radius,24);
});
test('layout scaling rescales logical flow spacing once without mutating its source definitions',()=>{
 for(const direction of ['row','column','grid']){const c=setup(),container=c.createFlow([id,title],{...flow,direction}),layoutId='scale-flow-'+direction;c.captureLayout(c.activeSlideId,'비율별 자동 배치',layoutId,[id,title]);const original=clone(c.document.layouts.find(l=>l.id===layoutId));c.resizeCanvas(720,1280,'keep');const slideId=c.createSlideFromLayout(layoutId),slide=c.document.slides.find(s=>s.id===slideId),owner=slide.elements.find(e=>e.id===slide.layout.elementMap[container]),x=720/1280,y=1280/720;assert.equal(owner.flow.gap,16*(direction==='row'?x:direction==='column'?y:Math.min(x,y)));assert.equal(owner.flow.padding,24*Math.min(x,y));assert.deepEqual(c.document.layouts.find(l=>l.id===layoutId),original);assert.deepEqual(parsePresentation(exportPresentation(c.document)),c.document);}
});
