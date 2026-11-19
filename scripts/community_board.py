#!/usr/bin/env python3
"""Shared model for the AutoClip community board.

Discussions are the public intake channel; Issues are requests that have been accepted for tracking.
The GitHub Project Status is the public roadmap. `status:*` labels mirror the status for agents:
automations that read only Issues do not need Project permissions. If the two disagree, trust the Project
and sync the labels to it.

This file uses only the standard library. Fetching data requires an authenticated local `gh` CLI.
"""
from __future__ import annotations

import json
import re
import subprocess
from typing import Any

REPO = "yogendra-sudo/AutoVideoClip"
PROJECT_TITLE = "AutoClip Roadmap"
DISCUSSIONS_URL = f"https://github.com/{REPO}/discussions"
ISSUES_URL = f"https://github.com/{REPO}/issues/new/choose"

# Public roadmap columns. Agents must not move cards to planned / building / testing / shipped.
STATUSES: list[dict[str, str]] = [
    {
        "id": "exploring",
        "name": "💡 Exploring",
        "label": "status:exploring",
        "color": "6e7781",
        "project_color": "GRAY",
        "description": "Raised by the community; not yet evaluated",
    },
    {
        "id": "researching",
        "name": "🔬 Researching",
        "label": "status:researching",
        "color": "0969da",
        "project_color": "BLUE",
        "description": "Worth investigating; move here only after human confirmation",
    },
    {
        "id": "planned",
        "name": "📅 Planned",
        "label": "status:planned",
        "color": "1f6feb",
        "project_color": "BLUE",
        "description": "Accepted for implementation; work has not started",
    },
    {
        "id": "building",
        "name": "🚧 Building",
        "label": "status:building",
        "color": "bf8700",
        "project_color": "YELLOW",
        "description": "In progress, or merged to main but not yet released",
    },
    {
        "id": "testing",
        "name": "🧪 Testing",
        "label": "status:testing",
        "color": "bc4c00",
        "project_color": "ORANGE",
        "description": "An installable package or runnable build is available for acceptance",
    },
    {
        "id": "shipped",
        "name": "🚀 Shipped",
        "label": "status:shipped",
        "color": "1a7f37",
        "project_color": "GREEN",
        "description": "Included in a release",
    },
]

STATUS_BY_ID = {s["id"]: s for s in STATUSES}
STATUS_BY_LABEL = {s["label"]: s for s in STATUSES}
AGENT_LOCKED_STATUSES = {"planned", "building", "testing", "shipped"}

# Five public entry points. Slugs follow GitHub's existing categories and space-to-hyphen rules.
CATEGORIES: list[dict[str, Any]] = [
    {
        "name": "Ideas",
        "emoji": ":bulb:",
        "slug": "ideas",
        "is_answerable": False,
        "create": True,
        "description": "What would you like AutoClip to support? Describe the use case first; do not open an Issue.",
    },
    {
        "name": "Use Cases",
        "emoji": ":clapper:",
        "slug": "use-cases",
        "is_answerable": False,
        "create": True,
        "description": "How you use AutoClip: game clips, podcasts, courses, short films, and more.",
    },
    {
        "name": "AI Models",
        "emoji": ":robot:",
        "slug": "ai-models",
        "is_answerable": False,
        "create": True,
        "description": "Which model or provider should be supported, and what is blocking you?",
    },
    {
        "name": "Q&A",
        "emoji": ":raising_hand:",
        "slug": "q-a",
        "is_answerable": True,
        "create": True,
        "description": "How to use the app, choose a model, or tune results. Open an Issue for reproducible bugs.",
    },
    {
        "name": "Announcements",
        "emoji": ":mega:",
        "slug": "announcements",
        "is_answerable": False,
        "create": True,
        "description": "Maintainer announcements about releases, known issues, and changes in direction.",
    },
]

