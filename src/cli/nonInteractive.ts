import type { SessionController } from '../session/controller.js';
import { EXIT } from './exitCodes.js';

export interface NonInteractiveOptions {
  controller: SessionController;
  /** Prompt text, or "-" to read it from stdin. */
  prompt: string;
  stdin?: NodeJS.ReadableStream;
  stdout?: { write(s: string): unknown };
  stderr?: { write(s: string): unknown };
  /** Test seam: register the SIGINT handler (default true). */
  handleSignals?: boolean;
  /** `--route`: forced route for this request (specs/008 contracts/route-resolution.md § 5). */
  route?: string;
}

async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream)
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Runs one turn and exits (contracts/cli.md § 3): answer → stdout, progress/errors → stderr.
 * Actions the approval mode (--approval-mode / --yolo / tools.approvalMode) would ask about are
 * declined because nobody can answer; the rest run and are announced on stderr
 * (specs/005 contracts/approval-modes.md § 6).
 */
export async function runNonInteractive(opts: NonInteractiveOptions): Promise<number> {
  const stdout = opts.stdout ?? process.stdout;
  const stderr = opts.stderr ?? process.stderr;
  const { controller } = opts;

  let prompt = opts.prompt;
  if (prompt === '-') prompt = (await readAll(opts.stdin ?? process.stdin)).trim();
  if (prompt.trim() === '') {
    stderr.write('maestro: empty prompt\n');
    return EXIT.USAGE;
  }

  // Forward notices (tool progress, warnings, errors) to stderr as they appear.
  let seen = 0;
  const flush = () => {
    for (; seen < controller.notices.length; seen++) {
      const n = controller.notices[seen]!;
      stderr.write(`${n.level === 'info' ? '' : `[${n.level}] `}${n.text}\n`);
    }
  };
  controller.on('change', flush);

  let interrupted = false;
  const onSigint = () => {
    interrupted = true;
    controller.cancel();
  };
  if (opts.handleSignals ?? true) process.once('SIGINT', onSigint);

  let wroteSomething = false;
  let lastChar = '\n';
  try {
    const result = await controller.submit(prompt, {
      route: opts.route,
      onDelta: (t) => {
        if (t === '') return;
        stdout.write(t);
        wroteSomething = true;
        lastChar = t.at(-1) ?? lastChar;
      },
    });
    flush();
    if (wroteSomething && lastChar !== '\n') stdout.write('\n');

    // slash command or ignored input; a blocked command (e.g. Spec Kit prerequisites) is a usage error
    if (!result) return controller.lastCommandBlocked ? EXIT.USAGE : EXIT.OK;
    if (result.stopReason === 'cancelled' || interrupted) return EXIT.INTERRUPTED;
    if (result.stopReason === 'error') return EXIT.PROVIDER_ERROR;
    return EXIT.OK;
  } finally {
    controller.off('change', flush);
    if (opts.handleSignals ?? true) process.off('SIGINT', onSigint);
  }
}

export interface AutopilotNonInteractiveOptions {
  controller: SessionController;
  file?: string;
  resume?: boolean;
  /** --continue: `file` is the (optional) feature started outside the autopilot. */
  continue?: boolean;
  stdout?: { write(s: string): unknown };
  stderr?: { write(s: string): unknown };
  handleSignals?: boolean;
}

/**
 * `maestro -p --autopilot <file> [--resume]` (specs/011 contracts/autopilot-cli.md § 2): progress
 * and the turns' notices on stderr, the final report on stdout; exit 0 / 1 / 2.
 */
export async function runAutopilotNonInteractive(
  opts: AutopilotNonInteractiveOptions,
): Promise<number> {
  const stdout = opts.stdout ?? process.stdout;
  const stderr = opts.stderr ?? process.stderr;
  const { controller } = opts;
  let seen = controller.notices.length;
  const flush = () => {
    for (; seen < controller.notices.length; seen++) {
      const n = controller.notices[seen]!;
      stderr.write(`${n.level === 'info' ? '' : `[${n.level}] `}${n.text}\n`);
    }
  };
  controller.on('change', flush);
  const driver = controller.createAutopilot((line) => {
    flush();
    stderr.write(`${line}\n`);
  });
  const onSigint = () => driver.cancel();
  if (opts.handleSignals ?? true) process.once('SIGINT', onSigint);
  try {
    const result = await driver.start(opts.file, {
      resume: opts.resume,
      continue: opts.continue,
    });
    flush();
    if (result.code === 2) {
      stderr.write(`maestro: ${result.report}\n`);
      return EXIT.USAGE;
    }
    stdout.write(`${result.report}\n`);
    return result.code === 0 ? EXIT.OK : EXIT.PROVIDER_ERROR; // 1: a story stopped or the run was interrupted
  } finally {
    controller.off('change', flush);
    process.off('SIGINT', onSigint);
  }
}
