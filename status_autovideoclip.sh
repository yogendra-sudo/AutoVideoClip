#!/usr/bin/env bash
# AutoVideoClip status helper (compat wrapper).
# Forwards to the canonical status helper so both names stay valid.
exec "$(dirname "$0")/status_autoclip.sh" "$@"
