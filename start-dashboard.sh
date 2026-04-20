#!/bin/bash
# Compatibility shim — launchd plist still points here. Update the plist to scripts/start-dashboard.sh and remove this file.
exec bash "$(dirname "$0")/scripts/start-dashboard.sh" "$@"