# Existing default repository categories. Update their descriptions rather than deleting them.
SIDE_CATEGORIES: list[dict[str, Any]] = [
    {
        "name": "General",
        "emoji": ":speech_balloon:",
        "slug": "general",
        "is_answerable": False,
        "create": False,
        "description": "Use when no other category fits. Share feature ideas in Ideas, use cases in Use Cases, and model topics in AI Models.",
    },
    {
        "name": "Polls",
        "emoji": ":ballot_box:",
        "slug": "polls",
        "is_answerable": False,
        "create": False,
        "description": "Maintainers start these when community voting is needed. Share everyday ideas in Ideas.",
    },
    {
        "name": "Show and tell",
        "emoji": ":raised_hands:",
        "slug": "show-and-tell",
        "is_answerable": False,
        "create": False,
        "description": "Show videos you made with AutoClip. Share use-case descriptions in Use Cases.",
    },
]

FEATURE_LABEL = {
    "name": "feature",
    "color": "1f6feb",
    "description": "Requests accepted into the backlog. Share early-stage ideas in Discussions instead of opening an Issue.",
}

EN_STOP = {
    "the", "and", "for", "with", "this", "that", "auto", "clip", "autovideoclip",
    "please", "would", "like", "want", "need", "from", "have", "just", "into",
    "feature", "support",
}


def category_url(slug: str) -> str:
    return f"https://github.com/{REPO}/discussions/categories/{slug}"


def tokens(text: str) -> set[str]:
    """Return English-word tokens to help flag possible duplicates for human review."""
    out: set[str] = set()
    for word in re.findall(r"[a-z][a-z0-9+.-]{2,}", (text or "").lower()):
        if word not in EN_STOP:
            out.add(word)
    return out


def find_overlaps(items: list[dict[str, Any]], *, min_shared: int = 2) -> list[dict[str, Any]]:
    """Return item pairs whose shared-token count reaches the threshold."""
    prepared = [(item, tokens(f"{item.get('title', '')}\n{item.get('text', '')}")) for item in items]
    found: list[dict[str, Any]] = []
    for i, (left, lt) in enumerate(prepared):
        if len(lt) < min_shared:
            continue
        for right, rt in prepared[i + 1 :]:
            shared = sorted(lt & rt)
            if len(shared) < min_shared:
                continue
            union = lt | rt
            score = len(shared) / len(union) if union else 0
            found.append({
                "a": left["id"],
                "b": right["id"],
                "shared": shared[:8],
                "jaccard": round(score, 2),
            })
    found.sort(key=lambda row: (-len(row["shared"]), -row["jaccard"], row["a"], row["b"]))
    return found


def discussion_heat(item: dict[str, Any]) -> int:
    return int(item.get("upvotes") or 0) * 2 + int(item.get("comments") or 0) + int(item.get("reactions") or 0)


def plan_categories(existing: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    by_name = {c.get("name"): c for c in existing}
    creates: list[dict[str, Any]] = []
    updates: list[dict[str, Any]] = []
    for spec in [*CATEGORIES, *SIDE_CATEGORIES]:
        current = by_name.get(spec["name"])
        if current is None:
            if spec.get("create"):
                creates.append(spec)
            continue
        changed = {}
        for key, field in (("emoji", "emoji"), ("description", "description"), ("is_answerable", "isAnswerable")):
            if current.get(field) != spec[key]:
                changed[key] = spec[key]
        if changed:
            updates.append({"id": current.get("id"), "name": spec["name"], **changed})
    return {"create": creates, "update": updates}


def plan_labels(existing_names: set[str]) -> list[dict[str, str]]:
    wanted = [
        FEATURE_LABEL,
        *[
            {"name": spec["label"], "color": spec["color"], "description": spec["description"]}
            for spec in STATUSES
        ],
    ]
    return [label for label in wanted if label["name"] not in existing_names]


def plan_status_options(existing: list[dict[str, Any]]) -> list[dict[str, Any]] | None:
    """Return Project Status options to write, or None when they are already in sync."""
    desired_names = [s["name"] for s in STATUSES]
    by_name = {o.get("name"): o for o in existing}
    same_names = [o.get("name") for o in existing] == desired_names
    same_desc = all(
        (by_name.get(s["name"]) or {}).get("description") == s["description"]
        and (by_name.get(s["name"]) or {}).get("color") == s["project_color"]
        for s in STATUSES
    )
    if same_names and same_desc:
        return None
    payload = []
    for spec in STATUSES:
        item: dict[str, Any] = {
            "name": spec["name"],
            "color": spec["project_color"],
            "description": spec["description"],
        }
        current = by_name.get(spec["name"])
        if current and current.get("id"):
            item["id"] = current["id"]
        payload.append(item)
    return payload


def status_of_labels(names: list[str]) -> str | None:
    found = [STATUS_BY_LABEL[name]["id"] for name in names if name in STATUS_BY_LABEL]
    return found[0] if len(found) == 1 else (found[-1] if found else None)


def gh_graphql(query: str, variables: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = json.dumps({"query": query, "variables": variables or {}})
    proc = subprocess.run(
        ["gh", "api", "graphql", "--input", "-"],
        input=payload,
        text=True,
        capture_output=True,
        timeout=60,
    )
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or proc.stdout or "gh GraphQL request failed").strip())
    data = json.loads(proc.stdout or "{}")
    if data.get("errors"):
        raise RuntimeError(json.dumps(data["errors"], ensure_ascii=False)[:500])
    return data.get("data") or {}


