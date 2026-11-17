# nodejs-sqlite-otel-test

Small Express + SQLite (better-sqlite3) app used to test OpenTelemetry ingest into Elastic from a plain Node.js process (VM / server / laptop). Tested locally on Node.js v20.20.2, Elastic Stack 9.4.2.

There are two ready-to-run variants, each with its own README (deployment steps, what to change, how to verify):

| Folder | SDK | Path to Elastic | Supported by Elastic? |
|---|---|---|---|
| [`contrib-apm-server/`](contrib-apm-server/README.md) | upstream (contrib) OpenTelemetry Node.js SDK | app -> APM Server (OTLP/HTTP) -> Elasticsearch | SDK is community-supported; Elastic supports the data once it reaches Elastic |
| [`edot-collector-es/`](edot-collector-es/README.md) | EDOT Node.js | app -> Elastic Agent in OTel mode (gateway, Docker) -> Elasticsearch | Yes, this is the supported path for EDOT SDKs |

In each folder you only need to change the export endpoint and the secret in the env file (`.env` for `contrib-apm-server`, `collector.env` for `edot-collector-es`). The committed env files contain placeholders only; do not commit real endpoints or keys.

The files in this top-level folder (`app.js`, `package.json`, `traffic.sh`) are the original app and scripts with no OpenTelemetry start-up code. They are kept as a baseline: `npm install && npm start` runs the app with no telemetry, and `npm run start:edot` / `npm run start:upstream` start it with an SDK configured only through `OTEL_*` environment variables.

## App endpoints

| Method | Path | What it does |
|---|---|---|
| GET | `/health` | liveness |
| GET | `/items`, `/items/:id` | SQLite SELECT (404 for an unknown id) |
| POST | `/items` | SQLite INSERT, body `{"name":"x"}` |
| DELETE | `/items/:id` | SQLite DELETE |
| POST | `/seed?n=10` | bulk INSERT in a transaction |
| GET | `/slow?ms=1000` | slow request |
| GET | `/error` | always 500, error log and exception |
| GET | `/self` | calls `/items` over HTTP (client span plus server span, a distributed trace) |

DB calls are wrapped in a manual `sqlite <op>` span (no OpenTelemetry instrumentation exists for better-sqlite3). Logs go through pino, so trace ids are added to log lines.

Generate traffic: `./traffic.sh http://localhost:3000 5`

## Baseline scenarios (this folder, env-var only)

Replace the `<...>` placeholders; do not commit real values.

```bash
npm install

# EDOT straight to APM Server (not a supported path for EDOT SDKs; useful to see what arrives)
OTEL_SERVICE_NAME=sqlite-edot-to-apm OTEL_EXPORTER_OTLP_ENDPOINT="https://<apm-server-host>:443" \
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer <apm-secret-token>" \
ELASTIC_OTEL_NODE_ENABLE_LOG_SENDING=true npm run start:edot

# Upstream auto-instrumentation straight to APM Server
OTEL_SERVICE_NAME=sqlite-upstream-to-apm OTEL_EXPORTER_OTLP_ENDPOINT="https://<apm-server-host>:443" \
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer <apm-secret-token>" \
OTEL_METRICS_EXPORTER=otlp OTEL_LOGS_EXPORTER=otlp npm run start:upstream
```

## What to compare in Kibana

- Applications > Service inventory: is the service listed, and are traces, metrics and logs filled in?
- Discover: field names (`labels.*` on the APM Server path versus OTel-native names on the gateway path), `agent.name`, and the data streams used (`traces-apm*` versus `traces-generic.otel-*`).
- Whether the `sqlite` spans, the `/self` distributed trace and the `/error` exception appear.
- Whether logs arrive (EDOT Node.js has log sending off by default; logs through APM Server are technical preview).
