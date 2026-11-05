"""Create a fresh portable ZIP and compare every archived file with its package receipt."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def identity(stream):
    size, digest = 0, hashlib.sha256()
    for chunk in iter(lambda: stream.read(1024 * 1024), b""):
        size += len(chunk)
        digest.update(chunk)
    return size, digest.hexdigest()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package-report", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    package_path, output = args.package_report.resolve(), args.output.resolve()
    assert package_path.is_relative_to(ROOT / "artifacts") and output.is_relative_to(ROOT / "artifacts")
    package = json.loads(package_path.read_text(encoding="utf-8"))
    directory = Path(package["directory"]).resolve()
    metadata = json.loads((directory / "resources/app/package.json").read_text(encoding="utf-8"))
    archive_name = metadata["productName"]
    assert archive_name and not any(char in archive_name for char in '/\\:') and archive_name not in {".", ".."}
    assert directory.is_relative_to(ROOT / "artifacts")
    with zipfile.ZipFile(output, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for row in package["files"]:
            source = (directory / row["path"]).resolve()
            assert source.is_relative_to(directory)
            with source.open("rb") as stream:
                assert identity(stream) == (row["bytes"], row["sha256"]), f"Package changed: {row['path']}"
            archive.write(source, archive_name + "/" + row["path"])
    with zipfile.ZipFile(output) as archive:
        assert set(archive.namelist()) == {archive_name + "/" + row["path"] for row in package["files"]}
        for row in package["files"]:
            with archive.open(archive_name + "/" + row["path"]) as stream:
                assert identity(stream) == (row["bytes"], row["sha256"]), f"ZIP entry differs: {row['path']}"
    with output.open("rb") as stream:
        size, digest = identity(stream)
    result = {"schema_version": 1, "utc": datetime.now(timezone.utc).isoformat(),
              "scope": "ZIP entries and runtime byte identities; application checks are separate",
              "path": output.relative_to(ROOT).as_posix(), "bytes": size, "sha256": digest,
              "entries": len(package["files"]), "verifiedAllEntryHashes": True,
              "package_report": package_path.relative_to(ROOT).as_posix()}
    Path(str(output) + ".report.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))
