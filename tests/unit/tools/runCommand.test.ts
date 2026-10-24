import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCommandTool, shellFor } from '../../../src/tools/runCommand.js';
import type { ToolContext } from '../../../src/tools/types.js';
import { makeSettings } from '../../helpers/context.js';

let cwd: string;
let ctx: ToolContext;

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-rc-'));
  fs.mkdirSync(path.join(cwd, 'sub'));
  ctx = {
    cwd,
    signal: new AbortController().signal,
    settings: { ...makeSettings().tools, commandTimeoutMs: 2000 },
  };
});
afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));

describe('run_command', () => {
  it('requires confirmation and previews the command and cwd', async () => {
    expect(runCommandTool.requiresConfirmation).toBe(true);
    const p = await runCommandTool.preview!({ command: 'node -v' }, ctx);
    expect(p).toContain('$ node -v');
    expect(p).toContain(cwd);
  });
  it('captures output and exit code 0', async () => {
    const r = await runCommandTool.run(
      { command: `node -e "process.stdout.write('hi there')"` },
      ctx,
    );
    expect(r.isError).toBe(false);
    expect(r.output).toBe('exit code 0\nhi there');
  });
  it('marks non-zero exit codes as errors and includes stderr', async () => {
    const r = await runCommandTool.run(
      { command: `node -e "process.stderr.write('bad'); process.exit(3)"` },
      ctx,
    );
    expect(r.isError).toBe(true);
    expect(r.output).toBe('exit code 3\nbad');
  });
  it('runs in the requested sub directory, refusing escapes', async () => {
    const r = await runCommandTool.run(
      { command: `node -e "process.stdout.write(process.cwd())"`, cwd: 'sub' },
      ctx,
    );
    expect(r.output.toLowerCase()).toContain(fs.realpathSync(path.join(cwd, 'sub')).toLowerCase());
    const bad = await runCommandTool.run({ command: 'node -v', cwd: '..' }, ctx);
    expect(bad.isError).toBe(true);
    expect(bad.output).toMatch(/outside workspace/);
  });
  it('times out long commands', async () => {
    const r = await runCommandTool.run({ command: `node -e "setTimeout(()=>{}, 10000)"` }, ctx);
    expect(r.isError).toBe(true);
    expect(r.output).toMatch(/timed out after 2000 ms/);
  }, 15000);
  it('is cancelled through the abort signal', async () => {
    const ac = new AbortController();
    const run = runCommandTool.run(
      { command: `node -e "setTimeout(()=>{}, 10000)"` },
      { ...ctx, signal: ac.signal, settings: { ...ctx.settings, commandTimeoutMs: 8000 } },
    );
    setTimeout(() => ac.abort(), 100);
    const r = await run;
    expect(r.isError).toBe(true);
    expect(r.output).toMatch(/cancelled by user/);
  }, 15000);
  it('truncates long output', async () => {
    const r = await runCommandTool.run(
      { command: `node -e "process.stdout.write('x'.repeat(5000))"` },
      { ...ctx, settings: { ...ctx.settings, maxOutputChars: 1000 } },
    );
    expect(r.output).toMatch(/truncated/);
    expect(r.output.length).toBeLessThan(1200);
  });
  it('picks the shell per platform', () => {
    expect(shellFor('linux')).toMatchObject({ file: '/bin/sh' });
    expect(shellFor('linux').args('ls')).toEqual(['-c', 'ls']);
    expect(shellFor('win32').file.toLowerCase()).toContain('cmd');
    expect(shellFor('win32').args('dir')).toEqual(['/d', '/s', '/c', '"dir"']);
  });
});
