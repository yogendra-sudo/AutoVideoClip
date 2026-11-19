#!/usr/bin/env python3
"""
AutoClip weekly feedback digest: new GitHub Issues + Discussions + PostHog in-app feedback.

Designed for Cursor Automation (cloud cron), but can also be run manually. Uses only the Python 3 standard library.
Feishu spreadsheets are no longer read because their forms cannot follow the app's eight UI languages.

Data sources (unavailable sources are skipped and noted in the digest)
  GitHub   : `gh` CLI (preferred) or GH_TOKEN + REST. Includes Discussions.
  PostHog  : POSTHOG_PERSONAL_API_KEY + POSTHOG_PROJECT_ID (HogQL query for
             `feedback_submitted` / `survey sent` events).

Delivery
  FEISHU_WEBHOOK_URL (group custom-bot webhook; optional FEISHU_WEBHOOK_SECRET signature).
  If no webhook is configured, print to stdout only.

Usage
  python3 scripts/weekly_digest.py                # Print a Markdown digest
  python3 scripts/weekly_digest.py --json         # Print raw data for an agent to summarize
  python3 scripts/weekly_digest.py --post         # Generate and send to Feishu
  python3 scripts/weekly_digest.py --post --message-file digest.md   # Send agent-edited text
  python3 scripts/weekly_digest.py --days 14      # Set a custom time window
"""
from __future__ import annotations

import argparse
import base64
import datetime as dt
import hashlib
import hmac
import json
import os
import shutil
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

REPO = os.environ.get("AUTOCLIP_REPO", "yogendra-sudo/AutoVideoClip")
POSTHOG_HOST = os.environ.get("POSTHOG_HOST", "https://us.posthog.com").rstrip("/")

CATEGORY_LABEL = {"bug": "Bug", "idea": "Feature request", "feature": "Feature request", "other": "Other"}


# ---------------------------------------------------------------- helpers ---
def _http_json(url: str, *, method: str = "GET", headers: dict[str, str] | None = None, body: Any = None, timeout: int = 30) -> Any:
    data = None
    hdrs = {"Accept": "application/json", **(headers or {})}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        hdrs.setdefault("Content-Type", "application/json; charset=utf-8")
    req = urllib.request.Request(url, data=data, method=method, headers=hdrs)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8")
    return json.loads(raw) if raw else {}


def _run(cmd: list[str], timeout: int = 60) -> tuple[int, str, str]:
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    return p.returncode, p.stdout, p.stderr


def _parse_iso(s: str) -> dt.datetime | None:
    if not s:
        return None
    try:
        s = s.replace("Z", "+00:00")
        d = dt.datetime.fromisoformat(s)
        if d.tzinfo is None:
            d = d.replace(tzinfo=dt.timezone.utc)
        return d
    except ValueError:
        return None


def _trunc(s: str, n: int = 120) -> str:
    s = " ".join((s or "").split())
    return s if len(s) <= n else s[: n - 1] + "…"


# ---------------------------------------------------------------- GitHub ---
def fetch_github(since: dt.datetime) -> dict[str, Any]:
    day = since.date().isoformat()
    out: dict[str, Any] = {"ok": False, "opened": [], "closed": [], "note": ""}
    fields = "number,title,labels,state,createdAt,closedAt,url,author"
    if shutil.which("gh"):
        try:
            rc, so, se = _run(["gh", "issue", "list", "--repo", REPO, "--state", "all", "--limit", "200",
                               "--search", f"created:>={day}", "--json", fields])
            if rc != 0:
                raise RuntimeError(se.strip())
            opened = json.loads(so or "[]")
            rc, so, se = _run(["gh", "issue", "list", "--repo", REPO, "--state", "closed", "--limit", "200",
                               "--search", f"closed:>={day}", "--json", fields])
            closed = json.loads(so or "[]") if rc == 0 else []
        except Exception as e:  # noqa: BLE001
            out["note"] = f"gh failed: {e}"
            return out
    else:
        token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
        if not token:
            out["note"] = "Neither gh nor GH_TOKEN is available"
            return out
        hdr = {"Authorization": f"Bearer {token}", "X-GitHub-Api-Version": "2022-11-28"}
        try:
            q = f"repo:{REPO} is:issue created:>={day}"
            r = _http_json(f"https://api.github.com/search/issues?q={urllib.parse.quote(q)}&per_page=100", headers=hdr)
            opened = [_gh_norm(i) for i in r.get("items", [])]
            q = f"repo:{REPO} is:issue closed:>={day}"
            r = _http_json(f"https://api.github.com/search/issues?q={urllib.parse.quote(q)}&per_page=100", headers=hdr)
            closed = [_gh_norm(i) for i in r.get("items", [])]
        except Exception as e:  # noqa: BLE001
            out["note"] = f"GitHub API failed: {e}"
            return out

    def norm(i: dict[str, Any]) -> dict[str, Any]:
        return {
            "number": i.get("number"),
            "title": i.get("title", ""),
            "labels": [l.get("name") if isinstance(l, dict) else str(l) for l in i.get("labels", [])],
            "state": (i.get("state") or "").lower(),
            "created_at": i.get("createdAt") or i.get("created_at"),
            "url": i.get("url") or i.get("html_url"),
            "author": (i.get("author") or {}).get("login") if isinstance(i.get("author"), dict) else i.get("author"),
        }

    out.update(ok=True, opened=[norm(i) for i in opened], closed=[norm(i) for i in closed])
    return out


