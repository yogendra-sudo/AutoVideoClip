#!/usr/bin/env bash
# AutoVideoClip stop helper (compat wrapper).
# Forwards to the canonical stop helper so both names stay valid.
exec "$(dirname "$0")/stop_autovideoclip.sh" "$@"
