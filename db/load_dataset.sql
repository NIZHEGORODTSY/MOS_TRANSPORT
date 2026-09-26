-- Loads the CSVs from /tmp/mostransport (see db/prepare_dataset.py). Replaces all dataset rows, including predictions.
\set ON_ERROR_STOP on
SET TIME ZONE 0;
BEGIN;
TRUNCATE predictions, forecast_points, telemetry, schedule, vehicles, routes, stops;
\copy stops (id, lon, lat, address) FROM '/tmp/mostransport/stops.csv' WITH (FORMAT csv, HEADER true)
\copy routes (id, name, stop_count) FROM '/tmp/mostransport/routes.csv' WITH (FORMAT csv, HEADER true)
\copy vehicles (tr_id, unit_id, route_id, has_schedule, in_test) FROM '/tmp/mostransport/vehicles.csv' WITH (FORMAT csv, HEADER true)
\copy schedule (item_id, tr_id, stop_id, time_plan, time_fact, order_date, manual_fill) FROM '/tmp/mostransport/schedule.csv' WITH (FORMAT csv, HEADER true)
\copy telemetry (packet_id, tr_id, unit_id, event_time, device_event_id, location_valid, gps_time, lon, lat, alt, speed, heading, receive_time, is_hist_data) FROM '/tmp/mostransport/telemetry.csv' WITH (FORMAT csv, HEADER true)
\copy forecast_points (sample_id, split, tr_id, t, target_item_id, target_time_plan, cur_dev_s, target_delay_s, target_class) FROM '/tmp/mostransport/forecast_points.csv' WITH (FORMAT csv, HEADER true)
COMMIT;
ANALYZE stops, routes, vehicles, schedule, telemetry, forecast_points;
