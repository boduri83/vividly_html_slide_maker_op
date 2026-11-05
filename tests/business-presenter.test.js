import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PresenterService } from '../desktop/presenter.mjs';

class Window extends EventEmitter{
  static created=[];
  constructor(options){super();this.options=options;this.messages=[];this.destroyed=false;this.webContents=new EventEmitter();this.webContents.mainFrame={url:''};this.webContents.setWindowOpenHandler=handler=>this.popupHandler=handler;this.webContents.send=(channel,value)=>this.messages.push({channel,value});Window.created.push(this);}
  async loadURL(url){this.url=url;this.webContents.mainFrame.url=url;}
  isDestroyed(){return this.destroyed;}
  show(){this.shown=true;}
  focus(){this.focused=true;}
  destroy(){this.destroyed=true;this.emit('closed');}
}
const state=()=>({title:'발표 자료',slideName:'성과',notes:'개인 발표 메모 </script><img src=x>',index:0,total:2,step:1,canNext:true,canPrevious:false,nextTitle:'제안'});

test('presenter notes are separate data messages and the owned window has no page script or node authority',async()=>{
  const service=new PresenterService({BrowserWindow:Window,onCommand(){}});await service.open(state());const win=service.window;
  assert.equal(win.options.webPreferences.nodeIntegration,false);assert.equal(win.options.webPreferences.contextIsolation,true);assert.equal(win.options.webPreferences.sandbox,true);
  assert.match(decodeURIComponent(win.url),/script-src 'none'/);assert.ok(!decodeURIComponent(win.url).includes(state().notes));
  assert.deepEqual(win.messages.at(-1),{channel:'presenter:state',value:state()});assert.deepEqual(win.popupHandler(),{action:'deny'});service.close();
});
test('only the current presenter main frame can send the three navigation commands',async()=>{
  const received=[],service=new PresenterService({BrowserWindow:Window,onCommand:value=>received.push(value)});await service.open(state());const win=service.window,event={sender:win.webContents,senderFrame:win.webContents.mainFrame};
  assert.equal(service.accept({...event,sender:{}},'end'),false);assert.equal(service.accept({...event,senderFrame:{url:win.url}},'next'),false);assert.equal(service.accept(event,'open-file'),false);
  for(const command of ['next','previous','end'])assert.equal(service.accept(event,command),true);assert.deepEqual(received,['next','previous','end']);service.close();assert.equal(service.accept(event,'end'),false);
});
test('presenter state replacement and reopening never require or alter the author document',async()=>{
  const service=new PresenterService({BrowserWindow:Window,onCommand(){}}),original=state();await service.open(original);const first=service.window;
  service.update({...original,index:1,slideName:'제안',notes:'다음 메모',canNext:false,canPrevious:true});assert.equal(first.messages.at(-1).value.notes,'다음 메모');assert.equal(original.notes,state().notes);
  service.close();assert.equal(first.destroyed,true);await service.open(original);assert.notEqual(service.window,first);assert.equal(service.window.messages.at(-1).value.index,0);service.close();
});
test('malformed, oversized or unrelated presenter fields fail before creating an auxiliary window',async()=>{
  const service=new PresenterService({BrowserWindow:Window,onCommand(){}}),count=Window.created.length;
  for(const value of [null,{...state(),index:2},{...state(),notes:'a'.repeat(65537)},{...state(),path:'private-file'}])await assert.rejects(service.open(value));
  assert.equal(Window.created.length,count);assert.equal(service.window,null);
});
