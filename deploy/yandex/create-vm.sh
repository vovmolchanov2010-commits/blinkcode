#!/usr/bin/env bash
# Создаёт ВМ в Yandex Cloud через yc CLI: статический IP, группа безопасности
# (22, 80, 443) и ВМ с cloud-init.yaml. Нужен настроенный yc (yc init).
#   ./create-vm.sh [путь к публичному SSH-ключу]
set -euo pipefail

NAME="${BLINK_VM_NAME:-blinkcode}"
ZONE="${BLINK_ZONE:-ru-central1-a}"
SUBNET="${BLINK_SUBNET:-default-$ZONE}"
NETWORK="${BLINK_NETWORK:-default}"
KEY_FILE="${1:-$HOME/.ssh/id_ed25519.pub}"

cd "$(dirname "${BASH_SOURCE[0]}")"
[ -f "$KEY_FILE" ] || { echo "Нет публичного ключа $KEY_FILE (создай: ssh-keygen -t ed25519)" >&2; exit 1; }

json_field() { grep -m1 "\"$1\"" | sed -E 's/.*"'"$1"'": *"([^"]+)".*/\1/'; }

echo "→ Статический IP"
address="$(yc vpc address create --name "$NAME-ip" --external-ipv4 "zone=$ZONE" --format json | json_field address)"

echo "→ Группа безопасности (SSH, HTTP, HTTPS)"
sg_id="$(yc vpc security-group create --name "$NAME-sg" --network-name "$NETWORK" \
  --rule "direction=ingress,port=22,protocol=tcp,v4-cidrs=[0.0.0.0/0]" \
  --rule "direction=ingress,port=80,protocol=tcp,v4-cidrs=[0.0.0.0/0]" \
  --rule "direction=ingress,port=443,protocol=tcp,v4-cidrs=[0.0.0.0/0]" \
  --rule "direction=ingress,port=443,protocol=udp,v4-cidrs=[0.0.0.0/0]" \
  --rule "direction=egress,protocol=any,from-port=0,to-port=65535,v4-cidrs=[0.0.0.0/0]" \
  --format json | json_field id)"

user_data="$(mktemp)"
trap 'rm -f "$user_data"' EXIT
sed "s|SSH_PUBLIC_KEY|$(cat "$KEY_FILE")|" cloud-init.yaml > "$user_data"

echo "→ ВМ $NAME"
yc compute instance create \
  --name "$NAME" \
  --zone "$ZONE" \
  --platform standard-v3 \
  --cores 2 --core-fraction 20 --memory 2GB \
  --create-boot-disk image-folder-id=standard-images,image-family=ubuntu-2404-lts,size=20GB,type=network-ssd \
  --network-interface "subnet-name=$SUBNET,nat-ip-version=ipv4,nat-address=$address,security-group-ids=$sg_id" \
  --metadata-from-file "user-data=$user_data" >/dev/null

cat <<MSG

Готово. ВМ ставит Docker и собирает сервер — это займёт 5–10 минут.
  Адрес API:      https://$address.sslip.io
  Проверка:       curl https://$address.sslip.io/health
  SSH:            ssh blink@$address
  Лог установки:  ssh blink@$address sudo tail -f /var/log/blinkcode-setup.log
MSG
