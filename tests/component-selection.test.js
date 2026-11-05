import test from 'node:test';
import assert from 'node:assert/strict';
import {CommandController} from '../src/controller.js';

test('human component insertion selects its whole movable frame; explicit individual editing remains available',()=>{
  const c=new CommandController(),background=c.addShape(),text=c.addText(),component=c.captureComponent({slideId:c.activeSlideId,elementIds:[background,text],name:'업무 카드'}),before=c.undoCount;
  const id=c.insertComponent(component),instance=c.activeSlide.componentInstances.find(item=>item.id===id);
  assert.deepEqual(new Set(c.selectedIds),new Set([instance.wrapperId,...Object.values(instance.elementMap)]));assert.equal(c.undoCount,before+1);
  const member=Object.values(instance.elementMap)[0];c.selectElements([member],{expandGroups:false});assert.deepEqual(c.selectedIds,[member]);assert.equal(c.undoCount,before+1);
});
