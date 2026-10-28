import { describe, expect, it } from 'vitest';
import { SessionController } from '../../../src/session/controller.js';
import { Session } from '../../../src/session/session.js';
import type { AskUserRequest } from '../../../src/tools/types.js';
import { makeCtx } from '../../helpers/context.js';
import { textProvider } from '../../helpers/fakeProvider.js';

function make() {
  const session = new Session({ cwd: '/w', activeProviderId: 'claude' });
  const provider = textProvider(['ok']);
  const ctl = new SessionController({
    session,
    ctx: makeCtx(),
    tools: [],
    system: 's',
    providerOverride: () => provider,
  });
  return { ctl, session };
}

const request: AskUserRequest = {
  questions: [
    {
      question: 'Qual banco?',
      header: 'Banco',
      options: [
        { label: 'Postgres', description: 'relacional' },
        { label: 'SQLite', description: 'arquivo' },
      ],
      multiSelect: false,
    },
  ],
};

/** Autopilot questions on screen with a deadline (specs/011). */
describe('SessionController.askUntil', () => {
  it('shows the dialog with a deadline and returns the user answer; the state comes back', async () => {
    const { ctl, session } = make();
    const p = ctl.askUntil(request, 60_000, new AbortController().signal);
    expect(session.state).toBe('awaiting_answer');
    expect(session.pendingQuestion?.deadline).toBeGreaterThan(ctl.clock());
    ctl.dispatchQuestion({ type: 'digit', n: 2 });
    await expect(p).resolves.toEqual({
      answered: true,
      answers: [{ kind: 'options', labels: ['SQLite'] }],
    });
    expect(session.state).toBe('idle');
    expect(session.pendingQuestion).toBeUndefined();
    expect(ctl.questionFlow).toBeUndefined();
  });

  it('times out without an answer and closes the dialog', async () => {
    const { ctl, session } = make();
    session.beginGeneration();
    await expect(ctl.askUntil(request, 10, new AbortController().signal)).resolves.toBe('timeout');
    expect(session.state).toBe('generating');
    expect(session.pendingQuestion).toBeUndefined();
  });

  it('an aborted run closes the dialog as not answered', async () => {
    const { ctl, session } = make();
    const ac = new AbortController();
    const p = ctl.askUntil(request, 60_000, ac.signal);
    ac.abort();
    await expect(p).resolves.toEqual({ answered: false });
    expect(session.state).toBe('idle');
    await expect(ctl.askUntil(request, 60_000, ac.signal)).resolves.toEqual({ answered: false });
  });
});
