#!/bin/bash
# launchd entry point — macOS runs this at login and relaunches it if the
# server ever dies (see "Install Auto-Start.command"). Not meant to be
# double-clicked; use "Start Flip Finder.command" for that.

# launchd starts with a bare PATH — make sure node/npm are findable wherever
# they were installed (the installer also bakes the detected path into the plist)
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:$PATH"

cd "$(dirname "$0")/.." || exit 1

# Keep the log from growing forever
LOG="server/data/flipfinder.log"
if [ -f "$LOG" ] && [ "$(wc -c < "$LOG" 2>/dev/null || echo 0)" -gt 10000000 ]; then
  mv "$LOG" "$LOG.old" 2>/dev/null
fi

# If an orphaned copy still holds port 3001, clear it so we don't crash-loop
PIDS=$(lsof -ti :3001 2>/dev/null)
if [ -n "$PIDS" ]; then
  kill $PIDS 2>/dev/null
  sleep 2
  PIDS=$(lsof -ti :3001 2>/dev/null)
  [ -n "$PIDS" ] && kill -9 $PIDS 2>/dev/null && sleep 1
fi

exec npm start
