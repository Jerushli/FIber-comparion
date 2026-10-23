
import test from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeViasatResult,
  isVerifiedViasatResult,
} from "../src/viasatAvailability.js";

const address = "1393 Lincoln Pl, Brooklyn, NY 11213";

test("unverified Viasat candidates are retained but labeled unverified", () => {
  const result = sanitizeViasatResult({
    providerId: "viasat",
    extractionStatus: "candidate_plans_extracted",
    address,
    addressEligibilityVerified: false,
    availabilityStatus: "unknown",
    plans: [
      {
        name: "Essentials",
        monthlyPrice: 39.99,
        addressEligibility: "verified",
      },
    ],
  }, address);

  assert.equal(result.addressEligibilityVerified, false);
  assert.equal(result.availabilityStatus, "unknown");
  assert.equal(result.plans.length, 1);
  assert.equal(result.plans[0].addressEligibility, "unverified");
});

test("a result for a different address cannot be treated as verified", () => {
  const result = {
    providerId: "viasat",
    address: "10 Other Street, Brooklyn, NY 11213",
    addressEligibilityVerified: true,
    availabilityStatus: "available",
    addressEvidence: {
      streetVisible: true,
      zipVisible: true,
    },
    plans: [
      {
        name: "Essentials",
        monthlyPrice: 39.99,
        addressEligibility: "verified",
      },
    ],
  };

  assert.equal(isVerifiedViasatResult(result, address), false);

  const sanitized = sanitizeViasatResult(result, address);
  assert.equal(sanitized.addressEligibilityVerified, false);
  assert.equal(sanitized.availabilityStatus, "unknown");
  assert.equal(sanitized.plans.length, 0);
});

test("verified results require matching address and positive plan prices", () => {
  const result = {
    providerId: "viasat",
    address,
    addressEligibilityVerified: true,
    availabilityStatus: "available",
    addressEvidence: {
      streetVisible: true,
      zipVisible: true,
    },
    plans: [
      {
        name: "Essentials",
        monthlyPrice: 39.99,
        addressEligibility: "verified",
      },
    ],
  };

  assert.equal(isVerifiedViasatResult(result, address), true);

  result.plans[0].monthlyPrice = 0;
  assert.equal(isVerifiedViasatResult(result, address), false);
});
