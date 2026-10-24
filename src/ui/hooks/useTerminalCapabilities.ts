import { useMemo } from 'react';
import { useStdout, useWindowSize } from 'ink';
import type { UiSettings } from '../../config/schema.js';
import { colorEnabled } from '../../utils/tty.js';

export const MIN_ROWS = 12;
export const MIN_COLUMNS = 40;
export const COMPACT_ROWS = 20;
export const COMPACT_COLUMNS = 100;

export interface TerminalCapabilities {
  columns: number;
  rows: number;
  color: boolean;
  altScreen: boolean;
  mouse: boolean;
  compact: boolean;
  tooSmall: boolean;
}

export interface CapabilityInput {
  columns: number;
  rows: number;
  isTTY: boolean;
  ui: Pick<UiSettings, 'altScreen' | 'mouse' | 'color'>;
  /** From CLI flags: --no-altscreen / --no-color */
  flags?: { altScreen?: boolean; color?: boolean };
  env?: NodeJS.ProcessEnv;
}

/** Pure computation shared by the hook and by `interactive.ts` (which needs it before render). */
export function computeCapabilities(input: CapabilityInput): TerminalCapabilities {
  const env = input.env ?? process.env;
  const noAltEnv = env['MAESTRO_NO_ALTSCREEN'] !== undefined && env['MAESTRO_NO_ALTSCREEN'] !== '';
  const flagAlt = input.flags?.altScreen ?? true;
  const flagColor = input.flags?.color ?? true;
  const columns = Math.max(1, input.columns || 80);
  const rows = Math.max(1, input.rows || 24);
  const color =
    input.ui.color === false
      ? false
      : colorEnabled({ noColorFlag: !flagColor, env, stdout: { isTTY: input.isTTY } });
  return {
    columns,
    rows,
    color,
    altScreen: input.ui.altScreen && flagAlt && !noAltEnv && input.isTTY,
    mouse: input.ui.mouse && input.isTTY,
    compact: rows < COMPACT_ROWS || columns < COMPACT_COLUMNS,
    tooSmall: rows < MIN_ROWS || columns < MIN_COLUMNS,
  };
}

export interface UseTerminalCapabilitiesOptions {
  ui: Pick<UiSettings, 'altScreen' | 'mouse' | 'color'>;
  flags?: { altScreen?: boolean; color?: boolean };
  env?: NodeJS.ProcessEnv;
}

/** Live capabilities: re-evaluated on every terminal resize. */
export function useTerminalCapabilities(
  opts: UseTerminalCapabilitiesOptions,
): TerminalCapabilities {
  const { columns, rows } = useWindowSize();
  const { stdout } = useStdout();
  const isTTY = Boolean((stdout as { isTTY?: boolean }).isTTY);
  return useMemo(
    () =>
      computeCapabilities({ columns, rows, isTTY, ui: opts.ui, flags: opts.flags, env: opts.env }),
    [columns, rows, isTTY, opts.ui, opts.flags, opts.env],
  );
}
