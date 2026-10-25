import { describe, expect, it } from 'vitest';
import { parseArgs, UsageError, versionText } from '../../../src/cli/args.js';

describe('parseArgs', () => {
  it('defaults to interactive run with tools and color on', async () => {
    const a = await parseArgs([]);
    expect(a).toMatchObject({ action: 'run', tools: true, color: true, debug: false });
    expect(a.prompt).toBeUndefined();
    expect(a.provider).toBeUndefined();
  });

  it('parses every option', async () => {
    const a = await parseArgs([
      '-p',
      'hello',
      '--provider',
      'qwen',
      '--model',
      'qwen-max',
      '--config',
      '/tmp/s.json',
      '--no-tools',
      '--no-color',
      '--no-altscreen',
      '--debug',
    ]);
    expect(a).toEqual({
      action: 'run',
      prompt: 'hello',
      provider: 'qwen',
      model: 'qwen-max',
      config: '/tmp/s.json',
      tools: false,
      color: false,
      altScreen: false,
      debug: true,
      approvalMode: undefined,
    });
  });

  /** contracts/approval-modes.md § 5 */
  it('parses --approval-mode (with legacy spellings) and --yolo', async () => {
    expect((await parseArgs([])).approvalMode).toBeUndefined();
    expect((await parseArgs(['--approval-mode', 'auto'])).approvalMode).toBe('auto');
    expect((await parseArgs(['--approval-mode', 'auto_edit'])).approvalMode).toBe('auto-edit');
    expect((await parseArgs(['--approval-mode', 'YOLO'])).approvalMode).toBe('yolo');
    expect((await parseArgs(['--yolo'])).approvalMode).toBe('yolo');
    expect((await parseArgs(['--yolo', '--approval-mode', 'default'])).approvalMode).toBe('yolo');
    await expect(parseArgs(['--approval-mode', 'foo'])).rejects.toThrow(/auto-edit, auto, yolo/);
    await expect(parseArgs(['--approval-mode', 'plan'])).rejects.toBeInstanceOf(UsageError);
    expect((await parseArgs(['--help'])).helpText).toContain('--approval-mode');
  });

  it('alternate screen is on by default and off with --no-altscreen', async () => {
    expect((await parseArgs([])).altScreen).toBe(true);
    expect((await parseArgs(['--no-altscreen'])).altScreen).toBe(false);
  });

  it('accepts "-" as prompt for stdin', async () => {
    expect((await parseArgs(['-p', '-'])).prompt).toBe('-');
  });

  it('reports version and help without running', async () => {
    expect((await parseArgs(['--version'])).action).toBe('version');
    expect((await parseArgs(['-v'])).action).toBe('version');
    const h = await parseArgs(['--help']);
    expect(h.action).toBe('help');
    expect(h.helpText).toContain('--provider');
    // specs/006: the bundled Spec Kit version is part of --version
    expect(versionText()).toMatch(/^maestro \S+\nspec-kit v\d+\.\d+\.\d+ \(embutido\)$/);
  });

  it('rejects positional arguments, unknown options and invalid provider', async () => {
    await expect(parseArgs(['foo'])).rejects.toBeInstanceOf(UsageError);
    await expect(parseArgs(['--bogus'])).rejects.toBeInstanceOf(UsageError);
    await expect(parseArgs(['--provider', 'gemini'])).rejects.toBeInstanceOf(UsageError);
    await expect(parseArgs(['-p', '   '])).rejects.toBeInstanceOf(UsageError);
  });
});
