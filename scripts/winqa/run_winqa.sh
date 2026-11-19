#!/usr/bin/env bash
# AutoClip Windows installer acceptance (command-line portion). Drive a dedicated Windows acceptance machine over SSH from Linux/macOS.
# See README.md in this directory for usage. Host, account, SSH identity, model endpoint, and key are read only from environment variables or arguments; no defaults are stored in the repository:
#   ./run_winqa.sh --prev <previous release setup.exe> --candidate <candidate setup.exe> --version X.Y.Z [options]
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOST="${WINQA_HOST:-}"
USER_="${WINQA_USER:-}"
IDENTITY="${WINQA_SSH_IDENTITY:-}"   # Optional SSH private key path; otherwise use ssh-agent / ~/.ssh/config.
REPO="${WINQA_REPO:-$(cd "$HERE/../.." && pwd)}"
MODEL_BASE_URL="${WINQA_MODEL_BASE_URL:-}"; MODEL="${WINQA_MODEL:-}"; MODEL_PROVIDER="${WINQA_MODEL_PROVIDER:-dashscope}"
MODEL_API_KEY="${WINQA_MODEL_API_KEY:-${AUTOVIDEOCLIP_QA_DASHSCOPE_KEY:-}}"
PREV=""; CAND=""; VERSION=""; PREV_VERSION=""
MARKER='resources\backend\services\studio\readiness.py'
UPDATER_URL='https://github.com/yogendra-sudo/AutoVideoClip/releases/latest/download/latest.json'
SMOKE=1; WITH_ASR=0; FAILURE=1; OUTDIR=""; FROM=0; TO=99; REAL=0; HF_MIRROR=0; BILI_URL=""; LOCAL_SECONDS=150

usage() { sed -n '2,4p' "$0"; cat <<'U'
  --prev FILE            Previous release installer (clean-install it before testing the upgrade)
  --candidate FILE       Candidate installer
  --version X.Y.Z        Candidate version (registry and backend must report this after installation)
  --prev-version X.Y.Z   Previous version (guessed from the filename by default)
  --marker PATH          File present only in the candidate, relative to the install directory, to verify overwrite
  --updater-url URL      latest.json URL used by the in-app updater
  --no-smoke             Skip the CI-equivalent verify_windows_install.py
  --with-asr             Also run verify_sensevoice.py / verify_whisper_recovery.py (downloads runtime and models; may take longer)
  --no-failure           Skip failure-event and fallback probes
  --out DIR              Evidence directory (default: ${WINQA_EVIDENCE_ROOT:-/tmp/autovideoclip-winqa}/evidence-<timestamp>; keep it outside the repository)
  --from-step N          Resume from step N (0-14; requires --out pointing to the existing evidence directory; completed steps are not rerun)
  --to-step N            Stop after step N (steps 8 and 9 still collect and summarize results)
  --real                 Run real-model scenarios for steps 10-14 (incurs model costs and requires authorization); read the key only from WINQA_MODEL_API_KEY and pass it to the acceptance machine via stdin
  --model-base-url URL   Model endpoint saved in step 10 (or WINQA_MODEL_BASE_URL)
  --model ID             Analysis model used in step 10 (or WINQA_MODEL)
  --model-provider NAME  Provider used in step 10 (or WINQA_MODEL_PROVIDER; default: dashscope)
  --hf-mirror            If step 11 cannot download Whisper from huggingface.co, temporarily set the user-level HF_ENDPOINT=hf-mirror.com, restart the app, and retry (a workaround, not a product pass; reverted in step 14)
  --bili-url URL         Public Bilibili short-video link for step 13 (<5 minutes); skipped if omitted
  --local-seconds N      Local video duration for step 12 (default: 150)
  Required environment variables: WINQA_HOST (acceptance machine) and WINQA_USER (Windows user logged in to the interactive desktop)
  Optional environment variables: WINQA_SSH_IDENTITY, WINQA_REPO (defaults to repository root), WINQA_EVIDENCE_ROOT
U
}
while [ $# -gt 0 ]; do
  case "$1" in
    --prev) PREV="$2"; shift 2;; --candidate) CAND="$2"; shift 2;; --version) VERSION="$2"; shift 2;;
    --prev-version) PREV_VERSION="$2"; shift 2;; --marker) MARKER="$2"; shift 2;; --updater-url) UPDATER_URL="$2"; shift 2;;
    --no-smoke) SMOKE=0; shift;; --with-asr) WITH_ASR=1; shift;; --no-failure) FAILURE=0; shift;; --out) OUTDIR="$2"; shift 2;; --from-step) FROM="$2"; shift 2;; --to-step) TO="$2"; shift 2;; --real) REAL=1; shift;; --hf-mirror) HF_MIRROR=1; shift;; --bili-url) BILI_URL="$2"; shift 2;; --local-seconds) LOCAL_SECONDS="$2"; shift 2;;
    --model-base-url) MODEL_BASE_URL="$2"; shift 2;; --model) MODEL="$2"; shift 2;; --model-provider) MODEL_PROVIDER="$2"; shift 2;;
    -h|--help) usage; exit 0;; *) echo "unknown arg $1"; usage; exit 2;;
  esac
