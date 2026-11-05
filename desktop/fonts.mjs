import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
let pending;
/** Read-only native Windows font inventory. No caller commands or file paths are accepted. */
export async function installedFonts({refresh=false}={}) {
  if (refresh) pending = undefined;
  if (!pending) pending = (async () => {
    if (process.platform !== 'win32') return {families:[],source:'unavailable',error:'설치 글꼴 조회는 Windows 앱에서 지원합니다.'};
    const script = `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); Add-Type -AssemblyName PresentationCore; $names = [System.Windows.Media.Fonts]::SystemFontFamilies | ForEach-Object { $_.Source; $_.FamilyNames.Values }; ConvertTo-Json -Compress -InputObject @($names | Sort-Object -Unique)`;
    const {stdout} = await run('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,timeout:15000,maxBuffer:4*1024*1024,encoding:'utf8'});
    const parsed = JSON.parse(stdout.replace(/^\uFEFF/,''));
    const families = [...new Set(parsed.filter(v=>typeof v==='string'&&v.trim()&&v.length<=256&&!/[\u0000-\u001f\u007f]/.test(v)).map(v=>v.trim()))].sort((a,b)=>a.localeCompare(b,'ko'));
    return {families,source:'Windows.Media.Fonts.SystemFontFamilies',queriedUtc:new Date().toISOString()};
  })().catch(error=>{pending=undefined;return {families:[],source:'unavailable',error:error.message};});
  return pending;
}
