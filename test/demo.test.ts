import { expect, it } from 'vitest';
import { synthesize, synthesizeDemo } from '../src/synth.js';
import { PracticeSession } from '../src/session.js';
import { coachingCue } from '../src/coaching.js';

it('detects the demo story and coaching order from generated landmarks', () => {
  const session = new PracticeSession();
  const { frames, truth } = synthesizeDemo();
  const snapshots = frames.map(f => session.addFrame(f));
  const transitions = snapshots.map(s => ({ time: s.timestampMs, cue: coachingCue(s) }))
    .filter((s, i, all) => i === 0 || s.cue !== all[i - 1]!.cue);
  expect(transitions.map(s => s.cue)).toEqual([
    'Start moving to find your rhythm', 'Keep a steady rhythm',
    'Push faster', 'Keep a steady rhythm', 'Resume compressions',
    'Start moving to find your rhythm', 'Keep a steady rhythm',
    'Keep your arms straight', 'Keep a steady rhythm', 'Slow down a little',
  ]);
  for (const [cue, start, end] of [
    ['Push faster', 40000, 60000], ['Resume compressions', 70000, 73000],
    ['Keep your arms straight', 90000, 100000], ['Slow down a little', 100000, 120000],
  ] as const) {
    const event = transitions.find(s => s.cue === cue)!;
    expect(event.time).toBeGreaterThanOrEqual(start);
    expect(event.time).toBeLessThan(end);
  }
  const stable = snapshots.filter(s => s.timestampMs >= 3000 && s.timestampMs <= 30000);
  expect(stable.every(s => s.recentRateCpm! >= 105 && s.recentRateCpm! <= 115)).toBe(true);
  expect(snapshots.find(s => s.timestampMs === 50000)!.recentRateCpm).toBeCloseTo(95, 0);
  expect(Math.abs(snapshots.find(s => s.timestampMs === 115000)!.recentRateCpm! - 125)).toBeLessThan(2);
  const result = session.finish().json;
  expect(result.completed).toBe(true);
  expect(result.compressionCount).toBe(truth.compressionCount);
  expect(result.rate.inTargetFraction).toBeGreaterThan(0.5);
  expect(result.rate.inTargetFraction).toBeLessThan(0.9);
  expect(result.pauses.count).toBe(1);
  // Detector measures peak-to-peak gaps, not the imposed stillness interval.
  expect(result.pauses.totalMs).toBeGreaterThanOrEqual(3000);
  expect(result.pauses.totalMs).toBeLessThan(4500);
  expect(result.arms.bothStraightFraction).toBeCloseTo(110 / 120, 3);
  expect(result.activity.unknownMs).toBe(0);
});

it('validates pace points and preserves the fixed-pace generator', () => {
  for (const pace of [
    [{ timestampMs: 0, bpm: NaN }], [{ timestampMs: -1, bpm: 110 }],
    [{ timestampMs: 0, bpm: 110 }, { timestampMs: 0, bpm: 95 }],
  ]) expect(() => synthesize({ pace })).toThrow('Invalid synthetic pace');
  expect(synthesize({ bpm: 110 }).truth.averageCpm).toBeCloseTo(110, 5);
});
