# Local CPR practice core

A small TypeScript package for a student medical hackathon: a camera-landmark rhythm coach for chest-compression practice on a **manikin or cushion**. No UI is included. Processing is local to the browser; video is not sent off the device. The Node demo and evaluation use only synthetic numeric landmarks. The separate MCP process receives summary JSON only.

**Practice tool only. In a real emergency, call your local emergency number and follow the dispatcher.**

This is an unvalidated practice prototype. It does not decide whether somebody can save a life, assess a patient, or certify CPR competence.

## Run

Use Node.js 22.12+, 24.x or 26+ and npm (matching the Vitest engine range). Commands run from this package directory:

```sh
npm ci
npm test
npm run typecheck
npm run build
npm start            # two-minute synthetic practice -> JSON + short English text
npm run eval         # regenerate measured tables and raw evaluation data
npm run schema       # regenerate schema/session.schema.json
```

All direct dependency versions are exact and the lockfile is committed. The official MCP TypeScript server SDK is pinned to `@modelcontextprotocol/server` **2.4.0**; its client at 2.4.0 is a test dependency. This is the SDK's v2 package layout, documented in the [official SDK repository](https://github.com/modelcontextprotocol/typescript-sdk). MediaPipe Tasks Vision is pinned to **1.2.2**.

## Files and API

- `src/detector.ts`: one-frame-at-a-time signal processing, events and live metrics.
- `src/session.ts`: two-minute recording, result JSON and short English text.
- `src/result.ts`: exported TypeScript result type, Zod structural schema and cross-field validation.
- `schema/session.schema.json`: generated JSON Schema, draft 2020-12.
- `src/synth.ts`: deterministic numeric-landmark generator with ground truth.
- `src/video.ts`: local recorded-file adapter, sequential HTMLVideoElement seeks.
- `mcp/server.ts`: stdio tools; `mcp/logic.ts`: deterministic summary/comparison functions.
- `test/`: Vitest tests, including a real local MCP stdio client/server roundtrip.
- `eval/RESULTS.md`, `eval/results.json`: measured results and reproducible options.
- `eval/example-session.json`: a valid result ready to supply to an MCP tool.

A future browser UI can import the TypeScript sources through a bundler or the built exports after `npm run build`:

```ts
import { PracticeSession } from './src/session.js';

const session = new PracticeSession({
  startTimeMs: 0,
  aspectRatio: 1280 / 720, // use the actual video dimensions
  bentAngleDeg: 160,
});

// Once per decoded camera frame. Use media time in ms relative to session start.
// Pass [] if no pose or multiple people are detected. Keep sending frames during
// stillness/missing tracking; stopping calls makes that time unknown.
function acceptPose(timestampMs: number, landmarks: Parameters<typeof session.addFrame>[0]['landmarks']) {
  const live = session.addFrame({ timestampMs, landmarks });
  if (live.compression) console.log(live.compression.timestampMs);
  return live; // latest-five rate, whole-session rate/CV, elbows, visibility, pauses
}

// At the two-minute boundary; early recordings should pass their actual end time.
// const { json, text } = session.finish(120000);
```

Timestamps must be finite, nonnegative, strictly increasing, and in one timebase. `PracticeSession` rejects frames beyond start + 120000 ms and further writes after `finish`. It accepts a frame exactly at the endpoint. Default `finish()` ends at the last supplied frame; no unseen time is invented. `completed` means the recording duration reached two minutes, not that tracking or technique was adequate. `CompressionDetector` can also be used independently for a longer stream.

The input is structurally compatible with `PoseLandmarkerResult.landmarks[0]`: a 33-element normalized landmark array (only indices 11–16 are read). Each used point needs finite x/y within [0,1] and visibility at least 0.6. z is ignored. Missing points, low visibility and nearly coincident shoulders suppress detection and flag unavailable tracking. Degenerate elbow vectors produce null angles. Choose one practicing person; the video adapter rejects frames with anything other than exactly one detected pose.

