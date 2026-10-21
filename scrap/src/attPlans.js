import { chromium } from "playwright";
import { logScrapeRun } from "./db.js";

const ATT_PLANS_URL = "https://www.att.com/internet/fiber/";
const NAVIGATION_TIMEOUT_MS = 60000;
const CONTENT_WAIT_MS = 3500;

function toMbps(amount, unit) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return null;
  return /^(gbps|gig|gigs)$/i.test(unit) ? value * 1000 : value;
}

function makePlan(speedAmount, speedUnit, amount, evidence, heading = "") {
  const speedMbps = toMbps(speedAmount, speedUnit);
  const monthlyPrice = Number(String(amount).replace(/,/g, ""));
  if (!speedMbps || !Number.isFinite(monthlyPrice) || monthlyPrice <= 0) return null;
  const cleanEvidence = String(evidence).replace(/\s+/g, " ").trim().slice(0, 950);
  const cleanHeading = String(heading).replace(/\s+/g, " ").trim();
  return {
    providerId: "att",
    planName: cleanHeading || `AT&T Fiber ${speedMbps >= 1000 ? `${speedMbps / 1000} GIG` : `${speedMbps} Mbps`}`,
    monthlyPrice,
    currency: "USD",
    speedMbps,
    priceBasis: "advertised_monthly_price",
    promotionalPeriod: /\b(?:first year|first 12 months|12[- ]month promo)\b/i.test(cleanEvidence)
      ? "See promotional terms" : null,
    conditions: cleanEvidence,
    sourceEvidence: cleanEvidence,
    addressEligibility: "not_verified",
  };
}

function uniquePlans(plans) {
  const seen = new Set();
  return plans.filter((plan) => {
    if (!plan) return false;
    const key = `${plan.speedMbps}|${plan.monthlyPrice}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => a.speedMbps - b.speedMbps || a.monthlyPrice - b.monthlyPrice);
}

// Accept explicit offer sentences only: do not pair unrelated speed and price snippets.
export function extractPlansFromText(text = "") {
  const source = String(text).replace(/\u00a0/g, " ");
  const results = [];
  const patterns = [
    /(?:get\s+)?(?:unlimited\s+)?(\d+(?:\.\d+)?)\s*(GIG|Gbps|Mbps|Mb)\s+(?:fiber\s+)?internet\s+for\s+\$\s*([\d,]+(?:\.\d{1,2})?)\s*(?:\/\s*(?:mo|month)|per\s+month)\b/gi,
    /(?:AT&T\s+)?(?:fiber\s+)?internet\s+(\d+(?:\.\d+)?)\s*(GIG|Gbps|Mbps|Mb)[^\n.!?]{0,80}?\$\s*([\d,]+(?:\.\d{1,2})?)\s*(?:\/\s*(?:mo|month)|per\s+month)\b/gi,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const start = match.index ?? 0;
      const context = source.slice(Math.max(0, start - 75), Math.min(source.length, start + match[0].length + 120));
      results.push(makePlan(match[1], match[2], match[3], context));
    }
  }
  return uniquePlans(results);
}

// Cards must each have exactly one speed and one monthly price, not combined comparisons.
export function extractPlansFromBlocks(blocks = []) {
  const results = [];
  const speedPattern = /\b(\d+(?:\.\d+)?)\s*(Gbps|GIG|Mbps|Mb)\b/gi;
  const pricePattern = /\$\s*([\d,]+(?:\.\d{1,2})?)\s*(?:\/\s*(?:mo|month)|per\s+month)\b/gi;
  for (const block of blocks) {
    const content = String(block?.text ?? "").replace(/\u00a0/g, " ");
    if (!content || content.length > 950) continue;
    const speeds = [...content.matchAll(speedPattern)]
      .map((m) => toMbps(m[1], m[2])).filter(Boolean);
    const prices = [...content.matchAll(pricePattern)]
      .map((m) => Number(m[1].replace(/,/g, ""))).filter((n) => Number.isFinite(n) && n > 0);
    if (new Set(speeds).size !== 1 || new Set(prices).size !== 1) continue;
    const speed = [...content.matchAll(speedPattern)][0];
    const price = [...content.matchAll(pricePattern)][0];
    results.push(makePlan(speed[1], speed[2], price[1], content, block.heading));
  }
  return uniquePlans(results);
}

export async function scrapeAttPlans({ requestId, requestedAt }) {
  const started = Date.now();
  let browser;
  let response;
  let pageTitle = null;
  let pageText = "";
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      locale: "en-US",
      viewport: { width: 1440, height: 1000 },
    });
    response = await page.goto(ATT_PLANS_URL, {
      waitUntil: "domcontentloaded",
      timeout: NAVIGATION_TIMEOUT_MS,
    });
    if (!response || response.status() >= 400) {
      throw new Error(`AT&T public plans page returned HTTP ${response?.status() ?? "no response"}.`);
    }
    await page.waitForTimeout(CONTENT_WAIT_MS);
    pageTitle = await page.title();
    pageText = await page.locator("body").innerText();

    // Read only visible, bounded offer-like cards in the current DOM.
    const blocks = await page.evaluate(() => {
      const nodes = document.querySelectorAll(
        "main article, main [class*='plan-card'], main [class*='planCard'], main [data-testid*='plan'], main [class*='offer-card'], main [class*='offerCard']"
      );
      return Array.from(nodes).filter((node) => node.getClientRects().length > 0)
        .slice(0, 100).map((node) => ({
          heading: node.querySelector("h1,h2,h3,h4,[role='heading']")?.innerText || "",
          text: (node.innerText || "").slice(0, 951),
        }));
    });

    const plans = uniquePlans([...extractPlansFromBlocks(blocks), ...extractPlansFromText(pageText)]);
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
      status: plans.length ? "content_received" : "thin_or_blocked_content",
      page_title: pageTitle,
      markdown_chars: pageText.length,
      error_message: plans.length ? null : "No unambiguous public monthly-price/speed offers were extracted.",
    });
    return {
      providerId: "att", provider: "AT&T Internet", sourceUrl: ATT_PLANS_URL,
      fetchedAt, durationMs, httpStatus: response.status(), pageTitle,
      extractionStatus: plans.length ? "plans_extracted" : "no_plans_detected",
      availabilityStatus: "not_checked",
      addressEligibilityVerified: false,
      planCount: plans.length, plans, priceCacheUsed: false,
      note: plans.length
        ? "Public page offers only. Promotional conditions may apply; eligibility and pricing at a particular address are not verified."
        : "No clearly matched public plan prices and speeds were found. No prices were inferred.",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logScrapeRun({
      request_id: requestId, provider_id: "att", provider_name: "AT&T Internet",
      source_url: ATT_PLANS_URL, requested_at: requestedAt,
      scraped_at: new Date().toISOString(), duration_ms: Date.now() - started,
      http_status: response?.status() ?? null, status: "failed",
      page_title: pageTitle, markdown_chars: pageText.length, error_message: message,
    });
    throw error;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
