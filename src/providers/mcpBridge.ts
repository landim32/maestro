/**
 * One-turn MCP server (Streamable HTTP, JSON responses only) that exposes Maestro's tools to
 * Claude Code (specs/010 research R3). It listens on 127.0.0.1 on a random port and requires a
 * random bearer token; every `tools/call` goes through `runTool`, i.e. the turn's validation,
 * interception and approval policy. Only the methods Claude Code needs are implemented.
 */
import http from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { ToolDefinition } from '../tools/types.js';
import type { ToolCallRequest } from './types.js';

export interface McpBridge {
  url: string;
  token: string;
  close(): Promise<void>;
}

export interface McpBridgeOptions {
  tools: ToolDefinition[];
  runTool: (call: ToolCallRequest) => Promise<{ output: string; isError: boolean }>;
  serverName?: string;
  /** Largest request body accepted (bytes). */
  maxBodyBytes?: number;
}

const DEFAULT_PROTOCOL = '2025-06-18';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

export function toolListing(tools: ToolDefinition[]): Array<{
  name: string;
  description: string;
  inputSchema: Json;
}> {
  return tools.map((t) => {
    const schema = z.toJSONSchema(t.inputSchema) as Json;
    delete schema['$schema'];
    return { name: t.name, description: t.description, inputSchema: { ...schema, type: 'object' } };
  });
}

function sameToken(header: string | undefined, token: string): boolean {
  const expected = Buffer.from(`Bearer ${token}`);
  const got = Buffer.from(header ?? '');
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export function startMcpBridge(o: McpBridgeOptions): Promise<McpBridge> {
  const token = randomBytes(24).toString('hex');
  const listing = toolListing(o.tools);
  const known = new Set(o.tools.map((t) => t.name as string));
  const maxBody = o.maxBodyBytes ?? 8 * 1024 * 1024;

  async function handle(msg: Json): Promise<Json | undefined> {
    const id = msg['id'];
    const method = msg['method'];
    if (id === undefined || id === null) return undefined; // notification
    const ok = (result: unknown) => ({ jsonrpc: '2.0', id, result });
    const fail = (code: number, message: string) => ({
      jsonrpc: '2.0',
      id,
      error: { code, message },
    });
    const params = isObj(msg['params']) ? msg['params'] : {};

    switch (method) {
      case 'initialize':
        return ok({
          protocolVersion:
            typeof params['protocolVersion'] === 'string'
              ? params['protocolVersion']
              : DEFAULT_PROTOCOL,
          capabilities: { tools: {} },
          serverInfo: { name: o.serverName ?? 'maestro', version: '1' },
        });
      case 'ping':
        return ok({});
      case 'tools/list':
        return ok({ tools: listing });
      case 'tools/call': {
        const name = typeof params['name'] === 'string' ? params['name'] : '';
        if (!known.has(name)) return fail(-32602, `unknown tool: ${name}`);
        const meta = isObj(params['_meta']) ? params['_meta'] : {};
        const callId =
          typeof meta['claudecode/toolUseId'] === 'string'
            ? meta['claudecode/toolUseId']
            : `mcp_${randomUUID()}`;
        let r: { output: string; isError: boolean };
        try {
          r = await o.runTool({ callId, name, input: params['arguments'] ?? {} });
        } catch (err) {
          r = {
            output: `tool failed: ${err instanceof Error ? err.message : String(err)}`,
            isError: true,
          };
        }
        return ok({ content: [{ type: 'text', text: r.output }], isError: r.isError });
      }
      default:
        return fail(-32601, `method not found: ${String(method)}`);
    }
  }

  const server = http.createServer((req, res) => {
    if (!sameToken(req.headers.authorization, token)) {
      res.writeHead(401).end();
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST' }).end();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > maxBody) {
        res.writeHead(413).end();
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (res.writableEnded) return;
      let body: unknown;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' }).end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32700, message: 'parse error' },
          }),
        );
        return;
      }
      const batch = Array.isArray(body) ? body : [body];
      void Promise.all(batch.map((m) => (isObj(m) ? handle(m) : Promise.resolve(undefined)))).then(
        (replies) => {
          const out = replies.filter((r): r is Json => r !== undefined);
          if (res.writableEnded) return;
          if (out.length === 0) {
            res.writeHead(202).end();
            return;
          }
          res
            .writeHead(200, { 'content-type': 'application/json' })
            .end(JSON.stringify(Array.isArray(body) ? out : out[0]));
        },
      );
    });
  });
  // A tool call may wait for the user's confirmation; never time the request out here.
  server.requestTimeout = 0;
  server.headersTimeout = 60_000;

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}/mcp`,
        token,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}
