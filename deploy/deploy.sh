#!/usr/bin/env bash
# Build and publish Catigraphy on the xera.ac box. Run from a checkout on the
# server, as the xeradb user:
#
#   cd /var/www/catigraphy && git pull && ./deploy/deploy.sh
#
# The nginx vhost and the TLS certificate are installed once by hand; see the
# header of deploy/catigraphy.xera.ac.nginx for those root-only commands.
set -euo pipefail
cd "$(dirname "$0")/.."

npm ci --no-audit --no-fund
npm test
npm run build

# Pre-compress the surfaces for nginx gzip_static. They are half the payload,
# they halve again under gzip, and they never change between requests, so
# compressing them once at deploy time is much cheaper than per request. The
# slice sheets are JPEG and gain four percent, so they are left alone.
find dist/models -type f \( -name '*.bin' -o -name '*.json' \) -print0 |
    xargs -0 -P 4 -I {} gzip -9 -k -f {}

cp deploy/catigraphy.xera.ac.nginx ~/catigraphy.xera.ac.nginx

echo "Built $(du -sh dist | cut -f1) into dist/. nginx serves it directly; no reload needed for content changes."
