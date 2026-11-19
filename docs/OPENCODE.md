# Connect AutoVideoClip to opencode CLI (MCP)

[opencode](https://opencode.ai) is a terminal AI agent. Register AutoVideoClip as a local MCP server and you can
point opencode at a video path — it will call AutoVideoClip to clip highlights, export vertical videos, and publish.

| Goal | How |
|---|---|
| One-command setup (recommended) | `autovideoclip mcp install opencode` |
| Project-only setup | `autovideoclip mcp install opencode --scope project --dir <dir>` |
| Print the snippet only | `autovideoclip mcp install opencode --print` |
| Rewrite a commented (JSONC) config | add `--force` (backup written first) |

## 1. Prerequisites

- AutoVideoClip CLI installed (`pip install -r requirements.txt && pip install -e .`) — see the CLI / MCP guide;
  running from the repo (`python -m backend.mcp_server`) also works
- `ffmpeg` on PATH and a working model: `autovideoclip doctor`
- opencode installed (`opencode --version`)

## 2. One-command setup

```bash
autovideoclip mcp install opencode
# ✓ wrote ~/.config/opencode/opencode.json (Windows: %USERPROFILE%\.config\opencode\opencode.json)
```

The command detects the launch command (`autovideoclip` → `autovideoclip-mcp` → `python -m backend.mcp_server`),
merges `mcp.autovideoclip` into your config without touching other keys, and backs the old file up as
`opencode.json.bak`. Re-running keeps your custom fields on an existing `autovideoclip` entry while updating
`type` / `command`. The module fallback refreshes `cwd` and prepends the current installation to `PYTHONPATH`,
preserving other module paths, environment variables, `timeout`, and `enabled`.
If `opencode.jsonc` exists it becomes the target; when both `opencode.json` and `opencode.jsonc` exist
and the jsonc already defines `mcp`, the installer refuses with an explicit message instead of writing
a config that would not take effect. Commented (JSONC) configs are left untouched unless you pass `--force`.

| Option | Effect |
|---|---|
| `--scope global` (default) | `~/.config/opencode/opencode.json` |
| `--scope project --dir <dir>` | `<dir>/opencode.json` (project-only) |
| `--print` / `--json` | print the snippet / machine-readable report |

`OPENCODE_CONFIG` selects the exact global file to write, without switching to a sibling `.jsonc`;
`XDG_CONFIG_HOME` is honored.

## 3. Manual config

`opencode.json` (or `opencode.jsonc`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "autovideoclip": {
      "type": "local",
      "command": ["C:\\Users\\<you>\\autovideoclip\\venv\\Scripts\\autovideoclip.exe", "mcp"],
      "enabled": true
    }
  }
}
```

- macOS / Linux: `"command": ["/path/to/autovideoclip/venv/bin/autovideoclip", "mcp"]`
- Running from the repo without installing:
  `"command": ["<python>", "-m", "backend.mcp_server"], "cwd": "<repo>", "environment": {"PYTHONPATH": "<repo>"}`

opencode merges global and project configs; a project entry with the same name overrides the global one.

## 4. Use it

Restart opencode (or start a new session) so it loads the MCP server, then just ask:

```text
Clip D:\Videos\lecture.mp4
Clip C:\Users\me\Downloads\podcast.mp4 using ollama
Export clip 2 of that project as Shorts
```

opencode calls `check_environment` and `clip_video` (or `start_clip_job` + `get_job_status` for long videos)
and reports clips by score, time range, and title. Output shares the same data directory as the desktop app.

## 5. Agent skill (optional)

Copy `skills/autovideoclip/` to `~/.config/opencode/skills/autovideoclip/` (or `.opencode/skills/` inside a project).
opencode also reads `~/.claude/skills/`, so Claude Code installs are picked up automatically.

## 6. Troubleshooting

| Symptom | Fix |
|---|---|
| No `autovideoclip` tools in opencode | Run with `--print`, verify the target path, keep only one `opencode.json` / `.jsonc`, start a new session |
| Tools listed but calls fail | Run `autovideoclip doctor` (ffmpeg / Whisper / model key) |
| Zero clips | Retry with `min_score=0.5`; pure music / no dialogue has no highlights |
| First run is slow | Local Whisper transcription downloads a model; pass an SRT to skip it |

Links: [CLI / MCP guide (Chinese)](CLI_AND_MCP.md) · [opencode MCP docs](https://opencode.ai/docs/mcp-servers/) · [opencode skills docs](https://opencode.ai/docs/skills/)
