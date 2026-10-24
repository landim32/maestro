# Research: Maestro CLI (MVP)

**Feature**: `001-maestro-cli-mvp` | **Date**: 2026-10-24

Este documento resolve as incógnitas do Technical Context do plano e registra as decisões técnicas com justificativa e alternativas. As conclusões sobre o qwen code vêm da inspeção direta do repositório (`QwenLM/qwen-code` v0.26.1, clone raso feito em 2026-10-24). As conclusões sobre a API Claude vêm da referência oficial do SDK TypeScript carregada nesta sessão.

---

## R1. O que extrair do qwen code

**Decision**: Extrair apenas *conceitos e fluxos*, não código. Nada do repositório do qwen é copiado literalmente nesta feature.

**Rationale**: O qwen code v0.26.1 é um monorepo com 17 pacotes (`cli`, `core`, `acp-bridge`, `browser-use`, `channels/*`, `managed-agent-server`, `desktop`, `mobile-*`, `sdk-java` etc.), mais de 70 dependências de runtime no `core` (OpenTelemetry completo, MCP, tree-sitter, QuickJS, Google GenAI) e dezenas de slash commands. Trazer qualquer módulo "pronto" arrasta esse grafo inteiro e contradiz o requisito de "começar simples". Os conceitos a reaproveitar são:

| Conceito no qwen code | Onde está | O que o Maestro adota |
|---|---|---|
| Abstração `ContentGenerator` + `AuthType` por provedor | `packages/core/src/core/contentGenerator.ts`, `utils/auth-type.ts` | Interface `ModelProvider` própria, com registro por id (`claude`, `qwen`) |
| Provedor OpenAI‑compatible com perfil DashScope | `core/openaiContentGenerator/provider/dashscope.ts`, `constants.ts` | Provedor `qwen` usando o pacote `openai` apontado para a URL compatível do DashScope |
| Provedor Anthropic nativo | `core/anthropicContentGenerator/` | Provedor `claude` usando `@anthropic-ai/sdk` |
| UI de terminal em Ink/React, prompt + lista de mensagens + diálogo de confirmação | `packages/cli/src/ui/` | Mesma arquitetura, com 5–6 componentes apenas |
| Slash commands (`/help`, `/clear`, `/model`, `/exit`) | `packages/cli/src/ui/commands/` | Registro simples de comandos com `name`, `description`, `run` |
| Modo não interativo (`-p`) | `packages/cli/src/nonInteractiveCli.ts` | Entrada `maestro -p "..."` |
| Ferramentas básicas com confirmação | `packages/core/src/tools/{ls,read-file,write-file,shell}.ts` + `confirmation-bus` | 4 ferramentas: `read_file`, `list_directory`, `write_file`, `run_command`; confirmação obrigatória nas duas últimas |
| Config em `~/.qwen/settings.json` com sobrescrita por projeto | `packages/core/src/utils/paths.ts` (`QWEN_DIR = '.qwen'`) | `~/.maestro/settings.json` + `./.maestro/settings.json` |
| Streaming token a token com cancelamento por Esc/Ctrl+C | `cli/src/ui/hooks/` | `AbortController` propagado até o SDK |

**Alternatives considered**:
- *Fork do repositório e poda*: rejeitado; o esforço de remover 90% do código supera o de escrever os 10% necessários, e herdaria licença/cabeçalhos Google/Qwen em todo arquivo.
- *Depender de `@qwen-code/qwen-code-core` como pacote*: rejeitado; acopla o Maestro ao ciclo de releases e às dependências pesadas do qwen.

---

## R2. Linguagem, runtime e empacotamento

**Decision**: TypeScript 5.x sobre Node.js ≥ 22, ESM (`"type": "module"`), pacote único (não monorepo) com binário `maestro` declarado em `bin`. Build com `tsc` para `dist/`. Gerenciador: npm.

**Rationale**: É o stack do qwen code (Node ≥ 22, ESM, TypeScript), o que mantém a referência diretamente aplicável. Node 22 está instalado na máquina do usuário (v22.19.0, npm 11.6.3). Pacote único reduz atrito; a divisão `cli`/`core` do qwen é um passo futuro natural quando a orquestração de agentes chegar.

**Alternatives considered**: Monorepo com `packages/cli` + `packages/core` desde já (rejeitado por YAGNI); bundle com esbuild (adiado — `tsc` basta para o MVP, esbuild entra quando houver distribuição por `npx`).

