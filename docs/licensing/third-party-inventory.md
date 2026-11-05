# 제3자 소프트웨어와 자산

Vividly 자체 소프트웨어에는 [MPL-2.0](../../LICENSE)을 적용합니다. 앱에 포함된 제3자 구성 요소의 저작권과 라이선스는 각 고지를 따릅니다. 배포본과 독립 HTML의 대응 소스를 얻는 방법은 [Vividly 고지](../../NOTICE.md)를 참고하세요.

| 구성 요소 | 라이선스와 자료 |
| --- | --- |
| LibreOffice DrawingML preset 데이터 | MPL-2.0. [고정 원본](https://github.com/LibreOffice/core/blob/9dea406ab7695df6325b11b0e19fdca8db4b7276/oox/source/drawingml/customshapes/presetShapeDefinitions.xml), [저장소의 XML](../../assets/vendor/shapes/presetShapeDefinitions.xml), [생성 템플릿](../../assets/vendor/shapes/runtime-template.js), [라이선스](../../assets/vendor/shapes/LICENSE.txt), [고지](../../assets/vendor/shapes/NOTICE.txt), [출처·해시](../../assets/vendor/shapes/provenance.json) |
| Lucide `lucide-static` 1.66.0 | ISC. Feather에서 가져온 아이콘의 MIT 고지도 포함합니다. [원본 SVG](../../assets/vendor/icons/originals/), [라이선스](../../assets/vendor/icons/LICENSE.txt), [고지](../../assets/vendor/icons/NOTICE.txt), [출처](../../assets/vendor/icons/provenance.json) |
| Colibre UI 아이콘 | LibreOffice 배포본의 CC0 고지. [아이콘과 고지](../../assets/ui/), [출처](../../assets/ui/provenance.json) |
| Chart.js 4.6.1 · @kurkle/color 0.3.2 | MIT. [Chart.js 라이선스](../../assets/vendor/charts/LICENSE.md), [@kurkle/color 라이선스](../../assets/vendor/charts/KURKLE-COLOR-LICENSE.md), [고지](../../assets/vendor/charts/NOTICE.txt), [출처](../../assets/vendor/charts/provenance.json) |
| Matter.js 0.20.0 | MIT. [번들 고지](../../assets/vendor/THIRD-PARTY-NOTICES.txt)와 [독립 HTML용 런타임](../../src/scene-vendor.js)에 전문을 포함합니다. |
| 편집기·CSS·부분 서식·MCP 번들 | [구성 요소·버전·라이선스 목록](../../assets/vendor/dependencies.json), [라이선스 전문과 저작권 고지](../../assets/vendor/THIRD-PARTY-NOTICES.txt), [고정 의존성](../../package-lock.json) |
| Electron 45.1.0과 Chromium·Node.js 등 | Electron은 MIT입니다. 배포 폴더의 `LICENSE` 및 `LICENSES.chromium.html`에서 런타임에 포함된 각 구성 요소의 고지를 확인하세요. |
| NSIS 3.13 설치 프로그램 | [원래 고지 전문](../../desktop/installer/NSIS-COPYING.txt), [도구 버전·출처·해시](../../desktop/installer/toolchain.json), [설치 원본](../../desktop/installer/vividly.nsi), [빌드 스크립트](../../scripts/build-windows-installer.mjs) |

DrawingML 원본은 위 LibreOffice 커밋에 고정되어 있습니다. XML의 SHA-256은 `eaff19f4405b3be6822428c96ef46cc685499217366fd58e5e63a5a24739f02f`입니다. 저장소 루트에서 `python scripts/build-shapes.py`를 실행하면 [도형 모듈](../../src/shapes.js)을 재생성합니다. `python scripts/build-chart-vendor.py --bundled`는 동봉한 Chart.js UMD와 고지로부터 [차트 모듈](../../src/chart-vendor.js)을 재생성합니다.

Windows 배포본에서는 앱 소스를 `resources/app/src/`와 `resources/app/desktop/`에서, 빌드 자료를 `resources/app/licensing/build-source/`에서 확인할 수 있습니다. [개발 안내](../development/repository.md)와 릴리스 태그에 해당 버전의 빌드 방법과 소스를 제공합니다.
