# Деплой в Yandex Cloud

Один сервер (виртуальная машина Compute Cloud), на нём в Docker:

- **API** — `apps/api`, собирается из исходников;
- **PostgreSQL 16** и **Redis 7** — наружу не открыты, данные в томах Docker;
- **Caddy** — HTTPS с бесплатным сертификатом Let's Encrypt.

Домен покупать не нужно: адрес вида `https://51.250.1.2.sslip.io` (публичный IP + `.sslip.io`) работает сразу.

> ВМ скачивает код из ветки `main`. Сначала смержи PR с этими файлами, иначе на сервере их не будет.

## Что понадобится

- аккаунт Yandex Cloud с платёжным аккаунтом и каталогом;
- SSH-ключ: `ssh-keygen -t ed25519` (если ещё нет), публичная часть — `~/.ssh/id_ed25519.pub`.

## Вариант 1. Одной командой через yc CLI

Нужен [yc CLI](https://yandex.cloud/ru/docs/cli/quickstart), настроенный через `yc init`.

```bash
cd deploy/yandex
./create-vm.sh                 # или ./create-vm.sh путь/к/ключу.pub
```

Скрипт создаёт статический IP, группу безопасности (порты 22, 80, 443) и ВМ (Ubuntu 24.04, 2 vCPU с долей 20%, 2 ГБ RAM, диск 20 ГБ).
В конце он печатает адрес API. Сборка на ВМ занимает 5–10 минут.

## Вариант 2. Через консоль

1. **Compute Cloud → Создать ВМ.**
   - Образ: **Ubuntu 24.04 LTS**; зона `ru-central1-a`.
   - Диск: 20 ГБ SSD. Ресурсы: 2 vCPU, гарантированная доля 20%, 2 ГБ RAM.
   - Сеть: публичный адрес — «Автоматически».
     После создания сделай его статическим: **Virtual Private Cloud → IP-адреса → Сделать статическим**. Иначе после остановки ВМ адрес и домен сменятся.
   - Группа безопасности: входящие TCP 22, 80, 443 и UDP 443 из `0.0.0.0/0`, исходящие — любые.
   - Пользовательские данные (user-data, в разделе метаданных): содержимое [`cloud-init.yaml`](cloud-init.yaml), где `SSH_PUBLIC_KEY` заменён на твой публичный ключ.
     Пользователь на ВМ — `blink`. Если консоль не даёт задать user-data вместе с полями доступа, используй вариант 1.
2. Подожди 5–10 минут и проверь: `curl https://<IP>.sslip.io/health` → `{"ok":true}`.

## Мобильное приложение

```bash
cd apps/mobile
EXPO_PUBLIC_API_URL=https://<IP>.sslip.io npx expo start --go     # или run:ios / run:android
```

## Коды входа

По умолчанию `SMS_PROVIDER=log`: SMS не отправляются, а коды пишутся в лог сервера. Этого достаточно для закрытого теста.

```bash
ssh blink@<IP>
cd /opt/blinkcode/deploy/yandex
sudo docker compose logs -f api | grep SMS
```

### Настоящие SMS (sms.ru)

1. Зарегистрируйся на [sms.ru](https://sms.ru) и пополни баланс; `api_id` — в личном кабинете.
2. На ВМ в `/opt/blinkcode/deploy/yandex/.env` укажи:
   ```
   SMS_PROVIDER=smsru
   SMSRU_API_ID=<твой api_id>
   ```
3. `sudo docker compose up -d`.

Если SMS не ушла (например, кончился баланс), приложение получит ошибку `sms_failed`, а причина попадёт в лог API.

## Обслуживание

| Задача | Команда (на ВМ, в `/opt/blinkcode/deploy/yandex`) |
|---|---|
| Обновить до свежего `main` | `sudo ./setup.sh` |
| Статус контейнеров | `sudo docker compose ps` |
| Логи | `sudo docker compose logs -f api` (или `caddy`, `postgres`) |
| Резервная копия БД | `sudo docker compose exec -T postgres pg_dump -U blink blink > backup.sql` |
| Перезапуск | `sudo docker compose restart api` |

Секреты (пароль БД, ключи JWT и OTP) генерируются при первом запуске и лежат только в `.env` на ВМ (права `600`).
Не удаляй `.env`: с новым `JWT_SECRET` все пользователи разлогинятся, а с новым паролем API не подключится к уже созданной БД.

Ход первой установки: `sudo tail -f /var/log/blinkcode-setup.log`.
