import test from 'node:test';
import assert from 'node:assert/strict';
import {CommandController} from '../src/controller.js';
import {projectResponsiveSlide} from '../src/responsive-model.js';

test('a hidden root flow releases its source height for following sections while fixed-slide geometry stays authored',()=>{
  const c=new CommandController();
  const text=(id,value,y,height)=>({id,type:'text',geometry:{x:80,y,width:600,height},text:{paragraphs:[value],textStyle:{fontFamily:'Malgun Gothic',fontSize:20,lineHeight:1.3,color:'#17233b',align:'left',verticalAlign:'top'}}});
  c.run('elements.insert',{slideId:c.activeSlideId,assets:[],elements:[{...text('details','',100,200),flow:{direction:'column',columns:1,gap:10,padding:0,align:'stretch',justify:'start',children:['detail-text']}},text('detail-text','설명',100,100),text('following','다음 구간',400,50)]});
  c.run('document.set_responsive',{responsive:{enabled:true,minWidth:320,maxWidth:1280}});
  const document=c.snapshot(),before=structuredClone(document),visible=projectResponsiveSlide(document.slides[0],document,1280);
  const hidden=structuredClone(document.slides[0]);hidden.elements.find(e=>e.id==='details').hidden=true;hidden.elements.find(e=>e.id==='detail-text').hidden=true;
  const collapsed=projectResponsiveSlide(hidden,document,1280);
  assert.equal(collapsed.slide.elements.find(e=>e.id==='following').geometry.y,200);
  assert.ok(collapsed.slide.elements.find(e=>e.id==='following').geometry.y<visible.slide.elements.find(e=>e.id==='following').geometry.y);
  const fixed=projectResponsiveSlide(hidden,{...document,responsive:{...document.responsive,enabled:false}},1280);assert.equal(fixed.slide.elements.find(e=>e.id==='following').geometry.y,400);
  assert.deepEqual(document,before);
});
