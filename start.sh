#!/bin/sh
# Run Service Platform on this computer.
cd "$(dirname "$0")" && exec node scripts/start-local.mjs
