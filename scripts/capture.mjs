import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const output = process.argv[2];
if (!output)
  throw new Error(
    "Usage: node scripts/capture.mjs /absolute/artifact/directory",
  );
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  const externalRequests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (!request.url().startsWith("http://127.0.0.1:4174/"))
      externalRequests.push(request.url());
  });
  await page.clock.install();
  await page.goto("http://127.0.0.1:4174/cpr-pace-coach/");
  await page.screenshot({
    path: path.join(output, "welcome-desktop.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Try demo", exact: false }).click();
  await page.clock.fastForward(84000);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100));
  await page.screenshot({
    path: path.join(output, "demo-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: path.join(output, "demo-mobile.png"),
    fullPage: true,
  });
  await page.clock.fastForward(37000);
  await page
    .getByRole("heading", { name: "A little practice, in perspective." })
    .waitFor();
  await page.screenshot({
    path: path.join(output, "results-mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: path.join(output, "results-desktop.png"),
    fullPage: true,
  });
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export JSON", exact: true })
    .first()
    .click();
  await (await downloading).saveAs(path.join(output, "demo-session.json"));
  await writeFile(
    path.join(output, "capture-checks.json"),
    JSON.stringify(
      {
        viewportDesktop: [1440, 1000],
        viewportMobile: [390, 844],
        clock:
          "Browser clock advanced; real synth frames processed by unchanged detector. UI not patched.",
        errors,
        externalRequests,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ output, errors, externalRequests }));
} finally {
  await browser.close();
}
