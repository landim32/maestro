# Implementation Plan: Maestro CLI – Assistente de IA no Terminal (MVP)

**Branch**: `001-maestro-cli-mvp` | **Date**: 2026-10-24 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-maestro-cli-mvp/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Construir o **Maestro**, uma CLI de console em TypeScript/Node.js que abre uma sessão interativa de chat com um modelo de IA, mantém o histórico da conversa, exibe respostas por streaming e permite trocar entre provedores configurados (inicialmente **Claude**, reutilizando credenciais já presentes na máquina via `@anthropic-ai/sdk`, e **Qwen/Alibaba Cloud**, via endpoint OpenAI‑compatible do DashScope com URL e chave informadas). A arquitetura segue os conceitos do qwen code (abstração de provedor, UI em Ink, slash commands, ferramentas com confirmação, config global + projeto), mas sem copiar código: pacote único, quatro ferramentas, quatro comandos `/`, dois provedores. Tudo o que não é necessário para as histórias P1–P4 fica fora (ver [research.md](./research.md) R1).

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js ≥ 22 (ESM). Node 22.19.0 / npm 11.6.3 confirmados na máquina de desenvolvimento.  
**Primary Dependencies**: `@anthropic-ai/sdk` (provedor Claude), `openai` (provedor Qwen via DashScope compatible‑mode), `ink` + `react` (UI de terminal), `yargs` (argumentos), `zod` (validação de config e de inputs de ferramentas), `chalk` (cores fora do Ink, ex.: modo não interativo).  
**Storage**: Arquivos JSON de configuração em `~/.maestro/settings.json` (global) e `./.maestro/settings.json` (projeto). Histórico da conversa apenas em memória.  
**Testing**: `vitest` (unit, integration, contract) + `ink-testing-library` para componentes críticos. SDKs mockados; nenhum teste automatizado acessa rede.  
**Target Platform**: Terminal em Windows 11, macOS e Linux. Degrada para texto simples sem TTY/cores.  
**Project Type**: CLI (pacote npm único com binário `maestro`).  
**Performance Goals**: Prompt visível em < 2 s após `maestro`; primeiro token em tela ≤ 3 s em 95% das interações (latência de rede/provedor à parte); troca de provedor < 1 s (SC‑003, SC‑004, SC‑008).  
**Constraints**: Nenhuma dependência nativa (portabilidade); chaves nunca em texto claro em saída/logs; nenhum acesso a caminho fora de `cwd`; ações de escrita/execução sempre confirmadas; sem telemetria.  
**Scale/Scope**: 1 usuário local por sessão; 2 provedores; 4 ferramentas; 4 slash commands; ~25–35 arquivos de código‑fonte; histórico limitado pelo contexto do modelo (aviso ao usuário, sem compactação automática nesta versão).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Estado da constituição**: `.specify/memory/constitution.md` ainda é o template não ratificado (todos os placeholders presentes). Não há princípios formais para avaliar. Para não bloquear o planejamento, os gates abaixo aplicam os princípios *padrão* sugeridos pelo template e devem ser revisados assim que `/speckit.constitution` for executado.

| Gate (princípio padrão) | Avaliação pré‑Phase 0 | Avaliação pós‑Phase 1 |
|---|---|---|
| **Simplicidade / YAGNI**: só o necessário para as histórias P1–P4 | PASS — pacote único, 2 provedores, 4 ferramentas, 4 comandos; sem MCP, telemetria, extensões | PASS — estrutura em `src/` com 7 módulos; nenhuma abstração sem segundo uso concreto (exceto `ModelProvider`, exigida por FR‑028) |
| **Interface CLI com texto I/O**: stdin/args → stdout, erros → stderr, códigos de saída | PASS — modo `-p` imprime resposta em stdout, erros em stderr, exit code ≠ 0 em falha | PASS — contrato em [contracts/cli.md](./contracts/cli.md) |
| **Testabilidade**: lógica central testável sem rede nem terminal real | PASS — provedores atrás de interface; sessão e ferramentas puras | PASS — SDKs mockados; `ink-testing-library` só para 2 componentes |
| **Segurança de credenciais**: segredos nunca expostos | PASS — mascaramento + env vars | PASS — `utils/mask.ts` aplicado em `/model`, logs e erros |
| **Observabilidade mínima**: erros compreensíveis | PASS — FR‑006 mapeia erros tipados dos SDKs para mensagens com provedor + causa | PASS — `utils/errors.ts` |

