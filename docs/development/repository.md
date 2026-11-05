# 소스 빌드와 개발 문서

Vividly의 공개 소스는 [`main`](https://github.com/boduri83/vividly_html_slide_maker_op/tree/main)에서 관리합니다. 배포본에 대응하는 소스는 해당 릴리스의 태그를 확인하세요. 현재 공개 베타는 [`v0.24.0-beta.5`](https://github.com/boduri83/vividly_html_slide_maker_op/releases/tag/v0.24.0-beta.5)입니다.

앱 사용과 설치는 [사용·지원 안내](../../SUPPORT.md), 자체 코드와 제3자 구성 요소의 라이선스는 [LICENSE](../../LICENSE)와 [NOTICE](../../NOTICE.md)를 참고하세요.

## 개발 환경에서 실행

Windows x64, Node.js 22 이상, Git을 준비한 뒤 다음 순서로 소스를 받아 실행합니다.

```powershell
git clone --branch main https://github.com/boduri83/vividly_html_slide_maker_op.git
cd vividly_html_slide_maker_op
npm.cmd ci
npm.cmd run build:workbench
npm.cmd start
```

`build:workbench`는 고정한 의존성의 편집기·MCP 번들과 HTML 내장 소스 묶음을 갱신합니다. 개발 중에는 변경한 영역의 검사를 선택하고, 전체 단위 검사는 다음 명령으로 실행합니다.

```powershell
npm.cmd test
```

## 공개 파일 확인

수정한 파일을 스테이징한 뒤 아래 검사로 사용자 경로와 REA 토큰 패턴을 확인합니다. 추가한 화면 캡처와 바이너리는 내용과 메타데이터를 함께 검토하세요.

```powershell
python scripts/check-public-content.py
```

저장소 루트에서 `node scripts/build-first-deck.mjs --output artifacts/public-showcase`를 실행하면 첫 사용 예제의 HTML과 JSON을 새 폴더에 생성합니다. 소개 사이트의 예제를 갱신할 때 두 파일을 `site/examples/`에 반영합니다.

## Windows 배포 파일 만들기

다음은 로컬 빌드 경로의 예입니다. 이미 있는 배포 폴더나 출력 파일을 덮어쓰지 않으므로, 다시 만들 때는 새 경로를 사용하세요. 생성한 패키지는 저장소에 실행 파일로 포함되지 않습니다.

```powershell
npm.cmd run build:workbench
node scripts/build-export-source.mjs --check
node scripts/package-desktop.mjs --output artifacts/local-build/Vividly-win-x64
```

포터블 ZIP 생성에는 Python 3.9 이상이 추가로 필요합니다. 같은 패키지 보고서를 사용해 압축 파일과 그 안의 파일 해시를 대조합니다.

```powershell
python scripts/archive-desktop.py --package-report artifacts/local-build/Vividly-win-x64.package-report.json --output artifacts/local-build/Vividly-Windows-x64.zip
```

설치 프로그램을 만들려면 [고정 도구 정보](../../desktop/installer/toolchain.json)에 있는 공식 NSIS 3.13 ZIP을 받고 SHA-256을 확인하세요. 아래는 `makensis.exe`가 있는 폴더를 `artifacts/tools/nsis-3.13`에 둔 경우입니다. 설치 프로그램은 같은 패키지 보고서의 파일을 검증한 뒤 생성합니다.

```powershell
node scripts/build-windows-installer.mjs --package-report artifacts/local-build/Vividly-win-x64.package-report.json --nsis-dir artifacts/tools/nsis-3.13 --output artifacts/local-build/Vividly-Setup-x64.exe
```

설치·제거 원본은 [desktop/installer](../../desktop/installer/), 빌드 진입점은 [build-windows-installer.mjs](../../scripts/build-windows-installer.mjs)입니다. 로컬 빌드는 코드 서명을 추가하지 않습니다.
