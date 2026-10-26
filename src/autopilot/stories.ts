/** Stories file parser (specs/011 contracts/stories-file.md). Pure. */
import { createHash } from 'node:crypto';
import type { Story } from './types.js';

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

export function storyHash(title: string, body: string): string {
  return sha256(`${title}\n\n${body}`);
}

/** Text sent to /speckit.specify: what the user would type after the command. */
export function specifyText(story: Pick<Story, 'title' | 'body'>): string {
  return `${story.title}\n\n${story.body}`;
}

const SECTION_TITLE =
  /^(?:\d+[.)]\s*)?(?:contexto|objetivos?|escopo|fora de escopo|crit[ée]rios? de aceite|regras|decis[õo]es|depend[êe]ncias|riscos|perguntas|premissas|hist[óo]ria|context|goals?|scope|out of scope|acceptance criteria|rules|decisions|dependencies|risks|open questions|assumptions|background)\b/i;

/**
 * Titles of "stories" that look like sections of one document (Contexto, Escopo, Riscos…). Two
 * or more mean the file is probably a single story whose sections use "## ".
 */
export function sectionLikeTitles(stories: Story[]): string[] {
  return stories.map((s) => s.title).filter((t) => SECTION_TITLE.test(t));
}

/**
 * Whether the /autopilot argument names a stories file rather than being a prompt: one token
 * with a path separator or an extension (an existing file is checked by the driver first).
 */
export function looksLikePath(text: string): boolean {
  const t = text.trim();
  return t !== '' && !/\s/.test(t) && (/[/\x5c]/.test(t) || /\.[A-Za-z0-9]{1,5}$/.test(t));
}

export const PROMPT_TITLE_MAX = 72;
const PASTE_TAG = /^<\/?pasted-text(?:\s[^>]*)?>$/;
/** A line that is only a tag (`<file path="…">`): never the title. */
const TAG_LINE = /^<\/?[a-z][\w-]*(?:\s[^>]*)?>$/i;

/**
 * Stories file for `/autopilot <prompt>`: always ONE story, titled by the prompt's first line.
 * The prompt's own "#"/"##" headings become "###" so they stay inside that story, and the
 * wrapper of pasted text (`<pasted-text …>`, from the interactive prompt) is dropped.
 */
export function promptStoriesFile(prompt: string): string {
  const text = prompt
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((l) => !PASTE_TAG.test(l.trim()))
    .join('\n')
    .trim();
  const first = (text.split('\n').find((l) => l.trim() !== '' && !TAG_LINE.test(l.trim())) ?? '')
    .replace(/^#+\s*/, '')
    .trim();
  const title =
    first.length > PROMPT_TITLE_MAX ? `${first.slice(0, PROMPT_TITLE_MAX - 1).trimEnd()}…` : first;
  return `## ${title}\n\n${text.replace(/^#{1,2}(?=\s)/gm, '###')}\n`;
}

export function parseStories(markdown: string): Story[] | { error: string } {
  const text = markdown.replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const heads: number[] = [];
  lines.forEach((l, i) => {
    if (/^##\s+\S/.test(l) && !/^###/.test(l)) heads.push(i);
  });

  if (heads.length === 0) {
    const body = text.trim();
    if (body === '') return { error: 'arquivo vazio' };
    const title = (body.split('\n').find((l) => l.trim() !== '') ?? '')
      .replace(/^#+\s*/, '')
      .trim();
    return [{ index: 1, title, body, hash: storyHash(title, body) }];
  }

  // Text before the first story (minus level-1 titles) is shared context.
  const preamble = lines
    .slice(0, heads[0])
    .filter((l) => !/^#\s/.test(l))
    .join('\n')
    .trim();

  const stories: Story[] = [];
  const empty: string[] = [];
  heads.forEach((start, k) => {
    const end = heads[k + 1] ?? lines.length;
    const title = lines[start]!.replace(/^##\s+/, '').trim();
    let body = lines
      .slice(start + 1, end)
      .join('\n')
      .trim();
    if (body === '') {
      empty.push(title);
      return;
    }
    if (preamble) body = `${body}\n\nContexto do backlog:\n${preamble}`;
    stories.push({ index: stories.length + 1, title, body, hash: storyHash(title, body) });
  });
  if (empty.length > 0) return { error: `história sem descrição: ${empty.join(', ')}` };
  return stories;
}