**Violações a justificar**: nenhuma. A seção *Complexity Tracking* fica vazia.

## Project Structure

### Documentation (this feature)

```text
specs/001-maestro-cli-mvp/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
│   ├── cli.md           # argumentos, códigos de saída, slash commands
│   ├── config-schema.md # settings.json, variáveis de ambiente, precedência
│   └── provider-interface.md # interface ModelProvider, eventos, ferramentas
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
package.json             # name: maestro, bin: { maestro: dist/index.js }, type: module
tsconfig.json
vitest.config.ts
.maestro/                # (opcional) settings.json de projeto, ignorado no git por padrão

src/
├── index.ts             # #!/usr/bin/env node — parse args e despacha interativo/não interativo
├── cli/
│   ├── args.ts          # yargs: --provider, --model, -p/--prompt, --config, --no-color, --version
│   ├── interactive.ts   # monta Session + renderiza ui/App
│   └── nonInteractive.ts# modo -p: executa um turno, imprime stdout, exit code
├── config/
│   ├── paths.ts         # ~/.maestro, ./.maestro, resolução cross-platform
│   ├── schema.ts        # zod: Settings, ProviderSettings (claude | qwen)
│   ├── defaults.ts      # conteúdo do settings.json inicial
│   └── loader.ts        # merge global → projeto → env → args; validação; erros com caminho do campo
├── providers/
│   ├── types.ts         # ModelProvider, ProviderEvent, ProviderStatus, Message neutro
│   ├── registry.ts      # cria provedores a partir da config; lista estados (ativo/configurado/não configurado)
│   ├── claude.ts        # @anthropic-ai/sdk: new Anthropic() + overrides; stream; conversão de mensagens/ferramentas
│   └── qwen.ts          # openai: baseURL DashScope; chat.completions stream; conversão
├── session/
│   ├── session.ts       # histórico, provedor ativo, estado (idle | generating | awaiting_confirmation)
│   ├── turn.ts          # loop de um turno: stream → tool_call → confirmação → execução → reenvio
│   └── commands.ts      # /help, /clear, /model [id], /exit
├── tools/
│   ├── types.ts         # ToolDefinition (nome, descrição, schema zod, requiresConfirmation, run)
│   ├── registry.ts
│   ├── sandbox.ts       # resolve e confina caminhos a cwd
│   ├── readFile.ts
│   ├── listDirectory.ts
│   ├── writeFile.ts     # exibe diff antes da confirmação
│   └── runCommand.ts    # spawn com shell por plataforma, timeout, truncamento
├── ui/
│   ├── App.tsx
│   ├── components/
│   │   ├── Header.tsx           # nome, provedor/modelo ativo, cwd
│   │   ├── MessageList.tsx      # histórico + resposta em streaming
│   │   ├── InputPrompt.tsx      # entrada, histórico de comandos, Esc para cancelar
│   │   ├── ConfirmationDialog.tsx # sim/não para write_file e run_command
│   │   └── StatusBar.tsx        # estado da sessão, atalhos
│   └── hooks/
│       ├── useSession.ts        # liga Session ao estado React
│       └── useKeyboard.ts       # Esc, Ctrl+C duplo
└── utils/
    ├── mask.ts          # mascara chaves (últimos 4 chars)
    ├── errors.ts        # mapeia erros dos SDKs → MaestroError { provider, cause, hint }
    └── tty.ts           # detecção de TTY/NO_COLOR

tests/
├── unit/                # config/loader, utils/mask, tools/sandbox, session/commands, providers/* (mock SDK)
├── integration/         # session/turn com provedor fake; modo -p ponta a ponta com provedor fake
└── contract/            # settings.json de exemplo vs schema; tabela de comandos vs registro; interface de provedor
```

