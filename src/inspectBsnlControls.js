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

  await page.goto(provider.url, {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });
  await page.waitForTimeout(8000);

  const controls = await page.evaluate(() => ({
    selects: Array.from(document.querySelectorAll("select")).map((el, index) => ({
      index,
      name: el.name || null,
      id: el.id || null,
      label: el.labels?.[0]?.innerText?.trim() || null,
      value: el.value,
      options: Array.from(el.options).map(o => ({
        text: o.text.trim(),
        value: o.value
      }))
    })),
    inputs: Array.from(document.querySelectorAll("input")).map(el => ({
      type: el.type,
      name: el.name || null,
      id: el.id || null,
      placeholder: el.placeholder || null,
      value: el.value || null
    })),
    buttons: Array.from(document.querySelectorAll("button")).map(el => ({
      text: el.innerText.trim(),
      disabled: el.disabled,
      type: el.type
    })),
    bodyText: (document.body?.innerText || "").slice(0, 6000)
  }));

  console.log(JSON.stringify(controls, null, 2));
} catch (error) {
  console.error("BSNL inspection failed:", error.message);
} finally {
  if (browser) {
    try { await browser.close(); } catch {}
  }
  if (session) {
    try { await client.sessions.release(session.id); }
    catch (error) {
      console.error("Session release warning:", error.message);
    }
  }
}
