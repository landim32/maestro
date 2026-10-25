import { createElement } from 'react';
import { render } from 'ink';
import type { Settings } from '../config/schema.js';
import type { SessionController } from '../session/controller.js';
import { isInteractive } from '../utils/tty.js';
import { App } from '../ui/App.js';
import { FrameRecorder } from '../ui/frameRecorder.js';
import { computeCapabilities } from '../ui/hooks/useTerminalCapabilities.js';
import { EXIT } from './exitCodes.js';

export interface InteractiveOptions {
  controller: SessionController;
  settings: Settings;
  /** CLI flags that affect the UI. */
  flags?: { altScreen?: boolean; color?: boolean };
  env?: NodeJS.ProcessEnv;
  stdout?: NodeJS.WriteStream;
  stdin?: NodeJS.ReadStream;
}

/** Renders the Ink UI and resolves with the process exit code when the user leaves. */
export async function runInteractive({
  controller,
  settings,
  flags,
  env,
  stdout,
  stdin,
}: InteractiveOptions): Promise<number> {
  const out = stdout ?? process.stdout;
  if (!isInteractive({ stdout: out, stdin: stdin ?? process.stdin })) {
    process.stderr.write(
      'maestro: interactive mode needs a terminal. Use -p "<prompt>" for non-interactive use.\n',
    );
    return EXIT.USAGE;
  }

  const caps = computeCapabilities({
    columns: out.columns,
    rows: out.rows,
    isTTY: Boolean(out.isTTY),
    ui: settings.ui,
    flags,
    env: env ?? process.env,
  });

  // The recorder passes every write through and keeps the last frame for mouse selection (specs/007).
  const frame = new FrameRecorder(out);
  const instance = render(
    createElement(App, {
      controller,
      onExit: () => controller.requestExit(),
      ui: settings.ui,
      flags,
      env: env ?? process.env,
      frame,
    }),
    {
      exitOnCtrlC: false,
      patchConsole: true,
      alternateScreen: caps.altScreen,
      stdout: frame.stream,
      ...(stdin ? { stdin } : {}),
    },
  );
  const exit = () => instance.unmount();
  controller.on('exit', exit);

  // Restore the terminal (leave the alternate screen, disable mouse tracking) on hard exits too.
  const onSignal = () => {
    controller.requestExit();
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  try {
    await instance.waitUntilExit();
  } finally {
    controller.off('exit', exit);
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
  return EXIT.OK;
}
