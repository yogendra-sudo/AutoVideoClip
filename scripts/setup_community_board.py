#!/usr/bin/env python3
"""Set up the AutoClip community board on GitHub.

By default, this script only previews changes. Pass --apply to write:

  - status:* and feature labels
  - A public Project named "AutoClip Roadmap" under the user account, with six Status columns

Discussion categories have no public write API. The script compares the current state and prints the categories
that need to be created or updated in the web UI.
--seed-issues creates Issues from entries marked "new issue" in docs/community/roadmap-seed.json and adds them
to the Project. Released history is included in the Project description instead of separate Issues.

Usage
  python3 scripts/setup_community_board.py
  python3 scripts/setup_community_board.py --apply
  python3 scripts/setup_community_board.py --apply --seed-issues
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from community_board import (  # noqa: E402
    CATEGORIES,
    FEATURE_LABEL,
    PROJECT_TITLE,
    REPO,
    STATUS_BY_ID,
    plan_categories,
    plan_labels,
    plan_status_options,
    gh_graphql,
)

ROOT = Path(__file__).resolve().parents[1]
SEED_PATH = ROOT / "docs" / "community" / "roadmap-seed.json"

REPO_QUERY = """
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    id
    owner {
      __typename
      id
      login
      ... on User { projectsV2(first: 20) { nodes { id title number public } } }
      ... on Organization { projectsV2(first: 20) { nodes { id title number public } } }
    }
    discussionCategories(first: 25) { nodes { id name emoji description isAnswerable } }
  }
}
"""

STATUS_FIELD_QUERY = """
query($id: ID!) {
  node(id: $id) {
    ... on ProjectV2 {
      items(first: 1) { totalCount }
      field(name: "Status") {
        ... on ProjectV2SingleSelectField { id options { id name description color } }
      }
    }
  }
}
"""


def _gh_api(method: str, path: str, payload: dict | None = None) -> dict | list:
    cmd = ["gh", "api", "--method", method, path]
    proc = subprocess.run(
        cmd,
        input=json.dumps(payload) if payload is not None else None,
        text=True,
        capture_output=True,
        timeout=60,
    )
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or proc.stdout or f"{method} {path} failed").strip())
    if not proc.stdout.strip():
        return {}
    return json.loads(proc.stdout)


def load_context() -> dict:
    owner, name = REPO.split("/", 1)
    data = gh_graphql(REPO_QUERY, {"owner": owner, "name": name})
    return data["repository"]


def project_readme(seed: dict) -> str:
    lines = [
        "AutoClip's public roadmap. Share ideas in Discussions; this board tracks only accepted requests.",
        "",
        "Exploring → Researching → Planned → Building → Testing → Shipped",
        "",
        "Merging to main is not a release. Cards with code merged to main but not yet released remain in Building. Batch changes into a release instead of tagging each PR.",
        "",
        "See `docs/COMMUNITY_BOARD.md` for the rules.",
        "",
        "## Released",
        "",
    ]
    for item in seed.get("columns", {}).get("shipped", []):
        lines.append(f"- {item['title']}")
    return "\n".join(lines)


def apply_categories(repo: dict) -> None:
    """GitHub's public GraphQL API has no mutation for creating or editing Discussion categories. Compare and print a checklist instead."""
    plan = plan_categories(repo["discussionCategories"]["nodes"])
    if not plan["create"] and not plan["update"]:
        print("Categories already match the design.")
        return
    print("Update Discussion categories in the repository UI (Settings → Discussions or the category editor on the Discussions page):")
    for spec in plan["create"]:
        answerable = " and mark as answerable" if spec["is_answerable"] else ""
        print(f"  Create {spec['emoji']} {spec['name']}{answerable}")
        print(f"    {spec['description']}")
    for spec in plan["update"]:
        print(f"  Update {spec['name']}")
        if "emoji" in spec:
            print(f"    emoji {spec['emoji']}")
        if "description" in spec:
            print(f"    {spec['description']}")
        if "is_answerable" in spec:
            print(f"    Answerable: {spec['is_answerable']}")


