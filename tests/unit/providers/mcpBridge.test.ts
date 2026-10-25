import { afterEach, describe, expect, it } from 'vitest';
import { startMcpBridge, toolListing } from '../../../src/providers/mcpBridge.js';
import type { McpBridge, McpBridgeOptions } from '../../../src/providers/mcpBridge.js';
import { allTools, getTool } from '../../../src/tools/registry.js';

const readFileTool = getTool('read_file')!;

const open: McpBridge[] = [];
afterEach(async () => {
  for (const b of open.splice(0)) await b.close();
});

async function bridge(
  runTool: McpBridgeOptions['runTool'] = async () => ({ output: 'ok', isError: false }),
) {
  const b = await startMcpBridge({ tools: [readFileTool], runTool });
  open.push(b);
  return b;
}

const post = (b: McpBridge, body: unknown, auth = `Bearer ${b.token}`) =>
  fetch(b.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: auth },
    body: JSON.stringify(body),
  });

describe('MCP bridge (specs/010 research R3, FR-008)', () => {
  it('listens on loopback only with a random token', async () => {
    const a = await bridge();
    const b = await bridge();
    expect(a.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    expect(a.token).toMatch(/^[0-9a-f]{48}$/);
    expect(a.token).not.toBe(b.token);
    expect(a.url).not.toBe(b.url);
  });

  it('rejects requests without the token, or with a wrong one', async () => {
    const b = await bridge();
    expect((await post(b, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, '')).status).toBe(401);
    expect(
      (await post(b, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, 'Bearer nope')).status,
    ).toBe(401);
    expect((await fetch(b.url, { headers: { authorization: `Bearer ${b.token}` } })).status).toBe(
      405,
    );
  });

  it('initialize echoes the protocol; notifications get 202; unknown methods an error', async () => {
    const b = await bridge();
    const init = await (
      await post(b, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-11-25' },
      })
    ).json();
    expect(init).toMatchObject({
      id: 1,
      result: {
        protocolVersion: '2025-11-25',
        capabilities: { tools: {} },
        serverInfo: { name: 'maestro' },
      },
    });
    expect((await post(b, { jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(
      202,
    );
    const unknown = await (
      await post(b, { jsonrpc: '2.0', id: 2, method: 'resources/list' })
    ).json();
    expect(unknown).toMatchObject({ id: 2, error: { code: -32601 } });
  });

  it('lists tools with their JSON schema', async () => {
    const b = await bridge();
    const res = await (await post(b, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).json();
    expect(res.result.tools).toEqual(toolListing([readFileTool]));
    expect(res.result.tools[0]).toMatchObject({
      name: 'read_file',
      inputSchema: { type: 'object' },
    });
    expect(toolListing(allTools()).map((t) => t.name)).toContain('ask_user');
  });

  it('tools/call goes through runTool with the Claude Code tool-use id; errors are flagged', async () => {
    const seen: unknown[] = [];
    const b = await bridge(async (call) => {
      seen.push(call);
      return { output: 'user declined', isError: true };
    });
    const res = await (
      await post(b, {
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: {
          name: 'read_file',
          arguments: { path: 'x' },
          _meta: { 'claudecode/toolUseId': 'toolu_1' },
        },
      })
    ).json();
    expect(seen).toEqual([{ callId: 'toolu_1', name: 'read_file', input: { path: 'x' } }]);
    expect(res).toMatchObject({
      id: 7,
      result: { content: [{ type: 'text', text: 'user declined' }], isError: true },
    });
  });

  it('tools outside the turn are refused without calling runTool', async () => {
    let called = false;
    const b = await bridge(async () => {
      called = true;
      return { output: '', isError: false };
    });
    const res = await (
      await post(b, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'write_file', arguments: {} },
      })
    ).json();
    expect(res).toMatchObject({ error: { code: -32602 } });
    expect(called).toBe(false);
  });

  it('a throwing runTool becomes an error result', async () => {
    const b = await bridge(async () => {
      throw new Error('boom');
    });
    const res = await (
      await post(b, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'read_file', arguments: {} },
      })
    ).json();
    expect(res.result).toMatchObject({ isError: true, content: [{ text: 'tool failed: boom' }] });
  });

  it('close() stops the server', async () => {
    const b = await startMcpBridge({
      tools: [],
      runTool: async () => ({ output: '', isError: false }),
    });
    await b.close();
    await expect(post(b, { jsonrpc: '2.0', id: 1, method: 'ping' })).rejects.toThrow();
  });
});
