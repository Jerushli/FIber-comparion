
import { chromium } from "playwright";
import { logScrapeRun } from "./db.js";

const ATT_PLANS_URL = "https://www.att.com/internet/fiber/";

function extractPlansFromText(text) {
  const plans = [];
  const seen = new Set();

  // Match an advertised speed and price in the same offer text.
  // Examples: "1 GIG internet for $70/mo" or "500 Mbps internet for $60/mo".
  const offerPattern =
    /(?:Get\s+)?(?:unlimited\s+)?(\d+(?:\.\d+)?)\s*(GIG|Gbps|Mbps|Mb)\s+(?:fiber\s+)?internet\s+for\s+\$\s*([\d,]+(?:\.\d{1,2})?)\s*(?:\/\s*mo|per\s+month)\b([^.!?]*[.!?]?)/gi;

  for (const match of text.matchAll(offerPattern)) {
    const speedValue = Number(match[1]);
    const speedUnit = match[2].toLowerCase();
    const monthlyPrice = Number(match[3].replace(/,/g, ""));
    const offerContext = match[0].trim();

    if (
      !Number.isFinite(speedValue) ||
      !Number.isFinite(monthlyPrice) ||
      speedValue <= 0 ||
      monthlyPrice <= 0
    ) {
      continue;
    }

    const speedMbps =
      speedUnit === "mbps" || speedUnit === "mb"
        ? speedValue
        : speedValue * 1000;

    const planName = `AT&T Fiber ${match[1]} ${match[2]}`;
    const key = `${planName}|${monthlyPrice}`;

    if (seen.has(key)) continue;
    seen.add(key);

    // Retain nearby offer wording, such as a first-year price.
    const nearbyText = text.slice(
      Math.max(0, match.index - 100),
      Math.min(text.length, match.index + match[0].length + 180)
    );

    const firstYearOffer = /first\s+year/i.test(nearbyText);

    plans.push({
      providerId: "att",
      planName,
      monthlyPrice,
      currency: "USD",
      speedMbps,
      priceBasis: "advertised_monthly_price",
      promotionalPeriod: firstYearOffer ? "First year" : null,
      conditions: nearbyText
        .replace(/\s+/g, " ")
        .trim(),
      sourceEvidence: offerContext
    });
  }

  return plans;
}

export async function scrapeAttPlans({
  requestId,
  requestedAt
}) {
  const started = Date.now();
  let browser;
  let response;
  let pageTitle = null;
  let pageText = "";

  try {
    browser = await chromium.launch({ headless: true });

    const page = await browser.newPage({
      locale: "en-US",
      viewport: { width: 1440, height: 1000 }
    });

    response = await page.goto(ATT_PLANS_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    if (!response || response.status() >= 400) {
      throw new Error(
        `AT&T plans page returned HTTP ${response?.status() ?? "no response"}.`
      );
    }

    await page.waitForTimeout(3000);

    pageTitle = await page.title();
    pageText = await page.locator("body").innerText();

    const plans = extractPlansFromText(pageText);
    const fetchedAt = new Date().toISOString();
    const durationMs = Date.now() - started;

    logScrapeRun({
      request_id: requestId,
      provider_id: "att",
      provider_name: "AT&T Internet",
      source_url: ATT_PLANS_URL,
      requested_at: requestedAt,
      scraped_at: fetchedAt,
      duration_ms: durationMs,
      http_status: response.status(),
      status: plans.length
        ? "content_received"
        : "thin_or_blocked_content",
      page_title: pageTitle,
      markdown_chars: pageText.length,
      error_message: plans.length
        ? null
        : "Page loaded, but no offers matched the extraction rules."
    });

    return {
      providerId: "att",
      provider: "AT&T Internet",
      sourceUrl: ATT_PLANS_URL,
      fetchedAt,
      durationMs,
      httpStatus: response.status(),
      pageTitle,
      extractionStatus: plans.length
        ? "plans_extracted"
        : "no_plans_detected",
      availabilityStatus: "not_checked",
      planCount: plans.length,
      plans,
      priceCacheUsed: false,
      note: plans.length
        ? "Offers were extracted from the live public page. Prices may be promotional and address-specific availability has not been verified."
        : "The page loaded, but no matching offers were found. No prices were invented."
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);

    logScrapeRun({
      request_id: requestId,
      provider_id: "att",
      provider_name: "AT&T Internet",
      source_url: ATT_PLANS_URL,
      requested_at: requestedAt,
      scraped_at: new Date().toISOString(),
      duration_ms: Date.now() - started,
      http_status: response?.status() ?? null,
      status: "failed",
      page_title: pageTitle,
      markdown_chars: pageText.length,
      error_message: message
    });

    throw error;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}
