# Implementation Plan: Provedor Claude Code

**Branch**: `010-claude-code-provider` | **Date**: 2026-10-25 | **Spec**: [spec.md](./spec.md)

## Summary

Novo provedor `claude-code` que executa o binário `claude` do usuário no modo não interativo (`-p`, entrada e saída `stream-json`). O Claude Code roda sem ferramentas próprias. As ferramentas do Maestro são expostas por um servidor MCP HTTP mínimo, de um turno, em 127.0.0.1 com token aleatório. Cada chamada que chega ao servidor passa pelo mesmo `executeTool` do `runTurn`, com interceptação do Spec Kit, política de aprovação e confirmação. O provedor `claude` não muda, mas os rótulos e o erro de saldo passam a avisar que ele consome créditos de API.

## Technical Context

**Language/Version**: TypeScript 5.9, Node.js ≥ 22 (ESM), mesmo stack.
**Primary Dependencies**: existentes. `node:child_process` (`spawn` do `claude`), `node:http` (servidor MCP), `node:crypto` (token), `zod` 4 (`z.toJSONSchema` para os esquemas das ferramentas). Nenhuma nova.
**Storage**: `settings.json` ganha `providers.claude-code` (`enabled`, `model`, `models`, `effort`, `command?`). Nada mais persistido. O Claude Code roda com `--no-session-persistence`.
**Testing**: vitest. O `spawn` é injetável e um Claude Code falso emite o fluxo JSON. O servidor MCP é testado por HTTP real em 127.0.0.1. Nenhum teste chama o `claude` de verdade.
**Constraints**: nenhum acesso a credenciais do claude.ai. O histórico vai pelo stdin. O servidor só escuta em loopback.

## Constitution Check

- **I. Simplicidade**: um provedor, um servidor MCP mínimo (só `initialize`, `tools/list`, `tools/call`, `ping`) e nenhuma dependência nova. Passa.
- **II. CLI texto**: `-p` funciona igual aos outros provedores. Passa.
- **III. Testabilidade**: `spawn` e localização do executável são injetáveis, e o parser do fluxo é puro. Passa.
- **IV. Credenciais**: o Maestro não toca nas credenciais do Claude Code. O e-mail do `claude auth status` é exibido só mascarado e nunca vai para o log. Passa.
- **V. Observabilidade**: o log registra `claudecode.start`, `claudecode.exit`, `claudecode.tool`, sem conteúdo. Passa.
- **VI–VII. Open source e atribuição**: código escrito do zero e nenhum código de terceiros. Passa.

## Decisões (research)

- **R1. Modo de execução**: `claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages`. O texto chega em `stream_event` com `content_block_delta`/`text_delta`. O fim chega em `{"type":"result"}` com `is_error`, `api_error_status`, `result` e `usage`. Validado com o Claude Code 2.1.310.
- **R2. Isolamento**: `--tools ""` desliga as ferramentas próprias, `--strict-mcp-config` ignora os servidores MCP do usuário, `--disable-slash-commands` desliga comandos e skills e `--no-session-persistence` não grava a sessão. `--system-prompt` substitui o prompt padrão pelo do Maestro. `--safe-mode` foi descartado porque também desliga o MCP passado por `--mcp-config` (validado). `--bare` foi descartado porque não lê o OAuth.
- **R3. Ferramentas via MCP HTTP**: o Claude Code chamou um servidor `{"type":"http","url":…,"headers":{"Authorization":"Bearer …"}}` passado em `--mcp-config` e usou o resultado (validado). Os nomes chegam ao modelo como `mcp__maestro__<ferramenta>`. `--allowedTools mcp__maestro__*` evita que o próprio Claude Code peça permissão, já que a decisão é do Maestro. `--permission-prompts none` garante que nada fique esperando um host. `MCP_TOOL_TIMEOUT` é ampliado no ambiente do processo, porque uma confirmação pode esperar o usuário.
- **R4. Laço de ferramentas**: o laço roda dentro do Claude Code. O provedor declara `capabilities.executesTools` e recebe `ProviderRequest.runTool`. O `runTurn` fornece `runTool`: ele grava o texto acumulado mais o `tool_call` como mensagem do assistente, executa `executeTool` e grava o `tool_result`. Assim o histórico fica igual ao dos outros provedores.
- **R5. Histórico**: o Claude Code não aceita mensagens de assistente injetadas. As mensagens anteriores à última do usuário vão num bloco `<conversation_history>` em texto, com papéis, chamadas e resultados resumidos. A última mensagem do usuário vai com os blocos originais, incluindo imagens.
- **R6. Erros**: `result.is_error` mais `api_error_status` são mapeados assim: 401/403 vira `auth` com a dica de logar no Claude Code, 429 vira `rate_limit` e o resto vira `provider`. Executável ausente vira `invalid_config`. Saída sem `result` vira `provider` com a última linha do stderr, redigida.
- **R7. Executável**: `providers.claude-code.command`, senão `claude` no PATH. No Windows a preferência é `claude.exe`. Arquivos `.cmd`/`.bat` são executados por `cmd /c`.
- **R8. `/auth`**: o método `claude-code` (kind `login`) reaproveita os passos `login.*` do reducer. O driver só localiza o executável e lê `claude auth status` (JSON). Ele não executa `claude auth login` em momento algum.
- **R9. Erro de saldo**: um `BadRequestError` cuja mensagem bate com `credit balance` vira categoria `billing`, com mensagem e dica em português.

## Project Structure

```text
src/providers/claudeCode.ts        # provedor: spawn, stream-json → ProviderEvent, erros
src/providers/claudeCodeStream.ts  # puro: args, serialização do histórico, parser de linhas
src/providers/mcpBridge.ts         # servidor MCP HTTP de um turno (loopback + token)
src/setup/claudeCodeCli.ts         # localizar o executável e ler `claude auth status`
src/session/turn.ts                # caminho de ferramentas executadas pelo provedor
src/config/{schema,defaults,loader}.ts, src/providers/{status,types,index}.ts
src/setup/{methods,driver}.ts, src/ui/dialogs/AuthDialog.tsx
src/utils/errors.ts, src/providers/anthropicProtocol.ts   # categoria billing
```
