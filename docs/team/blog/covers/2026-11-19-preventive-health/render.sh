#!/bin/sh
# Renders cover.html to the 1600 x 1067 PNG master with Chrome, no other tools needed.
#   sh docs/team/blog/covers/2026-11-19-preventive-health/render.sh [out.png]
# If a figure changes, edit DATA at the top of cover.html's script first. After rendering,
# open cover.html in Chrome: <body data-unsafe="..."> means a label left the safe zone
# or sits on another line; fix the layout numbers in DATA before using the PNG.
set -e
DIR=$(cd "$(dirname "$0")" && pwd)
OUT=${1:-"$HOME/Downloads/D-Human-blog-cover-preventive-health.png"}
CHROME=${CHROME:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
"$CHROME" --headless=new --hide-scrollbars --force-device-scale-factor=1 \
  --window-size=1600,1067 --virtual-time-budget=5000 \
  --screenshot="$OUT" "file://$DIR/cover.html" 2>/dev/null
echo "Wrote $OUT"
