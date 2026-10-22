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

## Разработка

Монорепозиторий на pnpm: `apps/api` — бэкенд (Fastify, PostgreSQL, Redis, WebSocket). Мобильное приложение будет в `apps/mobile`.

```bash
docker compose up -d   # Postgres + Redis
pnpm install
pnpm dev               # API на http://localhost:3000
pnpm test              # тесты (нужны Postgres и Redis из docker compose)
```

Описание API и запуска — в [apps/api/README.md](apps/api/README.md).
