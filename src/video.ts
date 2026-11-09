import type { PoseLandmarker } from '@mediapipe/tasks-vision';
import { PracticeSession } from './session.js';
import type { DetectorConfig, DetectorSnapshot } from './detector.js';
export interface VideoOptions {
  /** Sampling rate, not inferred container FPS. Set to the source FPS when known. */
  fps?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  detector?: Partial<Omit<DetectorConfig, 'aspectRatio' | 'startTimeMs' | 'pauseThresholdMs'>>;
  onFrame?: (snapshot: DetectorSnapshot) => void;
}
function waitFor(video: HTMLVideoElement, event: string, timeoutMs: number, signal: AbortSignal | undefined, action: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer); video.removeEventListener(event, done); video.removeEventListener('error', failed);
      signal?.removeEventListener('abort', aborted);
    };
    const done = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error(`Video decoding failed (code ${video.error?.code ?? 'unknown'})`)); };
    const aborted = () => { cleanup(); reject(new DOMException('Video analysis aborted', 'AbortError')); };
    const timer = setTimeout(() => { cleanup(); reject(new Error(`Timed out waiting for video ${event}`)); }, timeoutMs);
    video.addEventListener(event, done, { once: true }); video.addEventListener('error', failed, { once: true });
    signal?.addEventListener('abort', aborted, { once: true });
    if (signal?.aborted) { aborted(); return; }
    try { action(); } catch (e) { cleanup(); reject(e); }
  });
}
/**
 * Local File -> sequential precise seeks -> synchronous detectForVideo -> same detector.
 * Supply a FRESH PoseLandmarker in VIDEO mode per call; caller owns/ closes it.
 * No network APIs, uploads, remote URLs, or persistent video storage are used here.
 */
export async function analyzeVideoFile(file: File, pose: PoseLandmarker, options: VideoOptions = {}) {
  if (typeof document === 'undefined') throw new Error('analyzeVideoFile requires a browser DOM');
  const fps = options.fps ?? 30, timeout = options.timeoutMs ?? 15000;
  if (!Number.isFinite(fps) || fps < 15 || fps > 120 || !Number.isFinite(timeout) || timeout <= 0) throw new RangeError('Invalid video options');
  const video = document.createElement('video');
  video.muted = true; video.playsInline = true; video.preload = 'auto';
  const url = URL.createObjectURL(file);
  try {
    await waitFor(video, 'loadeddata', timeout, options.signal, () => { video.src = url; video.load(); });
    video.pause();
    if (!Number.isFinite(video.duration) || video.duration <= 0 || !video.videoWidth || !video.videoHeight) throw new Error('Video must have finite duration and nonzero dimensions');
    const endMs = Math.min(120000, video.duration * 1000);
    const session = new PracticeSession({ ...options.detector, aspectRatio: video.videoWidth / video.videoHeight, startTimeMs: 0 });
    for (let index = 0; index * 1000 / fps < endMs; index++) {
      options.signal?.throwIfAborted();
      const t = index * 1000 / fps;
      if (Math.abs(video.currentTime - t / 1000) > 1e-7) {
        await waitFor(video, 'seeked', timeout, options.signal, () => { video.currentTime = t / 1000; });
      }
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) throw new Error('No decoded frame after seeking');
      const result = pose.detectForVideo(video, t);
      // More than one body is ambiguous: mark this frame unavailable.
      const landmarks = result.landmarks.length === 1 ? result.landmarks[0]! : [];
      const snapshot = session.addFrame({ timestampMs: t, landmarks });
      options.onFrame?.(snapshot);
      // Yield between synchronous inference calls so cancellation/UI work can run.
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    return session.finish(endMs);
  } finally {
    video.pause(); video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url);
  }
}
