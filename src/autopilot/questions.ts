/**
 * Detects a question left to the user at the end of a turn (specs/011 contracts/gates.md § 3),
 * e.g. the "(yes/no)" of /speckit.implement or the "Your choice" blocks of /speckit.specify. Pure.
 */

const CHOICE_MARKERS = [/\((?:yes\/no|sim\/não|sim\/nao|y\/n)\)/i, /\[y\/n\]/i];
const ASKING = [
  'do you want',
  'would you like',
  'should i',
  'shall i',
  'deseja',
  'quer que',
  'posso ',
  'confirma',
  'prefere',
];
const CHOICE_BLOCK = /\b(your choice|sua escolha)\b/i;

/** Last paragraph of the text (blank-line separated), trimmed. */
export function lastParagraph(text: string): string {
  const paras = text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  return paras[paras.length - 1] ?? '';
}

/** The question paragraph, or undefined when the turn ended without asking the user. */
export function detectQuestion(text: string): string | undefined {
  const last = lastParagraph(text);
  if (!last) return undefined;
  if (CHOICE_MARKERS.some((re) => re.test(last))) return last;
  // Clarification blocks ("**Your choice**: _[Wait for user response]_") may sit before a table.
  if (CHOICE_BLOCK.test(text) && /wait for user|aguarde/i.test(text)) return text.trim();
  const lower = last.toLowerCase();
  if (last.trimEnd().endsWith('?') && ASKING.some((w) => lower.includes(w))) return last;
  return undefined;
}
