/**
 * Fake `claude -p` for tests (specs/010): a ChildProcess-like object driven by a script. It reads
 * the stdin message, can call tools through the MCP bridge named in `--mcp-config` (real HTTP on
 * 127.0.0.1) and writes stream-json lines to stdout. No real Claude Code is ever started.
 */
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { PassThrough } from 'node:stream';
import type { spawn as nodeSpawn } from 'node:child_process';

export interface FakeRun {
  args: string[];
  env: NodeJS.ProcessEnv;
  stdin: unknown;
  systemPrompt: string;
  /** Calls a Maestro tool through the bridge, as Claude Code would. */
  callTool(
    name: string,
    args: unknown,
    toolUseId?: string,
  ): Promise<{ text: string; isError: boolean }>;
  listTools(): Promise<string[]>;
  emit(obj: unknown): void;
  text(t: string, id?: string): void;
  result(partial?: Record<string, unknown>): void;
  stderr(t: string): void;
  aborted: boolean;
}

export type FakeScript = (run: FakeRun) => Promise<number | void> | number | void;

export interface FakeClaudeCode {
  spawn: typeof nodeSpawn;
  runs: FakeRun[];
}

class FakeChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  exitCode: number | null = null;
  pid = 4242;
  killed = false;
  kill(): boolean {
    this.killed = true;
    this.finish(null);
    return true;
  }
  finish(code: number | null) {
    if (this.closed) return;
    this.closed = true;
    this.exitCode = code ?? 1;
    this.stdout.end();
    this.stderr.end();
    setImmediate(() => this.emit('close', code));
  }
  closed = false;
}

export function createFakeClaudeCode(script: FakeScript): FakeClaudeCode {
  const runs: FakeRun[] = [];
  const spawn = ((_file: string, args: readonly string[], opts: { env?: NodeJS.ProcessEnv }) => {
    const child = new FakeChild();
    const argv = [...args];
    const at = (flag: string) => argv[argv.indexOf(flag) + 1];
    let mcp: { url: string; token: string } | undefined;
    const mcpFile = argv.includes('--mcp-config') ? at('--mcp-config') : undefined;
    if (mcpFile) {
      const cfg = JSON.parse(fs.readFileSync(mcpFile, 'utf8')) as {
        mcpServers: { maestro: { url: string; headers: { Authorization: string } } };
      };
      mcp = {
        url: cfg.mcpServers.maestro.url,
        token: cfg.mcpServers.maestro.headers.Authorization.replace('Bearer ', ''),
      };
    }
    let rpcId = 0;
    const rpc = async (method: string, params: unknown) => {
      if (!mcp) throw new Error('no MCP bridge configured');
      const res = await fetch(mcp.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${mcp.token}` },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
      });
      return (await res.json()) as {
        result?: Record<string, unknown>;
        error?: { message: string };
      };
    };
    const line = (o: unknown) => {
      if (!child.closed) child.stdout.write(JSON.stringify(o) + '\n');
    };
    let input = '';
    child.stdin.on('data', (d: Buffer) => (input += d.toString('utf8')));
    child.stdin.on('end', () => {
      const run: FakeRun = {
        args: argv,
        env: opts.env ?? {},
        stdin: JSON.parse(input.trim()),
        systemPrompt: fs.readFileSync(at('--system-prompt-file')!, 'utf8'),
        aborted: false,
        callTool: async (name, a, toolUseId) => {
          const r = await rpc('tools/call', {
            name,
            arguments: a,
            _meta: toolUseId ? { 'claudecode/toolUseId': toolUseId } : undefined,
          });
          const content = (r.result?.['content'] as Array<{ text: string }>) ?? [];
          return {
            text: content.map((c) => c.text).join(''),
            isError: r.result?.['isError'] === true,
          };
        },
        listTools: async () => {
          const r = await rpc('tools/list', {});
          return ((r.result?.['tools'] as Array<{ name: string }>) ?? []).map((t) => t.name);
        },
        emit: line,
        text: (t, id = 'msg_1') =>
          line({
            type: 'stream_event',
            event: {
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'text_delta', text: t },
            },
            parent_tool_use_id: null,
            api_message_id: id,
          }),
        result: (partial = {}) =>
          line({
            type: 'result',
            subtype: 'success',
            is_error: false,
            usage: { input_tokens: 10, output_tokens: 5 },
            ...partial,
          }),
        stderr: (t) => child.stderr.write(t),
      };
      runs.push(run);
      child.on('close', () => (run.aborted = child.killed));
      void Promise.resolve(script(run)).then(
        (code) => child.finish(typeof code === 'number' ? code : 0),
        () => child.finish(1),
      );
    });
    return child;
  }) as unknown as typeof nodeSpawn;
  return { spawn, runs };
}