def apply_labels(*, write: bool) -> None:
    raw = _gh_api("GET", f"repos/{REPO}/labels?per_page=100")
    existing = {item["name"]: item for item in raw} if isinstance(raw, list) else {}
    missing = plan_labels(set(existing))
    wanted = [
        FEATURE_LABEL,
        *[
            {"name": spec["label"], "color": spec["color"], "description": spec["description"]}
            for spec in STATUS_BY_ID.values()
        ],
    ]
    if not missing and all(_label_matches(existing.get(label["name"]), label) for label in wanted):
        print("All labels are present.")
        return
    for label in missing:
        print(f"Create label {label['name']}")
        if write:
            _gh_api("POST", f"repos/{REPO}/labels", label)
    for label in wanted:
        current = existing.get(label["name"])
        if current and not _label_matches(current, label):
            print(f"Update label {label['name']}")
            if write:
                quoted = urllib.parse.quote(label["name"], safe="")
                _gh_api("PATCH", f"repos/{REPO}/labels/{quoted}", label)


def _label_matches(current: dict | None, wanted: dict) -> bool:
    if not current:
        return False
    return (
        (current.get("description") or "") == wanted["description"]
        and (current.get("color") or "").lower() == wanted["color"].lower()
    )


def ensure_project(repo: dict, seed: dict, *, write: bool) -> dict | None:
    projects = (repo["owner"].get("projectsV2") or {}).get("nodes") or []
    current = next((item for item in projects if item["title"] == PROJECT_TITLE), None)
    if current is None:
        print(f"Create public Project \"{PROJECT_TITLE}\"")
        if not write:
            return None
        created = gh_graphql(
            """
            mutation($input: CreateProjectV2Input!) {
              createProjectV2(input: $input) { projectV2 { id number public } }
            }
            """,
            {"input": {
                "ownerId": repo["owner"]["id"],
                "title": PROJECT_TITLE,
                "repositoryId": repo["id"],
            }},
        )["createProjectV2"]["projectV2"]
        current = created
    else:
        print(f"Project \"{PROJECT_TITLE}\" already exists (#{current['number']})")
    if not write:
        return current
    gh_graphql(
        """
        mutation($input: UpdateProjectV2Input!) {
          updateProjectV2(input: $input) { projectV2 { id public } }
        }
        """,
        {"input": {
            "projectId": current["id"],
            "public": True,
            "shortDescription": "Share ideas in Discussions; this board tracks only accepted requests.",
            "readme": project_readme(seed),
        }},
    )
    field = gh_graphql(STATUS_FIELD_QUERY, {"id": current["id"]})["node"]
    status = field["field"]
    options = plan_status_options(status["options"])
    if options is None:
        print("All six Status columns are aligned.")
    else:
        extra = [opt["name"] for opt in status["options"] if opt["name"] not in {s["name"] for s in options}]
        if extra and field["items"]["totalCount"]:
            print("Status contains columns outside the board design and the Project has cards. Status will not be changed to avoid clearing card states.")
        else:
            if extra:
                print("Replace default Status columns: " + ", ".join(extra))
            gh_graphql(
                """
                mutation($input: UpdateProjectV2FieldInput!) {
                  updateProjectV2Field(input: $input) { projectV2Field { ... on ProjectV2SingleSelectField { id } } }
                }
                """,
                {"input": {"fieldId": status["id"], "singleSelectOptions": options}},
            )
            print("Status is now configured with six columns.")
    return current


