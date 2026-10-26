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
