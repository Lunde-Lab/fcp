#!/bin/bash
# Bump the service-worker cache version so installed apps drop the old cache.
cd "$(dirname "$0")/.." && V=$(date +%Y%m%d%H%M%S) && sed -i "s/^const VERSION = .*/const VERSION = \"$V\";/" sw.js && echo "sw.js VERSION = $V"
