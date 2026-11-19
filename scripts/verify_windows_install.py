#!/usr/bin/env python3
"""Post-install Windows smoke test: use the Python runtime in the install directory.

No network access or model key is required. Checks:
- The backend starts in desktop mode and passes /health.
- The origin guard allows the app's origin and rejects write requests from other sites.
- Bundled ffmpeg generates, clips, and probes video (a common Windows failure point).
- yt-dlp can locate bundled ffmpeg (required to merge audio and video during link imports).
- Save a provider, upload a real public interview and SRT, and complete the pipeline to produce H.264/AAC output.
  The model is a loopback protocol fixture; this verifies installation, not editing quality.

Usage (called by CI after a silent NSIS install):
    "<install directory>\\resources\\python\\python.exe" -B scripts\\verify_windows_install.py --resources "<install directory>\\resources"
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.dont_write_bytecode = True
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
sys.path.insert(0, str(Path(__file__).resolve().parent))
from posthog_bundle_check import (  # noqa: E402
    assert_binary_contains_posthog_key,
    assert_packaged_telemetry_identity,
)
# CI consoles default to cp1252 and may fail when printing Unicode; the desktop app sets PYTHONUTF8 in Rust, so set it here too.
for stream in (sys.stdout, sys.stderr):
    try:
        stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

parser = argparse.ArgumentParser()
parser.add_argument("--resources", type=Path, required=True)
parser.add_argument("--report", type=Path)
parser.add_argument("--launch-desktop", action="store_true", help="Start the backend through the installed desktop executable")
parser.add_argument('--source-video', type=Path, default=Path(__file__).resolve().parents[1] / 'backend/assets/example/source.mp4')
parser.add_argument('--source-srt', type=Path, default=Path(__file__).resolve().parents[1] / 'backend/assets/example/source.srt')
args = parser.parse_args()
if args.report:
    args.report = args.report.resolve()
args.source_video = args.source_video.resolve(strict=True)
args.source_srt = args.source_srt.resolve(strict=True)
resources = args.resources.resolve(strict=True)
if not Path(sys.executable).resolve().is_relative_to(resources / "python"):
    parser.error("Run this with python.exe from the install directory, not the development Python")

ffmpeg = resources / "ffmpeg" / "ffmpeg.exe"
ffprobe = resources / "ffmpeg" / "ffprobe.exe"
for required in (resources / "backend" / "desktop_main.py", resources / "backend" / "core" / "failure_messages.json", resources / "backend" / "assets" / "fonts" / "NotoSansSC-Medium.ttf", ffmpeg, ffprobe):
    if not required.is_file():
        raise SystemExit(f"Required file is missing from the install directory: {required}")

root = Path(tempfile.mkdtemp(prefix="autoclip-win-smoke-"))
os.environ.update(
    AUTOCLIP_APP_DIR=str(root / "data"), AUTOCLIP_DATA_DIR=str(root / "data"),
    AUTOCLIP_DESKTOP_MODE="true", AUTOCLIP_MODE="desktop",
    AUTOCLIP_BUILD_ENVIRONMENT="production",
    DATABASE_URL="sqlite:///" + str(root / "smoke.sqlite").replace("\\", "/"),
    SENTRY_DSN="", PYTHONUTF8="1", PYTHONIOENCODING="utf-8",
    AUTOCLIP_FFMPEG_PATH=str(ffmpeg), AUTOCLIP_FFPROBE_PATH=str(ffprobe),
)
(root / "data").mkdir()
(root / "data" / "privacy.json").write_text('{"crash_reports":false,"analytics":false}', encoding="utf-8")
os.chdir(resources)
sys.path.insert(0, str(resources))
report = {"python": sys.version.split()[0], "resources": str(resources)}
assert_packaged_telemetry_identity()
from windows_python_crt import verify as verify_python_crt
report['python_crt'] = verify_python_crt(resources / 'python')


def step(name):
    print(f"==> {name}", flush=True)


step("Generate, clip, and probe video with bundled ffmpeg")
source = root / "fixture.mp4"
subprocess.run([str(ffmpeg), "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=3",
                "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=3",
                "-c:v", "libx264", "-c:a", "aac", "-shortest", str(source)], check=True, timeout=60)
clip = root / "clip \u4e2d\u6587 name.mp4"  # A non-ASCII filename previously caused a 500 (#189).
subprocess.run([str(ffmpeg), "-v", "error", "-ss", "1", "-i", str(source), "-t", "1", "-c", "copy", str(clip)],
               check=True, timeout=60)
probe = json.loads(subprocess.run([str(ffprobe), "-v", "error", "-show_format", "-of", "json", str(clip)],
                                  check=True, capture_output=True, text=True, encoding="utf-8").stdout)
assert 0.5 <= float(probe["format"]["duration"]) <= 1.6, probe
report["ffmpeg_clip"] = "passed"

step("yt-dlp locates bundled ffmpeg")
from backend.utils.ffmpeg_utils import ytdlp_ffmpeg_options  # noqa: E402
opts = ytdlp_ffmpeg_options()
assert Path(opts.get("ffmpeg_location", "")).resolve() == ffmpeg.resolve(), opts
report["ytdlp_ffmpeg"] = "passed"

step("Start desktop app" if args.launch_desktop else "Start desktop backend")
if args.launch_desktop:
    apps = [p for p in resources.parent.glob('*.exe') if 'uninstall' not in p.name.lower()]
    assert len(apps) == 1, f"Could not uniquely locate the installed app: {apps}"
    from windows_desktop_crt import verify
    assert_binary_contains_posthog_key(apps[0], os.environ.get("VITE_PUBLIC_POSTHOG_KEY", ""))
    report['desktop_crt'] = verify(apps[0])
    assert report['desktop_crt']['status'] == 'passed', report['desktop_crt']
    command = [str(apps[0])]
    report['desktop_executable'] = apps[0].name
else:
    command = [sys.executable, "-B", "-m", "backend.desktop_main"]
proc = subprocess.Popen(command, cwd=resources, env=os.environ.copy(),
                        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8",
                        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
lines, port = [], {}


def pump():
    for line in proc.stdout:
        lines.append(line.rstrip())
        if line.startswith('Backend output: '):
            line = line.removeprefix('Backend output: ')
        if line.startswith("PORT=") and "port" not in port:
            port["port"] = int(line.split("=", 1)[1])


threading.Thread(target=pump, daemon=True).start()
try:
    deadline = time.time() + 90
    while "port" not in port and time.time() < deadline and proc.poll() is None:
        time.sleep(0.5)
    if "port" not in port:
        print("\n".join(lines[-60:]))
        raise SystemExit("Desktop backend did not print PORT= within 90 seconds")
    base = f"http://127.0.0.1:{port['port']}"
    with urlopen(base + "/health", timeout=10) as r:
        assert r.status == 200
    with urlopen(base + "/api/v1/projects/", timeout=15) as r:
        assert r.status == 200
    report["backend_health"] = "passed"
    if args.launch_desktop:
        import ctypes
        from ctypes import wintypes
        user32 = ctypes.WinDLL('user32', use_last_error=True)
        callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
        user32.EnumWindows.argtypes = [callback_type, wintypes.LPARAM]
        user32.IsWindowVisible.argtypes = [wintypes.HWND]
        user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
        windows = []
        @callback_type
        def inspect_window(handle, _):
            pid = wintypes.DWORD()
            user32.GetWindowThreadProcessId(handle, ctypes.byref(pid))
            if pid.value == proc.pid and user32.IsWindowVisible(handle):
                windows.append(handle)
            return True
        deadline = time.monotonic() + 15
        while not windows and time.monotonic() < deadline:
            user32.EnumWindows(inspect_window, 0)
            if not windows:
                time.sleep(.5)
        assert windows, "Desktop app did not create a visible window"
        report['desktop_window'] = 'passed'

    step("Origin guard")
    def post(origin):
        req = Request(base + "/api/v1/settings/privacy", method="PUT", data=b'{"crash_reports":false}',
                      headers={"Content-Type": "application/json", "Origin": origin})
        try:
            with urlopen(req, timeout=10) as r:
                return r.status
        except HTTPError as e:
            return e.code
    assert post("http://tauri.localhost") != 403, "The Windows app's own origin was blocked"
    assert post("https://evil.example") == 403, "A write request from another site was not blocked"
    report["origin_guard"] = "passed"

    step("Save provider and process a real local video (loopback protocol fixture)")
    from installed_video_acceptance import run
    report["installed_video"] = run(base, root, resources, args.source_video, args.source_srt)
except BaseException:
    print("\n".join(lines[-120:]), flush=True)
    raise
finally:
    proc.terminate()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()

print(json.dumps(report, ensure_ascii=False, indent=2))
if args.report:
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
