// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {readExportSource,extractExportSource} from '../scripts/extract-export-source.mjs';

const file=(name,content)=>({path:name,content,bytes:Buffer.byteLength(content),sha256:crypto.createHash('sha256').update(content).digest('hex')});
const source=files=>({schemaVersion:1,license:'MPL-2.0',files});
const html=value=>`<script type="application/json" id="vividly-runtime-source">${JSON.stringify(value).replace(/</g,'\\u003c')}</script>`;
async function temporary(t){
  const parent=await fs.realpath(os.tmpdir()),folder=await fs.mkdtemp(path.join(parent,'vividly-extract-test-'));
  t.after(async()=>{const resolved=await fs.realpath(folder);assert.equal(path.dirname(resolved).toLowerCase(),parent.toLowerCase());assert.ok(path.basename(resolved).startsWith('vividly-extract-test-'));await fs.rm(resolved,{recursive:true});});
  return folder;
}

test('restores exact UTF-8 bytes without executing source content',async t=>{
  const folder=await temporary(t),output=path.join(folder,'source'),text='한글\r\n</script><script>globalThis.sourceExecuted=true</script>';
  const result=await extractExportSource(html(source([file('src/example.js',text)])),output);
  assert.equal(result.files,1);assert.deepEqual(await fs.readFile(path.join(output,'src/example.js')),Buffer.from(text));assert.equal(globalThis.sourceExecuted,undefined);
});

test('rejects existing output without replacing any user file',async t=>{
  const folder=await temporary(t),target=path.join(folder,'source');await fs.mkdir(target);await fs.writeFile(path.join(target,'keep.txt'),'KEEP');
  await assert.rejects(extractExportSource(html(source([file('keep.txt','REPLACE')])),target),{code:'EEXIST'});
  assert.equal(await fs.readFile(path.join(target,'keep.txt'),'utf8'),'KEEP');
});

test('rejects traversal, absolute, Windows device/alias and duplicate paths before creating output',async t=>{
  const folder=await temporary(t);
  for(const invalid of ['../escape','/absolute','C:/absolute','src/../escape','src\\escape','src/NUL.txt','src/CON','src/file.']){
    const output=path.join(folder,'must-not-exist');await assert.rejects(extractExportSource(html(source([file(invalid,'x')])),output),/Unsafe/);await assert.rejects(fs.stat(output),{code:'ENOENT'});
  }
  assert.throws(()=>readExportSource(html(source([file('src/a.js','x'),file('SRC/A.js','y')]))),/duplicate/);
});

test('rejects tampered byte lengths and SHA-256 before creating output',async t=>{
  const folder=await temporary(t);
  for(const change of [{bytes:123},{sha256:'0'.repeat(64)},{content:'tampered'}]){
    const output=path.join(folder,'must-not-exist');await assert.rejects(extractExportSource(html(source([{...file('src/a.js','x'),...change}])),output),/mismatch/);await assert.rejects(fs.stat(output),{code:'ENOENT'});
  }
});

test('decodes a static template once while preserving original entity text',()=>{
  const original=source([file('src/a.js','&quot; &amp; < > " \' 한글')]);
  const encoded=JSON.stringify(original).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  assert.deepEqual(readExportSource(`<template id="vividly-runtime-source" data-format="application/json">${encoded}</template>`),original);
});
