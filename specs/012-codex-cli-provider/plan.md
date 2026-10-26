# Implementation Plan: Provedor Codex (assinatura do ChatGPT pelo Codex CLI instalado)

**Branch**: `012-codex-cli-provider` | **Date**: 2026-10-25 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/012-codex-cli-provider/spec.md`

## Summary

O provedor novo `codex` executa o binário `codex` do usuário no modo não interativo (`codex exec --json`, prompt pela entrada padrão), espelhando o `claude-code` (specs/010).

- **Ferramentas próprias desligadas**: o Codex roda com shell, `unified_exec`, imagens, navegador, plugins, subagentes e busca na web desligados por `--disable`, com sandbox `read-only` e `approval_policy=never` como segunda barreira, e sem a configuração, as regras e a sessão persistida do usuário.
- **Ferramentas do Maestro**: chegam ao Codex pela mesma ponte MCP de um turno (`startMcpBridge`), configurada por `-c mcp_servers.maestro.*`. O token vai por variável de ambiente e as chamadas são aprovadas automaticamente pelo Codex, porque a decisão é do Maestro (`executeTool`).
- **Eventos**: um parser puro converte os eventos JSONL (`agent_message`, `turn.completed`, `turn.failed`, `error`) em `ProviderEvent`, com o limite de uso mapeado para `rate_limit`.
- **`/auth`**: ganha o método "Codex", que lê `codex --version` e `codex login status` sem nunca iniciar um login.

Tudo foi validado com o Codex 0.161.0 logado pelo ChatGPT (research.md).

## Technical Context

**Language/Version**: TypeScript 5.9, Node.js ≥ 22 (ESM), mesmo stack.
**Primary Dependencies**: existentes. `node:child_process` (`spawn` do `codex`, `execFile` para versão e login), `node:readline`, `node:fs` (pasta temporária do turno: instruções e imagens) e a ponte MCP de specs/010. Nenhuma nova.
**Storage**: `settings.json` ganha `providers.codex` (`enabled`, `model`, `models`, `effort`, `command?`). Nada mais é persistido. O Codex roda com `--ephemeral`, e os arquivos temporários do turno são apagados no `finally`.
**Testing**: vitest. O `spawn`, o `locate`, o `execFile` e a ponte são injetáveis. `tests/helpers/fakeCodex.ts` emite o JSONL observado (R2) e chama a ponte de verdade por HTTP em 127.0.0.1, como o `fakeClaudeCode`. O parser e os argumentos são testados como funções puras. Nenhum teste chama o `codex` real.
**Target Platform**: Windows, macOS e Linux. No Windows, o shim `codex.cmd` do npm roda por `cmd /c`, e os valores de `-c` vão sem aspas (R7).
**Project Type**: CLI única, sem mudança de estrutura.
**Performance Goals**: primeiro texto em até 10 s (SC-002). O custo é o de iniciar o Codex, cerca de 0,3 s até `turn.started` nas sondagens, mais o modelo.
**Constraints**:
- nenhum acesso a credenciais do ChatGPT ou da OpenAI, e `OPENAI_API_KEY`/`CODEX_API_KEY` são removidas do ambiente do filho;
- o histórico vai pela entrada padrão;
- a ponte só escuta em loopback;
- nenhuma ferramenta própria do Codex fica ativa.
**Scale/Scope**: um provedor a mais. São cerca de 5 arquivos novos e uma dúzia de pontos de integração já existentes para o `claude-code`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Simplicidade**: reaproveita a ponte MCP, o caminho conduzido pelo provedor, `renderHistory`, `killTree`, `findExecutable` e o fluxo `login.*` do `/auth`. Os únicos módulos novos são o parser e os argumentos do Codex, o provedor e o helper de `/auth`. `spawnSpec` sai de `claudeCode.ts` para `utils/process.ts`, porque passa a ter dois usuários. Nenhuma dependência nova. O `app-server` do Codex foi rejeitado (R1). Passa.
- **II. CLI texto**: `-p` funciona como nos outros provedores, e as confirmações são recusadas em `-p`. Passa.
- **III. Testabilidade**: argumentos, parser e mapeamento de erros são puros. Os processos são injetáveis, e o Codex falso usa a ponte real. Há testes de contrato para as flags de isolamento (`CODEX_DISABLED_FEATURES`, `read-only`, `approval_policy=never`, a ausência do token na linha de comando) e para os eventos. Passa.
- **IV. Credenciais**:
  - o Maestro não lê `~/.codex/auth.json` nem nada em `CODEX_HOME`;
  - de `codex login status` só se extrai o método, porque a variante de chave traz um trecho da chave;
  - o token da ponte não vai na linha de comando;
  - `noSecrets.codex.test.ts` cobre a saída do `/auth`, o log e os argumentos.

  Passa.
- **V. Observabilidade**: `codex.start` (modelo, número de ferramentas), `codex.warning` (só a contagem), `codex.exit` (código, cancelado, concluído) e `codex.version`, sem conteúdo. Passa.
- **VI–VII. Open source e atribuição**: código escrito do zero. Nenhum código do Codex (Apache-2.0) é copiado, e só a interface de linha de comando dele é usada. Passa.

**Re-check pós-design**: sem violações, e o Complexity Tracking fica vazio.

## Project Structure

### Documentation (this feature)

```text
specs/012-codex-cli-provider/
├── spec.md
├── plan.md              # este arquivo
├── research.md          # R1–R12, validados com o Codex 0.161.0
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── codex-invocation.md   # argumentos, ambiente, stdin
│   ├── codex-events.md       # JSONL → ProviderEvent / MaestroError
│   └── settings.md           # providers.codex
└── checklists/requirements.md
```

### Source Code (repository root)

```text
src/providers/codexStream.ts      # NOVO, puro: buildCodexArgs, childEnvCodex, buildPrompt, parseCodexLine, codexError, parseVersion
src/providers/codex.ts            # NOVO: provedor (spawn, ponte, pasta temporária, cancelamento, versão mínima)
src/setup/codexCli.ts             # NOVO: locate, readVersion, readLoginStatus (só o método)
src/utils/process.ts              # spawnSpec (movido de claudeCode.ts), locateCli(command, names)
src/providers/claudeCode.ts       # passa a importar spawnSpec de utils/process
src/providers/index.ts            # registerProvider('codex', …)
src/providers/status.ts           # DISPLAY_NAMES, CREDENTIAL_HINTS, descrição "assinatura do ChatGPT"
src/config/schema.ts              # PROVIDER_IDS += 'codex', codexProviderSchema
src/config/defaults.ts            # DEFAULTS.codex + INITIAL_SETTINGS.providers.codex
src/config/loader.ts              # credentials.codex = 'cli' quando habilitado e localizado
src/config/models.ts              # catálogo padrão do codex
src/setup/methods.ts, src/setup/driver.ts, src/ui/dialogs/AuthDialog.tsx, src/session/commands.ts  # /auth → Codex
README.md, CLAUDE.md

tests/helpers/fakeCodex.ts
tests/unit/providers/codexStream.test.ts
tests/unit/setup/codexCli.test.ts
tests/contract/codex-invocation.test.ts
tests/integration/providers/codex.test.ts          # streaming, ferramentas pela ponte, cancelamento, erros, rate limit
tests/integration/ui/auth.codex.test.tsx
tests/unit/security/noSecrets.codex.test.ts
```

**Structure Decision**: projeto único, com os mesmos diretórios. O provedor fica isolado em `src/providers/codex*.ts`, como pede a fronteira de provedores. Ele não importa SDK nenhum.

## Complexity Tracking

Nenhuma violação a justificar.
