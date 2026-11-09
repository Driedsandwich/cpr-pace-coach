import type { DetectorSnapshot } from './detector.js';

/** Shared by visual and optional spoken feedback; never depends on demo timing. */
export function coachingCue(snapshot: DetectorSnapshot | null, paused = false): string {
  if (paused) return 'Take your time. Resume when ready.';
  if (snapshot?.missingLandmarks) return 'Keep both shoulders and arms in view';
  if (snapshot?.pauses.some(p => p.ongoing)) return 'Resume compressions';
  if (snapshot?.elbows.leftBent || snapshot?.elbows.rightBent) return 'Keep your arms straight';
  const rate = snapshot?.recentRateCpm;
  if (rate == null) return 'Start moving to find your rhythm';
  if (rate < 100) return 'Push faster';
  if (rate > 120) return 'Slow down a little';
  return 'Keep a steady rhythm';
}
