# Contract: Interface de Linha de Comando

**Feature**: `001-maestro-cli-mvp` | **Binário**: `maestro`

## 1. Invocação

```text
maestro [options]                       # sessão interativa
maestro -p "<prompt>" [options]         # modo não interativo (US4)
echo "<prompt>" | maestro -p - [options] # prompt via stdin
```

| Opção | Tipo | Padrão | Efeito |
|---|---|---|---|
| `-p, --prompt <texto\|->` | string | — | Executa um único turno e encerra. `-` lê o prompt de stdin. |
| `--provider <id>` | `claude` \| `qwen` | `settings.activeProvider` | Provedor ativo para esta execução (FR‑017). Não altera o arquivo. |
| `--model <nome>` | string | modelo do provedor na config | Sobrescreve o modelo para esta execução. |
| `--config <caminho>` | path | `~/.maestro/settings.json` | Arquivo de configuração global alternativo. |
| `--no-tools` | flag | — | Desliga as ferramentas (US3) nesta execução. |
| `--no-color` | flag | auto | Desliga cores (também respeita `NO_COLOR`). |
| `--debug` | flag | — | Inclui `cause` nos erros e grava `~/.maestro/debug.log` (chaves mascaradas). |
| `-v, --version` | flag | — | Imprime a versão e sai com 0. |
| `-h, --help` | flag | — | Imprime ajuda e sai com 0. |

Argumentos posicionais não são aceitos nesta versão (erro de uso, código 2).

## 2. Códigos de saída

| Código | Significado |
|---|---|
| 0 | Sucesso (sessão encerrada normalmente ou turno `-p` concluído) |
| 1 | Erro do provedor em modo `-p` (auth, rede, limite, resposta inválida) |
| 2 | Erro de uso (argumento inválido) ou configuração inválida (`settings.json` com erro de schema) |
| 3 | Nenhum provedor utilizável (ativo não configurado e nenhum alternativo pronto) |
| 130 | Interrompido por Ctrl+C no modo `-p` |

## 3. Fluxos de saída

- **Interativo**: toda a UI em stdout (Ink). Erros aparecem na própria UI; nada em stderr exceto crash não tratado.
- **`-p`**: resposta do modelo em **stdout** (texto puro, sem cores quando não há TTY); progresso de ferramentas e erros em **stderr**. Ferramentas que exigem confirmação são **negadas automaticamente** em `-p` (sem TTY para perguntar) e o modelo recebe `tool_result` com `isError: true, output: "confirmation required; not available in non-interactive mode"`.

## 4. Primeira execução

Se `~/.maestro/settings.json` não existir:
1. Cria o diretório e o arquivo com o conteúdo de [config-schema.md § Exemplo gerado](./config-schema.md).
2. Imprime: caminho criado, estado dos provedores e o que falta em cada um.
3. Se nenhum provedor estiver configurado, encerra com código 3 após as instruções. Caso contrário, prossegue.

## 5. Pré‑voo (toda execução)

1. Carrega e valida configuração (código 2 em falha, com `campo: motivo`).
2. Calcula `ProviderStatus` de cada provedor.
3. Se o provedor ativo não está configurado:
   - imprime o que falta (ex.: `claude: no credentials — run 'ant auth login' or export ANTHROPIC_API_KEY`);
   - se houver outro provedor configurado, pergunta (interativo) ou usa‑o com aviso em stderr (`-p`);
   - senão, código 3.

## 6. Slash commands (sessão interativa)

Linhas iniciadas por `/` nunca são enviadas ao modelo.

| Comando | Argumentos | Comportamento |
|---|---|---|
| `/help` | — | Lista comandos e atalhos. |
| `/clear` | — | Esvazia o histórico; mantém provedor ativo. Rejeitado durante geração. |
| `/model` | — | Mostra provedor/modelo ativo e tabela de provedores: id, estado (`active` / `ready` / `not configured` / `disabled`), modelo, origem da credencial, chave mascarada. |
| `/model <id>` | `claude` \| `qwen` | Troca o provedor ativo, preservando histórico. Erros: id desconhecido; provedor desativado; provedor não configurado (mostra o que falta). Rejeitado durante geração. |
| `/model <id> <modelo>` | id + nome | Troca provedor e modelo para a sessão. |
| `/exit`, `/quit` | — | Encerra com código 0. |

Comando desconhecido → `Unknown command: /foo. Type /help.` sem chamar o modelo.

## 7. Atalhos de teclado

| Tecla | Estado | Efeito |
|---|---|---|
| Enter | idle | Envia a mensagem (vazia/só espaços: ignorada) |
| Esc | generating | Cancela a geração; conteúdo parcial permanece |
| Ctrl+C | generating | Igual a Esc |
| Ctrl+C | idle | 1ª vez: aviso "press Ctrl+C again to exit"; 2ª vez em 2 s: encerra |
| y / n | awaiting_confirmation | Aprova / recusa a ação de ferramenta |
| ↑ / ↓ | idle | Navega mensagens anteriores do usuário no prompt |

## 8. Comportamento sem TTY

Quando `!process.stdout.isTTY`: modo interativo é recusado com mensagem orientando `-p` (código 2). Quando `NO_COLOR` definido ou `--no-color`: saída sem sequências ANSI de cor.

## 9. Exemplos verificáveis (base para testes de contrato)

```bash
maestro --version                          # "maestro 0.1.0", exit 0
maestro -p "diga olá"                      # stdout: resposta; exit 0
DASHSCOPE_API_KEY=bad maestro -p "oi" --provider qwen   # stderr: "qwen: authentication failed (401) ..."; exit 1
maestro --provider foo                     # stderr: usage error; exit 2
maestro -p "oi" < /dev/null                # com ativo não configurado e sem alternativa: exit 3
```
