/**
 * Feature/branch naming, after spec-kit's create-new-feature scripts (MIT, see assets/speckit/NOTICE):
 * stop-word filtering, 3–4 meaningful words, acronym retention and GitHub's 244-byte branch limit.
 */

export const MAX_BRANCH_LENGTH = 244;

export const STOP_WORDS = new Set(
  'i a an the to for of in on at by with from is are was were be been being have has had do does did will would should could can may might must shall this that these those my your our their want need add get set'.split(
    ' ',
  ),
);

const isAscii = (s: string): boolean => /^[\x00-\x7F]*$/.test(s);

/** Lowercase, every non-letter/digit → separator (Unicode-aware). */
function unicodeWords(name: string, separator: string): string {
  return name
    .replace(/\n/g, ' ')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, separator);
}

/** `My Feature!!` → `my-feature` */
export function cleanBranchName(name: string): string {
  return unicodeWords(name, '-').replace(/-{2,}/g, '-').replace(/^-/, '').replace(/-$/, '');
}

/** Short name from a free-text description (stop words out, acronyms kept, 3 words or 4 when exactly 4). */
export function generateBranchName(description: string): string {
  const words = unicodeWords(description, ' ').split(/\s+/).filter(Boolean);
  const meaningful: string[] = [];
  for (const word of words) {
    if (STOP_WORDS.has(word)) continue;
    if (word.length >= 3 || !isAscii(word)) {
      meaningful.push(word);
    } else if (new RegExp(`\\b${word.toUpperCase()}\\b`).test(description)) {
      meaningful.push(word); // short word that appears as an uppercase acronym in the original
    }
  }
  if (meaningful.length > 0) {
    const max = meaningful.length === 4 ? 4 : 3;
    return meaningful.slice(0, max).join('-');
  }
  return cleanBranchName(description).split('-').filter(Boolean).slice(0, 3).join('-');
}

const byteLength = (s: string): number => Buffer.byteLength(s, 'utf8');

/** `<num>-<suffix>` trimmed to GitHub's 244-byte limit on a character boundary, no trailing `-`. */
export function fitBranchName(featureNum: string, suffix: string): string {
  const full = `${featureNum}-${suffix}`;
  if (byteLength(full) <= MAX_BRANCH_LENGTH) return full;
  const maxSuffix = MAX_BRANCH_LENGTH - featureNum.length - 1;
  const chars = Array.from(suffix);
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (byteLength(chars.slice(0, mid).join('')) <= maxSuffix) lo = mid;
    else hi = mid - 1;
  }
  const truncated = chars.slice(0, lo).join('').replace(/-$/, '');
  return `${featureNum}-${truncated}`;
}
