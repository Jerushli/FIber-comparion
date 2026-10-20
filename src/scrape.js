
import "dotenv/config";
import { chromium } from "playwright";
import { logScrapeRun } from "./db.js";
import {
  extractAirtelPlans,
  extractBsnlApiPlans
} from "./planExtractor.js";

const NAVIGATION_TIMEOUT_MS = 60000;
const PLAN_WAIT_TIMEOUT_MS = 10000;

async function openLocalPage(timings = {}) {
  const launchStarted = Date.now();

  const browser = await chromium.launch({
    headless: true
  });

  timings.browserLaunchMs = Date.now() - launchStarted;

  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      locale: "en-IN"
    });

    const page = await context.newPage();
    page.setDefaultTimeout(15000);

    return { browser, context, page };
  } catch (error) {
    await browser.close().catch(() => {});
    throw error;
  }
}

async function closeLocalPage(connection, timings = {}) {
  if (!connection?.browser) return;

  const started = Date.now();

  try {
    await connection.browser.close();
  } catch (error) {
    console.warn("Local browser cleanup warning:", error.message);
  }

  timings.cleanupMs = Date.now() - started;
}

async function waitForPlanText(page) {
  const started = Date.now();

  try {
    await page.waitForFunction(
      () => {
        const text = document.body?.innerText ?? "";

        return (
          /₹|â‚¹|\bRs\.?\s*\d/i.test(text) &&
          /\b(?:Mbps|Gbps)\b/i.test(text)
        );
      },
      null,
      { timeout: PLAN_WAIT_TIMEOUT_MS }
    );
  } catch {
    // Continue so the extractor can determine whether usable
    // plan information was returned.
  }

  return Date.now() - started;
}

async function navigateToProvider(page, provider, timings) {
  const started = Date.now();

  const response = await page.goto(provider.url, {
    waitUntil: "domcontentloaded",
    timeout: NAVIGATION_TIMEOUT_MS
  });

  timings.navigationMs = Date.now() - started;

  return response;
}

async function readRenderedText(page, timings) {
  const started = Date.now();

  const renderedText = await page.locator("body").innerText({
    timeout: 15000
  });

  timings.readTextMs = Date.now() - started;

  return renderedText;
}

async function scrapeAirtelLive(provider) {
  let connection;
  const timings = {};

  try {
    connection = await openLocalPage(timings);
    const { page } = connection;

    const response = await navigateToProvider(
      page,
      provider,
      timings
    );

    timings.readinessWaitMs = await waitForPlanText(page);

    const renderedText = await readRenderedText(page, timings);

    const extractionStarted = Date.now();
    const plans = extractAirtelPlans(renderedText);
    timings.extractionMs = Date.now() - extractionStarted;

    return {
      plans,
      statusCode: response?.status() ?? null,
      pageTitle: await page.title(),
      contentChars: renderedText.length,
      renderedText,
      stageTimingsMs: timings,
      note: plans.length
        ? "Plans extracted from Airtel's live rendered Chennai page. Prices are before GST; confirm plan terms and address-level availability."
        : "Airtel loaded, but no usable price and speed pairs were extracted."
    };
  } finally {
    await closeLocalPage(connection, timings);
  }
}

