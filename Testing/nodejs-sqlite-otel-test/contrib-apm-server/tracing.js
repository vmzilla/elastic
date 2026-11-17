'use strict';

// Upstream (contrib) OpenTelemetry Node.js SDK bootstrap. Loaded before the app with
//   node --env-file=.env --require ./tracing.js app.js
//
// Everything is configured from environment variables (see .env.example), so the SDK picks the
// OTLP exporters itself:
//   OTEL_EXPORTER_OTLP_ENDPOINT   APM Server URL, the SDK appends /v1/traces, /v1/metrics, /v1/logs
//   OTEL_EXPORTER_OTLP_HEADERS    Authorization=Bearer <APM secret token>
//   OTEL_EXPORTER_OTLP_PROTOCOL   http/protobuf (APM Server accepts protobuf only, not JSON)
//   OTEL_{TRACES,METRICS,LOGS}_EXPORTER=otlp
//   OTEL_SERVICE_NAME             service name shown in Kibana

const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');

const sdk = new NodeSDK({
  instrumentations: [
    getNodeAutoInstrumentations({
      // fs spans are very noisy for a small app
      '@opentelemetry/instrumentation-fs': { enabled: false },
    }),
  ],
});

sdk.start();

// app.js calls this on SIGINT/SIGTERM so queued spans, metrics and logs are flushed before exit.
global.__otelShutdown = () => sdk.shutdown().catch((err) => console.error('OTel shutdown error', err));

console.log(
  `[tracing] contrib OpenTelemetry SDK started, service=${process.env.OTEL_SERVICE_NAME || 'unknown_service'}, ` +
    `endpoint=${process.env.OTEL_EXPORTER_OTLP_ENDPOINT || '(not set)'}`
);
