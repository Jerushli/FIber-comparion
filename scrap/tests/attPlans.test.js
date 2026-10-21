import test from "node:test";
import assert from "node:assert/strict";
import { extractPlansFromText, extractPlansFromBlocks } from "../src/attPlans.js";

test("extracts independent explicitly priced public offer sentences", () => {
  const plans = extractPlansFromText("Get 1 GIG internet for $70/mo. Get unlimited 500 Mbps fiber internet for $60 per month.");
  assert.deepEqual(plans.map((p) => [p.speedMbps, p.monthlyPrice]), [[500, 60], [1000, 70]]);
  assert.ok(plans.every((p) => p.addressEligibility === "not_verified"));
});

test("extracts price and speed on separate lines in isolated cards", () => {
  const plans = extractPlansFromBlocks([
    { heading: "AT&T Internet 300", text: "AT&T Internet 300\n300Mbps speed\n$50.00/mo. plus taxes & fees" },
    { heading: "AT&T Internet 500", text: "AT&T Internet 500\n500Mbps speed\n$60.00/mo. plus taxes & fees" },
    { heading: "AT&T Internet 1000", text: "AT&T Internet 1000\nUp to 1 GIG speed\n$70.00/mo. plus taxes & fees" },
  ]);
  assert.deepEqual(plans.map((p) => [p.speedMbps, p.monthlyPrice]), [[300, 50], [500, 60], [1000, 70]]);
});

test("rejects mixed prices and speeds in broad containers", () => {
  const plans = extractPlansFromBlocks([{ text: "300 Mbps $50/mo; 500 Mbps $60/mo" }]);
  assert.deepEqual(plans, []);
});

test("does not invent prices from speed-only content", () => {
  assert.deepEqual(extractPlansFromBlocks([{ text: "Up to 1 GIG Internet" }]), []);
  assert.deepEqual(extractPlansFromText("AT&T Fiber 300 available. See prices online."), []);
});