---

## R3. Interface de terminal

**Decision**: Ink (React para terminal) com React 19, mesma abordagem do qwen code (que usa Ink 7). Componentes mínimos: `App`, `Header`, `MessageList`, `InputPrompt`, `ConfirmationDialog`, `StatusBar`. Degradação para texto simples quando `process.stdout.isTTY` for falso ou `NO_COLOR` estiver definido.

**Rationale**: Streaming incremental, re-render por estado, captura de teclas (Esc, Ctrl+C) e diálogos de confirmação são triviais em Ink e trabalhosos em `readline` puro. Mantém paridade conceitual com o qwen code para evoluções futuras (múltiplos painéis de agentes).

**Alternatives considered**: `readline` + `chalk` (mais simples, mas o diálogo de confirmação e o cancelamento mid-stream ficam frágeis); `blessed`/`terminal-kit` (menos mantidos, sem modelo declarativo).

---

## R4. Provedor Claude — "o Claude configurado na máquina"

**Decision**: O provedor `claude` usa `@anthropic-ai/sdk` com o construtor sem argumentos (`new Anthropic()`), que resolve credenciais nesta ordem: `ANTHROPIC_API_KEY` → `ANTHROPIC_AUTH_TOKEN` → perfil OAuth criado por `ant auth login` (armazenado em `~/.config/anthropic/` no Linux/macOS e `%APPDATA%\Anthropic` no Windows). A configuração do Maestro pode sobrescrever `apiKey`, `baseUrl` e `model`, mas por padrão não exige nada. Modelo padrão: `claude-opus-5-5`. Streaming via `client.messages.stream()` com `finalMessage()`. Parâmetro `thinking` omitido (adaptativo por padrão no Opus 5.5); `output_config.effort` configurável (padrão `medium`). Fallback de recusa do lado do servidor habilitado por padrão (`betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"`, via `client.beta.messages.stream`), desligável na configuração.

**Verificação na máquina do usuário (2026-10-24)**: não há `ANTHROPIC_API_KEY`, não há `ANTHROPIC_AUTH_TOKEN`, não há perfil `ant` em `%APPDATA%\Anthropic`, e a CLI `ant` não está instalada. Existe apenas o Claude Code 2.1.310 com seu próprio login. **O SDK não lê a credencial de login do Claude Code.** Logo, para o Maestro funcionar com Claude nesta máquina o usuário precisa, uma única vez, executar `ant auth login` (cria um perfil que o SDK e o Claude Code honram) **ou** exportar `ANTHROPIC_API_KEY`. O Maestro detecta a ausência e imprime exatamente essas duas opções.

**Rationale**: É o mecanismo oficial de reutilização de credenciais locais; não exige redigitar chave no Maestro (FR‑011) e cobre API key e OAuth. Evita manipular arquivos internos do Claude Code, que não são contrato público.

**Alternatives considered**:
- *Ler `~/.claude/.credentials.json` do Claude Code*: rejeitado; formato interno, não documentado, e tokens de assinatura são destinados ao Claude Code/Agent SDK.
- *Provedor via Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`)*: usa o login do Claude Code e traria ferramentas prontas, mas substitui todo o loop de ferramentas do Maestro pelo harness do Claude Code. Adiado: é candidato natural a um terceiro provedor (`claude-code`) quando o Maestro virar orquestrador.
- *Bedrock/Vertex/Foundry*: fora de escopo; o `baseUrl` configurável cobre proxies compatíveis.

---

## R5. Provedor Qwen (Alibaba Cloud)

**Decision**: O provedor `qwen` usa o pacote `openai` (cliente OpenAI‑compatible) apontado para o endpoint "compatible-mode" do DashScope. Padrões: `baseUrl = https://dashscope.aliyuncs.com/compatible-mode/v1` (China) com alternativa documentada `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` (internacional); `model = qwen3-coder-plus`. Chave via `apiKey` na configuração ou variável `DASHSCOPE_API_KEY`. Streaming via `chat.completions.create({ stream: true })`; ferramentas via `tools` no formato de function calling da API de chat.

**Rationale**: É exatamente o caminho que o qwen code usa para API key (`DEFAULT_DASHSCOPE_BASE_URL` em `openaiContentGenerator/constants.ts`, `AuthType.USE_OPENAI`); `qwen3-coder-plus` é o modelo de código referenciado no repositório. O usuário pediu URL + chave configuráveis, o que o cliente OpenAI‑compatible suporta nativamente.