def _gh_norm(i: dict[str, Any]) -> dict[str, Any]:
    return {
        "number": i.get("number"), "title": i.get("title"), "labels": i.get("labels", []),
        "state": i.get("state"), "createdAt": i.get("created_at"), "closedAt": i.get("closed_at"),
        "url": i.get("html_url"), "author": {"login": (i.get("user") or {}).get("login")},
    }


# ---------------------------------------------------------------- PostHog ---
def fetch_posthog(since: dt.datetime, days: int) -> dict[str, Any]:
    out: dict[str, Any] = {"ok": False, "items": [], "survey_responses": 0, "note": ""}
    key, pid = os.environ.get("POSTHOG_PERSONAL_API_KEY"), os.environ.get("POSTHOG_PROJECT_ID")
    if not (key and pid):
        out["note"] = "POSTHOG_PERSONAL_API_KEY / POSTHOG_PROJECT_ID is not set"
        return out
    hdr = {"Authorization": f"Bearer {key}"}
    q = f"""
      SELECT timestamp, properties.category, properties.source, properties.stage, properties.text,
             properties.app_version, properties.os, properties.arch, properties.llm_provider, properties.llm_model,
             properties.error_message, properties.contact, distinct_id
      FROM events
      WHERE event = 'feedback_submitted' AND timestamp > now() - INTERVAL {int(days)} DAY
      ORDER BY timestamp DESC LIMIT 300
    """
    try:
        r = _http_json(f"{POSTHOG_HOST}/api/projects/{pid}/query/", method="POST", headers=hdr,
                       body={"query": {"kind": "HogQLQuery", "query": q}})
        cols = ["time", "category", "source", "stage", "text", "app_version", "os", "arch", "llm_provider",
                "llm_model", "error_message", "contact", "distinct_id"]
        for row in r.get("results", []):
            item = dict(zip(cols, row))
            out["items"].append(item)
        r2 = _http_json(f"{POSTHOG_HOST}/api/projects/{pid}/query/", method="POST", headers=hdr,
                        body={"query": {"kind": "HogQLQuery",
                                        "query": f"SELECT count() FROM events WHERE event = 'survey sent' AND timestamp > now() - INTERVAL {int(days)} DAY"}})
        res = r2.get("results") or [[0]]
        out["survey_responses"] = int(res[0][0] or 0)
        out["ok"] = True
    except urllib.error.HTTPError as e:
        out["note"] = f"PostHog HTTP {e.code}: {e.read().decode('utf-8', 'ignore')[:200]}"
    except Exception as e:  # noqa: BLE001
        out["note"] = f"PostHog failed: {e}"
    return out


def fetch_discussions(since: dt.datetime) -> dict[str, Any]:
    try:
        from community_board import fetch_discussions as load
    except ImportError as exc:
        return {"ok": False, "items": [], "note": f"Could not read discussions: {exc}"}
    data = load()
    if not data.get("ok"):
        return data
    kept = []
    for item in data["items"]:
        stamp = _parse_iso(item.get("updated_at") or item.get("created_at") or "")
        if stamp is not None and stamp >= since:
            kept.append(item)
    return {"ok": True, "items": kept, "note": ""}


