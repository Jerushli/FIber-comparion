import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { PROVIDERS } from "./providers.js";
import { scrapeProvider } from "./scrape.js";
import { getRecentLogs } from "./db.js";

export function createApp({
  providers = PROVIDERS,
  scrapeProviderImpl = scrapeProvider,
  getRecentLogsImpl = getRecentLogs
} = {}) {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => res.json({
    ok: true,
    service: "chennai-fiber-price-comparator",
    city: "Chennai",
    providers: providers.map(({ id, name }) => ({ id, name })),
    timestamp: new Date().toISOString()
  }));

  app.get("/api/providers", (_req, res) => res.json({
    city: "Chennai",
    providers: providers.map(({ id, name, city, url }) => ({
      id,
      name,
      city,
      url
    }))
  }));

  app.post("/api/compare", async (_req, res) => {
    const requestId = randomUUID();
    const requestedAt = new Date().toISOString();
    const comparisonStarted = Date.now();

    try {
      const results = await Promise.all(
        providers.map(async (provider) => {
          const providerStarted = Date.now();

          try {
            const result = await scrapeProviderImpl({
              provider,
              requestId,
              requestedAt
            });

            return {
              ...result,
              durationMs: Date.now() - providerStarted
            };
          } catch (error) {
            console.error(
              `[compare] ${requestId} ${provider.id} failed:`,
              error
            );

            return {
              providerId: provider.id,
              provider: provider.name,
              extractionStatus: "failed",
              planCount: 0,
              plans: [],
              error: error instanceof Error
                ? error.message
                : String(error),
              durationMs: Date.now() - providerStarted
            };
          }
        })
      );

      const totalDurationMs = Date.now() - comparisonStarted;

      console.log(
        `[compare] ${requestId}: total=${totalDurationMs}ms`,
        results.map((result) =>
          `${result.providerId}=${result.durationMs}ms (${result.extractionStatus})`
        ).join(", ")
      );

      return res.json({
        requestId,
        city: "Chennai",
        requestedAt,
        completedAt: new Date().toISOString(),
        durationMs: totalDurationMs,
        liveFetchPolicy: "fresh_scrape_on_every_request",
        priceCacheUsed: false,
        providersRequested: providers.length,
        results,
        nextStep:
          "Use provider duration measurements to identify scraping bottlenecks."
      });
    } catch (error) {
      console.error(`[compare] ${requestId} unexpected error:`, error);

      if (res.headersSent) {
        return res.end();
      }

      return res.status(500).json({
        error: "Comparison request failed unexpectedly.",
        requestId,
        details: error instanceof Error
          ? error.message
          : String(error)
      });
    }
  });

  app.get("/api/logs", (req, res) => {
    const parsed = Number.parseInt(req.query.limit ?? "50", 10);
    const limit = Number.isFinite(parsed)
      ? Math.max(1, Math.min(parsed, 200))
      : 50;

    res.json({ logs: getRecentLogsImpl(limit) });
  });

  return app;
}
