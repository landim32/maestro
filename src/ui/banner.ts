import type { TerminalCapabilities } from './hooks/useTerminalCapabilities.js';
import { visualWidth } from '../utils/width.js';

/** 6-line block-letter "MAESTRO" (≤ 70 columns), same technique as qwen code's AsciiArt. */
export const LARGE_BANNER: readonly string[] = [
  '███╗   ███╗ █████╗ ███████╗███████╗████████╗██████╗  ██████╗ ',
  '████╗ ████║██╔══██╗██╔════╝██╔════╝╚══██╔══╝██╔══██╗██╔═══██╗',
  '██╔████╔██║███████║█████╗  ███████╗   ██║   ██████╔╝██║   ██║',
  '██║╚██╔╝██║██╔══██║██╔══╝  ╚════██║   ██║   ██╔══██╗██║   ██║',
  '██║ ╚═╝ ██║██║  ██║███████╗███████║   ██║   ██║  ██║╚██████╔╝',
  '╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚══════╝   ╚═╝   ╚═╝  ╚═╝ ╚═════╝ ',
];

export const COMPACT_BANNER = '♪ Maestro';

export type BannerVariant = 'large' | 'compact' | 'none';

export const LARGE_BANNER_WIDTH = Math.max(...LARGE_BANNER.map((l) => visualWidth(l)));

/** data-model.md § 6 */
export function pickBannerVariant(
  caps: Pick<TerminalCapabilities, 'columns' | 'rows' | 'tooSmall' | 'compact'>,
): BannerVariant {
  if (caps.tooSmall) return 'none';
  if (!caps.compact && caps.columns >= LARGE_BANNER_WIDTH + 4) return 'large';
  return 'compact';
}
