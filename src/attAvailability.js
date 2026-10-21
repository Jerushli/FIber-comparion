
import { chromium } from "playwright";
import { logScrapeRun } from "./db.js";

const ATT_URL = "https://www.att.com/internet/availability/";
const ATT_VALIDATION_PATH =
  "/msapi/salesapi/wireless-sales-eapi/v2/service-address-validation";
const NAVIGATION_TIMEOUT_MS = 60000;
const LOOKUP_WAIT_MS = 6000;

function classifyAvailability(text) {
  if (
    /\b(not available at|isn't available at|is not available at|cannot provide service|can't provide service|not serviceable)\b/i.test(
      text
    )
  ) {
    return "unavailable";
  }

  if (
    /\b(available at your address|available at this address|service is available|choose your plan|select your plan)\b/i.test(
      text
    )
  ) {
    return "available_or_plans_shown";
  }

  return "unknown";
}

// Normalize formatting only; never silently accept a different street address.
export function normalizeAttAddress(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/\b(AVENUE)\b/g, "AVE")
    .replace(/\b(STREET)\b/g, "ST")
    .replace(/\b(PLACE)\b/g, "PL")
    .replace(/\b(ROAD)\b/g, "RD")
    .replace(/\b(BOULEVARD)\b/g, "BLVD")
    .replace(/\b(NORTHWEST)\b/g, "NW")
    .replace(/\b(NORTHEAST)\b/g, "NE")
    .replace(/\b(SOUTHWEST)\b/g, "SW")
    .replace(/\b(SOUTHEAST)\b/g, "SE")
    .replace(/[^A-Z0-9]/g, "");
}

export function findExactAttSuggestion(suggestions, requestedAddress) {
  const expected = normalizeAttAddress(requestedAddress);
  return suggestions.findIndex((text) => normalizeAttAddress(text) === expected);
}

// Browser-page autocomplete may first show old suggestions from the previous input.
// Poll for the expected choice; never choose a near match or another address.
export async function waitForExactAttSuggestion(suggestions, address, options = {}) {
  const timeoutMs = options.timeoutMs ?? 20000;
  const intervalMs = options.intervalMs ?? 250;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const deadline = now() + timeoutMs;
  let lastChoices = [];
  do {
    lastChoices = await suggestions.allTextContents().catch(() => []);
    const index = findExactAttSuggestion(lastChoices, address);
    if (index >= 0) return { index, choices: lastChoices };
    await sleep(intervalMs);
  } while (now() < deadline);
  return { index: -1, choices: lastChoices };
}

async function extractPlanCandidates(page) {
  return page.evaluate(() => {
    const blocks = Array.from(
      document.querySelectorAll(
        "main article, main [class*='plan'], main [data-testid*='plan'], main section"
      )
    );

    const candidates = [];
    const seen = new Set();

    for (const block of blocks) {
      const text = (block.innerText || "")
        .replace(/\s+/g, " ")
        .trim();

      if (!text || text.length > 1600) continue;

      const priceMatch = text.match(
        /\$\s*([\d,]+(?:\.\d{1,2})?)(?:\s*(\/\s*(?:mo|month)|per\s+month))?/i
      );

      const speedMatch = text.match(
        /\b(\d+(?:\.\d+)?)\s*(Gbps|Gig|Mbps)\b/i
      );

      if (!priceMatch || !speedMatch) continue;

      const displayedPrice = Number(
        priceMatch[1].replace(/,/g, "")
      );

      if (!Number.isFinite(displayedPrice) || displayedPrice <= 0) {
        continue;
      }

      const speedValue = Number(speedMatch[1]);
      const speedUnit = speedMatch[2].toLowerCase();

      const speedMbps =
        speedUnit === "mbps" ? speedValue : speedValue * 1000;

      const heading = block.querySelector(
        "h1,h2,h3,h4,[role='heading']"
      );

      const planName = (heading?.innerText || "")
        .replace(/\s+/g, " ")
        .trim();

      const monthlyEvidence =
        /\/\s*(?:mo|month)\b|per\s+month/i.test(priceMatch[0]);

      const key = `${planName}|${displayedPrice}|${speedMbps}`;

      if (seen.has(key)) continue;
      seen.add(key);

      candidates.push({
        providerId: "att",
        planName: planName || "AT&T plan (name not identified)",
        monthlyPrice: monthlyEvidence ? displayedPrice : null,
        displayedPrice,
        currency: "USD",
        priceBasis: monthlyEvidence
          ? "displayed_monthly_price"
          : "displayed_price_period_unverified",
        speedMbps,
        source: "live_browser_render",
        sourceEvidence: {
          matchedPriceText: priceMatch[0],
          matchedSpeedText: speedMatch[0],
          planText: text
        }
      });
    }

    return candidates;
  });
}

