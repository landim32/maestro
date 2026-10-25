# Contract: Comandos `/auth` e `/model`

**Feature**: `003-auth-provider-setup`

## 1. `/auth` (apelidos `/connect`, `/login`)

| Contexto | Comportamento |
|---|---|
| Sessão interativa, estado `idle`, sem diálogo aberto | Abre o diálogo de autenticação no passo `menu`. |
| Estado `generating` ou `awaiting_confirmation` | Aviso `Aguarde a resposta terminar antes de usar /auth.`; nada abre. |
| Diálogo já aberto | Ignorado (as teclas pertencem ao diálogo). |
| Modo `-p` | Imprime em stdout: `Configuração interativa indisponível no modo -p. Edite ~/.maestro/settings.json ou use ANTHROPIC_API_KEY / DASHSCOPE_API_KEY.` e encerra com código 0. |
| Argumentos (`/auth qwen`) | Abre o diálogo já com o método correspondente selecionado (`claude-api`, `claude-login`, `qwen`); argumento desconhecido → aviso e abre no menu. |

## 2. `/model`

| Forma | Comportamento |
|---|---|
| `/model` (sem args, interativo, idle) | Abre o seletor de modelos (ModelDialog). |
| `/model <id>` | Comportamento atual: troca de provedor por texto, com validações e avisos existentes. **Novo**: também grava `activeProvider`. |
| `/model <id> <modelo>` | Comportamento atual + grava `activeProvider` e `providers.<id>.model`. |
| `/model` em `generating`/`awaiting_confirmation` | Aviso e nada abre (inalterado para a forma textual: também recusa). |
| `/model` em `-p` | Imprime a tabela textual atual (comportamento existente) e encerra com 0. |

## 3. `/help`

Passa a listar `/auth` com a descrição `Conectar um provedor de IA (Claude API, Claude Auth Login, Qwen)` e `/model` com `Mostrar/trocar o modelo ativo (abre um seletor sem argumentos)`.

## 4. Códigos de saída

Inalterados (contracts/cli.md da feature 001). Diálogos nunca alteram o código de saída da sessão interativa.

## 5. Testes derivados

- `/auth`, `/connect`, `/login` abrem o mesmo diálogo; `/auth qwen` abre com Qwen selecionado.
- `/auth` em `generating` → aviso, `controller.dialog === undefined`.
- `-p "/auth"` → stdout com a orientação, código 0, nenhum escape de tela.
- `/model` sem args → `controller.dialog?.type === 'model'`; `/model qwen` → troca sem diálogo e `settings.json` ganha `activeProvider: "qwen"`.
