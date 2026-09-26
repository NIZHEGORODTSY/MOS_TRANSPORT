-- Database user for the backend and ML module. Run in psql as postgres; \password asks for the password
-- interactively, so it never ends up in this file or in shell history.
CREATE ROLE mostransport_app LOGIN;
\password mostransport_app
GRANT CONNECT ON DATABASE buses TO mostransport_app;
\c buses
GRANT USAGE ON SCHEMA public TO mostransport_app;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO mostransport_app;
GRANT INSERT ON telemetry, predictions TO mostransport_app;
