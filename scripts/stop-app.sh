#!/bin/bash
# Stop any running Flip Finder and wait until port 3001 is actually free.
# Sourced by both .command launchers — fixes the race where the new copy
# started before the old one had released the port (EADDRINUSE).

PIDS=$(lsof -ti :3001)
if [ -n "$PIDS" ]; then
  echo "Stopping the old copy..."
  kill $PIDS 2>/dev/null
  for i in $(seq 1 10); do
    sleep 1
    lsof -ti :3001 >/dev/null 2>&1 || break
  done
  # Still holding on after 10s — force it
  PIDS=$(lsof -ti :3001)
  if [ -n "$PIDS" ]; then
    echo "Old copy is stuck — force-stopping it."
    kill -9 $PIDS 2>/dev/null
    sleep 1
  fi
fi
