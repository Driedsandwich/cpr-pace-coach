// Run the repository's actual stdio server and retain the JSON-RPC messages.
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
export async function recordMcp(root, output) {
  const exported = JSON.parse(await readFile(path.join(output, 'demo-result.json'), 'utf8'));
  const transport = new StdioClientTransport({
    command: process.execPath, args: ['--import', 'tsx', 'mcp/server.ts'],
    cwd: root, stderr: 'pipe', env: { TMPDIR: tmpdir() },
  });
  const client = new Client({ name: 'cpr-demo-recorder', version: '1.0.0' });
  const messages = [];
  const send = transport.send.bind(transport);
  transport.send = async message => { messages.push({ direction: 'request', message }); return send(message); };
  try {
    await client.connect(transport);
    const receive = transport.onmessage;
    transport.onmessage = (message, extra) => {
      messages.push({ direction: 'response', message });
      receive(message, extra);
    };
    const listed = await client.listTools();
    if (!listed.tools.some(t => t.name === 'summarize_session')) throw new Error('Missing summarize_session');
    const called = await client.callTool({ name: 'summarize_session', arguments: { session: exported.session } });
    if (called.isError) throw new Error('MCP call failed');
    const pair = method => {
      const request = messages.find(m => m.message.method === method).message;
      const response = messages.find(m => m.direction === 'response' && m.message.id === request.id).message;
      return { request, response };
    };
    const list = pair('tools/list'), call = pair('tools/call');
    for (const [name, value] of Object.entries({ 'mcp-transcript': messages, 'tools-list-request': list.request, 'tools-list-response': list.response, 'tools-call-request': call.request, 'tools-call-response': call.response })) {
      await writeFile(path.join(output, name + '.json'), JSON.stringify(value, null, 2) + '\n');
    }
    return { exported, list, call };
  } finally {
    await client.close();
    await transport.close();
  }
}
