import { describe, expect, it } from 'vitest';
import { executeSlash, parseSlash } from '../../../src/session/commands.js';
import { SessionController } from '../../../src/session/controller.js';
import { Session } from '../../../src/session/session.js';
import { makeCtx } from '../../helpers/context.js';
import { textProvider } from '../../helpers/fakeProvider.js';

function make() {
  const session = new Session({ cwd: '/w', activeProviderId: 'claude' });
  const fake = textProvider(['ok']);
  const ctl = new SessionController({
    session,
    ctx: makeCtx(),
    tools: [],
    system: 'sys',
    providerOverride: () => fake,
  });
  return { session, ctl, fake };
}

describe('parseSlash', () => {
  it('parses name and args, ignoring case and extra spaces', () => {
    expect(parseSlash('  /Model   qwen  qwen-max ')).toEqual({
      name: 'model',
      args: ['qwen', 'qwen-max'],
    });
    expect(parseSlash('/help')).toEqual({ name: 'help', args: [] });
    expect(parseSlash('hello /help')).toBeNull();
  });
});

describe('slash commands', () => {
  it('/help lists every command and the shortcuts', async () => {
    const { ctl } = make();
    expect(await executeSlash('/help', ctl)).toBe(true);
    const text = ctl.notices[0]?.text ?? '';
    for (const c of ['/help', '/clear', '/model', '/exit']) expect(text).toContain(c);
    expect(text).toMatch(/Esc/);
  });

  it('/clear empties the history when idle and is rejected while generating', async () => {
    const { ctl, session } = make();
    session.pushUser('x');
    await executeSlash('/clear', ctl);
    expect(session.history).toHaveLength(0);
    session.beginGeneration();
    await executeSlash('/clear', ctl);
    expect(ctl.notices.at(-1)?.level).toBe('warn');
    expect(ctl.notices.at(-1)?.text).toMatch(/in progress/);
  });

  it('/exit and /quit emit exit', async () => {
    const { ctl } = make();
    let exits = 0;
    ctl.on('exit', () => exits++);
    await executeSlash('/exit', ctl);
    await executeSlash('/quit', ctl);
    expect(exits).toBe(2);
  });

  it('unknown command produces a warning and never reaches the provider', async () => {
    const { ctl, fake } = make();
    expect(await executeSlash('/foo bar', ctl)).toBe(true);
    expect(ctl.notices[0]?.text).toBe('Unknown command: /foo. Type /help.');
    expect(fake.requests).toHaveLength(0);
  });

  it('non-slash input is not handled here', async () => {
    const { ctl } = make();
    expect(await executeSlash('hello', ctl)).toBe(false);
  });
});

describe('SessionController.submit', () => {
  it('runs a turn for plain text and ignores empty input', async () => {
    const { ctl, session, fake } = make();
    expect(await ctl.submit('   ')).toBeUndefined();
    expect(fake.requests).toHaveLength(0);
    const r = await ctl.submit('hello');
    expect(r?.stopReason).toBe('end_turn');
    expect(session.history).toHaveLength(2);
    expect(ctl.partialText).toBe('');
  });

  it('routes slash commands instead of calling the provider', async () => {
    const { ctl, fake } = make();
    await ctl.submit('/help');
    expect(fake.requests).toHaveLength(0);
  });
});
