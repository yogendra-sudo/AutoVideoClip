#!/usr/bin/env python3
"""Write signed update artifacts to the Tauri updater's latest.json.

GitHub Release download URLs replace spaces in filenames with dots; use the same rule to build URLs here.
Skip platforms missing an artifact or .sig file. If no platforms are available, do not write a file (exit code 0).
"""
from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

REPO_DEFAULT = "yogendra-sudo/AutoVideoClip"


def github_asset_url(repo: str, tag: str, filename: str) -> str:
    safe = filename.replace(" ", ".")
    return f"https://github.com/{repo}/releases/download/{tag}/{safe}"


def read_signature(artifact: Path) -> Optional[str]:
    sig = Path(str(artifact) + ".sig")
    if not sig.is_file():
        return None
    text = sig.read_text(encoding="utf-8").strip()
    return text or None


def collect_platforms(
    *,
    repo: str,
    tag: str,
    artifacts: dict[str, Optional[Path]],
) -> dict[str, dict[str, str]]:
    platforms: dict[str, dict[str, str]] = {}
    for platform, path in artifacts.items():
        if path is None:
            continue
        if not path.is_file():
            raise SystemExit(f"Artifact not found: {path}")
        signature = read_signature(path)
        if not signature:
            print(f"NOTE: Skipping {platform} (missing {path.name}.sig)")
            continue
        platforms[platform] = {
            "signature": signature,
            "url": github_asset_url(repo, tag, path.name),
        }
    return platforms


def _version_section(text: str, version: str) -> str | None:
    ver = version.lstrip("v")
    match = re.search(
        rf"^## \[{re.escape(ver)}\][^\n]*\n(.*?)(?=^## \[|\Z)",
        text,
        re.MULTILINE | re.DOTALL,
    )
    if not match:
        return None
    return match.group(1).strip()


def _highlights(section: str) -> str | None:
    """Return the body between the localized key-points heading and the next `##` / `###` heading, excluding the heading."""
    match = re.search(
        r"^### \u8981\u70b9[^\n]*\n(.*?)(?=^#{2,3} |\Z)",
        section,
        re.MULTILINE | re.DOTALL,
    )
    if not match:
        return None
    return match.group(1).strip()


def _cap(body: str, limit: int) -> str:
    if len(body) <= limit:
        return body
    return body[:limit].rstrip() + "…"


def changelog_notes(version: str, changelog: Path, limit: int = 1200) -> str:
    """Use the key-points body when present; otherwise, use up to limit characters from the version section. Return an empty string if the version is absent."""
    if not changelog.is_file():
        return ""
    section = _version_section(changelog.read_text(encoding="utf-8"), version)
    if section is None:
        return ""
    highlights = _highlights(section)
    if highlights is not None:
        return _cap(highlights, limit)
    return _cap(section, limit)


def build_manifest(
    *,
    version: str,
    notes: str,
    pub_date: str,
    platforms: dict[str, dict[str, str]],
) -> dict:
    return {
        "version": version.lstrip("v"),
        "notes": notes,
        "pub_date": pub_date,
        "platforms": platforms,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Write Tauri updater latest.json")
    parser.add_argument("--version", required=True, help="App version, for example 1.2.2 or v1.2.2")
    parser.add_argument("--tag", help="GitHub Release tag (default: v{version})")
    parser.add_argument("--notes", default="", help="Update notes; use the changelog section if --changelog contains one")
    parser.add_argument("--changelog", type=Path, help="CHANGELOG.md; extract this version's section into notes")
    parser.add_argument("--repo", default=REPO_DEFAULT)
    parser.add_argument("--out", required=True, help="Output path for latest.json")
    parser.add_argument("--pub-date", help="ISO-8601 date (default: current UTC time)")
    parser.add_argument("--darwin-aarch64", type=Path)
    parser.add_argument("--darwin-x86_64", type=Path)
    parser.add_argument("--windows-x86_64", type=Path)
    parser.add_argument("--linux-x86_64", type=Path)
    args = parser.parse_args()

    version = args.version.lstrip("v")
    tag = args.tag or f"v{version}"
    notes = args.notes
    if args.changelog:
        from_log = changelog_notes(version, args.changelog)
        if from_log:
            notes = from_log
    if not notes:
        notes = f"AutoClip Desktop v{version}"
    pub_date = args.pub_date or datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace(
        "+00:00", "Z"
    )
    artifacts = {
        "darwin-aarch64": args.darwin_aarch64,
        "darwin-x86_64": args.darwin_x86_64,
        "windows-x86_64": args.windows_x86_64,
        "linux-x86_64": args.linux_x86_64,
    }
    platforms = collect_platforms(repo=args.repo, tag=tag, artifacts=artifacts)
    if not platforms:
        print("NOTE: No platforms have signed artifacts; not writing latest.json (update checks will fail gracefully)")
        return 0

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    payload = build_manifest(version=version, notes=notes, pub_date=pub_date, platforms=platforms)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"OK wrote {out} ({', '.join(platforms)})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
