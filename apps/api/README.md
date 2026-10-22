# @blinkcode/api

Бэкенд: Fastify + TypeScript, PostgreSQL, Redis (последние позиции, коды входа, pub/sub для real-time).

## Запуск

```bash
docker compose up -d          # из корня репозитория: Postgres + Redis
cp apps/api/.env.example apps/api/.env   # по желанию: .env читается из apps/api
pnpm install
pnpm dev                      # миграции + сервер на :3000 с перезапуском
```

В разработке SMS не отправляются: коды входа пишутся в лог сервера (`SMS: Код для входа: 123456`).

| Переменная | Назначение |
|---|---|
| `DATABASE_URL`, `REDIS_URL` | Подключение к PostgreSQL и Redis |
| `JWT_SECRET`, `OTP_SECRET` | Обязательны в production, ≥ 32 символов |
| `SMS_PROVIDER` | `log` — коды в лог, `smsru` — SMS через sms.ru. В production задаётся явно |
| `SMSRU_API_ID` | Ключ sms.ru для `SMS_PROVIDER=smsru` |
| `OTP_DEV_ECHO` | `true` — код входа возвращается в ответе `/v1/auth/otp/request` (`{ devCode }`), приложение подставляет его само. Только для локального запуска, в production запрещено |

Деплой в Yandex Cloud — [deploy/yandex/README.md](../../deploy/yandex/README.md).

## Тесты

Тесты работают с настоящими Postgres и Redis из `docker compose` (БД `blink_test`, Redis db 15).
Другие адреса — через `TEST_DATABASE_URL` и `TEST_REDIS_URL`.

```bash
pnpm test
pnpm typecheck
```

## API

Все ответы — JSON. Защищённые методы требуют `Authorization: Bearer <accessToken>`.
Ошибки: `{ "error": "<code>", "message": "..." }`.

### Вход (E0-01)

| Метод | Путь | Тело | Ответ |
|---|---|---|---|
| POST | `/v1/auth/otp/request` | `{ phone }` (E.164) | 204. Повтор не чаще раза в 60 с, не больше 5 кодов в час |
| POST | `/v1/auth/otp/verify` | `{ phone, code }` | `{ accessToken, refreshToken, user, isNewUser }`. 5 попыток на код |
| POST | `/v1/auth/refresh` | `{ refreshToken }` | Новая пара токенов. Повторное использование старого refresh-токена отзывает все сессии |
| POST | `/v1/auth/logout` | `{ refreshToken }` | 204 |
| POST | `/v1/auth/logout-all` | — | 204, выход на всех устройствах |

Access-токен живёт 15 минут, refresh — 30 дней.

### Профиль и «призрак» (E0-02, E0-05)

| Метод | Путь | Тело / ответ |
|---|---|---|
| GET | `/v1/me` | `{ id, phone, username, displayName, avatarUrl, ghostUntil }` |
| PATCH | `/v1/me` | `{ username?, displayName? }`; 409 `username_taken` |
| PUT | `/v1/me/ghost` | `{ until? }` — без `until` «пока не выключу» |
| DELETE | `/v1/me/ghost` | Выключить «призрака» |
| GET | `/v1/users/by-username/:username` | Публичный профиль; 404, если пользователь заблокировал вас или вы его |

### Друзья и блокировки (E0-03, E0-04, E0-16)

| Метод | Путь | Описание |
|---|---|---|
| GET | `/v1/friends` | Друзья: `isClose`, `sharing.precision` (как друг видит **вас**), `location` (как вы видите **его**) |
| PATCH | `/v1/friends/:userId` | `{ precision?: "exact" \| "approx" \| "hidden", isClose? }` |
| DELETE | `/v1/friends/:userId` | Удалить из друзей (у обоих) |
| GET | `/v1/friends/requests` | `{ incoming, outgoing }` |
| POST | `/v1/friends/requests` | `{ userId }` → `{ status: "pending" \| "accepted" }` (встречная заявка принимается сразу) |
| POST | `/v1/friends/requests/:userId/accept` | Принять заявку |
| DELETE | `/v1/friends/requests/:userId` | Отклонить входящую / отменить исходящую |
| POST | `/v1/blocks/:userId` | Заблокировать: дружба и заявки удаляются, пользователи не находят друг друга |
| DELETE | `/v1/blocks/:userId` | Разблокировать |

### Геолокация (E0-09)

| Метод | Путь | Описание |
|---|---|---|
| POST | `/v1/location` | `{ points: [{ lat, lng, accuracy?, speed?, heading?, battery?, ts }] }` (до 100, `ts` — мс) → `{ accepted, rejected }` |
| GET | `/v1/friends/locations` | `{ locations: [{ userId, location }] }` |

Правила:
- хранится только последняя позиция (в Redis, 24 ч), история перемещений не сохраняется;
- отбрасываются точки из будущего (> 1 мин), устаревшие и скачки быстрее 300 м/с;
- `approx` — центр H3-ячейки разрешения 7 (~1.5 км), без скорости и направления;
- в режиме «призрака» и при `hidden` друг не получает ничего.

### WebSocket (E0-08)

`GET /v1/ws?token=<accessToken>`

Сервер → клиент:
- `{ type: "snapshot", locations }` — сразу после подключения;
- `{ type: "location", userId, location }`, `{ type: "location.removed", userId }`;
- `{ type: "friend.request", fromUserId }`, `{ type: "friend.added", userId }`, `{ type: "friend.removed", userId }`;
- `{ type: "location.ack", accepted, rejected }`, `{ type: "pong" }`, `{ type: "error", error }`.

Клиент → сервер: `{ type: "ping" }`, `{ type: "location", points: [...] }`.
