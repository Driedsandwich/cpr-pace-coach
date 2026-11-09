import { test, expect } from "@playwright/test";
import { parseSessionResult } from "../src/result";
import { readFile } from "node:fs/promises";

test("demo uses the detector, completes at two running minutes, and exports MCP-compatible results", async ({
  page,
}) => {
  const external: string[] = [];
  page.on("request", (request) => {
    if (!request.url().startsWith("http://127.0.0.1:4173/"))
      external.push(request.url());
  });
  await page.clock.install();
  await page.goto("./");
  await page.getByRole("button", { name: "Try demo", exact: false }).click();
  await page.clock.fastForward(84000);
  await expect(
    page.getByText("Simulated motion", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("On target", { exact: true })).toBeVisible();
  const currentRate = Number(
    await page.locator(".gauge-reading strong").textContent(),
  );
  expect(currentRate).toBeGreaterThanOrEqual(100);
  expect(currentRate).toBeLessThanOrEqual(120);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const before = await page.locator("progress").getAttribute("value");
  await page.clock.fastForward(10000);
  expect(await page.locator("progress").getAttribute("value")).toEqual(before);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await page.clock.fastForward(37000);
  await expect(
    page.getByRole("heading", { name: "A little practice, in perspective." }),
  ).toBeVisible();
  await expect(page.getByText("Completed", { exact: true })).toBeVisible();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export JSON", exact: true })
    .first()
    .click();
  const file = await (await download).path();
  const result = JSON.parse(await readFile(file!, "utf8"));
  expect(result.source).toBe("demo");
  expect(result.is_demo).toBe(true);
  expect(result.paused_ms).toBeGreaterThanOrEqual(10000);
  expect(result.privacy).toEqual({
    raw_video_included: false,
    pose_coordinates_included: false,
  });
  const session = parseSessionResult(result.session);
  expect(session.durationMs).toBe(120000);
  expect(session.compressionCount).toBeGreaterThan(200);
  expect(session.pauses.count).toBe(1);
  expect(session.pauses.totalMs).toBeGreaterThanOrEqual(3000);
  expect(session.rate.inTargetFraction).toBeLessThan(0.9);
  expect(session.arms.bothStraightFraction).toBeCloseTo(110 / 120, 2);
  expect(session.rate.averageCpm).toBeGreaterThan(105);
  expect(session.rate.averageCpm).toBeLessThan(115);
  expect(external).toEqual([]);
});

test("early end preserves unavailable values, and schema links work under Pages base", async ({
  page,
}) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Try demo", exact: false }).click();
  await page.getByRole("button", { name: "End practice" }).click();
  await expect(page.getByText("Ended early", { exact: true })).toBeVisible();
  await page.getByText("For AI agents", { exact: false }).click();
  await expect(
    page.getByText("summarize_session", { exact: true }),
  ).toBeVisible();
  for (const name of ["Export schema ↗", "Session schema ↗"]) {
    const url = await page.getByRole("link", { name }).getAttribute("href");
    const response = await page.request.get(url!);
    expect(response.ok()).toBe(true);
    expect(await response.json()).toHaveProperty("$schema");
  }
});

