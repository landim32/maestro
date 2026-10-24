import type {
  ModelProvider,
  ProviderEvent,
  ProviderId,
  ProviderRequest,
  ProviderStatus,
} from '../../src/providers/types.js';

export type FakeScript =
  ProviderEvent[][] | ((req: ProviderRequest, callIndex: number) => ProviderEvent[]);

export interface FakeProviderOptions {
  id?: ProviderId;
  /** Delay between events (ms) — lets tests abort mid-stream. */
  delayMs?: number;
  configured?: boolean;
  model?: string;
}

export interface FakeProvider extends ModelProvider {
  requests: ProviderRequest[];
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      signal.removeEventListener('abort', done);
      clearTimeout(t);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}

/** Scripted provider for tests: emits a predefined event list per call and honours `signal`. */
export function createFakeProvider(
  script: FakeScript,
  opts: FakeProviderOptions = {},
): FakeProvider {
  const id = opts.id ?? 'claude';
  const requests: ProviderRequest[] = [];
  let calls = 0;

  const provider: FakeProvider = {
    id,
    displayName: `Fake ${id}`,
    requests,
    status(): ProviderStatus {
      return {
        id,
        displayName: `Fake ${id}`,
        enabled: true,
        configured: opts.configured ?? true,
        active: true,
        model: opts.model ?? 'fake-model',
        credentialSource: 'env',
        missing: opts.configured === false ? ['credentials'] : [],
      };
    },
    async *stream(req: ProviderRequest): AsyncIterable<ProviderEvent> {
      requests.push(req);
      const index = calls++;
      const events = typeof script === 'function' ? script(req, index) : (script[index] ?? []);
      for (const ev of events) {
        if (opts.delayMs) await sleep(opts.delayMs, req.signal);
        if (req.signal.aborted) {
          yield { type: 'done', stopReason: 'cancelled' };
          return;
        }
        yield ev;
        if (ev.type === 'done' || ev.type === 'error') return;
      }
    },
  };
  return provider;
}

/** Convenience: a provider that answers each call with the given text. */
export function textProvider(texts: string[], opts: FakeProviderOptions = {}): FakeProvider {
  return createFakeProvider(
    texts.map((t) => [
      { type: 'text_delta', text: t },
      { type: 'usage', inputTokens: 10, outputTokens: 5 },
      { type: 'done', stopReason: 'end_turn' },
    ]),
    opts,
  );
}
