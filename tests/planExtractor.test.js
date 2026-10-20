
import test from "node:test";
import assert from "node:assert/strict";

import {
  extractAirtelPlans,
  extractBsnlApiPlans,
  extractPlans
} from "../src/planExtractor.js";

test("Airtel extracts price, speed, and pre-GST basis", () => {
  const text = `
    ₹499/m + GST
    40 Mbps
    Unlimited internet
    ₹799/m + GST
    100 Mbps
  `;

  const plans = extractAirtelPlans(text);

  assert.equal(plans.length, 2);
  assert.equal(plans[0].monthlyPrice, 499);
  assert.equal(plans[0].speedMbps, 40);
  assert.equal(plans[0].priceBasis, "before_gst");
  assert.equal(plans[0].billingPeriodMonths, 1);
  assert.equal(plans[1].monthlyPrice, 799);
  assert.equal(plans[1].speedMbps, 100);
});

test("Airtel ignores prices without a matching speed", () => {
  const plans = extractAirtelPlans("₹499/m + GST");

  assert.equal(plans.length, 0);
});

test("Airtel removes duplicate price and speed combinations", () => {
  const text = `
    ₹499/m + GST
    40 Mbps
    ₹499/m + GST
    40 Mbps
  `;

  assert.equal(extractAirtelPlans(text).length, 1);
});

test("BSNL only sets monthlyPrice when the rent unit confirms months", () => {
  const plans = extractBsnlApiPlans([
    {
      offerId: "monthly-1",
      offerName: "Fiber Monthly Plan",
      displayRentPrice: "599",
      rentUnitName: "Monthly",
      brief: "Speed: Up to 100 Mbps; Data_Download: UNLIMITED"
    },
    {
      offerId: "unknown-1",
      offerName: "Fiber Plan - Billing Unverified",
      displayRentPrice: "999",
      rentUnitName: "",
      brief: "Speed: Up to 200 Mbps"
    }
  ]);

  assert.equal(plans.length, 2);

  assert.equal(plans[0].monthlyPrice, 599);
  assert.equal(plans[0].displayedPrice, 599);
  assert.equal(plans[0].priceBasis, "provider_rent_price_per_month");
  assert.equal(plans[0].dataDownloadPolicy, "unlimited");

  assert.equal(plans[1].monthlyPrice, null);
  assert.equal(plans[1].displayedPrice, 999);
  assert.equal(
    plans[1].priceBasis,
    "provider_displayed_rent_price_period_unverified"
  );
});

test("BSNL identifies speed thresholds without treating them as data caps", () => {
  const plans = extractBsnlApiPlans([
    {
      offerName: "Fiber Threshold Plan",
      displayRentPrice: 799,
      rentUnitName: "Monthly",
      brief: "Speed: Up to 100 Mbps till 3,000 GB; Fup_Speed: Up to 4 Mbps"
    }
  ]);

  assert.equal(plans.length, 1);
  assert.equal(plans[0].speedMbps, 100);
  assert.equal(plans[0].speedThresholdGb, 3000);
  assert.equal(plans[0].dataLimitGb, null);
  assert.equal(plans[0].reducedSpeedMbps, 4);
});

test("BSNL removes internal guiding price from benefits but preserves source evidence", () => {
  const originalBrief =
    "Speed: Up to 25 Mbps till 1 GB Fup_Speed: Up to 25 Mbps till 1 GB Data_Download:UNLIMITED Local_Std:1.2-ONNET,1.2-OFFNET Guiding_Price:54000000000";

  const plans = extractBsnlApiPlans([
    {
      offerId: "bsnl-cleanup-1",
      offerName: "FTTH Test Plan",
      displayRentPrice: "150",
      rentUnitName: "Monthly",
      brief: originalBrief
    }
  ]);

  assert.equal(plans.length, 1);

  assert.doesNotMatch(plans[0].benefits, /Guiding_Price/i);
  assert.doesNotMatch(plans[0].description, /Guiding_Price/i);
  assert.match(plans[0].benefits, /Unlimited data downloads/i);
  assert.doesNotMatch(plans[0].benefits, /ONNET|OFFNET/i);
  assert.doesNotMatch(plans[0].description, /ONNET|OFFNET/i);

  assert.match(
    plans[0].sourceEvidence.originalBrief,
    /Local_Std:1\.2-ONNET,1\.2-OFFNET/i
  );
  assert.equal(plans[0].monthlyPrice, 150);
  assert.equal(plans[0].dataDownloadPolicy, "unlimited");
  assert.equal(plans[0].dataLimitGb, null);
  assert.equal(plans[0].speedThresholdGb, 1);

  assert.match(
    plans[0].sourceEvidence.originalBrief,
    /Guiding_Price:54000000000/i
  );
});

test("BSNL rejects invalid offers and non-array input safely", () => {
  assert.deepEqual(extractBsnlApiPlans(null), []);
  assert.deepEqual(extractBsnlApiPlans({}), []);

  const plans = extractBsnlApiPlans([
    {
      offerName: "Missing speed",
      displayRentPrice: 599,
      rentUnitName: "Monthly",
      brief: "Unlimited data"
    },
    {
      displayRentPrice: 599,
      rentUnitName: "Monthly",
      brief: "Speed: Up to 100 Mbps"
    }
  ]);

  assert.deepEqual(plans, []);
});

test("generic extractor routes Airtel correctly", () => {
  const plans = extractPlans(
    { id: "airtel" },
    "₹499/m + GST\n40 Mbps"
  );

  assert.equal(plans.length, 1);
  assert.equal(plans[0].providerId, "airtel");
});

test("generic extractor does not pretend to support BSNL markdown", () => {
  const plans = extractPlans(
    { id: "bsnl" },
    "₹599 100 Mbps"
  );

  assert.deepEqual(plans, []);
});

test("BSNL uses the nested monthly recurring charge when rentUnitName is missing", () => {
  const plans = extractBsnlApiPlans([
    {
      offerId: "bsnl-monthly-1",
      offerName: "Fibre Basic",
      displayRentPrice: "499.00",
      rentUnitName: null,
      brief: "Speed: Upto 40 Mbps till 3300 GB; Fup_Speed: 4 Mbps",
      offerExtMap: {
        dppOfferDtoList: [
          {
            offerName: "Fibre Basic Monthly",
            defaultFlag: "Y",
            leaseOfMonth: "1.00",
            lease: "1",
            mrcDisplay: "499.00"
          },
          {
            offerName: "Fibre Basic Annual",
            defaultFlag: "N",
            leaseOfMonth: "12.00",
            lease: "12",
            mrcDisplay: "4990.00"
          }
        ]
      }
    }
  ]);

  assert.equal(plans.length, 1);
  assert.equal(plans[0].monthlyPrice, 499);
  assert.equal(plans[0].displayedPrice, 499);
  assert.equal(plans[0].priceBasis, "provider_monthly_recurring_charge");
  assert.equal(plans[0].billingPeriod, "Monthly");
  assert.equal(plans[0].speedMbps, 40);
  assert.equal(plans[0].speedThresholdGb, 3300);
  assert.equal(plans[0].reducedSpeedMbps, 4);
});
