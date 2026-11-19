# Developer Guide

Project repository: [yogendra-sudo/AutoVideoClip](https://github.com/yogendra-sudo/AutoVideoClip). See [Repository Layout](REPOSITORY_LAYOUT.md) for directory structure, maintenance entry points, and handling of legacy files.

## Environment and Validation

For source-based web mode, prepare Python 3.11, Node.js 20, and Redis according to [STARTUP_GUIDE.md](../STARTUP_GUIDE.md). Desktop mode uses Tauri and a separate backend entry point. Use [BUILD_GUIDE.md](../BUILD_GUIDE.md) and [scripts/README.md](../scripts/README.md) for packaging; do not reuse the web-mode Redis/Celery startup commands.

```bash
git clone https://github.com/yogendra-sudo/AutoVideoClip.git
cd autoclip
python3 -m venv venv
source venv/bin/activate
python -m pip install -r requirements.txt
(cd frontend && npm ci)
python -m pytest backend/tests -q
(cd frontend && npm run lint && npm run typecheck && npm test && npm run build)
```

The complete CI flow also validates production and development Docker orchestration. Desktop releases must follow [RELEASE_CHECKLIST.md](../RELEASE_CHECKLIST.md); source merges and installer releases are separate steps.

## Main Entry Points

- Web API: `backend/main.py`, started as a module with `python -m uvicorn backend.main:app`.
- Desktop API: `backend/desktop_main.py`; lifecycle is managed by the Tauri client.
- CLI/MCP: see [CLI_AND_MCP.md](CLI_AND_MCP.md).
- UI: `frontend/src/`; read [DESIGN.md](../DESIGN.md) before visual changes.
- Models and local subtitle transcription: see [AI_MODEL_CONFIGURATION.md](AI_MODEL_CONFIGURATION.md).
- Data models and initialization: `backend/models/` and `backend/core/database.py`.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for contribution procedures, [ROADMAP.md](../ROADMAP.md) for planning, and [HANDOFF.md](../HANDOFF.md) for the boundary between current facts and historical snapshots.
