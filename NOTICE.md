# Vividly 고지

Vividly 자체 소프트웨어에는 루트 [LICENSE](LICENSE)의 Mozilla Public License 2.0을 적용한다. MPL 적용 파일을 수정하여 배포할 때 해당 수정 소스와 획득 안내를 제공한다. MPL 코드를 포함하지 않는 독립 새 파일 모두의 공개를 요구하지 않으며, 사용자 문서의 내용·자산을 자동으로 MPL로 바꾸지 않는다. 제3자 자료의 기존 라이선스는 아래 고지대로 유지한다.

## 제3자 소프트웨어와 자산

| 구성 | 라이선스와 고지 원본 |
| --- | --- |
| 편집기·부분 서식·CSS·MCP 등의 번들 의존성 | [58개 버전·라이선스 목록](assets/vendor/dependencies.json), [라이선스 전문과 저작권 고지](assets/vendor/THIRD-PARTY-NOTICES.txt). 현재 MIT 55개·Apache-2.0 2개·BSD-3-Clause 1개 |
| LibreOffice DrawingML 도형 원본·생성 도형 모듈 | MPL-2.0. [출처](assets/vendor/shapes/NOTICE.txt), [라이선스 전문](assets/vendor/shapes/LICENSE.txt)와 아래 대응 소스 |
| Lucide 및 Feather 유래 아이콘 | ISC 및 해당 Feather 아이콘의 MIT. [출처](assets/vendor/icons/NOTICE.txt), [전체 고지](assets/vendor/icons/LICENSE.txt) |
| Colibre UI 아이콘 | 설치본의 CC0 고지. [원문과 출처](assets/ui/LICENSE.txt) |
| Chart.js 4.6.1 및 @kurkle/color 0.3.2 | MIT. [출처](assets/vendor/charts/NOTICE.txt), [Chart.js](assets/vendor/charts/LICENSE.md), [@kurkle/color](assets/vendor/charts/KURKLE-COLOR-LICENSE.md) |
| Matter.js 0.20.0 | MIT. 번들 고지와 [독립 HTML용 모듈](src/scene-vendor.js)에 전문 보존 |
| Electron runtime 및 Chromium 등의 구성 요소 | 배포 폴더의 `LICENSE`와 `LICENSES.chromium.html` 유지. 배포 폴더 루트 `LICENSE`는 Electron 고지이며 Vividly의 MPL 전문과 구분 |

원본과 패키지·출력별 범위는 [제3자 원장](docs/licensing/third-party-inventory.md)을 따른다. 이 고지는 제3자 권리를 자체 MPL로 재라이선스하지 않는다.

## 앱과 도형의 대응 소스