export async function checkAttAvailability({
  address,
  requestId,
  requestedAt
}) {
  const started = Date.now();

  let browser;
  let response;
  let pageTitle = null;
  let renderedText = "";
  let validationHttpStatus = null;

  try {
    browser = await chromium.launch({
  headless: false,
  slowMo: 150
});   const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      locale: "en-US"
    });

    const page = await context.newPage();
    page.setDefaultTimeout(20000);

    // Track the address-validation request separately from the
    // main page response. A successful page load does not prove
    // that the availability lookup succeeded.
    page.on("response", (validationResponse) => {
      if (
        validationResponse.url().includes(ATT_VALIDATION_PATH)
      ) {
        validationHttpStatus = validationResponse.status();
      }
    });

    response = await page.goto(ATT_URL, {
      waitUntil: "domcontentloaded",
      timeout: NAVIGATION_TIMEOUT_MS
    });

    if (response && response.status() >= 400) {
      throw new Error(
        `AT&T availability page returned HTTP ${response.status()}.`
      );
    }

    const addressInput = page.locator("#input-addressInput");

    await addressInput.waitFor({ state: "visible" });
    await addressInput.fill(address);

    // Select only an exact address match.
    const suggestions = page.locator(
      "#ulList-addressInput li[role='option']"
    );

    const normalizedAddress = address.replace(/\s+/g, " ").trim();
    const match = await waitForExactAttSuggestion(suggestions, normalizedAddress);
    if (match.index === -1) {
      const fetchedAt = new Date().toISOString();
      const note = "AT&T did not return the exact requested address in autocomplete. No other address was submitted; no address-level availability was checked.";
      logScrapeRun({
        request_id: requestId, provider_id: "att", provider_name: "AT&T Internet",
        source_url: ATT_URL, requested_at: requestedAt, scraped_at: fetchedAt,
        duration_ms: Date.now() - started, http_status: response?.status() ?? null,
        status: "address_not_matched", page_title: await page.title(),
        markdown_chars: 0, error_message: note
      });
      return {
        providerId: "att", provider: "AT&T Internet", sourceUrl: ATT_URL,
        address, fetchedAt, durationMs: Date.now() - started,
        httpStatus: response?.status() ?? null, validationHttpStatus,
        availabilityStatus: "unknown", addressEligibilityVerified: false,
        extractionStatus: "address_not_matched", planCount: 0, plans: [],
        priceCacheUsed: false, note,
        // Diagnostic counts only: no other customer's address is returned.
        suggestionCount: match.choices.length
      };
    }

    await suggestions.nth(match.index).click();
    await page.waitForFunction((expected) => {
      const input = document.querySelector("#input-addressInput");
      const normalize = (value) => String(value || "").toUpperCase()
        .replace(/\bAVENUE\b/g, "AVE")
        .replace(/\bSTREET\b/g, "ST")
        .replace(/\bPLACE\b/g, "PL")
        .replace(/\bROAD\b/g, "RD")
        .replace(/\bBOULEVARD\b/g, "BLVD")
        .replace(/[^A-Z0-9]/g, "");
      return normalize(input?.value) === normalize(expected);
    }, normalizedAddress, { timeout: 10000 });

    const checkButton = page.locator(
      "#Check-availability-btn-7107"
    );

    await checkButton.waitFor({ state: "visible" });
    await checkButton.click();

    // Give the normal page flow time to complete.
    await page.waitForTimeout(LOOKUP_WAIT_MS);
    // Allow ordinary navigations after submitting the form to settle.
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});

    renderedText = await page.locator("body").innerText();
    pageTitle = await page.title();
    const fetchedAt = new Date().toISOString();
    const durationMs = Date.now() - started;

    const validationBlocked =
      validationHttpStatus !== null &&
      validationHttpStatus >= 400;

    // Visible marketing offers are observations, NOT verified address offers.
    const observedPlans = validationBlocked ? [] : await extractPlanCandidates(page);
    const plans = observedPlans.map((plan) => ({
      ...plan,
      addressEligibility: "unverified"
    }));

    // A successful page load or validation HTTP response is not proof of
    // address serviceability. Do not assert eligible/ineligible from text.
    const availabilityStatus = "unknown";
    const pageMessageStatus = validationBlocked
      ? "unknown"
      : classifyAvailability(renderedText);

    let extractionStatus;

    if (validationBlocked) {
      extractionStatus = "blocked";
    } else if (plans.length > 0) {
      extractionStatus = "plans_extracted";
    } else if (renderedText.length > 100) {
      extractionStatus = "no_plans_detected";
    } else {
      extractionStatus = "insufficient_page_content";
    }

    const errorMessage = validationBlocked
      ? `AT&T address-validation request returned HTTP ${validationHttpStatus}. Availability could not be verified.`
      : null;

    logScrapeRun({
      request_id: requestId,
      provider_id: "att",
      provider_name: "AT&T Internet",
      source_url: ATT_URL,
      requested_at: requestedAt,
      scraped_at: fetchedAt,
      duration_ms: durationMs,
      http_status: validationHttpStatus ?? response?.status() ?? null,
      status: validationBlocked
        ? "blocked"
        : renderedText.length > 100
          ? "content_received"
          : "thin_or_blocked_content",
      page_title: pageTitle,
      markdown_chars: renderedText.length,
      error_message: errorMessage
    });

    return {
      providerId: "att",
      provider: "AT&T Internet",
      sourceUrl: ATT_URL,
      address,
      fetchedAt,
      durationMs,

      // The main page and the validation request are separate.
      httpStatus: response?.status() ?? null,
      validationHttpStatus,

      pageTitle,
      availabilityStatus,
      pageMessageStatus,
      addressEligibilityVerified: false,
      extractionStatus,
      planCount: plans.length,
      plans,

      priceCacheUsed: false,

      sourceText: "",

      note: validationBlocked
        ? `AT&T's address-validation request returned HTTP ${validationHttpStatus}. The site denied validation; this does not mean service is unavailable. Any offers are unverified.`
        : plans.length
          ? "Displayed plan candidates were observed. Address-level eligibility was not independently verified."
          : "No plan candidates with both displayed price and speed were extracted. Address availability remains unverified."
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);

    logScrapeRun({
      request_id: requestId,
      provider_id: "att",
      provider_name: "AT&T Internet",
      source_url: ATT_URL,
      requested_at: requestedAt,
      scraped_at: new Date().toISOString(),
      duration_ms: Date.now() - started,
      http_status: validationHttpStatus ?? response?.status() ?? null,
      status: "failed",
      page_title: pageTitle,
      markdown_chars: renderedText.length,
      error_message: message
    });

    throw error;
  } finally {
  if (browser) {
    if (process.env.ATT_DEBUG_BROWSER === "1") {
      console.log(
        "[AT&T Debug] Browser will remain open for 60 seconds."
      );

      await new Promise((resolve) =>
        setTimeout(resolve, 60000)
      );
    }

    await browser.close().catch(() => {});
  }
}
}