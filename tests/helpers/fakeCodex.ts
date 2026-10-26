/**
 * Fake `codex exec --json` for tests (specs/012): a ChildProcess-like object driven by a script.
 * It reads the stdin prompt, can call tools through the MCP bridge named in
 * `-c mcp_servers.maestro.url=` with the token from `MAESTRO_MCP_TOKEN` (real HTTP on 127.0.0.1)
 * and writes the JSONL events observed with Codex 0.161.0. No real Codex is ever started.
 */
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { PassThrough } from 'node:stream';
import type { spawn as nodeSpawn } from 'node:child_process';

export interface FakeCodexRun {
  args: string[];
  env: NodeJS.ProcessEnv;
  stdin: string;
  instructions: string;
  /** Files passed with `-i`, read when the process started (they are deleted afterwards). */
  images: Buffer[];
  /** `-c key=value` overrides. */
  config: Record<string, string>;
  callTool(name: string, args: unknown): Promise<{ text: string; isError: boolean }>;
  listTools(): Promise<string[]>;
  emit(obj: unknown): void;
  message(t: string): void;
  completed(usage?: Record<string, number>): void;
  failed(message: string): void;
  stderr(t: string): void;
  /** Resolves when the process is killed. */
  untilKilled(): Promise<void>;
  aborted: boolean;
}

export type FakeCodexScript = (run: FakeCodexRun) => Promise<number | void> | number | void;

export interface FakeCodex {
  spawn: typeof nodeSpawn;
  runs: FakeCodexRun[];
}

class FakeChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  exitCode: number | null = null;
  pid = 4343;
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

export function createFakeCodex(script: FakeCodexScript): FakeCodex {
  const runs: FakeCodexRun[] = [];
  const spawn = ((_file: string, args: readonly string[], opts: { env?: NodeJS.ProcessEnv }) => {
    const child = new FakeChild();
    const argv = [...args];
    const env = opts.env ?? {};
    const config: Record<string, string> = {};
    const images: Buffer[] = [];
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === '-c') {
        const kv = argv[i + 1]!;
        const eq = kv.indexOf('=');
        config[kv.slice(0, eq)] = kv.slice(eq + 1);
      }
      if (argv[i] === '-i') images.push(fs.readFileSync(argv[i + 1]!));
    }
    const instructions = fs.readFileSync(config['model_instructions_file']!, 'utf8');
    const url = config['mcp_servers.maestro.url'];
    const token = env[config['mcp_servers.maestro.bearer_token_env_var'] ?? ''];
    let rpcId = 0;
    const rpc = async (method: string, params: unknown) => {
      if (!url || !token) throw new Error('no MCP bridge configured');
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
      });
      return (await res.json()) as { result?: Record<string, unknown> };
    };
    const line = (o: unknown) => {
      if (!child.closed) child.stdout.write(JSON.stringify(o) + '\n');
    };
    let items = 0;
    let input = '';
    child.stdin.on('data', (d: Buffer) => (input += d.toString('utf8')));
    child.stdin.on('end', () => {
      const run: FakeCodexRun = {
        args: argv,
        env,
        stdin: input,
        instructions,
        images,
        config,
        aborted: false,
        callTool: async (name, a) => {
          const r = await rpc('tools/call', { name, arguments: a });
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
        message: (t) =>
          line({
            type: 'item.completed',
            item: { id: `item_${items++}`, type: 'agent_message', text: t },
          }),
        completed: (usage = { input_tokens: 10, output_tokens: 5 }) =>
          line({ type: 'turn.completed', usage }),
        failed: (message) => {
          line({ type: 'error', message });
          line({ type: 'turn.failed', error: { message } });
        },
        stderr: (t) => child.stderr.write(t),
        untilKilled: () =>
          new Promise<void>((resolve) => {
            if (child.closed) resolve();
            else child.on('close', () => resolve());
          }),
      };
      runs.push(run);
      child.on('close', () => (run.aborted = child.killed));
      line({ type: 'thread.started', thread_id: 't-1' });
      line({ type: 'turn.started' });
      void Promise.resolve(script(run)).then(
        (code) => child.finish(typeof code === 'number' ? code : 0),
        () => child.finish(1),
      );
    });
    return child;
  }) as unknown as typeof nodeSpawn;
  return { spawn, runs };
}
