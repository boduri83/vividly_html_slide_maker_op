// SPDX-License-Identifier: MPL-2.0
// Build the fixed, editable first-use sample without changing its JSON source.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {normalizeDocument} from '../src/model.js';
import {exportPresentation,parsePresentation} from '../src/format.js';
import {getExportRuntimeSourceBundle} from '../src/export-source-bundle.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
if(args.length&&!(args.length===2&&args[0]==='--output'&&args[1]))throw Error('Usage: node scripts/build-first-deck.mjs [--output NEW_DIRECTORY]');
const output=path.resolve(args.length?args[1]:path.join(root,'artifacts/public-showcase'));
const sourcePath='examples/first-deck.json';
const source=await fs.readFile(path.join(root,sourcePath));
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const sourceSha256=sha(source);
const raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(source));
const document=normalizeDocument(raw);
assert.deepEqual(document,raw,'The fixed example must already be canonical author data');
assert.equal(document.id,'document-vividly-first-deck');
assert.ok(document.slides.length>=3);
assert.equal(document.slides[0].id,'first-cover');
assert.equal(document.slides[1].id,'first-results');
assert.equal(document.slides.at(-1).id,'first-actions');

// The source capsule is part of the delivered HTML. Refuse an older or changed
// snapshot so that the sample and its preferred source describe the same build.
const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
const capsule=getExportRuntimeSourceBundle();
assert.equal(capsule.applicationVersion,pkg.version,'Refresh the export source with npm run build:export-source before building the sample');
for(const file of capsule.files){
  const current=await fs.readFile(path.join(root,file.path));
  assert.equal(sha(current),file.sha256,'Export source snapshot is stale: '+file.path+'; run npm run build:export-source');
}

const html=Buffer.from(exportPresentation(document),'utf8');
assert.deepEqual(parsePresentation(html.toString('utf8')),document,'The standalone HTML must retain the complete editable model');
assert.equal(sha(await fs.readFile(path.join(root,sourcePath))),sourceSha256,'Source changed during the build');

await fs.mkdir(path.dirname(output),{recursive:true});
await fs.mkdir(output); // A previous build or a user's file is never overwritten.
const files=[];
for(const [name,bytes]of [['first-deck.json',source],['first-deck.html',html]]){
  await fs.writeFile(path.join(output,name),bytes,{flag:'wx'});
  files.push({path:name,bytes:bytes.length,sha256:sha(bytes)});
}
const report={
  schemaVersion:1,createdUtc:new Date().toISOString(),applicationVersion:pkg.version,
  scope:'Original editable Vividly showcase. Fixed editable IDs, ordinary text/shapes/vector/chart and click navigation. One self-contained HTML serves browser presentation and Vividly reopening. Source JSON is copied unchanged. Model normalization and HTML metadata roundtrip only; visual/native acceptance is separate.',
  documentId:document.id,documentSchema:document.schemaVersion,title:document.title,
  source:{path:sourcePath,bytes:source.length,sha256:sourceSha256,unchanged:true},
  slides:document.slides.length,
  elements:document.slides.reduce((count,slide)=>count+slide.elements.length,0),
  charts:document.slides.flatMap(slide=>slide.elements).filter(element=>element.type==='chart').length,
  assets:document.assets.length,
  motions:document.slides.reduce((n,slide)=>n+(slide.motions?.length||0),0),
  interactionRules:document.slides.reduce((n,slide)=>n+(slide.interactions?.length||0),0),
  variables:document.variables?.length||0,
  clickNavigation:document.slides.flatMap(slide=>(slide.interactions||[]).flatMap(rule=>rule.actions.filter(action=>action.type==='goToSlide').map(action=>({sourceSlideId:slide.id,sourceElementId:rule.sourceId,targetSlideId:action.targetId})))),
  exampleData:true,externalPhotos:false,modelConnectionRequired:false,
  editableMetadataRoundtripEqual:true,preferredSourceVersion:capsule.applicationVersion,
  files,
};
await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({output:path.relative(root,output).replaceAll('\\','/'),...report},null,2));
