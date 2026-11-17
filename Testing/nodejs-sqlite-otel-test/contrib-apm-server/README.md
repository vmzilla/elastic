# contrib-apm-server

Express + SQLite app instrumented with the **upstream (contrib) OpenTelemetry Node.js SDK**. It sends traces, metrics and logs over OTLP/HTTP (protobuf) **directly to an Elastic APM Server** (Elastic Cloud APM endpoint, or a self-managed / Fleet-managed APM Server).

```
app (contrib OTel SDK) --OTLP/HTTP protobuf--> APM Server --> Elasticsearch   (data translated to ECS, traces-apm* / metrics-apm* / logs-apm*)
```

Support note: the contrib SDK is community-supported; Elastic supports the data from the point it reaches Elastic. For EDOT SDKs use the `edot-collector-es` folder instead (EDOT SDKs are not supported directly against APM Server).

## What you need to change

Only two values in **`.env`**:

| Variable | Replace with |
|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Your APM Server URL. Elastic Cloud: `https://<id>.apm.<region>.<csp>.cloud.es.io:443`. Self-managed: `https://<host>:8200` (or `http://` if the listener has no TLS). |
| `OTEL_EXPORTER_OTLP_HEADERS` | `"Authorization=Bearer <your APM secret token>"`, or `"Authorization=ApiKey <your APM API key>"` if API key auth is enabled. Keep the quotes, the value contains a space. |

Everything else in `.env` can stay (service name `sqlite-contrib-to-apm`, `http/protobuf`, `otlp` exporters for all three signals).

The committed `.env` holds placeholders. After filling it in, do not commit the real values (tip: `git update-index --skip-worktree .env`).

## Prerequisites

- Node.js 20.6 or later (needed for `node --env-file`). Tested on v20.20.2.
- A C/C++ build toolchain is not normally needed (`better-sqlite3` ships prebuilt binaries for common platforms).
- Network access from this machine to the APM Server URL.

## Deploy and run

```bash
cd contrib-apm-server
# 1. edit .env: endpoint and secret token (see above)
npm install
npm start                                   # node --env-file=.env --require ./tracing.js app.js, listens on :3000 (override with PORT=3100 npm start)
./traffic.sh http://localhost:3000 5        # generates requests: OK, 404, 500, slow, distributed trace
```

Stop with Ctrl+C. On SIGINT/SIGTERM the app flushes queued telemetry before exiting.

Run without telemetry for comparison: `npm run start:plain`.

## How the app is instrumented (what was changed)

1. **`tracing.js`** (new) starts the contrib SDK before the app code:
   ```js
   const sdk = new NodeSDK({
     instrumentations: [getNodeAutoInstrumentations({ '@opentelemetry/instrumentation-fs': { enabled: false } })],
   });
   sdk.start();
   global.__otelShutdown = () => sdk.shutdown();
   ```
   Exporters are not built in code: with no arguments `NodeSDK` reads the `OTEL_*` variables from `.env` (`OTEL_TRACES_EXPORTER=otlp`, `OTEL_METRICS_EXPORTER=otlp`, `OTEL_LOGS_EXPORTER=otlp`, endpoint, headers, protocol) and appends `/v1/traces`, `/v1/metrics`, `/v1/logs` to the endpoint.
2. **`package.json`**: dependencies `@opentelemetry/sdk-node`, `@opentelemetry/auto-instrumentations-node`, `@opentelemetry/api` (plus exporter and SDK packages), and the start script `node --env-file=.env --require ./tracing.js app.js`.
3. **`app.js`**: only the `shutdown()` function changed, to `await global.__otelShutdown()` so spans, metrics and logs are flushed before `process.exit`.
4. Already in the app: a manual `sqlite <op>` span around DB calls (`@opentelemetry/api`; better-sqlite3 has no auto-instrumentation) and pino logging (trace ids are added to log lines, and logs are sent over OTLP).

## Verify

Kibana: Applications > Service inventory > **`sqlite-contrib-to-apm`** (set the time picker to the last 15 minutes or more). Look at the Transactions, Dependencies, Logs and Metrics tabs.

Discover / Dev Tools: documents are in `traces-apm*`, `metrics-apm*`, `logs-apm*`:
```
GET traces-apm*/_count
{ "query": { "term": { "service.name": "sqlite-contrib-to-apm" } } }
```
Expect `agent.name: opentelemetry/nodejs`. On this path APM Server translates OTLP to ECS, so custom attributes appear under `labels.*`.

## Troubleshooting

| Symptom | Check |
|---|---|
| Nothing in Kibana | Time range; right deployment; Discover query on `traces-apm*`. Run with `OTEL_LOG_LEVEL=debug npm start` and look for export errors. |
| `401` / `403` in debug output | Wrong or missing secret token or API key; header must be `Authorization=Bearer <token>` (note the space). |
| `ECONNREFUSED` / `ENOTFOUND` / TLS errors | Endpoint typo; `https://` vs `http://`; a load balancer or proxy that does not pass the traffic; certificate not trusted. |
| `400` | APM Server only accepts protobuf OTLP; keep `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf` (never `http/json`). |
| Connectivity probe | `curl -i -X POST "<endpoint>/v1/traces" -H "content-type: application/x-protobuf" -H "Authorization: Bearer <token>" --data-binary ''` should return `200`. |
| Behind a load balancer | Prefer OTLP/HTTP; an L4 (TCP) balancer is preferred over L7 because APM Server serves HTTP and gRPC on one port. |

## Files

| File | Purpose |
|---|---|
| `.env` | endpoint, secret token and OTel settings (placeholders committed) |
| `tracing.js` | contrib SDK bootstrap |
| `app.js` | Express + SQLite app (endpoints: `/health`, `/items`, `/items/:id`, `POST /items`, `DELETE /items/:id`, `POST /seed?n=10`, `/slow?ms=1000`, `/error`, `/self`) |
| `traffic.sh` | request generator: `./traffic.sh [base_url] [rounds]` |
| `package.json`, `package-lock.json` | dependencies and scripts |