done
[ -f "$PREV" ] && [ -f "$CAND" ] && [ -n "$VERSION" ] || { usage; exit 2; }
[ -n "$HOST" ] && [ -n "$USER_" ] || { echo "WINQA_HOST and WINQA_USER environment variables are required"; exit 2; }
[ "$FROM" -gt 0 ] && [ -z "$OUTDIR" ] && { echo "--from-step requires --out pointing to the existing evidence directory"; exit 2; }
[ -n "$PREV_VERSION" ] || PREV_VERSION="$(basename "$PREV" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
TS="$(date +%Y%m%d-%H%M%S)"
OUT="${OUTDIR:-${WINQA_EVIDENCE_ROOT:-${TMPDIR:-/tmp}/autovideoclip-winqa}/evidence-$TS}"
mkdir -p "$OUT"
LOG="$OUT/run.log"
exec > >(tee -a "$LOG") 2>&1

ID_OPT=(); [ -n "$IDENTITY" ] && ID_OPT=(-i "$IDENTITY")
SSH=(ssh ${ID_OPT[@]+"${ID_OPT[@]}"} -o BatchMode=yes -o ConnectTimeout=20 -o ServerAliveInterval=30 "$USER_@$HOST")
SCP=(scp -q ${ID_OPT[@]+"${ID_OPT[@]}"} -o BatchMode=yes -o ConnectTimeout=20)
PS='powershell -NoProfile -ExecutionPolicy Bypass -File'
step() { echo; echo "==== [$(date +%H:%M:%S)] $*"; }
remote() { "${SSH[@]}" "$@"; }
rps() { "${SSH[@]}" 'powershell -NoProfile -ExecutionPolicy Bypass -Command -'; }  # Send PowerShell via stdin to avoid expansion of $ by the remote default shell.
record() { echo "$1=$2" >> "$OUT/steps.txt"; echo "-> $1: $2"; }  # Append results so completed steps survive a resume.
want() { [ "$FROM" -le "$1" ] && [ "$1" -le "$TO" ]; }
pull() { "${SCP[@]}" "$USER_@$HOST:C:/winqa/out/$1" "$OUT/" 2>/dev/null || true; }
pull_all() { "${SCP[@]}" -r "$USER_@$HOST:C:/winqa/out/*" "$OUT/" 2>/dev/null || true; }

step "0. Prepare locally  prev=$PREV ($PREV_VERSION)  candidate=$CAND ($VERSION)"
PREV_SHA=$(sha256sum "$PREV" | cut -d' ' -f1); CAND_SHA=$(sha256sum "$CAND" | cut -d' ' -f1)
want 0 && printf '{"prev":{"file":"%s","version":"%s","sha256":"%s"},"candidate":{"file":"%s","version":"%s","sha256":"%s"},"repo_commit":"%s","started_at":"%s"}\n' \
  "$(basename "$PREV")" "$PREV_VERSION" "$PREV_SHA" "$(basename "$CAND")" "$VERSION" "$CAND_SHA" \
  "$(git -C "$REPO" rev-parse HEAD 2>/dev/null)" "$(date -Iseconds)" > "$OUT/inputs.json"
cat "$OUT/inputs.json"
remote 'hostname' >/dev/null || { echo "SSH connection failed (check WINQA_HOST / WINQA_USER / WINQA_SSH_IDENTITY)"; exit 3; }

