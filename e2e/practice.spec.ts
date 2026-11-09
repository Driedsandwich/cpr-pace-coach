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
  expect(session.pauses.totalMs).toBe(0);
  expect(session.rate.averageCpm).toBeGreaterThan(109);
  expect(session.rate.averageCpm).toBeLessThan(111);
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
