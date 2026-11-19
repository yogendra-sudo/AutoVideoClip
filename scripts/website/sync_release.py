#!/usr/bin/env python3
"""
Sync version numbers, download links, and installer sizes in the website index.html with the latest (or specified) main-repository Release.

    python scripts/sync_release.py            # Use the latest release from yogendra-sudo/AutoVideoClip
    python scripts/sync_release.py v1.3.0     # Specify a tag
    python scripts/sync_release.py --check    # Report whether the site is outdated without editing files (exit code 1 = outdated)

Replaces three manual steps previously needed for each release:
  1. Version numbers and download links in the hero and download section (four locales)
  2. Installer sizes on download cards
  3. Version number in hero.note

Uses only the standard library; called by .github/workflows/sync-release.yml (repository_dispatch / daily cron / manual).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "index.html"
REPO = "yogendra-sudo/AutoVideoClip"
ASSETS = {
    "mac": re.compile(r"^AutoClip\.Desktop_(?P<ver>[\d.]+)_aarch64\.dmg$"),
    "win": re.compile(r"^AutoClip\.Desktop_(?P<ver>[\d.]+)_x64-setup\.exe$"),
}


def fetch_release(tag: str | None) -> dict:
    url = f"https://api.github.com/repos/{REPO}/releases/" + (f"tags/{tag}" if tag else "latest")
    req = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json", "User-Agent": "autovideoclip-intro-sync"})
    token = os.getenv("GITHUB_TOKEN")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


def pick_assets(release: dict) -> dict[str, dict]:
    found: dict[str, dict] = {}
    for asset in release.get("assets", []):
        for key, pattern in ASSETS.items():
            if pattern.match(asset["name"]):
                found[key] = {"name": asset["name"], "size_mb": round(asset["size"] / 1024 / 1024)}
    missing = [k for k in ASSETS if k not in found]
    if missing:
        raise SystemExit(f"Release {release.get('tag_name')} is missing assets: {missing} (the platform build may have failed or the Release may still be uploading)")
    return found


def current_version(html: str) -> str:
    m = re.search(r"releases/download/v(\d+\.\d+\.\d+)/", html)
    if not m:
        raise SystemExit("Could not find a releases/download/vX.Y.Z/ download link in index.html")
    return m.group(1)


def rewrite(html: str, old: str, new: str, assets: dict[str, dict]) -> str:
    old_re = re.escape(old)
    # 1. Update versions in download links, JS REL / MAC / WIN values, hero.note, etc. (prefixed by v or Desktop_ to avoid changing other numbers)
    html = re.sub(rf"(?<=/v){old_re}(?=/)", new, html)                 # releases/download/v1.2.1/
    html = re.sub(rf"(?<=Desktop_){old_re}(?=_)", new, html)           # AutoClip.Desktop_1.2.1_...
    html = re.sub(rf"\bv{old_re}\b", f"v{new}", html)                  # v1.2.1 in page copy
    # 2. Installer sizes on download cards: <span class="ver">vX.Y.Z · NNN MB</span>, first macOS and then Windows
    sizes = iter([assets["mac"]["size_mb"], assets["win"]["size_mb"]])

    def _size(m: re.Match) -> str:
        return f'{m.group(1)}{next(sizes)} MB'

    html, n = re.subn(rf'(<span class="ver">v{re.escape(new)} · )\d+ MB', _size, html, count=2)
    if n != 2:
        print(f"Warning: updated installer size in only {n}/2 places", file=sys.stderr)
    return html


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("tag", nargs="?", help="For example, v1.3.0; defaults to latest")
    ap.add_argument("--check", action="store_true", help="Compare only; do not write files")
    args = ap.parse_args(argv)

    release = fetch_release(args.tag)
    tag = release["tag_name"]
    new = tag.lstrip("v")
    assets = pick_assets(release)

    html = INDEX.read_text(encoding="utf-8")
    old = current_version(html)
    print(f"Website currently has v{old} → Release {tag} (macOS {assets['mac']['size_mb']} MB / Windows {assets['win']['size_mb']} MB)")

    updated = rewrite(html, old, new, assets)
    if updated == html:
        print("Already up to date; no changes needed")
        return 0
    if args.check:
        print("Website is behind the latest Release")
        return 1
    INDEX.write_text(updated, encoding="utf-8")
    changed = sum(1 for a, b in zip(html.splitlines(), updated.splitlines()) if a != b)
    print(f"Updated index.html ({changed} lines)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
