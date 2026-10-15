#!/bin/sh
set -eu
TMP=$(mktemp);trap 'rm -f "$TMP"' EXIT
curl -fLsS https://raw.githubusercontent.com/n-ycta/delta/main/install.sh -o "$TMP"
sh "$TMP" --plugins storage,web,typing "$@"
