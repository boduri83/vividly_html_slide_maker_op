/** Package the installed, checksum-verified Electron runtime into a fresh Windows folder. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import * as PELibrary from 'pe-library';
import * as ResEdit from 'resedit';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
// Refuse a package whose exported MPL sources no longer match the runtime.
execFileSync(process.execPath, [path.join(root, 'scripts/build-export-source.mjs'), '--check'], { cwd: root, windowsHide: true, stdio: 'pipe' });
const versionParts = /^(\d+)\.(\d+)\.(\d+)(?:-desktop\.(\d+))?$/.exec(pkg.version)?.slice(1).map(value => Number(value || 0));
if (!versionParts) throw new Error('Package version needs numeric PE version components');
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('This package target is Windows x64');
const argv = process.argv.slice(2);
const outputIndex = argv.indexOf('--output');
const output = path.resolve(outputIndex < 0
  ? path.join(root, 'artifacts/logo-01', `Vividly-${pkg.version}-win-x64`)
  : argv[outputIndex + 1] || (() => { throw new Error('--output needs a path'); })());
const artifactRoot = path.join(root, 'artifacts');
if (!output.startsWith(artifactRoot + path.sep)) throw new Error('Package output must be a new folder under artifacts/');
const executable = require('electron');
const runtime = path.dirname(executable);
const electronVersion = (await fs.readFile(path.join(runtime, 'version'), 'utf8')).trim().replace(/^v/, '');
if (electronVersion !== pkg.devDependencies.electron) throw new Error('Installed Electron differs from pinned dependency');
const pe = await fs.readFile(executable);
if (pe.toString('ascii', 0, 2) !== 'MZ' || pe.readUInt16LE(pe.readUInt32LE(0x3c) + 4) !== 0x8664) {
  throw new Error('Electron executable is not Windows x64 PE');
}
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.mkdir(output); // Existing candidates are never overwritten.
for (const entry of await fs.readdir(runtime)) {
  await fs.cp(path.join(runtime, entry), path.join(output, entry), { recursive: true, force: false, errorOnExist: true });
}
await fs.rename(path.join(output, 'electron.exe'), path.join(output, 'Vividly.exe'));
if (await fs.stat(path.join(output, 'electron_wer.dll')).then(() => true, error => {
  if (error.code === 'ENOENT') return false;
  throw error;
})) await fs.rename(path.join(output, 'electron_wer.dll'), path.join(output, 'Vividly_wer.dll'));

// Only the fresh candidate is rebranded; the installed Electron runtime is untouched.
const iconPath = path.join(root, 'assets/brand/vividly.ico');
const iconBytes = await fs.readFile(iconPath);
const icon = ResEdit.Data.IconFile.from(iconBytes);
if (icon.icons.length !== 9) throw new Error('Expected the nine Vividly icon frames');
const brandedPe = PELibrary.NtExecutable.from(pe, { ignoreCert: true });
const resources = PELibrary.NtExecutableResource.from(brandedPe);
const iconGroups = ResEdit.Resource.IconGroupEntry.fromEntries(resources.entries);
if (!iconGroups.length) throw new Error('Runtime icon group not found');
for (const group of iconGroups) {
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(resources.entries, group.id, group.lang, icon.icons.map(item => item.data));
}
const versions = ResEdit.Resource.VersionInfo.fromEntries(resources.entries);
if (!versions.length) throw new Error('Runtime version resource not found');
for (const version of versions) {
  version.setFileVersion(...versionParts);
  version.setProductVersion(...versionParts);
  for (const language of version.getAllLanguagesForStringValues()) {
    version.setStringValues(language, { ProductName: pkg.productName, FileDescription: pkg.description,
      InternalName: pkg.productName, OriginalFilename: 'Vividly.exe', CompanyName: pkg.author.name,
      FileVersion: pkg.version, ProductVersion: pkg.version });
  }
  version.outputToResourceEntries(resources.entries);
}
resources.outputResource(brandedPe);
await fs.writeFile(path.join(output, 'Vividly.exe'), Buffer.from(brandedPe.generate()));
const appRoot = path.join(output, 'resources/app');
await fs.mkdir(appRoot);
const productionPackage = Object.fromEntries(['name', 'version', 'productName', 'author', 'producer', 'slogan', 'type', 'main', 'description', 'license']
  .map(key => [key, pkg[key]]));
await fs.writeFile(path.join(appRoot, 'package.json'), JSON.stringify(productionPackage, null, 2) + '\n');
for (const relative of ['desktop', 'src', 'assets', 'index.html', 'styles.css']) {
  await fs.cp(path.join(root, relative), path.join(appRoot, relative), { recursive: true, force: false, errorOnExist: true });
}
// Keep Electron's root LICENSE and Chromium notices intact. Ship our license separately.
for (const name of ['LICENSE', 'NOTICE.md', 'PRIVACY.md', 'SUPPORT.md']) await fs.copyFile(path.join(root, name), path.join(appRoot, name));
await fs.copyFile(path.join(root, 'PRIVACY.md'), path.join(output, '개인정보 안내.txt'));
await fs.copyFile(path.join(root, 'LICENSE'), path.join(output, 'VIVIDLY-LICENSE.txt'));
await fs.writeFile(path.join(output, 'VIVIDLY-NOTICE.md'),
  '# Vividly 라이선스 안내\n\n' +
  'Vividly 자체 코드: [MPL-2.0](VIVIDLY-LICENSE.txt). 사용자 자료의 라이선스를 변경하지 않습니다.\n\n' +
  '[제3자 고지와 MPL 소스 안내](resources/app/NOTICE.md) · ' +
  '[구성 목록](resources/app/docs/licensing/third-party-inventory.md) · ' +
  '[번들 의존성 전문](THIRD-PARTY-NOTICES.txt)\n\n' +
  '수정 가능한 앱 원본은 resources/app/src/와 desktop/에, 원래 package.json·lockfile·빌드 스크립트는 ' +
  '[빌드 소스](resources/app/licensing/build-source/)에 제공합니다. 수정·배포 시 해당 MPL 적용 파일의 소스 제공 조건을 유지하세요.\n\n' +
  'MPL 도형의 원 XML·템플릿·생성 모듈·생성기를 resources/app/에 함께 제공합니다. ' +
  'Python이 설치된 환경에서 이 폴더를 기준으로 `python scripts/build-shapes.py`로 재생성할 수 있습니다.\n\n' +
  '배포 폴더의 [LICENSE](LICENSE)는 Electron 고지이며, ' +
  '[LICENSES.chromium.html](LICENSES.chromium.html)과 함께 보존합니다.\n', 'utf8');
await fs.mkdir(path.join(appRoot, 'docs/licensing'), { recursive: true });
await fs.copyFile(path.join(root, 'docs/licensing/third-party-inventory.md'), path.join(appRoot, 'docs/licensing/third-party-inventory.md'));
await fs.mkdir(path.join(appRoot,'docs/usage'),{recursive:true});
await fs.copyFile(path.join(root,'docs/usage/first-five-minutes.md'),path.join(appRoot,'docs/usage/first-five-minutes.md'));
// Original XML, runtime template and generated MPL file are already in assets/ and src/.
// Include the preferred generator in the same relative tree; rebuild from resources/app/.
await fs.mkdir(path.join(appRoot, 'scripts'));
await fs.copyFile(path.join(root, 'scripts/build-shapes.py'), path.join(appRoot, 'scripts/build-shapes.py'));
// Retain preferred sources and build metadata for our bundled entry points.
const buildSource = path.join(appRoot, 'licensing/build-source');
await fs.mkdir(buildSource, { recursive: true });
for (const relative of ['package.json', 'package-lock.json', 'LICENSE', 'NOTICE.md']) {
  await fs.cp(path.join(root, relative), path.join(buildSource, relative), { recursive: true, force: false, errorOnExist: true });
}
await fs.mkdir(path.join(buildSource, 'scripts'));
for(const name of ['LICENSE','NOTICE.txt','build-workbench.mjs','build-shapes.py','build-chart-vendor.py','build-export-source.mjs','extract-export-source.mjs','package-desktop.mjs','build-windows-installer.mjs','archive-desktop.py']){
  await fs.copyFile(path.join(root,'scripts',name),path.join(buildSource,'scripts',name));
}
await fs.writeFile(path.join(buildSource, 'README.txt'),
  'Vividly MPL-2.0 preferred source / build instructions\n\n' +
  'Application source is at ../../src/ and ../../desktop/ relative to this folder.\n' +
  'To rebuild, copy resources/app to a NEW working folder, then copy the contents of licensing/build-source over its root.\n' +
  'Use Node.js >=22 and npm ci with the included package.json and lockfile.\n' +
  'npm run build:workbench rebuilds the editor, CSS, rich text, Matter and MCP bundles from their pinned dependencies.\n' +
  'node scripts/build-export-source.mjs refreshes the offline export source snapshot.\n' +
  'Windows installer: scripts/build-windows-installer.mjs wraps a frozen package report. Obtain the official portable NSIS version and verify the SHA-256 in desktop/installer/toolchain.json, then pass --nsis-dir to the extracted folder. See the builder --package-report/--output arguments and retain NSIS-COPYING.txt.\n' +
  'Python: python scripts/build-shapes.py regenerates the bundled DrawingML presets.\n' +
  'python scripts/build-chart-vendor.py --bundled regenerates Chart without research caches.\n' +
  'The shipped Chart.js runtime and its original notices are in src/chart-vendor.js and assets/vendor/charts/.\n' +
  'The source materials and embedded export source do not include user documents, credentials or research evidence.\n', 'utf8');
await fs.mkdir(path.join(appRoot, 'examples'));
for(const name of ['first-deck.json','document-contract-v0.1.json','workbench-showcase.json','motion-showcase.json','business-showcase.json','advanced-showcase.json']) await fs.copyFile(path.join(root, 'examples',name),path.join(appRoot,'examples',name));
await fs.writeFile(path.join(output, '시작 안내.txt'),
  `Vividly ${pkg.version}\r\nPresent Vividly.\r\n${pkg.author.name} · 기획·제작: ${pkg.producer}\r\n\r\n압축을 풀고 Vividly.exe를 실행하세요. 실행 파일과 함께 있는 폴더·파일을 유지하세요.\r\n` +
  'Node.js나 별도 브라우저, 개발 서버는 필요하지 않습니다.\r\n\r\n' +
  '첫 실행의 7장 쇼케이스에서 제목·도형·차트·모션·인터랙션을 바꾸어 보세요. 도움말에서 예제를 다시 열고 5분 안내·개인정보·피드백을 확인합니다.\r\n' +
  '이 빌드는 서명되지 않은 초기 공개 베타입니다. Windows 실행 경고나 차단이 나타날 수 있습니다.\r\n\r\n' +
  '저장: Ctrl+S / 다른 이름으로 저장: Ctrl+Shift+S / HTML 열기: Ctrl+O\r\n' +
  '텍스트 두 번 누르기: 편집 / Enter: 줄바꿈 / Ctrl+Enter: 문단 추가 / Esc: 편집 완료\r\n' +
  '발표: 상단 발표 버튼 / Esc: 발표 종료\r\n\r\n' +
  'HTML로 저장한 자료는 앱에서 다시 열어 편집하거나 독립 HTML로 발표할 수 있습니다.\r\n' +
  '\r\n아바타: 상단 에이전트 → 연결 설정에서 Codex 로그인 확인·모델 선택 → 설정 저장 → 대화로 변경 제안을 검토하세요.\r\n' +
  'Codex 직접 연결은 설치된 Codex CLI와 ChatGPT 로그인을 사용합니다. 이번 후보는 Windows Codex CLI 0.156.1에서 검증합니다.\r\n' +
  'OpenAI·호환 Responses API/로컬 API도 선택할 수 있습니다. 키는 앱 설정 안에 입력하세요.\r\n' +
  '일반 수동 편집·저장·발표에는 모델 연결이 필요하지 않습니다.\r\n' +
  '\r\n라이선스: Vividly 자체 코드는 VIVIDLY-LICENSE.txt(MPL-2.0)를 확인하세요.\r\n' +
  '제3자 고지와 MPL 도형 소스 위치: VIVIDLY-NOTICE.md 및 resources/app/docs/licensing/third-party-inventory.md\r\n' +
  'Electron LICENSE와 LICENSES.chromium.html 및 함께 제공한 개별 라이선스는 그대로 적용됩니다.\r\n', 'utf8');
if (pkg.dependencies?.['@modelcontextprotocol/server']) {
  await fs.access(path.join(appRoot, 'desktop/mcp-adapter.bundle.cjs'));
  await fs.writeFile(path.join(output, 'Vividly-MCP.cmd'), '@echo off\r\nsetlocal\r\nset ELECTRON_RUN_AS_NODE=1\r\n"%~dp0Vividly.exe" "%~dp0resources\\app\\desktop\\mcp-adapter.bundle.cjs" %*\r\n', 'utf8');
  await fs.copyFile(path.join(root, 'assets/vendor/THIRD-PARTY-NOTICES.txt'), path.join(output, 'THIRD-PARTY-NOTICES.txt'));
  await fs.appendFile(path.join(output, '시작 안내.txt'), '\r\n작업대: Shift/영역 다중 선택 · Ctrl+C/X/V · Ctrl+G / Ctrl+Shift+G\r\n정렬/그룹/디자인/레이어 도구와 문서 탭의 테마·자료 크기·복구를 사용하세요.\r\nMCP: 앱의 문서 탭에서 현재 문서 연결을 허용하고 표시된 JSON 설정을 호스트에 추가하세요.\r\nVividly-MCP.cmd --descriptor "앱에 표시된 descriptor 경로"로 stdio adapter를 실행할 수도 있습니다.\r\n', 'utf8');
}
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
async function inventory(directory, prefix = '') {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Symlink is not allowed in this package: ${relative}`);
    if (entry.isDirectory()) result.push(...await inventory(path.join(directory, entry.name), relative + '/'));
    else {
      const bytes = await fs.readFile(path.join(directory, entry.name));
      result.push({ path: relative, bytes: bytes.length, sha256: digest(bytes) });
    }
  }
  return result.sort((a, b) => a.path.localeCompare(b.path));
}
const files = await inventory(output);
const forbidden = files.filter(row => /(^|\/)(\.git|\.env|node_modules|evidence|config|user[Dd]ata|Cookies|Local Storage|Session Storage|Crashpad)(\/|$)/.test(row.path));
if (forbidden.length) throw new Error(`Unexpected private/development content: ${forbidden.map(row => row.path).join(', ')}`);
const report = {
  schemaVersion: 1, createdUtc: new Date().toISOString(), version: pkg.version, electronVersion,
  scope: 'Packaged Windows x64 technical candidate; runtime acceptance is recorded by separate tests',
  directory: output, executable: path.join(output, 'Vividly.exe'),
  files, totalBytes: files.reduce((sum, row) => sum + row.bytes, 0),
  sourceFiles: files.filter(row => row.path.startsWith('resources/app/')),
  privacyScan: { passed: true, excludedByWhitelist: ['research/evidence', 'local configuration', 'node_modules', 'userData'],
    forbiddenPaths: forbidden },
  branding: { icon: 'assets/brand/vividly.ico', iconSha256: digest(iconBytes), iconFrames: icon.icons.length,
    iconGroups: iconGroups.map(({ id, lang }) => ({ id, lang })), resourceEditor: `resedit ${pkg.devDependencies.resedit}` },
  signing: 'Locally rebranded, unsigned executable; upstream signature removed by PE resource generation; app signing is not implemented',
};
const reportPath = output + '.package-report.json';
await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ directory: output, executable: report.executable, report: reportPath,
  files: files.length, bytes: report.totalBytes, electronVersion }, null, 2));
