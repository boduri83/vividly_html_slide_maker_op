// SPDX-License-Identifier: MPL-2.0
/** Wrap an already frozen, hash-verified Windows package in a per-user NSIS installer. */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

const root=path.resolve(import.meta.dirname,'..'),args=process.argv.slice(2);
const allowed=new Set(['--package-report','--output','--nsis-dir','--previous-package-report']);
assert.equal(args.length%2,0,'Every option needs a value');
for(let i=0;i<args.length;i+=2)assert.ok(allowed.has(args[i])&&args[i+1]&&!args[i+1].startsWith('--'),'Unknown/missing option: '+args[i]);
function option(name,fallback){const i=args.indexOf(name);return i<0?fallback:args[i+1];}
const required=name=>{const result=option(name);assert.ok(result,name+' is required');return path.resolve(root,result);};
const reportPath=required('--package-report'),output=required('--output');
assert.ok(output.startsWith(path.join(root,'artifacts')+path.sep)&&output.toLowerCase().endsWith('.exe'),'Output must be a fresh EXE under artifacts/');
assert.equal(await fs.stat(output).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;}),false,'Existing installer must never be overwritten');
const read=async file=>JSON.parse(await fs.readFile(file,'utf8')),sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const pkg=await read(reportPath),appDir=path.resolve(pkg.directory),metadata=await read(path.join(appDir,'resources/app/package.json'));
assert.equal(metadata.productName,'Vividly');assert.equal(metadata.author?.name,'Borvis Studio');assert.equal(metadata.producer,'보들이');assert.equal(metadata.version,pkg.version);
assert.equal(process.platform,'win32');assert.equal(process.arch,'x64');
assert.ok(/^\d+\.\d+\.\d+-desktop\.\d+$/.test(pkg.version),'Expected numeric PE version components');
const safeRelative=file=>{assert.ok(typeof file==='string'&&file.length&&file.length<220&&!/[:*?"<>|\x00-\x1f]/.test(file)&&!file.includes('\\')&&!file.startsWith('/')&&!file.split('/').some(part=>!part||part==='.'||part==='..'),'Unsafe payload path: '+file);return file;};
const unique=new Set();
for(const row of pkg.files){safeRelative(row.path);assert.ok(!unique.has(row.path.toLowerCase()),'Duplicate payload: '+row.path);unique.add(row.path.toLowerCase());const source=path.resolve(appDir,row.path);assert.ok(source.startsWith(appDir+path.sep));const bytes=await fs.readFile(source);assert.equal(bytes.length,row.bytes,row.path);assert.equal(sha(bytes),row.sha256,'Frozen package changed: '+row.path);}
const provenance=await read(path.join(root,'desktop/installer/toolchain.json'));
const nsisDir=path.resolve(option('--nsis-dir',path.join(root,'artifacts/tools/nsis-3.13')));
const compiler=path.join(nsisDir,'makensis.exe'),compilerVersion=execFileSync(compiler,['/VERSION'],{encoding:'utf8',windowsHide:true}).trim();assert.equal(compilerVersion,'v'+provenance.version,'Use the pinned NSIS version');
const originalNotice=await fs.readFile(path.join(nsisDir,'COPYING')),includedNotice=await fs.readFile(path.join(root,'desktop/installer/NSIS-COPYING.txt'));assert.equal(sha(originalNotice),sha(includedNotice),'Original NSIS license must be unchanged');
const previousPaths=new Set();
for(let i=0;i<args.length;i+=2)if(args[i]==='--previous-package-report'){
  const previous=await read(path.resolve(root,args[i+1]));assert.ok(Array.isArray(previous.files));
  for(const row of previous.files)previousPaths.add(safeRelative(row.path));
}
const temporary=output+'.build';await fs.mkdir(path.dirname(output),{recursive:true});await fs.mkdir(temporary);
const q=value=>String(value).replaceAll('$',()=> '$$').replaceAll('"','$\\"');
const relativeWin=value=>value.replaceAll('/','\\');
const payload=pkg.files.map(row=>({relative:row.path,source:path.join(appDir,row.path)}));
payload.push({relative:'.vividly-installer/NSIS-COPYING.txt',source:path.join(root,'desktop/installer/NSIS-COPYING.txt')});
const sourceNote=path.join(temporary,'INSTALLER-SOURCE.txt');
await fs.writeFile(sourceNote,'Vividly installer by Borvis Studio · 기획·제작: 보들이\r\n\r\nNSIS 3.13 with zlib compression. Original notice: NSIS-COPYING.txt.\r\nInstaller preferred source: scripts/build-windows-installer.mjs and desktop/installer/ at the source tag matching this distribution.\r\nhttps://github.com/boduri83/vividly_html_slide_maker_op\r\n\r\nPer-user install. No file association, autostart, service or elevated system install.\r\nUninstall preserves documents, recovery, credentials and app userData.\r\n');
payload.push({relative:'.vividly-installer/INSTALLER-SOURCE.txt',source:sourceNote});
const marker=path.join(temporary,'installation-marker.txt');await fs.writeFile(marker,'BorvisStudio.Vividly.Installation.v1');payload.push({relative:'.vividly-installation',source:marker});
const currentPaths=[...payload.map(f=>f.relative),'Uninstall Vividly.exe'];
const owned=[...new Map([...previousPaths,...currentPaths].map(file=>[file.toLowerCase(),file])).values()].sort();
const dirs=[...new Set(owned.flatMap(file=>{const values=[];let directory=path.posix.dirname(file);while(directory!=='.'){values.push(directory);directory=path.posix.dirname(directory);}return values;}))].sort((a,b)=>b.split('/').length-a.split('/').length||b.localeCompare(a));
const macros=[];
macros.push('!macro CheckStructure BASE FAIL');
for(const dir of ['',...dirs]){const value=dir?'\\'+relativeWin(dir):'';macros.push('  System::Call \'kernel32::GetFileAttributesW(w "\u0024{BASE}'+q(value)+'") i.r0\'','  ${If} $0 != -1','    IntOp $0 $0 & 0x400','    ${If} $0 != 0','      Goto \u0024{FAIL}','    ${EndIf}','  ${EndIf}');}
macros.push('!macroend','!macro CheckLocks BASE FAIL SUFFIX');
for(const [index,file]of owned.entries()){const target='\u0024{BASE}\\'+q(relativeWin(file)),label='lock_done_\u0024{SUFFIX}_'+index;macros.push('  IfFileExists "'+target+'" 0 '+label,'  System::Call \'kernel32::CreateFileW(w "'+target+'", i 0xC0000000, i 0, p 0, i 3, i 0, p 0) p.r0\'','  ${If} $0 == -1','    Goto \u0024{FAIL}','  ${EndIf}','  System::Call \'kernel32::CloseHandle(p r0)\'',label+':');}
macros.push('!macroend','!macro DeleteOwned BASE');
for(const file of owned.filter(f=>f!=='Uninstall Vividly.exe'))macros.push('  Delete "\u0024{BASE}\\'+q(relativeWin(file))+'"');
macros.push('  Delete "\u0024{BASE}\\Uninstall Vividly.exe"');
macros.push('  !insertmacro RemoveEmptyDirectories "\u0024{BASE}"','!macroend','!macro RemoveEmptyDirectories BASE');
for(const dir of dirs)macros.push('  RMDir "\u0024{BASE}\\'+q(relativeWin(dir))+'"');
macros.push('  RMDir "\u0024{BASE}"','!macroend');
let lastDirectory=null;const extraction=[];
for(const file of payload){const dir=path.posix.dirname(file.relative);if(dir!==lastDirectory){extraction.push('  SetOutPath "$StagingDir'+(dir==='.'?'':'\\'+q(relativeWin(dir)))+'"');lastDirectory=dir;}extraction.push('  File "/oname='+q(path.posix.basename(file.relative))+'" "'+q(file.source)+'"');}
const commit=[],rollback=[];
for(const file of currentPaths){const rel=q(relativeWin(file)),dir=path.posix.dirname(file);if(dir!=='.')commit.push('  CreateDirectory "$INSTDIR\\'+q(relativeWin(dir))+'"','  CreateDirectory "$BackupDir\\'+q(relativeWin(dir))+'"');commit.push('  ClearErrors','  IfFileExists "$INSTDIR\\'+rel+'" 0 +2','  Rename "$INSTDIR\\'+rel+'" "$BackupDir\\'+rel+'"','  IfErrors rollback','  Rename "$StagingDir\\'+rel+'" "$INSTDIR\\'+rel+'"','  IfErrors rollback');}
for(const file of [...currentPaths].reverse()){const rel=q(relativeWin(file)),label='rollback_'+rollback.length;rollback.push('  IfFileExists "$BackupDir\\'+rel+'" '+label+'_old 0','  IfFileExists "$StagingDir\\'+rel+'" '+label+'_done 0','  Delete "$INSTDIR\\'+rel+'"','  Goto '+label+'_done',label+'_old:','  Delete "$INSTDIR\\'+rel+'"','  Rename "$BackupDir\\'+rel+'" "$INSTDIR\\'+rel+'"',label+'_done:');}
const currentKeys=new Set(currentPaths.map(file=>file.toLowerCase()));
const removed=[...previousPaths].filter(file=>!currentKeys.has(file.toLowerCase()));
const obsolete=removed.map(file=>'  Delete "$INSTDIR\\'+q(relativeWin(file))+'"').join('\n');
const uninstall=owned.filter(file=>!['Uninstall Vividly.exe','.vividly-installation'].includes(file)).flatMap((file,index)=>['  IfFileExists "$INSTDIR\\'+q(relativeWin(file))+'" 0 un_delete_done_'+index,'  ClearErrors','  Delete "$INSTDIR\\'+q(relativeWin(file))+'"','  IfErrors uninstall_failed','un_delete_done_'+index+':']).join('\n');
const template=await fs.readFile(path.join(root,'desktop/installer/vividly.nsi'),'utf8');
const peVersion=pkg.version.replace('-desktop.','.');
const variables={OUTFILE:q(output),ICON:q(path.join(appDir,'resources/app/assets/brand/vividly.ico')),VERSION:q(pkg.version),PE_VERSION:peVersion,MACROS:macros.join('\n'),EXTRACTION:extraction.join('\n'),COMMIT:commit.join('\n'),ROLLBACK:rollback.join('\n'),OBSOLETE:obsolete,UNINSTALL:uninstall};
let source=template;for(const [key,value]of Object.entries(variables))source=source.replaceAll('@'+key+'@',value);assert.ok(!/@[A-Z_]+@/.test(source),'Unfilled installer template');
const nsi=path.join(temporary,'vividly-generated.nsi');await fs.writeFile(nsi,'\ufeff'+source);
let compilerLog;
try{compilerLog=execFileSync(compiler,['/INPUTCHARSET','UTF8','/V3',nsi],{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:10*1024*1024});}
catch(error){await fs.writeFile(path.join(temporary,'compiler-failure.log'),String(error.stdout||'')+'\n'+String(error.stderr||error.message));throw Error('NSIS compilation failed before installer execution; see '+path.join(temporary,'compiler-failure.log'));}
await fs.writeFile(path.join(temporary,'compiler.log'),compilerLog);
const bytes=await fs.readFile(output);assert.equal(bytes.subarray(0,2).toString(),'MZ');
for(const row of pkg.files){const bytes=await fs.readFile(path.join(appDir,row.path));assert.equal(sha(bytes),row.sha256,'Package mutated during installer build: '+row.path);}
const result={schemaVersion:1,createdUtc:new Date().toISOString(),version:pkg.version,scope:'Unsigned per-user Windows x64 NSIS distribution. Builder validates the frozen package; actual installation/upgrade/uninstallation is separate evidence.',path:path.relative(root,output).replaceAll('\\','/'),bytes:bytes.length,sha256:sha(bytes),packageReport:path.relative(root,reportPath).replaceAll('\\','/'),packageReportSha256:sha(await fs.readFile(reportPath)),packageFiles:pkg.files.length,packageFilesVerifiedBeforeAndAfter:true,installedOwnedFiles:currentPaths.length,previousOwnedPaths:previousPaths.size,removedPreviousPaths:removed,toolchain:{...provenance,compilerVersion,compilerSha256:sha(await fs.readFile(compiler)),noticeSha256:sha(includedNotice)},source:{builder:'scripts/build-windows-installer.mjs',template:'desktop/installer/vividly.nsi',generated:path.relative(root,nsi).replaceAll('\\','/'),compilerLog:path.relative(root,path.join(temporary,'compiler.log')).replaceAll('\\','/')},policy:{perUser:true,elevationRequested:false,registryHive:'HKCU',uninstallKey:'Software/Microsoft/Windows/CurrentVersion/Uninstall/BorvisStudio.Vividly',fileAssociations:false,autostart:false,services:false,forcedProcessKill:false,stagedExtraction:true,knownFileBackupRollback:true,recursiveUninstall:false,preserveUserData:true,preserveUnknownInstallFiles:true},signed:false,productReleaseApproved:false};
await fs.writeFile(output+'.installer-report.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result,null,2));
