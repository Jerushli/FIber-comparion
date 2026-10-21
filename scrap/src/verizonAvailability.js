/**
 * Verizon Fios address qualification adapter.
 *
 * No approved live address-qualification data source is configured yet.
 * Do not replace this with public marketing-price scraping and do not
 * mark a residence eligible until the provider data confirms the address.
 */
export async function checkVerizonAvailability({ address, requestId, requestedAt }) {
  return {
    providerId: "verizon",
    provider: "Verizon Fios",
    sourceUrl: "https://www.verizon.com/home/internet/fios/",
    requestId,
    requestedAt,
    address,
    fetchedAt: new Date().toISOString(),
    availabilityStatus: "unknown",
    addressEligibilityVerified: false,
    extractionStatus: "data_source_not_configured",
    planCount: 0,
    plans: [],
    priceCacheUsed: false,
    note: "No authorized Verizon address-specific qualification data source is configured. No address-specific plans or prices have been verified."
  };
}

export function isVerifiedVerizonResult(result) {
  return result?.providerId === "verizon" &&
    result?.addressEligibilityVerified === true &&
    result?.availabilityStatus === "available" &&
    Array.isArray(result?.plans) &&
    result.plans.length > 0 &&
    result.plans.every((plan) => plan?.addressEligibility === "verified" &&
      Number.isFinite(plan?.monthlyPrice) && plan.monthlyPrice > 0 &&
      Number.isFinite(plan?.speedMbps) && plan.speedMbps > 0);
}

export function sanitizeVerizonResult(result, address) {
  const safe = result && typeof result === "object" ? { ...result } : {};
  // The adapter must not be able to claim success solely from marketing content.
  if (!isVerifiedVerizonResult(safe)) {
    return {
      ...safe,
      providerId: "verizon",
      provider: "Verizon Fios",
      address,
      addressEligibilityVerified: false,
      availabilityStatus: "unknown",
      extractionStatus: safe.extractionStatus === "data_source_not_configured"
        ? "data_source_not_configured" : "unverified",
      planCount: 0,
      plans: [],
      priceCacheUsed: false,
      note: safe.note || "Address qualification has not been independently verified; no verified plans are returned."
    };
  }
  return { ...safe, providerId: "verizon", provider: "Verizon Fios", address, planCount: safe.plans.length };
}
