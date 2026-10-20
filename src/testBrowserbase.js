
import "dotenv/config";
import Browserbase from "@browserbasehq/sdk";
import { chromium } from "playwright";

const apiKey = process.env.BROWSERBASE_API_KEY;
const projectId = process.env.BROWSERBASE_PROJECT_ID;

if (!apiKey || !projectId) {
  throw new Error(
    "Set BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID in .env."
  );
}

const client = new Browserbase({ apiKey });

let browser;

try {
  const session = await client.sessions.create({
    projectId,
    api_timeout: 120
  });

  console.log("Browserbase session created successfully.");

  browser = await chromium.connectOverCDP(session.connectUrl);

  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? await context.newPage();

  await page.goto("https://example.com", {
    waitUntil: "domcontentloaded",
    timeout: 30000
  });

  console.log("Browser title:", await page.title());
  console.log("Browserbase connection test passed.");
  console.log("Session ID:", session.id);
} catch (error) {
  console.error("Browserbase test failed:", error.message);
  process.exitCode = 1;
} finally {
  if (browser) {
    try {
      await browser.close();
    } catch {}
  }
}
