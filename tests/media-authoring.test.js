import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {VIDEO_MAX_BYTES,MEDIA_TOTAL_MAX_BYTES,DEFAULT_VIDEO_SETTINGS,normalizeVideoSettings,validateMediaAsset,validateMediaBudget,pruneUnreferencedVideoAssets} from '../src/media-model.js';
import {videoContent} from '../src/media-render.js';
import {normalizeMotionValue,motionSchemas,validateMotionReferences,cleanMotionReferences,validExternalLink} from '../src/motion-model.js';
import {CommandController} from '../src/controller.js';
import {exportPresentation,parsePresentation} from '../src/format.js';
const bytes=fs.readFileSync(new URL('./fixtures/media/clip.webm',import.meta.url));
export const sampleMediaAsset={id:'media-test-asset',mimeType:'video/webm',width:320,height:180,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),dataBase64:bytes.toString('base64')};
const sampleElement={id:'media-test-video',type:'video',assetId:sampleMediaAsset.id,alt:'동영상 <예제>',geometry:{x:100,y:100,width:640,height:360},video:{...DEFAULT_VIDEO_SETTINGS}};
const control={id:'media-test-button',type:'shape'};
const document=()=>({assets:[structuredClone(sampleMediaAsset)],slides:[{id:'media-test-slide',elements:[structuredClone(sampleElement),control],interactions:[{id:'media-test-click',sourceId:control.id,event:'click',actions:[{type:'playVideo',targetId:sampleElement.id}]}]},{id:'media-test-next',elements:[]}]});

