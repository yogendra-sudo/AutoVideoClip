#!/usr/bin/env bash
# Install the automatic website sync setup into the autoclip_intro repository (one-time setup).
#
#   bash scripts/website/install.sh ../autoclip_intro
#
# Then run `git add -A && git commit -m "build: sync release info automatically" && git push` in autoclip_intro.
# The main repository's repository_dispatch is in the "Notify website" step of .github/workflows/desktop-build.yml.
# Add WEBSITE_DISPATCH_TOKEN under main repository Settings → Secrets (fine-grained PAT for autoclip_intro with Contents: Read and write).
# This is optional: the website workflow has a daily cron fallback, which may delay updates by up to one day.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${1:-}"
if [[ -z "$TARGET" || ! -f "$TARGET/index.html" ]]; then
  echo "Usage: bash scripts/website/install.sh <autoclip_intro repository path> (the directory must contain index.html)" >&2
  exit 1
fi

mkdir -p "$TARGET/scripts" "$TARGET/.github/workflows"
cp "$HERE/sync_release.py" "$TARGET/scripts/sync_release.py"
cp "$HERE/sync-release.yml" "$TARGET/.github/workflows/sync-release.yml"
chmod +x "$TARGET/scripts/sync_release.py" "$HERE/install_publish_guide.py"
grep -q '__pycache__' "$TARGET/.gitignore" 2>/dev/null || echo '__pycache__/' >> "$TARGET/.gitignore"

echo "Copied to $TARGET:"
echo "  scripts/sync_release.py"
echo "  .github/workflows/sync-release.yml"
echo
echo "Syncing once with the latest Release:"
(cd "$TARGET" && python3 scripts/sync_release.py)
echo
echo "Adding the publishing guide page and linking it from the home-page FAQ / footer:"
python3 "$HERE/install_publish_guide.py" "$TARGET"
echo
echo "Next: cd $TARGET && git add -A && git commit -m 'docs: add the publish guide page' && git push"
