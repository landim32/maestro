import { describe, expect, it, vi } from 'vitest';
import { CommandBlocked, executeSlash, parseSlash } from '../../../src/session/commands.js';
import { SessionController } from '../../../src/session/controller.js';
import { Session } from '../../../src/session/session.js';
import { makeCtx, makeSettings } from '../../helpers/context.js';
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
      rest: 'qwen  qwen-max',
    });
    expect(parseSlash('/help')).toEqual({ name: 'help', args: [], rest: '' });
    // the raw text after the name keeps its inner spacing (Spec Kit descriptions)
    expect(parseSlash('/speckit.specify Quero  um   comando')!.rest).toBe('Quero  um   comando');
    expect(parseSlash('hello /help')).toBeNull();
  });
});

describe('slash commands', () => {
  it('/help lists every command and the shortcuts', async () => {
    const { ctl } = make();
    expect((await executeSlash('/help', ctl)).handled).toBe(true);
    const text = ctl.notices[0]?.text ?? '';
    for (const c of ['/help', '/clear', '/model', '/exit']) expect(text).toContain(c);
    expect(text).toMatch(/Esc/);
  });

  /** specs/005 contracts/approval-modes.md § 7 */
  it('/approval-mode lists, changes and rejects modes; /help mentions Tab and the modes', async () => {
    const { ctl } = make();
    await executeSlash('/help', ctl);
    const help = ctl.notices.at(-1)?.text ?? '';
    expect(help).toContain('/approval-mode');
    expect(help).toContain('Shift+Tab');
    expect(help).toContain('accept the highlighted command suggestion');
    expect(help).toContain('ask_user');
    for (const m of ['default', 'auto-edit', 'auto', 'yolo']) expect(help).toContain(m);

    await executeSlash('/approval-mode', ctl);
    expect(ctl.notices.at(-1)?.text).toContain('Modo de aprovação: Pedir permissão (default)');
    expect(ctl.notices.at(-1)?.text).toContain('● default');

    await executeSlash('/approval-mode AUTO', ctl);
    expect(ctl.approvalMode).toBe('auto');
    expect(ctl.transient?.text).toBe('modo: Automático');
    expect(ctl.notices.at(-1)?.text).toBe('Modo de aprovação: Automático (auto).');

    await executeSlash('/approval foo', ctl);
    expect(ctl.notices.at(-1)?.level).toBe('warn');
    expect(ctl.notices.at(-1)?.text).toBe(
      "Modo desconhecido 'foo'. Opções: default, auto-edit, auto, yolo.",
    );
    expect(ctl.approvalMode).toBe('auto');
  });

  it('cycleApprovalMode walks the cycle, emits change and a transient; applySettings keeps the session mode', () => {
    const { ctl } = make();
    const spy = vi.fn();
    ctl.on('change', spy);
    expect(ctl.cycleApprovalMode(1)).toBe('auto-edit');
    expect(ctl.cycleApprovalMode(-1)).toBe('default');
    expect(ctl.cycleApprovalMode(-1)).toBe('yolo');
    expect(spy).toHaveBeenCalledTimes(3);
    expect(ctl.transient).toEqual({ text: 'modo: YOLO', seq: 3 });
    ctl.applySettings({
      settings: makeSettings({ tools: { approvalMode: 'auto' } }),
      credentialSources: { claude: 'env', qwen: 'none' },
    });
    expect(ctl.approvalMode).toBe('yolo');
    expect(ctl.settings.tools.approvalMode).toBe('auto');
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
    expect(await executeSlash('/foo bar', ctl)).toEqual({ handled: true, blocked: true });
    expect(ctl.notices[0]?.text).toBe('Unknown command: /foo. Type /help.');
    expect(fake.requests).toHaveLength(0);
  });

  /** specs/006 contracts/speckit-commands.md § 1–2 — prompt commands and the /help section */
  it('a prompt command returns a turn; blocked commands warn; /help groups Spec Kit commands by origin', async () => {
    const { ctl, fake } = make();
    ctl.commands.push(
      {
        name: 'speckit.demo',
        description: 'Demo prompt',
        origin: 'project',
        run: (_c, _args, rest) => ({
          display: `/speckit.demo ${rest}`.trim(),
          prompt: `PROMPT ${rest}`,
        }),
      },
      {
        name: 'speckit.blocked',
        description: 'Needs a plan',
        origin: 'claude',
        run: () => {
          throw new CommandBlocked('ERROR: plan.md not found');
        },
      },
    );
    const outcome = await executeSlash('/speckit.demo faça algo  bem feito', ctl);
    expect(outcome).toEqual({
      handled: true,
      turn: {
        display: '/speckit.demo faça algo  bem feito',
        prompt: 'PROMPT faça algo  bem feito',
      },
    });
    expect(fake.requests).toHaveLength(0);

    expect(await executeSlash('/speckit.blocked', ctl)).toEqual({ handled: true, blocked: true });
    expect(ctl.notices.at(-1)).toMatchObject({ level: 'warn', text: 'ERROR: plan.md not found' });

    await executeSlash('/help', ctl);
    const help = ctl.notices.at(-1)?.text ?? '';
    expect(help).toContain('Spec Kit (comandos do projeto):');
    expect(help).toMatch(/\/speckit\.demo\s+Demo prompt \(project\)/);
    expect(help).toMatch(/\/speckit\.blocked\s+Needs a plan \(claude\)/);

    // submit() runs the turn with the composed prompt but keeps the typed line as display
    const r = await ctl.submit('/speckit.demo olá');
    expect(r?.stopReason).toBe('end_turn');
    const sent = fake.requests[0]?.messages[0];
    expect(sent?.display).toBe('/speckit.demo olá');
    expect(sent?.content[0]).toEqual({ type: 'text', text: 'PROMPT olá' });
  });

  it('non-slash input is not handled here', async () => {
    const { ctl } = make();
    expect((await executeSlash('hello', ctl)).handled).toBe(false);
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
