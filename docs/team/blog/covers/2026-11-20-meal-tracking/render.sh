#!/bin/sh
# Renders cover.html to the 1600 x 1067 PNG master with Chrome, no other tools needed.
#   sh docs/team/blog/covers/2026-11-20-meal-tracking/render.sh [out.png]
# If a figure changes, edit DATA at the top of cover.html's script first. The script reads
# the page's own layout check before rendering: if a label left the safe zone or sits on
# another part, it prints the problem and stops, so fix the layout numbers in DATA first.
set -e
DIR=$(cd "$(dirname "$0")" && pwd)
OUT=${1:-"$HOME/Downloads/D-Human-blog-cover-meal-tracking.png"}
CHROME=${CHROME:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
FLAGS="--headless=new --hide-scrollbars --force-device-scale-factor=1 --window-size=1600,1067 --virtual-time-budget=5000"

DOM=$("$CHROME" $FLAGS --dump-dom "file://$DIR/cover.html" 2>/dev/null)
case "$DOM" in
  *'data-ready="1"'*) ;;
  *) echo "The page didn't finish loading (fonts?). Nothing rendered." >&2; exit 1 ;;
esac
case "$DOM" in
  *data-unsafe=*)
    echo "$DOM" | sed -n 's/.*data-unsafe="\([^"]*\)".*/Layout problem: \1/p' >&2
    exit 1 ;;
esac

"$CHROME" $FLAGS --screenshot="$OUT" "file://$DIR/cover.html" 2>/dev/null
echo "Layout check passed. Wrote $OUT"
