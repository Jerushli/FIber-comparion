
import "dotenv/config";
import { chromium } from "playwright";
import { logScrapeRun } from "./db.js";
import {
  extractAirtelPlans,
  extractBsnlApiPlans
} from "./planExtractor.js";

const NAVIGATION_TIMEOUT_MS = 60000;
const PLAN_WAIT_TIMEOUT_MS = 10000;
const BSNL_API_TIMEOUT_MS = 30000;
const BSNL_AREA_NAME = "CHENNAI STP";
const BSNL_CATEGORY_CODE = "Fiber_Combo";

async function openLocalPage(timings = {}) {
  const started = Date.now();
  const browser = await chromium.launch({ headless: true });

  timings.browserLaunchMs = Date.now() - started;

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

async function navigateToProvider(page, provider, timings) {
  const started = Date.now();
  const response = await page.goto(provider.url, {
    waitUntil: "domcontentloaded",
    timeout: NAVIGATION_TIMEOUT_MS
  });

  timings.navigationMs = Date.now() - started;
  return response;
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
    // Let extraction report whether usable plans were found.
  }

  return Date.now() - started;
}

async function readRenderedText(page, timings) {
  const started = Date.now();
  const text = await page.locator("body").innerText({ timeout: 15000 });
  timings.readTextMs = Date.now() - started;
  return text;
}

