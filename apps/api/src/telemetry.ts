// OpenTelemetry to Application Insights (architecture §9, todo-later H04).
//
// Preloaded before anything else, so the instrumentations can hook http,
// fetch (undici), tedious (Azure SQL) and pino:
//
//   node --import ./dist/telemetry.js dist/main.js
//
// Does nothing without APPLICATIONINSIGHTS_CONNECTION_STRING.
//
// What is sent: requests (method, route, status, duration), dependencies (SQL
// statements without parameter values, calls to Azure OpenAI without bodies),
// exceptions and the metrics of agent runs. Never request or response bodies,
// headers or tokens (architecture §9.6). Logs stay on stdout, which Container
// Apps sends to Log Analytics; pino only gets trace ids for correlation.

import { useAzureMonitor } from "@azure/monitor-opentelemetry";
import { metrics, trace } from "@opentelemetry/api";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { PinoInstrumentation } from "@opentelemetry/instrumentation-pino";
import { TediousInstrumentation } from "@opentelemetry/instrumentation-tedious";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import type { IncomingMessage } from "node:http";

const PROBES = /^\/api\/(health|ready)(\?|$)/;

const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
if (connectionString) {
  process.env.OTEL_SERVICE_NAME ??= "hermes-helfer-api";
  const production = process.env.NODE_ENV === "production";
  const clientId = process.env.AZURE_CLIENT_ID;
  // In Azure, ingestion uses the managed identity; the Application Insights
  // resource has local (key-based) authentication switched off.
  const credential = production
    ? new (await import("@azure/identity")).ManagedIdentityCredential(clientId ? { clientId } : {})
    : undefined;

  // The distro passes these options on to the http instrumentation; its own type only shows `enabled`.
  const http = {
    enabled: true,
    ignoreIncomingRequestHook: (req: IncomingMessage) => PROBES.test(req.url ?? ""),
  };

  useAzureMonitor({
    azureMonitorExporterOptions: { connectionString, ...(credential ? { credential } : {}) },
    enableLiveMetrics: false,
    instrumentationOptions: {
      http,
      azureSdk: { enabled: true },
      mongoDb: { enabled: false },
      mySql: { enabled: false },
      postgreSql: { enabled: false },
      redis: { enabled: false },
      redis4: { enabled: false },
      bunyan: { enabled: false },
      winston: { enabled: false },
    },
  });
  registerInstrumentations({
    tracerProvider: trace.getTracerProvider(),
    meterProvider: metrics.getMeterProvider(),
    instrumentations: [
      new UndiciInstrumentation(),
      new TediousInstrumentation(),
      new PinoInstrumentation({ disableLogSending: true }),
    ],
  });
}
