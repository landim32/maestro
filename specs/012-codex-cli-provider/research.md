# Research: Provedor Codex

Tudo abaixo foi validado em 2026-10-25 com o Codex CLI 0.161.0 (`codex-cli 0.161.0`), logado com uma conta do ChatGPT, no Windows 11, chamando `codex exec` de verdade a partir de scripts de sondagem no scratchpad. Nenhum desses scripts entra no repositório.

## R1. Modo de execução

- **Decision**: `codex exec --json --ephemeral --skip-git-repo-check --ignore-user-config --ignore-rules -C <cwd> -s read-only [-m <modelo>] -c model_reasoning_effort=<esforço> … -`. O prompt vai pela entrada padrão (`-` no lugar do argumento).
- **Rationale**: `--json` escreve um evento JSON por linha em stdout. `--ephemeral` não grava a sessão em disco. `--ignore-user-config` ignora `~/.codex/config.toml`, e com ele os servidores MCP, perfis e plugins do usuário, mas o login continua valendo, porque a autenticação usa `CODEX_HOME`. `--ignore-rules` ignora as regras `.rules` do usuário e do projeto. `--skip-git-repo-check` permite pastas fora de um repositório git.
- **Alternatives considered**: `codex app-server` (JSON-RPC de longa duração com eventos mais finos). Foi rejeitado por ser experimental e por exigir um protocolo inteiro para um ganho de granularidade. `codex mcp` como servidor foi rejeitado porque inverte o papel: o Maestro teria de ser o cliente e não exporia as próprias ferramentas.

## R2. Eventos do `--json`

Linhas observadas:

| Evento | Uso |
|---|---|
| `{"type":"thread.started","thread_id":…}` | ignorado |
| `{"type":"turn.started"}` | ignorado |
| `{"type":"item.started"\|"item.updated","item":{…}}` | ignorado. As ferramentas chegam pela ponte. |
| `{"type":"item.completed","item":{"type":"agent_message","text":…}}` | vira `text_delta`. Um bloco por mensagem, separados por linha em branco. |
| `{"type":"item.completed","item":{"type":"reasoning",…}}` | ignorado (o Maestro não mostra raciocínio) |
| `{"type":"item.completed","item":{"type":"mcp_tool_call",…}}` | ignorado. O `runTool` já gravou a chamada e o resultado. |
| `{"type":"item.completed","item":{"type":"error","message":…}}` | aviso não fatal do Codex (por exemplo "Model metadata … not found"). Só vai para o log, sem conteúdo. |
| `{"type":"turn.completed","usage":{"input_tokens","cached_input_tokens","output_tokens","reasoning_output_tokens"}}` | vira `usage` e `done: end_turn` |
| `{"type":"error","message":…}` / `{"type":"turn.failed","error":{"message":…}}` | vira erro (R6). A mensagem costuma trazer o JSON da API com `status` e `code`. |

- **Decision**: o texto chega em blocos inteiros (`agent_message`), não letra a letra. A exibição em streaming do Maestro aceita isso sem mudança, como já previsto nas Assumptions da spec.
- **Alternatives considered**: `-o/--output-last-message` (arquivo com a última mensagem). Foi rejeitado porque perde as mensagens intermediárias e o uso de tokens.

## R3. Desligar as ferramentas próprias do Codex (FR-007)

Sondagens feitas:

1. Desligar `shell_tool`, `unified_exec`, `view_image`, `image_generation`, `multi_agent`, `multi_agent_v2`, `browser_use`, `computer_use`, `apps`, `plugins`, `skill_search`, `tool_suggest`, `sleep_tool`, `goals`, `hooks` e `memories`, além de `-c web_search=disabled`. Sobra a ferramenta `exec` do code mode.
2. Desligar também `code_mode_host` faz o `exec` falhar fechado ("code-mode host is disabled"). Quando o modelo tentou `echo oi > prova.txt` e ler `C:/Windows/win.ini`, nada aconteceu. Mas as ferramentas MCP também somem, porque nesta versão elas são expostas pelo host do code mode.
3. Com `code_mode_host` ligado, o shell desligado e a ponte MCP do Maestro, o modelo chama `read_file` da ponte (`item.*` do tipo `mcp_tool_call`). Pedido explicitamente para criar um arquivo ou ler fora da pasta "por qualquer outro meio (exec, JavaScript, fs, child_process, shell)", ele respondeu que não há ferramenta de execução de comandos ou shell, e nada foi criado.

