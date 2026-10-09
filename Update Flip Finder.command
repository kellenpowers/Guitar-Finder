#!/bin/bash
# Double-click me to download the latest version and start Flip Finder
cd "$(dirname "$0")"

echo "Stopping any old copy..."
kill $(lsof -ti :3001) 2>/dev/null
sleep 1

echo ""
echo "=== Downloading the latest version ==="
git pull

echo ""
echo "=== Installing (takes a minute) ==="
npm run setup

echo ""
echo "=== Starting Flip Finder — keep this window open while you use the app ==="
echo "Open http://localhost:3001 on this Mac, or the Flips icon on your phone."
echo ""
npm start
