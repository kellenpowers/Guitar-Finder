#!/bin/bash
# Double-click me to start Flip Finder
cd "$(dirname "$0")"

source scripts/stop-app.sh

echo "Starting Flip Finder — keep this window open while you use the app."
echo "Open http://localhost:3001 on this Mac, or the Flips icon on your phone."
echo ""
npm start
