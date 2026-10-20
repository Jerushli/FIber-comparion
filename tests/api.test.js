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
  const failedProvider = PROVIDERS[0];
  const successfulProviders = PROVIDERS.slice(1);
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
  assert.equal(body.providersRequested, PROVIDERS.length);
  assert.equal(body.results.length, PROVIDERS.length);
  assert.equal(body.liveFetchPolicy, "fresh_scrape_on_every_request");
  assert.equal(body.priceCacheUsed, false);

  assert.equal(calls.length, PROVIDERS.length);
  assert.equal(new Set(calls).size, PROVIDERS.length);

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
