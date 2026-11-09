import { CompressionDetector, type DetectorConfig, type DetectorSnapshot, type PoseFrame } from './detector.js';
import { parseSessionResult, type SessionResult } from './result.js';
export { SessionResultSchema, parseSessionResult, type SessionResult } from './result.js';
export const PRACTICE_NOTICE = 'Practice tool only. In a real emergency, call your local emergency number and follow the dispatcher.';
export function sessionText(result: SessionResult): string {
  const r = parseSessionResult(result);
  const rate = r.rate.averageCpm === null ? 'Rate unavailable' : `Average rate ${r.rate.averageCpm.toFixed(1)} compressions/min`;
  const target = r.rate.inTargetFraction === null ? 'target-band share unavailable' : `${(r.rate.inTargetFraction * 100).toFixed(0)}% of evaluable compressions in the 100–120 target band`;
  const cv = r.rate.rhythmCv === null ? 'unavailable' : r.rate.rhythmCv.toFixed(3);
  const arms = r.arms.bothStraightFraction === null ? 'unavailable' : `${(100 * r.arms.bothStraightFraction).toFixed(0)}%`;
  return `${rate}; ${target}. Interval CV ${cv}. ${r.pauses.count} observed pauses, ${(r.pauses.totalMs / 1000).toFixed(1)} s total. Both arms straight: ${arms} of arm-observed time. Unknown time: ${(r.activity.unknownMs / 1000).toFixed(1)} s. ${PRACTICE_NOTICE}`;
}
export class PracticeSession {
  readonly durationMs = 120000;
  readonly detector: CompressionDetector;
  private lastTime: number;
  private finished = false;
  constructor(config: Partial<Omit<DetectorConfig, 'pauseThresholdMs'>> = {}) {
    this.detector = new CompressionDetector({ ...config, pauseThresholdMs: 2000 });
    this.lastTime = this.detector.config.startTimeMs;
  }
  addFrame(frame: PoseFrame): DetectorSnapshot {
    if (this.finished) throw new Error('Session already finished');
    if (frame.timestampMs > this.detector.config.startTimeMs + this.durationMs) throw new RangeError('Frame exceeds the two-minute session');
    const result = this.detector.update(frame); this.lastTime = frame.timestampMs; return result;
  }
  /** Finalizes once. Defaults to last observed time; early recordings remain incomplete. */
  finish(endMs = this.lastTime): { json: SessionResult; text: string } {
    if (this.finished) throw new Error('Session already finished');
    const start = this.detector.config.startTimeMs;
    if (endMs < this.lastTime || endMs < start || endMs > start + this.durationMs) throw new RangeError('Invalid session end');
    const s = this.detector.snapshot(endMs), intervals = this.detector.validIntervalsMs;
    const inTarget = intervals.filter(dt => 60000 / dt >= 100 - 1e-8 && 60000 / dt <= 120 + 1e-8).length;
    const elapsed = endMs - start;
    const json = parseSessionResult({
      schemaVersion: '1.0', purpose: 'practice-only', plannedDurationMs: this.durationMs,
      durationMs: elapsed, completed: elapsed === this.durationMs, compressionCount: s.compressionCount,
      rate: { targetMinCpm: 100, targetMaxCpm: 120, evaluableCount: intervals.length, inTargetCount: inTarget,
        inTargetFraction: intervals.length ? inTarget / intervals.length : null, averageCpm: s.averageRateCpm, rhythmCv: s.rhythmCv },
      pauses: { thresholdMs: 2000, count: s.pauses.length, totalMs: s.pauseMs,
        intervals: s.pauses.map(p => ({ startMs: p.startMs - start, endMs: p.endMs - start, durationMs: p.durationMs })) },
      activity: { observedMs: s.observedMs, unknownMs: s.unknownMs, activeMs: s.activeMs,
        chestCompressionFraction: s.chestCompressionFraction, observedCompressionFraction: s.observedCompressionFraction },
      arms: { bentThresholdDeg: this.detector.config.bentAngleDeg, observedMs: s.armObservedMs, bothStraightMs: s.armsStraightMs,
        bothStraightFraction: s.armObservedMs ? s.armsStraightMs / s.armObservedMs : null,
        meanLeftDeg: s.meanLeftElbowDeg, meanRightDeg: s.meanRightElbowDeg },
    });
    this.finished = true; return { json, text: sessionText(json) };
  }
}
