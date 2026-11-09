/** Only image-plane x/y are used. z is deliberately ignored. */
export interface Landmark { x: number; y: number; z?: number; visibility?: number }
export interface PoseFrame { timestampMs: number; landmarks: readonly Landmark[] }
export interface DetectorConfig {
  startTimeMs: number;
  /** Image width / height: required for meaningful 2D geometry on non-square images. */
  aspectRatio: number;
  minVisibility: number;
  minShoulderWidth: number;
  smoothingMs: number;
  minExcursion: number;
  reversal: number;
  minIntervalMs: number;
  pauseThresholdMs: number;
  maxFrameGapMs: number;
  bentAngleDeg: number;
}
export const DEFAULT_CONFIG: Readonly<DetectorConfig> = Object.freeze({
  startTimeMs: 0, aspectRatio: 1, minVisibility: 0.6, minShoulderWidth: 0.04,
  smoothingMs: 45, minExcursion: 0.10, reversal: 0.025, minIntervalMs: 300,
  pauseThresholdMs: 2000, maxFrameGapMs: 250, bentAngleDeg: 160,
});
export interface Compression { timestampMs: number; detectedAtMs: number; intervalMs: number | null; rateCpm: number | null }
export interface Pause { startMs: number; endMs: number; durationMs: number; ongoing: boolean }
export interface Elbows { leftDeg: number | null; rightDeg: number | null; leftBent: boolean | null; rightBent: boolean | null }
export interface DetectorSnapshot {
  timestampMs: number;
  compression: Compression | null;
  compressionCount: number;
  recentRateCpm: number | null;
  averageRateCpm: number | null;
  rhythmCv: number | null;
  recentRhythmCv: number | null;
  missingLandmarks: boolean;
  missingIndices: number[];
  invalidGeometry: boolean;
  elbows: Elbows;
  observedMs: number;
  unknownMs: number;
  activeMs: number;
  chestCompressionFraction: number | null;
  observedCompressionFraction: number | null;
  pauses: Pause[];
  pauseMs: number;
  armObservedMs: number;
  armsStraightMs: number;
  meanLeftElbowDeg: number | null;
  meanRightElbowDeg: number | null;
}
interface Span { start: number; end: number; events: Compression[] }
interface Sample { t: number; y: number }
const IDS = [11, 12, 13, 14, 15, 16];
const noElbows = (): Elbows => ({ leftDeg: null, rightDeg: null, leftBent: null, rightBent: null });
export function mean(values: readonly number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}
/** Population SD / mean; at least two intervals are required. */
export function coefficientOfVariation(values: readonly number[]): number | null {
  const m = mean(values);
  return values.length < 2 || m === null || m <= 0 ? null : Math.sqrt(values.reduce((s, x) => s + (x - m) ** 2, 0) / values.length) / m;
}
export function elbowAngle(a: Landmark, b: Landmark, c: Landmark, aspectRatio = 1): number | null {
  const ux = (a.x - b.x) * aspectRatio, uy = a.y - b.y;
  const vx = (c.x - b.x) * aspectRatio, vy = c.y - b.y;
  const denom = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  if (!Number.isFinite(denom) || denom < 1e-10) return null;
  return Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / denom))) * 180 / Math.PI;
}
export class CompressionDetector {
  readonly config: Readonly<DetectorConfig>;
  private lastTime: number | null = null;
  private spans: Span[] = [];
  private current: Span | null = null;
  private allEvents: Compression[] = [];
  private intervals: number[] = [];
  private recent: number[] = [];
  private raw: number[] = [];
  private filtered: Sample | null = null;
  private extreme: Sample | null = null;
  private valley: number = 0;
  private direction: 'up' | 'down' = 'up';
  private origin = 0;
  private scale = 1;
  private missing = true;
  private missingIds: number[] = [...IDS];
  private badGeometry = false;
  private angles = noElbows();
  private armMs = 0;
  private straightMs = 0;
  private leftSum = 0;
  private rightSum = 0;
  constructor(config: Partial<DetectorConfig> = {}) {
    const c = { ...DEFAULT_CONFIG, ...config };
    if (Object.values(c).some(v => !Number.isFinite(v)) || c.startTimeMs < 0 || c.aspectRatio <= 0 ||
        c.minVisibility < 0 || c.minVisibility > 1 || c.minShoulderWidth <= 0 || c.smoothingMs <= 0 ||
        c.reversal <= 0 || c.minExcursion <= c.reversal || c.minIntervalMs <= 0 ||
        c.pauseThresholdMs <= c.minIntervalMs || c.maxFrameGapMs <= 0 || c.maxFrameGapMs >= c.pauseThresholdMs ||
        c.bentAngleDeg <= 0 || c.bentAngleDeg > 180) throw new RangeError('Invalid detector configuration');
    this.config = Object.freeze(c);
  }
  get compressions(): readonly Compression[] { return this.allEvents.map(e => ({ ...e })); }
  get validIntervalsMs(): readonly number[] { return [...this.intervals]; }
  private resetSignal(): void {
    this.raw = []; this.filtered = null; this.extreme = null; this.recent = []; this.direction = 'up';
  }
  update(frame: PoseFrame): DetectorSnapshot {
    const t = frame.timestampMs, c = this.config;
    if (!Number.isFinite(t) || t < c.startTimeMs || (this.lastTime !== null && t <= this.lastTime))
      throw new RangeError('Timestamps must be finite, at/after start, and strictly increasing');
    const dt = this.lastTime === null ? 0 : t - this.lastTime;
    const p = frame.landmarks;
    this.missingIds = IDS.filter(i => {
      const v = p[i];
      return !v || !Number.isFinite(v.x) || !Number.isFinite(v.y) || v.x < 0 || v.x > 1 || v.y < 0 || v.y > 1 ||
        !Number.isFinite(v.visibility) || v.visibility! < c.minVisibility || v.visibility! > 1;
    });
    const width = this.missingIds.length ? 0 : Math.hypot((p[11]!.x - p[12]!.x) * c.aspectRatio, p[11]!.y - p[12]!.y);
    this.badGeometry = !this.missingIds.length && width < c.minShoulderWidth;
    const valid = !this.missingIds.length && !this.badGeometry;
    let event: Compression | null = null;
    if (valid) {
      const left = elbowAngle(p[11]!, p[13]!, p[15]!, c.aspectRatio);
      const right = elbowAngle(p[12]!, p[14]!, p[16]!, c.aspectRatio);
      const nextAngles: Elbows = { leftDeg: left, rightDeg: right,
        leftBent: left === null ? null : left < c.bentAngleDeg,
        rightBent: right === null ? null : right < c.bentAngleDeg };
      if (this.current && dt <= c.maxFrameGapMs) {
        this.current.end = t;
        if (this.angles.leftDeg !== null && this.angles.rightDeg !== null && left !== null && right !== null) {
          this.armMs += dt;
          this.leftSum += dt * (this.angles.leftDeg + left) / 2;
          this.rightSum += dt * (this.angles.rightDeg + right) / 2;
          // Left-endpoint time integration of the boolean flag.
          if (!this.angles.leftBent && !this.angles.rightBent) this.straightMs += dt;
        }
      } else {
        this.current = { start: t, end: t, events: [] };
        this.spans.push(this.current); this.resetSignal();
        this.origin = (p[15]!.y + p[16]!.y) / 2;
        this.scale = width;
      }
      this.angles = nextAngles;
      // Smooth scale independently; do not subtract moving shoulders from wrists.
      this.scale += (1 - Math.exp(-dt / 500)) * (width - this.scale);
      const y = ((p[15]!.y + p[16]!.y) / 2 - this.origin) / this.scale;
      event = this.processSignal(y, t, dt);
    } else {
      this.current = null; this.resetSignal(); this.angles = noElbows();
    }
    this.missing = !valid; this.lastTime = t;
    return this.snapshot(t, event);
  }
  private processSignal(y: number, t: number, dt: number): Compression | null {
    const c = this.config;
    this.raw.push(y); if (this.raw.length > 3) this.raw.shift();
    const sorted = [...this.raw].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    const v = this.filtered ? this.filtered.y + (1 - Math.exp(-dt / c.smoothingMs)) * (median - this.filtered.y) : median;
    this.filtered = { t, y: v };
    if (!this.extreme) { this.extreme = { t, y: v }; this.valley = v; return null; }
    if (this.direction === 'up') { // image y increases downward: find valley, then descend
      if (v < this.extreme.y) this.extreme = { t, y: v };
      if (v - this.extreme.y >= c.reversal) {
        this.valley = this.extreme.y; this.direction = 'down'; this.extreme = { t, y: v };
      }
      return null;
    }
    if (v > this.extreme.y) this.extreme = { t, y: v };
    if (this.extreme.y - v < c.reversal) return null;
    const peak = this.extreme;
    this.direction = 'up'; this.extreme = { t, y: v };
    const previous = this.allEvents.at(-1);
    if (peak.y - this.valley < c.minExcursion || (previous && peak.t - previous.timestampMs < c.minIntervalMs)) return null;
    const priorInSpan = this.current!.events.at(-1);
    const gap = priorInSpan ? peak.t - priorInSpan.timestampMs : null;
    const interval = gap !== null && gap < c.pauseThresholdMs ? gap : null;
    if (interval === null) this.recent = [];
    else { this.intervals.push(interval); this.recent.push(interval); if (this.recent.length > 4) this.recent.shift(); }
    const event: Compression = { timestampMs: peak.t, detectedAtMs: t, intervalMs: interval, rateCpm: interval === null ? null : 60000 / interval };
    this.current!.events.push(event); this.allEvents.push(event);
    return { ...event };
  }
  /** No observations are invented after the latest frame: an unobserved tail is unknown. */
  snapshot(endMs = this.lastTime ?? this.config.startTimeMs, compression: Compression | null = null): DetectorSnapshot {
    if (!Number.isFinite(endMs) || endMs < (this.lastTime ?? this.config.startTimeMs)) throw new RangeError('Invalid snapshot time');
    let observedMs = 0, activeMs = 0;
    const pauses: Pause[] = [];
    for (const span of this.spans) {
      observedMs += span.end - span.start;
      const bounds = [span.start, ...span.events.map(e => e.timestampMs), span.end];
      for (let i = 1; i < bounds.length; i++) {
        const start = bounds[i - 1]!, end = bounds[i]!, duration = end - start;
        if (duration >= this.config.pauseThresholdMs) pauses.push({ startMs: start, endMs: end, durationMs: duration,
          ongoing: span === this.current && end === span.end && endMs === span.end && i === bounds.length - 1 });
        else if (i > 1 && i < bounds.length - 1) activeMs += duration;
      }
    }
    const duration = endMs - this.config.startTimeMs;
    const m = mean(this.intervals);
    const lastEvent = this.current?.events.at(-1);
    const fresh = !!lastEvent && endMs - lastEvent.timestampMs < this.config.pauseThresholdMs && endMs - (this.lastTime ?? 0) <= this.config.maxFrameGapMs;
    const recentMean = fresh && this.recent.length === 4 ? mean(this.recent) : null;
    const stale = endMs - (this.lastTime ?? this.config.startTimeMs) > this.config.maxFrameGapMs;
    return {
      timestampMs: endMs, compression, compressionCount: this.allEvents.length,
      recentRateCpm: recentMean === null ? null : 60000 / recentMean,
      averageRateCpm: m === null ? null : 60000 / m, rhythmCv: coefficientOfVariation(this.intervals),
      recentRhythmCv: fresh ? coefficientOfVariation(this.recent) : null,
      missingLandmarks: this.missing || stale,
      missingIndices: stale ? [...IDS] : [...this.missingIds], invalidGeometry: this.badGeometry, elbows: stale ? noElbows() : { ...this.angles },
      observedMs, unknownMs: Math.max(0, duration - observedMs), activeMs,
      chestCompressionFraction: duration ? activeMs / duration : null,
      observedCompressionFraction: observedMs ? activeMs / observedMs : null,
      pauses, pauseMs: pauses.reduce((s, p) => s + p.durationMs, 0), armObservedMs: this.armMs, armsStraightMs: this.straightMs,
      meanLeftElbowDeg: this.armMs ? Math.min(180, this.leftSum / this.armMs) : null,
      meanRightElbowDeg: this.armMs ? Math.min(180, this.rightSum / this.armMs) : null,
    };
  }
}
