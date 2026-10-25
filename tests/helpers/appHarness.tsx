import { App } from '../../src/ui/App.js';
import { SessionController } from '../../src/session/controller.js';
import type { ControllerOptions } from '../../src/session/controller.js';
import { Session } from '../../src/session/session.js';
import type { ModelProvider, ProviderEvent, ProviderId } from '../../src/providers/types.js';
import type { SettingsInput } from '../../src/config/schema.js';
import type { CopyResult } from '../../src/utils/clipboard.js';
import { makeCtx } from './context.js';
import { createFakeProvider, textProvider } from './fakeProvider.js';
import type { FakeProvider } from './fakeProvider.js';
import { renderSized } from './renderSized.js';
import type { RenderSizedOptions } from './renderSized.js';

export interface HarnessOptions extends RenderSizedOptions {
  provider?: FakeProvider;
  /** Scripted provider events per request (shortcut for `provider: createFakeProvider(events)`). */
  events?: ProviderEvent[][];
  /** Provider per id (for /model switching tests). */
  providers?: Partial<Record<ProviderId, ModelProvider>>;
  ui?: { altScreen: boolean; mouse: boolean; color?: boolean };
  env?: NodeJS.ProcessEnv;
  settings?: SettingsInput;
  credentials?: Parameters<typeof makeCtx>[1];
  controller?: Partial<ControllerOptions>;
  /** Injected clipboard for mouse-selection tests (specs/007). */
  copy?: (text: string) => Promise<CopyResult>;
  /** Working directory of the session (file attachments resolve against it). */
  cwd?: string;
}

/** Renders the real App with fake providers in a sized fake terminal. */
export function mountApp(opts: HarnessOptions = {}) {
  const provider =
    opts.provider ??
    (opts.events
      ? createFakeProvider(opts.events)
      : textProvider(['Hello from fake', 'Second answer']));
  const session = new Session({ cwd: opts.cwd ?? 'C:\\work\\demo', activeProviderId: 'claude' });
  const ctx = makeCtx(opts.settings ?? {}, { ...opts.credentials, env: opts.env ?? {} });
  const controller = new SessionController({
    session,
    ctx,
    tools: [],
    system: 'sys',
    env: opts.env ?? {},
    providerOverride: (id) => opts.providers?.[id] ?? provider,
    ...opts.controller,
  });
  let exited = 0;
  controller.on('exit', () => exited++);
  const ui = renderSized(
    (frame) => (
      <App
        controller={controller}
        onExit={() => controller.requestExit()}
        ui={opts.ui ?? { altScreen: true, mouse: true }}
        env={opts.env ?? {}}
        copy={opts.copy}
        frame={frame}
      />
    ),
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

/** One provider turn that calls a tool (the loop then sends the result back). */
export const toolCall = (callId: string, name: string, input: unknown): ProviderEvent[] => [
  { type: 'tool_call', callId, name, input },
  { type: 'done', stopReason: 'tool_use' },
];
/** One provider turn that answers with text. */
export const answer = (text: string): ProviderEvent[] => [
  { type: 'text_delta', text },
  { type: 'done', stopReason: 'end_turn' },
];

export const KEYS = {
  tab: '\t',
  shiftTab: '\x1b[Z',
  space: ' ',
  digit: (n: number) => String(n),
  pageUp: '\x1b[5~',
  pageDown: '\x1b[6~',
  home: '\x1b[H',
  end: '\x1b[F',
  shiftUp: '\x1b[1;2A',
  shiftDown: '\x1b[1;2B',
  up: '\x1b[A',
  down: '\x1b[B',
  enter: '\r',
  esc: '\x1b',
  ctrlU: '\x15',
  right: '\x1b[C',
  left: '\x1b[D',
  wheelUp: '\x1b[<64;1;1M',
  wheelDown: '\x1b[<65;1;1M',
  ctrlO: '\x0f',
  backspace: '\x7f',
  /** Bracketed paste (Ink's usePaste delivers it in one piece). */
  paste: (text: string) => `\x1b[200~${text}\x1b[201~`,
  /** SGR mouse report: button 0 press/release, 32 drag, 64/65 wheel; x/y are 1-based cells. */
  mouse: (button: number, x: number, y: number, release = false) =>
    `\x1b[<${button};${x};${y}${release ? 'm' : 'M'}`,
};
