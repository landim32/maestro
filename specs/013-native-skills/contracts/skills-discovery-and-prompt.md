# Contrato: descoberta de skills, prompt de sistema e `/skills`

## 1. Descoberta (`discoverSkills`)

```ts
discoverSkills(opts: { cwd: string; home: string; fs?: SkillFs }): SkillCatalog
```

1. **Raízes, em ordem**: `<cwd>/.claude/skills`, `<cwd>/.agents/skills`, `<home>/.claude/skills`. `home` vem de `homeDir(env)`.
2. **Entradas de cada raiz**: as subpastas imediatas, em ordem alfabética, que contêm um arquivo `SKILL.md`. Links simbólicos para pastas são seguidos. Uma raiz inexistente ou ilegível é pulada sem aviso, assim como uma subpasta sem `SKILL.md`.
3. **Cabeçalho** (`parseFrontmatter`, research R1):
   - sem bloco `---` → `ignored`, motivo `sem cabeçalho (---) no início do arquivo`;
   - bloco sem fechamento → `ignored`, motivo `cabeçalho sem fechamento ---`;
   - `description` vazia → `ignored`, motivo `sem description no cabeçalho`.
4. **Nome**: `fields.name?.trim()` ou o nome da pasta. Se casar com `/^speckit[-.]/i`, vai para `ignored`.
5. **Precedência**: um nome já visto (comparado sem diferenciar maiúsculas) vai para `shadowed`, com `by` igual à origem da skill que vence.
6. **Robustez**: a descoberta nunca lança exceção. Um erro de leitura de um `SKILL.md` vira `ignored`, motivo `não foi possível ler (<code>)`.

O log de depuração recebe `skills.discover` com as contagens `{ skills, shadowed, ignored, project, user }`, sem nomes nem caminhos do usuário.

## 2. Seção do prompt de sistema (`skillsSection`)

- **Quando entra**: só se `catalog.skills.length > 0`. Nesse caso, `buildSystemPrompt({ …, skills })` insere a seção depois das diretrizes (`Guidelines`) e antes de `# Project guidelines`. A linha `Language:` continua sendo a última.
- **Formato**:

  ```text
  # Skills

  Skills are instructions written by the user or the project for specific kinds of tasks.
  - Before starting a task that one of the skills below covers, call load_skill with its name and follow its instructions.
  - A skill may point to reference files in its folder; read them with load_skill(name, file), not with read_file.
  - Do not load skills that are unrelated to the current task.

  - revisao-pr: Checklist de revisão de PR da equipe. Use ao revisar ou abrir um PR.
  - padroes-api: …
  ```

- **Descrições**: espaços e quebras de linha são colapsados em um espaço. Acima de 250 caracteres, o texto é cortado e ganha `…`.
- **Limites da lista**: no máximo 50 itens e 12 000 caracteres somando as linhas de item. O que não couber vira a linha final `- … mais N skills (use /skills para ver todas; load_skill aceita qualquer nome válido)`.
- **Estabilidade**: a seção é determinística, sem horário nem caminho absoluto. O mesmo catálogo gera o mesmo texto.
- **Sem skills, com `skills.enabled: false` ou com `--no-tools`**: o prompt é byte a byte igual ao atual. Um teste compara com o snapshot do `buildSystemPrompt` sem a opção.

## 3. Comando `/skills`

Ele emite um aviso `info`:

```text
Skills disponíveis (3):
  revisao-pr    projeto (.claude/skills)     Checklist de revisão de PR da equipe…
  padroes-api   projeto (.agents/skills)     Convenções de API REST…
  commit-msg    usuário (~/.claude/skills)   Mensagens de commit no padrão…

Sombreadas (1):
  revisao-pr    usuário (~/.claude/skills)   → vale projeto (.claude/skills)

Ignoradas (2):
  .claude/skills/rascunho/SKILL.md     sem description no cabeçalho
  .claude/skills/speckit-plan/SKILL.md comando do Spec Kit hospedado nativamente pelo Maestro
```

- Os caminhos de `ignored` são relativos ao cwd para o projeto e começam com `~/.claude/skills/…` para o usuário.
- As descrições são cortadas a 100 colunas.
- **Sem nada**: `Nenhuma skill encontrada em .claude/skills, .agents/skills ou ~/.claude/skills.`
- **Desligado**: `Skills desligadas (skills.enabled: false).` Com `--no-tools`, a mensagem é `Skills indisponíveis sem ferramentas (--no-tools).`
- **Disponibilidade**: o comando funciona na sessão interativa e em `-p "/skills"` (princípio II).