if want 1; then
step "1. Upload scripts, installers, and repository files used by the CI smoke test"
remote 'powershell -NoProfile -Command "New-Item -ItemType Directory -Force C:\winqa\ps,C:\winqa\py,C:\winqa\inst,C:\winqa\out,C:\winqa\repo | Out-Null"'
"${SCP[@]}" "$HERE"/ps/*.ps1 "$USER_@$HOST:C:/winqa/ps/"
"${SCP[@]}" "$HERE"/py/*.py "$USER_@$HOST:C:/winqa/py/"
remote_hash() { remote "powershell -NoProfile -Command \"if (Test-Path C:\\winqa\\inst\\$1) { (Get-FileHash C:\\winqa\\inst\\$1).Hash.ToLower() }\"" | tr -d '\r'; }
# The copy /b chunk list is C:\winqa\inst\parts-<dst>\p00+.... Previously, sed "s|^|...\\|" escaped the trailing delimiter
# (\|), causing an unterminated substitution and an empty list; the assembled hash never matched (RC156 Win QA #16). printf avoids sed escaping.
windows_parts() { ls "$1" | while IFS= read -r n; do printf 'C:\\winqa\\inst\\parts-%s\\%s\n' "$2" "$n"; done | paste -sd+; }
upload_installer() { # Skip upload if the file is already on the machine with a matching hash; otherwise upload 12 chunks in parallel (3 workers) using resumable sftp reput, then reassemble.
  local src="$1" dst="$2" sha="$3"
  if [ "$(remote_hash "$dst")" = "$sha" ]; then echo "$dst already on VM (hash ok)"; return 0; fi
  local tmp="/tmp/winqa-chunks/$dst"; rm -rf "$tmp"; mkdir -p "$tmp"
  split -n 12 -d -a 2 "$src" "$tmp/p"
  # Create empty chunks on the acceptance machine first so reput can always resume from the uploaded bytes.
  rps <<PS
New-Item -ItemType Directory -Force C:\\winqa\\inst\\parts-$dst | Out-Null
foreach (\$n in '$(ls "$tmp" | paste -sd,)'.Split(',')) { \$f = 'C:\\winqa\\inst\\parts-$dst\\' + \$n; if (-not (Test-Path \$f)) { New-Item -ItemType File \$f | Out-Null } }
PS
  export IDENTITY USER_ HOST dst
  ls "$tmp" | xargs -P 3 -I{} bash -c 'for t in 1 2 3 4 5 6; do echo "reput '"$tmp"'/{} /C:/winqa/inst/parts-$dst/{}" | sftp -q ${IDENTITY:+-i "$IDENTITY"} -o BatchMode=yes -o ServerAliveInterval=15 -b - "$USER_@$HOST" >/dev/null && exit 0; sleep 5; done; exit 1'
  local parts; parts=$(windows_parts "$tmp" "$dst")
  remote "cmd /c copy /y /b $parts C:\\winqa\\inst\\$dst"
  [ "$(remote_hash "$dst")" = "$sha" ] || { echo "upload of $dst failed hash check"; exit 4; }
  remote "powershell -NoProfile -Command \"Remove-Item -Recurse -Force C:\\winqa\\inst\\parts-$dst\""
  rm -rf "$tmp"
}
upload_installer "$PREV" prev-setup.exe "$PREV_SHA"
upload_installer "$CAND" candidate-setup.exe "$CAND_SHA"
tar --sort=name --mtime=@0 --owner=0 --group=0 -C "$REPO" -cf /tmp/winqa-repo.tar scripts/verify_windows_install.py scripts/installed_video_acceptance.py \
  scripts/windows_python_crt.py scripts/windows_desktop_crt.py scripts/verify_sensevoice.py scripts/verify_whisper_recovery.py \
  backend/assets/example/source.mp4 backend/assets/example/source.srt
TAR_SHA=$(sha256sum /tmp/winqa-repo.tar | cut -d' ' -f1)
[ "$(remote_hash ../repo.tar)" = "$TAR_SHA" ] || "${SCP[@]}" /tmp/winqa-repo.tar "$USER_@$HOST:C:/winqa/repo.tar"
remote 'tar -xf C:\winqa\repo.tar -C C:\winqa\repo'
fi

if want 2; then
step "2. Clean up previous installations and user data (idempotent)"
remote "$PS C:\\winqa\\ps\\clean.ps1" && record clean ok || record clean FAIL
remote "$PS C:\\winqa\\ps\\env.ps1 -PrevInstaller C:\\winqa\\inst\\prev-setup.exe -CandInstaller C:\\winqa\\inst\\candidate-setup.exe"
pull clean.json; pull env.json
fi

if want 3; then
step "3. Clean-install previous release $PREV_VERSION and launch it on the interactive desktop"
remote "$PS C:\\winqa\\ps\\seed_privacy.ps1"
remote "$PS C:\\winqa\\ps\\install.ps1 -Installer C:\\winqa\\inst\\prev-setup.exe -Label prev -ExpectVersion $PREV_VERSION" && record install_prev ok || record install_prev FAIL
remote "$PS C:\\winqa\\ps\\launch.ps1 -Label prev" && record launch_prev ok || record launch_prev FAIL
remote "$PS C:\\winqa\\ps\\ui_probe.ps1 -Label prev" >/dev/null
remote "$PS C:\\winqa\\ps\\runpy.ps1 C:\\winqa\\py\\winqa_probe.py seed" && record seed_prev ok || record seed_prev FAIL
pull_all
fi

if want 4; then
step "4. Keep the previous version running, simulate a leftover python process locking _asyncio.pyd, and silently install candidate $VERSION over it"
remote "$PS C:\\winqa\\ps\\install.ps1 -Installer C:\\winqa\\inst\\candidate-setup.exe -Label upgrade -ExpectVersion $VERSION -Marker '$MARKER' -LockLeftover -Interactive" && record upgrade ok || record upgrade FAIL
pull install-upgrade.json
fi

if want 5; then
step "5. Launch the candidate and check version, health, Celery, settings, preflight, updater manifest, and project list"
remote "$PS C:\\winqa\\ps\\launch.ps1 -Label candidate" && record launch_candidate ok || record launch_candidate FAIL
remote "$PS C:\\winqa\\ps\\ui_probe.ps1 -Label candidate" >/dev/null
remote "$PS C:\\winqa\\ps\\runpy.ps1 C:\\winqa\\py\\winqa_probe.py check --label candidate --expect-version $VERSION --updater-url $UPDATER_URL" && record check_candidate ok || record check_candidate FAIL
fi
if [ "$FAILURE" = 1 ] && want 6; then
  step "6. Failure-event fields and preflight fallback (local loopback fixture / closed port, no cost)"
  remote "$PS C:\\winqa\\ps\\runpy.ps1 C:\\winqa\\py\\winqa_probe.py failure" && record failure_probe ok || record failure_probe FAIL
fi
if want 6; then
remote "$PS C:\\winqa\\ps\\ui_probe.ps1 -Label after-probes" >/dev/null
remote "$PS C:\\winqa\\ps\\stop.ps1 -Label candidate" && record stop_candidate ok || record stop_candidate FAIL
fi
want 6 && pull_all

if [ "$SMOKE" = 1 ] && want 7; then
  step "7. CI-equivalent post-install smoke test: run verify_windows_install.py --launch-desktop with bundled Python"
  A=""; [ "$WITH_ASR" = 1 ] && A="-WithAsr"
  remote "$PS C:\\winqa\\ps\\smoke.ps1 -LaunchDesktop $A" && record smoke ok || record smoke FAIL
  remote "$PS C:\\winqa\\ps\\stop.ps1 -Label smoke" >/dev/null
fi

if [ "$REAL" = 1 ]; then
RP="$PS C:\\winqa\\ps\\runpy.ps1 C:\\winqa\\py\\winqa_real.py"
if want 10; then
  step "10. Real model: save model connection, test connection, resave empty key (#266), and run preflight (key via stdin only)"
  [ -n "$MODEL_API_KEY" ] || { echo "WINQA_MODEL_API_KEY is required"; exit 2; }
  [ -n "$MODEL_BASE_URL" ] && [ -n "$MODEL" ] || { echo "Step 10 requires --model-base-url and --model (or WINQA_MODEL_BASE_URL / WINQA_MODEL)"; exit 2; }
  "${SCP[@]}" "$HERE/py/winqa_real.py" "$USER_@$HOST:C:/winqa/py/winqa_real.py"
  remote "$PS C:\\winqa\\ps\\launch.ps1 -Label real" && record launch_real ok || record launch_real FAIL
  printf '%s\n' "$MODEL_API_KEY" | remote "$RP model --key-stdin --base-url '$MODEL_BASE_URL' --model '$MODEL' --provider '$MODEL_PROVIDER'" && record real_model ok || record real_model FAIL
fi
if want 11; then
  step "11. Whisper: verify preflight blocks import before installation, use the app's own install route, and download the model"
  "${SCP[@]}" "$HERE/py/winqa_real.py" "$USER_@$HOST:C:/winqa/py/winqa_real.py"; "${SCP[@]}" "$HERE/ps/hf_mirror.ps1" "$HERE/ps/clean.ps1" "$USER_@$HOST:C:/winqa/ps/"
  if remote "$RP whisper"; then record real_whisper ok; else
    record real_whisper FAIL
    if [ "$HF_MIRROR" = 1 ]; then
      step "11b. Workaround: set user-level HF_ENDPOINT=https://hf-mirror.com, restart the app, and retry the Whisper model download"
      remote "$PS C:\\winqa\\ps\\hf_mirror.ps1 -On"
      remote "$PS C:\\winqa\\ps\\stop.ps1 -Label real-before-hf" >/dev/null
      remote "$PS C:\\winqa\\ps\\launch.ps1 -Label real-hf" && record launch_real_hf ok || record launch_real_hf FAIL
      remote "$RP whisper --label whisper-hfmirror" && record real_whisper_hfmirror ok || record real_whisper_hfmirror FAIL
    fi
  fi
fi
if want 12; then
  step "12. Local video (no subtitles, ${LOCAL_SECONDS}s) → Whisper transcription → generate with a real model → export + ffprobe"
  "${SCP[@]}" "$HERE/py/winqa_real.py" "$USER_@$HOST:C:/winqa/py/winqa_real.py"
  remote "$RP local --seconds $LOCAL_SECONDS" && record real_local ok || record real_local FAIL
fi
if want 13 && [ -n "$BILI_URL" ]; then
  step "13. Bilibili link import → progress → render  $BILI_URL"
  remote "$RP link --url '$BILI_URL'" && record real_link ok || record real_link FAIL
fi
if want 14; then
  step "14. Verify no stuck processing state on the home page or project list; capture screenshots; stop the app"
  remote "$RP final" && record real_final ok || record real_final FAIL
  remote "$PS C:\\winqa\\ps\\ui_probe.ps1 -Label real" >/dev/null
  remote "$PS C:\\winqa\\ps\\stop.ps1 -Label real" >/dev/null
  remote "$PS C:\\winqa\\ps\\hf_mirror.ps1 -Off" >/dev/null
fi
fi

step "8. Collect and redact logs"
remote "powershell -NoProfile -Command \"Remove-Item -Recurse -Force C:\\winqa\\out\\media,C:\\winqa\\out\\real\\media -ErrorAction SilentlyContinue\""
# Previously, a multiline if block was run from stdin with `powershell -Command -`. PowerShell did not execute it without a trailing blank line (a known stdin behavior,
# and the likely cause); errors were swallowed by catch/2>/dev/null, leaving app-logs empty.
# Run ps/collect_logs.ps1 with -File instead. It copies backend and desktop-shell logs in shared-read mode, packages app-logs.zip, and writes collect-logs-final.json.
remote "$PS C:\\winqa\\ps\\collect_logs.ps1 -Label final" || echo "WARN: collect_logs.ps1 failed"
pull_all
mkdir -p "$OUT/app-logs"
if [ -f "$OUT/app-logs.zip" ]; then
  python3 -c 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' "$OUT/app-logs.zip" "$OUT/app-logs" && rm -f "$OUT/app-logs.zip"
fi
[ -n "$(ls -A "$OUT/app-logs")" ] || echo "WARN: app-logs is empty; see $OUT/collect-logs-final.json"
# Redact secrets, Bearer tokens, and user directories.
find "$OUT" -type f \( -name '*.log' -o -name '*.json' -o -name '*.err' -o -name '*.txt' \) -print0 | xargs -0 -r sed -i -E \
  -e 's/(^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{6,}/\1sk-***/g' -e 's/(Bearer )[A-Za-z0-9._-]+/\1***/g'
rm -rf "$OUT/media" "$OUT/real/media"
WINQA_MODEL_API_KEY="$MODEL_API_KEY" python3 "$HERE/redact.py" "$OUT"  # Replace the exact key from the environment variable and remove the app's masked form.

step "9. Summary"
sort -t= -k1,1 -u "$OUT/steps.txt" -o "$OUT/steps.txt" 2>/dev/null || true
python3 "$HERE/summarize.py" "$OUT" | tee "$OUT/summary.md"
grep -q FAIL "$OUT/steps.txt" && exit 1 || exit 0
