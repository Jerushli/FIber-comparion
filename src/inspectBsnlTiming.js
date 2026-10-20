
import "dotenv/config";
import Browserbase from "@browserbasehq/sdk";
import { chromium } from "playwright";

const url = "https://wsc.cdr.bsnl.co.in/viewAllPlans";

let client;
let session;
let browser;

const elapsed = (start) => `${Date.now() - start} ms`;

try {
  const started = Date.now();

  client = new Browserbase({
    apiKey: process.env.BROWSERBASE_API_KEY
  });

  if (!process.env.BROWSERBASE_PROJECT_ID) {
    throw new Error("BROWSERBASE_PROJECT_ID is missing from .env.");
  }

  console.log("Creating Browserbase session...");

  session = await client.sessions.create({
    projectId: process.env.BROWSERBASE_PROJECT_ID,
    api_timeout: 120
  });

  console.log("Session created:", elapsed(started));

  const connectStarted = Date.now();

  browser = await chromium.connectOverCDP(session.connectUrl);

  console.log("Browser connected:", elapsed(connectStarted));

  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? await context.newPage();

  const navigationStarted = Date.now();

  try {
    await page.goto(url, {
      waitUntil: "commit",
      timeout: 90000
    });
  } catch (error) {
    if (!page.url().includes("wsc.cdr.bsnl.co.in")) {
      throw error;
    }

    console.log("Navigation warning:", error.message);
  }

  console.log("Navigation returned:", elapsed(navigationStarted));
  console.log("Current URL:", page.url());

  const domStarted = Date.now();

  try {
    await page.waitForLoadState("domcontentloaded", {
      timeout: 15000
    });

    console.log("DOM content loaded:", elapsed(domStarted));
  } catch {
    console.log("DOM content-loaded event did not arrive within 15 seconds.");
  }

  const locator = page.getByRole("button", {
    name: "Query",
    exact: true
  });

  console.log("Query buttons currently matched:", await locator.count());

  const buttonStarted = Date.now();

  try {
    await locator.first().waitFor({
      state: "visible",
      timeout: 25000
    });

    console.log("First Query button became visible:", elapsed(buttonStarted));

    const details = await locator.evaluateAll((buttons) =>
      buttons.map((button, index) => {
        const rect = button.getBoundingClientRect();
        const style = getComputedStyle(button);

        return {
          index,
          text: button.innerText,
          visible:
            rect.width > 0 &&
            rect.height > 0 &&
            style.visibility !== "hidden" &&
            style.display !== "none",
          disabled: button.disabled,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          html: button.outerHTML.slice(0, 250)
        };
      })
    );

    console.log("Query button details:");
    console.log(JSON.stringify(details, null, 2));
  } catch (error) {
    console.log("Query button did not become visible:", error.message);

    console.log(
      "Page title:",
      await page.title().catch(() => "Unavailable")
    );

    console.log(
      "Page text preview:",
      (await page.locator("body").innerText().catch(() => ""))
        .slice(0, 1500)
    );
  }

  console.log("Total diagnostic time:", elapsed(started));
} catch (error) {
  console.error("Diagnostic failed:", error.message);
} finally {
  if (browser) {
    try {
      await browser.close();
    } catch {}
  }

  if (client && session) {
    try {
      await client.sessions.update(session.id, {
        status: "REQUEST_RELEASE"
      });
    } catch (error) {
      console.warn("Session release warning:", error.message);
    }
  }
}
