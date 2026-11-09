import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { PracticeSession, parseSessionResult, SessionResultSchema, PRACTICE_NOTICE } from '../src/session.js';
import { synthesize } from '../src/synth.js';
import { compareSessions, summarizeSession } from '../mcp/logic.js';
function result(bpm = 110) {
  const s = new PracticeSession(); for (const f of synthesize({ bpm }).frames) s.addFrame(f); return s.finish();
}
it('produces a complete JSON roundtrip and English result', () => {
  const r = result(); expect(parseSessionResult(JSON.parse(JSON.stringify(r.json)))).toEqual(r.json);
  expect(r.json.completed).toBe(true); expect(r.text).toContain(PRACTICE_NOTICE);
  expect(r.json.rate.inTargetFraction).toBe(1);
});
it('keeps short and empty sessions incomplete and unavailable', () => {
  const empty = new PracticeSession().finish();
  expect(empty.json.completed).toBe(false); expect(empty.json.rate.averageCpm).toBeNull();
  expect(empty.json.activity.chestCompressionFraction).toBeNull();
  const unknown = new PracticeSession().finish(120000).json;
  expect(unknown.activity.unknownMs).toBe(120000); expect(unknown.pauses.count).toBe(0);
});
it('handles nonzero origin, trailing unseen time and immutable finalization', () => {
  const s = new PracticeSession({ startTimeMs: 1000000 });
  for (const f of synthesize({ durationMs: 10000 }).frames) s.addFrame({ ...f, timestampMs: f.timestampMs + 1000000 });
  expect(() => s.addFrame({ timestampMs: 1120001, landmarks: [] })).toThrow();
  const r = s.finish(1120000).json;
  expect(r.activity.unknownMs).toBe(110000); expect(r.pauses.count).toBe(0);
  expect(() => s.finish()).toThrow();
  expect(() => s.addFrame({ timestampMs: 1010033, landmarks: [] })).toThrow();
});
it('rejects inconsistent or extra fields supplied to MCP', () => {
  const r = result().json;
  expect(() => parseSessionResult({ ...r, extra: 1 })).toThrow();
  expect(() => parseSessionResult({ ...r, compressionCount: 0 })).toThrow();
  expect(() => parseSessionResult({ ...r, rate: { ...r.rate, inTargetFraction: 0 } })).toThrow();
});
it('returns useful goals and signed differences without equating faster with better', () => {
  const a = result(90).json, b = result(130).json;
  expect(summarizeSession(a).nextPracticeGoals.join(' ')).toContain('faster');
  expect(summarizeSession(b).nextPracticeGoals.join(' ')).toContain('slower');
  expect(compareSessions(a, b).differences.averageCpm).toBeCloseTo(40, 0);
  expect(compareSessions(a, b).notes.join(' ')).toContain('not automatically');
});
it('committed JSON Schema matches the source type/schema', () => {
  const json = JSON.parse(readFileSync(new URL('../schema/session.schema.json', import.meta.url), 'utf8'));
  const { title: _title, description: _description, ...shape } = json;
  expect(shape).toEqual(z.toJSONSchema(SessionResultSchema, { target: 'draft-2020-12' }));
});
