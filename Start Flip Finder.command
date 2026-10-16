#!/bin/bash
# Double-click me to start Flip Finder
cd "$(dirname "$0")"

LABEL="com.flipfinder.server"
UID_NUM="$(id -u)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

# With auto-start installed, the app runs in the background — hand it to
# macOS and this window can be closed.
if [ -f "$PLIST" ]; then
  echo "Starting Flip Finder in the background..."
  launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null
  source scripts/stop-app.sh
  if ! launchctl bootstrap "gui/$UID_NUM" "$PLIST" 2>/dev/null; then
    launchctl load -w "$PLIST" 2>/dev/null
  fi
  for i in $(seq 1 30); do
    sleep 1
    if curl -s --max-time 2 http://localhost:3001/api/health >/dev/null 2>&1; then
      echo ""
      echo "Flip Finder is running in the background — you can close this window."
      echo "Open http://localhost:3001 on this Mac, or the Flips icon on your phone."
      exit 0
    fi
  done
  echo "It didn't answer after 30s — check server/data/flipfinder.log"
  exit 1
fi

# No auto-start installed: run it right here in this window (the old way)
source scripts/stop-app.sh

echo "Starting Flip Finder — keep this window open while you use the app."
echo "(Tip: double-click 'Install Auto-Start.command' once and you'll never need to.)"
echo "Open http://localhost:3001 on this Mac, or the Flips icon on your phone."
echo ""
npm start
