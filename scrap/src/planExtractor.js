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

  const price = Number(
    String(value).replace(/[\u20B9,\s]/g, "")
  );

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

function getBsnlField(brief, fieldName) {
  const escapedName = fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const nextFields =
    "Speed|Fup_Speed|Data_Download|Local_Std|Unlimit_Timing|Guiding_Price";

  const pattern = new RegExp(
    `${escapedName}\\s*:\\s*(.*?)(?=\\b(?:${nextFields})\\s*:|$)`,
    "i"
  );

  return cleanText(brief.match(pattern)?.[1] ?? "");
}

function parseBsnlSpeed(value = "") {
  const match = value.match(
    /(?:up\s*to|upto)?\s*(\d+(?:\.\d+)?)\s*(Mbps|Gbps|GBPS)\b/i
  );

  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();

  return unit === "gbps" ? amount * 1000 : amount;
}

function parseBsnlAllowance(value = "") {
  const match = value.match(
    /\btill\s*([\d,]+(?:\.\d+)?)\s*(GB|TB)\b/i
  );

  if (!match) return null;

  const amount = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;

  return match[2].toUpperCase() === "TB"
    ? amount * 1000
    : amount;
}

function formatBsnlCustomerText(brief = "") {
  const speedText = getBsnlField(brief, "Speed");
  const fupText = getBsnlField(brief, "Fup_Speed");
  const dataText = getBsnlField(brief, "Data_Download");
  const callsText = getBsnlField(brief, "Local_Std");
  const timingText = getBsnlField(brief, "Unlimit_Timing");

  const parts = [];

  const speedMbps = parseBsnlSpeed(speedText);
  const allowanceGb = parseBsnlAllowance(speedText);

  if (speedMbps !== null) {
    parts.push(`Up to ${speedMbps} Mbps`);
  }

  if (allowanceGb !== null) {
    parts.push(
      `${allowanceGb.toLocaleString("en-IN")} GB high-speed allowance`
    );
  }

  const reducedSpeedMbps = parseBsnlSpeed(fupText);

  if (reducedSpeedMbps !== null) {
    const beyondMatch = fupText.match(
      /\bbeyond\s*([\d,]+(?:\.\d+)?)\s*(GB|TB)\b/i
    );

    let reducedSpeedText = `Then ${reducedSpeedMbps} Mbps`;

    if (beyondMatch) {
      const amount = Number(beyondMatch[1].replace(/,/g, ""));
      const unit = beyondMatch[2].toUpperCase();
      const gbAmount = unit === "TB" ? amount * 1000 : amount;

      reducedSpeedText +=
        ` beyond ${gbAmount.toLocaleString("en-IN")} GB`;
    } else {
      reducedSpeedText += " after the high-speed allowance";
    }

    parts.push(reducedSpeedText);
  }

  if (/\bUNLIMITED\b/i.test(dataText)) {
    parts.push("Unlimited data downloads");
  } else if (dataText) {
    parts.push(dataText);
  }

  if (/\bUNLIMITED\b/i.test(callsText)) {
    parts.push("Unlimited local and STD calls");
  }

  if (timingText) {
    if (/unlimited\s*24\s*hrs/i.test(timingText)) {
      parts.push("Available 24 hours");
    } else if (/individual.*rural|rural.*individual/i.test(timingText)) {
      parts.push("For individual customers in rural areas");
    } else if (!/^unlimited\s*$/i.test(timingText)) {
      parts.push(timingText);
    }
  }

  return parts.join("; ");
}

export function extractBsnlApiPlans(offers = []) {
  if (!Array.isArray(offers)) return [];

  return offers.map((offer) => {
    const originalBrief = cleanText(offer.brief || "");

    const speedText = getBsnlField(originalBrief, "Speed");
    const fupText = getBsnlField(originalBrief, "Fup_Speed");

    const speedMbps = parseBsnlSpeed(speedText);
    const speedThresholdGb = parseBsnlAllowance(speedText);
    const reducedSpeedMbps = parseBsnlSpeed(fupText);

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
      speedMbps === null ||
      (displayedPrice === null && monthlyPrice === null)
    ) {
      return null;
    }

    const benefits = formatBsnlCustomerText(originalBrief) || null;

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
      highSpeedAllowanceGb: speedThresholdGb,
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
