"""MCPB entry. UV installs autovideoclip-mcp from this directory's pyproject.toml."""
from __future__ import annotations

import os
import sys


def _drop_unset_api_key() -> None:
    """A blank or uninterpolated user_config must not override desktop settings."""
    key = os.environ.get("AUTOVIDEOCLIP_API_KEY")
    if key is None:
        return
    if not key.strip() or "${" in key:
        os.environ.pop("AUTOVIDEOCLIP_API_KEY", None)


def main() -> int:
    _drop_unset_api_key()
    try:
        from backend.mcp_server import main as mcp_main
    except ImportError as exc:
        print(
            "PyPI package autovideoclip-mcp was not found. Start it with uv run --directory <mcpb directory> src/server.py.",
            file=sys.stderr,
        )
        raise SystemExit(1) from exc
    return mcp_main()


if __name__ == "__main__":
    sys.exit(main())
