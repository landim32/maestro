import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { TextField } from '../../../../src/ui/dialogs/TextField.js';

const tick = () => new Promise((r) => setTimeout(r, 20));

function Harness(props: {
  secret?: boolean;
  active?: boolean;
  maskedCurrent?: string;
  initial?: string;
  onValue?: (v: string) => void;
}) {
  const [value, setValue] = useState(props.initial ?? '');
  return (
    <TextField
      label="Chave"
      value={value}
      onChange={(v) => {
        setValue(v);
        props.onValue?.(v);
      }}
      active={props.active ?? true}
      color
      secret={props.secret}
      maskedCurrent={props.maskedCurrent}
      placeholder="digite"
    />
  );
}

describe('TextField', () => {
  it('masks secrets with • and never shows the typed key', async () => {
    const seen: string[] = [];
    const { stdin, lastFrame } = render(<Harness secret onValue={(v) => seen.push(v)} />);
    await tick();
    stdin.write('sk-abc');
    await tick();
    expect(lastFrame()).toContain('••••••');
    expect(lastFrame()).not.toContain('sk-abc');
    expect(seen.at(-1)).toBe('sk-abc');
  });

  it('shows the masked current key with a keep hint when empty', async () => {
    const { lastFrame } = render(<Harness secret maskedCurrent="****1234" />);
    await tick();
    expect(lastFrame()).toContain('****1234 (Enter mantém a atual)');
  });

  it('strips whitespace from pasted secrets, Ctrl+U clears, backspace deletes a code point', async () => {
    const seen: string[] = [];
    const { stdin } = render(<Harness secret onValue={(v) => seen.push(v)} />);
    await tick();
    stdin.write('sk-\n 1 2\r\n');
    await tick();
    expect(seen.at(-1)).toBe('sk-12');
    stdin.write('\x7f');
    await tick();
    expect(seen.at(-1)).toBe('sk-1');
    stdin.write('\x15'); // Ctrl+U
    await tick();
    expect(seen.at(-1)).toBe('');
  });

  it('ignores Enter, Esc, arrows and mouse reports; inactive fields ignore everything', async () => {
    const seen: string[] = [];
    const { stdin } = render(<Harness onValue={(v) => seen.push(v)} />);
    await tick();
    stdin.write('\r');
    stdin.write('\x1b');
    stdin.write('\x1b[A');
    stdin.write('\x1b[<64;1;1M');
    await tick();
    expect(seen).toEqual([]);
    const inactive: string[] = [];
    const ui = render(<Harness active={false} onValue={(v) => inactive.push(v)} />);
    await tick();
    ui.stdin.write('abc');
    await tick();
    expect(inactive).toEqual([]);
  });
});