async function scrapeAirtelLive(provider) {
  let connection;
  const timings = {};

  try {
    connection = await openLocalPage(timings);
    const { page } = connection;

    const response = await navigateToProvider(page, provider, timings);
    timings.readinessWaitMs = await waitForPlanText(page);

    const extractionStarted = Date.now();

    const cardResults = await page.locator(".card").evaluateAll((cards) =>
      cards.map((card) => {
        const header = card.querySelector(".card-header");
        if (!header) return null;

        const headerText = (header.innerText || "").trim();

        const priceMatch = headerText.match(
          /\u20B9\s*([\d,]+(?:\.\d{1,2})?)\s*\/\s*m\s*\+\s*GST/i
        );

        const speedMatch = headerText.match(
          /(\d[\d,]*(?:\.\d+)?)\s*Mbps/i
        );

        if (!priceMatch || !speedMatch) return null;

        const price = Number(priceMatch[1].replace(/,/g, ""));
        const speedMbps = Number(speedMatch[1].replace(/,/g, ""));

        if (
          !Number.isFinite(price) ||
          !Number.isFinite(speedMbps) ||
          price <= 0 ||
          speedMbps <= 0
        ) {
          return null;
        }

        return {
          price,
          speedMbps,
          headerText: headerText.replace(/\s+/g, " ").trim(),
          cardText: (card.innerText || "").replace(/\s+/g, " ").trim()
        };
      }).filter(Boolean)
    );

    const seen = new Set();

    const plans = cardResults
      .filter((item) => {
        const key = `${item.price}|${item.speedMbps}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((item) => {
        const benefits = item.headerText
          .replace(/\u20B9\s*[\d,]+(?:\.\d{1,2})?\s*\/\s*m\s*\+\s*GST/i, "")
          .replace(/\d[\d,]*(?:\.\d+)?\s*Mbps/i, "")
          .replace(/\bspeed\b/gi, "")
          .replace(/\s+/g, " ")
          .trim();

        return {
          providerId: "airtel",
          planName: `Airtel \u20B9${item.price.toLocaleString("en-IN")} plan`,
          description: benefits || null,
          monthlyPrice: item.price,
          currency: "INR",
          priceBasis: "before_gst",
          billingPeriodMonths: 1,
          speedMbps: item.speedMbps,
          benefits: benefits || null,
          source: "live_browser_render",
          sourceEvidence: {
            priceLine: `\u20B9${item.price} /m+GST`,
            speedMbps: item.speedMbps,
            cardHeader: item.headerText
          }
        };
      });

    timings.extractionMs = Date.now() - extractionStarted;

    const renderedText = await readRenderedText(page, timings);

    return {
      plans,
      statusCode: response?.status() ?? null,
      pageTitle: await page.title(),
      contentChars: renderedText.length,
      renderedText,
      stageTimingsMs: timings,
      note: plans.length
        ? "Plans extracted from individual Airtel plan cards on the live rendered page. Prices are before GST; confirm plan terms and address-level availability."
        : "Airtel loaded, but no usable price and speed pairs were extracted from its plan cards."
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

    const speedValue = Number(speedMatch[1].replace(/,/g, ""));
    const speedMbps = speedMatch[2].toLowerCase() === "gbps"
      ? speedValue * 1000
      : speedValue;

    if (
      !Number.isFinite(price) ||
      !Number.isFinite(speedMbps) ||
      price <= 0 ||
      speedMbps <= 0
    ) continue;

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
      sourceEvidence: { priceLine, speedLine }
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

    const response = await navigateToProvider(page, provider, timings);
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
        ? "Plans extracted from Tata Play Fiber's live rendered page. Prices are before GST; confirm plan terms and address-level availability."
        : "Tata Play Fiber loaded, but no usable plans were extracted."
    };
  } finally {
    await closeLocalPage(connection, timings);
  }
}

function isBsnlPlanListResponse(response) {
  if (!response.url().includes("/ecare/bsnl/offer/list")) {
    return false;
  }

  try {
    const body = JSON.parse(response.request().postData() || "{}");
    return body.salesCatgCode === BSNL_CATEGORY_CODE;
  } catch {
    return false;
  }
}

async function scrapeBsnlLive(provider) {
  let connection;
  const timings = {};

  try {
    connection = await openLocalPage(timings);
    const { page } = connection;

    const response = await navigateToProvider(page, provider, timings);

    if (response && response.status() >= 400) {
      throw new Error(`BSNL page returned HTTP ${response.status()}.`);
    }

    // Wait for the custom area dropdown, not a standard HTML <select>.
    const combo = page.locator('[role="combobox"]').first();
    await combo.waitFor({ state: "visible", timeout: 20000 });

    const areaStarted = Date.now();
    await combo.click();

    const areaOption = page.getByText(BSNL_AREA_NAME, { exact: true });
    await areaOption.waitFor({ state: "visible", timeout: 10000 });
    await areaOption.click();

    timings.areaSelectionMs = Date.now() - areaStarted;

    // Give the page time to apply the selected area before choosing a category.
    await page.waitForTimeout(1000);

    // Register the waiter BEFORE clicking, because the request starts immediately.
    const apiStarted = Date.now();
    const responsePromise = page.waitForResponse(
      isBsnlPlanListResponse,
      { timeout: BSNL_API_TIMEOUT_MS }
    );

    await page.getByText("Bharat Fiber Broadband", {
      exact: true
    }).click();

    const apiResponse = await responsePromise;
    timings.apiResponseWaitMs = Date.now() - apiStarted;

    if (apiResponse.status() < 200 || apiResponse.status() >= 300) {
      throw new Error(`BSNL plan API returned HTTP ${apiResponse.status()}.`);
    }

    const json = await apiResponse.json();

    if (String(json?.code) !== "200") {
      throw new Error(
        `BSNL API reported an error: ${json?.resultMsg || "Unknown API error"}`
      );
    }

    const data = json?.data ?? {};
    const offers = Array.isArray(data.offerList) ? data.offerList : [];

    const extractionStarted = Date.now();
    const plans = extractBsnlApiPlans(offers);
    timings.extractionMs = Date.now() - extractionStarted;

    return {
      plans,
      statusCode: apiResponse.status(),
      pageTitle: await page.title(),
      contentChars: JSON.stringify(offers).length,
      stageTimingsMs: timings,
      sourceMetadata: {
        selectedArea: BSNL_AREA_NAME,
        categoryCode: BSNL_CATEGORY_CODE,
        returnedOfferCount: offers.length,
        apiReportedTotal: data.pageInfo?.total ?? null,
        returnedPage: data.pageInfo?.currentPage ?? null,
        reportedPageSize: data.pageInfo?.pageSize ?? null,
        categoryRequestIncludesAreaId: (() => {
          try {
            const body = JSON.parse(apiResponse.request().postData() || "{}");
            return Object.hasOwn(body, "areaId");
          } catch {
            return false;
          }
        })()
      },
      note: plans.length
        ? "Plans extracted from a fresh BSNL API response after selecting CHENNAI STP. The category request did not include areaId, so verify individual plan availability for the address. Only returned offers are included; the API may report a larger total."
        : "BSNL returned a response, but no usable plans were extracted."
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
      sourceMetadata: result.sourceMetadata ?? null,
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
      sourceMetadata: null,
      error: message
    };
  }
}
