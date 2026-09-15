#!/usr/bin/env bash
#
# Replaces the Marzban stack with a clean 3x-ui on the same box.
#
# Everything the panel needs from the outside world is decided here rather than in its web UI: the
# container publishes exactly two ports, so a port changed in the settings screen becomes
# unreachable until this file changes with it. That is the one trap of running it behind a bridge
# network, and the summary at the end says so out loud.
#
# Safe to re-run. It tears Marzban down only after asking, and bringing 3x-ui up again over itself
# keeps the panel database on the ./db volume.
#
# Usage:  bash 3x-ui-setup.sh           interactive
#         bash 3x-ui-setup.sh --yes     no prompt, tears Marzban down without asking

set -euo pipefail

PANEL_PORT="${PANEL_PORT:-2053}"
REALITY_PORT="${REALITY_PORT:-8443}"
DIR="${DIR:-/opt/3x-ui}"
MARZBAN_DIR="${MARZBAN_DIR:-/opt/vpn-service}"

ASSUME_YES=false
[ "${1:-}" = "--yes" ] && ASSUME_YES=true

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\nОШИБКА: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "запускать от root"
command -v docker >/dev/null || die "docker не установлен — сначала: curl -fsSL https://get.docker.com | sh"
docker compose version >/dev/null 2>&1 || die "нет плагина docker compose"

# ─────────────────────────────────────────────────────────────── 1. Marzban down

if [ -f "$MARZBAN_DIR/docker-compose.yml" ]; then
	say "1. Marzban"
	echo "Найден стек в $MARZBAN_DIR."
	echo "Он будет остановлен, а его данные удалены — вместе с ключами REALITY и всеми выданными"
	echo "ссылками. Восстановить их после этого нельзя."

	if [ "$ASSUME_YES" = false ]; then
		read -r -p "Сносим Marzban? (введите YES заглавными): " answer
		[ "$answer" = "YES" ] || die "отменено — ничего не тронуто"
	fi

	# -v is the whole point: leaving the volumes behind would keep a stale panel database and its
	# xray config on disk, and the next person to read `docker volume ls` would have to guess which
	# of two panels owns them.
	docker compose -f "$MARZBAN_DIR/docker-compose.yml" down -v --remove-orphans || true
	echo "Marzban остановлен, тома удалены. Порт $REALITY_PORT свободен."
else
	say "1. Marzban не найден в $MARZBAN_DIR — пропускаю"
fi

# ─────────────────────────────────────────────────────────────── 2. compose file

say "2. 3x-ui"
mkdir -p "$DIR"

# Written every run so the file always matches the ports this script was told about. The panel's
# database lives in ./db and is untouched by this.
cat > "$DIR/docker-compose.yml" <<EOF
services:
  3xui:
    image: ghcr.io/mhsanaei/3x-ui:latest
    container_name: 3xui_app
    cap_add:
      - NET_ADMIN
      - NET_RAW
    volumes:
      - ./db/:/etc/x-ui/
      - ./cert/:/root/cert/
    environment:
      XRAY_VMESS_AEAD_FORCED: "false"
      XUI_ENABLE_FAIL2BAN: "true"
    tty: true
    ports:
      # Панель только на петле: снаружи в неё не ходят, только через SSH-туннель.
      - "127.0.0.1:${PANEL_PORT}:${PANEL_PORT}"
      # Порт инбаунда REALITY. Меняете здесь и в панели одновременно, иначе снаружи будет
      # открытый порт, за которым никто не слушает.
      - "${REALITY_PORT}:${REALITY_PORT}"
    restart: unless-stopped
EOF

cd "$DIR"
docker compose pull --quiet
docker compose up -d

# ─────────────────────────────────────────────────────────────── 3. firewall

say "3. Фаервол"
if command -v ufw >/dev/null && ufw status | grep -q "^Status: active"; then
	ufw allow "${REALITY_PORT}/tcp" >/dev/null
	echo "Открыт ${REALITY_PORT}/tcp."
	# The panel port is deliberately NOT opened: it is bound to the loopback above, and an ufw rule
	# for it would be a rule that grants nothing while reading as if the panel were public.
	echo "Порт панели ${PANEL_PORT} не открывается — он на петле, доступ только через туннель."
else
	echo "ufw неактивен, правила не трогаю."
fi

# ─────────────────────────────────────────────────────────────── 4. wait & report

say "4. Проверка"
for _ in $(seq 1 30); do
	if curl -fsS -o /dev/null --max-time 2 "http://127.0.0.1:${PANEL_PORT}/"; then
		echo "Панель отвечает на 127.0.0.1:${PANEL_PORT}."
		break
	fi
	sleep 1
done || true

IP="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || echo '<IP-сервера>')"

cat <<EOF

────────────────────────────────────────────────────────────
Готово.

Туннель с вашей машины:

  ssh -L ${PANEL_PORT}:127.0.0.1:${PANEL_PORT} root@${IP}

Панель:   http://localhost:${PANEL_PORT}
Логин:    admin / admin  — сменить первым же действием

Инбаунд заводится один раз, четыре поля:

  Основное     Порт: ${REALITY_PORT}   (не оставляйте случайный!)
  Безопасность Reality, цель gateway.icloud.com:443,
               SNI только gateway.icloud.com, ключи и Short ID — кнопкой
  Протокол     не трогать, «Сгенерировать» там не нажимать
  Поток        RAW, не трогать

Клиенту после создания инбаунда поставить Flow: xtls-rprx-vision

Если смените порт панели или инбаунда в веб-интерфейсе — перезапустите этот
скрипт с новым значением, иначе порт перестанет быть проброшенным:

  PANEL_PORT=2096 REALITY_PORT=${REALITY_PORT} bash $0 --yes
────────────────────────────────────────────────────────────
EOF