**Structure Decision**: Pacote único (`src/` + `tests/`) porque o MVP tem um único artefato distribuível (o binário `maestro`). A separação em módulos `providers/`, `session/`, `tools/` e `ui/` reproduz a fronteira `core`/`cli` do qwen code sem o custo de um monorepo; quando a orquestração de agentes chegar, `providers/`, `session/` e `tools/` podem ser extraídos para um pacote `core` sem reescrita.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

Nenhuma violação. Tabela intencionalmente vazia.

## Phase 0 — Research (concluída)

Saída: [research.md](./research.md). Todas as incógnitas do Technical Context foram resolvidas; não resta nenhum `NEEDS CLARIFICATION`. Decisões‑chave:

- **R1** Extrair do qwen code apenas conceitos (tabela de mapeamento), nenhum código.
- **R4** Provedor Claude via `new Anthropic()` (resolve `ANTHROPIC_API_KEY` → `ANTHROPIC_AUTH_TOKEN` → perfil `ant auth login`). Nesta máquina só existe o login do Claude Code, que o SDK não lê; o usuário precisará de `ant auth login` ou de `ANTHROPIC_API_KEY` uma única vez.
- **R5** Provedor Qwen via pacote `openai` apontado para `https://dashscope.aliyuncs.com/compatible-mode/v1`, modelo `qwen3-coder-plus`, chave em `DASHSCOPE_API_KEY` ou na config.
- **R6** Interface `ModelProvider` neutra + loop de ferramentas único em `session/turn.ts`.

## Phase 1 — Design (concluída)

Saídas:
- [data-model.md](./data-model.md) — entidades, campos, validações e máquina de estados da sessão.
- [contracts/cli.md](./contracts/cli.md) — argumentos, códigos de saída, slash commands, comportamento sem TTY.
- [contracts/config-schema.md](./contracts/config-schema.md) — `settings.json` (JSON Schema + exemplo), variáveis de ambiente, precedência.
- [contracts/provider-interface.md](./contracts/provider-interface.md) — `ModelProvider`, `ProviderEvent`, `ToolDefinition`, regras de conversão por provedor.
- [quickstart.md](./quickstart.md) — instalar, configurar os dois provedores, rodar, testar.
- `CLAUDE.md` na raiz — contexto do agente atualizado pelo script `update-agent-context.ps1`.

## Phase 2 — Próximo passo

`/speckit.tasks` gera `tasks.md` a partir destes artefatos. Ordem sugerida de entrega: fundação (package, config, provedor fake, sessão) → US1 (chat com um provedor) → US2 (dois provedores, `/model`) → US4 (modo `-p`, barato e útil para testes) → US3 (ferramentas com confirmação).

## Riscos e pontos de atenção

| Risco | Mitigação |
|---|---|
| Usuário espera que o login do Claude Code "simplesmente funcione" no Maestro | Mensagem de pré‑voo clara com as duas opções (`ant auth login` / `ANTHROPIC_API_KEY`); registrar em research R4; candidato futuro a provedor `claude-code` via Agent SDK |
| Diferenças de function calling entre Anthropic e DashScope (formato de `tool_result`, ids, argumentos como string JSON) | Conversão isolada em cada provedor; testes de contrato com fixtures de ambos os formatos |
| Ink em terminais Windows legados (cmd.exe) | Testar em Windows Terminal e cmd; fallback de texto simples quando não houver TTY |
| Histórico excede contexto do modelo | Detectar erro de contexto dos SDKs e sugerir `/clear`; compactação fica para feature futura |
