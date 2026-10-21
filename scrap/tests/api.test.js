import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { PROVIDERS } from "../src/providers.js";

async function withServer(t, options = {}) {
  const app = createApp(options);
  const server = app.listen(0, "127.0.0.1");

  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));

  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

test("health endpoint returns service and provider information", async (t) => {
  const baseUrl = await withServer(t, {
    scrapeProviderImpl: async () => {
      throw new Error("Scraper should not run for health checks");
    }
  });

  const response = await fetch(`${baseUrl}/health`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.city, "Chennai");
  assert.equal(body.providers.length, PROVIDERS.length);
});

test("providers endpoint returns provider URLs without scraping", async (t) => {
  const baseUrl = await withServer(t, {
    scrapeProviderImpl: async () => {
      throw new Error("Scraper should not run for provider listing");
    }
  });

  const response = await fetch(`${baseUrl}/api/providers`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.city, "Chennai");
  assert.equal(body.providers.length, PROVIDERS.length);
  assert.ok(body.providers.every((provider) =>
    typeof provider.url === "string" &&
    provider.url.startsWith("https://")
  ));
});

test("comparison preserves successful providers when one fails", async (t) => {
  const comparisonProviders = PROVIDERS.filter(
    (provider) => !provider.addressRequired
  );

  const failedProvider = comparisonProviders[0];
  const successfulProviders = comparisonProviders.slice(1);
  const calls = [];

  const baseUrl = await withServer(t, {
    scrapeProviderImpl: async ({ provider }) => {
      calls.push(provider.id);

      if (provider.id === failedProvider.id) {
        throw new Error("Simulated provider failure");
      }

      return {
        providerId: provider.id,
        provider: provider.name,
        extractionStatus: "plans_extracted",
        planCount: 1,
        plans: [{
          providerId: provider.id,
          monthlyPrice: 599,
          speedMbps: 100
        }]
      };
    }
  });

  const response = await fetch(`${baseUrl}/api/compare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });

  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.city, "Chennai");
  assert.equal(body.providersRequested, comparisonProviders.length);
  assert.equal(body.results.length, comparisonProviders.length);
  assert.equal(body.liveFetchPolicy, "fresh_scrape_on_every_request");
  assert.equal(body.priceCacheUsed, false);

  assert.equal(calls.length, comparisonProviders.length);
  assert.equal(new Set(calls).size, comparisonProviders.length);

  const failedResult = body.results.find(
    (result) => result.providerId === failedProvider.id
  );

  assert.equal(failedResult.extractionStatus, "failed");
  assert.deepEqual(failedResult.plans, []);
  assert.match(failedResult.error, /Simulated provider failure/);

  for (const provider of successfulProviders) {
    const result = body.results.find(
      (item) => item.providerId === provider.id
    );

    assert.equal(result.extractionStatus, "plans_extracted");
    assert.equal(result.planCount, 1);
    assert.equal(result.plans[0].monthlyPrice, 599);
  }
});

test("logs endpoint clamps requested limits to 200", async (t) => {
  let receivedLimit;

  const baseUrl = await withServer(t, {
    getRecentLogsImpl: (limit) => {
      receivedLimit = limit;
      return [];
    },
    scrapeProviderImpl: async () => []
  });

  const response = await fetch(`${baseUrl}/api/logs?limit=9999`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(receivedLimit, 200);
  assert.deepEqual(body.logs, []);
});

test("AT&T validation block remains an unverified lookup", async (t) => {
  const baseUrl = await withServer(t, {
    scrapeAttPlansImpl: async () => ({ extractionStatus: "no_plans_detected", plans: [] }),
    checkAttAvailabilityImpl: async ({ address }) => ({
      providerId: "att",
      address,
      httpStatus: 200,
      validationHttpStatus: 403,
      availabilityStatus: "unknown",
      addressEligibilityVerified: false,
      extractionStatus: "blocked",
      planCount: 0,
      plans: [],
      priceCacheUsed: false
    })
  });

  const response = await fetch(`${baseUrl}/api/att/availability`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: "1393 Lincoln Pl, Brooklyn, NY 11213" })
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.result.validationHttpStatus, 403);
  assert.equal(body.result.availabilityStatus, "unknown");
  assert.equal(body.result.addressEligibilityVerified, false);
  assert.equal(body.result.extractionStatus, "blocked");
  assert.deepEqual(body.result.plans, []);
});

// Autocomplete regression tests: no external AT&T requests required.
import { findExactAttSuggestion, waitForExactAttSuggestion } from "../src/attAvailability.js";

test("AT&T address matcher handles capitalization and punctuation but not wrong streets", () => {
  assert.equal(findExactAttSuggestion([
    "1600 Pennsylvania Ave NW, Washington, DC 20500",
    "1393 LINCOLN PL BROOKLYN NY 11213"
  ], "1393 Lincoln Pl, Brooklyn, NY 11213"), 1);
  assert.equal(findExactAttSuggestion([
    "1394 Lincoln Pl, Brooklyn, NY 11213"
  ], "1393 Lincoln Pl, Brooklyn, NY 11213"), -1);
});

test("AT&T autocomplete waits beyond a stale first suggestion", async () => {
  let calls = 0;
  const suggestions = { allTextContents: async () => {
    calls += 1;
    return calls < 3
      ? ["1600 Pennsylvania Ave NW, Washington, DC 20500"]
      : ["1393 Lincoln Pl, Brooklyn, NY 11213"];
  }};
  const result = await waitForExactAttSuggestion(
    suggestions, "1393 Lincoln Pl, Brooklyn, NY 11213",
    { timeoutMs: 1000, intervalMs: 0, sleep: async () => {} }
  );
  assert.equal(result.index, 0);
  assert.equal(calls, 3);
});

test("AT&T autocomplete never selects a different address on timeout", async () => {
  let clock = 0;
  const result = await waitForExactAttSuggestion(
    { allTextContents: async () => ["1600 Pennsylvania Ave NW, Washington, DC 20500"] },
    "1393 Lincoln Pl, Brooklyn, NY 11213",
    { timeoutMs: 10, now: () => clock, sleep: async () => { clock += 10; } }
  );
  assert.equal(result.index, -1);
});


test("blocked AT&T lookup offers unverified public plans separately", async (t) => {
  let fallbackCalls = 0;
  const baseUrl = await withServer(t, {
    checkAttAvailabilityImpl: async ({ address }) => ({
      providerId: "att", address, extractionStatus: "blocked",
      validationHttpStatus: 403, availabilityStatus: "unknown",
      addressEligibilityVerified: false, planCount: 0, plans: []
    }),
    scrapeAttPlansImpl: async () => {
      fallbackCalls += 1;
      return {
        extractionStatus: "plans_extracted", sourceUrl: "https://www.att.com/internet/",
        plans: [{ planName: "Public test offer", monthlyPrice: 55, currency: "USD" }]
      };
    }
  });
  const response = await fetch(`${baseUrl}/api/att/availability`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: "1393 Lincoln Pl, Brooklyn, NY 11213" })
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(fallbackCalls, 1);
  assert.equal(body.result.validationHttpStatus, 403);
  assert.equal(body.result.availabilityStatus, "unknown");
  assert.equal(body.result.planCount, 0);
  assert.equal(body.publicOffers.plans[0].addressEligibility, "unverified");
  assert.equal(body.publicOffers.addressEligibilityVerified, false);
});

test("public offer fallback failure does not hide blocked validation", async (t) => {
  const baseUrl = await withServer(t, {
    checkAttAvailabilityImpl: async () => ({ extractionStatus: "blocked", validationHttpStatus: 403,
      availabilityStatus: "unknown", addressEligibilityVerified: false, plans: [], planCount: 0 }),
    scrapeAttPlansImpl: async () => { throw new Error("Unavailable public source"); }
  });
  const response = await fetch(`${baseUrl}/api/att/availability`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: "1393 Lincoln Pl, Brooklyn, NY 11213" })
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.result.validationHttpStatus, 403);
  assert.equal(body.publicOffers.extractionStatus, "failed");
  assert.deepEqual(body.publicOffers.plans, []);
});

test("public fallback is not fetched if address check is not blocked", async (t) => {
  let fallbackCalls = 0;
  const baseUrl = await withServer(t, {
    checkAttAvailabilityImpl: async () => ({ extractionStatus: "plans_extracted",
      availabilityStatus: "unknown", addressEligibilityVerified: false,
      plans: [{ planName: "Observed", addressEligibility: "unverified" }], planCount: 1 }),
    scrapeAttPlansImpl: async () => { fallbackCalls += 1; return { plans: [] }; }
  });
  const response = await fetch(`${baseUrl}/api/att/availability`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: "1393 Lincoln Pl, Brooklyn, NY 11213" })
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(fallbackCalls, 0);
  assert.equal(body.publicOffers, null);
});
