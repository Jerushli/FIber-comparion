import "dotenv/config";
import Steel from "steel-sdk";
import { chromium } from "playwright";
import { PROVIDERS } from "./providers.js";

const provider = PROVIDERS.find(p => p.id === "bsnl");
const client = new Steel({ steelAPIKey: process.env.STEEL_API_KEY });
let session;
let browser;

try {
  session = await client.sessions.create({ timeout: 120000 });
  browser = await chromium.connectOverCDP(
    `${session.websocketUrl}&apiKey=${process.env.STEEL_API_KEY}`
  );

  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? await context.newPage();

  const tasks = [];

  page.on("response", response => {
    if (!response.url().includes("/ecare/bsnl/offer/list")) return;

    tasks.push((async () => {
      console.log("\n--- BSNL PLAN API REQUEST ---");
      console.log("Method:", response.request().method());
      console.log("Request body:", response.request().postData() ?? "(none)");
      console.log("HTTP status:", response.status());

      try {
        const json = await response.json();
        const offers = json?.data?.offerList ?? [];

        console.log("\nTotal plans returned:", offers.length);
        console.log("\n--- PLAN DETAILS ---");

        console.log(JSON.stringify(
          offers.map(plan => ({
            offerId: plan.offerId,
            offerName: plan.offerName,
            offerCode: plan.offerCode,
            displayRentPrice: plan.displayRentPrice,
            displayOtcPrice: plan.displayOtcPrice,
            rentPrice: plan.rentPrice,
            otcPrice: plan.otcPrice,
            state: plan.state,
            brief: plan.brief,
            description: plan.description,
            allFields: Object.keys(plan)
          })),
          null,
          2
        ));
      } catch (error) {
        console.log("Could not parse plan response:", error.message);
      }
    })());
  });

  await page.goto(provider.url, {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });

  await page.waitForTimeout(4000);
  await page.getByRole("button", { name: "Query", exact: true }).click();
  await page.waitForTimeout(5000);
  await Promise.allSettled(tasks);
} catch (error) {
  console.error("Inspection failed:", error.message);
} finally {
  if (browser) {
    try { await browser.close(); } catch {}
  }
  if (session) {
    try { await client.sessions.release(session.id); } catch {}
  }
}
