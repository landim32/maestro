import { App } from '../../src/ui/App.js';
import { SessionController } from '../../src/session/controller.js';
import { Session } from '../../src/session/session.js';
import type { ModelProvider, ProviderEvent } from '../../src/providers/types.js';
import { makeCtx } from './context.js';
import { createFakeProvider, textProvider } from './fakeProvider.js';
import { renderSized } from './renderSized.js';
import type { RenderSizedOptions } from './renderSized.js';

export interface HarnessOptions extends RenderSizedOptions {
  provider?: ModelProvider;
  ui?: { altScreen: boolean; mouse: boolean; color?: boolean };
  env?: NodeJS.ProcessEnv;
}

/** Renders the real App with a fake provider in a sized fake terminal. */
export function mountApp(opts: HarnessOptions = {}) {
  const provider = opts.provider ?? textProvider(['Hello from fake', 'Second answer']);
  const session = new Session({ cwd: 'C:\\work\\demo', activeProviderId: 'claude' });
  const controller = new SessionController({
    session,
    ctx: makeCtx(),
    tools: [],
    system: 'sys',
    providerOverride: () => provider,
  });
  let exited = 0;
  controller.on('exit', () => exited++);
  const ui = renderSized(
    <App
      controller={controller}
      onExit={() => controller.requestExit()}
      ui={opts.ui ?? { altScreen: true, mouse: true }}
      env={opts.env ?? {}}
    />,
    opts,
  );
  return { ...ui, controller, session, provider, exits: () => exited };
}

/** Provider that answers with `n` numbered lines `L0001 … L000n`, optionally streamed slowly. */
export function linesProvider(n: number, opts: { delayMs?: number; perDelta?: number } = {}) {
  const lines = Array.from({ length: n }, (_, i) => `L${String(i + 1).padStart(4, '0')} content`);
  const perDelta = opts.perDelta ?? n;
  const events: ProviderEvent[] = [];
  for (let i = 0; i < lines.length; i += perDelta) {
    events.push({
      type: 'text_delta',
      text: lines.slice(i, i + perDelta).join('\n') + (i + perDelta < n ? '\n' : ''),
    });
  }
  events.push({ type: 'done', stopReason: 'end_turn' });
  return createFakeProvider(() => events, { delayMs: opts.delayMs });
}

export const KEYS = {
  pageUp: '\x1b[5~',
  pageDown: '\x1b[6~',
  home: '\x1b[H',
  end: '\x1b[F',
  shiftUp: '\x1b[1;2A',
  shiftDown: '\x1b[1;2B',
  enter: '\r',
  wheelUp: '\x1b[<64;1;1M',
  wheelDown: '\x1b[<65;1;1M',
};
