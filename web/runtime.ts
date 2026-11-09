import type { PoseLandmarker } from "@mediapipe/tasks-vision";
import {
  PracticeSession,
  PRACTICE_NOTICE,
  type SessionResult,
} from "../src/session";
import {
  DEFAULT_CONFIG,
  type DetectorSnapshot,
  type Landmark,
} from "../src/detector";
import { synthesizeDemo } from "../src/synth";
import { analyzeVideoFile } from "../src/video";

export type Source = "demo" | "camera" | "imported_video";
export const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
export interface ExportResult {
  schema_version: "1.0";
  session_id: string;
  is_demo: boolean;
  source: Source;
  status: "completed" | "ended_early";
  started_at: string;
  ended_at: string;
  paused_ms: number;
  measurement: {
    kind: "simulated_motion" | "camera_estimate";
    model: string | null;
    sdk_version: string | null;
    valid_tracking_fraction: number | null;
    metric_config: typeof DEFAULT_CONFIG;
    rate_window_events: number;
    update: string;
    rhythm_window: string;
    video_sampling_fps: number | null;
  };
  privacy: { raw_video_included: false; pose_coordinates_included: false };
  session: SessionResult;
  disclaimer: string;
}
export function wrapResult(
  session: SessionResult,
  source: Source,
  startedAt: string,
  pausedMs: number,
  aspectRatio: number,
): ExportResult {
  return {
    schema_version: "1.0",
    session_id: crypto.randomUUID(),
    is_demo: source === "demo",
    source,
    status: session.completed ? "completed" : "ended_early",
    started_at: startedAt,
    ended_at: new Date().toISOString(),
    paused_ms: Math.round(pausedMs),
    measurement: {
      kind: source === "demo" ? "simulated_motion" : "camera_estimate",
      model: source === "demo" ? null : MODEL_URL,
      sdk_version: source === "demo" ? null : "1.2.2",
      valid_tracking_fraction: session.durationMs
        ? session.activity.observedMs / session.durationMs
        : null,
      metric_config: { ...DEFAULT_CONFIG, aspectRatio },
      rate_window_events: 5,
      update:
        source === "imported_video"
          ? "30 Hz seek grid"
          : source === "demo"
            ? "30 Hz simulated frames"
            : "Decoded camera frames, up to 30 Hz",
      rhythm_window:
        "Result: all valid intervals; live: latest four. Excludes gaps >= 2000 ms and unknown tracking.",
      video_sampling_fps: source === "imported_video" ? 30 : null,
    },
    privacy: { raw_video_included: false, pose_coordinates_included: false },
    session,
    disclaimer: PRACTICE_NOTICE,
  };
}
export async function loadPose(signal: AbortSignal): Promise<PoseLandmarker> {
  const { FilesetResolver, PoseLandmarker } = await import(
    "@mediapipe/tasks-vision"
  );
  const timeout = AbortSignal.timeout(45000);
  const combined = AbortSignal.any([signal, timeout]);
  const response = await fetch(MODEL_URL, {
    signal: combined,
    credentials: "omit",
    referrerPolicy: "no-referrer",
  });
  if (!response.ok)
    throw new Error(`Model download failed (${response.status}).`);
  const buffer = new Uint8Array(await response.arrayBuffer());
  combined.throwIfAborted();
  const vision = await FilesetResolver.forVisionTasks(
    `${import.meta.env.BASE_URL}vendor/mediapipe/wasm`,
  );
  combined.throwIfAborted();
  const pose = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetBuffer: buffer, delegate: "CPU" },
    runningMode: "VIDEO",
    numPoses: 2,
    outputSegmentationMasks: false,
  });
  if (combined.aborted) {
    pose.close();
    combined.throwIfAborted();
  }
  return pose;
}
export interface LiveState {
  snapshot: DetectorSnapshot | null;
  landmarks: readonly Landmark[];
  elapsed: number;
}
export class LivePractice {
  private session: PracticeSession;
  private frames = synthesizeDemo().frames;
  private index = 0;
  private raf = 0;
  private offset = 0;
  private anchor = 0;
  private lastFrame = -1;
  private lastMediaTime = -1;
  private pausedAt = 0;
  private pausedMs = 0;
  private stopped = false;
  private playing = false;
  private lastPublish = 0;
  readonly startedAt = new Date().toISOString();
  readonly aspect: number;
  constructor(
    readonly source: "camera" | "demo",
    private video: HTMLVideoElement | null,
    private pose: PoseLandmarker | null,
    private onFrame: (state: LiveState) => void,
    private onEnd: (result: ExportResult) => void,
    private onError: (message: string) => void,
  ) {
    this.aspect =
      source === "camera" && video ? video.videoWidth / video.videoHeight : 1;
    this.session = new PracticeSession({ aspectRatio: this.aspect });
  }
  start() {
    this.playing = true;
    this.anchor = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }
  private elapsed() {
    return Math.min(
      120000,
      this.offset + (this.playing ? performance.now() - this.anchor : 0),
    );
  }
  private tick = () => {
    if (this.stopped || !this.playing) return;
    const elapsed = this.elapsed();
    try {
      let snapshot: DetectorSnapshot | null = null;
      let landmarks: readonly Landmark[] = [];
      if (this.source === "demo") {
        while (
          this.index < this.frames.length &&
          this.frames[this.index]!.timestampMs <= elapsed
        ) {
          const frame = this.frames[this.index++]!;
          if (frame.timestampMs <= this.lastFrame) continue;
          snapshot = this.session.addFrame(frame);
          this.lastFrame = frame.timestampMs;
          landmarks = frame.landmarks;
        }
      } else if (
        this.video &&
        this.pose &&
        elapsed - this.lastFrame >= 1000 / 30 &&
        ((this.video.readyState >= 2 &&
          this.video.currentTime !== this.lastMediaTime) ||
          elapsed - this.lastFrame > 250)
      ) {
        if (
          this.video.readyState >= 2 &&
          this.video.currentTime !== this.lastMediaTime
        ) {
          this.lastMediaTime = this.video.currentTime;
          const result = this.pose.detectForVideo(
            this.video,
            performance.now(),
          );
          landmarks = result.landmarks.length === 1 ? result.landmarks[0]! : [];
        }
        snapshot = this.session.addFrame({ timestampMs: elapsed, landmarks });
        this.lastFrame = elapsed;
      }
      if (
        snapshot &&
        (elapsed - this.lastPublish >= 60 || elapsed === 120000)
      ) {
        this.onFrame({ snapshot, landmarks, elapsed });
        this.lastPublish = elapsed;
      }
      if (elapsed >= 120000) {
        this.finish();
        return;
      }
      this.raf = requestAnimationFrame(this.tick);
    } catch (e) {
      this.pause();
      this.onError(e instanceof Error ? e.message : "Camera tracking stopped.");
    }
  };
  pause() {
    if (!this.playing || this.stopped) return;
    this.offset = this.elapsed();
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.pausedAt = performance.now();
    // Split the observed run: no interval across a user pause can become a compression or hands-off gap.
    if (this.offset > this.lastFrame && this.offset < 120000) {
      this.session.addFrame({ timestampMs: this.offset, landmarks: [] });
      this.lastFrame = this.offset;
    }
  }
  resume() {
    if (this.playing || this.stopped) return;
    this.pausedMs += performance.now() - this.pausedAt;
    this.start();
  }
  finish() {
    if (this.stopped) return;
    const end = Math.max(this.lastFrame, this.elapsed());
    if (!this.playing && this.pausedAt)
      this.pausedMs += performance.now() - this.pausedAt;
    const result = wrapResult(
      this.session.finish(end).json,
      this.source,
      this.startedAt,
      this.pausedMs,
      this.aspect,
    );
    this.dispose();
    this.onEnd(result);
  }
  dispose() {
    this.stopped = true;
    this.playing = false;
    cancelAnimationFrame(this.raf);
  }
}
export async function importPractice(
  file: File,
  pose: PoseLandmarker,
  signal: AbortSignal,
  onFrame: (state: LiveState) => void,
) {
  const startedAt = new Date().toISOString();
  let aspect = 1;
  // Observe the adapter's input only to render its pose; decoding/analysis stays in the core adapter.
  const adapterPose = {
    detectForVideo(video: HTMLVideoElement, timestamp: number) {
      aspect = video.videoWidth / video.videoHeight;
      const result = pose.detectForVideo(video, timestamp);
      currentLandmarks =
        result.landmarks.length === 1 ? result.landmarks[0]! : [];
      return result;
    },
  } as PoseLandmarker;
  let currentLandmarks: readonly Landmark[] = [];
  const result = await analyzeVideoFile(file, adapterPose, {
    signal,
    fps: 30,
    onFrame: (snapshot) =>
      onFrame({
        snapshot,
        landmarks: currentLandmarks,
        elapsed: snapshot.timestampMs,
      }),
  });
  return wrapResult(result.json, "imported_video", startedAt, 0, aspect);
}
export function downloadResult(result: ExportResult) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `cpr-result-${result.session_id}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
