
import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { PROVIDERS } from "./providers.js";
import { scrapeProvider } from "./scrape.js";
import { checkAttAvailability } from "./attAvailability.js";
import { scrapeAttPlans } from "./attPlans.js";
import { getAddressCoverage } from "./addressCoverage.js";
import { getRecentLogs } from "./db.js";

export function createApp({
  providers = PROVIDERS,
  scrapeProviderImpl = scrapeProvider,
  checkAttAvailabilityImpl = checkAttAvailability,
  scrapeAttPlansImpl = scrapeAttPlans,
  getAddressCoverageImpl = getAddressCoverage,
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
    providers: providers.map(
      ({ id, name, city, url, addressRequired, country }) => ({
        id,
        name,
        city,
        url,
        ...(addressRequired ? { addressRequired: true } : {}),
        ...(country ? { country } : {})
      })
    )
  }));

  // Fresh public AT&T offer fetch. Not address-specific.
  app.post("/api/att/plans", async (_req, res) => {
    const requestId = randomUUID();
    const requestedAt = new Date().toISOString();

    try {
      const result = await scrapeAttPlansImpl({
        requestId,
        requestedAt
      });

      return res.json({
        requestId,
        requestedAt,
        completedAt: new Date().toISOString(),
        liveFetchPolicy: "fresh_scrape_on_every_request",
        priceCacheUsed: false,
        result
      });
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : String(error);

      console.error(`[att-plans] ${requestId} failed:`, message);

      return res.status(502).json({
        requestId,
        providerId: "att",
        extractionStatus: "failed",
        availabilityStatus: "not_checked",
        planCount: 0,
        plans: [],
        priceCacheUsed: false,
        error: message
      });
    }
  });

  // Free coverage estimates for a US address.
  // These are not confirmed address-level service results.
  app.post("/api/address-coverage", async (req, res) => {
    const address = typeof req.body?.address === "string"
      ? req.body.address.trim()
      : "";

    if (!address || address.length < 8 || address.length > 300) {
      return res.status(400).json({
        error: "Provide a valid US address in the address field."
      });
    }

    const requestId = randomUUID();
    const requestedAt = new Date().toISOString();

    try {
      const result = await getAddressCoverageImpl({ address });

      return res.json({
        requestId,
        requestedAt,
        completedAt: new Date().toISOString(),
        liveFetchPolicy: "fresh_coverage_request_on_every_call",
        priceCacheUsed: false,
        result
      });
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : String(error);

      console.error(
        `[address-coverage] ${requestId} failed:`,
        message
      );

      return res.status(502).json({
        requestId,
        resultType: "estimated_coverage",
        addressAvailabilityVerified: false,
        currentPlanPricesIncluded: false,
        error: message
      });
    }
  });

  // AT&T address-specific browser lookup.
  app.post("/api/att/availability", async (req, res) => {
    const address = typeof req.body?.address === "string"
      ? req.body.address.trim()
      : "";

    if (!address || address.length < 8 || address.length > 300) {
      return res.status(400).json({
        error: "Provide a valid full US street address in the address field."
      });
    }

    const requestId = randomUUID();
    const requestedAt = new Date().toISOString();

    try {
      const result = await checkAttAvailabilityImpl({
        address,
        requestId,
        requestedAt
      });

      // Public offers are separate from address eligibility. A denied address
      // lookup must NEVER be converted into an available service result.
      let publicOffers = null;
      if (result.extractionStatus === "blocked" || result.extractionStatus === "address_not_matched") {
        try {
          const publicResult = await scrapeAttPlansImpl({ requestId, requestedAt });
          const offers = Array.isArray(publicResult?.plans) ? publicResult.plans : [];
          publicOffers = {
            providerId: "att",
            sourceUrl: publicResult?.sourceUrl || "https://www.att.com/internet/",
            fetchedAt: publicResult?.fetchedAt || new Date().toISOString(),
            extractionStatus: publicResult?.extractionStatus || "unknown",
            plans: offers.map((plan) => ({ ...plan, addressEligibility: "unverified" })),
            planCount: offers.length,
            addressEligibilityVerified: false,
            note: "Public AT&T offers only. Prices, promotions, and service at this address are NOT confirmed."
          };
        } catch (publicError) {
          const message = publicError instanceof Error ? publicError.message : String(publicError);
          console.warn(`[att-public-fallback] ${requestId}: ${message}`);
          publicOffers = {
            extractionStatus: "failed",
            plans: [], planCount: 0,
            addressEligibilityVerified: false,
            note: "Public offers could not be retrieved on this request. Address availability remains unverified."
          };
        }
      }

      return res.json({
        requestId,
        requestedAt,
        completedAt: new Date().toISOString(),
        liveFetchPolicy: "fresh_address_lookup_on_every_request",
        priceCacheUsed: false,
        result,
        publicOffers
      });
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : String(error);

      console.error(
        `[att-availability] ${requestId} failed:`,
        message
      );

      return res.status(502).json({
        requestId,
        providerId: "att",
        extractionStatus: "failed",
        availabilityStatus: "unknown",
        planCount: 0,
        plans: [],
        priceCacheUsed: false,
        error: message
      });
    }
  });

  // Chennai provider comparison. AT&T stays excluded.
  app.post("/api/compare", async (_req, res) => {
    const requestId = randomUUID();
    const requestedAt = new Date().toISOString();
    const comparisonStarted = Date.now();

    const comparisonProviders = providers.filter(
      (provider) => !provider.addressRequired
    );

    try {
      const results = await Promise.all(
        comparisonProviders.map(async (provider) => {
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
        results.map(
          (result) =>
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
        providersRequested: comparisonProviders.length,
        results,
        nextStep:
          "Use provider duration measurements to identify scraping bottlenecks."
      });
    } catch (error) {
      console.error(
        `[compare] ${requestId} unexpected error:`,
        error
      );

      if (res.headersSent) return res.end();

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