**Alternatives considered**: SDK nativo DashScope (não há SDK oficial Node mantido); Qwen OAuth do qwen code (fora de escopo, exige fluxo de device-code proprietário); chamadas `fetch` manuais (reinventa parsing de SSE e retries que o pacote `openai` já faz).

---

## R6. Interface comum de provedores e loop de ferramentas

**Decision**: Interface `ModelProvider` própria do Maestro com um único método de streaming que recebe o histórico neutro (`Message[]`), as definições de ferramentas e um `AbortSignal`, e devolve um `AsyncIterable<ProviderEvent>` com eventos `text_delta`, `tool_call`, `usage`, `done`, `error`. Cada provedor converte o histórico neutro para o formato do seu SDK e vice‑versa. O loop de ferramentas (enviar → receber `tool_call` → confirmar → executar → anexar `tool_result` → reenviar) fica em `session/turn.ts`, independente de provedor.

**Rationale**: FR‑028 exige provedores plugáveis sem alterar o fluxo da sessão. Um loop manual (em vez do `toolRunner` beta do SDK Anthropic ou dos helpers do `openai`) é a única forma de ter o mesmo comportamento, as mesmas confirmações e a mesma troca de provedor no meio da conversa (FR‑015) para ambos.

**Alternatives considered**: `client.beta.messages.toolRunner` do SDK Anthropic (ótimo para um provedor só, mas o Qwen precisaria de um segundo loop com semântica diferente); Vercel AI SDK como camada unificadora (adiciona dependência grande e abstrai demais o controle de confirmação).

---

## R7. Configuração

**Decision**: Arquivo JSON `settings.json` em `~/.maestro/` (global) e `./.maestro/` (projeto, prevalece), validado com `zod`. Variáveis de ambiente prevalecem sobre os dois arquivos para segredos. Argumento `--provider` prevalece sobre tudo para a sessão. Primeira execução gera o arquivo global com os dois provedores e comentários explicativos em campo `_comment`. Chaves são mascaradas em qualquer saída (últimos 4 caracteres).

**Rationale**: Espelha `~/.qwen/settings.json` + sobrescrita de projeto; JSON é editável e validável; `zod` dá mensagens de erro com caminho do campo (FR‑014).

**Alternatives considered**: TOML/YAML (mais amigável a comentários, mas adiciona parser e foge do padrão do qwen code e do Claude Code); `.env` apenas (não comporta lista de provedores).

---

## R8. Ferramentas de contexto (US3) e sandbox

**Decision**: Quatro ferramentas com esquema JSON validado por `zod` antes da execução: `read_file`, `list_directory` (sem confirmação), `write_file`, `run_command` (com confirmação obrigatória e exibição prévia do diff/comando). Todo caminho é resolvido com `path.resolve` e rejeitado se sair de `process.cwd()`. `run_command` usa `child_process.spawn` com shell do sistema, timeout configurável e saída truncada a um limite de caracteres.

**Rationale**: FR‑021 a FR‑024; o input do modelo é não confiável, portanto validação de esquema + confinamento de caminho são obrigatórios.

**Alternatives considered**: Ferramentas `bash`/`text_editor` definidas pela Anthropic (sem esquema, não existem no Qwen; quebraria a neutralidade entre provedores).

---

## R9. Testes

**Decision**: `vitest` para unitários e de integração; provedores testados com clientes SDK mockados (sem rede); testes de contrato validam o `settings.json` de exemplo contra o schema e a tabela de comandos `/` contra o registro real. Testes de UI com `ink-testing-library` apenas para o `ConfirmationDialog` e o `InputPrompt`.

**Rationale**: É a ferramenta do qwen code, roda em ESM sem configuração extra e tem bom suporte a mocks de módulos.

---

## R10. Portabilidade Windows/macOS/Linux

**Decision**: Caminhos via `path`/`os.homedir()`; shell em `run_command` escolhido por plataforma (`cmd.exe`/`powershell` no Windows, `/bin/sh` nos demais); nenhuma dependência nativa (sem `sharp`, `tree-sitter`, `quickjs`). CI em matriz com os três SOs quando houver pipeline.

**Rationale**: FR‑027 e SC‑009; as dependências nativas do qwen code são a principal fonte de problemas de instalação cross‑platform.