- **Decision**: rodar com a lista de `--disable` do item 1 (sem `code_mode_host`), `-c web_search=disabled` e `-s read-only` como segunda barreira. Mesmo que algum caminho de execução sobre numa versão futura, o sandbox do próprio Codex impede escrita e rede. `-c approval_policy=never` faz qualquer pedido de escalonamento ser recusado sem esperar ninguém. A lista de flags fica numa constante (`CODEX_DISABLED_FEATURES`) com teste de contrato.
- **Versão mínima**: `0.161.0`, a única validada. `codex --version` é lido antes do primeiro turno do processo e cacheado. Uma versão menor faz o provedor recusar o turno com `invalid_config` e a mensagem "atualize o Codex (npm install -g @openai/codex)". Isso cumpre o caso de borda "versão sem recurso exigido". Flags desconhecidas em versões futuras não quebram, porque o `-c` desconhecido só gera um aviso (`item.type = error`, não fatal), e um `--disable` de feature removida é aceito.
- **Alternatives considered**: `--strict-config` foi rejeitado porque transforma em erro qualquer chave renomeada numa versão nova do Codex. `--dangerously-bypass-approvals-and-sandbox` foi rejeitado por razões óbvias.

## R4. Ferramentas do Maestro via ponte MCP

- **Decision**: reaproveitar `startMcpBridge` (specs/010) sem mudar o protocolo. A configuração vai por `-c`, sem arquivo:
  - `mcp_servers.maestro.url=<url da ponte>`
  - `mcp_servers.maestro.bearer_token_env_var=MAESTRO_MCP_TOKEN`. O token vai no ambiente do processo filho, nunca na linha de comando, para não aparecer na lista de processos.
  - `mcp_servers.maestro.default_tools_approval_mode=approve`. Sem isso, o Codex recusa a chamada com "MCP tool call requires approval, but approval policy is never" (observado). A decisão de aprovação é do Maestro.
  - `mcp_servers.maestro.tool_timeout_sec=86400`, porque uma confirmação pode esperar o usuário, como o `MCP_TOOL_TIMEOUT` do Claude Code.
  - `mcp_servers.maestro.required=true`, para que o Codex falhe se não conseguir abrir a ponte, em vez de seguir sem ferramentas.
- **Ids das chamadas**: o Codex não manda um id de chamada no `_meta` como o Claude Code (`claudecode/toolUseId`). A ponte já gera `mcp_<uuid>` nesse caso, e nada muda.
- **Nomes**: as ferramentas chegam ao modelo com o nome original (`read_file`), sem prefixo. O `toolNamingNote` do Claude Code não se aplica.
- **Alternatives considered**: `http_headers` com o token na linha de comando foi rejeitado porque aparece em `ps`. Um MCP stdio (o Codex iniciaria um processo do Maestro) foi rejeitado porque exigiria um segundo processo e IPC até a sessão em andamento.

## R5. Prompt de sistema

- **Decision**: gravar `system` (o prompt do Maestro, com o MAESTRO.md ou CLAUDE.md do projeto) num arquivo temporário `0600` e passar `-c model_instructions_file=<caminho>`. Isso substitui as instruções base do Codex: a resposta seguiu a regra do arquivo de teste. Também vai `-c project_doc_max_bytes=0`, para o Codex não anexar o `AGENTS.md` por conta própria, já que o contexto do projeto é responsabilidade do Maestro (`config/projectContext.ts`).
- **Alternatives considered**: `developer_instructions` foi rejeitado porque soma às instruções do Codex, que descrevem shell e `apply_patch`, ferramentas que estão desligadas.

### R5.1 Sandbox somente leitura não pode chegar ao modelo (achado do quickstart)

- **Observado** no teste real com `node dist/index.js -p`: com as instruções padrão do Codex, o modelo respondia "o acesso a arquivos está em modo somente leitura" e nem chamava o `write_file` do Maestro. O Codex descreve o sandbox ao modelo (`include_permissions_instructions`, `include_environment_context`).
- **Decision**: passar `-c include_permissions_instructions=false -c include_environment_context=false`. O sandbox `read-only` continua valendo para qualquer coisa do próprio Codex, mas o modelo deixa de achar que não pode agir. Com ferramentas no turno, o prompt ganha uma nota (`codexToolsNote`) dizendo que as ferramentas do Maestro são a forma de ler, escrever e executar, e que a aprovação é do Maestro. Depois disso, o modelo usou `write_file`, que no `auto-edit` gravou o arquivo e no `default` em `-p` foi recusado pelo Maestro.
- **Também observado**: com `code_mode_host` ligado, o `exec` do code mode é um sandbox JavaScript sem `process`, `fs`, `fetch`, `Deno` ou `Bun`. O modelo tentou usá-lo para criar um arquivo e não conseguiu.

## R6. Erros

