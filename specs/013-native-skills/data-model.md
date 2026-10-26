# Data Model: Suporte nativo a skills

Todos os tipos vivem em memória, durante uma sessão. O único dado persistido é o evento `skill.load` no `.jsonl` do autopiloto (§ 5).

## 1. `SkillSource`

```ts
type SkillSource = 'project-claude' | 'project-agents' | 'user';
```

| Valor            | Raiz                       | Rótulo exibido               |
| ---------------- | -------------------------- | ---------------------------- |
| `project-claude` | `<cwd>/.claude/skills`     | `projeto (.claude/skills)`   |
| `project-agents` | `<cwd>/.agents/skills`     | `projeto (.agents/skills)`   |
| `user`           | `<homeDir>/.claude/skills` | `usuário (~/.claude/skills)` |

A ordem da tabela é a de precedência (FR-010).

## 2. `SkillEntry`

```ts
interface SkillEntry {
  name: string;          // frontmatter `name`, ou o nome da pasta
  description: string;   // frontmatter `description`, espaços colapsados (texto completo)
  source: SkillSource;
  dir: string;           // caminho absoluto da pasta da skill (como encontrado)
  file: string;          // caminho absoluto do SKILL.md
}
```

Regras de validação, de `discoverSkills`:

- `name`, depois do trim, não pode ser vazio. Na falta dele, vale o nome da pasta.
- `description`, depois do trim, não pode ser vazia. Se for, a skill vai para `ignored` com o motivo "sem description no cabeçalho".
- O cabeçalho precisa existir e fechar com `---`. Sem isso, a skill vai para `ignored` com o motivo do parser.
- Um nome que casa com `/^speckit[-.]/i` vai para `ignored` com o motivo "comando do Spec Kit hospedado nativamente pelo Maestro".

## 3. `SkillCatalog`

```ts
interface SkillCatalog {
  skills: SkillEntry[];                                   // válidas, em ordem de precedência e alfabética
  shadowed: Array<SkillEntry & { by: SkillSource }>;      // mesmo nome de uma válida anterior
  ignored: Array<{ path: string; source: SkillSource; reason: string }>;
}
```

- O catálogo é criado uma vez, em `index.ts`, quando `settings.skills.enabled && settings.tools.enabled`. Fora disso é `EMPTY_CATALOG` (três listas vazias).
- Ele é compartilhado por `buildSystemPrompt` (só `skills`), por `createLoadSkillTool` (busca por `name`) e por `/skills` (as três listas).
- `findSkill(catalog, name)` compara o nome exato e, se não achar, tenta sem diferenciar maiúsculas.

## 4. `SkillLoadDisplay`, em `ToolResultDisplay.skill`

```ts
interface SkillLoadDisplay {
  name: string;          // nome pedido pelo modelo
  source?: SkillSource;  // ausente quando o nome não existe
  file?: string;         // caminho relativo pedido (quando houver)
  ok: boolean;
  lines?: number;        // linhas devolvidas (corpo ou arquivo)
  files?: number;        // arquivos de referência listados (só sem `file`)
}
```

Ele só é exibido: os conversores dos provedores copiam apenas `callId`/`output`/`isError`.

## 5. Evento `skill.load`, no `.maestro/autopilot/<id>.jsonl`

```json
{
  "at": "2026-10-26T12:00:00.000Z",
  "event": "skill.load",
  "story": 1,
  "feature": "014-exportar-csv",
  "step": "plan",
  "skill": "padroes-api",
  "source": "project-claude",
  "file": "references/erros.md",
  "ok": true
}
```

- `story` começa em 1, como nos eventos `gate` e `commit`. `feature` pode faltar antes do `specify` concluir. `file` e `source` só aparecem quando existem.
- O evento nunca leva conteúdo nem a saída da ferramenta (FR-016).

## 6. Configuração

```ts
skills: z.strictObject({
  _comment: comment,
  enabled: z.boolean().default(true),
}).prefault({})
```

A chave ausente equivale a `{ enabled: true }`.

## 7. Transições

Não há máquina de estados. O catálogo é imutável durante a sessão (R9). Cada `load_skill` lê o disco no momento da chamada (FR-019).
