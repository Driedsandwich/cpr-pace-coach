import { chromium } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parseSessionResult } from "../dist/src/result.js";
const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
  ],
});
const output = process.argv[2];
if (!output)
  throw new Error(
    "Usage: node scripts/model-smoke.mjs /absolute/artifact/directory [finite-video-fixture]",
  );
await mkdir(output, { recursive: true });
const log = {
  errors: [],
  requests: [],
  externalResponses: [],
  blocked: [],
  camera: "",
  video: "",
};
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => log.errors.push(e.message));
  page.on("request", (r) => {
    if (!r.url().startsWith("http://127.0.0.1:4174/"))
      log.requests.push({ method: r.method(), url: r.url() });
  });
  page.on("response", (response) => {
    if (
      /^https?:/.test(response.url()) &&
      !response.url().startsWith("http://127.0.0.1:4174/")
    )
      log.externalResponses.push({
        method: response.request().method(),
        url: response.url(),
        status: response.status(),
      });
  });
  await page.addInitScript(() => {
    window.privacyViolations = [];
    document.addEventListener("securitypolicyviolation", (event) =>
      window.privacyViolations.push({
        blockedURI: event.blockedURI,
        effectiveDirective: event.effectiveDirective,
      }),
    );
  });
  page.on("console", (m) => {
    if (m.type() === "error") console.log("Browser:", m.text());
  });
  await page.goto("http://127.0.0.1:4174/cpr-pace-coach/");
  await page.getByRole("button", { name: "Start with camera" }).click();
  await page.getByRole("button", { name: "Enable camera" }).click();
  await Promise.race([
    page
      .getByText("Camera ready · check your framing")
      .waitFor({ timeout: 60000 }),
    page.getByRole("alert").waitFor({ timeout: 60000 }),
  ]);
  if (await page.getByRole("alert").count())
    throw new Error(await page.getByRole("alert").textContent());
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Begin 2-minute practice" }).click();
  await page.waitForTimeout(3500);
  log.camera = {
    label: await page.locator(".rate-status").textContent(),
    elapsed: await page.locator("progress").getAttribute("value"),
    expected:
      "Synthetic color-bar camera has no human pose; tracking should be unavailable.",
  };
  await page.getByRole("button", { name: "End practice" }).click();
  await page.getByRole("button", { name: "Practice again" }).click();
  // Generate a finite, all-synthetic WebM from canvas. No real images or people.
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext("2d");
    const stream = canvas.captureStream(15);
    const chunks = [];
    const recorder = new MediaRecorder(stream, {
      mimeType: "video/webm;codecs=vp8",
    });
    recorder.ondataavailable = (event) => chunks.push(event.data);
    const done = new Promise((resolve) => {
      recorder.onstop = async () =>
        resolve(
          Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer())),
        );
    });
    let t = 0;
    recorder.start();
    const timer = setInterval(() => {
      ctx.fillStyle = "#f3f4f6";
      ctx.fillRect(0, 0, 320, 240);
      ctx.fillStyle = "#c9364f";
      ctx.fillRect(120, 80 + Math.sin(t++ / 2) * 15, 80, 80);
    }, 1000 / 15);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    clearInterval(timer);
    recorder.stop();
    stream.getTracks().forEach((t) => t.stop());
    return done;
  });
  // Chromium supplies duration here; an optional finite fixture can also be passed.
  const raw = `${output}/synthetic-input.webm`;
  await writeFile(raw, Buffer.from(bytes));
  console.log("CAMERA", JSON.stringify(log.camera));
  console.log("SYNTHETIC_INPUT", raw);
  await page.locator("input[type=file]").setInputFiles(process.argv[3] || raw);
  await Promise.race([
    page
      .getByRole("heading", { name: "A little practice, in perspective." })
      .waitFor({ timeout: 60000 }),
    page.getByRole("alert").waitFor({ timeout: 60000 }),
  ]);
  if (await page.getByRole("alert").count())
    throw new Error(await page.getByRole("alert").textContent());
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export JSON", exact: true })
    .first()
    .click();
  const downloaded = await downloading;
  const data = JSON.parse(await readFile(await downloaded.path(), "utf8"));
  parseSessionResult(data.session);
  if (
    data.source !== "imported_video" ||
    data.is_demo ||
    data.session.rate.averageCpm !== null ||
    data.session.pauses.totalMs !== 0
  )
    throw new Error("Incorrect synthetic no-pose video result");
  await downloaded.saveAs(`${output}/synthetic-video-result.json`);
  log.video = {
    status: data.status,
    durationMs: data.session.durationMs,
    unknownMs: data.session.activity.unknownMs,
    averageCpm: data.session.rate.averageCpm,
    pauseMs: data.session.pauses.totalMs,
  };
  console.log("VIDEO", JSON.stringify(log.video));
  log.blocked = await page.evaluate(() => window.privacyViolations);
  if (
    log.externalResponses.some(
      (r) =>
        r.method !== "GET" ||
        !r.url.startsWith("https://storage.googleapis.com/mediapipe-models/"),
    )
  )
    throw new Error("Unexpected external network response");
} catch (e) {
  log.errors.push(e.message);
  console.log("SMOKE ERROR", e.message);
  process.exitCode = 1;
} finally {
  await writeFile(`${output}/model-smoke.json`, JSON.stringify(log, null, 2));
  await browser.close();
}