현재 공개 베타는 `0.24.0-beta.5`이며 [해당 버전의 소스](https://github.com/boduri83/vividly_html_slide_maker_op/tree/v0.24.0-beta.5)와 배포물 안의 원본을 함께 제공한다. 제작 주체는 Borvis Studio이며 기획·제작은 보들이가 담당한다. GitHub는 소스·배포·지원 채널이다. 자체 MPL 전문은 `VIVIDLY-LICENSE.txt`와 `resources/app/LICENSE`, 전체 고지는 `resources/app/NOTICE.md`와 동봉한 원장에서 확인한다. Electron의 기존 고지는 그대로 유지한다.

Windows 설치 프로그램은 **NSIS 3.13**의 설치·제거 런타임과 zlib 압축을 사용한다. 원래 전문은 [NSIS COPYING](desktop/installer/NSIS-COPYING.txt), 고정 도구의 출처·해시는 [toolchain.json](desktop/installer/toolchain.json), 수정 가능한 설치 원본은 [vividly.nsi](desktop/installer/vividly.nsi)와 [빌드 스크립트](scripts/build-windows-installer.mjs)에 보존한다. 설치 폴더의 `.vividly-installer/`에도 고지와 원본 획득 안내를 제공한다. 이는 설치형에 관한 고지이며, NSIS를 발표 HTML의 런타임이나 앱 편집기 의존성으로 사용하지 않는다.

앱의 MPL 원본은 `resources/app/src/`와 `resources/app/desktop/`에 제공하고, 원본 build script·package/lock·LICENSE·NOTICE는 `resources/app/licensing/build-source/`에 함께 둔다. `src/LICENSE`, `desktop/LICENSE`, `scripts/LICENSE`와 고지에서 적용 범위와 제3자 예외를 구분한다. [공개 소스 저장소](https://github.com/boduri83/vividly_html_slide_maker_op)의 `main`을 공개 기본 브랜치로 사용한다. 배포 버전에 대응하는 소스는 해당 버전의 동봉 자료와 커밋을 기준으로 확인하며, 저장소의 최신 상태와 과거 배포본을 동일한 것으로 취급하지 않는다.

도형 데이터는 [LibreOffice/core](https://github.com/LibreOffice/core)의 commit **`9dea406ab7695df6325b11b0e19fdca8db4b7276`**에 고정했다. [원본 경로](https://github.com/LibreOffice/core/blob/9dea406ab7695df6325b11b0e19fdca8db4b7276/oox/source/drawingml/customshapes/presetShapeDefinitions.xml)는 `oox/source/drawingml/customshapes/presetShapeDefinitions.xml`이다.

- [보존한 XML](assets/vendor/shapes/presetShapeDefinitions.xml)
- [생성 템플릿](assets/vendor/shapes/runtime-template.js)과 [생성 모듈](src/shapes.js)
- [재생성 도구](scripts/build-shapes.py), [출처·해시](assets/vendor/shapes/provenance.json), [라이선스](assets/vendor/shapes/LICENSE.txt)와 [고지](assets/vendor/shapes/NOTICE.txt)

저장소 루트 또는 해당 상대 트리를 제공하는 패키지의 `resources/app/`에서 `python scripts/build-shapes.py`로 재생성한다. 각 파일의 기존 고지를 보존한다. Python은 소스 재생성 도구이며 일반 앱 실행의 추가 조건이 아니다.

## HTML과 정적 출력

새 HTML은 자체 MPL 고지와 함께 `vividly-runtime-source`라는 별도 소스 제공 블록을 내장한다. 독립 HTML에는 실행하지 않는 JSON script, 정적 HTML에는 JSON을 이스케이프한 template으로 제공한다. 원본 모듈·라이선스·고지·고정 의존성/재생성 자료와 파일별 byte 수·SHA-256이 들어 있으며 사용자 문서 metadata와 분리한다. `scripts/extract-export-source.mjs`로 새 폴더에 해시를 확인해 추출하는 방법은 내장 `readme`를 따른다. 이 방식은 원격 저장소 접속 없이 HTML 자체에서 대응 소스를 얻도록 하며 사용자 발표 내용 전체에 MPL을 부여하지 않는다.

Chart.js·@kurkle/color와 Matter.js의 전체 MIT 전문은 각각 해당 runtime을 직렬화하는 경로에서 보존한다. SVG 자료에는 고정 Lucide ISC·Feather MIT 고지도 보수적으로 함께 넣는다. 현재 SVG에 정밀한 출처 표지가 없으므로 모든 SVG가 Lucide라고 판정하지 않는다. 편집기·MCP 번들 58개 전체를 모든 HTML에 넣지는 않는다.

MPL 프로그램 코드·동반 소스 자료와 렌더링된 SVG 기하를 구분한다. 소스 제공 블록의 프로그램은 실행용으로 평가하지 않는다. PNG/PDF 생성에 쓰는 임시 HTML의 주석 전문이 최종 PNG/PDF에 포함되는 것은 아니며 별도 고지 파일이나 시각 워터마크를 추가한 것으로 표시하지 않는다. 기존 HTML을 새 고지·소스로 소급 변경하지 않는다.

[MPL 공식 FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/)
