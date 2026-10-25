/**
 * Chips: indivisible markers inside the prompt text (specs/007 data-model.md § 1).
 *
 * A chip is stored in the editor as ONE code point of the Unicode private-use area
 * (U+E000 + id). The editor keeps working on a plain `string[]`; only the width/label lookup
 * and the final expansion consult the registry. The private-use area never comes from the
 * keyboard, and pasted PUA characters are replaced before insertion (`sanitizePaste`).
 */

export const CHIP_BASE = 0xe000;
/** End of the BMP private-use area; chips above it are never created. */
export const CHIP_LAST = 0xf8ff;

export type ChipKind = 'paste' | 'file' | 'image';

export type Chip =
  | { kind: 'paste'; id: number; seq: number; text: string; lines: number }
  | {
      kind: 'file';
      id: number;
      seq: number;
      path: string;
      rel: string;
      name: string;
      bytes: number;
      lines: number;
    }
  | {
      kind: 'image';
      id: number;
      seq: number;
      path: string;
      rel: string;
      name: string;
      bytes: number;
      mediaType: string;
    };

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
export type ChipInput = DistributiveOmit<Chip, 'id' | 'seq'>;

/** Content a chip expands to when the message is sent (`undefined` = file missing). */
export interface ChipContent {
  text: string;
  lines: number;
}
export type ChipReader = (chip: Chip) => ChipContent | undefined;

/** Per-session registry: ids are unique and never reused; `seq` counts per kind (#1, #2…). */
export class ChipRegistry {
  private readonly chips: Chip[] = [];
  private readonly seqs: Record<ChipKind, number> = { paste: 0, file: 0, image: 0 };

  add(input: ChipInput): Chip {
    const id = this.chips.length;
    if (CHIP_BASE + id > CHIP_LAST) throw new Error('too many chips in this session');
    const seq = ++this.seqs[input.kind];
    const chip = { ...input, id, seq } as Chip;
    this.chips.push(chip);
    return chip;
  }

  get(id: number): Chip | undefined {
    return this.chips[id];
  }

  /** The chip whose label is exactly `label` (history relink), if any. */
  byLabel(label: string): Chip | undefined {
    return this.chips.find((c) => chipLabel(c) === label);
  }

  all(): Chip[] {
    return [...this.chips];
  }

  get size(): number {
    return this.chips.length;
  }
}

export function chipChar(id: number): string {
  return String.fromCodePoint(CHIP_BASE + id);
}

/** Chip id for a private-use code point; undefined for ordinary text. */
export function chipIdOf(ch: string): number | undefined {
  const cp = ch.codePointAt(0);
  if (cp === undefined || cp < CHIP_BASE || cp > CHIP_LAST) return undefined;
  return cp - CHIP_BASE;
}

export function isChipChar(ch: string): boolean {
  return chipIdOf(ch) !== undefined;
}

/** `1234 B`, `120 KB`, `6.1 MB` (whole megabytes without the decimal: `2 MB`). */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  const mb = n / (1024 * 1024);
  const text = mb.toFixed(1);
  return `${text.endsWith('.0') ? text.slice(0, -2) : text} MB`;
}

export function chipLabel(chip: Chip): string {
  switch (chip.kind) {
    case 'paste':
      return `[Pasted text #${chip.seq} +${chip.lines} lines]`;
    case 'file':
      return `[Arquivo: ${chip.name}, ${chip.lines} linhas]`;
    case 'image':
      return `[Imagem: ${chip.name}, ${formatBytes(chip.bytes)}]`;
  }
}

/** Lines of `text`: one per `\n`; a last line without a newline still counts; '' → 0. */
export function countLines(text: string): number {
  if (text === '') return 0;
  const parts = text.replace(/\r\n?/g, '\n').split('\n');
  if (parts[parts.length - 1] === '') parts.pop();
  return parts.length;
}

/** Normalizes line endings and replaces private-use code points (reserved for chips) by U+FFFD. */
export function sanitizePaste(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/[-]/g, '�');
}

/** Replaces every chip code point by its label (transcript, history). */
export function labelChips(text: string, reg: ChipRegistry): string {
  let out = '';
  for (const ch of text) {
    const id = chipIdOf(ch);
    if (id === undefined) out += ch;
    else {
      const chip = reg.get(id);
      out += chip ? chipLabel(chip) : '�';
    }
  }
  return out;
}

/** Replaces labels of chips known to this session by their code points (↑/↓ history). */
export function relinkChips(text: string, reg: ChipRegistry): string {
  let out = text;
  for (const chip of reg.all()) {
    const label = chipLabel(chip);
    if (out.includes(label)) out = out.split(label).join(chipChar(chip.id));
  }
  return out;
}

/** Chips referenced by `text`, in order of first appearance, without duplicates. */
export function chipsIn(text: string, reg: ChipRegistry): Chip[] {
  const seen = new Set<number>();
  const out: Chip[] = [];
  for (const ch of text) {
    const id = chipIdOf(ch);
    if (id === undefined || seen.has(id)) continue;
    const chip = reg.get(id);
    if (!chip) continue;
    seen.add(id);
    out.push(chip);
  }
  return out;
}

/** Text with every chip removed (used to decide whether the message is "only attachments"). */
export function stripChips(text: string): string {
  return text.replace(/[-]/g, '');
}

export const ATTACHMENTS_PREFIX = 'The user attached the following content:';

/** Delimited block for one chip (contracts/paste-chips.md § 3, contracts/attachments.md § 3). */
export function chipBlock(chip: Chip, content: ChipContent | undefined): string {
  switch (chip.kind) {
    case 'paste': {
      const c = content ?? { text: chip.text, lines: chip.lines };
      return `<pasted-text id="${chip.seq}" lines="${c.lines}">\n${c.text}\n</pasted-text>`;
    }
    case 'file': {
      if (!content) return `<file path="${chip.rel}" missing="true"/>`;
      return `<file path="${chip.rel}" lines="${content.lines}">\n${content.text}\n</file>`;
    }
    case 'image':
      return `[Imagem: ${chip.name}]`;
  }
}

/**
 * Replaces every chip by its delimited block. `read` supplies the content at send time
 * (files are read then); paste chips fall back to their stored text.
 */
export function expandChips(text: string, reg: ChipRegistry, read?: ChipReader): string {
  let out = '';
  let hasChip = false;
  for (const ch of text) {
    const id = chipIdOf(ch);
    if (id === undefined) {
      out += ch;
      continue;
    }
    const chip = reg.get(id);
    if (!chip) {
      out += '�';
      continue;
    }
    hasChip = true;
    out += chipBlock(chip, read?.(chip));
  }
  if (hasChip && stripChips(text).trim() === '') return `${ATTACHMENTS_PREFIX}\n${out}`;
  return out;
}
