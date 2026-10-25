/**
 * System clipboard without native dependencies (specs/007 research R6, data-model.md § 7).
 * Tries the platform utilities in order and falls back to OSC 52 through the terminal.
 * This is the second documented exception to "the UI never writes escape sequences"
 * (the first is SGR mouse tracking in useMouseWheel).
 */
import { execFile } from 'node:child_process';

export type CopyMethod = 'clip' | 'powershell' | 'pbcopy' | 'wl-copy' | 'xclip' | 'xsel' | 'osc52';

export interface CopyResult {
  ok: boolean;
  method?: CopyMethod;
  error?: string;
}

export interface ClipboardCommand {
  method: Exclude<CopyMethod, 'osc52'>;
  file: string;
  args: string[];
  /** Encoding of the text written to the utility's stdin. */
  encoding: 'utf8' | 'utf16le';
}

/** Runs `file args` with `input` on stdin; rejects on any failure (missing binary included). */
export type ExecFn = (cmd: ClipboardCommand, input: Buffer, timeoutMs: number) => Promise<void>;

export const COPY_TIMEOUT_MS = 2000;

/** Candidate utilities per platform, in order of preference. */
export function clipboardCommands(platform: NodeJS.Platform): ClipboardCommand[] {
  switch (platform) {
    case 'win32':
      return [
        // clip.exe detects a UTF-16 BOM, which keeps accented text intact regardless of the code page.
        { method: 'clip', file: 'clip.exe', args: [], encoding: 'utf16le' },
        {
          method: 'powershell',
          file: 'powershell',
          args: [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            '[Console]::InputEncoding = [System.Text.Encoding]::UTF8; $input | Set-Clipboard',
          ],
          encoding: 'utf8',
        },
      ];
    case 'darwin':
      return [{ method: 'pbcopy', file: 'pbcopy', args: [], encoding: 'utf8' }];
    default:
      return [
        { method: 'wl-copy', file: 'wl-copy', args: [], encoding: 'utf8' },
        { method: 'xclip', file: 'xclip', args: ['-selection', 'clipboard'], encoding: 'utf8' },
        { method: 'xsel', file: 'xsel', args: ['--clipboard', '--input'], encoding: 'utf8' },
      ];
  }
}

export const defaultExec: ExecFn = (cmd, input, timeoutMs) =>
  new Promise((resolve, reject) => {
    const child = execFile(
      cmd.file,
      cmd.args,
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 },
      (err) => (err ? reject(err) : resolve()),
    );
    child.on('error', reject);
    child.stdin?.on('error', () => {
      /* EPIPE when the utility exits early: the exec callback reports the outcome */
    });
    child.stdin?.end(input);
  });

function encode(text: string, encoding: ClipboardCommand['encoding']): Buffer {
  if (encoding === 'utf16le')
    return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
  return Buffer.from(text, 'utf8');
}

/** OSC 52 sequence that asks the terminal to set its clipboard. */
export function osc52(text: string): string {
  return `\x1b]52;c;${Buffer.from(text, 'utf8').toString('base64')}\x07`;
}

export interface CopyOptions {
  platform?: NodeJS.Platform;
  stdout?: { write(s: string): unknown; isTTY?: boolean };
  exec?: ExecFn;
  timeoutMs?: number;
}

/** Copies `text`: platform utilities first, then OSC 52 when stdout is a TTY. */
export async function copyToClipboard(text: string, opts: CopyOptions = {}): Promise<CopyResult> {
  const platform = opts.platform ?? process.platform;
  const exec = opts.exec ?? defaultExec;
  const timeout = opts.timeoutMs ?? COPY_TIMEOUT_MS;
  let lastError: string | undefined;
  for (const cmd of clipboardCommands(platform)) {
    try {
      await exec(cmd, encode(text, cmd.encoding), timeout);
      return { ok: true, method: cmd.method };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  const out = opts.stdout;
  if (out?.isTTY) {
    out.write(osc52(text));
    return { ok: true, method: 'osc52' };
  }
  return { ok: false, error: lastError ?? 'no clipboard utility available' };
}
