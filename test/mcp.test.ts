import { expect, it } from 'vitest';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { PracticeSession } from '../src/session.js';
import { synthesize } from '../src/synth.js';
it('advertises and calls both tools over a real local stdio transport', async () => {
  const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'mcp/server.ts'], stderr: 'inherit', env: { TMPDIR: tmpdir() } });
  const client = new Client({ name: 'practice-test', version: '1.0.0' });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.map(t => t.name).sort()).toEqual(['compare_sessions', 'summarize_session']);
    const s = new PracticeSession();
    for (const frame of synthesize({ durationMs: 5000 }).frames) s.addFrame(frame);
    const result = s.finish().json;
    const summary = await client.callTool({ name: 'summarize_session', arguments: { session: result } });
    expect(summary.isError).not.toBe(true);
    expect(JSON.stringify(summary)).toContain('nextPracticeGoals');
    const comparison = await client.callTool({ name: 'compare_sessions', arguments: { before: result, after: result } });
    expect(comparison.isError).not.toBe(true);
    expect(JSON.stringify(comparison)).toContain('after minus before');
    const invalid = await client.callTool({ name: 'summarize_session', arguments: { session: { ...result, compressionCount: 0 } } });
    expect(invalid.isError).toBe(true);
    const malformed = await client.callTool({ name: 'summarize_session', arguments: { session: {} } });
    expect(malformed.isError).toBe(true);
  } finally { await client.close(); await transport.close(); }
}, 15000);
