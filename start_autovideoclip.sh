#!/usr/bin/env bash
# AutoVideoClip launcher (compat wrapper).
# Forwards to the canonical start launcher so both names stay valid.
exec "$(dirname "$0")/start_autovideoclip.sh" "$@"