| Situação | Detecção | Categoria |
|---|---|---|
| Executável ausente | `locate` sem resultado ou `ENOENT` | `invalid_config` + dica de instalação |
| Versão menor que a mínima | `codex --version` | `invalid_config` + dica de atualização |
| Não logado / 401 / 403 | mensagem com `status` 401/403, "Not logged in", "login" | `auth` + "faça login no Codex: `codex login`" |
| Limite de uso | `status` 429, `usage_limit_reached`, "usage limit", "rate limit" | `rate_limit`, com `retryAfterMs` de "try again in N s" ou "try again at <hora>" quando houver. Sem isso, vale o backoff do `runTurn`. |
| Modelo inválido | `code: model_not_found` (observado: "The 'x' model is not supported when using Codex with a ChatGPT account.") | `provider` com a mensagem interna da API, redigida |
| Processo sem `turn.completed` | fim do stdout | `provider` com a última linha útil do stderr, redigida |

- **Decision**: um parser puro (`codexStream.ts`) extrai o JSON embutido em `message` quando existir e mapeia pela tabela. A mensagem mostrada é o `error.message` interno, nunca o JSON bruto.

## R7. Executável no Windows

- **Decision**: `providers.codex.command`; senão `codex.exe` e depois `codex.cmd` no PATH (no Windows; fora dele, `codex`). O npm instala também um `codex` sem extensão, que é um script POSIX e não roda no Windows. Na primeira versão a busca o encontrava antes do `.cmd`, e `codex --version` falhava (achado do quickstart). O `codex.cmd` é executado por `cmd /c` com o `spawnSpec` existente. Para isso funcionar sem problemas de aspas no `cmd`, todos os valores de `-c` vão sem aspas TOML: o Codex usa o texto literal quando o valor não é TOML válido (`approval_policy=never`, URL, caminho). Validado por `cmd /c codex exec … -c approval_policy=never -c web_search=disabled`. O `killTree` existente (`taskkill /T`) encerra o `node` do shim e o `codex.exe` filho no Esc.
- **Alternatives considered**: resolver o `codex.exe` nativo dentro de `node_modules/@openai/codex-*/vendor` foi rejeitado porque depende da estrutura interna do pacote npm.

## R8. Ambiente do processo

- **Decision**: remover `OPENAI_API_KEY`, `CODEX_API_KEY` e `OPENAI_BASE_URL` do ambiente do filho e acrescentar `MAESTRO_MCP_TOKEN` (R4). Assim o Codex usa o login dele, e não uma chave que estivesse no ambiente do Maestro (FR-002).

## R9. `/auth` → Codex

- **Decision**: novo método `codex` (kind `login`), igual ao `claude-code`: localiza o executável, lê `codex --version` e `codex login status`, e nunca roda `codex login`. Saídas observadas no binário: "Logged in using ChatGPT", "Logged in using an API key - …", "Logged in using access token", "Not logged in". Só o método é extraído (`chatgpt` | `api-key` | `other`). O resto da linha nunca é exibido nem logado, porque a variante de chave inclui um trecho dela. ChatGPT habilita o provedor sem aviso, chave de API habilita com o aviso de que consome créditos da OpenAI, e "Not logged in" mostra como logar no Codex.

## R10. Modelos e esforço

- **Decision**: padrão `gpt-6-luna` (validado com `-m gpt-6-luna -c model_reasoning_effort=high`). Lista padrão `gpt-6-luna`, `gpt-5.6-terra`, `gpt-5.6-luna`: os modelos `list` do catálogo do Codex instalado nesta conta. O Maestro não lê esse catálogo em tempo de execução, porque é arquivo interno do Codex. A lista é editável e os modelos usados são aprendidos como nos outros provedores. Esforço padrão `medium`, repassado como `model_reasoning_effort`. Os cinco níveis do Maestro (`low`…`max`) existem no Codex. `maxTokens` é ignorado.
- **Observado**: `gpt-6-sol` existe no binário, mas a conta ChatGPT recusa com `model_not_found`. Por isso não entra na lista padrão.

## R11. Histórico e imagens

- **Decision**: reaproveitar `renderHistory` do `claudeCodeStream.ts`. O prompt na entrada padrão é o bloco `<conversation_history>` com as mensagens anteriores, seguido do texto da última mensagem do usuário. As imagens da última mensagem são gravadas em arquivos temporários na pasta do turno e passadas por `-i <arquivo>`, e `capabilities.images` fica `true`. Imagens de mensagens anteriores entram só como marcador no histórico, como no `claude-code`.

## R12. Laço de ferramentas e limites

- **Decision**: `capabilities.executesTools = true`. O `runTurn` usa o caminho conduzido pelo provedor já existente: `runTool` passa por `executeTool`, sem limite de rodadas por padrão e com espera e reenvio no `rate_limit` (FR-011). Nenhuma mudança em `session/turn.ts`.
