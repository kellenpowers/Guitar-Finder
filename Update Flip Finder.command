#!/bin/bash
# Double-click me to download the latest version and start Flip Finder
cd "$(dirname "$0")"

LABEL="com.flipfinder.server"
UID_NUM="$(id -u)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

# Pause the background copy (if auto-start is installed) so the update isn't
# fighting a running server
launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null
source scripts/stop-app.sh

echo ""
echo "=== Downloading the latest version ==="
git pull

echo ""
echo "=== Installing (takes a minute) ==="
npm run setup

if [ -f "$PLIST" ]; then
  echo ""
  echo "=== Starting Flip Finder in the background ==="
  chmod +x scripts/run-server.sh
  if ! launchctl bootstrap "gui/$UID_NUM" "$PLIST" 2>/dev/null; then
    launchctl load -w "$PLIST" 2>/dev/null
  fi
  for i in $(seq 1 40); do
    sleep 1
    if curl -s --max-time 2 http://localhost:3001/api/health >/dev/null 2>&1; then
      echo ""
      echo "Updated and running in the background — you can close this window."
      echo "Open http://localhost:3001 on this Mac, or the Flips icon on your phone."
      exit 0
    fi
  done
  echo "It didn't answer after 40s — check server/data/flipfinder.log"
  exit 1
fi

echo ""
echo "=== Starting Flip Finder — keep this window open while you use the app ==="
echo "(Tip: double-click 'Install Auto-Start.command' once and you'll never need to.)"
echo "Open http://localhost:3001 on this Mac, or the Flips icon on your phone."
echo ""
npm start
