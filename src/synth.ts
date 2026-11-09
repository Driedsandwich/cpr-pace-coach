import { coefficientOfVariation, mean, type Landmark, type PoseFrame } from './detector.js';
export interface TimeRange { startMs: number; endMs: number }
export interface PacePoint { timestampMs: number; bpm: number }
export interface SynthOptions {
  durationMs?: number; bpm?: number; fps?: number; seed?: number;
  /** Uniform fractional variation in cycle length; actual interval CV is in truth. */
  jitter?: number;
  /** Linearly interpolated pace, sampled at each cycle start. */
  pace?: PacePoint[];
  /** Uniform x/y coordinate noise amplitude in normalized image units. */
  noise?: number;
  pauses?: TimeRange[]; missing?: TimeRange[]; bent?: TimeRange[];
  bentAngleDeg?: number; aspectRatio?: number;
  /** Optional isolated wrist outlier every N frames; median filtering should reject it. */
  spikeEveryFrames?: number;
}
export function synthesize(options: SynthOptions = {}) {
  const duration = options.durationMs ?? 120000, bpm = options.bpm ?? 110, fps = options.fps ?? 30;
  const jitter = options.jitter ?? 0, noise = options.noise ?? 0, aspect = options.aspectRatio ?? 1;
  const bendAngle = options.bentAngleDeg ?? 130;
  const pauses = [...(options.pauses ?? [])].sort((a, b) => a.startMs - b.startMs);
  if (![duration, bpm, fps, jitter, noise, aspect, bendAngle].every(Number.isFinite) || duration <= 0 || duration > 120000 || bpm <= 0 || bpm > 200 || fps < 1 || fps > 240 || jitter < 0 || jitter >= 0.5 || noise < 0 || aspect <= 0 || bendAngle <= 0 || bendAngle > 180)
    throw new RangeError('Invalid synthetic options');
  for (const ranges of [pauses, options.missing ?? [], options.bent ?? []]) {
    for (const r of ranges) if (!Number.isFinite(r.startMs) || !Number.isFinite(r.endMs) || r.startMs < 0 || r.endMs <= r.startMs || r.endMs > duration) throw new RangeError('Invalid synthetic range');
  }
  if (pauses.some((r, i) => i > 0 && r.startMs < pauses[i - 1]!.endMs)) throw new RangeError('Overlapping pauses');
  const pace = options.pace ?? [];
  if (pace.some((p, i) => !Number.isFinite(p.timestampMs) || p.timestampMs < 0 || p.timestampMs > duration ||
      !Number.isFinite(p.bpm) || p.bpm <= 0 || p.bpm > 200 || (i > 0 && p.timestampMs <= pace[i - 1]!.timestampMs)))
    throw new RangeError('Invalid synthetic pace');
  const bpmAt = (t: number) => {
    if (!pace.length) return bpm;
    const next = pace.findIndex(p => p.timestampMs > t);
    if (next === 0) return pace[0]!.bpm;
    if (next === -1) return pace.at(-1)!.bpm;
    const a = pace[next - 1]!, b = pace[next]!;
    return a.bpm + (b.bpm - a.bpm) * (t - a.timestampMs) / (b.timestampMs - a.timestampMs);
  };
  let seed = (options.seed ?? 42) >>> 0;
  const random = () => { seed = (Math.imul(1664525, seed) + 1013904223) >>> 0; return seed / 4294967296; };
  const cycles: { start: number; end: number; peak: number }[] = [];
  let start = 0;
  for (const stop of [...pauses, { startMs: duration, endMs: duration }]) {
    let cursor = start;
    while (true) {
      const period = 60000 / bpmAt(cursor) * (1 + jitter * (2 * random() - 1));
      if (cursor + period > stop.startMs + 1e-7) break;
      cycles.push({ start: cursor, end: cursor + period, peak: cursor + period / 2 }); cursor += period;
    }
    start = stop.endMs;
  }
  const inside = (t: number, ranges: TimeRange[]) => ranges.some(r => t >= r.startMs && t < r.endMs);
  const frames: PoseFrame[] = [];
  let cycleIndex = 0;
  const count = Math.ceil(duration * fps / 1000);
  for (let i = 0; i <= count; i++) {
    const t = Math.min(duration, i * 1000 / fps);
    while (cycleIndex < cycles.length && cycles[cycleIndex]!.end < t) cycleIndex++;
    const cycle = cycles[cycleIndex];
    const wave = cycle && t >= cycle.start && t <= cycle.end ? (1 - Math.cos(2 * Math.PI * (t - cycle.start) / (cycle.end - cycle.start))) / 2 : 0;
    const wristY = 0.61 + 0.06 * wave;
    const angle = inside(t, options.bent ?? []) ? bendAngle : 180;
    const offset = (wristY - 0.25) / 2 / Math.tan(angle * Math.PI / 360) / aspect;
    const landmarks: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }));
    const visibility = inside(t, options.missing ?? []) ? 0.1 : 1;
    for (let side = 0; side < 2; side++) {
      const x = 0.4 + side * 0.2;
      landmarks[11 + side] = { x, y: 0.25, visibility };
      landmarks[13 + side] = { x: x + (side ? 1 : -1) * offset, y: (0.25 + wristY) / 2, visibility };
      landmarks[15 + side] = { x, y: wristY, visibility };
    }
    for (let j = 11; j <= 16; j++) {
      landmarks[j]!.x += noise * (2 * random() - 1);
      landmarks[j]!.y += noise * (2 * random() - 1);
    }
    if (options.spikeEveryFrames && i > 0 && i % options.spikeEveryFrames === 0) {
      landmarks[15]!.y += 0.12; landmarks[16]!.y += 0.12;
    }
    frames.push({ timestampMs: t, landmarks });
  }
  const peaks = cycles.map(c => c.peak);
  const intervals = peaks.slice(1).map((t, i) => t - peaks[i]!).filter(dt => dt < 2000);
  const m = mean(intervals);
  return { frames, truth: { peakTimesMs: peaks, compressionCount: peaks.length,
    averageCpm: m === null ? null : 60000 / m, rhythmCv: coefficientOfVariation(intervals),
    imposedPauseCount: pauses.length, imposedPauseMs: pauses.reduce((s, p) => s + p.endMs - p.startMs, 0),
    bentAngleDeg: bendAngle } };
}

/** A repeatable practice story. Only landmarks are generated; all feedback is detected. */
export function synthesizeDemo() {
  return synthesize({
    durationMs: 120000, fps: 30, seed: 24, jitter: 0.02, noise: 0.0003,
    pace: [
      { timestampMs: 0, bpm: 110 }, { timestampMs: 40000, bpm: 110 },
      { timestampMs: 45000, bpm: 95 }, { timestampMs: 60000, bpm: 95 },
      { timestampMs: 65000, bpm: 110 }, { timestampMs: 100000, bpm: 110 },
      { timestampMs: 108000, bpm: 125 }, { timestampMs: 120000, bpm: 125 },
    ],
    pauses: [{ startMs: 70000, endMs: 73000 }],
    bent: [{ startMs: 90000, endMs: 100000 }], bentAngleDeg: 130,
  });
}
