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
| `PUBLIC_URL` | Внешний адрес сервера для ссылок SOS в SMS, например `https://blink.example.ru`. Без него берётся адрес из запроса |
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

### Дом и работа (фича 9)

| Метод | Путь | Описание |
|---|---|---|
| GET | `/v1/me/places` | `{ visibility, places: [{ kind, lat, lng, radiusM }] }` |
| PUT | `/v1/me/places/:kind` | `kind`: `home` \| `work`; `{ lat, lng, radiusM? }` (50–1000 м, по умолчанию 150) |
| DELETE | `/v1/me/places/:kind` | Удалить место |
| PUT | `/v1/me/places-visibility` | `{ visibility: "all" \| "close" \| "none" }` — кто видит статус (по умолчанию близкие) |

Пока владелец внутри зоны места, его позиция для **всех** друзей размывается до `approx`, а тем, кому
разрешено, в `location` добавляется `place: "home" | "work"`. Координаты мест друзьям не отдаются.

### Сборы (фича 2)

| Метод | Путь | Описание |
|---|---|---|
| GET | `/v1/gatherings` | Активные сборы (до 3 ч после начала), кроме тех, от которых я отказался |
| POST | `/v1/gatherings` | `{ title, lat, lng, placeName?, startsAt, participantIds }` — звать можно только друзей, до 30 человек |
| GET | `/v1/gatherings/:id` | Сбор с участниками: `rsvp`, `chip`, `comment`, `etaAt`, `etaSource`, `arrivedAt` |
| PATCH | `/v1/gatherings/:id` | Только организатор: `{ title?, lat?, lng?, placeName?, startsAt? }` |
| POST | `/v1/gatherings/:id/close` | Только организатор |
| PUT | `/v1/gatherings/:id/me` | `{ rsvp?: "going" \| "declined", chip?, comment?, etaMinutes? }`; `chip`: `leaving`, `on_the_way`, `stuck`, `late`, `arrived` |

По входящим позициям сервер сам ставит «на месте» в радиусе 100 м и считает авто-ETA (от 2 ч до начала до
3 ч после). ETA — оценка по прямой (×1.3, пешком 1.3 м/с или ~25 км/ч, если человек уже едет), пока не
подключён провайдер маршрутов. Ручной статус перекрывает авто-ETA на 15 минут. В режиме «призрака» авто
не работает.

### Маршрут до друга (фича 1)

| Метод | Путь | Описание |
|---|---|---|
| GET | `/v1/routes` | Активные сессии: куда иду я и кто идёт ко мне |
| POST | `/v1/routes` | `{ targetId, mode: "walk" \| "drive" }`; 409 `target_location_hidden`, если друг не показывает вам позицию |
| GET | `/v1/routes/:id` | Сессия |
| PATCH | `/v1/routes/:id` | Только идущий: `{ etaSec, distanceM, mode? }` |
| POST | `/v1/routes/:id/stop` | Любая сторона: `{ reason: "arrived" \| "stopped" }` |

Сессия закрывается сама через час.

### SOS (фича 7)

| Метод | Путь | Описание |
|---|---|---|
| GET | `/v1/sos` | `{ hasPin, contacts, active }` |
| PUT | `/v1/sos/contacts` | `{ contacts: [{ userId } \| { phone, name }] }` — до 3, друзья или номера |
| PUT | `/v1/sos/pin` | `{ pin, currentPin? }` — 4–6 цифр; сменить можно, только зная текущий |
| POST | `/v1/sos` | `{ test? }` → `{ session, url, smsFailed }`. Нужны PIN и хотя бы один контакт |
| POST | `/v1/sos/extend` | +15 минут (не дольше 4 ч от начала) |
| POST | `/v1/sos/cancel` | `{ pin }`; 5 неверных попыток — отмена блокируется до конца трансляции |
| GET | `/s/:token` | Публичная страница трансляции (без входа, `noindex`) |
| GET | `/s/:token/data` | Данные страницы; 404 через час после окончания |

Всем контактам уходит SMS со ссылкой (друзьям — на их номер в Blink), друзьям ещё и событие
`sos.started`. В ссылке — случайный токен, в базе только его хэш. Трек хранится 30 дней.

### WebSocket (E0-08)

`GET /v1/ws?token=<accessToken>`

Сервер → клиент:
- `{ type: "snapshot", locations }` — сразу после подключения;
- `{ type: "location", userId, location }`, `{ type: "location.removed", userId }`;
- `{ type: "friend.request", fromUserId }`, `{ type: "friend.added", userId }`, `{ type: "friend.removed", userId }`;
- `{ type: "gathering.updated", gatheringId, reason, userId?, startsAtFrom?, startsAtTo?, placeChanged? }`;
- `{ type: "route.updated", routeId }`;
- `{ type: "sos.started", sessionId, userId, url, isTest }`, `{ type: "sos.ended", sessionId, userId }`;
- `{ type: "location.ack", accepted, rejected }`, `{ type: "pong" }`, `{ type: "error", error }`.

Клиент → сервер: `{ type: "ping" }`, `{ type: "location", points: [...] }`.
