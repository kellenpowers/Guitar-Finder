#!/bin/bash
# Double-click me to stop Flip Finder on purpose.
# With auto-start installed, just killing the app would make macOS restart it
# in seconds — this properly pauses the auto-restart first. It stays off until
# you run "Start Flip Finder.command" or the next time you log in to this Mac.
cd "$(dirname "$0")"

LABEL="com.flipfinder.server"
UID_NUM="$(id -u)"

if launchctl print "gui/$UID_NUM/$LABEL" >/dev/null 2>&1; then
  echo "Pausing auto-restart..."
  launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null
fi
source scripts/stop-app.sh
echo ""
echo "Flip Finder is stopped. It comes back when you run 'Start Flip Finder.command'"
echo "or the next time you log in to this Mac."
