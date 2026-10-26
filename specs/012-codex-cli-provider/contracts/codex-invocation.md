# Contract: invocação do Codex

`buildCodexArgs(o)` é puro. Os testes de contrato fixam cada item desta lista.

## Argumentos (ordem fixa)

```text
exec --json --ephemeral --skip-git-repo-check --ignore-user-config --ignore-rules
-C <cwd>
-s read-only
-c approval_policy=never
-c web_search=disabled
-c project_doc_max_bytes=0
-c include_permissions_instructions=false
-c include_environment_context=false
-c model_instructions_file=<dir>/instructions.md
--disable <f>   para cada f em CODEX_DISABLED_FEATURES
[-m <modelo>]
[-c model_reasoning_effort=<esforço>]
[-i <dir>/image-N.<ext>]...                          (imagens da última mensagem)
[-c mcp_servers.maestro.url=<url>                    (só com ferramentas)
 -c mcp_servers.maestro.bearer_token_env_var=MAESTRO_MCP_TOKEN
 -c mcp_servers.maestro.default_tools_approval_mode=approve
 -c mcp_servers.maestro.tool_timeout_sec=86400
 -c mcp_servers.maestro.required=true]
-
```

`CODEX_DISABLED_FEATURES` = `shell_tool`, `unified_exec`, `view_image`, `image_generation`, `multi_agent`, `multi_agent_v2`, `browser_use`, `computer_use`, `apps`, `plugins`, `skill_search`, `tool_suggest`, `sleep_tool`, `goals`, `hooks`, `memories`.

Invariantes testadas:

1. Nenhum argumento contém o token da ponte.
2. Nenhum valor de `-c` contém aspas (`"` ou `'`), para passar intacto pelo `cmd /c` (R7).
3. `-s read-only` e `approval_policy=never` estão sempre presentes. `--dangerously-bypass-approvals-and-sandbox`, `--full-auto` e `danger-full-access` nunca aparecem.
4. Sem ferramentas (`--no-tools` sem `ask_user`, ou sem `runTool`), nenhum `mcp_servers.*` é passado.
5. O último argumento é `-`, porque o prompt vem da entrada padrão.

## Instruções (`instructions.md`)

`req.system` mais, quando há ferramentas no turno, `codexToolsNote(nomes)`: as ferramentas são do Maestro, são a forma de agir na pasta, e a aprovação é dele (research R5.1).

## Ambiente do filho (`childEnvCodex(env, token?)`)

- copia `env`
- remove `OPENAI_API_KEY`, `CODEX_API_KEY` e `OPENAI_BASE_URL`
- define `MAESTRO_MCP_TOKEN=<token>` só quando há ponte

## Entrada padrão (`buildPrompt(messages)`)

```text
<conversation_history>
…renderHistory(mensagens anteriores à última do usuário)…
</conversation_history>

<texto da última mensagem do usuário>
```

Sem mensagens anteriores, só o texto. A entrada padrão é fechada logo depois da escrita.

## Processo

- `cwd = process.cwd()`, `windowsHide: true`, `stdio: pipe`
- Windows + `.cmd`/`.bat` → `cmd /c` com `spawnSpec`
- Esc → `killTree(child)`. A ponte e a pasta temporária são fechadas e apagadas no `finally`.

## Versão (`parseVersion`)

`codex-cli 0.161.0` → `0.161.0`. Uma versão menor que `MIN_CODEX_VERSION` ou ilegível faz o turno terminar com `MaestroError{category:'invalid_config'}`, sem iniciar o `exec`.
