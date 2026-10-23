# blinkcode

Социальное гео-приложение для друзей «по типу Блинка»: видеть друзей на карте и — главное — **встречаться**, **исследовать город вместе** и **быть на связи, когда это важно**.

> Рабочее название проекта — `blinkcode`. Финальное имя и бренд — открытый вопрос (см. [open-questions](docs/open-questions.md)).

## Документация

| Документ | О чём |
|---|---|
| [Видение продукта](docs/vision.md) | Проблема, аудитория, позиционирование, северная метрика |
| [Фичи](docs/features/README.md) | Спецификации всех 9 фич: user stories, критерии приёмки, техника, риски |
| [Роадмап](docs/roadmap.md) | Фазы, MVP, порядок фич и критерии выхода из каждой фазы |
| [Бэклог](docs/backlog.md) | Эпики → задачи с приоритетами и оценками |
| [Архитектура](docs/architecture.md) | Стек, компоненты, модель данных, real-time, батарея |
| [Приватность и безопасность](docs/privacy-and-safety.md) | Принципы работы с геоданными, модерация, юридическое |
| [Риски](docs/risks.md) | Реестр рисков и что с ними делать |
| [Открытые вопросы](docs/open-questions.md) | Решения, которые нужно принять до старта разработки |

## Фичи коротко

| # | Фича | Фаза |
|---|---|---|
| 1 | [Маршрут до друга в live-режиме](docs/features/01-route-to-friend.md) | MVP |
| 2 | [Умные сборы](docs/features/02-smart-gatherings.md) | MVP |
| 3 | [Чекины и исследование районов](docs/features/03-checkins-exploration.md) | v1.1 |
| 4 | [Челлендж «Чекак 2.0» и блинкисы](docs/features/04-challenges-blinkis.md) | v1.2 |
| 5 | [Стикеры на карте](docs/features/05-map-stickers.md) | v1.1 |
| 6 | [Режим рации](docs/features/06-walkie-talkie.md) | v1.2 |
| 7 | [SOS с live-трансляцией](docs/features/07-sos.md) | MVP |
| 8 | [Виджет с ближайшими друзьями](docs/features/08-widget.md) | v1.1 |
| 9 | [Импорт любимых мест и авто-«дом/работа»](docs/features/09-places-import.md) | MVP (урезанно) |

## Быстрый старт: посмотреть приложение на телефоне

Нужны [Docker Desktop](https://www.docker.com/products/docker-desktop/) и [Node.js 22+](https://nodejs.org) на компьютере и **Expo Go** на телефоне.

```bash
git clone https://github.com/vovmolchanov2010-commits/blinkcode.git
cd blinkcode
npm start
```

Команда поднимет сервер в Docker и покажет QR-код. Телефон должен быть в той же Wi-Fi, что и компьютер: отсканируй код (на iPhone — камерой, на Android — в Expo Go) и войди с любым номером — код подставится сам.
Чтобы увидеть друг друга на карте, войди с двух телефонов под разными номерами и добавь друг друга по нику.

Ограничения Expo Go: геолокация отправляется, только пока приложение открыто. Полная сборка с фоновой геолокацией — в [apps/mobile/README.md](apps/mobile/README.md).

## Разработка

Монорепозиторий на pnpm:
- `apps/api` — бэкенд (Fastify, PostgreSQL, Redis, WebSocket), см. [apps/api/README.md](apps/api/README.md);
- `apps/mobile` — приложение для iOS и Android (Expo, React Native), см. [apps/mobile/README.md](apps/mobile/README.md).
- `deploy/yandex` — деплой сервера в Yandex Cloud, см. [deploy/yandex/README.md](deploy/yandex/README.md).

```bash
docker compose up -d   # Postgres + Redis
pnpm install
pnpm dev               # API на http://localhost:3000
pnpm test              # тесты (нужны Postgres и Redis из docker compose)
```
