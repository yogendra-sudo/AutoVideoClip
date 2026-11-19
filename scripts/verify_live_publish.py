#!/usr/bin/env python3
"""Publish one private test post using local credentials: Upload-Post + Bilibili.

Required environment variables (never written to the repository):

  UPLOAD_POST_API_KEY   Upload-Post API Key
  UPLOAD_POST_USER      Profile with connected accounts (default: main)
  UPLOAD_POST_PLATFORM  Optional; defaults to youtube (includes privacyStatus=private)
  BILIBILI_COOKIE       Browser request Cookie header (SESSDATA / bili_jct / DedeUserID)

Usage:

  python3 scripts/verify_live_publish.py

On success, prints the BV ID and Upload-Post request_id; keys and cookies are never printed.
Exits with a non-zero status on failure. If credentials are missing, reports what is needed instead of claiming success.
"""
from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _die(message: str, code: int = 1) -> None:
    print(f"FAIL: {message}", file=sys.stderr)
    raise SystemExit(code)


def _need(name: str) -> str:
    value = (os.getenv(name) or "").strip()
    if not value:
        _die(f"Missing environment variable: {name}")
    return value


def _make_sample(path: Path) -> None:
    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", "color=c=#1a1a19:s=1280x720:d=3",
        "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
        "-shortest",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
        "-movflags", "+faststart",
        str(path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0 or not path.exists() or path.stat().st_size <= 0:
        detail = (proc.stderr or proc.stdout or "").strip().splitlines()
        _die("ffmpeg failed to generate the test clip" + (f": {detail[-1]}" if detail else ""))


def verify_upload_post(video: Path) -> dict:
    from backend.services import upload_post_publisher as up

    key = _need("UPLOAD_POST_API_KEY")
    user = (os.getenv("UPLOAD_POST_USER") or "main").strip() or "main"
    platform = (os.getenv("UPLOAD_POST_PLATFORM") or "youtube").strip().lower() or "youtube"
    cfg = up.UploadPostConfig(api_key=key, user=user, source="env")
    me = up.me(cfg)
    profiles = up.list_profiles(cfg)
    connected = []
    for profile in profiles:
        if profile.get("username") == user or profile.get("display_name") == user:
            connected = list(profile.get("connected_platforms") or [])
            break
    if not connected and profiles:
        connected = list(profiles[0].get("connected_platforms") or [])
        user = str(profiles[0].get("username") or user)
    if platform not in connected:
        _die(f"profile {user!r} has no connected {platform} account (connected: {', '.join(connected) or 'none'})")

    extra: dict[str, str] = {}
    if platform == "tiktok":
        extra["privacy_level"] = "SELF_ONLY"
    elif platform == "youtube":
        extra["privacyStatus"] = "private"
    else:
        _die(f"Private test publishing currently supports only tiktok / youtube; received {platform}")

    request_id = str(uuid.uuid4())
    title = f"AutoClip private check {time.strftime('%Y%m%d-%H%M%S')}"
    form = {
        "user": user,
        "platform[]": [platform],
        "title": title,
        "async_upload": "true",
        "request_id": request_id,
        "external_id": f"autoclip:live-verify:{request_id[:8]}",
        **extra,
    }
    headers = up._headers(cfg)
    headers["Idempotency-Key"] = request_id
    import requests
    with video.open("rb") as handle:
        resp = requests.post(
            f"{cfg.base_url}/api/upload",
            headers=headers,
            data=form,
            files={"video": (video.name, handle, "video/mp4")},
            timeout=(30, 900),
        )
    data = up._raise_for_response(resp, "submit private test post")
    job_id = data.get("job_id")
    rid = data.get("request_id") or request_id
    print(f"OK upload-post: platform={platform} profile={user} request_id={rid} job_id={job_id or '-'}")
    # Poll once to confirm the remote service accepted the job; it does not have to finish immediately.
    deadline = time.time() + 120
    last = {}
    while time.time() < deadline:
        last = up.get_status(rid, cfg)
        status = str(last.get("status") or "")
        results = last.get("results") or []
        if status in {"completed", "failed", "partial"} or results:
            break
        time.sleep(5)
    print(f"OK upload-post status={last.get('status') or 'pending'} results={len(last.get('results') or [])}")
    return {"request_id": rid, "job_id": job_id, "me": bool(me), "platform": platform, "user": user}


def verify_bilibili(video: Path) -> dict:
    from backend.services import bilibili_publisher as bili

    cookie = _need("BILIBILI_COOKIE")
    info = bili.verify_cookie(cookie)
    uploaded = bili.upload_video(
        info["cookie"],
        video,
        title=f"AutoClip private test post {time.strftime('%Y%m%d-%H%M%S')}",
        description="Visible only to the account owner. Created by scripts/verify_live_publish.py.",
        private=True,
        dtime=None,
    )
    print(f"OK bilibili: nickname={info['nickname']} bvid={uploaded['bvid']} url={uploaded['url']}")
    return uploaded


def main() -> int:
    missing = [name for name in ("UPLOAD_POST_API_KEY", "BILIBILI_COOKIE") if not (os.getenv(name) or "").strip()]
    if missing:
        print("This machine is not ready to publish. Configure the following environment variables first:", file=sys.stderr)
        for name in missing:
            print(f"  {name}", file=sys.stderr)
        print("Optional: UPLOAD_POST_USER (default: main), UPLOAD_POST_PLATFORM (default: youtube)", file=sys.stderr)
        return 2

    with tempfile.TemporaryDirectory(prefix="autoclip-live-publish-") as tmp:
        video = Path(tmp) / "private-check.mp4"
        _make_sample(video)
        up = verify_upload_post(video)
        bili = verify_bilibili(video)
    print(f"DONE private upload-post={up['request_id']} bilibili={bili['bvid']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
