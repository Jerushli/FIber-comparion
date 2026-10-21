
const API_URL = "https://www.internetproviders.ai/api/availability/";

export async function getAddressCoverage({ address }) {
  const requestedAt = new Date().toISOString();

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({ address }),
    signal: AbortSignal.timeout(20000)
  });

  if (!response.ok) {
    throw new Error(
      `Coverage service returned HTTP ${response.status}.`
    );
  }

  const payload = await response.json();

  if (payload.success !== true || !payload.data) {
    throw new Error("Coverage service returned an invalid response.");
  }

  const data = payload.data;

  // Return coverage estimates only. Do not treat these as
  // confirmed service eligibility or current plan prices.
  const providers = (data.providers || []).map((provider) => ({
    providerId: provider.providerId,
    brandName: provider.brandName,
    technology: provider.technology,
    technologyDetail: provider.technologyDetail,
    maxDownloadMbps: provider.maxDownload,
    maxUploadMbps: provider.maxUpload,
    lowLatency: provider.lowLatency,
    reportedLocationCount: provider.locationCount
  }));

  return {
    source: "InternetProviders.ai",
    requestedAt,
    fetchedAt: new Date().toISOString(),
    coverageBasis: data.coverageSample?.basis ?? "not reported",
    location: {
      city: data.location?.city ?? null,
      state: data.location?.state ?? null,
      zip: data.location?.zip ?? null
    },
    resultType: "estimated_coverage",
    addressAvailabilityVerified: false,
    currentPlanPricesIncluded: false,
    providers,
    summary: data.summary ?? null,
    note:
      "Coverage and speeds are provider-reported estimates. " +
      "They do not confirm that service is orderable at this exact address. " +
      "Current plan prices were not returned by this endpoint."
  };
}
