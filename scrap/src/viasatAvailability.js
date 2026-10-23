
import { chromium } from "playwright";

const ORDER_URL = "https://buy.viasat.com/en-US/r/";

function parseUSAddress(address) {
  const parts = address.split(",").map((part) => part.trim()).filter(Boolean);
  const zipMatch = address.match(/\b\d{5}(?:-\d{4})?\b/);
  const stateMatch = address.match(/\b([A-Z]{2})\s+\d{5}(?:-\d{4})?\b/i);

  if (parts.length < 3 || !zipMatch || !stateMatch) return null;

  return {
    street: parts[0],
    city: parts[parts.length - 2],
    state: stateMatch[1].toUpperCase(),
    zip: zipMatch[0],
  };
}

function normalizeAddress(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function emptyResult({ address, requestId, requestedAt, extractionStatus, note }) {
  return {
    providerId: "viasat",
    provider: "Viasat Internet",
    sourceUrl: ORDER_URL,
    requestId,
    requestedAt,
    address,
    fetchedAt: new Date().toISOString(),
    extractionStatus,
    availabilityStatus: "unknown",
    addressEligibilityVerified: false,
    planCount: 0,
    plans: [],
    priceCacheUsed: false,
    note,
  };
}

export async function checkViasatAvailability({
  address,
  requestId,
  requestedAt,
}) {
  const parsed = parseUSAddress(address);

  if (!parsed) {
    return emptyResult({
      address,
      requestId,
      requestedAt,
      extractionStatus: "address_format_not_supported",
      note:
        "Enter a US address in the format Street, City, ST ZIP. " +
        "No plans or prices were inferred.",
    });
  }

  let browser;

  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    page.setDefaultTimeout(7000);

    await page.goto(ORDER_URL, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });

    const cookieButton = page.locator("#onetrust-accept-btn-handler");
    if (await cookieButton.count().catch(() => 0)) {
      await cookieButton.click().catch(() => {});
    }

    const streetInput = page.locator("#typeahead");
    await streetInput.waitFor({ state: "visible" });
    await streetInput.fill(parsed.street);

    const suggestionSelectors = [
      '[role="option"]',
      '[role="listbox"] li',
      '[class*="suggestion"]',
      '[class*="autocomplete"] li',
    ];

    let suggestion = null;

    for (const selector of suggestionSelectors) {
      const candidate = page.locator(selector).filter({
        hasText: parsed.street,
      }).first();

      if (await candidate.count().catch(() => 0)) {
        suggestion = candidate;
        break;
      }
    }

    if (!suggestion) {
      return emptyResult({
        address,
        requestId,
        requestedAt,
        extractionStatus: "address_suggestion_not_found",
        note:
          "Viasat did not expose a selectable matching address suggestion. " +
          "No plans or prices were returned.",
      });
    }

    await suggestion.click();

    const zipInput = page.locator(
      'input[name*="zip" i], input[id*="zip" i], input[autocomplete="postal-code"]'
    ).first();

    if (await zipInput.count().catch(() => 0)) {
      await zipInput.fill(parsed.zip);
    }

    const submitButton = page.getByRole("button", {
      name: /shop plans|find plans|check availability/i,
    }).first();

    await submitButton.waitFor({ state: "visible" });
    await submitButton.click();

    await page.waitForLoadState("networkidle", {
      timeout: 12000,
    }).catch(() => {});

    await page.waitForTimeout(2500);

    const bodyText = await page.locator("body").innerText();
    const normalizedPage = normalizeAddress(bodyText);

    const addressVisible =
      normalizedPage.includes(normalizeAddress(parsed.street)) &&
      normalizedPage.includes(normalizeAddress(parsed.zip));

    if (!addressVisible) {
      return emptyResult({
        address,
        requestId,
        requestedAt,
        extractionStatus: "address_not_confirmed_on_results",
        note:
          "The ordering page did not visibly confirm the submitted street " +
          "and ZIP together after submission. Address eligibility remains unverified.",
      });
    }
    const planSelectionState =
  /plans available|available plans|select (your )?plan|choose (your )?plan|plans for your (home|address)|available at your address/i
    .test(bodyText);

if (!planSelectionState) {
  return emptyResult({
    address,
    requestId,
    requestedAt,
    extractionStatus: "address_confirmed_but_plan_state_unknown",
    note:
      "The address appeared on the page, but the page did not clearly identify an address-specific plan-selection state.",
  });
}
    const candidateSelectors = [
      '[data-testid*="plan" i]',
      '[class*="plan-card" i]',
      '[class*="planCard" i]',
      "article",
    ];

    const seen = new Set();
    const plans = [];

    for (const selector of candidateSelectors) {
      const cards = await page.locator(selector).all().catch(() => []);

      for (const card of cards) {
        const text = (await card.innerText().catch(() => "")).trim();

        if (!text || text.length > 1600) continue;

        const nameMatch = text.match(/\b(Essentials|Unleashed Max|Unleashed)\b/i);
        const priceMatches = [...text.matchAll(/\$\s*(\d+(?:\.\d{2})?)/g)];
        const selectionAction = /\b(select plan|choose plan|continue|order this plan)\b/i.test(text);

        if (!nameMatch || !priceMatches.length || !selectionAction) continue;

        const name = nameMatch[0];
        const monthlyPrice = Number(priceMatches[0][1]);
        const speedMatch = text.match(/\b(\d{1,3})\s*Mbps\b/i);
        const key = `${name.toLowerCase()}-${monthlyPrice}`;

        if (seen.has(key) || !Number.isFinite(monthlyPrice) || monthlyPrice <= 0) {
          continue;
        }

        seen.add(key);
        plans.push({
          name,
          currency: "USD",
          monthlyPrice,
          ...(speedMatch ? { speedMbps: Number(speedMatch[1]) } : {}),
          addressEligibility: "verified",
          priceEvidence: "visible_ordering_page",
        });
      }

      if (plans.length) break;
    }

    if (!plans.length) {
      return emptyResult({
        address,
        requestId,
        requestedAt,
        extractionStatus: "address_confirmed_plans_not_extracted",
        note:
          "The submitted address appeared on the results page, but no plan cards " +
          "with recognizable plan-selection actions and prices were extracted. " +
          "Open Viasat's official ordering page to review the result.",
      });
    }

    return {
      providerId: "viasat",
      provider: "Viasat Internet",
      sourceUrl: page.url(),
      requestId,
      requestedAt,
      address,
      fetchedAt: new Date().toISOString(),
      extractionStatus: "candidate_plans_extracted",
      availabilityStatus: "unknown",
      addressEligibilityVerified: false,
      planCount: plans.length,
      plans,
      priceCacheUsed: false,
      addressEvidence: {
        streetVisible: true,
        zipVisible: true,
        planSelectionState: true,
        source: "official_ordering_page",
      },
      note:
        "Plan candidates were extracted from the ordering page. Verify the selected " +
        "address and plan details before treating them as confirmed offers.",
    };
  } catch (error) {
    return emptyResult({
      address,
      requestId,
      requestedAt,
      extractionStatus: "fetch_failed",
      note:
        `Viasat ordering-page extraction failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
    });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

export function isVerifiedViasatResult(result, address) {
  const sameAddress =
    normalizeAddress(result?.address) === normalizeAddress(address);

  return (
    result?.providerId === "viasat" &&
    sameAddress &&
    result?.addressEvidence?.streetVisible === true &&
    result?.addressEvidence?.zipVisible === true &&
    result?.addressEligibilityVerified === true &&
    result?.availabilityStatus === "available" &&
    result?.addressEligibilityVerified === true &&
    Array.isArray(result?.plans) &&
    result.plans.length > 0 &&
    result.plans.every(
      (plan) =>
        plan?.addressEligibility === "verified" &&
        Number.isFinite(plan?.monthlyPrice) &&
        plan.monthlyPrice > 0
    )
  );
}



export function sanitizeViasatResult(result, address) {
  const safe =
    result && typeof result === "object" ? { ...result } : {};

  const sameAddress =
    normalizeAddress(safe.address) === normalizeAddress(address);

  // Never return plans associated with a different address.
  if (!sameAddress) {
    return {
      ...safe,
      providerId: "viasat",
      provider: "Viasat Internet",
      address,
      addressEligibilityVerified: false,
      availabilityStatus: "unknown",
      planCount: 0,
      plans: [],
      priceCacheUsed: false,
      extractionStatus: "address_mismatch",
      note:
        "The result address does not match the requested address. No plans are returned.",
    };
  }

  // Keep same-address candidates, but do not label them verified
  // unless all verification requirements pass.
  if (!isVerifiedViasatResult(safe, address)) {
    const candidates = Array.isArray(safe.plans)
      ? safe.plans.map((plan) => ({
          ...plan,
          addressEligibility: "unverified",
        }))
      : [];

    return {
      ...safe,
      providerId: "viasat",
      provider: "Viasat Internet",
      address,
      addressEligibilityVerified: false,
      availabilityStatus: "unknown",
      planCount: candidates.length,
      plans: candidates,
      priceCacheUsed: false,
      extractionStatus: safe.extractionStatus || "unverified",
      note:
        safe.note ||
        "Plans are unverified candidates, not confirmed offers for this address.",
    };
  }

  return {
    ...safe,
    providerId: "viasat",
    provider: "Viasat Internet",
    address,
    planCount: safe.plans.length,
  };
}
