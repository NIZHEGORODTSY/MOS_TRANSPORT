-- MosTransport schema for the organizers' dataset (PostgreSQL 13+). Safe to re-run: only creates what is missing.
-- Dataset timestamps are naive UTC; they are stored as timestamptz (Moscow = UTC+3).

CREATE TABLE IF NOT EXISTS stops (
    id          integer PRIMARY KEY,
    lon         double precision NOT NULL,
    lat         double precision NOT NULL,
    address     text,
    UNIQUE (lon, lat)
);

-- The dataset has no route numbers: a route is the set of stops shared by the vehicles serving it.
CREATE TABLE IF NOT EXISTS routes (
    id          integer PRIMARY KEY,
    name        text NOT NULL,
    stop_count  integer NOT NULL
);

CREATE TABLE IF NOT EXISTS vehicles (
    tr_id        bigint PRIMARY KEY,
    unit_id      bigint,                          -- on-board terminal id (NDTP peerAddress)
    route_id     integer REFERENCES routes (id),
    has_schedule boolean NOT NULL,
    in_test      boolean NOT NULL                 -- has schedule in the test/validate period
);

CREATE TABLE IF NOT EXISTS schedule (
    item_id      bigint PRIMARY KEY,              -- tt_action_item_id: one planned arrival of a vehicle at a stop
    tr_id        bigint NOT NULL REFERENCES vehicles (tr_id),
    stop_id      integer NOT NULL REFERENCES stops (id),
    time_plan    timestamptz NOT NULL,
    time_fact    timestamptz,                     -- NULL when unknown; never use future facts as model features
    order_date   date NOT NULL,
    manual_fill  boolean
);
CREATE INDEX IF NOT EXISTS schedule_tr_plan_idx ON schedule (tr_id, time_plan);
CREATE INDEX IF NOT EXISTS schedule_stop_idx ON schedule (stop_id);

-- Decoded NDTP navigation cells (G6CellNav00), one row per packet.
CREATE TABLE IF NOT EXISTS telemetry (
    packet_id       text PRIMARY KEY,                -- not numeric for synthetic vehicles, e.g. '9000000_0'
    tr_id           bigint NOT NULL REFERENCES vehicles (tr_id),
    unit_id         bigint,
    event_time      timestamptz NOT NULL,
    device_event_id bigint,
    location_valid  boolean NOT NULL,
    gps_time        timestamptz,
    lon             double precision,
    lat             double precision,
    alt             real,
    speed           real,
    heading         real,
    receive_time    timestamptz,
    is_hist_data    boolean
);
CREATE INDEX IF NOT EXISTS telemetry_tr_time_idx ON telemetry (tr_id, event_time);

-- Forecast points from labels/*.csv (train, test) and validate/points.csv (no target).
CREATE TABLE IF NOT EXISTS forecast_points (
    sample_id        text PRIMARY KEY,
    split            text NOT NULL CHECK (split IN ('train', 'test', 'validate')),
    tr_id            bigint NOT NULL REFERENCES vehicles (tr_id),
    t                timestamptz NOT NULL,         -- forecast moment: only data with event_time <= t may be used
    target_item_id   bigint NOT NULL REFERENCES schedule (item_id),
    target_time_plan timestamptz NOT NULL,
    cur_dev_s        real NOT NULL,
    target_delay_s   real,
    target_class     text
);
CREATE INDEX IF NOT EXISTS forecast_points_tr_t_idx ON forecast_points (tr_id, t);

CREATE TABLE IF NOT EXISTS predictions (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sample_id         text REFERENCES forecast_points (sample_id),
    tr_id             bigint NOT NULL REFERENCES vehicles (tr_id),
    t                 timestamptz NOT NULL,        -- moment the forecast was made
    target_item_id    bigint REFERENCES schedule (item_id),
    predicted_delay_s real NOT NULL,
    delay_probability real,
    cause             text,
    model_version     text,
    created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS predictions_tr_t_idx ON predictions (tr_id, t);
