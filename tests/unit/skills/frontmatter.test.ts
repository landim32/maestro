import { describe, expect, it } from 'vitest';
import { parseFrontmatter } from '../../../src/skills/frontmatter.js';

const fields = (text: string) => {
  const r = parseFrontmatter(text);
  if ('error' in r) throw new Error(r.error);
  return r.fields;
};

describe('parseFrontmatter (specs/013 research R1)', () => {
  it('plain, single- and double-quoted values', () => {
    expect(
      fields(
        [
          '---',
          'name: revisao-pr',
          "title: 'it''s ok'",
          'description: "Read this before \\"your own browser\\" tasks.\\nSecond"',
          'plain: a value # comment',
          '---',
          'body',
        ].join('\n'),
      ),
    ).toEqual({
      name: 'revisao-pr',
      title: "it's ok",
      description: 'Read this before "your own browser" tasks.\nSecond',
      plain: 'a value',
    });
  });

  it('folded and literal blocks, plain continuation, nested data skipped', () => {
    const f = fields(
      [
        '---',
        'description: >',
        '  Convenções de API',
        '  REST da equipe.',
        '',
        '  Segundo parágrafo.',
        'notes: |-',
        '  linha 1',
        '  linha 2',
        'allowed-tools:',
        '  - Read',
        '  - Grep',
        'metadata:',
        '  owner: x',
        'long: começa aqui',
        '  e continua',
        '---',
      ].join('\n'),
    );
    expect(f['description']).toBe('Convenções de API REST da equipe.\nSegundo parágrafo.\n');
    expect(f['notes']).toBe('linha 1\nlinha 2');
    expect(f['allowed-tools']).toBeUndefined();
    expect(f['metadata']).toBeUndefined();
    expect(f['long']).toBe('começa aqui e continua');
  });

  it('BOM and CRLF; body after the header without the first empty line', () => {
    const r = parseFrontmatter('﻿---\r\nname: x\r\ndescription: d\r\n---\r\n\r\n# Título\r\ntexto');
    expect(r).toEqual({ fields: { name: 'x', description: 'd' }, body: '# Título\ntexto' });
  });

  it('errors: no header, header not closed', () => {
    expect(parseFrontmatter('# Só markdown')).toEqual({
      error: 'sem cabeçalho (---) no início do arquivo',
    });
    expect(parseFrontmatter('---\nname: x\n')).toEqual({ error: 'cabeçalho sem fechamento ---' });
  });
});
