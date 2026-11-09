import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { SessionResultSchema } from '../src/session.js';
import { summarizeSession, compareSessions } from './logic.js';
const server = new McpServer({ name: 'local-cpr-practice', version: '0.1.0' });
const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
function respond(fn: () => object) {
  try {
    const data = fn();
    return { content: [{ type: 'text' as const, text: JSON.stringify(data) }], structuredContent: { ...data } };
  } catch {
    return { isError: true, content: [{ type: 'text' as const, text: 'Invalid or inconsistent practice session JSON.' }] };
  }
}
server.registerTool('summarize_session', {
  description: 'Summarize a practice-only session and suggest the next practice goals. No clinical assessment.',
  inputSchema: z.object({ session: SessionResultSchema }), annotations,
}, ({ session }) => respond(() => summarizeSession(session)));
server.registerTool('compare_sessions', {
  description: 'Compare two practice sessions; numeric differences are after minus before. No clinical assessment.',
  inputSchema: z.object({ before: SessionResultSchema, after: SessionResultSchema }), annotations,
}, ({ before, after }) => respond(() => compareSessions(before, after)));
await server.connect(new StdioServerTransport());
