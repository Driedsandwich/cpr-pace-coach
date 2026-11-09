import { parseSessionResult, sessionText, PRACTICE_NOTICE } from '../src/session.js';
export function summarizeSession(input: unknown) {
  const r = parseSessionResult(input);
  const goals: string[] = [];
  if (r.activity.unknownMs > 0 || r.activity.observedMs === 0) goals.push('Keep both shoulders, elbows and wrists visible with a stable camera.');
  if (r.rate.averageCpm === null) goals.push('Record enough visible practice compressions to estimate a rate.');
  else if (r.rate.averageCpm < 100) goals.push('Practice a slightly faster rhythm, aiming for 100–120 compressions/min.');
  else if (r.rate.averageCpm > 120) goals.push('Practice a slightly slower rhythm, aiming for 100–120 compressions/min.');
  else if ((r.rate.inTargetFraction ?? 0) < 1) goals.push('Keep individual intervals more even within 100–120 compressions/min.');
  else goals.push('Maintain a steady 100–120 compressions/min rhythm.');
  if (r.pauses.count > 0) goals.push('During the next practice, work on reducing observed interruptions.');
  if (r.arms.bothStraightFraction !== null && r.arms.bothStraightFraction < 1) goals.push('Practice keeping both arms straight; check camera perspective if the flag persists.');
  if (!r.completed) goals.push('Complete a full two-minute practice recording.');
  return { summary: sessionText(r), nextPracticeGoals: goals, notice: PRACTICE_NOTICE };
}
export function compareSessions(before: unknown, after: unknown) {
  const a = parseSessionResult(before), b = parseSessionResult(after);
  const diff = (x: number | null, y: number | null) => x === null || y === null ? null : y - x;
  return {
    direction: 'after minus before',
    differences: {
      durationMs: b.durationMs - a.durationMs,
      compressionCount: b.compressionCount - a.compressionCount,
      averageCpm: diff(a.rate.averageCpm, b.rate.averageCpm),
      inTargetPercentagePoints: diff(a.rate.inTargetFraction === null ? null : 100 * a.rate.inTargetFraction, b.rate.inTargetFraction === null ? null : 100 * b.rate.inTargetFraction),
      rhythmCv: diff(a.rate.rhythmCv, b.rate.rhythmCv), pauseCount: b.pauses.count - a.pauses.count,
      pauseMs: b.pauses.totalMs - a.pauses.totalMs,
      chestCompressionFraction: diff(a.activity.chestCompressionFraction, b.activity.chestCompressionFraction),
      armsStraightPercentagePoints: a.arms.bentThresholdDeg !== b.arms.bentThresholdDeg ? null : diff(a.arms.bothStraightFraction === null ? null : 100 * a.arms.bothStraightFraction, b.arms.bothStraightFraction === null ? null : 100 * b.arms.bothStraightFraction),
      unknownMs: b.activity.unknownMs - a.activity.unknownMs,
    },
    notes: [
      'Rate increases are not automatically improvements; the practice target is 100–120 compressions/min.',
      ...(a.durationMs !== b.durationMs ? ['Durations differ; counts and pause totals are not directly comparable.'] : []),
      ...(a.activity.unknownMs || b.activity.unknownMs ? ['Missing observations limit comparison.'] : []),
      ...(a.arms.bentThresholdDeg !== b.arms.bentThresholdDeg ? ['Arm thresholds differ; the straight-arm comparison is unavailable.'] : []),
    ],
    notice: PRACTICE_NOTICE,
  };
}
