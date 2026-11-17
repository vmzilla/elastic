# edot-collector-es

Express + SQLite app instrumented with the **EDOT Node.js SDK**. The app sends OTLP to an **Elastic Agent running in OTel mode (the EDOT Collector) as a gateway**, which enriches the data and writes it to Elasticsearch. This is the supported path for EDOT SDKs on self-managed Elastic and on Elastic Cloud Hosted when you want a Collector between the app and Elasticsearch.

```
app (EDOT Node.js) --OTLP/HTTP :4318--> Elastic Agent (OTel mode, gateway, Docker) --elasticsearch exporter (otel mapping)--> Elasticsearch
```

Target stack: 9.4.x with Elastic Agent 9.4.2 (`elasticapm` processor and connector are GA from Agent 9.2). For Elastic Stack 8.18 / 8.19 the pipeline differs (`elastictrace` processor); use the sample for your stack version from the Elastic docs.

## What you need to change

Only two values in **`collector.env`**:

| Variable | Replace with |
|---|---|
| `ELASTIC_ENDPOINT` | Your **Elasticsearch** endpoint (not the APM URL): `https://<deployment>.es.<region>.<csp>.cloud.es.io` (self-managed: `https://<host>:9200`). |
| `ELASTIC_API_KEY` | An Elasticsearch API key, the `encoded` value from `POST /_security/api_key`. |

Leave `sdk.env` as is when the Collector runs on the same machine. Optionally set `COLLECTOR_IMAGE` in `collector.env` to match your Stack version.

The committed env files hold placeholders. After filling in `collector.env`, do not commit the real values (tip: `git update-index --skip-worktree collector.env`).

### API key

Create a key for the Collector in Dev Tools. Use the narrowest privileges that work: the exporter writes to the `traces-*`, `metrics-*` and `logs-*` data streams (`auto_configure`, `create_doc`, `create_index` on those patterns), plus `monitor` on the cluster is useful. Example:
```
POST /_security/api_key
{
  "name": "edot-gateway",
  "expiration": "30d",
  "role_descriptors": {
    "edot_writer": {
      "cluster": ["monitor"],
      "indices": [{
        "names": ["traces-*", "metrics-*", "logs-*"],
        "privileges": ["auto_configure", "create_doc", "create_index"]
      }]
    }
  }
}
```
(This narrow role was not the one used during testing; a broad key was used there. If data does not arrive with a narrow key, check the Collector log for `security_exception` and add the missing privilege.)

## Prerequisites

- Node.js 20.6 or later (`node --env-file`). EDOT Node.js 1.20.1 declares `node: ^18.19.0 || >=20.6.0`. Tested on v20.20.2.
- Docker with Compose v2 (to run the Elastic Agent gateway).
- Ports 4317 and 4318 free on the host.
- This machine can reach the Elasticsearch endpoint.

## Deploy and run

```bash
cd edot-collector-es

# 1. edit collector.env: ELASTIC_ENDPOINT and ELASTIC_API_KEY
# 2. start the gateway (Elastic Agent in OTel mode)
npm run collector:up            # = docker compose --env-file collector.env up -d  (first run pulls the image)
npm run collector:logs          # wait for "Everything is ready. Begin running and processing data."

# 3. start the instrumented app
npm install
npm start                       # node --env-file=sdk.env --import @elastic/opentelemetry-node app.js, listens on :3000 (PORT=3100 npm start to change)
./traffic.sh http://localhost:3000 5

# 4. stop
npm run collector:down
```

Run the app without telemetry for comparison: `npm run start:plain`.

## How the app is instrumented (what was changed)

There is **no EDOT-specific code in `app.js`**. The instrumentation is the start command plus the settings file:

1. **`package.json`**: dependency `@elastic/opentelemetry-node`, start script
   `node --env-file=sdk.env --import @elastic/opentelemetry-node app.js`.
   `--import` loads EDOT before the application modules, so it can auto-instrument Express, HTTP, undici and pino.
2. **`sdk.env`**:
   ```
   OTEL_SERVICE_NAME=sqlite-edot-to-collector
   OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318   # the gateway
   OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
   OTEL_RESOURCE_ATTRIBUTES=deployment.environment.name=test,service.version=1.0.0
   ELASTIC_OTEL_NODE_ENABLE_LOG_SENDING=true           # EDOT Node.js sends pino logs only when enabled
   ```
   No auth header is set because the local gateway has no auth.
