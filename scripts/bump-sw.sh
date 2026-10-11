#!/bin/bash
# Release bump: new service-worker cache version (installed apps drop the old cache)
# and new app version + date shown at the bottom of the front page (v1.N, N +1 per release).
cd "$(dirname "$0")/.." || exit 1
V=$(date +%Y%m%d%H%M%S)
sed -i "s/^const VERSION = .*/const VERSION = \"$V\";/" sw.js
N=$(grep -oP 'var APP_VER = "1\.\K\d+' index.html)
D=$(LC_ALL=C date +"%-d %b %Y")
sed -i "s/var APP_VER = \"[^\"]*\", APP_DATE = \"[^\"]*\";/var APP_VER = \"1.$((N + 1))\", APP_DATE = \"$D\";/" index.html
echo "sw.js VERSION = $V, app v1.$((N + 1)) · $D"
