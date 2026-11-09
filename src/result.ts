import { z } from 'zod';
const nonnegative = z.number().finite().nonnegative();
const fraction = z.number().min(0).max(1);
const nullableRate = z.number().positive().nullable();
export const SessionResultSchema = z.strictObject({
  schemaVersion: z.literal('1.0'),
  purpose: z.literal('practice-only'),
  plannedDurationMs: z.literal(120000),
  durationMs: nonnegative.max(120000),
  completed: z.boolean(),
  compressionCount: z.number().int().nonnegative(),
  rate: z.strictObject({
    targetMinCpm: z.literal(100), targetMaxCpm: z.literal(120),
    evaluableCount: z.number().int().nonnegative(), inTargetCount: z.number().int().nonnegative(),
    inTargetFraction: fraction.nullable(), averageCpm: nullableRate, rhythmCv: nonnegative.nullable(),
  }),
  pauses: z.strictObject({ thresholdMs: z.literal(2000), count: z.number().int().nonnegative(), totalMs: nonnegative,
    intervals: z.array(z.strictObject({ startMs: nonnegative, endMs: nonnegative, durationMs: nonnegative })) }),
  activity: z.strictObject({ observedMs: nonnegative, unknownMs: nonnegative, activeMs: nonnegative,
    chestCompressionFraction: fraction.nullable(), observedCompressionFraction: fraction.nullable() }),
  arms: z.strictObject({ bentThresholdDeg: z.number().positive().max(180), observedMs: nonnegative,
    bothStraightMs: nonnegative, bothStraightFraction: fraction.nullable(),
    meanLeftDeg: z.number().min(0).max(180).nullable(), meanRightDeg: z.number().min(0).max(180).nullable() }),
});
export type SessionResult = z.infer<typeof SessionResultSchema>;
/** Structural schema plus cross-field consistency for untrusted MCP input. */
export function parseSessionResult(input: unknown): SessionResult {
  const r = SessionResultSchema.parse(input);
  const near = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
  const checkFraction = (actual: number | null, n: number, d: number) => d === 0 ? actual === null : actual !== null && near(actual, n / d);
  const p = r.pauses, a = r.activity, arm = r.arms, rate = r.rate;
  if (r.completed !== (r.durationMs === 120000) || rate.evaluableCount > Math.max(0, r.compressionCount - 1) ||
    rate.inTargetCount > rate.evaluableCount || !checkFraction(rate.inTargetFraction, rate.inTargetCount, rate.evaluableCount) ||
    (rate.evaluableCount === 0) !== (rate.averageCpm === null) || (rate.evaluableCount < 2) !== (rate.rhythmCv === null) ||
    p.count !== p.intervals.length || !near(p.totalMs, p.intervals.reduce((s, x) => s + x.durationMs, 0)) ||
    p.intervals.some((x, i) => x.durationMs < 2000 || x.endMs > r.durationMs || !near(x.endMs - x.startMs, x.durationMs) || (i > 0 && x.startMs < p.intervals[i - 1]!.endMs)) ||
    !near(a.observedMs + a.unknownMs, r.durationMs) || a.activeMs + p.totalMs > a.observedMs + 1e-6 ||
    !checkFraction(a.chestCompressionFraction, a.activeMs, r.durationMs) || !checkFraction(a.observedCompressionFraction, a.activeMs, a.observedMs) ||
    arm.observedMs > a.observedMs + 1e-6 || arm.bothStraightMs > arm.observedMs + 1e-6 ||
    !checkFraction(arm.bothStraightFraction, arm.bothStraightMs, arm.observedMs) ||
    (arm.observedMs === 0) !== (arm.meanLeftDeg === null) || (arm.observedMs === 0) !== (arm.meanRightDeg === null))
    throw new Error('Inconsistent session result');
  return r;
}
