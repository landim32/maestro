/**
 * Claude Code provider (specs/010): each request runs the user's installed `claude` binary in
 * print mode with stream-json input/output. Claude Code keeps its own login (the user's
 * Claude.ai subscription); Maestro never reads, stores or forwards those credentials. Built-in
 * tools are disabled and Maestro's tools are exposed through a one-turn MCP bridge, so the
 * approval policy, Spec Kit interception and path confinement still apply.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawn as nodeSpawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { MaestroError } from '../utils/errors.js';
import { redact } from '../utils/mask.js';
import { killTree, locateClaudeCode } from '../utils/process.js';
import {
  buildArgs,
  buildUserMessage,
  lastLine,
  mcpConfigJson,
  newParserState,
  parseLine,
  resultError,
  toolNamingNote,
  usageOf,
} from './claudeCodeStream.js';
import { startMcpBridge } from './mcpBridge.js';
import type { McpBridge, McpBridgeOptions } from './mcpBridge.js';
import { CREDENTIAL_HINTS, describeProvider, DISPLAY_NAMES } from './status.js';
import type { ModelProvider, ProviderContext, ProviderEvent, ProviderRequest } from './types.js';

/** Claude Code waits this long for a tool call (a confirmation may wait for the user). */
export const MCP_TOOL_TIMEOUT_MS = 24 * 60 * 60 * 1000;

/** Variables removed from the child's environment so Claude Code uses its own login, not API credits. */
export const STRIPPED_ENV = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'] as const;

export interface ClaudeCodeDeps {
  spawn?: typeof nodeSpawn;
  locate?: (command: string | undefined) => string | undefined;
  startBridge?: (o: McpBridgeOptions) => Promise<McpBridge>;
  tmpDir?: () => string;
  platform?: NodeJS.Platform;
  /** Logs events and counts only (FR-016). */
  log?: (event: string, data: Record<string, unknown>) => void;
}

export function childEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env, MCP_TOOL_TIMEOUT: String(MCP_TOOL_TIMEOUT_MS) };
  for (const k of STRIPPED_ENV) delete out[k];
  return out;
}

/** `.cmd`/`.bat` shims need cmd.exe; every argument we pass is a flag, a name or a file path. */
function spawnSpec(
  exe: string,
  args: string[],
  platform: NodeJS.Platform,
): { file: string; args: string[]; shell: boolean } {
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(exe)) {
    const quote = (a: string) => `"${a.replace(/"/g, '""')}"`;
    return { file: quote(exe), args: args.map(quote), shell: true };
  }
  return { file: exe, args, shell: false };
}

function notFound(): MaestroError {
  return new MaestroError({
    providerId: 'claude-code',
    category: 'invalid_config',
    message: 'o executável do Claude Code não foi encontrado',
    hint: CREDENTIAL_HINTS['claude-code'],
  });
}

