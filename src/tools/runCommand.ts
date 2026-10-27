import { spawn } from 'node:child_process';
import { z } from 'zod';
import { decodeCommandOutput } from '../utils/consoleEncoding.js';
import { killTree } from '../utils/process.js';
import { resolveInsideCwd, truncate } from './sandbox.js';
import type { ToolDefinition } from './types.js';

const inputSchema = z.object({
  command: z.string().min(1).describe('Shell command line to run.'),
  cwd: z
    .string()
    .optional()
    .describe(
      'Working directory for the command, relative to the workspace. Defaults to the workspace root.',
    ),
});

export type RunCommandInput = z.infer<typeof inputSchema>;

export function shellFor(platform: NodeJS.Platform = process.platform): {
  file: string;
  args: (cmd: string) => string[];
} {
  if (platform === 'win32') {
    return {
      file: process.env['ComSpec'] || 'cmd.exe',
      args: (cmd) => ['/d', '/s', '/c', `"${cmd}"`],
    };
  }
  return { file: '/bin/sh', args: (cmd) => ['-c', cmd] };
}

export const runCommandTool: ToolDefinition<RunCommandInput> = {
  name: 'run_command',
  description:
    'Run a shell command inside the working directory and return its combined output and exit code. May require user approval depending on the approval mode.',
  inputSchema,
  kind: 'command',
  async preview(input, ctx) {
    const dir = input.cwd ? resolveInsideCwd(ctx.cwd, input.cwd) : ctx.cwd;
    return `$ ${input.command}\n(in ${dir}, timeout ${Math.round(ctx.settings.commandTimeoutMs / 1000)}s)`;
  },
  run(input, ctx) {
    return new Promise((resolve) => {
      let dir: string;
      try {
        dir = input.cwd ? resolveInsideCwd(ctx.cwd, input.cwd) : ctx.cwd;
      } catch (err) {
        return resolve({ isError: true, output: err instanceof Error ? err.message : String(err) });
      }

      const shell = shellFor();
      const child = spawn(shell.file, shell.args(input.command), {
        cwd: dir,
        windowsHide: true,
        windowsVerbatimArguments: process.platform === 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
      });

      // Bytes are decoded once at the end: the encoding is decided on the whole output and a
      // multi-byte character split across chunks stays intact.
      const chunks: Buffer[] = [];
      let size = 0;
      let timedOut = false;
      let settled = false;
      const limit = ctx.settings.maxOutputChars * 4; // keep memory bounded; final truncation below
      const collect = (buf: Buffer) => {
        if (size >= limit) return;
        chunks.push(buf);
        size += buf.length;
      };
      child.stdout?.on('data', collect);
      child.stderr?.on('data', collect);

      const timer = setTimeout(() => {
        timedOut = true;
        killTree(child);
      }, ctx.settings.commandTimeoutMs);

      const onAbort = () => killTree(child);
      ctx.signal.addEventListener('abort', onAbort, { once: true });

      let graceTimer: NodeJS.Timeout | undefined;
      const finish = (code: number | null, error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (graceTimer) clearTimeout(graceTimer);
        ctx.signal.removeEventListener('abort', onAbort);
        child.stdout?.destroy();
        child.stderr?.destroy();
        const out = truncate(
          decodeCommandOutput(Buffer.concat(chunks)),
          ctx.settings.maxOutputChars,
        );
        if (error)
          return resolve({ isError: true, output: `failed to start command: ${error.message}` });
        if (ctx.signal.aborted)
          return resolve({ isError: true, output: `cancelled by user\n${out}`.trim() });
        if (timedOut)
          return resolve({
            isError: true,
            output: `timed out after ${ctx.settings.commandTimeoutMs} ms\n${out}`.trim(),
          });
        const status = `exit code ${code ?? 'unknown'}`;
        resolve({ isError: code !== 0, output: out ? `${status}\n${out}` : status });
      };
      child.on('error', (err) => finish(null, err));
      child.on('close', (code) => finish(code));
      // If orphaned grandchildren keep the pipes open, don't wait forever after the shell exited.
      child.on('exit', (code) => {
        graceTimer = setTimeout(() => finish(code), 500);
      });
    });
  },
};
