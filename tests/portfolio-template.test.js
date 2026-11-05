import test from 'node:test';import assert from 'node:assert/strict';
import {createPortfolioTemplate,PORTFOLIO_PROJECTS} from '../src/portfolio-template.js';import {normalizeDocument} from '../src/model.js';import {CommandController} from '../src/controller.js';import {exportPresentation,parsePresentation} from '../src/format.js';import {projectResponsiveSlide} from '../src/responsive-model.js';

test('portfolio starter contains six editable sections, linked cards, local profile and model-only vector art',()=>{
 const document=createPortfolioTemplate(),slide=document.slides[0];assert.deepEqual(normalizeDocument(document),document);assert.equal(document.componentLibrary.length,1);assert.equal(slide.componentInstances.length,6);assert.equal(document.webForms.length,1);assert.deepEqual(document.webForms[0].fields.map(field=>field.type),['text','text','textarea','email']);assert.equal(document.webForms[0].persistence,'local');
 assert.equal(slide.elements.filter(element=>element.web?.kind==='filterItem').length,6);assert.equal(slide.elements.filter(element=>element.web?.kind==='filterButton').length,4);assert.ok(slide.elements.filter(element=>element.component?.kind==='panel').length>=7);assert.equal(slide.elements.filter(element=>element.web?.kind==='scrollLink').length,5);assert.equal(document.responsive.showControls,false);
 for(const id of ['hero','approach','projects','experience','about','contact'])assert.ok(slide.elements.some(element=>element.id==='portfolio-'+id));for(const project of PORTFOLIO_PROJECTS)assert.ok(slide.elements.some(element=>element.text?.paragraphs.includes(project.name)));
 assert.ok(slide.elements.filter(element=>element.type==='svg').length>=7);assert.equal(document.assets.length,0);assert.equal(new Set(slide.elements.map(element=>element.id)).size,slide.elements.length);
});

test('portfolio text, vector and component members remain separately editable through Undo and exact HTML reopening',()=>{
 const document=createPortfolioTemplate(),c=new CommandController(document),before=c.snapshot(),id='portfolio-hero-title',art='portfolio-hero-art';c.runBatch([{id:'text.set_content',params:{elementId:id,paragraphs:['새로운 업무를','함께 설계합니다.']}},{id:'element.set_geometry',params:{elementId:art,geometry:{width:480}}}],'포트폴리오 재편집');const after=c.snapshot();c.undo();assert.deepEqual(c.snapshot(),before);c.redo();assert.deepEqual(c.snapshot(),after);
 const html=exportPresentation(c.document);assert.deepEqual(parsePresentation(html),after);assert.match(html,/data-web-presentation="true"/);assert.equal(html.includes('<iframe'),false);assert.equal(html.includes('portfolioProjects ='),false);
});

test('portfolio preview switches readable device typography and collapses to one card column without changing metadata',()=>{
 const document=createPortfolioTemplate(),before=structuredClone(document),phone=projectResponsiveSlide(document.slides[0],document,390),desktop=projectResponsiveSlide(document.slides[0],document,1280),title=phone.slide.elements.find(element=>element.id==='portfolio-hero-title');assert.equal(title.text.textStyle.fontSize,46);assert.equal(phone.width,390);assert.ok(phone.height>desktop.height);
 const cards=phone.slide.elements.filter(element=>element.web?.kind==='filterItem').sort((a,b)=>a.geometry.y-b.geometry.y);assert.ok(cards.every((element,index)=>!index||element.geometry.y>=cards[index-1].geometry.y+cards[index-1].geometry.height));assert.ok(cards.every(element=>element.geometry.width>290));assert.deepEqual(document,before);
});
