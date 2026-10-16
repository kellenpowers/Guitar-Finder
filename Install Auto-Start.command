#!/bin/bash
# Double-click me ONCE to make Flip Finder start by itself when this Mac
# starts, and restart itself if it ever crashes. After this, no window needs
# to stay open — the app runs quietly in the background.
cd "$(dirname "$0")"

REPO="$(pwd)"
LABEL="com.flipfinder.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
UID_NUM="$(id -u)"

# Where node lives on this Mac (launchd won't find it on its own)
NODE_DIR="$(dirname "$(command -v node 2>/dev/null)" 2>/dev/null)"
if [ -z "$NODE_DIR" ] || [ "$NODE_DIR" = "." ]; then
  echo "Couldn't find node on this Mac — run 'Update Flip Finder.command' first."
  exit 1
fi

chmod +x scripts/run-server.sh
mkdir -p "$HOME/Library/LaunchAgents" server/data

cat > "$PLIST" <<PLIST_END
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$REPO/scripts/run-server.sh</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$NODE_DIR:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>$REPO/server/data/flipfinder.log</string>
  <key>StandardErrorPath</key><string>$REPO/server/data/flipfinder.log</string>
</dict>
</plist>
PLIST_END

echo "Stopping any copy that's already running..."
launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null
source scripts/stop-app.sh

echo "Registering Flip Finder with macOS..."
if ! launchctl bootstrap "gui/$UID_NUM" "$PLIST" 2>/dev/null; then
  launchctl load -w "$PLIST" 2>/dev/null
fi

echo "Starting it up (give it a few seconds)..."
for i in $(seq 1 40); do
  sleep 1
  if curl -s --max-time 2 http://localhost:3001/api/health >/dev/null 2>&1; then
    echo ""
    echo "DONE. Flip Finder now runs by itself:"
    echo "  - starts when this Mac starts"
    echo "  - restarts itself if it ever crashes"
    echo "  - no window needs to stay open anymore"
    echo ""
    echo "Its log lives at: $REPO/server/data/flipfinder.log"
    echo "To stop it on purpose, double-click 'Stop Flip Finder.command'."
    exit 0
  fi
done

echo ""
echo "Hmm — the app didn't answer after 40 seconds."
echo "Check the log for what went wrong: $REPO/server/data/flipfinder.log"
echo "(It may also just need another minute if an update was installing.)"
exit 1