def fetch_discussions(*, limit: int = 50) -> dict[str, Any]:
    query = """
    query($owner: String!, $name: String!, $cursor: String) {
      repository(owner: $owner, name: $name) {
        discussions(first: 50, after: $cursor, orderBy: {field: UPDATED_AT, direction: DESC}) {
          pageInfo { hasNextPage endCursor }
          nodes {
            number title url createdAt updatedAt body upvoteCount
            category { name }
            comments { totalCount }
            reactions { totalCount }
            author { login }
          }
        }
      }
    }
    """
    owner, name = REPO.split("/", 1)
    items: list[dict[str, Any]] = []
    cursor = None
    try:
        while len(items) < limit:
            data = gh_graphql(query, {"owner": owner, "name": name, "cursor": cursor})
            conn = data["repository"]["discussions"]
            for node in conn["nodes"]:
                items.append({
                    "id": f"discussion:{node['number']}",
                    "number": node["number"],
                    "title": node.get("title") or "",
                    "url": node.get("url") or "",
                    "category": (node.get("category") or {}).get("name") or "",
                    "created_at": node.get("createdAt") or "",
                    "updated_at": node.get("updatedAt") or "",
                    "author": (node.get("author") or {}).get("login") or "",
                    "upvotes": node.get("upvoteCount") or 0,
                    "comments": (node.get("comments") or {}).get("totalCount") or 0,
                    "reactions": (node.get("reactions") or {}).get("totalCount") or 0,
                    "text": node.get("body") or "",
                })
                if len(items) >= limit:
                    break
            if not conn["pageInfo"]["hasNextPage"]:
                break
            cursor = conn["pageInfo"]["endCursor"]
    except Exception as exc:  # noqa: BLE001 — Continue the digest if gh or permissions are unavailable.
        return {"ok": False, "items": [], "note": str(exc)}
    return {"ok": True, "items": items, "note": ""}


def fetch_open_issues() -> dict[str, Any]:
    proc = subprocess.run(
        ["gh", "issue", "list", "--repo", REPO, "--state", "open", "--limit", "100",
         "--json", "number,title,labels,url,createdAt,body"],
        text=True, capture_output=True, timeout=60,
    )
    if proc.returncode != 0:
        return {"ok": False, "items": [], "note": (proc.stderr or proc.stdout or "gh issue list failed").strip()}
    items = []
    for raw in json.loads(proc.stdout or "[]"):
        labels = [label.get("name", "") for label in raw.get("labels") or []]
        items.append({
            "id": f"issue:{raw['number']}",
            "number": raw["number"],
            "title": raw.get("title") or "",
            "url": raw.get("url") or "",
            "labels": labels,
            "status": status_of_labels(labels),
            "created_at": raw.get("createdAt") or "",
            "text": raw.get("body") or "",
        })
    return {"ok": True, "items": items, "note": ""}