## What the numbers mean

The signal is mean wrist image-y displacement divided by projected shoulder width, with x scaled by the image width/height ratio. Shoulder width has a 500 ms time-constant smoother. Wrist displacement is relative to a fixed origin in each uninterrupted visible segment; subtracting moving shoulders could cancel the desired motion. A causal three-sample median rejects isolated outliers, followed by a time-aware exponential smoother (45 ms). A valley-to-peak excursion of at least 0.10 shoulder widths and a 0.025 reversal confirm a downward-motion maximum. Accepted peaks must be at least 300 ms apart.

A `Compression` contains the filtered peak's `timestampMs` and later `detectedAtMs`. There is no speculative event before reversal and no final extrapolated peak. Filter/reversal delay is measured in `eval/RESULTS.md`; timestamps are not corrected for that delay. This counts periodic wrist motion, not verified physical chest contact.

| Field | Definition |
|---|---|
| `recentRateCpm` | 60000 / mean of four intervals spanning the latest five events in the current continuous run; null until five events, after a pause, or during missing tracking |
| `averageRateCpm` / result `rate.averageCpm` | 60000 / mean of all valid inter-event intervals; excludes pause-spanning and unknown intervals; not total count divided by two minutes |
| `rhythmCv` | Population standard deviation / mean of valid intervals; null with fewer than two intervals; `recentRhythmCv` uses up to four latest intervals |
| `rate.inTargetFraction` | Number of valid per-event interval rates inclusively within 100–120 divided by `evaluableCount`; first event of each run has no rate and is excluded |
| `pauses` | Fully observed event-free gaps of at least 2000 ms, including observed leading/trailing stillness; the **whole gap**, not just time beyond two seconds, is counted |
| `activity.activeMs` | Sum of intervals below 2000 ms bounded by consecutive detected events in the same visible segment |
| `activity.chestCompressionFraction` | Conservative camera-derived estimate: `activeMs / durationMs`; unknown time is not credited as compression time |
| `activity.observedCompressionFraction` | `activeMs / observedMs`, provided separately so missing footage is explicit |
| `activity.unknownMs` | Time without two consecutive valid frames no more than 250 ms apart; includes unobserved recording tails |
| `arms.bothStraightFraction` | Time both projected elbows meet the configured threshold / arm-observed time; null without arm observations |

The active-time estimate omits unbounded partial cycles at the start/end of each observed segment. Short unbounded edges are neither confirmed active time nor qualifying pauses. Therefore `activeMs + pauseMs` need not equal `observedMs`. A detected pause spans peak to peak and may exceed the actual physical stop by surrounding partial cycles. Current trailing pauses are provisional until movement resumes; `ongoing` is available on detector snapshots. Missing intervals split observed spans rather than count as pauses, so an actual stop interrupted by tracking loss may be fragmented or unavailable.

Left/right elbow angles are **2D projected angles**, aspect-ratio corrected, in degrees (180 = straight). `leftBent` / `rightBent` compare against `bentAngleDeg` (default 160; a prototype setting, not a guideline-derived medical cutoff). Mean angles use time-weighted trapezoidal integration; the straight-arm time uses the previous frame's flag over each valid frame interval. Visibility gaps and invalid angles contribute no arm-observed time. Fractions are 0–1, not percentages; unavailable values are null, never fabricated zeros. Pause endpoints in session JSON are relative to session start; detector events use the caller's timebase.

`SessionResult` is inferred directly from `SessionResultSchema`, which also generates the JSON Schema. Use `parseSessionResult(unknown)` at trust boundaries: in addition to structural validation it checks counts, fractions, timing totals and ordered pause intervals. Cross-field arithmetic rules are not expressible in the generated JSON Schema alone. MCP runs this validation too.

## Measured and intentionally not measured

Measured: wrist-cycle timing, cadence, interval variability, observable interruptions, a conservative compression-fraction estimate, projected elbow angles and missing-landmark flags.