3. Already in the app: a manual `sqlite <op>` span around DB calls (`@opentelemetry/api`) and pino logging (trace ids added to log lines). The `global.__otelShutdown` check in `shutdown()` is a leftover from the contrib version and does nothing with EDOT.

## How the gateway is deployed and configured

**`compose.yml`** runs `docker.elastic.co/elastic-agent/elastic-agent:9.4.2` (override with `COLLECTOR_IMAGE`) with `ELASTIC_AGENT_OTEL=true`, which starts Elastic Agent as an EDOT Collector. It runs `--config /etc/otelcol-config.yml` (the mounted `otel-collector-config.yml`), publishes 4317 (OTLP/gRPC) and 4318 (OTLP/HTTP), and passes `ELASTIC_ENDPOINT` and `ELASTIC_API_KEY` from `collector.env` as environment variables.

**`otel-collector-config.yml`** (based on the 9.4 `gateway.yml` sample in `elastic/elastic-agent`):

| Pipeline | Receivers | Processors | Exporters |
|---|---|---|---|
| `traces` | `otlp` | `batch`, `elasticapm` | `debug`, `elasticapm` (connector), `elasticsearch/otel` |
| `logs` | `otlp` | `batch` | `debug`, `elasticapm`, `elasticsearch/otel` |
| `metrics` | `otlp` | `batch/metrics` | `debug`, `elasticsearch/otel` |
| `metrics/aggregated-otel-metrics` | `elasticapm` (connector) | none | `debug`, `elasticsearch/otel` |

- `otlp` receiver: gRPC on 4317 and HTTP on 4318.
- `elasticapm` processor: enriches traces so the Elastic APM UIs work.
- `elasticapm` connector: generates the pre-aggregated APM metrics from traces (the `*.1m.otel` metrics data streams).
- `elasticsearch/otel` exporter: `endpoints: [${env:ELASTIC_ENDPOINT}]`, `api_key: ${env:ELASTIC_API_KEY}`, `mapping.mode: otel` (keeps OTel attribute names, no ECS translation).
- `debug` exporter prints what the Collector handles; remove it from the config once the test works.

No TLS or authentication is configured between app and gateway (local test). Do not expose 4317/4318 beyond localhost. For real deployments add TLS and the `apikeyauth` extension, see the Elastic docs on the gateway configuration.

## Verify

Kibana: Applications > Service inventory > **`sqlite-edot-to-collector`** (time picker: last 15 minutes or more).

Dev Tools: data lands in OTel-native data streams:
```
GET traces-*/_count
{ "query": { "term": { "resource.attributes.service.name": "sqlite-edot-to-collector" } } }
```
Expect `traces-generic.otel-default`, `logs-generic.otel-default`, `metrics-generic.otel-default` and the APM metric streams `metrics-service_transaction.1m.otel-default`, `metrics-transaction.1m.otel-default`, `metrics-service_destination.1m.otel-default`, `metrics-service_summary.1m.otel-default`. Field names are OTel names, not the `labels.*` of the APM Server path (compare with `../contrib-apm-server`).

## Troubleshooting

| Symptom | Check |
|---|---|
| Collector exits or does not become ready | `npm run collector:logs`; config typos; `docker compose --env-file collector.env config` shows the resolved config. |
| `bulk indexer flush error`, `Exporting failed. Dropping data` in the Collector log | Wrong `ELASTIC_ENDPOINT`, unreachable cluster, or API key missing privileges (`security_exception`). |
| Collector log shows no incoming data | App not started with `--import`; `OTEL_EXPORTER_OTLP_ENDPOINT` not `http://localhost:4318`; port 4318 in use. |
| App logs but no logs in Elasticsearch | `ELASTIC_OTEL_NODE_ENABLE_LOG_SENDING=true` must be set in `sdk.env`. |
| `MetadataLookupWarning` in app output | Harmless: cloud resource detectors cannot reach a cloud metadata service. |
| Verbose SDK output | `OTEL_LOG_LEVEL=verbose npm start` (look for `start Elastic Distribution of OpenTelemetry Node.js`). |

## Files

| File | Purpose |
|---|---|
| `collector.env` | Elasticsearch endpoint, API key, Agent image (placeholders committed) |
| `sdk.env` | app-side OTel settings |
| `compose.yml` | runs the Elastic Agent gateway in Docker |
| `otel-collector-config.yml` | gateway pipelines |
| `app.js`, `traffic.sh` | the app and a request generator (`./traffic.sh [base_url] [rounds]`) |
| `package.json`, `package-lock.json` | dependencies and scripts |
