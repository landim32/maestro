import { describe, expect, it } from 'vitest';
import { parseArgs, UsageError } from '../../../src/cli/args.js';

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
    });
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
  });

  it('rejects positional arguments, unknown options and invalid provider', async () => {
    await expect(parseArgs(['foo'])).rejects.toBeInstanceOf(UsageError);
    await expect(parseArgs(['--bogus'])).rejects.toBeInstanceOf(UsageError);
    await expect(parseArgs(['--provider', 'gemini'])).rejects.toBeInstanceOf(UsageError);
    await expect(parseArgs(['-p', '   '])).rejects.toBeInstanceOf(UsageError);
  });
});