Not measured: compression depth, force, recoil, hand placement, ventilation, circulation, survival probability or real-world CPR effectiveness. A single uncalibrated camera and estimated pose do not establish metric chest displacement. The official model card also lists metric-accurate depth applications as out of scope. The approximate “40% depth accuracy” figure in the project brief was not verified against an identified original study and is not presented here as an established statistic.

Camera motion, zoom, perspective, arm occlusion, poor lighting, body translation and unrelated periodic movement can cause errors. This design assumes a stable camera with wrist motion visible along the image's vertical axis and sufficient projected shoulder separation. It is not rotation-invariant. Synthetic data exercise the detector after pose estimation; they do not measure MediaPipe or camera accuracy. Frame quantization alone gives nonzero observed CV for perfectly periodic motion.

## Recorded-video example (browser only)

No browser automation, real-person footage, or photographs were used in development. The adapter is type-checked, but was **not run in a browser**. This example is integration guidance for a future UI.

Host the installed package's `node_modules/@mediapipe/tasks-vision/wasm` directory at `/vendor/mediapipe/wasm` on your own origin. Obtain a Pose Landmarker `.task` bundle from the [official model bundle table](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker) separately, respecting its license. No weights are bundled here. Bundle the npm JavaScript locally; do not use a third-party CDN for runtime assets.

```ts
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { analyzeVideoFile } from './src/video.js';

// Local File values supplied by your future UI. Use an appropriate synthetic
// recording or manikin-only footage when validating this integration.
async function analyze(videoFile: File, modelFile: File) {
  const vision = await FilesetResolver.forVisionTasks('/vendor/mediapipe/wasm');
  // Create a NEW instance for every file: MediaPipe video timestamps must increase.
  const pose = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetBuffer: new Uint8Array(await modelFile.arrayBuffer()) },
    runningMode: 'VIDEO',
    numPoses: 2, // lets the adapter reject ambiguous multi-person frames
    outputSegmentationMasks: false,
  });
  const controller = new AbortController(); // wire controller.abort() to future UI
  try {
    return await analyzeVideoFile(videoFile, pose, {
      fps: 30, // set to the source frame rate when known
      signal: controller.signal,
      onFrame: snapshot => console.log(snapshot.recentRateCpm),
    });
  } finally {
    pose.close();
  }
}
```

The adapter makes a detached `HTMLVideoElement`, loads a local blob URL, pauses playback, seeks sequentially at `index / fps`, waits for `seeked`, and synchronously calls `detectForVideo(video, timestampMs)`. It analyzes at most the first two minutes and reports shorter files as incomplete. It cleans up listeners and the blob URL on success, decoding errors, timeouts and cancellation. The caller owns the PoseLandmarker instance. Progress is yielded between inference calls, but each call still blocks the main thread; a future UI may need a worker/decoded-frame integration.

HTMLVideoElement seeking samples a time grid; it **does not guarantee enumeration of every encoded frame**, especially for variable-frame-rate files or when the selected FPS differs from the source. Duplicate/skipped source frames can affect measurements. For exact container-frame enumeration, a demuxer plus WebCodecs would be needed (not included). There is no inference at the exact file end; the final unsampled fraction of a frame is reported as unknown. Do not run concurrent analyses with the same PoseLandmarker instance.

## MCP tools

Build first, then start the local stdio server:

```sh
npm run build
node dist/mcp/server.js
# Development alternative:
npm run --silent mcp
```

Configure a generic MCP client to launch `node` with the absolute path to `dist/mcp/server.js` as its argument. Stdout is reserved for protocol messages. No HTTP listener, API key or AI service is needed; outputs are deterministic English coaching text and numeric comparisons.

- `summarize_session`: arguments `{ "session": <SessionResult> }`; returns a summary, `nextPracticeGoals` and the practice notice.
- `compare_sessions`: arguments `{ "before": <SessionResult>, "after": <SessionResult> }`; returns differences **after minus before**, with null when either value is unavailable. Target-band and arm fractions use percentage-point differences; CCF uses a 0–1 fraction difference. Different arm thresholds disable the straight-arm comparison.

