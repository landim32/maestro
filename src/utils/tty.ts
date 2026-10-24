interface StreamLike {
  isTTY?: boolean;
}

export interface TtyOptions {
  noColorFlag?: boolean;
  env?: NodeJS.ProcessEnv;
  stdout?: StreamLike;
  stdin?: StreamLike;
}

/** True when both stdin and stdout are terminals (interactive mode is possible). */
export function isInteractive(opts: TtyOptions = {}): boolean {
  const stdout = opts.stdout ?? process.stdout;
  const stdin = opts.stdin ?? process.stdin;
  return Boolean(stdout.isTTY && stdin.isTTY);
}

/** Resolves whether ANSI colors should be emitted (NO_COLOR, --no-color, non-TTY). */
export function colorEnabled(opts: TtyOptions = {}): boolean {
  const env = opts.env ?? process.env;
  const stdout = opts.stdout ?? process.stdout;
  if (opts.noColorFlag) return false;
  if (env['NO_COLOR'] !== undefined && env['NO_COLOR'] !== '') return false;
  if (env['FORCE_COLOR'] !== undefined && env['FORCE_COLOR'] !== '0' && env['FORCE_COLOR'] !== '') {
    return true;
  }
  return Boolean(stdout.isTTY);
}
