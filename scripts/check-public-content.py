"""Check Git's staged tree or a revision for private paths and REA tokens."""

import argparse
import re
import subprocess
import sys


PATH_SEPARATOR = r"(?:[\\/]|%2f|%5c|\\u002f|\\u005c)"
HOME_PATH = (
    rf"(?i)[a-z](?::|%3a|\\u003a){PATH_SEPARATOR}+users{PATH_SEPARATOR}+"
    r"(?!(?:redacted|public|default)(?![\w.-]))"
    r"[^\s\\/:<>\x22\x27]"
)
REA_TOKEN = r"(?i)[\x22\x27]token\\*[\x22\x27]\s*:\s*\\*[\x22\x27][a-f0-9]{64}\\*[\x22\x27]"
UTF16_MARKERS = r"(?i)(?:u\x00s\x00e\x00r\x00s\x00|\x00u\x00s\x00e\x00r\x00s|t\x00o\x00k\x00e\x00n\x00|\x00t\x00o\x00k\x00e\x00n)"
RULES = (("Windows user path", HOME_PATH), ("REA token", REA_TOKEN))


def matching_files(pattern, revision, *, binary=False):
    source = [revision] if revision else ["--cached"]
    result = subprocess.run(
        ["git", "grep", "-a" if binary else "-I", "--full-name", "-l", "-z", "-P",
         "-e", pattern, *source, "--", ":/"],
        stdout=subprocess.PIPE, check=False,
    )
    if result.returncode not in (0, 1):
        raise SystemExit(result.returncode)
    prefix = revision + ":" if revision else ""
    return [name.decode("utf-8", "replace").removeprefix(prefix)
            for name in result.stdout.split(b"\0") if name]


def collect_findings(revision):
    findings = {(category, path) for category, pattern in RULES
                for path in matching_files(pattern, revision)}
    for path in matching_files(UTF16_MARKERS, revision, binary=True):
        data = subprocess.check_output(["git", "show", f"{revision or ''}:{path}"])
        for encoding in ("utf-16-le", "utf-16-be"):
            content = data.decode(encoding, errors="replace")
            findings.update((category, path) for category, pattern in RULES
                            if re.search(pattern, content))
    return findings


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ref", help="Check a Git revision instead of the staged tree")
    args = parser.parse_args()
    if args.ref:
        revision = subprocess.check_output(
            ["git", "rev-parse", "--verify", "--end-of-options", args.ref + "^{tree}"],
            text=True,
        ).strip()
    else:
        revision = None
    findings = collect_findings(revision)
    for category, path in sorted(findings):
        print(f"{category}: {path}", file=sys.stderr)
    if findings:
        return 1
    print("Public text check passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