test('a reusable video keeps its original asset and poster after deleting the last rendered member, with shared Undo and editable HTML reuse',()=>{
  const c=new CommandController(),poster=JSON.parse(fs.readFileSync(new URL('../examples/document-contract-v0.1.json',import.meta.url),'utf8')).assets[0],element={...structuredClone(sampleElement),video:{...DEFAULT_VIDEO_SETTINGS,posterAssetId:poster.id}};
  c.run('elements.insert',{slideId:c.activeSlideId,elements:[element],assets:[structuredClone(sampleMediaAsset),poster]});c.selectElements([element.id]);const componentId=c.captureComponent({name:'영상 카드'}),before=c.snapshot(),undo=c.undoCount;
  c.deleteElement(element.id);assert.equal(c.undoCount,undo+1);assert.equal(c.activeSlide.elements.length,0);assert.equal(c.document.componentLibrary[0].elements[0].assetId,sampleMediaAsset.id);assert.equal(c.document.componentLibrary[0].elements[0].video.posterAssetId,poster.id);assert.deepEqual(c.document.assets,before.assets);
  const afterDelete=c.snapshot();c.undo();assert.deepEqual(c.snapshot(),before);c.redo();assert.deepEqual(c.snapshot(),afterDelete);const instanceId=c.insertComponent(componentId),instance=c.activeSlide.componentInstances.find(item=>item.id===instanceId),video=c.activeSlide.elements.find(item=>Object.values(instance.elementMap).includes(item.id)&&item.type==='video');
  assert.ok(video);assert.equal(video.assetId,sampleMediaAsset.id);assert.equal(video.video.posterAssetId,poster.id);assert.deepEqual(c.document.assets,before.assets);assert.deepEqual(parsePresentation(exportPresentation(c.snapshot())),c.snapshot());
});
test('local media checks closed settings, real WebM signature, byte lengths and file/total budgets',()=>{
  assert.equal(validateMediaAsset(sampleMediaAsset),sampleMediaAsset);assert.deepEqual(normalizeVideoSettings(DEFAULT_VIDEO_SETTINGS,[]),DEFAULT_VIDEO_SETTINGS);
  for(const change of [a=>a.mimeType='text/html',a=>a.mimeType='video/mp4',a=>a.bytes=VIDEO_MAX_BYTES+1,a=>a.bytes++,a=>a.width=0,a=>a.dataBase64='" onerror="x']){const asset=structuredClone(sampleMediaAsset);change(asset);assert.throws(()=>validateMediaAsset(asset));}
  assert.throws(()=>normalizeVideoSettings({...DEFAULT_VIDEO_SETTINGS,script:'x'},[]));assert.throws(()=>normalizeVideoSettings({...DEFAULT_VIDEO_SETTINGS,posterAssetId:'missing'},[]));
  assert.equal(validateMediaBudget([sampleMediaAsset]),true);assert.throws(()=>validateMediaBudget(Array.from({length:Math.floor(MEDIA_TOTAL_MAX_BYTES/bytes.length)+1},()=>sampleMediaAsset)),/64MB/);
});
test('video markup stores only an asset reference while poster/static output and labels remain inert',()=>{
  const doc=document(),html=videoContent(sampleElement,doc);assert.ok(html.includes('data-video-asset-id="media-test-asset"'));assert.ok(!html.includes(sampleMediaAsset.dataBase64));assert.ok(!/\ssrc=/.test(html));assert.ok(html.includes('&lt;예제&gt;'));assert.match(videoContent(sampleElement,doc,{interactive:true}),/data-media-editor/);
  const staticMarkup=videoContent(sampleElement,doc,{staticState:{}});assert.ok(!staticMarkup.includes('<video'));assert.match(staticMarkup,/발표에서 재생되는 동영상/);
  const corrupt=document();corrupt.assets[0].dataBase64='" onerror="x';assert.throws(()=>videoContent(sampleElement,corrupt));
});
test('media actions and ended events validate same-page video references and clean only removed targets',()=>{
  const doc=document();doc.slides[0].interactions.push({id:'media-ended',sourceId:sampleElement.id,event:'ended',actions:[{type:'goToSlide',targetId:'media-test-next'}]});validateMotionReferences(doc,new Set());
  for(const type of ['playVideo','pauseVideo','stopVideo'])assert.deepEqual(normalizeMotionValue({type,targetId:sampleElement.id},motionSchemas.action),{type,targetId:sampleElement.id});
  const invalid=document();invalid.slides[0].interactions[0].actions[0].targetId=control.id;assert.throws(()=>validateMotionReferences(invalid,new Set()),/동영상/);
  const wrongSource=document();wrongSource.slides[0].interactions[0].event='ended';assert.throws(()=>validateMotionReferences(wrongSource,new Set()),/동영상/);
  doc.slides[0].elements=doc.slides[0].elements.filter(e=>e.id!==sampleElement.id);cleanMotionReferences(doc);assert.deepEqual(doc.slides[0].interactions,[]);
});
test('external object links are closed URL data and survive unrelated target cleanup',()=>{
  for(const href of ['https://example.com/report','http://example.com','mailto:team@example.com'])assert.equal(validExternalLink(href),true);
  for(const href of ['javascript:alert(1)','file:///C:/secret','https://user:pass@example.com','https://example.com/has space','data:text/html,x','https://example.com/\u0000'])assert.equal(validExternalLink(href),false);
  const doc=document();doc.slides[0].interactions[0].actions=[{type:'openLink',href:'https://example.com/report'}];validateMotionReferences(doc,new Set());cleanMotionReferences(doc);assert.equal(doc.slides[0].interactions[0].actions[0].type,'openLink');
  doc.slides[0].interactions[0].actions[0].href='javascript:alert(1)';assert.throws(()=>validateMotionReferences(doc,new Set()),/openLink/);
});
test('local media insertion/settings keep a single shared Undo and editable HTML stores bytes once',()=>{
  const c=new CommandController(),before=c.snapshot();c.insertMedia(structuredClone(sampleElement),[structuredClone(sampleMediaAsset)]);const inserted=c.snapshot();assert.equal(c.undoCount,1);assert.equal(c.selectedElement.type,'video');assert.equal(c.document.assets[0].dataBase64,sampleMediaAsset.dataBase64);c.undo();assert.deepEqual(c.snapshot(),before);c.redo();assert.deepEqual(c.snapshot(),inserted);
  c.setVideo(sampleElement.id,{...DEFAULT_VIDEO_SETTINGS,muted:true,loop:true});assert.equal(c.undoCount,2);const settings=c.snapshot();c.undo();assert.deepEqual(c.snapshot(),inserted);c.redo();assert.deepEqual(c.snapshot(),settings);const html=exportPresentation(settings);assert.equal(html.split(sampleMediaAsset.dataBase64).length-1,1);assert.deepEqual(parsePresentation(html),settings);
});
test('video copying and cross-document import retain local bytes and remap media action targets',()=>{
  const c=new CommandController();c.insertMedia(structuredClone(sampleElement),[structuredClone(sampleMediaAsset)]);const button=c.addShape('round-rect');c.setInteractions(c.activeSlideId,[{id:'copy-media-rule',sourceId:button,event:'click',actions:[{type:'playVideo',targetId:sampleElement.id}]}]);
  const payload=c.copyElements([sampleElement.id,button]),target=new CommandController();target.pasteElements(payload);const copied=target.activeSlide.elements.find(e=>e.type==='video');assert.ok(copied);assert.notEqual(copied.id,sampleElement.id);assert.equal(target.document.assets.find(a=>a.id===copied.assetId).dataBase64,sampleMediaAsset.dataBase64);assert.equal(target.activeSlide.interactions[0].actions[0].targetId,copied.id);assert.deepEqual(parsePresentation(exportPresentation(target.document)),target.snapshot());
});
test('explicit deletion pruning frees unused video bytes while keeping layouts and every original image',()=>{
  const doc=document(),layoutVideo={...structuredClone(sampleElement),id:'layout-video',assetId:'layout-only-video'},unused={...structuredClone(sampleMediaAsset),id:'unused-video'},retained={...structuredClone(sampleMediaAsset),id:'layout-only-video'},image={id:'original-image',mimeType:'image/jpeg',bytes:100};doc.assets.push(unused,retained,image);doc.layouts=[{id:'layout-reference',elements:[layoutVideo]}];
  assert.deepEqual(pruneUnreferencedVideoAssets(doc),['unused-video']);assert.ok(doc.assets.some(a=>a.id===sampleMediaAsset.id));assert.ok(doc.assets.some(a=>a.id==='layout-only-video'));assert.ok(doc.assets.some(a=>a.id===image.id));
  doc.slides[0].elements=doc.slides[0].elements.filter(e=>e.type!=='video');assert.deepEqual(pruneUnreferencedVideoAssets(doc),[sampleMediaAsset.id]);assert.ok(doc.assets.some(a=>a.id==='layout-only-video'));doc.layouts=[];assert.deepEqual(pruneUnreferencedVideoAssets(doc),['layout-only-video']);assert.deepEqual(doc.assets,[image]);
});
test('shared delete frees video capacity and Undo restores original bytes and action references',()=>{
  const c=new CommandController();c.insertMedia(structuredClone(sampleElement),[structuredClone(sampleMediaAsset)]);const button=c.addShape('round-rect');c.setInteractions(c.activeSlideId,[{id:'deleted-media-rule',sourceId:button,event:'click',actions:[{type:'playVideo',targetId:sampleElement.id}]}]);const before=c.snapshot(),count=c.undoCount;c.deleteElement(sampleElement.id);const deleted=c.snapshot();assert.equal(c.undoCount,count+1);assert.ok(!deleted.assets.some(a=>a.mimeType.startsWith('video/')));assert.deepEqual(deleted.slides[0].interactions,[]);c.undo();assert.deepEqual(c.snapshot(),before);c.redo();assert.deepEqual(c.snapshot(),deleted);
});
test('repeated insertion deduplicates media bytes and retains layout-owned source when its slide object is deleted',()=>{
  const c=new CommandController();c.insertMedia(structuredClone(sampleElement),[structuredClone(sampleMediaAsset)]);const again={...structuredClone(sampleElement),id:'second-video',assetId:'second-asset'},same={...structuredClone(sampleMediaAsset),id:'second-asset'};c.insertMedia(again,[same]);assert.equal(c.document.assets.length,1);assert.equal(c.document.slides[0].elements.find(e=>e.id===again.id).assetId,sampleMediaAsset.id);
  c.captureLayout(c.activeSlideId,'동영상 마스터');const captured=c.snapshot();c.deleteElements([sampleElement.id,again.id]);assert.equal(c.document.assets.length,1);assert.equal(c.document.layouts[0].elements.filter(e=>e.type==='video').length,2);c.undo();assert.deepEqual(c.snapshot(),captured);
});
