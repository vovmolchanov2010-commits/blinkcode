# Архитектура

Документ — стартовое предложение для обсуждения с командой, а не окончательное решение. Выбор провайдеров карт/SMS зависит от целевого рынка (см. [open-questions](open-questions.md)).

## Обзор

```
┌──────────────────────┐        ┌───────────────────────────────────────────────┐
│  Мобильное приложение │  WS    │                   Backend                      │
│  iOS / Android        │◄──────►│  Realtime Gateway (WebSocket)                  │
│  + виджеты            │        │        │                                       │
│  + Live Activities    │  HTTPS │  API (REST/GraphQL) ── Auth                    │
│  + PTT / FGS          │◄──────►│        │                                       │
└──────────┬───────────┘        │  Domain services:                              │
           │ push (APNs/FCM)    │   location · friends · gatherings · routing    │
           │                    │   checkins/exploration · stickers · challenges │
┌──────────▼───────────┐        │   wallet/shop · ptt · sos (изолирован)         │
│ SOS web-страница      │◄──SSE─┤        │                                       │
│ (без логина)          │        │  Очереди / воркеры (ETA, push, SMS, проверки)  │
└──────────────────────┘        └────────┬──────────────┬───────────────┬────────┘
                                          │              │               │
                                 PostgreSQL+PostGIS   Redis (GEO,     S3-хранилище
                                 + h3-pg              pub/sub, кэш)   (фото, аудио)
                                          │
                       Внешние: карты/маршруты · POI · SMS · LLM/vision · APNs/FCM
```

## Стек (предложение)

| Слой | Выбор | Почему |
|---|---|---|
| Мобильное приложение | **React Native (Expo, dev build)** или **Flutter** + нативные модули | Один код для двух платформ; нативные модули всё равно нужны для виджетов (Swift/Kotlin), PushToTalk, Live Activities, фоновой геолокации |
| Карта в приложении | Mapbox / MapLibre / Яндекс MapKit / 2ГИС SDK | Зависит от рынка и стоимости |
| Backend | TypeScript (NestJS) или Go | Команда и найм; Go — если делаем упор на real-time и нагрузку |
| Real-time | WebSocket gateway + Redis pub/sub | Позиции друзей, сборы, маршруты, SOS |
| БД | PostgreSQL + PostGIS + `h3-pg` | Гео-запросы, H3 для исследования районов |
| Живые позиции | Redis GEO (последняя позиция, TTL) | Быстрые запросы «кто в радиусе» (рация, стикеры рядом) |
| Хранилище медиа | S3-совместимое | Фото челленджей, аудио рации, аватарки |
| Очереди | Redis Streams / RabbitMQ / SQS | ETA-пересчёт, пуши, SMS, проверка фото |
| Маршруты/ETA | API провайдера → позже self-hosted Valhalla/OSRM | Стоимость при росте |
| LLM / vision | LLM API с поддержкой изображений | Генерация челленджей, проверка фото |
| Аналитика | PostHog / Amplitude + собственные события | Воронки, retention, A/B |
| Мониторинг | Sentry, Prometheus + Grafana, алерты на SOS | |

## Ключевые потоки

### Live-геолокация

1. Клиент отправляет позицию (`lat, lng, accuracy, speed, heading, battery, ts`) по WebSocket, при отсутствии соединения — пачкой по HTTPS.
2. Сервер: запись в Redis GEO (последняя позиция) → проверка правил приватности → рассылка подписчикам (друзьям, у которых сейчас открыто приложение / активна сессия).
3. История позиций хранится коротко (≤ 24 ч) только для текущих функций (трек маршрута, исследование), затем удаляется или агрегируется в H3-ячейки.

### Батарея и частота геолокации

| Состояние | Частота | Механизм |
|---|---|---|
| Стоит на месте | раз в 10–15 мин или при значимом изменении | iOS significant-change / visits, Android geofence + активность |
| Идёт пешком | раз в 1–2 мин | Activity recognition |
| Едет | раз в 30–60 с | |
| Активная сессия (маршрут, сбор < 60 мин, SOS) | раз в 3–5 с | Явный режим с таймаутом |
| Друг смотрит на тебя в приложении | раз в 5–10 с на время просмотра | «Запрос свежей позиции» через silent push |

Цель: ≤ 4% батареи в сутки в обычном режиме. Измеряется на эталонных устройствах в каждой бета-сборке.

## Модель данных (основные сущности)

```
users(id, phone, username, avatar_url, created_at)
friendships(user_id, friend_id, status, is_close, location_precision[exact|approx|hidden])
groups(id, title) / group_members(group_id, user_id)

saved_places(id, user_id, kind, label, geom, radius_m, source, visibility)       -- фича 9
route_sessions(id, requester_id, target_id, mode, status, expires_at)             -- фича 1
gatherings(id, owner_id, place_id, geom, starts_at, status)                       -- фича 2
gathering_participants(gathering_id, user_id, rsvp, eta_at, eta_source,
                       status_chip, comment, arrived_at)
places(id, provider, provider_place_id, name, category, geom)                     -- POI
checkins(id, user_id, place_id, created_at, visibility)                           -- фича 3
explored_cells(user_id, h3_index, first_seen_at, visits)
district_cells(district_id, h3_index)
challenges / challenge_assignments / challenge_submissions                        -- фича 4
wallet_transactions(id, user_id, amount, reason, ref_id UNIQUE, created_at)
shop_items / inventory(user_id, item_id, acquired_at)
place_stickers(id, author_id, place_id, sticker_id, text, visibility, expires_at) -- фича 5
ptt_messages(id, gathering_id, sender_id, audio_url, recipients[], expires_at)    -- фича 6
trusted_contacts(user_id, contact_user_id, phone, position)                       -- фича 7
sos_sessions(id, user_id, token_hash, status, started_at, expires_at)
sos_points(session_id, ts, geom, accuracy, battery)
```

## Нефункциональные требования

| Требование | Цель |
|---|---|
| Задержка доставки позиции другу (онлайн) | p95 ≤ 2 с |
| SOS: активация → SMS отправлена | p95 ≤ 5 с |
| Доступность SOS-сервиса | 99.9% |
| Рация: задержка доставки | p50 ≤ 1.5 с, p95 ≤ 3 с |
| Расход батареи в фоне | ≤ 4% / сутки |
| Шифрование | TLS везде, шифрование геоданных и SOS-треков в покое |

## Технические спайки до старта разработки

1. **Фоновая геолокация и батарея** на iOS/Android в выбранном фреймворке (3–5 дней).
2. **PushToTalk (iOS) + foreground service (Android)** для рации (5–7 дней).
3. **Виджет со снимком карты** — лимиты памяти и обновлений (3 дня).
4. **Стоимость маршрутизации/ETA** при ожидаемой нагрузке (2 дня).
