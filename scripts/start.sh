#!/bin/bash
# Start the job search dashboard
set -e

cd "$(dirname "$0")/.."
set -a; source .env; set +a

exec node dashboard.js
