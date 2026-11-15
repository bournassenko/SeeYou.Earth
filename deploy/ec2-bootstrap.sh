#!/usr/bin/env bash
set -euo pipefail

app_revision='APP_REVISION_PLACEHOLDER'
node_version=24.22.2
node_sha256=48cc0e21e048790e54c0cf5749c2725005313d652651c40b7a21feb9697aaf75

exec > >(tee -a /var/log/seeyou-bootstrap.log) 2>&1
export DEBIAN_FRONTEND=noninteractive ASTRO_TELEMETRY_DISABLED=1
apt-get update -o Acquire::Retries=3
apt-get install -y --no-install-recommends ca-certificates curl git nginx python3-venv xz-utils

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
archive="node-v$node_version-linux-x64.tar.xz"
curl --fail --silent --show-error --location --retry 3 \
  "https://nodejs.org/dist/v$node_version/$archive" -o "$work/$archive"
printf '%s  %s\n' "$node_sha256" "$work/$archive" | sha256sum --check
install -d /opt/seeyou-node
tar -xf "$work/$archive" --strip-components=1 -C /opt/seeyou-node
export PATH="/opt/seeyou-node/bin:$PATH"

git init "$work/app"
git -C "$work/app" remote add origin https://github.com/bournassenko/SeeYou.Earth.git
git -C "$work/app" fetch --depth 1 origin "$app_revision"
git -C "$work/app" checkout --detach FETCH_HEAD
test "$(git -C "$work/app" rev-parse HEAD)" = "$app_revision"

cd "$work/app"
npm ci --no-audit --no-fund
npm run build
install -d /srv/seeyou-earth
cp -a dist server /srv/seeyou-earth/
python3 -m venv /srv/seeyou-earth/.venv
/srv/seeyou-earth/.venv/bin/python -m pip install --disable-pip-version-check -r server/requirements.txt
printf '%s\n' "$app_revision" > /srv/seeyou-earth/dist/version.txt

cat > /etc/systemd/system/seeyou-earth-api.service <<'UNIT'
[Unit]
Description=SeeYou.Earth archive API
After=network-online.target
Wants=network-online.target

[Service]
User=www-data
WorkingDirectory=/srv/seeyou-earth
ExecStart=/opt/seeyou-node/bin/node /srv/seeyou-earth/server/index.mjs
Environment=SPHEREX_PYTHON=/srv/seeyou-earth/.venv/bin/python
Environment=OPENBLAS_NUM_THREADS=1
Restart=on-failure
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/nginx/sites-available/seeyou-earth <<'NGINX'
limit_req_zone $binary_remote_addr zone=seeyou_archive:10m rate=12r/m;

server {
    listen 80 default_server;
    server_name _;
    root /srv/seeyou-earth/dist;
    index index.html;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;

    location / {
        try_files $uri $uri/ =404;
    }

    location = /api/observations {
        limit_req zone=seeyou_archive burst=4 nodelay;
        limit_req_status 429;
        proxy_pass http://127.0.0.1:4323;
        proxy_read_timeout 95s;
    }

    location = /api/health {
        proxy_pass http://127.0.0.1:4323;
    }
}
NGINX

ln -sfn /etc/nginx/sites-available/seeyou-earth /etc/nginx/sites-enabled/default
nginx -t
systemctl daemon-reload
systemctl enable --now seeyou-earth-api.service nginx
systemctl reload nginx
curl --fail --silent --show-error --retry 10 --retry-connrefused http://127.0.0.1/api/health
printf '\nSeeYou.Earth deployed at revision %s\n' "$app_revision"