test("390px layout, keyboard entry, sound controls and no horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("./");
  const demo = page.getByRole("button", { name: "Try demo", exact: false });
  await demo.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByText("Simulated motion", { exact: true }),
  ).toBeVisible();
  const beat = page.getByRole("button", { name: /Beat off/ });
  await beat.click();
  await expect(page.getByRole("button", { name: /Beat on/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Resume", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  for (const button of await page.locator(".practice-controls button").all()) {
    const box = await button.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  await expect(
    page.getByText("Practice tool only.", { exact: false }),
  ).toBeVisible();
});

test("camera model download failure releases camera and provides a working demo", async ({
  page,
}) => {
  await page.route("https://storage.googleapis.com/**", (route) =>
    route.abort("failed"),
  );
  await page.goto("./");
  await page.getByRole("button", { name: "Start with camera" }).click();
  await page.getByRole("button", { name: "Enable camera" }).click();
  await expect(page.getByRole("alert")).toContainText("Camera unavailable", {
    timeout: 30000,
  });
  await expect(
    page.getByRole("button", { name: "Begin 2-minute practice" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Try demo instead" }).click();
  await expect(
    page.getByText("Simulated motion", { exact: true }),
  ).toBeVisible();
});

test("import model failure and cancellation return safely to the entry screen", async ({
  page,
}) => {
  await page.route("https://storage.googleapis.com/**", (route) =>
    route.abort("failed"),
  );
  await page.goto("./");
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "synthetic.webm",
      mimeType: "video/webm",
      buffer: Buffer.from("invalid clip"),
    });
  await expect(page.getByRole("alert")).toContainText(
    "Could not analyze this video",
  );
  await expect(
    page.getByRole("button", { name: "Try demo", exact: false }),
  ).toBeVisible();
  await page.unroute("https://storage.googleapis.com/**");
  await page.route("https://storage.googleapis.com/**", () => {});
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "synthetic.webm",
      mimeType: "video/webm",
      buffer: Buffer.from("invalid clip"),
    });
  await page.getByRole("button", { name: "Cancel analysis" }).click();
  await expect(
    page.getByRole("button", { name: "Try demo", exact: false }),
  ).toBeVisible();
});


test("demo coaching follows the detected practice story", async ({ page }) => {
  await page.clock.install();
  await page.goto("./");
  await page.getByRole("button", { name: "Try demo", exact: false }).click();
  let elapsed = 0;
  for (const [at, cue] of [
    [10000, "Keep a steady rhythm"], [50000, "Push faster"],
    [68000, "Keep a steady rhythm"], [72300, "Resume compressions"],
    [80000, "Keep a steady rhythm"], [95000, "Keep your arms straight"],
    [115000, "Slow down a little"],
  ] as const) {
    await page.clock.fastForward(at - elapsed);
    elapsed = at;
    await expect(page.locator(".coach-cue")).toHaveText(cue);
    if (at === 72300) await expect(page.locator(".metrics > div").nth(1).locator("strong")).not.toHaveText("0.0 s");
  }
});

test("unavailable voice is quiet and gauge text stays separate at narrow desktop widths", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "speechSynthesis", { value: {
      getVoices: () => [], addEventListener() {}, removeEventListener() {}, cancel() {},
    } });
  });
  await page.clock.install();
  await page.goto("./");
  await page.getByRole("button", { name: "Try demo", exact: false }).click();
  await page.clock.fastForward(10000);
  await expect(page.getByRole("button", { name: "Voice (unavailable on this device)", exact: true })).toBeDisabled();
  for (const [width, height] of [[1440, 900], [1280, 720], [1100, 800], [1024, 768], [900, 700], [390, 844]]) {
    await page.setViewportSize({ width: width!, height: height! });
    const status = await page.locator(".rate-status").boundingBox();
    const estimate = await page.locator(".gauge-bottom").boundingBox();
    expect(estimate!.y).toBeGreaterThanOrEqual(status!.y + status!.height + 4);
    const cue = await page.locator(".coach-cue").boundingBox();
    expect(estimate!.y + estimate!.height).toBeLessThanOrEqual(cue!.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  }
});

test("result times use the viewer locale and timezone", async ({ browser }) => {
  const context = await browser.newContext({ locale: "en-GB", timezoneId: "Asia/Tokyo" });
  const page = await context.newPage();
  try {
    await page.goto("http://127.0.0.1:4173/cpr-pace-coach/");
    await page.getByRole("button", { name: "Try demo", exact: false }).click();
    await page.getByRole("button", { name: "End practice" }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export JSON", exact: true }).first().click();
    const result = JSON.parse(await readFile((await (await download).path())!, "utf8"));
    const expected = await page.evaluate(({ started_at, ended_at }) =>
      [started_at, ended_at].map(t => new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })).join(" – "), result);
    await expect(page.locator(".result-meta > span").last()).toHaveText(expected);
    expect(expected).not.toMatch(/AM|PM/);
  } finally { await context.close(); }
});
