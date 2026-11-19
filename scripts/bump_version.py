#!/usr/bin/env python3
"""
Update release versions and roll the changelog for weekly releases.

    python scripts/bump_version.py 1.3.0            # Update files and roll the changelog without committing
    python scripts/bump_version.py 1.3.0 --commit   # Also commit (do not tag; tags are created manually)
    python scripts/bump_version.py --check          # Check that all version numbers match (for CI)

Files updated:
  src-tauri/tauri.conf.json  "version"
  src-tauri/Cargo.toml       version = "..." ([package] section)
  src-tauri/Cargo.lock       autovideoclip-desktop version
  pyproject.toml             version = "..." ([project] section)
  backend/core/desktop_config.py  AUTOVIDEOCLIP_APP_VERSION fallback
  backend/__init__.py        CLI / MCP __version__
  CHANGELOG.md               Current unreleased section, then a new empty unreleased section; compare links at the bottom

`--check` requires the desktop shell, Cargo, desktop fallback, and __version__ to use the same X.Y.Z version.
The pyproject distribution version may match or use a PEP 440 post-release of the same version
(for example, product 1.5.7 and PyPI 1.5.7.post1). The next `bump_version.py X.Y.Z` invocation
will update pyproject to the new product version as well.

Uses only the standard library.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO_URL = "https://github.com/yogendra-sudo/AutoVideoClip"

TAURI_CONF = ROOT / "src-tauri" / "tauri.conf.json"
CARGO_TOML = ROOT / "src-tauri" / "Cargo.toml"
CARGO_LOCK = ROOT / "src-tauri" / "Cargo.lock"
PYPROJECT = ROOT / "pyproject.toml"
DESKTOP_CONFIG = ROOT / "backend" / "core" / "desktop_config.py"
PACKAGE_INIT = ROOT / "backend" / "__init__.py"
CHANGELOG = ROOT / "CHANGELOG.md"

SEMVER = re.compile(r"^\d+\.\d+\.\d+$")
LOCK_VERSION = re.compile(r'(^name = "autovideoclip-desktop"\nversion = ")[^"]+("$)', re.MULTILINE)
PYPROJECT_KEY = "pyproject.toml"
UNRELEASED_HEADER = "## [" + "\u672a\u53d1\u5e03" + "]"


def pypi_version_matches_product(product: str, pypi: str) -> bool:
    """Return whether the PyPI version matches the product version or is its post-release (for example, 1.5.7.post1)."""
    if not SEMVER.fullmatch(product or ""):
        return False
    if pypi == product:
        return True
    return re.fullmatch(re.escape(product) + r"\.post[1-9]\d*", pypi or "") is not None


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def _write(p: Path, s: str) -> None:
    p.write_text(s, encoding="utf-8")


# ------------------------------------------------------------------ readers ---

def current_versions() -> dict[str, str]:
    out: dict[str, str] = {}
    out["tauri.conf.json"] = json.loads(_read(TAURI_CONF))["version"]

    m = re.search(r'^\[package\][^\[]*?^version\s*=\s*"([^"]+)"', _read(CARGO_TOML), re.MULTILINE | re.DOTALL)
    out["Cargo.toml"] = m.group(1) if m else "?"

    m = LOCK_VERSION.search(_read(CARGO_LOCK))
    out["Cargo.lock"] = m.group(0).split('version = "', 1)[1].rstrip('"') if m else "?"

    m = re.search(r'^\[project\][^\[]*?^version\s*=\s*"([^"]+)"', _read(PYPROJECT), re.MULTILINE | re.DOTALL)
    out["pyproject.toml"] = m.group(1) if m else "?"

    m = re.search(r'os\.getenv\("AUTOVIDEOCLIP_APP_VERSION",\s*"([^"]+)"\)', _read(DESKTOP_CONFIG))
    out["desktop_config.py"] = m.group(1) if m else "?"
    m = re.search(r'^__version__\s*=\s*"([^"]+)"', _read(PACKAGE_INIT), re.MULTILINE)
    out["backend/__init__.py"] = m.group(1) if m else "?"
    return out


# ------------------------------------------------------------------ writers ---

def set_version(new: str) -> None:
    conf = json.loads(_read(TAURI_CONF))
    conf["version"] = new
    _write(TAURI_CONF, json.dumps(conf, ensure_ascii=False, indent=2) + "\n")

    def _sub_section(text: str, section: str) -> str:
        # Replace only the first version in the requested section; do not touch dependency versions.
        pattern = re.compile(rf'(^\[{re.escape(section)}\][^\[]*?^version\s*=\s*")[^"]+(")', re.MULTILINE | re.DOTALL)
        new_text, n = pattern.subn(rf"\g<1>{new}\g<2>", text, count=1)
        if n != 1:
            raise SystemExit(f"Could not find a version field in the [{section}] section")
        return new_text

    _write(CARGO_TOML, _sub_section(_read(CARGO_TOML), "package"))
    locked, n = LOCK_VERSION.subn(rf'\g<1>{new}\g<2>', _read(CARGO_LOCK), count=1)
    if n != 1:
        raise SystemExit("Could not find the autovideoclip-desktop version in Cargo.lock")
    _write(CARGO_LOCK, locked)
    _write(PYPROJECT, _sub_section(_read(PYPROJECT), "project"))

    dc = _read(DESKTOP_CONFIG)
    dc_new, n = re.subn(r'(os\.getenv\("AUTOVIDEOCLIP_APP_VERSION",\s*")[^"]+(")', rf"\g<1>{new}\g<2>", dc, count=1)
    if n != 1:
        raise SystemExit("Could not find the AUTOVIDEOCLIP_APP_VERSION fallback in desktop_config.py")
    _write(DESKTOP_CONFIG, dc_new)
    package, n = re.subn(r'(^__version__\s*=\s*")[^"]+("$)', rf"\g<1>{new}\g<2>", _read(PACKAGE_INIT), count=1, flags=re.MULTILINE)
    if n != 1:
        raise SystemExit("Could not find __version__ in backend/__init__.py")
    _write(PACKAGE_INIT, package)


def roll_changelog(new: str, today: str) -> None:
    text = _read(CHANGELOG)
    if f"## [{new}]" in text:
        print(f"CHANGELOG already contains [{new}]; skipping rollover")
        return
    if UNRELEASED_HEADER not in text:
        raise SystemExit("CHANGELOG.md has no unreleased section")

    text = text.replace(
        UNRELEASED_HEADER,
        f"{UNRELEASED_HEADER}\n\n_No changes this week._\n\n## [{new}] - {today}",
        1,
    )

    # Point the bottom Unreleased link to the new tag and add a compare link for the release.
    prev = None
    m = re.search(r"^- \[Unreleased\]: .*/compare/v([\d.]+)\.\.\.HEAD$", text, re.MULTILINE)
    if m:
        prev = m.group(1)
        text = re.sub(
            r"^- \[Unreleased\]: .*$",
            f"- [Unreleased]: {REPO_URL}/compare/v{new}...HEAD",
            text,
            count=1,
            flags=re.MULTILINE,
        )
        link = (f"- [{new}]: {REPO_URL}/compare/v{prev}...v{new}" if prev != new
                else f"- [{new}]: {REPO_URL}/releases/tag/v{new}")
        text = text.replace(
            f"- [Unreleased]: {REPO_URL}/compare/v{new}...HEAD",
            f"- [Unreleased]: {REPO_URL}/compare/v{new}...HEAD\n{link}",
            1,
        )
    _write(CHANGELOG, text)


# --------------------------------------------------------------------- main ---

def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("version", nargs="?", help="New version number, for example 1.3.0")
    ap.add_argument("--check", action="store_true", help="Only check that all version numbers match")
    ap.add_argument("--commit", action="store_true", help="Run git commit -m 'chore: release vX.Y.Z' after updating files")
    ap.add_argument("--date", default=dt.datetime.now(tz=dt.timezone.utc).astimezone().date().isoformat(), help="Date to use in CHANGELOG; defaults to today")
    args = ap.parse_args(argv)

    versions = current_versions()
    if args.check or not args.version:
        product_versions = {k: v for k, v in versions.items() if k != PYPROJECT_KEY}
        distinct = set(product_versions.values())
        pypi = versions.get(PYPROJECT_KEY, "")
        for k, v in versions.items():
            print(f"{k:20s} {v}")
        product = next(iter(distinct)) if len(distinct) == 1 else ""
        if len(distinct) != 1 or not pypi_version_matches_product(product, pypi):
            print("Version numbers do not match", file=sys.stderr)
            return 1
        if pypi == product:
            print(f"Versions match: {product}")
        else:
            print(f"Versions match: product {product}, PyPI {pypi}")
        return 0

    new = args.version.lstrip("v")
    if not SEMVER.match(new):
        raise SystemExit(f"Version must be X.Y.Z: {args.version}")

    set_version(new)
    roll_changelog(new, args.date)
    print(f"Updated {', '.join(versions)} to {new}; rolled CHANGELOG to [{new}] - {args.date}")

    if args.commit:
        files = [str(p.relative_to(ROOT)) for p in (TAURI_CONF, CARGO_TOML, CARGO_LOCK, PYPROJECT, DESKTOP_CONFIG, PACKAGE_INIT, CHANGELOG)]
        subprocess.run(["git", "add", *files], cwd=ROOT, check=True)
        subprocess.run(["git", "commit", "-m", f"chore: release v{new}"], cwd=ROOT, check=True)
        print("Committed the unreleased candidate source. Next: push the candidate branch and run an untagged Desktop Build. Create a tag with an acceptance receipt on the accepted commit only after product acceptance on both platforms and Internal Acceptance pass.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