For example, load `eval/example-session.json` as the `session` value. Comparing that JSON against itself yields zero differences. Different recording lengths and unknown time are disclosed. Faster is not automatically better: the tool evaluates the target band rather than ranking clinical performance. Both tools are annotated read-only and reject structurally invalid or inconsistent results.

## Privacy

The detector/session modules accept numbers and have no networking or persistence. The video adapter accepts a local File, uses a blob URL and passes frames to the browser's local MediaPipe inference. It contains no upload, analytics, fetch or telemetry code. Local model/WASM hosting avoids third-party asset requests during analysis; installing npm dependencies and separately downloading models are setup network activities. No real-person images, video datasets or model weights are included in this package.

MCP operates in a separate local Node process on result JSON, never raw video or landmarks. Its stdio response goes to the client that called it. An external AI client can have its own data policy; invoking these tools does not authorize video transfer. Keep future UI/integration code free of uploads and third-party analytics to preserve this privacy design. Actual browser network behavior has not been audited in this environment.

## Target sources and licensing

Sources checked on 2026-11-09:

1. [AHA 2025 Adult Basic Life Support, section 7.3](https://cpr.heart.org/en/resuscitation-science/cpr-and-ecc-guidelines/adult-basic-life-support): recommends adult chest-compression rate **100–120/min**. This supplies the inclusive practice target, not proof of clinical adequacy.
2. [ERC Guidelines 2025 Adult Basic Life Support](https://www.erc.edu/media/wrhj5sye/gl2025-04-bls-e.pdf): “Compress the chest at a rate of 100–120 min−1 with as few interruptions as possible.” and “Keep your arms straight.” These support the rate/interruption and straight-arm practice cues; ERC does not supply the prototype's 160° image-angle cutoff.
3. [Google MediaPipe source LICENSE](https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE): MediaPipe code is **Apache-2.0**.
4. [Google's official BlazePose GHUM 3D model card, dated April 16, 2021](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf), page 2: explicitly states **“Apache License, Version 2.0”**. The [official Pose Landmarker model bundle table](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker) links this card for Lite, Full and Heavy bundles. Thus the linked model documentation confirms Apache-2.0 for the described models; this is separate evidence from the code license. The card is not a per-file license inventory of each modern `.task` archive (which contains detection and landmark components); coverage of every constituent was not independently verified. No model archive is redistributed here. The card also excludes metric-accurate depth and life-critical decisions.
5. [Official MediaPipe Web API guidance](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/web_js): VIDEO mode and monotonically increasing millisecond timestamps for `detectForVideo`.

Original code in this package is **MIT**, see `LICENSE`. Third-party dependencies and any separately obtained models retain their own licenses; MIT here does not relicense them.

## Validation and remaining work

`npm test` covers synthetic 90/110/130 cpm, noise/spikes, sampling rates, jitter, pauses including leading/trailing stillness, missing points/dropped frames, elbow angles/thresholds/aspect ratios, timestamp/configuration rejection, session boundaries, JSON validation, schema synchronization and both MCP tools over stdio. Reproduce the numerical tables with `npm run eval`; raw unrounded values are retained in `eval/results.json`.

The measured average-rate errors for the three constant-rate noise/spike cases are 0.000, 0.011 and 0.006 cpm (rounded). This is synthetic algorithm testing, not real-world accuracy. Two imposed stops totaling 8.000 s produce two detected pauses totaling 9.367 s because of peak-to-peak boundaries. The evaluator also reports peak-time error, emission latency, CV error, missed events during tracking loss and projected elbow flags.

Remaining integration work: UI/camera acquisition, browser video smoke testing, frame-accurate variable-rate decoding if required, and independent validation of camera/pose errors. No deployment, push, external application writes or real-person imagery were used.