function extractTataPlayBrowserPlans(renderedText) {
  const lines = String(renderedText)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const isPlanHeading = (line) =>
    /^(?:Mega|Lite|Prime|Fiber Only)\s*(?::|$)/i.test(line);

  const plans = [];

  for (let i = 0; i < lines.length; i++) {
    if (!isPlanHeading(lines[i])) continue;

    const planName = lines[i];
    const section = [];

    for (let j = i + 1; j < lines.length; j++) {
      if (isPlanHeading(lines[j])) break;
      section.push(lines[j]);
    }

    const currency = String.raw`(?:₹|â‚¹|Rs\.?)`;

    const priceLine = section.find((line) =>
      new RegExp(
        `${currency}\\s*[\\d,]+(?:\\.\\d{1,2})?\\s*\\+\\s*GST(?:\\s+X\\s+\\d+\\s+Months?)?`,
        "i"
      ).test(line)
    );

    const priceMatch = priceLine?.match(
      /(?:₹|â‚¹|Rs\.?)\s*([\d,]+(?:\.\d{1,2})?)\s*\+\s*GST(?:\s+X\s+(\d+)\s+Months?)?/i
    );

    const speedLine = section.find((line) =>
      /^\s*\d[\d,]*(?:\.\d+)?\s*(?:Mbps|Gbps)\b/i.test(line)
    );

    const speedMatch = speedLine?.match(
      /(\d[\d,]*(?:\.\d+)?)\s*(Mbps|Gbps)\b/i
    );

    if (!priceMatch || !speedMatch) continue;

    const price = Number(priceMatch[1].replace(/,/g, ""));

    const billingPeriodMonths = priceMatch[2]
      ? Number(priceMatch[2])
      : null;

    const speedValue = Number(
      speedMatch[1].replace(/,/g, "")
    );

    const speedMbps =
      speedMatch[2].toLowerCase() === "gbps"
        ? speedValue * 1000
        : speedValue;

    if (
      !Number.isFinite(price) ||
      !Number.isFinite(speedMbps) ||
      price <= 0 ||
      speedMbps <= 0
    ) {
      continue;
    }

    const benefitLine = section.find((line) =>
      /^Benefits\s*-/i.test(line)
    );

    plans.push({
      providerId: "tataplay",
      planName,
      description: null,
      monthlyPrice: price,
      currency: "INR",
      priceBasis: "before_gst",
      billingPeriodMonths,
      totalBaseAmount: billingPeriodMonths !== null
        ? price * billingPeriodMonths
        : null,
      totalBaseAmountBasis: billingPeriodMonths !== null
        ? "calculated_price_times_billing_months_before_gst"
        : null,
      speedMbps,
      benefits: benefitLine || null,
      source: "live_browser_render",
      sourceEvidence: {
        priceLine,
        speedLine
      }
    });
  }

  const seen = new Set();

  return plans.filter((plan) => {
    const key = [
      plan.planName,
      plan.monthlyPrice,
      plan.speedMbps,
      plan.billingPeriodMonths
    ].join("|");

    if (seen.has(key)) return false;

    seen.add(key);
    return true;
  });
}

async function scrapeTataPlayLive(provider) {
  let connection;
  const timings = {};

  try {
    connection = await openLocalPage(timings);
    const { page } = connection;

    const response = await navigateToProvider(
      page,
      provider,
      timings
    );

    timings.readinessWaitMs = await waitForPlanText(page);

    const renderedText = await readRenderedText(page, timings);

    const extractionStarted = Date.now();
    const plans = extractTataPlayBrowserPlans(renderedText);
    timings.extractionMs = Date.now() - extractionStarted;

    return {
      plans,
      statusCode: response?.status() ?? null,
      pageTitle: await page.title(),
      contentChars: renderedText.length,
      renderedText,
      stageTimingsMs: timings,
      note: plans.length
        ? "Plans extracted from Tata Play Fiber's live rendered Chennai page. Prices are before GST; confirm plan terms and address-level availability."
        : "Tata Play Fiber loaded, but the browser text did not yield usable plans. The page layout or price format may need an extractor adjustment."
    };
  } finally {
    await closeLocalPage(connection, timings);
  }
}

