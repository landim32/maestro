import type { Root } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

const processor = unified().use(remarkParse).use(remarkGfm);

const CACHE_LIMIT = 64;
const cache = new Map<string, Root>();

function fallback(source: string): Root {
  return {
    type: 'root',
    children: [{ type: 'paragraph', children: [{ type: 'text', value: source }] }],
  };
}

/** Markdown → mdast (GFM). Memoized; never throws (falls back to a single paragraph). */
export function parseMarkdown(source: string): Root {
  const hit = cache.get(source);
  if (hit) return hit;
  let tree: Root;
  try {
    tree = processor.parse(source) as Root;
  } catch {
    tree = fallback(source);
  }
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(source, tree);
  return tree;
}
