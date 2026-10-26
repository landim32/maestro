/**
 * Codex provider (specs/012): each request runs the user's installed `codex` binary in
 * `exec --json` mode with the prompt on stdin. Codex keeps its own login (the user's ChatGPT
 * subscription); Maestro never reads, stores or forwards those credentials. Codex's own tools
 * are disabled (plus a read-only sandbox) and Maestro's tools are exposed through the one-turn
 * MCP bridge of specs/010, so the approval policy, Spec Kit interception and path confinement
 * still apply.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawn as nodeSpawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { MaestroError } from '../utils/errors.js';
import { redact } from '../utils/mask.js';
import { killTree, locateCodex, spawnSpec } from '../utils/process.js';
import { createCodexCli } from '../setup/codexCli.js';
import { lastLine } from './claudeCodeStream.js';
import {
  buildCodexArgs,
  buildPrompt,
  childEnvCodex,
  CODEX_UPDATE_HINT,
  codexError,
  codexToolsNote,
  imageExtension,
  MIN_CODEX_VERSION,
  newCodexParserState,
  parseCodexLine,
  versionAtLeast,
} from './codexStream.js';
import { startMcpBridge } from './mcpBridge.js';
import type { McpBridge, McpBridgeOptions } from './mcpBridge.js';
import { CREDENTIAL_HINTS, describeProvider, DISPLAY_NAMES } from './status.js';
import type { ModelProvider, ProviderContext, ProviderEvent, ProviderRequest } from './types.js';

export interface CodexDeps {
  spawn?: typeof nodeSpawn;
  locate?: (command: string | undefined) => string | undefined;
  readVersion?: (exe: string) => Promise<string | undefined>;
  startBridge?: (o: McpBridgeOptions) => Promise<McpBridge>;
  tmpDir?: () => string;
  platform?: NodeJS.Platform;
  /** Logs events and counts only (FR-015). */
  log?: (event: string, data: Record<string, unknown>) => void;
}

function notFound(): MaestroError {
  return new MaestroError({
    providerId: 'codex',
    category: 'invalid_config',
    message: 'o executável do Codex não foi encontrado',
    hint: CREDENTIAL_HINTS.codex,
  });
}

function tooOld(version: string | undefined): MaestroError {
  return new MaestroError({
    providerId: 'codex',
    category: 'invalid_config',
    message: version
      ? `o Codex ${version} é anterior à versão mínima ${MIN_CODEX_VERSION}`
      : 'não foi possível ler a versão do Codex (codex --version)',
    hint: CODEX_UPDATE_HINT,
  });
}

export function createCodexProvider(ctx: ProviderContext, deps: CodexDeps = {}): ModelProvider {
  const cfg = ctx.settings.providers.codex;
  const env = ctx.env ?? process.env;
  const platform = deps.platform ?? process.platform;
  const spawn = deps.spawn ?? nodeSpawn;
  const locate = deps.locate ?? ((c) => locateCodex(c, { env, platform }));
  const readVersion = deps.readVersion ?? createCodexCli({ env, platform }).readVersion;
  const startBridge = deps.startBridge ?? startMcpBridge;
  const tmpRoot = deps.tmpDir ?? (() => os.tmpdir());
  const log = deps.log ?? (() => {});
  /** Checked once per executable (R3). */
  const versions = new Map<string, Promise<string | undefined>>();

  return {
    id: 'codex',
    displayName: DISPLAY_NAMES.codex,
    capabilities: { images: true, executesTools: true },
    status: () => describeProvider('codex', ctx),
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
    if (!versions.has(exe))
      versions.set(
        exe,
        readVersion(exe).catch(() => undefined),
      );
    const version = await versions.get(exe);
    log('codex.version', { version: version ?? null });
    if (!version || !versionAtLeast(version, MIN_CODEX_VERSION)) {
      versions.delete(exe); // the user may update Codex without restarting Maestro
      yield { type: 'error', error: tooOld(version) };
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
      dir = fs.mkdtempSync(path.join(tmpRoot(), 'maestro-codex-'));
      const instructionsFile = path.join(dir, 'instructions.md');
      fs.writeFileSync(
        instructionsFile,
        req.system + codexToolsNote(withTools ? req.tools.map((t) => t.name) : []),
        { encoding: 'utf8', mode: 0o600 },
      );
      const prompt = buildPrompt(req.messages);
      const images = prompt.images.map((img, i) => {
        const file = path.join(dir!, `image-${i + 1}.${imageExtension(img.mediaType)}`);
        fs.writeFileSync(file, Buffer.from(img.data, 'base64'), { mode: 0o600 });
        return file;
      });
      if (withTools) bridge = await startBridge({ tools: req.tools, runTool: req.runTool! });
      if (req.signal.aborted) {
        yield { type: 'done', stopReason: 'cancelled' };
        return;
      }

      const spec = spawnSpec(
        exe,
        buildCodexArgs({
          cwd: process.cwd(),
          instructionsFile,
          model,
          effort,
          images,
          mcpUrl: bridge?.url,
        }),
        platform,
      );
      log('codex.start', { model, tools: withTools ? req.tools.length : 0 });
      const proc = spawn(spec.file, spec.args, {
        cwd: process.cwd(),
        env: childEnvCodex(env, bridge?.token),
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
      proc.stdin?.end(prompt.text + '\n');

      const st = newCodexParserState();
      if (proc.stdout) {
        const rl = readline.createInterface({ input: proc.stdout, crlfDelay: Infinity });
        for await (const line of rl) {
          for (const ev of parseCodexLine(line, st)) yield ev;
        }
      }
      const code = await exited;
      log('codex.exit', {
        code,
        aborted: req.signal.aborted,
        completed: st.completed,
        warnings: st.warnings,
      });

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
                providerId: 'codex',
                category: 'provider',
                message: `não foi possível iniciar o Codex: ${clean(spawnError.message)}`,
              }),
        };
        return;
      }
      if (st.failure !== undefined) {
        yield { type: 'error', error: codexError(st.failure, clean) };
        return;
      }
      if (!st.completed) {
        yield {
          type: 'error',
          error: new MaestroError({
            providerId: 'codex',
            category: 'provider',
            message: `o Codex terminou sem resposta (código ${code ?? '?'})${
              lastLine(stderr) ? `: ${clean(lastLine(stderr))}` : ''
            }`,
          }),
        };
        return;
      }
      if (st.usage && (st.usage.inputTokens || st.usage.outputTokens)) {
        yield { type: 'usage', ...st.usage };
      }
      yield { type: 'done', stopReason: 'end_turn' };
    } finally {
      req.signal.removeEventListener('abort', onAbort);
      // Kill the process before closing the bridge, so no tool call arrives afterwards.
      if (child && child.exitCode === null) killTree(child, platform);
      if (bridge) await bridge.close();
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}
