#!/usr/bin/env python3
"""
Extract a version section from CHANGELOG.md and append platform installation instructions for a GitHub Release body.
The release job in desktop-build.yml calls this script; preview it locally with:

    python scripts/release_notes.py v1.3.0            # Print the release notes
    python scripts/release_notes.py v1.3.0 -o body.md

If a version is not found in the changelog, print only the platform instructions so the release is not blocked. Uses only the standard library.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHANGELOG = ROOT / "CHANGELOG.md"

DOWNLOAD_NOTES = """\
### Download and install

| Platform | File | First launch |
|---|---|---|
| macOS 15 or later (Apple Silicon) | `AutoClip.Desktop_{ver}_aarch64.dmg` | Double-click once. If blocked: System Settings → Privacy & Security → **Open Anyway** ([Apple](https://developer.apple.com/news/?id=saqachfa)) |
| Older macOS (Apple Silicon) | Same as above | Not notarized: right-click the app → **Open** |
| Windows 10/11 x64 | `AutoClip.Desktop_{ver}_x64-setup.exe` | Unsigned: SmartScreen → **More info → Run anyway** |
| CLI / MCP (Python 3.11+) | `autovideoclip-{ver}-cli-mcp.zip` / `autovideoclip_mcp-{ver}-py3-none-any.whl` | ZIP includes installation and model setup instructions; FFmpeg is required |

There is currently no desktop installer for Intel Macs; use Docker (`DOCKER.md`) or the CLI. Linux also has no desktop installer; use Docker, the `uvx` command above, or `pip install -e .` to run the `autovideoclip` CLI.

Both desktop packages include a portable Python runtime and static FFmpeg, so nothing needs to be installed in advance. The Windows installer is per-user and does not require administrator privileges; WebView2 is downloaded if needed.
Without downloading the ZIP: run `uvx autovideoclip-mcp` to install and start the MCP server, or `npx skills add yogendra-sudo/AutoVideoClip` to install the skill. Source installation is also available (`python -m pip install --no-deps .` from the repository root).

If the project list is empty after installation, select "Explore a sample project" on the home page. The sample is included in the installer and does not require an API key.
The first time you process a video without subtitles, the app downloads a local transcription component (about 220 MB; around 15 minutes on some networks). If installation fails or is too slow, open "Settings → Default model → Speech to subtitles" and switch to cloud transcription; audio is uploaded to the cloud. If import is blocked, select "Use cloud transcription".

A video without subtitles downloads the local transcription component the first time (about 220 MB, about 15 minutes on a slow network). Built-in portable Python + static ffmpeg, nothing else to install. On macOS 15 and later, double-click once; if blocked, open System Settings → Privacy & Security → Open Anyway ([Apple](https://developer.apple.com/news/?id=saqachfa)). Older macOS: right-click the app → Open. Windows is unsigned (SmartScreen → More info → Run anyway). There is no Intel Mac desktop build; use Docker or the CLI. If a listed file is missing, that platform's build failed for this tag — see the Desktop Build workflow run.
Without the ZIP: `uvx autovideoclip-mcp` installs and starts MCP, and `npx skills add yogendra-sudo/AutoVideoClip` installs the skill. Installing from a source checkout still works (`python -m pip install --no-deps .` from the repo root).
"""

FEEDBACK_NOTES = """\
### Feedback
- Known issues and current status: #96 · Report reproducible bugs with an [Issue template](https://github.com/yogendra-sudo/AutoVideoClip/issues/new/choose) · Share ideas and use cases in [Discussions](https://github.com/yogendra-sudo/AutoVideoClip/discussions)
"""


def changelog_section(version: str) -> str | None:
    """Return the body between `## [version]` and the next `## [` heading, excluding the heading."""
    if not CHANGELOG.exists():
        return None
    text = CHANGELOG.read_text(encoding="utf-8")
    m = re.search(rf"^## \[{re.escape(version)}\][^\n]*\n(.*?)(?=^## \[|\Z)", text, re.MULTILINE | re.DOTALL)
    if not m:
        return None
    body = m.group(1).strip()
    return body or None


def build(tag: str) -> str:
    ver = tag.lstrip("v")
    parts = [f"## AutoClip Desktop v{ver}\n", DOWNLOAD_NOTES.format(ver=ver)]
    section = changelog_section(ver)
    if section:
        parts.append("### Changes\n\n" + section + "\n")
    else:
        parts.append(f"_No [{ver}] section was found in CHANGELOG.md; see [CHANGELOG.md](https://github.com/yogendra-sudo/AutoVideoClip/blob/main/CHANGELOG.md) for all changes._\n")
    parts.append(FEEDBACK_NOTES)
    return "\n".join(parts)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("tag", help="For example, v1.3.0")
    ap.add_argument("-o", "--output", help="Write to a file; otherwise, print to stdout")
    args = ap.parse_args(argv)

    body = build(args.tag)
    if args.output:
        Path(args.output).write_text(body, encoding="utf-8")
    else:
        sys.stdout.write(body)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
