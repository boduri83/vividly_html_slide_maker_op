"""Compile selected original Lucide SVGs into closed, editable Vividly path data."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import re
import tarfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
VERSION = "1.66.0"
CATEGORIES = [
    ("business", "업무·계획"), ("data", "데이터·성과"), ("people", "사람·소통"),
    ("design", "아이디어·디자인"), ("technology", "기술·보안"), ("status", "상태·강조"),
]
ICONS = {
    "business": [
        ("briefcase-business", "업무 가방"), ("building-2", "회사"), ("handshake", "협력"),
        ("presentation", "프레젠테이션"), ("clipboard-check", "할 일 확인"),
        ("calendar-days", "일정"), ("clock", "시간"), ("goal", "목표 달성"),
        ("flag", "이정표"), ("trophy", "트로피"),
    ],
    "data": [
        ("chart-column", "막대 차트"), ("chart-line", "선 차트"), ("chart-pie", "원형 차트"),
        ("trending-up", "성장"), ("percent", "백분율"), ("database", "데이터베이스"),
        ("gauge", "측정"), ("target", "타깃"), ("calculator", "계산"), ("table-2", "표"),
    ],
    "people": [
        ("users", "사람들"), ("user-round", "사용자"), ("user-round-check", "고객 확인"),
        ("contact-round", "연락처"), ("message-circle", "대화"), ("messages-square", "의견 교환"),
        ("mail", "이메일"), ("phone", "전화"), ("video", "화상 회의"), ("megaphone", "홍보"),
    ],
    "design": [
        ("lightbulb", "아이디어"), ("palette", "팔레트"), ("pen-tool", "벡터 디자인"),
        ("paintbrush", "붓"), ("image", "이미지"), ("shapes", "도형"),
        ("wand-sparkles", "마법 도구"), ("sparkles", "반짝임"), ("layers", "레이어"),
        ("layout-dashboard", "대시보드"),
    ],
    "technology": [
        ("monitor", "모니터"), ("laptop", "노트북"), ("smartphone", "스마트폰"),
        ("tablet", "태블릿"), ("cloud", "클라우드"), ("globe", "세계"),
        ("wifi", "무선 연결"), ("code-xml", "코드"), ("shield-check", "안전 확인"),
        ("lock-keyhole", "잠금"),
    ],
    "status": [
        ("check", "체크"), ("circle-check", "완료"), ("circle-alert", "알림"),
        ("triangle-alert", "주의"), ("info", "정보"), ("circle-question-mark", "도움말"),
        ("heart", "하트"), ("star", "별"), ("zap", "번개"), ("rocket", "로켓"),
    ],
}


def compact(number):
    return format(float(number), ".10g")


def canonical_path(source):
    """Separate valid compact SVG arc flags before the closed runtime validator sees them."""
    number = re.compile(r"[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?")
    sizes = {"m": 2, "l": 2, "h": 1, "v": 1, "c": 6, "s": 4, "q": 4, "t": 2, "a": 7, "z": 0}
    output, i, command = [], 0, None
    while i < len(source):
        while i < len(source) and source[i] in " \t\r\n,":
            i += 1
        if i == len(source):
            break
        if source[i].isalpha():
            command = source[i]
            assert command.lower() in sizes, "Unsupported original SVG command"
            i += 1
            if command.lower() == "z":
                output.append(command)
                command = None
                continue
        assert command is not None, "SVG path command required"
        values = []
        for slot in range(sizes[command.lower()]):
            while i < len(source) and source[i] in " \t\r\n,":
                i += 1
            if command.lower() == "a" and slot in (3, 4):
                assert i < len(source) and source[i] in "01", "SVG arc flag required"
                values.append(source[i])
                i += 1
            else:
                match = number.match(source, i)
                assert match, "SVG coordinate required"
                values.append(compact(match.group()))
                i = match.end()
        output.append(command + " ".join(values))
        if command == "m":
            command = "l"
        elif command == "M":
            command = "L"
    return " ".join(output)


def primitive_path(node):
    kind = node.tag.split("}")[-1]
    a = node.attrib
    n = lambda key, default=0: float(a.get(key, default))
    f = compact
    if kind == "path":
        return a["d"]
    if kind == "line":
        return f"M{f(n('x1'))} {f(n('y1'))}L{f(n('x2'))} {f(n('y2'))}"
    if kind in ("polygon", "polyline"):
        numbers = re.findall(r"[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?", a["points"])
        assert len(numbers) >= 4 and len(numbers) % 2 == 0
        return "M" + "L".join(f"{f(numbers[i])} {f(numbers[i+1])}" for i in range(0, len(numbers), 2)) + ("Z" if kind == "polygon" else "")
    if kind in ("circle", "ellipse"):
        cx, cy = n("cx"), n("cy")
        rx, ry = (n("r"), n("r")) if kind == "circle" else (n("rx"), n("ry"))
        return f"M{f(cx-rx)} {f(cy)}A{f(rx)} {f(ry)} 0 1 0 {f(cx+rx)} {f(cy)}A{f(rx)} {f(ry)} 0 1 0 {f(cx-rx)} {f(cy)}Z"
    if kind == "rect":
        x, y, w, h = n("x"), n("y"), n("width"), n("height")
        rx = min(n("rx", a.get("ry", 0)), w / 2)
        ry = min(n("ry", a.get("rx", 0)), h / 2)
        if rx == 0 or ry == 0:
            return f"M{f(x)} {f(y)}H{f(x+w)}V{f(y+h)}H{f(x)}Z"
        return (f"M{f(x+rx)} {f(y)}H{f(x+w-rx)}A{f(rx)} {f(ry)} 0 0 1 {f(x+w)} {f(y+ry)}"
                f"V{f(y+h-ry)}A{f(rx)} {f(ry)} 0 0 1 {f(x+w-rx)} {f(y+h)}"
                f"H{f(x+rx)}A{f(rx)} {f(ry)} 0 0 1 {f(x)} {f(y+h-ry)}"
                f"V{f(y+ry)}A{f(rx)} {f(ry)} 0 0 1 {f(x+rx)} {f(y)}Z")
    raise ValueError("Unsupported original Lucide primitive: " + kind)


def compile_catalog(archive, metadata):
    expected = metadata["dist"]["integrity"]
    actual = "sha512-" + base64.b64encode(hashlib.sha512(archive).digest()).decode()
    assert actual == expected, "Published package integrity mismatch"
    import io
    tar = tarfile.open(fileobj=io.BytesIO(archive))
    definitions, originals, manifest = [], {}, []
    for category, _ in CATEGORIES:
        for icon_id, label in ICONS[category]:
            entry = f"package/icons/{icon_id}.svg"
            original = tar.extractfile(entry).read()
            xml = ET.fromstring(original)
            assert xml.attrib["viewBox"] == "0 0 24 24"
            assert xml.attrib.get("fill") == "none" and xml.attrib.get("stroke") == "currentColor"
            shapes = []
            for node in xml:
                assert "transform" not in node.attrib
                d = canonical_path(primitive_path(node))
                assert re.fullmatch(r"[MmLlHhVvCcSsQqTtAaZz0-9eE+.,\s-]+", d)
                shapes.append({"kind": "path", "d": d, "fill": "none", "stroke": "#253858", "strokeWidth": 2, "strokeLinecap": "round", "strokeLinejoin": "round"})
            assert shapes
            definitions.append({"id": icon_id, "label": label, "category": category, "keywords": [icon_id, label], "svg": {"viewBox": {"width": 24, "height": 24}, "shapes": shapes, "title": label}})
            original_file = f"assets/vendor/icons/originals/{icon_id}.svg"
            originals[original_file] = original
            manifest.append({"id": icon_id, "path": original_file, "packageEntry": entry, "bytes": len(original), "sha256": hashlib.sha256(original).hexdigest(), "conversion": "Original path geometry retained with canonical command/number and compact arc-flag separation; rect/circle/ellipse/line/polygon primitives converted exactly to path data. currentColor resolved to an editable HEX stroke; original round caps/joins retained."})
    license_bytes = tar.extractfile("package/LICENSE").read()
    return definitions, originals, manifest, license_bytes


JS_SUFFIX = r'''
const byId = new Map(ICON_DEFINITIONS.map(icon => [icon.id, icon]));
export function getIconDefinition(id) {
  const icon=byId.get(id);
  if(!icon)throw new Error('지원하지 않는 SVG 아이콘입니다.');
  return icon;
}
export function createIconSvg(id,color='#253858') {
  if(typeof color!=='string'||!/^#(?:[a-f\d]{3}|[a-f\d]{4}|[a-f\d]{6}|[a-f\d]{8})$/i.test(color))throw new Error('아이콘 색상은 HEX 값이어야 합니다.');
  const source=getIconDefinition(id).svg;
  return {viewBox:{...source.viewBox},title:source.title,shapes:source.shapes.map(path=>({...path,stroke:color}))};
}
'''


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--metadata", type=Path, required=True)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    archive = args.archive.read_bytes()
    metadata = json.loads(args.metadata.read_text(encoding="utf-8-sig"))
    assert metadata["name"] == "lucide-static" and metadata["version"] == VERSION
    definitions, originals, manifest, license_bytes = compile_catalog(archive, metadata)
    freeze = "const deepFreeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(deepFreeze);Object.freeze(value);}return value;};\n"
    generated = ("/** Selected original Lucide vectors, lucide-static " + VERSION + ". ISC / Feather MIT; see assets/vendor/icons/LICENSE.txt. */\n" + freeze +
                 "export const ICON_SOURCE = Object.freeze({package:'lucide-static',version:'" + VERSION + "',license:'ISC / Feather MIT'});\n" +
                 "export const ICON_CATEGORIES = deepFreeze(" + json.dumps([{"id": i, "label": l} for i, l in CATEGORIES], ensure_ascii=False, separators=(",", ":")) + ");\n" +
                 "export const ICON_DEFINITIONS = deepFreeze(" + json.dumps(definitions, ensure_ascii=False, separators=(",", ":")) + ");\n" + JS_SUFFIX).encode()
    provenance = {"schemaVersion": 1, "package": "lucide-static", "version": VERSION, "sourceRepository": "https://github.com/lucide-icons/lucide", "sourcePackageUrl": metadata["dist"]["tarball"], "packageIntegrity": metadata["dist"]["integrity"], "packageSha256": hashlib.sha256(archive).hexdigest(), "license": "ISC; selected Feather-derived icons additionally MIT (see original LICENSE)", "licenseReference": "https://lucide.dev/license", "catalogCount": len(definitions), "categories": len(CATEGORIES), "generator": "scripts/build-icon-catalog.py", "gitCommit": None, "gitCommitNote": "Published package did not provide gitHead; no source commit is inferred.", "files": manifest}
    outputs = {**originals, "assets/vendor/icons/LICENSE.txt": license_bytes,
               "assets/vendor/icons/provenance.json": (json.dumps(provenance, ensure_ascii=False, indent=2) + "\n").encode(),
               "assets/vendor/icons/NOTICE.txt": (f"Selected Lucide icons from lucide-static {VERSION}\nSource: https://github.com/lucide-icons/lucide\nPublished package: {metadata['dist']['tarball']}\nLicenses: ISC and MIT for Feather-derived icons. Original full notices are in LICENSE.txt.\nOriginal SVG bytes are retained in originals/.\nStructured editable path data retains original icon geometry; primitive normalization is recorded in provenance.json.\nRebuild using scripts/build-icon-catalog.py with the pinned original archive.\n").encode(),
               "src/icon-catalog.js": generated}
    for relative, data in outputs.items():
        destination = ROOT / relative
        if args.check:
            assert destination.read_bytes() == data, "Generated icon data changed: " + relative
        else:
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(data)
    print(json.dumps({"checked": args.check, "icons": len(definitions), "categories": len(CATEGORIES), "originalSvgBytes": sum(len(v) for v in originals.values()), "catalogBytes": len(generated)}))


if __name__ == "__main__":
    main()