async function scrapeBsnlLive(provider) {
  let connection;
  const timings = {};

  try {
    connection = await openLocalPage(timings);
    const { page } = connection;

    let captureStarted = false;
    let resolveCapture;

    const capturePromise = new Promise((resolve) => {
      resolveCapture = resolve;
    });

    page.on("response", async (response) => {
      if (
        captureStarted ||
        !response.url().includes("/ecare/bsnl/offer/list")
      ) {
        return;
      }

      captureStarted = true;

      try {
        resolveCapture({
          statusCode: response.status(),
          json: await response.json()
        });
      } catch (error) {
        resolveCapture({
          statusCode: response.status(),
          error
        });
      }
    });

    const navigationStarted = Date.now();
    let navigationSucceeded = false;
    let lastNavigationError;

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await page.goto(provider.url, {
          waitUntil: "commit",
          timeout: NAVIGATION_TIMEOUT_MS
        });

        navigationSucceeded = true;
        break;
      } catch (error) {
        lastNavigationError = error;

        if (page.url().includes("wsc.cdr.bsnl.co.in")) {
          navigationSucceeded = true;
          break;
        }

        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    }

    timings.navigationMs = Date.now() - navigationStarted;

    if (!navigationSucceeded) {
      throw new Error(
        `BSNL navigation failed: ${lastNavigationError?.message ?? "Unknown navigation error"}`
      );
    }

    const buttonStarted = Date.now();

    const queryButtons = page.getByRole("button", {
      name: "Query",
      exact: true
    });

    await queryButtons.first().waitFor({
      state: "visible",
      timeout: 20000
    });

    timings.queryButtonWaitMs = Date.now() - buttonStarted;

    const clickStarted = Date.now();

    await queryButtons.first().click({
      timeout: 10000
    });

    timings.queryClickMs = Date.now() - clickStarted;

    let timeoutId;
    const apiStarted = Date.now();
    let capture;

    try {
      capture = await Promise.race([
        capturePromise,
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(
              new Error("Timed out waiting for the live BSNL plan API.")
            );
          }, 25000);
        })
      ]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      timings.apiResponseWaitMs = Date.now() - apiStarted;
    }

    if (capture.error) {
      throw new Error(
        `Could not read BSNL plan response: ${capture.error.message}`
      );
    }

    if (
      capture.statusCode < 200 ||
      capture.statusCode >= 300
    ) {
      throw new Error(
        `BSNL plan API returned HTTP ${capture.statusCode}.`
      );
    }

    if (capture.json?.code !== "200") {
      throw new Error(
        `BSNL API reported an error: ${
          capture.json?.resultMsg || "Unknown API error"
        }`
      );
    }

    const offers = capture.json?.data?.offerList ?? [];

    const extractionStarted = Date.now();
    const plans = extractBsnlApiPlans(offers);
    timings.extractionMs = Date.now() - extractionStarted;

    return {
      plans,
      statusCode: capture.statusCode,
      pageTitle: await page.title(),
      contentChars: JSON.stringify(offers).length,
      stageTimingsMs: timings,
      note: plans.length
        ? "Plans fetched from the live BSNL API. Billing periods and address-level availability require verification."
        : "The BSNL API responded, but no usable plans were extracted."
    };
  } finally {
    await closeLocalPage(connection, timings);
  }
}

export async function scrapeProvider({
  provider,
  requestId,
  requestedAt
}) {
  const started = Date.now();

  try {
    let result;

    if (provider.id === "airtel") {
      result = await scrapeAirtelLive(provider);
    } else if (provider.id === "tataplay") {
      result = await scrapeTataPlayLive(provider);
    } else if (provider.id === "bsnl") {
      result = await scrapeBsnlLive(provider);
    } else {
      throw new Error(`Unsupported provider: ${provider.id}`);
    }

    const fetchedAt = new Date().toISOString();
    const plans = result.plans ?? [];
    const contentChars = result.contentChars ?? 0;
    const durationMs = Date.now() - started;

    const pageStatus = contentChars > 100
      ? "content_received"
      : "thin_or_blocked_content";

    const extractionStatus = plans.length
      ? "plans_extracted"
      : contentChars > 100
        ? "no_plans_detected"
        : "insufficient_page_content";

    logScrapeRun({
      request_id: requestId,
      provider_id: provider.id,
      provider_name: provider.name,
      source_url: provider.url,
      requested_at: requestedAt,
      scraped_at: fetchedAt,
      duration_ms: durationMs,
      http_status: result.statusCode ?? null,
      status: pageStatus,
      page_title: result.pageTitle ?? null,
      markdown_chars: contentChars,
      error_message: null
    });

    return {
      providerId: provider.id,
      provider: provider.name,
      sourceUrl: provider.url,
      fetchedAt,
      durationMs,
      httpStatus: result.statusCode ?? null,
      pageTitle: result.pageTitle ?? null,
      markdown: result.renderedText ?? "",
      markdownChars: contentChars,
      extractionStatus,
      planCount: plans.length,
      plans,
      stageTimingsMs: result.stageTimingsMs ?? {},
      note: result.note
    };
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : String(error);

    const failedAt = new Date().toISOString();
    const durationMs = Date.now() - started;

    logScrapeRun({
      request_id: requestId,
      provider_id: provider.id,
      provider_name: provider.name,
      source_url: provider.url,
      requested_at: requestedAt,
      scraped_at: failedAt,
      duration_ms: durationMs,
      http_status: null,
      status: "failed",
      page_title: null,
      markdown_chars: 0,
      error_message: message
    });

    return {
      providerId: provider.id,
      provider: provider.name,
      sourceUrl: provider.url,
      fetchedAt: failedAt,
      durationMs,
      extractionStatus: "failed",
      planCount: 0,
      plans: [],
      stageTimingsMs: {},
      error: message
    };
  }
}
