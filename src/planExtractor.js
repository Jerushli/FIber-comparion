
function cleanText(value = "") {
  return String(value)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/?p[^>]*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#8377;|&#x20b9;/gi, "\u20B9")
    .replace(/\s+/g, " ")
    .trim();
}

const RUPEE = "\u20B9";

function parsePriceLine(line = "") {
  const match = line.match(
    /(?:\u20B9|&#8377;|&#x20b9;)\s*([\d,]+(?:\.\d{1,2})?)\s*\+\s*GST(?:\s*\*{0,2}\s*X\s*(\d+)\s*\*{0,2}\s*Months?)?/i
  );

  if (!match) return null;

  return {
    price: Number(match[1].replace(/,/g, "")),
    billingPeriodMonths: match[2] ? Number(match[2]) : null
  };
}

function extractTataPlayPlans(markdown = "") {
  const lines = String(markdown).split(/\r?\n/);
  const plans = [];

  for (let i = 0; i < lines.length; i++) {
    const heading = lines[i].match(
      /^\s*#{3,4}\s+([^:\n]+):\s*(.*?)\s*$/
    );

    if (!heading) continue;

    const name = cleanText(heading[1]);
    const description = cleanText(heading[2]);
    const section = [];

    for (let j = i + 1; j < lines.length; j++) {
      if (/^\s*#{3,4}\s+[^:\n]+:/.test(lines[j])) break;
      section.push(lines[j]);
    }

    const priceLine = section.find((line) =>
      /(?:\u20B9|&#8377;|&#x20b9;)\s*[\d,]+(?:\.\d{1,2})?\s*\+\s*GST/i.test(line)
    );

    const price = parsePriceLine(priceLine || "");
    const block = section.join("\n");
    const speedMatch = block.match(
      /\*{0,2}\s*(\d+(?:\.\d+)?)\s*\*{0,2}\s*Mbps/i
    );

    if (!price || !speedMatch) continue;

    const benefitLine = section.find((line) =>
      /Benefits\s*-/i.test(line)
    );

    const billingPeriodMonths = price.billingPeriodMonths;

    plans.push({
      providerId: "tataplay",
      planName: name,
      description: description || null,
      monthlyPrice: price.price,
      currency: "INR",
      priceBasis: "before_gst",
      billingPeriodMonths,
      totalBaseAmount: billingPeriodMonths !== null
        ? price.price * billingPeriodMonths
        : null,
      totalBaseAmountBasis: billingPeriodMonths !== null
        ? "calculated_price_times_billing_months_before_gst"
        : null,
      speedMbps: Number(speedMatch[1]),
      benefits: benefitLine
        ? cleanText(benefitLine.replace(/^\s*[-*]\s*/, ""))
        : null,
      source: "live_page_markdown",
      sourceEvidence: {
        priceLine: cleanText(priceLine),
        speedMbps: Number(speedMatch[1])
      }
    });
  }

  const seen = new Set();

  return plans.filter((plan) => {
    const key = [
      plan.planName.toLowerCase(),
      plan.monthlyPrice,
      plan.speedMbps,
      plan.billingPeriodMonths
    ].join("|");

    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function extractAirtelPlans(text = "") {
  const content = String(text);
  const pricePattern =
    /\u20B9\s*([\d,]+(?:\.\d{1,2})?)\s*\/\s*m\s*\+\s*GST/gi;

  const matches = [...content.matchAll(pricePattern)];
  const plans = [];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const start = match.index;
    const end = i + 1 < matches.length
      ? matches[i + 1].index
      : content.length;

    const section = content.slice(start, end);
    const speedMatch = section.match(/(\d[\d,]*(?:\.\d+)?)\s*Mbps/i);

    if (!speedMatch) continue;

    const price = Number(match[1].replace(/,/g, ""));
    const speedMbps = Number(speedMatch[1].replace(/,/g, ""));

    if (
      !Number.isFinite(price) ||
      !Number.isFinite(speedMbps) ||
      price <= 0 ||
      speedMbps <= 0
    ) continue;

    const cardText = cleanText(
      section
        .replace(match[0], " ")
        .replace(speedMatch[0], " ")
        .replace(/\b(View Details|Select)\b/gi, " ")
    );

    plans.push({
      providerId: "airtel",
      planName: `Airtel ${RUPEE}${price.toLocaleString("en-IN")} plan`,
      description: cardText || null,
      monthlyPrice: price,
      currency: "INR",
      priceBasis: "before_gst",
      billingPeriodMonths: 1,
      speedMbps,
      benefits: cardText || null,
      source: "live_browser_render",
      sourceEvidence: {
        priceLine: match[0],
        speedMbps
      }
    });
  }

  const seen = new Set();

  return plans.filter((plan) => {
    const key = `${plan.monthlyPrice}|${plan.speedMbps}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function validPrice(value) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return null;
  }

  const price = Number(String(value).replace(/[â‚¹,\s]/g, ""));
  return Number.isFinite(price) && price > 0 ? price : null;
}

function getMonthlyOption(offer) {
  const options = offer?.offerExtMap?.dppOfferDtoList;

  if (!Array.isArray(options)) return null;

  const monthlyOptions = options.filter((option) => {
    const name = String(option?.offerName ?? "");
    const months = Number(option?.leaseOfMonth);
    const lease = Number(option?.lease);

    return (
      /\bmonthly\b|\bmonth\b/i.test(name) ||
      months === 1 ||
      lease === 1
    );
  });

  monthlyOptions.sort((a, b) => {
    const aDefault = String(a?.defaultFlag).toUpperCase() === "Y" ? 1 : 0;
    const bDefault = String(b?.defaultFlag).toUpperCase() === "Y" ? 1 : 0;
    return bDefault - aDefault;
  });

  return monthlyOptions.find((option) => {
    const name = String(option?.offerName ?? "");
    const months = Number(option?.leaseOfMonth);
    const lease = Number(option?.lease);

    return (
      /\bmonthly\b|\bmonth\b/i.test(name) ||
      months === 1 ||
      lease === 1
    ) && validPrice(option?.mrcDisplay) !== null;
  }) ?? null;
}

function cleanBsnlCustomerText(brief = "") {
  return cleanText(brief)
    .replace(/\bGuiding_Price\s*:\s*[^ ]+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractBsnlApiPlans(offers = []) {
  if (!Array.isArray(offers)) return [];

  return offers.map((offer) => {
    const originalBrief = cleanText(offer.brief || "");
    const customerText = cleanBsnlCustomerText(originalBrief);

    const speedMatch = originalBrief.match(
      /Speed\s*:\s*(?:Up\s*to|Upto)\s*(\d+(?:\.\d+)?)\s*(Mbps|Gbps|GBPS)\b/i
    );

    const speedThresholdMatch = originalBrief.match(
      /Speed\s*:\s*.*?\btill\s*([\d,]+(?:\.\d+)?)\s*GB/i
    );

    const reducedSpeedMatch = originalBrief.match(
      /Fup_Speed\s*:\s*(?:Up\s*to|Upto)?\s*(\d+(?:\.\d+)?)\s*(Mbps|Gbps|GBPS)\b/i
    );

    const unlimitedMatch =
      /\bData_Download\s*:\s*UNLIMITED\b/i.test(originalBrief);

    const displayedPrice = validPrice(offer.displayRentPrice);
    const monthlyOption = getMonthlyOption(offer);
    const monthlyOptionPrice = validPrice(monthlyOption?.mrcDisplay);

    const rentUnit = cleanText(offer.rentUnitName || "");
    const hasMonthlyUnit = /month/i.test(rentUnit);

    const monthlyPrice = monthlyOptionPrice !== null
      ? monthlyOptionPrice
      : hasMonthlyUnit
        ? displayedPrice
        : null;

    if (
      !offer.offerName ||
      !speedMatch ||
      (displayedPrice === null && monthlyPrice === null)
    ) {
      return null;
    }

    const speedValue = Number(speedMatch[1]);
    const speedUnit = speedMatch[2].toLowerCase();
    const speedMbps = speedUnit === "gbps"
      ? speedValue * 1000
      : speedValue;

    const reducedSpeedValue = reducedSpeedMatch
      ? Number(reducedSpeedMatch[1])
      : null;

    const reducedSpeedMbps = reducedSpeedValue === null
      ? null
      : reducedSpeedMatch[2].toLowerCase() === "gbps"
        ? reducedSpeedValue * 1000
        : reducedSpeedValue;

    const speedThresholdGb = speedThresholdMatch
      ? Number(speedThresholdMatch[1].replace(/,/g, ""))
      : null;

    const benefits = customerText || null;

    return {
      providerId: "bsnl",
      planName: cleanText(offer.offerName),
      description: benefits,
      monthlyPrice,
      displayedPrice,
      currency: "INR",
      priceBasis: monthlyPrice !== null
        ? monthlyOptionPrice !== null
          ? "provider_monthly_recurring_charge"
          : "provider_rent_price_per_month"
        : "provider_displayed_rent_price_period_unverified",
      billingPeriod: monthlyPrice !== null
        ? "Monthly"
        : rentUnit || null,
      speedMbps,
      dataLimitGb: null,
      speedThresholdGb,
      dataDownloadPolicy: unlimitedMatch ? "unlimited" : "not_verified",
      reducedSpeedMbps,
      benefits,
      source: "live_bsnl_api",
      sourceEvidence: {
        offerId: offer.offerId ?? null,
        offerCode: offer.offerCode ?? null,
        displayedRentPrice: offer.displayRentPrice ?? null,
        rentUnitName: rentUnit || null,
        monthlyOptionName: monthlyOption?.offerName ?? null,
        monthlyOptionPrice: monthlyOption?.mrcDisplay ?? null,
        originalBrief
      }
    };
  }).filter(Boolean);
}

export function extractPlans(provider, markdown) {
  if (provider.id === "airtel") {
    return extractAirtelPlans(markdown);
  }

  if (provider.id === "tataplay") {
    return extractTataPlayPlans(markdown);
  }

  return [];
}
