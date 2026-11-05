import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {CommandController} from '../src/controller.js';
import {createBlankDocument,normalizeDocument} from '../src/model.js';
import {createIconSvg} from '../src/icon-catalog.js';
import {exportPresentation,parsePresentation,createStaticExport} from '../src/format.js';
import {VIVIDLY_EXPORT_MPL_NOTICE,LUCIDE_ICON_LICENSE} from '../src/export-license-notices.js';
import {getExportRuntimeSourceBundle} from '../src/export-source-bundle.js';

const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const lf=text=>text.replace(/\r\n/g,'\n');
const own=read('LICENSE'),icons=read('assets/vendor/icons/LICENSE.txt');
const commentIcons=icons.replace(/^---(?=\r?$)/gm,'');
const scriptArchive=/<script type="application\/json" id="vividly-runtime-source">([\s\S]*?)<\/script>/;
const templateArchive=/<template id="vividly-runtime-source" data-format="application\/json">([\s\S]*?)<\/template>/;
const withoutArchive=html=>html.replace(scriptArchive,'').replace(templateArchive,'');
const stripComments=html=>withoutArchive(html).replace(/<!--[\s\S]*?-->/g,'');
const checkComments=html=>{for(const match of html.matchAll(/<!--([\s\S]*?)-->/g))assert.ok(!match[1].includes('--'),'HTML comment bodies must not contain a double hyphen');};
const decodeEntities=value=>value.replace(/&(amp|lt|gt|quot|#39);/g,(_,name)=>({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"})[name]);
const sourceBundle=html=>{const script=scriptArchive.exec(html);if(script)return JSON.parse(script[1]);const template=templateArchive.exec(html);assert.ok(template,'source archive must be present');return JSON.parse(decodeEntities(template[1]));};
function iconDocument(){
  const c=new CommandController(),element={id:'licensed-icon',type:'svg',name:'체크',geometry:{x:80,y:90,width:120,height:120},svg:createIconSvg('check','#2266aa')};
  c.run('elements.insert',{slideId:c.activeSlideId,elements:[element],assets:[]});return c;
}

test('own export notice is MPL-2.0 with copyright/source availability and the pinned Lucide ISC/Feather text stays exact',()=>{
  assert.match(own,/Mozilla Public License Version 2\.0/);assert.match(VIVIDLY_EXPORT_MPL_NOTICE,/Copyright \(c\) 2026 boduri83/);
  assert.match(VIVIDLY_EXPORT_MPL_NOTICE,/This Source Code Form is subject to the terms of the Mozilla Public License, v\. 2\.0/);
  assert.match(VIVIDLY_EXPORT_MPL_NOTICE,/https:\/\/mozilla\.org\/MPL\/2\.0\//);assert.doesNotMatch(VIVIDLY_EXPORT_MPL_NOTICE,/MIT License/);
  assert.equal(LUCIDE_ICON_LICENSE,icons);assert.match(icons,/ISC License/);assert.match(icons,/Copyright \(c\) 2013-present Cole Bemis/);
});

test('standalone MPL notice/source archive are nonvisual and leave author metadata unchanged',()=>{
  const doc=createBlankDocument(),before=structuredClone(doc);doc.title='licensing02-private-document-title';const html=exportPresentation(doc),bundle=sourceBundle(html);
  assert.ok(html.includes(VIVIDLY_EXPORT_MPL_NOTICE));assert.match(html,/<!--\nVividly bundled software license notices/);
  assert.match(withoutArchive(html),/preferred modification source/);assert.match(withoutArchive(html),/scripts\/extract-export-source\.mjs/);
  assert.doesNotMatch(stripComments(html),/Copyright \(c\) 2026 boduri83/);checkComments(html);
  assert.ok(html.indexOf('<meta charset="utf-8">')<1024);assert.ok(!withoutArchive(html).includes(commentIcons));
  assert.equal(bundle.license,'MPL-2.0');assert.equal(bundle.scope,'Vividly export software source, not presentation content');
  assert.ok(!JSON.stringify(bundle).includes(doc.title),'the archive is application source, not the open document');
  assert.ok(Buffer.byteLength(html,'utf8')<100*1024*1024,'normal exports remain below the file-opening limit');
  assert.deepEqual(parsePresentation(html),normalizeDocument(doc));assert.deepEqual({...doc,title:before.title},before);
});

test('embedded preferred files are relative, complete UTF-8 source bytes with matching hashes, license and rebuild instructions',()=>{
  const bundle=sourceBundle(exportPresentation(createBlankDocument()));assert.equal(bundle.schemaVersion,1);assert.equal(typeof bundle.applicationVersion,'string');assert.match(bundle.readme,/extract|추출/i);
  assert.ok(bundle.files.length>10);const paths=new Set();
  for(const file of bundle.files){assert.equal(typeof file.path,'string');assert.doesNotMatch(file.path,/^(?:[A-Za-z]:|\/|\\)|(?:^|\/)\.\.(?:\/|$)|\\/);assert.ok(!paths.has(file.path));paths.add(file.path);
    assert.equal(typeof file.content,'string');assert.equal(file.bytes,Buffer.byteLength(file.content,'utf8'));assert.equal(file.sha256,createHash('sha256').update(file.content).digest('hex'));assert.equal(file.content,read(file.path),file.path+' must match the preferred source snapshot');
  }
  for(const name of['LICENSE','src/format.js','src/export-license-notices.js','scripts/build-export-source.mjs','scripts/extract-export-source.mjs'])assert.ok(paths.has(name),name+' must be obtainable');
  assert.equal(bundle.files.find(file=>file.path==='LICENSE').content,own);assert.ok(!paths.has('src/export-source-bundle.js'),'the generated archive must not recursively include itself');
});

test('source text is inert escaped JSON, cannot terminate its script, and is independent of editable metadata parsing',()=>{
  const doc=createBlankDocument(),html=exportPresentation(doc),encoded=scriptArchive.exec(html)[1];
  assert.doesNotMatch(encoded,/[<>&\u2028\u2029]/);assert.equal((html.match(/<script\b/g)||[]).length,3);
  assert.equal((withoutArchive(html).match(/<script\b/g)||[]).length,2);assert.deepEqual(sourceBundle(html),getExportRuntimeSourceBundle());
  assert.deepEqual(parsePresentation(html.replace(scriptArchive,'<script type="application/json" id="vividly-runtime-source">{invalid source archive}</script>')),doc,'importer consumes only its typed author metadata');
});

test('editable icons and reusable-only SVG metadata preserve the full pinned icon notices without changing SVG values',()=>{
  const c=iconDocument(),doc=c.snapshot(),html=exportPresentation(doc);assert.ok(withoutArchive(html).includes(commentIcons));assert.ok(html.includes(VIVIDLY_EXPORT_MPL_NOTICE));checkComments(html);
  assert.doesNotMatch(stripComments(html),/Lucide Icons and Contributors|Copyright \(c\) 2013-present Cole Bemis/);assert.deepEqual(parsePresentation(html),doc);assert.deepEqual(c.snapshot(),doc);
  c.selectElements(['licensed-icon']);c.captureComponent({name:'체크 원본'});c.deleteElements(['licensed-icon']);const reusable=c.snapshot();assert.equal(reusable.slides[0].elements.length,0);
  const stored=exportPresentation(reusable);assert.ok(withoutArchive(stored).includes(commentIcons));assert.deepEqual(parsePresentation(stored),reusable);
});

test('static source keeps CSP/script-free output and an inert source template while scoping icon notices to selected pages',()=>{
  const c=iconDocument(),first=c.activeSlideId,second=c.addSlide(),doc=c.snapshot(),withIcon=createStaticExport(doc,{slideIds:[first]}),withoutIcon=createStaticExport(doc,{slideIds:[second]});
  assert.ok(withoutArchive(withIcon.html).includes(commentIcons));assert.ok(!withoutArchive(withoutIcon.html).includes(commentIcons));
  for(const output of[withIcon,withoutIcon]){checkComments(output.html);assert.ok(output.html.includes(VIVIDLY_EXPORT_MPL_NOTICE));assert.doesNotMatch(output.html,/<script\b/i);assert.match(output.html,/script-src 'none'/);
    assert.doesNotMatch(stripComments(output.html),/Copyright \(c\) 2026 boduri83|Lucide Icons and Contributors/);assert.ok(output.html.indexOf('<meta charset="utf-8">')<1024);const raw=templateArchive.exec(output.html)[1];assert.doesNotMatch(raw,/[<>]/);assert.deepEqual(sourceBundle(output.html),getExportRuntimeSourceBundle());
  }
  assert.match(withoutArchive(withIcon.html),/<svg\b/);assert.deepEqual(c.snapshot(),doc);
});

test('conditional Chart.js, bundled color and Matter runtimes retain their complete existing MIT texts outside the source archive',()=>{
  const doc=createBlankDocument();doc.schemaVersion='0.15-authoring.1';doc.slides[0].elements.push({id:'licensed-chart',type:'chart',geometry:{x:80,y:90,width:600,height:360},chart:{kind:'bar',categories:['성과'],series:[{id:'licensed-series',name:'수치',color:'#2266aa',values:[42]}],showLegend:true}});
  doc.slides[0].scene={world:{width:doc.canvas.width,height:doc.canvas.height,gravityX:0,gravityY:1200,bounds:'solid'}};const normalized=normalizeDocument(doc),html=exportPresentation(normalized),actualMarkup=withoutArchive(html);
  for(const file of['assets/vendor/charts/LICENSE.md','assets/vendor/charts/KURKLE-COLOR-LICENSE.md','node_modules/matter-js/LICENSE'])assert.ok(lf(actualMarkup).includes(lf(read(file)).trim()),file+' full license must survive runtime serialization');
  assert.ok(!actualMarkup.includes(commentIcons),'a generated chart SVG is not editable icon geometry');assert.deepEqual(parsePresentation(html),normalized);
});
