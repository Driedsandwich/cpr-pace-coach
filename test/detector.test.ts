import { describe, expect, it } from 'vitest';
import { CompressionDetector, elbowAngle } from '../src/detector.js';
import { synthesize } from '../src/synth.js';
import { PracticeSession } from '../src/session.js';
function run(options: Parameters<typeof synthesize>[0] = {}) {
  const data = synthesize(options); const session = new PracticeSession({ aspectRatio: options.aspectRatio ?? 1 });
  const snapshots = data.frames.map(f => session.addFrame(f));
  return { ...data, snapshots, result: session.finish().json, detector: session.detector };
}
describe('synthetic rhythm detection', () => {
  it.each([90, 110, 130])('measures %i cpm without changing the target', bpm => {
    const r = run({ bpm, noise: 0.001, spikeEveryFrames: 97 });
    expect(Math.abs(r.result.rate.averageCpm! - r.truth.averageCpm!)).toBeLessThan(1);
    expect(r.result.compressionCount).toBe(r.truth.compressionCount);
    expect(r.result.pauses.count).toBe(0);
    expect(r.result.rate.inTargetFraction).toBe(bpm === 110 ? 1 : 0);
    const live = r.snapshots.filter(s => s.recentRateCpm !== null);
    expect(Math.max(...live.map(s => Math.abs(s.recentRateCpm! - bpm)))).toBeLessThan(4);
    expect(r.detector.compressions.every((e, i, es) => i === 0 || e.timestampMs - es[i - 1]!.timestampMs >= 300)).toBe(true);
  });
  it.each([15, 24, 60])('works at %i fps', fps => {
    const r = run({ fps, bpm: 110 });
    expect(Math.abs(r.result.rate.averageCpm! - 110)).toBeLessThan(1);
    expect(Math.abs(r.result.compressionCount - r.truth.compressionCount)).toBeLessThanOrEqual(1);
  });
  it('estimates interval variation against actual synthetic peak intervals', () => {
    const r = run({ jitter: 0.3, noise: 0.001 });
    expect(r.truth.rhythmCv).toBeGreaterThan(0.08);
    expect(Math.abs(r.result.rate.rhythmCv! - r.truth.rhythmCv!)).toBeLessThan(0.03);
    expect(Math.abs(r.result.rate.averageCpm! - r.truth.averageCpm!)).toBeLessThan(1);
  });
  it('finds pauses, clears stale live rate, and excludes pauses from cadence', () => {
    const r = run({ pauses: [{ startMs: 30000, endMs: 35000 }, { startMs: 80000, endMs: 83000 }] });
    expect(r.result.pauses.count).toBe(2);
    expect(r.result.pauses.totalMs).toBeGreaterThanOrEqual(8000);
    expect(r.result.pauses.totalMs).toBeLessThan(10000);
    expect(r.result.rate.averageCpm).toBeCloseTo(110, 0);
    expect(r.snapshots.find(s => s.timestampMs === 33000)!.recentRateCpm).toBeNull();
    expect(r.result.activity.chestCompressionFraction).toBeLessThan(0.94);
    expect(r.result.activity.chestCompressionFraction).toBeGreaterThan(0.90);
  });
  it('recognizes leading, trailing, and whole-session stillness', () => {
    const r = run({ pauses: [{ startMs: 0, endMs: 5000 }, { startMs: 115000, endMs: 120000 }] });
    expect(r.result.pauses.count).toBe(2);
    const still = run({ pauses: [{ startMs: 0, endMs: 120000 }], noise: 0.001 });
    expect(still.result.compressionCount).toBe(0);
    expect(still.result.pauses.totalMs).toBe(120000);
    expect(still.result.activity.chestCompressionFraction).toBe(0);
    expect(still.result.rate.averageCpm).toBeNull();
  });
  it('keeps missing landmarks and dropped frames separate from observed stops', () => {
    const r = run({ missing: [{ startMs: 30000, endMs: 35000 }] });
    expect(r.result.pauses.count).toBe(0);
    expect(r.result.activity.unknownMs).toBeGreaterThanOrEqual(5000);
    expect(r.snapshots.find(s => s.timestampMs === 32000)!.missingLandmarks).toBe(true);
    expect(r.snapshots.find(s => s.timestampMs === 32000)!.elbows.leftBent).toBeNull();
    const d = new CompressionDetector();
    for (const f of synthesize({ durationMs: 10000 }).frames) if (f.timestampMs < 3000 || f.timestampMs > 7000) d.update(f);
    expect(d.snapshot().unknownMs).toBeGreaterThan(4000);
    expect(d.snapshot().pauses).toHaveLength(0);
  });
  it('uses four intervals for the most recent five compressions', () => {
    const r = run({ durationMs: 5000 });
    expect(r.snapshots.find(s => s.compressionCount === 4)!.recentRateCpm).toBeNull();
    const fifth = r.snapshots.find(s => s.compressionCount === 5)!;
    const e = r.detector.compressions.slice(0, 5);
    expect(fifth.recentRateCpm).toBeCloseTo(4 * 60000 / (e[4]!.timestampMs - e[0]!.timestampMs), 8);
  });
  it('does not double count noisy stationary wrists', () => {
    const r = run({ durationMs: 10000, pauses: [{ startMs: 0, endMs: 10000 }], noise: 0.003, spikeEveryFrames: 31 });
    expect(r.result.compressionCount).toBe(0);
  });
});
describe('arms and invalid input', () => {
  it.each([1, 16 / 9, 9 / 16])('corrects projected angles for aspect ratio %f', aspectRatio => {
    const r = run({ durationMs: 10000, aspectRatio, bent: [{ startMs: 3000, endMs: 7000 }] });
    const straight = r.snapshots.find(s => s.timestampMs === 1000)!;
    const bent = r.snapshots.find(s => s.timestampMs === 5000)!;
    expect(straight.elbows.leftDeg).toBeCloseTo(180, 5);
    expect(bent.elbows.leftDeg).toBeCloseTo(130, 5);
    expect(bent.elbows.rightDeg).toBeCloseTo(130, 5);
    expect(bent.elbows.leftBent).toBe(true); expect(bent.elbows.rightBent).toBe(true);
    expect(r.result.arms.bothStraightFraction).toBeCloseTo(0.6, 2);
  });
  it('allows the bent threshold to change and flags each arm independently', () => {
    const f = synthesize({ durationMs: 1000, bent: [{ startMs: 0, endMs: 1000 }] }).frames[0]!;
    expect(new CompressionDetector({ bentAngleDeg: 120 }).update(f).elbows.leftBent).toBe(false);
    f.landmarks[14]!.x = 0.6;
    const s = new CompressionDetector().update(f);
    expect(s.elbows.leftBent).toBe(true); expect(s.elbows.rightBent).toBe(false);
  });
  it('rejects bad timestamps/configuration and flags malformed points', () => {
    expect(() => new CompressionDetector({ minIntervalMs: -1 })).toThrow();
    const d = new CompressionDetector(); const f = synthesize({ durationMs: 1000 }).frames[0]!;
    d.update(f); expect(() => d.update(f)).toThrow();
    expect(() => d.update({ ...f, timestampMs: NaN })).toThrow();
    expect(new CompressionDetector().update({ ...f, landmarks: [] }).missingLandmarks).toBe(true);
    f.landmarks[11]!.x = NaN;
    expect(new CompressionDetector().update(f).missingIndices).toContain(11);
    expect(elbowAngle({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 })).toBeNull();
  });
  it('flags nearly coincident shoulders rather than amplifying noise', () => {
    const f = synthesize({ durationMs: 1000 }).frames[0]!;
    f.landmarks[12]!.x = f.landmarks[11]!.x;
    const s = new CompressionDetector().update(f);
    expect(s.invalidGeometry).toBe(true); expect(s.compressionCount).toBe(0);
  });
});
it('recognizes exactly two seconds of observed stillness, but not shorter gaps', () => {
  const d = new CompressionDetector();
  const frames = synthesize({ durationMs: 2000, pauses: [{ startMs: 0, endMs: 2000 }] }).frames;
  for (const frame of frames.slice(0, -1)) d.update(frame);
  expect(d.snapshot().pauses).toHaveLength(0);
  d.update(frames.at(-1)!);
  expect(d.snapshot().pauses).toEqual([{ startMs: 0, endMs: 2000, durationMs: 2000, ongoing: true }]);
});
it('never labels an entirely untracked recording as a stop', () => {
  const r = run({ durationMs: 5000, missing: [{ startMs: 0, endMs: 5000 }] });
  expect(r.result.compressionCount).toBe(0);
  expect(r.result.pauses.count).toBe(0);
  expect(r.result.activity.unknownMs).toBe(5000);
  expect(r.result.arms.bothStraightFraction).toBeNull();
});
it('marks stale snapshots unavailable without inventing observed time', () => {
  const d = new CompressionDetector(); d.update(synthesize({ durationMs: 1000 }).frames[0]!);
  const s = d.snapshot(3000);
  expect(s.missingLandmarks).toBe(true); expect(s.elbows.leftDeg).toBeNull();
  expect(s.observedMs).toBe(0); expect(s.unknownMs).toBe(3000); expect(s.pauses).toHaveLength(0);
});
