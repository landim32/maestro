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
      credentialSources: { claude: 'env', qwen: 'none', 'claude-code': 'none', codex: 'none' },
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
      command: { name: 'speckit.demo', kind: undefined },
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

  it('a PromptSubmission records display, sends the expanded text and keeps image parts (specs/007)', async () => {
    const { ctl, session, fake } = make();
    const { InputHistory } = await import('../../../src/session/history.js');
    const history = new InputHistory();
    (ctl as unknown as { history: typeof history }).history = history;
    const imageProvider = { ...fake, capabilities: { images: true } };
    (ctl as unknown as { providerOverride: () => typeof imageProvider }).providerOverride = () =>
      imageProvider;
    await ctl.submit({
      display: 'veja [Pasted text #1 +4 lines] [Imagem: x.png, 5 B]',
      text: 'veja <pasted-text id="1" lines="4">\na\nb\nc\nd\n</pasted-text> [Imagem: x.png]',
      parts: [{ type: 'image', mediaType: 'image/png', data: 'QUJD', name: 'x.png' }],
      warnings: ['aviso de teste'],
    });
    expect(history.entries).toEqual(['veja [Pasted text #1 +4 lines] [Imagem: x.png, 5 B]']);
    const user = session.history[0]!;
    expect(user.display).toBe('veja [Pasted text #1 +4 lines] [Imagem: x.png, 5 B]');
    expect(user.content[0]).toEqual({
      type: 'text',
      text: 'veja <pasted-text id="1" lines="4">\na\nb\nc\nd\n</pasted-text> [Imagem: x.png]',
    });
    expect(user.content[1]).toMatchObject({ type: 'image', mediaType: 'image/png', data: 'QUJD' });
    expect(fake.requests[0]!.messages[0]!.content).toHaveLength(2);
    expect(ctl.notices.some((n) => n.level === 'warn' && n.text === 'aviso de teste')).toBe(true);
  });

  it('image parts are dropped with a warning when the active provider has no image capability', async () => {
    const { ctl, session } = make();
    await ctl.submit({
      display: '[Imagem: x.png, 5 B]',
      text: '[Imagem: x.png]',
      parts: [{ type: 'image', mediaType: 'image/png', data: 'QUJD', name: 'x.png' }],
      warnings: [],
    });
    expect(session.history[0]!.content).toHaveLength(1);
    expect(ctl.notices.some((n) => /não aceita imagens/.test(n.text))).toBe(true);
  });

  it('a marker counts as the argument of a slash command (contracts/paste-chips.md § 3)', async () => {
    const { ctl, fake } = make();
    await ctl.submit({
      display: '/approval-mode [Pasted text #1 +4 lines]',
      text: '/approval-mode <pasted-text id="1" lines="4">\nyolo\n</pasted-text>',
      parts: [],
      warnings: [],
    });
    expect(fake.requests).toHaveLength(0);
    expect(ctl.notices.some((n) => /Modo desconhecido/.test(n.text))).toBe(true);
  });

  it('/ask sends through a known route; without route/request it warns with the list (specs/008 § 6)', async () => {
    const { ctl, fake } = make();
    const r = await executeSlash('/ask github resuma o PR #6', ctl);
    expect(r.turn).toEqual({
      display: '/ask github resuma o PR #6',
      prompt: 'resuma o PR #6',
      route: 'github',
    });
    expect(r.command).toEqual({ name: 'ask', kind: 'route' });
    expect(ctl.routeEntries().some((e) => e.name === 'ask')).toBe(false); // /ask has no route of its own
    for (const bad of ['/ask', '/ask nada x', '/ask github']) {
      const before = ctl.notices.length;
      const o = await executeSlash(bad, ctl);
      expect(o.turn).toBeUndefined();
      expect(ctl.notices[before]?.text).toMatch(
        /^Uso: \/ask <rota> <pedido>\. Rotas: chat, github, infra/,
      );
    }
    expect(fake.requests).toHaveLength(0);
  });

  it('purpose routes get /<route> shortcuts unless a command has that name; /help lists them', async () => {
    const session = new Session({ cwd: '/w', activeProviderId: 'claude' });
    const fake = textProvider(['ok']);
    const ctl = new SessionController({
      session,
      ctx: makeCtx({
        routes: {
          review: { provider: 'claude', model: 'claude-sonnet-5-5' },
          help: { provider: 'claude', model: 'claude-sonnet-5-5' },
        },
      }),
      tools: [],
      system: 'sys',
      providerOverride: () => fake,
    });
    const names = ctl.commands.map((c) => c.name);
    expect(names).toContain('github');
    expect(names).toContain('infra');
    expect(names).toContain('review');
    expect(names.filter((n) => n === 'help')).toHaveLength(1); // the command wins
    const r = await executeSlash('/review este trecho', ctl);
    expect(r.turn).toEqual({
      display: '/review este trecho',
      prompt: 'este trecho',
      route: 'review',
    });
    expect((await executeSlash('/infra', ctl)).turn).toBeUndefined();
    expect(ctl.notices.at(-1)?.text).toMatch(/Uso: \/infra <pedido>/);
    await executeSlash('/help', ctl);
    const help = ctl.notices.at(-1)?.text ?? '';
    expect(help).toContain('/routes');
    expect(help).toContain('/ask <rota> <pedido>');
    expect(help).toContain('/review <pedido>');
    expect(help).toContain('(atalho da rota review)');
    expect(ctl.routeEntries().find((e) => e.name === 'help')).toMatchObject({
      missingCommand: true,
    });
  });

  it('/routes prints the table in -p and opens the dialog interactively', async () => {
    const { ctl } = make();
    await ctl.submit('/routes');
    expect(ctl.dialog?.type).toBe('routes');
    ctl.closeDialog();
    const p = new SessionController({
      session: new Session({ cwd: '/w', activeProviderId: 'claude' }),
      ctx: makeCtx(),
      tools: [],
      system: 'sys',
      interactive: false,
      providerOverride: () => textProvider(['ok']),
    });
    await p.submit('/routes');
    expect(p.dialog).toBeUndefined();
    expect(p.notices.at(-1)?.text).toMatch(
      /Rotas por modelo:\n\s+chat\s+claude \/ claude-opus-5-5\s+padrão \(segue o ativo\)/,
    );
  });

  it('/mouse toggles and sets the session mouse state; -p only reports (contracts/mouse-selection.md § 5)', async () => {
    const { ctl } = make();
    expect(ctl.mouseEnabled).toBe(true);
    await ctl.submit('/mouse');
    expect(ctl.mouseEnabled).toBe(false);
    expect(ctl.transient?.text).toBe('mouse off');
    await ctl.submit('/mouse');
    expect(ctl.mouseEnabled).toBe(true);
    await ctl.submit('/mouse off');
    expect(ctl.mouseEnabled).toBe(false);
    await ctl.submit('/mouse on');
    expect(ctl.mouseEnabled).toBe(true);
    await ctl.submit('/mouse maybe');
    expect(ctl.notices.at(-1)?.level).toBe('warn');
    const p = new SessionController({
      session: new Session({ cwd: '/w', activeProviderId: 'claude' }),
      ctx: makeCtx(),
      tools: [],
      system: 'sys',
      interactive: false,
      providerOverride: () => textProvider(['ok']),
    });
    await p.submit('/mouse off');
    expect(p.mouseEnabled).toBe(true);
    expect(p.notices.at(-1)?.text).toMatch(/-p/);
  });
});
