# nodejs-sqlite-otel-test

Small Express + SQLite (better-sqlite3) app for testing OpenTelemetry ingest into Elastic from a plain Node.js process (VM / server / laptop). The app has no OpenTelemetry start-up code; telemetry is switched on from the command line, so the same code runs with no OTel, with EDOT Node.js, or with the upstream auto-instrumentations.

Tested locally on Node.js v20.20.2 (EDOT Node.js 1.20.1 declares `node: ^18.19.0 || >=20.6.0`).

## Setup

```bash
npm install
```

## Endpoints

| Method | Path | What it does |
|---|---|---|
| GET | `/health` | liveness |
| GET | `/items`, `/items/:id` | SQLite SELECT (404 for unknown id) |
| POST | `/items` | SQLite INSERT, body `{"name":"x"}` |
| DELETE | `/items/:id` | SQLite DELETE |
| POST | `/seed?n=10` | bulk INSERT in a transaction |
| GET | `/slow?ms=1000` | slow request |
| GET | `/error` | always 500, error log and exception |
| GET | `/self` | calls `/items` over HTTP (client span plus server span) |

DB calls are wrapped in a manual `sqlite <op>` span because there is no OpenTelemetry instrumentation for better-sqlite3. Logs go through pino, so trace ids are added to log lines and EDOT can send them when log sending is enabled.

Generate traffic: `./traffic.sh http://localhost:3000 5`

## Scenarios

Replace the `<...>` placeholders. Do not commit real tokens or keys.

### 0. No telemetry
```bash
npm start
```

### A. EDOT Node.js sent straight to APM Server (what the customer in case 02166165 did)
Not a supported path for EDOT SDKs; use it to see what arrives.
```bash
export OTEL_SERVICE_NAME=sqlite-edot-to-apm
export OTEL_EXPORTER_OTLP_ENDPOINT="http://<apm-server-host>:8200"   # https:// if the listener uses TLS
export OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
# export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer <apm-secret-token>"
export ELASTIC_OTEL_NODE_ENABLE_LOG_SENDING=true   # logs are off by default in EDOT Node.js
npm run start:edot
```

### B. Upstream OpenTelemetry auto-instrumentation sent to APM Server
```bash
export OTEL_SERVICE_NAME=sqlite-upstream-to-apm
export OTEL_EXPORTER_OTLP_ENDPOINT="https://<apm-server-host>:8200"
export OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer <apm-secret-token>"
export OTEL_METRICS_EXPORTER=otlp
export OTEL_LOGS_EXPORTER=otlp
npm run start:upstream
```

### C. EDOT Node.js sent to an Elastic Agent running in OTel mode (gateway)
Supported path for self-managed.
```bash
export OTEL_SERVICE_NAME=sqlite-edot-to-gateway
export OTEL_EXPORTER_OTLP_ENDPOINT="http://<gateway-host>:4318"
export OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
# export OTEL_EXPORTER_OTLP_HEADERS="Authorization=ApiKey <key>"   # if the gateway receiver requires auth
export ELASTIC_OTEL_NODE_ENABLE_LOG_SENDING=true
npm run start:edot
```

### Local check without sending anything
```bash
OTEL_SERVICE_NAME=local OTEL_TRACES_EXPORTER=console OTEL_METRICS_EXPORTER=none OTEL_LOGS_EXPORTER=none npm run start:upstream
```
(EDOT in the same mode adds `trace_id` / `span_id` to the pino log lines, which shows tracing is active.)

## What to compare in Kibana

- Applications > Service inventory: is the service listed, and are the traces, metrics and Logs tabs filled?
- Discover: `data_stream.dataset`, field names (`labels.*` on the APM Server path vs OTel-native names on the gateway path), `agent.name`.
- Whether the `sqlite` spans, the `/self` distributed trace and the `/error` exception appear.
- Whether logs arrive (log sending is off by default in EDOT Node.js; logs through APM Server are technical preview).
