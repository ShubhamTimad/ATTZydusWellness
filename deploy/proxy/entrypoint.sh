#!/bin/sh
# Select HTTP vs HTTPS nginx config based on whether certs exist.
set -eu

DOMAIN="${DOMAIN:-assets.timadit.com}"
TEMPLATE_DIR="/etc/nginx/templates"
OUT="/etc/nginx/conf.d/default.conf"
CERT="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"

render() {
  # Only substitute DOMAIN — leave nginx $vars alone.
  sed "s/\${DOMAIN}/${DOMAIN}/g" "$1" > "$OUT"
}

if [ -f "$CERT" ]; then
  echo "proxy: TLS cert found for ${DOMAIN} — enabling HTTPS"
  render "${TEMPLATE_DIR}/https.conf.template"
else
  echo "proxy: no cert yet for ${DOMAIN} — HTTP only (run scripts/ssl-init.sh)"
  render "${TEMPLATE_DIR}/http.conf.template"
fi

# Reload periodically so renewed certs are picked up without recreating the container.
(
  while true; do
    sleep 21600
    if [ -f "$CERT" ]; then
      render "${TEMPLATE_DIR}/https.conf.template"
    else
      render "${TEMPLATE_DIR}/http.conf.template"
    fi
    nginx -s reload || true
  done
) &

exec nginx -g "daemon off;"
