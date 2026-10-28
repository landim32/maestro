/** specs/011 — settings section, controller overrides, CLI arguments, status bar. */
import { afterEach, describe, expect, it } from 'vitest';
import { settingsSchema, formatZodIssues } from '../../../src/config/schema.js';
import { parseArgs, UsageError } from '../../../src/cli/args.js';
import { SessionController } from '../../../src/session/controller.js';
import { Session } from '../../../src/session/session.js';
import { StatusBar } from '../../../src/ui/components/StatusBar.js';
import { makeCtx } from '../../helpers/context.js';
import { textProvider } from '../../helpers/fakeProvider.js';
import { cleanupSized, renderSized, waitFor } from '../../helpers/renderSized.js';

afterEach(() => cleanupSized());

describe('settings.autopilot (data-model § 2)', () => {
  it('defaults; merge requires push; limits validated', () => {
    const s = settingsSchema.parse({});
    expect(s.autopilot).toEqual({
      verify: { maxAttempts: 3, timeoutMs: 600000 },
      limits: { turns: 0, minutes: 0, tokens: 0 },
      questionTimeoutSeconds: 300,
      commitPrefix: 'fix:',
      push: false,
      merge: false,
    });
    const bad = settingsSchema.safeParse({ autopilot: { merge: true } });
    expect(bad.success).toBe(false);
    if (!bad.success)
      expect(formatZodIssues(bad.error)).toEqual(['autopilot.merge: merge exige push: true']);
    expect(settingsSchema.safeParse({ autopilot: { merge: true, push: true } }).success).toBe(true);
    expect(settingsSchema.safeParse({ autopilot: { limits: { turns: 3 } } }).success).toBe(false);
    expect(settingsSchema.safeParse({ autopilot: { limits: { turns: 7 } } }).success).toBe(true);
    expect(settingsSchema.safeParse({ autopilot: { questionTimeoutSeconds: -1 } }).success).toBe(
      false,
    );
    expect(settingsSchema.safeParse({ autopilot: { limits: { minutes: -1 } } }).success).toBe(
      false,
    );
    expect(settingsSchema.safeParse({ autopilot: { verify: { maxAttempts: 11 } } }).success).toBe(
      false,
    );
    expect(settingsSchema.safeParse({ autopilot: { commitPrefix: 'chore:' } }).success).toBe(false);
  });
});

describe('controller.runOverrides (research R3)', () => {
  it('replaces ask/confirm and the approval mode for one run, and restores them', () => {
    const ctl = new SessionController({
      session: new Session({ cwd: '/w', activeProviderId: 'claude' }),
      ctx: makeCtx({ tools: { approvalMode: 'auto-edit' } }),
      tools: [],
      system: 's',
      providerOverride: () => textProvider(['ok']),
    });
    const restore = ctl.runOverrides({ approvalMode: 'auto', confirm: async () => false });
    expect(ctl.approvalMode).toBe('auto');
    restore();
    expect(ctl.approvalMode).toBe('auto-edit');
    ctl.cycleApprovalMode(1);
    restore(); // second call is a no-op
    expect(ctl.approvalMode).not.toBe('auto-edit');
  });
  it('autopilot turns are not recorded in the input history', async () => {
    const entries: string[] = [];
    const ctl = new SessionController({
      session: new Session({ cwd: '/w', activeProviderId: 'claude' }),
      ctx: makeCtx(),
      tools: [],
      system: 's',
      providerOverride: () => textProvider(['a', 'b']),
      history: { entries, push: (t: string) => entries.push(t) } as never,
    });
    await ctl.submit('normal');
    await ctl.submit('do autopiloto', { record: false });
    expect(entries).toEqual(['normal']);
  });
});

describe('CLI --autopilot (contracts/autopilot-cli.md § 2)', () => {
  it('parses --autopilot and --resume, alone or after an empty -p', async () => {
    expect(await parseArgs(['--autopilot', 'h.md'])).toMatchObject({
      autopilot: 'h.md',
      prompt: undefined,
    });
    expect(await parseArgs(['-p', '--autopilot', 'h.md', '--resume'])).toMatchObject({
      autopilot: 'h.md',
      resume: true,
    });
    expect(await parseArgs(['--autopilot', '--resume'])).toMatchObject({
      autopilot: '',
      resume: true,
    });
  });
  it('refuses the forbidden combinations (usage error)', async () => {
    await expect(parseArgs(['--resume'])).rejects.toBeInstanceOf(UsageError);
    await expect(parseArgs(['-p', 'faça algo', '--autopilot', 'h.md'])).rejects.toThrow(/prompt/);
    await expect(parseArgs(['--autopilot', 'h.md', '--route', 'infra'])).rejects.toThrow(/--route/);
    await expect(parseArgs(['--autopilot', ''])).rejects.toThrow(/arquivo/);
    // a prompt instead of a file: `--autopilot "<texto>"` or `-p "<texto>" --autopilot`
    expect(await parseArgs(['-p', 'crie um CRUD', '--autopilot'])).toMatchObject({
      autopilot: 'crie um CRUD',
      prompt: undefined,
    });
    expect(await parseArgs(['--autopilot', 'crie um CRUD de clientes'])).toMatchObject({
      autopilot: 'crie um CRUD de clientes',
    });
  });
});

describe('status bar (FR-025)', () => {
  it('shows the story and the step while a run is active', async () => {
    const ui = renderSized(
      <StatusBar
        state="generating"
        exitArmed={false}
        capabilities={
          { columns: 100, rows: 30, compact: false, tooSmall: false, color: false } as never
        }
        autopilot={{ story: 2, total: 3, step: 'plan' }}
      />,
      { columns: 100, rows: 3 },
    );
    await waitFor(
      () => ui.frameText().includes('autopiloto · história 2/3 · plan'),
      3000,
      'status',
    );
    expect(ui.frameText()).toContain('Esc interromper');
  });
});
