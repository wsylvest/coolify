/**
 * OpenTelemetry Instrumentation for Coolify
 *
 * This file sets up automatic instrumentation for tracing and metrics.
 * It is loaded automatically by Next.js via the instrumentation hook.
 */

export async function register() {
  // Only run instrumentation on the server side
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Check if OpenTelemetry is enabled
    if (process.env.OTEL_ENABLED !== "true") {
      console.log("OpenTelemetry disabled (set OTEL_ENABLED=true to enable)");
      return;
    }

    const { NodeSDK } = await import("@opentelemetry/sdk-node");
    const { getNodeAutoInstrumentations } = await import(
      "@opentelemetry/auto-instrumentations-node"
    );
    const { OTLPTraceExporter } = await import(
      "@opentelemetry/exporter-trace-otlp-http"
    );
    const { OTLPMetricExporter } = await import(
      "@opentelemetry/exporter-metrics-otlp-http"
    );
    const { PeriodicExportingMetricReader } = await import(
      "@opentelemetry/sdk-metrics"
    );
    const { Resource } = await import("@opentelemetry/resources");
    const { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_SERVICE_VERSION } =
      await import("@opentelemetry/semantic-conventions");

    const serviceName = process.env.OTEL_SERVICE_NAME ?? "coolify-next";
    const serviceVersion = process.env.npm_package_version ?? "0.1.0";
    const otlpEndpoint =
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318";

    // Create resource with service info
    const resource = new Resource({
      [SEMRESATTRS_SERVICE_NAME]: serviceName,
      [SEMRESATTRS_SERVICE_VERSION]: serviceVersion,
      "deployment.environment": process.env.NODE_ENV ?? "development",
    });

    // Configure trace exporter
    const traceExporter = new OTLPTraceExporter({
      url: `${otlpEndpoint}/v1/traces`,
    });

    // Configure metric exporter
    const metricExporter = new OTLPMetricExporter({
      url: `${otlpEndpoint}/v1/metrics`,
    });

    const metricReader = new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: 30000, // Export every 30 seconds
    });

    // Initialize the SDK
    const sdk = new NodeSDK({
      resource,
      traceExporter,
      metricReader,
      instrumentations: [
        getNodeAutoInstrumentations({
          // Disable fs instrumentation to reduce noise
          "@opentelemetry/instrumentation-fs": {
            enabled: false,
          },
          // Configure HTTP instrumentation
          "@opentelemetry/instrumentation-http": {
            ignoreIncomingPaths: ["/api/health", "/_next/static", "/favicon.ico"],
          },
        }),
      ],
    });

    sdk.start();

    console.log(`OpenTelemetry initialized for ${serviceName}`);
    console.log(`Exporting traces/metrics to: ${otlpEndpoint}`);

    // Graceful shutdown
    process.on("SIGTERM", () => {
      sdk
        .shutdown()
        .then(() => console.log("OpenTelemetry SDK shut down"))
        .catch((error) => console.error("Error shutting down OpenTelemetry", error));
    });
  }
}
