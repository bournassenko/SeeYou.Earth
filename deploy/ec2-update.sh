#!/usr/bin/env bash
set -euo pipefail

revision=${1:?A published Git revision is required}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]]
export PATH="/opt/seeyou-node/bin:$PATH" ASTRO_TELEMETRY_DISABLED=1 DEBIAN_FRONTEND=noninteractive

root=/srv/seeyou-earth
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
git init -q "$work/app"
git -C "$work/app" remote add origin https://github.com/bournassenko/SeeYou.Earth.git
git -C "$work/app" fetch --depth 1 origin "$revision"
git -C "$work/app" checkout --detach FETCH_HEAD
test "$(git -C "$work/app" rev-parse HEAD)" = "$revision"
cd "$work/app"
npm ci --no-audit --no-fund
npm run build
test -s dist/index.html
test -s dist/demo/index.html

install -d "$root/releases/$revision"
cp -a dist server "$root/releases/$revision/"
printf '%s\n' "$revision" > "$root/releases/$revision/dist/version.txt"

ln -sfn "$root/releases/$revision" "$root/current-next"
mv -Tf "$root/current-next" "$root/current"
sed -i "s|$root/server|$root/current/server|g" /etc/systemd/system/seeyou-earth-api.service
sed -i "s|$root/dist|$root/current/dist|g; s|server_name _;|server_name seeyou.earth;|" /etc/nginx/sites-available/seeyou-earth
nginx -t
systemctl daemon-reload
systemctl restart seeyou-earth-api.service
systemctl reload nginx
curl --fail --silent --show-error --retry 5 --retry-connrefused http://127.0.0.1:4323/api/health

if ! test -s /etc/letsencrypt/live/seeyou.earth/fullchain.pem; then
    apt-get update -o Acquire::Retries=3
    apt-get install -y --no-install-recommends certbot python3-certbot-nginx
    certbot --nginx --non-interactive --agree-tos --register-unsafely-without-email --redirect -d seeyou.earth
    systemctl enable --now certbot.timer
fi

printf '\nSeeYou.Earth deployed at revision %s\n' "$revision"