# ---------------------------------------------------------------- render ---
def render_markdown(data: dict[str, Any]) -> str:
    since, until = data["window"]["since"], data["window"]["until"]
    gh, talks, ph = data["github"], data["discussions"], data["posthog"]
    L: list[str] = []
    L.append(f"**AutoClip Weekly Feedback Digest** · {since[:10]} → {until[:10]}")
    L.append("")

    # Overview
    n_gh = len(gh["opened"]) if gh["ok"] else "—"
    n_talks = len(talks["items"]) if talks["ok"] else "—"
    n_ph = len(ph["items"]) if ph["ok"] else "—"
    L.append(f"New GitHub Issues: **{n_gh}** (closed: {len(gh['closed']) if gh['ok'] else '—'}) · Discussions: **{n_talks}** · In-app feedback: **{n_ph}**")
    L.append("")

    # GitHub
    L.append(f"**GitHub**（[{REPO}](https://github.com/{REPO}/issues)）")
    if not gh["ok"]:
        L.append(f"- Not read: {gh['note']}")
    elif not gh["opened"]:
        L.append("- No new Issues this week.")
    else:
        for i in gh["opened"][:15]:
            tag = f"[{', '.join(i['labels'])}] " if i["labels"] else ""
            st = "" if i["state"] == "open" else " ✓ Closed"
            L.append(f"- [#{i['number']}]({i['url']}) {tag}{_trunc(i['title'], 70)}{st}")
        if len(gh["opened"]) > 15:
            L.append(f"- … and {len(gh['opened']) - 15} more")
    L.append("")

    L.append(f"**Discussions** ([open](https://github.com/{REPO}/discussions))")
    if not talks["ok"]:
        L.append(f"- Not read: {talks['note']}")
    elif not talks["items"]:
        L.append("- No discussions in this window. Use Discussions as the source for feature requests; do not create roadmap cards directly from in-app feedback.")
    else:
        for item in talks["items"][:15]:
            L.append(f"- [{item.get('category') or '—'}] [{_trunc(item['title'], 70)}]({item['url']}) ↑{item.get('upvotes') or 0}")
        if len(talks["items"]) > 15:
            L.append(f"- … and {len(talks['items']) - 15} more")
    L.append("")

    # PostHog
    L.append("**In-app feedback** (PostHog)")
    if not ph["ok"]:
        L.append(f"- Not read: {ph['note']}")
    elif not ph["items"]:
        L.append("- No in-app feedback this week.")
    else:
        by_cat: dict[str, int] = {}
        by_src: dict[str, int] = {}
        for it in ph["items"]:
            by_cat[CATEGORY_LABEL.get(str(it.get("category")), str(it.get("category")))] = by_cat.get(CATEGORY_LABEL.get(str(it.get("category")), str(it.get("category"))), 0) + 1
            by_src[str(it.get("source") or "—")] = by_src.get(str(it.get("source") or "—"), 0) + 1
        L.append("- Categories: " + " · ".join(f"{k} {v}" for k, v in sorted(by_cat.items(), key=lambda kv: -kv[1])) +
                 "; sources: " + " · ".join(f"{k} {v}" for k, v in sorted(by_src.items(), key=lambda kv: -kv[1])) +
                 (f"; survey responses: {ph['survey_responses']}" if ph["survey_responses"] else ""))
        for it in ph["items"][:12]:
            meta = " · ".join(str(x) for x in [CATEGORY_LABEL.get(str(it.get("category")), it.get("category")), it.get("app_version"), it.get("os"),
                                              (f"{it.get('llm_provider')}/{it.get('llm_model')}" if it.get("llm_provider") else None)] if x)
            err = f"  `{_trunc(str(it['error_message']), 60)}`" if it.get("error_message") else ""
            L.append(f"- [{meta}] {_trunc(str(it.get('text') or ''), 90)}{err}")
        if len(ph["items"]) > 12:
            L.append(f"- … and {len(ph['items']) - 12} more")
    L.append("")
    L.append("_The digest agent will add a summary and recommendations below._")
    return "\n".join(L)


# ---------------------------------------------------------------- send ---
def post_feishu(markdown: str, title: str = "AutoClip Weekly Feedback Digest") -> None:
    url = os.environ.get("FEISHU_WEBHOOK_URL")
    if not url:
        raise SystemExit("FEISHU_WEBHOOK_URL is not set; cannot send the digest.")
    body: dict[str, Any] = {
        "msg_type": "interactive",
        "card": {
            "config": {"wide_screen_mode": True},
            "header": {"title": {"tag": "plain_text", "content": title}, "template": "grey"},
            "elements": [{"tag": "markdown", "content": markdown}],
        },
    }
    secret = os.environ.get("FEISHU_WEBHOOK_SECRET")
    if secret:
        ts = str(int(dt.datetime.now(dt.timezone.utc).timestamp()))
        string_to_sign = f"{ts}\n{secret}"
        sign = base64.b64encode(hmac.new(string_to_sign.encode("utf-8"), b"", digestmod=hashlib.sha256).digest()).decode()
        body["timestamp"], body["sign"] = ts, sign
    r = _http_json(url, method="POST", body=body)
    if r.get("code") not in (0, None) or (r.get("StatusCode") not in (0, None)):
        raise SystemExit(f"Feishu webhook returned an error: {r}")
    print("Sent to Feishu.", file=sys.stderr)


# ---------------------------------------------------------------- main ---
def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--days", type=int, default=7, help="Time window in days (default: 7)")
    ap.add_argument("--json", action="store_true", help="Output raw JSON data instead of Markdown")
    ap.add_argument("--post", action="store_true", help="Send to Feishu (requires FEISHU_WEBHOOK_URL)")
    ap.add_argument("--message-file", help="Send Markdown from this file, typically an agent-edited version, instead of generated text")
    ap.add_argument("--title", default="AutoClip Weekly Feedback Digest")
    args = ap.parse_args()

    if args.post and args.message_file:
        with open(args.message_file, encoding="utf-8") as f:
            post_feishu(f.read(), args.title)
        return 0

    until = dt.datetime.now(dt.timezone.utc)
    since = until - dt.timedelta(days=args.days)
    data = {
        "window": {"since": since.isoformat(), "until": until.isoformat(), "days": args.days},
        "github": fetch_github(since),
        "discussions": fetch_discussions(since),
        "posthog": fetch_posthog(since, args.days),
    }
    if args.json:
        print(json.dumps(data, ensure_ascii=False, indent=2))
        return 0
    md = render_markdown(data)
    print(md)
    if args.post:
        post_feishu(md, args.title)
    return 0


if __name__ == "__main__":
    sys.exit(main())