export function createClaudeCodeProvider(
  ctx: ProviderContext,
  deps: ClaudeCodeDeps = {},
): ModelProvider {
  const cfg = ctx.settings.providers['claude-code'];
  const env = ctx.env ?? process.env;
  const platform = deps.platform ?? process.platform;
  const spawn = deps.spawn ?? nodeSpawn;
  const locate = deps.locate ?? ((c) => locateClaudeCode(c, { env, platform }));
  const startBridge = deps.startBridge ?? startMcpBridge;
  const tmpRoot = deps.tmpDir ?? (() => os.tmpdir());
  const log = deps.log ?? (() => {});

  return {
    id: 'claude-code',
    displayName: DISPLAY_NAMES['claude-code'],
    capabilities: { images: true, executesTools: true },
    status: () => describeProvider('claude-code', ctx),
    stream(req: ProviderRequest): AsyncIterable<ProviderEvent> {
      return run(req);
    },
  };

  async function* run(req: ProviderRequest): AsyncGenerator<ProviderEvent> {
    const exe = locate(cfg.command);
    if (!exe) {
      yield { type: 'error', error: notFound() };
      return;
    }
    const model = req.model ?? cfg.model;
    const effort = req.overrides?.effort ?? cfg.effort;
    const withTools = req.tools.length > 0 && req.runTool !== undefined;

    let dir: string | undefined;
    let bridge: McpBridge | undefined;
    let child: ChildProcess | undefined;
    const onAbort = () => {
      if (child) killTree(child, platform);
    };

    try {
      dir = fs.mkdtempSync(path.join(tmpRoot(), 'maestro-cc-'));
      const systemPromptFile = path.join(dir, 'system.txt');
      fs.writeFileSync(
        systemPromptFile,
        req.system + toolNamingNote(withTools ? req.tools.map((t) => t.name) : []),
        { encoding: 'utf8', mode: 0o600 },
      );
      let mcpConfigFile: string | undefined;
      if (withTools) {
        bridge = await startBridge({ tools: req.tools, runTool: req.runTool! });
        mcpConfigFile = path.join(dir, 'mcp.json');
        fs.writeFileSync(mcpConfigFile, mcpConfigJson(bridge.url, bridge.token), {
          encoding: 'utf8',
          mode: 0o600,
        });
      }
      if (req.signal.aborted) {
        yield { type: 'done', stopReason: 'cancelled' };
        return;
      }

      const spec = spawnSpec(
        exe,
        buildArgs({ model, effort, systemPromptFile, mcpConfigFile }),
        platform,
      );
      log('claudecode.start', { model, tools: withTools ? req.tools.length : 0 });
      const proc = spawn(spec.file, spec.args, {
        cwd: process.cwd(),
        env: childEnv(env),
        shell: spec.shell,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      child = proc;
      req.signal.addEventListener('abort', onAbort, { once: true });

      let spawnError: Error | undefined;
      proc.on('error', (err) => {
        spawnError = err;
      });
      const exited = new Promise<number | null>((resolve) => {
        proc.on('close', (code) => resolve(code));
        proc.on('error', () => resolve(null));
      });
      let stderr = '';
      proc.stderr?.setEncoding('utf8');
      proc.stderr?.on('data', (d: string) => {
        if (stderr.length < 64_000) stderr += d;
      });

      proc.stdin?.on('error', () => {
        /* the process may exit before reading stdin; reported through the exit path */
      });
      proc.stdin?.end(JSON.stringify(buildUserMessage(req.messages)) + '\n');

      const st = newParserState();
      if (proc.stdout) {
        const rl = readline.createInterface({ input: proc.stdout, crlfDelay: Infinity });
        for await (const line of rl) {
          for (const ev of parseLine(line, st)) yield ev;
        }
      }
      const code = await exited;
      log('claudecode.exit', { code, aborted: req.signal.aborted, result: Boolean(st.result) });

      if (req.signal.aborted) {
        yield { type: 'done', stopReason: 'cancelled' };
        return;
      }
      const clean = (s: string) => redact(s, []);
      if (spawnError) {
        const enoent = (spawnError as NodeJS.ErrnoException).code === 'ENOENT';
        yield {
          type: 'error',
          error: enoent
            ? notFound()
            : new MaestroError({
                providerId: 'claude-code',
                category: 'provider',
                message: `não foi possível iniciar o Claude Code: ${clean(spawnError.message)}`,
              }),
        };
        return;
      }
      if (!st.result) {
        yield {
          type: 'error',
          error: new MaestroError({
            providerId: 'claude-code',
            category: 'provider',
            message: `o Claude Code terminou sem resposta (código ${code ?? '?'})${
              lastLine(stderr) ? `: ${clean(lastLine(stderr))}` : ''
            }`,
          }),
        };
        return;
      }
      const usage = usageOf(st.result);
      if (usage.inputTokens || usage.outputTokens) yield { type: 'usage', ...usage };
      const err = resultError(st.result, st, clean);
      if (err) {
        yield { type: 'error', error: err };
        return;
      }
      yield { type: 'done', stopReason: 'end_turn' };
    } finally {
      req.signal.removeEventListener('abort', onAbort);
      if (child && child.exitCode === null) killTree(child, platform);
      if (bridge) await bridge.close();
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}
