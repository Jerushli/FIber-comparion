import test from "node:test";
import assert from "node:assert/strict";
import { checkVerizonAvailability, sanitizeVerizonResult } from "../src/verizonAvailability.js";
import { PROVIDERS } from "../src/providers.js";

test("Verizon is address-dependent and not included in Chennai comparison", () => {
  const provider = PROVIDERS.find((item) => item.id === "verizon");
  assert.ok(provider);
  assert.equal(provider.country, "US");
  assert.equal(provider.addressRequired, true);
});

test("No configured data source never returns verified offers", async () => {
  const result = await checkVerizonAvailability({
    address: "1393 Lincoln Pl, Brooklyn, NY 11213",
    requestId: "test", requestedAt: "2026-10-21T00:00:00.000Z"
  });
  assert.equal(result.addressEligibilityVerified, false);
  assert.equal(result.extractionStatus, "data_source_not_configured");
  assert.equal(result.planCount, 0);
  assert.deepEqual(result.plans, []);
});

test("Unverified plans injected by a data source are rejected", () => {
  const result = sanitizeVerizonResult({
    providerId: "verizon", addressEligibilityVerified: false,
    availabilityStatus: "available", plans: [
      { planName: "Marketing offer", speedMbps: 500, monthlyPrice: 50 }
    ]
  }, "Example address");
  assert.equal(result.addressEligibilityVerified, false);
  assert.equal(result.availabilityStatus, "unknown");
  assert.equal(result.planCount, 0);
  assert.deepEqual(result.plans, []);
});

test("Verified structured results remain available to a future approved adapter", () => {
  const result = sanitizeVerizonResult({
    providerId: "verizon", addressEligibilityVerified: true,
    availabilityStatus: "available", extractionStatus: "plans_extracted",
    plans: [{ planName: "Verified example", addressEligibility: "verified", speedMbps: 500, monthlyPrice: 50 }]
  }, "Example address");
  assert.equal(result.addressEligibilityVerified, true);
  assert.equal(result.planCount, 1);
});
