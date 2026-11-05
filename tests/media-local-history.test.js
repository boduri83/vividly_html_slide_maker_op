import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { CommandController } from '../src/controller.js';
import { DEFAULT_VIDEO_SETTINGS } from '../src/media-model.js';
import { evaluateCommand,COMMAND_LIMITS } from '../src/commands.js';
test('trusted local video staging accepts bytes above wire limits, deduplicates reuse and deletes bytes with shared Undo',()=>{
  const c=new CommandController(),data=Buffer.alloc(COMMAND_LIMITS.bytes+4096);data.set([0x1a,0x45,0xdf,0xa3]);
  // Container signature is sufficient for the model; actual playable WebM decoding has a separate browser test.
  const asset={id:'local-large',mimeType:'video/webm',width:320,height:180,bytes:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex'),dataBase64:data.toString('base64')};
  const video=id=>({id,type:'video',geometry:{x:80,y:80,width:640,height:360},assetId:asset.id,alt:'내부 미디어',video:{...DEFAULT_VIDEO_SETTINGS}});
  const before=c.snapshot();assert.equal(evaluateCommand(before,{id:'elements.insert',params:{slideId:c.activeSlideId,elements:[video('wire-video')],assets:[asset]}}).ok,false);
  c.insertMedia(video('local-video'),[asset]);const inserted=c.snapshot();assert.equal(c.undoCount,1);assert.equal(c.document.assets.length,1);assert.equal(c.selectedId,'local-video');
  c.undo();assert.deepEqual(c.snapshot(),before);c.redo();assert.deepEqual(c.snapshot(),inserted);assert.equal(c.selectedId,'local-video');
  c.insertMedia({...video('local-video-2'),assetId:'same-content'},[{...asset,id:'same-content'}]);assert.equal(c.document.assets.length,1);assert.equal(c.activeSlide.elements[1].assetId,asset.id);
  c.deleteElement('local-video');assert.equal(c.document.assets.length,1);const priorDelete=c.snapshot();c.deleteElement('local-video-2');assert.equal(c.document.assets.length,0);c.undo();assert.deepEqual(c.snapshot(),priorDelete);c.redo();assert.equal(c.document.assets.length,0);
});
