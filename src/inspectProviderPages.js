import "dotenv/config";
import Steel from "steel-sdk";
import { chromium } from "playwright";
import { PROVIDERS } from "./providers.js";

const TARGETS = PROVIDERS.filter(provider =>
  ["airtel", "bsnl"].includes(provider.id)
);

async function inspectProvider(provider) {
  let session;
  let browser;

  console.log(`\n========== ${provider.name} ==========`);

  try {
    const apiKey = process.env.STEEL_API_KEY;

    if (!apiKey) {
      throw new Error("STEEL_API_KEY is missing from .env");
    }

    const client = new Steel({ steelAPIKey: apiKey });

    session = await client.sessions.create({ timeout: 120000 });

    browser = await chromium.connectOverCDP(
      `${session.websocketUrl}&apiKey=${apiKey}`
    );

    const context = browser.contexts()[0];
    const page = context.pages()[0] ?? await context.newPage();

    await page.goto(provider.url, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    // Allow dynamically rendered content and embedded widgets to load.
    await page.waitForTimeout(8000);

    const details = await page.evaluate(() => ({
      title: document.title,
      currentUrl: location.href,
      frames: Array.from(document.querySelectorAll("iframe")).map(frame => ({
        title: frame.title || null,
        src: frame.src || null
      })),
      bodyText: (document.body?.innerText || "").slice(0, 12000),
      links: Array.from(document.querySelectorAll("a"))
        .map(link => ({
          text: (link.innerText || "").trim(),
          href: link.href
        }))
        .filter(link =>
          /plan|broadband|fiber|fibre|tariff/i.test(
            `${link.text} ${link.href}`
          )
        )
        .slice(0, 40)
    }));

    console.log(JSON.stringify({
      provider: provider.name,
      sessionCreated: true,
      title: details.title,
      currentUrl: details.currentUrl,
      frames: details.frames,
      relevantLinks: details.links,
      bodyText: details.bodyText
    }, null, 2));
  } catch (error) {
    console.error("Inspection failed:", error.message);
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {}
    }

    if (session) {
      try {
        const client = new Steel({
          steelAPIKey: process.env.STEEL_API_KEY
        });
        await client.sessions.release(session.id);
        console.log("Steel session released.");
      } catch (error) {
        console.error("Session release warning:", error.message);
      }
    }
  }
}

for (const provider of TARGETS) {
  await inspectProvider(provider);
}
