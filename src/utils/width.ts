import stringWidth from 'string-width';

/** Visual width in terminal cells (CJK = 2, emoji = 2, combining marks = 0, ANSI ignored). */
export function visualWidth(s: string): number {
  return stringWidth(s);
}

/** Cuts `s` so that its visual width is ≤ `max`, appending `ellipsis` when something was removed. */
export function truncateToWidth(s: string, max: number, ellipsis = '…'): string {
  if (max <= 0) return '';
  if (visualWidth(s) <= max) return s;
  const ellWidth = visualWidth(ellipsis);
  const budget = Math.max(0, max - ellWidth);
  let out = '';
  let width = 0;
  for (const ch of s) {
    const w = visualWidth(ch);
    if (width + w > budget) break;
    out += ch;
    width += w;
  }
  return out + (budget >= 0 ? ellipsis : '');
}

/** Pads `s` with spaces to exactly `width` visual cells (truncating if longer). */
export function padToWidth(
  s: string,
  width: number,
  align: 'left' | 'right' | 'center' = 'left',
): string {
  const text = visualWidth(s) > width ? truncateToWidth(s, width) : s;
  const gap = Math.max(0, width - visualWidth(text));
  if (align === 'right') return ' '.repeat(gap) + text;
  if (align === 'center') {
    const left = Math.floor(gap / 2);
    return ' '.repeat(left) + text + ' '.repeat(gap - left);
  }
  return text + ' '.repeat(gap);
}

/** Splits text into lines whose visual width never exceeds `width` (word-aware, hard-breaks long words). */
export function wrapToWidth(text: string, width: number): string[] {
  if (width <= 0) return [text];
  const lines: string[] = [];
  for (const raw of text.split('\n')) {
    let line = '';
    let lineW = 0;
    for (const word of raw.split(' ')) {
      let w = visualWidth(word);
      if (w > width) {
        // hard-break a word longer than the width
        if (line) {
          lines.push(line);
          line = '';
          lineW = 0;
        }
        let chunk = '';
        let chunkW = 0;
        for (const ch of word) {
          const cw = visualWidth(ch);
          if (chunkW + cw > width) {
            lines.push(chunk);
            chunk = '';
            chunkW = 0;
          }
          chunk += ch;
          chunkW += cw;
        }
        line = chunk;
        lineW = chunkW;
        continue;
      }
      const sep = line ? 1 : 0;
      if (lineW + sep + w > width) {
        lines.push(line);
        line = word;
        lineW = w;
      } else {
        line = line ? `${line} ${word}` : word;
        lineW += sep + w;
      }
      w = 0;
    }
    lines.push(line);
  }
  return lines;
}
