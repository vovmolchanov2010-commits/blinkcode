#!/usr/bin/env bash
# Первый запуск и обновление сервера на ВМ.
#   sudo /opt/blinkcode/deploy/yandex/setup.sh
# Подтягивает свежий код ветки, при первом запуске создаёт .env с секретами,
# пересобирает и перезапускает контейнеры. Данные (БД, сертификаты) сохраняются.
set -euo pipefail

BRANCH="${BLINK_BRANCH:-main}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$DIR"

if [ -d .git ]; then
  git fetch --quiet origin "$BRANCH"
  git checkout --quiet -B "$BRANCH" "origin/$BRANCH"
fi

cd deploy/yandex

if [ ! -f .env ]; then
  domain="${BLINK_DOMAIN:-}"
  if [ -z "$domain" ]; then
    # Публичный IP из сервиса метаданных Yandex Cloud (GCE-совместимый API).
    ip="$(curl -fsS -H 'Metadata-Flavor: Google' \
      http://169.254.169.254/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip \
      || curl -fsS https://ipv4.icanhazip.com)"
    domain="$(echo "$ip" | tr -d '[:space:]').sslip.io"
  fi
  umask 077
  cat > .env <<ENV
DOMAIN=$domain
POSTGRES_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 32)
OTP_SECRET=$(openssl rand -hex 32)
SMS_PROVIDER=${BLINK_SMS_PROVIDER:-log}
SMSRU_API_ID=${BLINK_SMSRU_API_ID:-}
ENV
  echo "Created $(pwd)/.env"
fi

docker compose up -d --build --remove-orphans
docker image prune -f >/dev/null

domain="$(grep '^DOMAIN=' .env | cut -d= -f2)"
echo "Waiting for https://$domain/health ..."
for _ in $(seq 1 60); do
  if curl -fsS "https://$domain/health" >/dev/null 2>&1; then
    echo "OK: API is available at https://$domain"
    exit 0
  fi
  sleep 5
done
echo "API is not reachable over HTTPS yet. Check: docker compose ps; docker compose logs caddy api" >&2
exit 1
