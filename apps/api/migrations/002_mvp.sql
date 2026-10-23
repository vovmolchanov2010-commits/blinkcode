-- Фича 9: дом и работа. Друзья видят только статус «дома» / «на работе», не адрес.
CREATE TYPE place_kind AS ENUM ('home', 'work');
CREATE TYPE place_visibility AS ENUM ('all', 'close', 'none');

ALTER TABLE users ADD COLUMN place_visibility place_visibility NOT NULL DEFAULT 'close';

CREATE TABLE saved_places (
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind       place_kind NOT NULL,
  lat        double precision NOT NULL,
  lng        double precision NOT NULL,
  radius_m   integer NOT NULL DEFAULT 150 CHECK (radius_m BETWEEN 50 AND 1000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind)
);

-- Фича 2: умные сборы.
CREATE TYPE gathering_status AS ENUM ('active', 'closed');
CREATE TYPE gathering_rsvp AS ENUM ('pending', 'going', 'declined');

CREATE TABLE gatherings (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title      text NOT NULL,
  lat        double precision NOT NULL,
  lng        double precision NOT NULL,
  place_name text,
  starts_at  timestamptz NOT NULL,
  status     gathering_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE gathering_participants (
  gathering_id uuid NOT NULL REFERENCES gatherings (id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  rsvp         gathering_rsvp NOT NULL DEFAULT 'pending',
  -- leaving | on_the_way | stuck | late | arrived
  chip         text,
  comment      text,
  eta_at       timestamptz,
  -- auto — по геолокации, manual — участник указал сам (приоритетнее авто на 15 мин).
  eta_source   text CHECK (eta_source IN ('auto', 'manual')),
  manual_until timestamptz,
  arrived_at   timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (gathering_id, user_id)
);
CREATE INDEX gathering_participants_user_idx ON gathering_participants (user_id);

-- Фича 1: маршрут до друга. Сессия живёт не дольше часа.
CREATE TABLE route_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  target_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  mode         text NOT NULL CHECK (mode IN ('walk', 'drive')),
  eta_at       timestamptz,
  distance_m   integer,
  started_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  ended_at     timestamptz,
  -- arrived | stopped
  end_reason   text,
  CHECK (requester_id <> target_id)
);
CREATE INDEX route_sessions_requester_idx ON route_sessions (requester_id) WHERE ended_at IS NULL;
CREATE INDEX route_sessions_target_idx ON route_sessions (target_id) WHERE ended_at IS NULL;

-- Фича 7: SOS.
ALTER TABLE users ADD COLUMN sos_pin_hash text;

CREATE TABLE trusted_contacts (
  user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  position        smallint NOT NULL CHECK (position BETWEEN 1 AND 3),
  contact_user_id uuid REFERENCES users (id) ON DELETE CASCADE,
  phone           text,
  name            text,
  PRIMARY KEY (user_id, position),
  CHECK (contact_user_id IS NOT NULL OR phone IS NOT NULL)
);

CREATE TABLE sos_sessions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- Ссылка для контактов содержит токен; в базе — только его хэш.
  token_hash text NOT NULL UNIQUE,
  is_test    boolean NOT NULL DEFAULT false,
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  ended_at   timestamptz,
  -- cancelled
  end_reason text
);
CREATE INDEX sos_sessions_user_idx ON sos_sessions (user_id) WHERE ended_at IS NULL;

-- Трек SOS. Удаляется через 30 дней вместе с сессией.
CREATE TABLE sos_points (
  session_id uuid NOT NULL REFERENCES sos_sessions (id) ON DELETE CASCADE,
  ts         timestamptz NOT NULL,
  lat        double precision NOT NULL,
  lng        double precision NOT NULL,
  accuracy   real,
  speed      real,
  heading    real,
  battery    smallint
);
CREATE INDEX sos_points_session_idx ON sos_points (session_id, ts);
