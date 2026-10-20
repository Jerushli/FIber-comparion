
import Steel from "steel-sdk";
import { chromium } from "playwright";
import { PROVIDERS } from "./providers.js";

async function main() {
  const apiKey = process.env.STEEL_API_KEY;

  if (!apiKey) {
    throw new Error("STEEL_API_KEY is missing from your local environment.");
  }

  const provider = PROVIDERS.find((item) => item.id === "airtel");

  if (!provider) {
    throw new Error("Airtel provider configuration was not found.");
  }

  const client = new Steel({ steelAPIKey: apiKey });
  let session;
  let browser;

  try {
    console.log("Creating temporary browser session...");

    session = await client.sessions.create({ timeout: 120000 });

    browser = await chromium.connectOverCDP(
      `${session.websocketUrl}&apiKey=${apiKey}`
    );

    const context = browser.contexts()[0];
    const page = context.pages()[0] ?? await context.newPage();

    const relevantResponses = [];

    page.on("response", (response) => {
      const url = response.url();

      if (
        /airtel|broadband|plan|widget|acquire-new/i.test(url) &&
        !/\.(png|jpg|jpeg|gif|svg|woff2?)(\?|$)/i.test(url)
      ) {
        relevantResponses.push({
          status: response.status(),
          url: url.slice(0, 350)
        });
      }
    });

    console.log("Opening Airtel's live plans page...");

    await page.goto(provider.url, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await page.waitForTimeout(8000);

    console.log("\n--- PAGE TITLE ---");
    console.log(await page.title());

    console.log("\n--- FRAME URLS ---");

    for (const frame of page.frames()) {
      console.log({
        url: frame.url(),
        name: frame.name()
      });
    }

    console.log("\n--- MAIN PAGE VISIBLE TEXT ---");
    console.log(
      (await page.locator("body").innerText().catch(() => "Unavailable"))
        .slice(0, 5000)
    );

    console.log("\n--- BUTTONS AND INPUTS ---");

    console.log(
      await page.locator("button, input, select, [role='button']")
        .evaluateAll((elements) =>
          elements.slice(0, 80).map((element) => ({
            tag: element.tagName,
            text: (element.innerText || element.textContent || "")
              .trim()
              .slice(0, 120),
            ariaLabel: element.getAttribute("aria-label"),
            placeholder: element.getAttribute("placeholder"),
            type: element.getAttribute("type"),
            name: element.getAttribute("name")
          }))
        )
        .catch(() => [])
    );

    console.log("\n--- FRAME TEXT ---");

    for (const frame of page.frames()) {
      try {
        const text = await frame.locator("body").innerText({
          timeout: 5000
        });

        console.log(`\nFRAME: ${frame.url()}`);
        console.log(text.slice(0, 5000) || "(No visible text)");
      } catch (error) {
        console.log(`\nFRAME: ${frame.url()}`);
        console.log(`Could not read frame text: ${error.message}`);
      }
    }

    console.log("\n--- RELEVANT NETWORK RESPONSES ---");
    console.log(JSON.stringify(relevantResponses, null, 2));

    console.log("\nDiagnostic complete.");
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {}
    }

    if (session) {
      try {
        await client.sessions.release(session.id);
      } catch {}
    }
  }
}

main().catch((error) => {
  console.error("Airtel diagnostic failed:", error.message);
  process.exitCode = 1;
});