def seed_issues(project: dict | None, seed: dict, *, write: bool) -> None:
    if project is None:
        print("No Project exists; skipping seed Issues. Run with --apply to create the board first.")
        return
    field = gh_graphql(STATUS_FIELD_QUERY, {"id": project["id"]})["node"]["field"]
    option_ids = {opt["name"]: opt["id"] for opt in field["options"]}
    for status_id, items in seed.get("columns", {}).items():
        if status_id == "shipped":
            continue
        spec = STATUS_BY_ID[status_id]
        for item in items:
            if item.get("track") != "new-issue":
                action = "add existing Issue" if item.get("issue") else "document only"
                print(f"{spec['name']} · {action} · {item['title']}")
                if write and item.get("issue"):
                    _place_existing(project["id"], field["id"], option_ids[spec["name"]], int(item["issue"]), spec["label"])
                continue
            print(f"{spec['name']} · Create Issue · {item['title']}")
            if not write:
                continue
            created = _gh_api("POST", f"repos/{REPO}/issues", {
                "title": item["title"],
                "body": _issue_body(item),
                "labels": ["feature", spec["label"]],
            })
            _add_to_project(project["id"], field["id"], option_ids[spec["name"]], created["node_id"])


def _issue_body(item: dict) -> str:
    lines = [item.get("body") or "See the initial board in `docs/COMMUNITY_BOARD.md`.", ""]
    if item.get("acceptance"):
        lines.extend(["## Acceptance", "", *[f"- [ ] {line}" for line in item["acceptance"]], ""])
    lines.append("Source: `docs/community/roadmap-seed.json`. Discussions remain the source for discussion; this board tracks accepted requests.")
    return "\n".join(lines)


def _place_existing(project_id: str, field_id: str, option_id: str, number: int, label: str) -> None:
    issue = _gh_api("GET", f"repos/{REPO}/issues/{number}")
    names = {item["name"] for item in issue.get("labels") or []}
    if label not in names:
        _gh_api("POST", f"repos/{REPO}/issues/{number}/labels", {"labels": [label]})
    _add_to_project(project_id, field_id, option_id, issue["node_id"])


def _add_to_project(project_id: str, field_id: str, option_id: str, content_id: str) -> None:
    added = gh_graphql(
        """
        mutation($input: AddProjectV2ItemByIdInput!) {
          addProjectV2ItemById(input: $input) { item { id } }
        }
        """,
        {"input": {"projectId": project_id, "contentId": content_id}},
    )
    gh_graphql(
        """
        mutation($input: UpdateProjectV2ItemFieldValueInput!) {
          updateProjectV2ItemFieldValue(input: $input) { projectV2Item { id } }
        }
        """,
        {"input": {
            "projectId": project_id,
            "itemId": added["addProjectV2ItemById"]["item"]["id"],
            "fieldId": field_id,
            "value": {"singleSelectOptionId": option_id},
        }},
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true", help="Write changes to GitHub. By default, only print the plan.")
    parser.add_argument("--seed-issues", action="store_true", help="Add cards from the seed file. Requires an existing Project.")
    args = parser.parse_args()
    seed = json.loads(SEED_PATH.read_text(encoding="utf-8"))
    repo = load_context()
    print(f"Repository {REPO} · owner {repo['owner']['login']} ({repo['owner']['__typename']})")
    apply_categories(repo)
    try:
        apply_labels(write=args.apply)
    except RuntimeError as exc:
        print(f"Labels were not changed: {exc}")
    project = None
    try:
        project = ensure_project(repo, seed, write=args.apply)
    except RuntimeError as exc:
        print(f"Project was not changed: {exc}")
        print("If the error is related to Project permissions, run `gh auth refresh -s project,read:project` locally, then rerun with --apply.")
    if args.seed_issues:
        seed_issues(project, seed, write=args.apply)
    print("")
    print("Category forms cannot be attached through the API. After creating the categories, choose a form for each in repository Settings → Discussions:")
    for spec in CATEGORIES:
        print(f"  {spec['name']:16} ← .github/DISCUSSION_TEMPLATE/{spec['slug']}.yml")
    if not args.apply:
        print("\nThis is a preview. After reviewing it, run: python3 scripts/setup_community_board.py --apply")
    return 0


if __name__ == "__main__":
    sys.exit(main())
