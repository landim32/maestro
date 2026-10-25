import { describe, expect, it, vi } from 'vitest';
import { clipboardCommands, copyToClipboard, osc52 } from '../../../src/utils/clipboard.js';
import type { ClipboardCommand, ExecFn } from '../../../src/utils/clipboard.js';

function fakeExec(failing: string[]) {
  const calls: Array<{ cmd: ClipboardCommand; input: Buffer }> = [];
  const exec: ExecFn = async (cmd, input) => {
    calls.push({ cmd, input });
    if (failing.includes(cmd.method)) {
      const err = new Error(`spawn ${cmd.file} ENOENT`) as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    }
  };
  return { exec, calls };
}

describe('copyToClipboard (contracts/mouse-selection.md § 4, research R6)', () => {
  it('lists the utilities in the documented order per platform', () => {
    expect(clipboardCommands('win32').map((c) => c.method)).toEqual(['clip', 'powershell']);
    expect(clipboardCommands('darwin').map((c) => c.method)).toEqual(['pbcopy']);
    expect(clipboardCommands('linux').map((c) => c.method)).toEqual(['wl-copy', 'xclip', 'xsel']);
    expect(clipboardCommands('linux')[1]).toMatchObject({
      file: 'xclip',
      args: ['-selection', 'clipboard'],
    });
  });

  it('falls through to the next utility when one is missing and delivers the text on stdin', async () => {
    const { exec, calls } = fakeExec(['wl-copy']);
    const r = await copyToClipboard('olá\nmundo', { platform: 'linux', exec });
    expect(r).toEqual({ ok: true, method: 'xclip' });
    expect(calls.map((c) => c.cmd.method)).toEqual(['wl-copy', 'xclip']);
    expect(calls[1]!.input.toString('utf8')).toBe('olá\nmundo');
  });

  it('on Windows clip.exe receives UTF-16LE with a BOM; PowerShell is the second option', async () => {
    const { exec, calls } = fakeExec([]);
    expect(await copyToClipboard('ação', { platform: 'win32', exec })).toEqual({
      ok: true,
      method: 'clip',
    });
    const buf = calls[0]!.input;
    expect([buf[0], buf[1]]).toEqual([0xff, 0xfe]);
    expect(buf.subarray(2).toString('utf16le')).toBe('ação');
    const second = fakeExec(['clip']);
    expect(await copyToClipboard('x', { platform: 'win32', exec: second.exec })).toEqual({
      ok: true,
      method: 'powershell',
    });
    expect(second.calls[1]!.cmd.args.join(' ')).toContain('Set-Clipboard');
  });

  it('writes OSC 52 to a TTY stdout when no utility works', async () => {
    const { exec } = fakeExec(['pbcopy']);
    const write = vi.fn();
    const r = await copyToClipboard('abc', {
      platform: 'darwin',
      exec,
      stdout: { write, isTTY: true },
    });
    expect(r).toEqual({ ok: true, method: 'osc52' });
    expect(write).toHaveBeenCalledWith(osc52('abc'));
    expect(osc52('abc')).toBe(`\x1b]52;c;${Buffer.from('abc').toString('base64')}\x07`);
  });

  it('reports failure without a TTY and without utilities', async () => {
    const { exec } = fakeExec(['wl-copy', 'xclip', 'xsel']);
    const write = vi.fn();
    const r = await copyToClipboard('abc', {
      platform: 'linux',
      exec,
      stdout: { write, isTTY: false },
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('ENOENT');
    expect(write).not.toHaveBeenCalled();
  });
});
