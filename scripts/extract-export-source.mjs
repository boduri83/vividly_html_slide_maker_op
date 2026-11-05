// SPDX-License-Identifier: MPL-2.0
// Read inert source data without executing a presentation or overwriting files.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';

export function readExportSource(html){
  const block=/<script\b[^>]*\bid="vividly-runtime-source"[^>]*>([\s\S]*?)<\/script\s*>/i.exec(html);
  const template=/<template\b[^>]*\bid="vividly-runtime-source"[^>]*>([\s\S]*?)<\/template\s*>/i.exec(html);
  let text=block?.[1]??template?.[1];
  if(!text)throw Error('No bundled Vividly runtime source found');
  if(!block)text=text.replace(/&(?:amp|lt|gt|quot|#39);/g,value=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'"}[value]));
  const source=JSON.parse(text);
  if(source.schemaVersion!==1||source.license!=='MPL-2.0'||!Array.isArray(source.files)||source.files.length<1||source.files.length>500)throw Error('Unsupported source manifest');
  const names=new Set();let total=0;
  for(const file of source.files){
    if(typeof file.path!=='string'||!/^[A-Za-z0-9_.\/-]+$/.test(file.path)||file.path.startsWith('/')||file.path.split('/').some(part=>!part||part==='.'||part==='..'||part.endsWith('.')||/^(CON|PRN|AUX|NUL|COM\d|LPT\d)(\.|$)/i.test(part))||names.has(file.path.toLowerCase()))throw Error('Unsafe or duplicate source path');
    if(typeof file.content!=='string')throw Error('Missing source content');
    const bytes=Buffer.from(file.content);total+=bytes.length;
    if(total>16*1024*1024||bytes.length!==file.bytes||crypto.createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw Error('Source byte length or SHA-256 mismatch');
    names.add(file.path.toLowerCase());
  }
  return source;
}

export async function extractExportSource(html,output){
  const source=readExportSource(html);
  const directory=path.resolve(output);
  // Validate all entries before creating anything; an existing target is rejected.
  await fs.mkdir(directory);
  for(const file of source.files){
    const target=path.resolve(directory,file.path);
    if(!target.startsWith(directory+path.sep))throw Error('Source path escapes output');
    await fs.mkdir(path.dirname(target),{recursive:true});
    await fs.writeFile(target,file.content,{flag:'wx'});
  }
  return {directory,files:source.files.length};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const args=process.argv.slice(2);
  if(args.length!==3||args[1]!=='--output')throw Error('Usage: node extract-export-source.mjs PRESENTATION.html --output NEW_FOLDER');
  const stat=await fs.stat(args[0]);if(stat.size>100*1024*1024)throw Error('HTML exceeds 100 MiB');
  const result=await extractExportSource(await fs.readFile(args[0],'utf8'),args[2]);
  console.log(JSON.stringify(result));
}
