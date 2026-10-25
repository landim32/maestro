# maestro

Assistente de IA para o terminal com suporte a múltiplos modelos. Hoje é um chat de linha de comando no estilo do Claude Code e do qwen code, com ferramentas básicas de workspace. Amanhã será um orquestrador de agentes; a arquitetura de provedores plugáveis já foi desenhada para isso.

- Provedores: **Claude** (Anthropic) e **Qwen** (Alibaba Cloud DashScope). Ative e configure cada um em `settings.json`.
- Sessão interativa com streaming, histórico de conversa, troca de provedor a quente (`/model`), cancelamento com Esc.
- Ferramentas: ler arquivos, listar diretórios, escrever arquivos e executar comandos, sempre confinadas à pasta atual. Quatro modos de aprovação (Tab alterna) decidem o que pede sua confirmação; `ask_user` deixa o modelo fazer perguntas de múltipla escolha.
- Modo não interativo (`maestro -p "..."`) para scripts.
- Software livre (MIT), e assim continuará. Partes adaptadas do [qwen-code](https://github.com/QwenLM/qwen-code); veja [Créditos](#créditos).

## Requisitos

- Node.js ≥ 22
- Credenciais de pelo menos um provedor (abaixo)

## Instalação

```bash
git clone <repo> maestro && cd maestro
npm install
npm run build
npm link          # disponibiliza o comando `maestro`
```

## Credenciais

**Pelo próprio Maestro.** Dentro da sessão, digite `/auth` (ou `/connect`, `/login`): um diálogo lista **Claude API** (chave), **Claude Auth Login** (login no navegador pela CLI `ant`) e **Qwen** (DashScope), pede os campos, testa a conexão e grava em `settings.json`. É o caminho recomendado; o resto desta seção descreve a configuração manual equivalente.

**Claude.** O Maestro reutiliza o que já existir na máquina, nesta ordem: `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, ou um perfil criado por `ant auth login`. O login do próprio Claude Code **não** é lido pelo SDK. Faça uma vez:

```bash
# Opção A — perfil OAuth (reutilizado pelo SDK e pelo Claude Code)
# A CLI `ant` não está no npm. Windows: baixe ant_<versão>_windows_amd64.zip em
# https://github.com/anthropics/anthropic-cli/releases e coloque ant.exe no PATH.
# macOS: brew install anthropics/tap/ant
ant auth login
# Opção B — chave de API
export ANTHROPIC_API_KEY=sk-ant-...        # PowerShell: $env:ANTHROPIC_API_KEY = "sk-ant-..."
```

**Qwen (Qwen Cloud / Alibaba Cloud).** O caminho mais simples é `/auth` → **Qwen** dentro do Maestro. Na primeira etapa escolha o protocolo do endpoint:

| Protocolo                  | Endpoint padrão                                               |
| -------------------------- | ------------------------------------------------------------- |
| OpenAI compatível (padrão) | `https://token-plan.maas.qwencloudapi.com/compatible-mode/v1` |
| Anthropic compatível       | `https://token-plan.maas.qwencloudapi.com/apps/anthropic`     |

A URL continua editável na etapa seguinte (por exemplo, DashScope `https://dashscope.aliyuncs.com/compatible-mode/v1` ou `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` para contas pay-as-you-go). Manualmente, defina a chave e ative o provedor:

```bash
export DASHSCOPE_API_KEY=sk-...            # PowerShell: $env:DASHSCOPE_API_KEY = "sk-..."
```

e em `~/.maestro/settings.json` coloque `"enabled": true` em `providers.qwen`; `protocol` aceita `"openai"` ou `"anthropic"` e `baseUrl` é opcional (sem ela vale o endpoint padrão do protocolo).

## Configuração

Na primeira execução o Maestro cria `~/.maestro/settings.json` (Windows: `%USERPROFILE%\.maestro\settings.json`) com comentários. Um `./.maestro/settings.json` na pasta do projeto sobrescreve o global, chave a chave. Precedência: argumentos > variáveis de ambiente > projeto > global.

```json
{
  "activeProvider": "claude",
  "providers": {
    "claude": {
      "enabled": true,
      "model": "claude-opus-5-5",
      "models": ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
      "effort": "medium",
      "fallbacks": true
    },
    "qwen": {
      "enabled": true,
      "protocol": "openai",
      "model": "qwen3-coder-plus",
      "models": ["qwen3-coder-plus", "qwen3-coder-flash", "qwen3-max"],
      "baseUrl": "https://token-plan.maas.qwencloudapi.com/compatible-mode/v1"
    }
  },
  "tools": {
    "enabled": true,
    "commandTimeoutMs": 60000,
    "maxOutputChars": 20000,
    "approvalMode": "default"
  }
}
```

`providers.<id>.models` é a lista de modelos que o `/model` oferece para aquele provedor (edite à vontade; vazia ou ausente, vale a lista padrão acima). Um modelo digitado em "Digitar outro modelo…" ou passado em `/model <id> <modelo>` é acrescentado a ela automaticamente.

Variáveis reconhecidas: `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `DASHSCOPE_API_KEY`, `DASHSCOPE_BASE_URL`, `MAESTRO_PROVIDER`, `MAESTRO_CONFIG`, `NO_COLOR`. Chaves nunca aparecem em tela ou em logs; só os últimos 4 caracteres.

## Uso

```bash
maestro                              # sessão interativa
maestro --provider qwen              # força um provedor nesta sessão
maestro --model claude-sonnet-5-5    # força um modelo nesta sessão
maestro -p "explique src/index.ts"   # uma pergunta, resposta em stdout, sai
echo "resuma isto" | maestro -p -    # prompt via stdin
maestro --no-tools                   # sem ferramentas de workspace (ask_user continua)
maestro --approval-mode auto         # modo de aprovação inicial (default | auto-edit | auto | yolo)
maestro --yolo                       # = --approval-mode yolo
maestro --no-altscreen               # desenha no buffer principal (sem tela alternativa)
maestro --debug                      # erros detalhados + ~/.maestro/debug.log
```

A sessão interativa ocupa a tela inteira do terminal (tela alternativa, restaurada ao sair), abre com o banner "Maestro" e formata as respostas em markdown: títulos, listas, negrito, código com destaque de sintaxe e tabelas. A conversa rola dentro da interface: Page Up / Page Down (uma tela), Shift+↑ / Shift+↓ (uma linha), Home / End, e a roda do mouse onde o terminal a reporta. Um indicador à direita mostra a posição. Em `settings.json`, `ui.altScreen` e `ui.mouse` desligam esses recursos; `MAESTRO_NO_ALTSCREEN=1` também desliga a tela alternativa.

Na sessão:

| Comando / tecla                          | Efeito                                                                                                                                      |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `/auth`, `/connect`, `/login`            | Abre o diálogo para conectar um provedor (Claude API, Claude Auth Login, Qwen)                                                              |
| `/model`                                 | Abre o seletor com os modelos de cada provedor agrupados e o ativo marcado; "Digitar outro modelo…" pede o provedor e grava o nome na lista |
| `/model qwen` / `/model claude qwen-max` | Troca provedor (e modelo) mantendo a conversa; um modelo novo entra na lista do provedor                                                    |
| Tab / Shift+Tab                          | Avança / volta o modo de aprovação (veja abaixo); vale só para a sessão                                                                     |
| `/approval-mode [modo]`                  | Mostra ou troca o modo de aprovação por texto                                                                                               |
| ↑ / ↓                                    | Percorre o histórico de entradas (mensagens e comandos), do mais recente ao mais antigo; ↓ devolve o texto que estava sendo digitado        |
| `/clear`                                 | Nova conversa                                                                                                                               |
| `/help`                                  | Lista comandos                                                                                                                              |
| `/exit`                                  | Sai                                                                                                                                         |
| Esc ou Ctrl+C                            | Cancela a resposta em geração                                                                                                               |
| Ctrl+C duas vezes                        | Sai                                                                                                                                         |
| `y` / `n`                                | Aprova / recusa uma escrita de arquivo ou comando                                                                                           |
| ↑↓ / 1-9 · Espaço · Enter · Esc          | No diálogo de pergunta (`ask_user`): navegar / escolher · marcar (múltipla) · confirmar · não responder                                     |

### Modos de aprovação

Como no qwen-code, o Maestro tem quatro níveis de autonomia para as ações do modelo. A barra de status mostra o modo em vigor; **Tab** avança no ciclo e **Shift+Tab** volta (quando o terminal o distingue). A troca vale só para a sessão; o modo inicial vem de `--approval-mode`, `--yolo` ou `tools.approvalMode` no `settings.json`.

| Modo                          | Edição de arquivo | Comando | Comando destrutivo |
| ----------------------------- | ----------------- | ------- | ------------------ |
| `default` — Pedir permissão   | pede              | pede    | pede               |
| `auto-edit` — Aceitar edições | executa           | pede    | pede               |
| `auto` — Automático           | executa           | executa | pede               |
| `yolo` — YOLO                 | executa           | executa | executa            |

Ações executadas sem perguntar aparecem na transcrição com o resumo que o diálogo mostraria e o modo que as liberou. Em `-p`, o modo decide o que roda; o que exigiria confirmação é recusado (padrão: tudo).

**Comandos destrutivos** são reconhecidos por uma lista de padrões: remoção recursiva ou forçada (`rm -rf`, `rmdir /s`, `Remove-Item -Recurse`), descarte de alterações ou reescrita de histórico git (`reset --hard`, `clean -f`, `checkout -- .`, `branch -D`, `rebase`, `commit --amend`, `stash drop`), envio forçado ao remoto (`push --force`, `-f`, `+ref`, `--delete`), formatação ou escrita direta em disco (`mkfs`, `format`, `diskpart`, `dd if=`), desligamento/reinício, permissões em massa (`chmod -R`, `icacls /T`), redirecionamento para pastas de sistema, `curl … | sh` e `sudo`. É uma conveniência para evitar acidentes, não uma barreira de segurança; em repositórios sem controle de versão prefira _Pedir permissão_. Em nenhum modo o Maestro deixa de confinar escritas e comandos à pasta de trabalho.

### Perguntas do modelo (`ask_user`)

Quando precisa de uma decisão sua para continuar, o modelo chama a ferramenta `ask_user`: um diálogo mostra a pergunta com duas a quatro opções descritas (até quatro perguntas por chamada, uma de cada vez) e sempre uma opção **Outro…** para digitar uma resposta livre. ↑/↓ ou os dígitos escolhem, Espaço marca em múltipla escolha, Enter confirma e Esc devolve ao modelo que você não respondeu. A pergunta aparece em qualquer modo de aprovação, inclusive YOLO, e a ferramenta continua disponível com `--no-tools`. O texto digitado vai só para o modelo: não entra no histórico ↑/↓ nem nos logs.

O histórico de entradas é guardado em `~/.maestro/history.jsonl` (uma linha JSON por entrada, até 1.000 entradas) e sobrevive ao fechamento do Maestro, como no Claude Code. Comandos `/` também entram; o que é digitado nos campos dos diálogos (`/auth`, `/model`), inclusive chaves, nunca entra. O modo `-p` não lê nem grava o histórico.

Códigos de saída: `0` sucesso · `1` erro do provedor (modo `-p`) · `2` uso/configuração inválida · `3` nenhum provedor utilizável · `130` interrompido.

## Desenvolvimento

```bash
npm run dev          # roda a partir do código-fonte (tsx)
npm test             # vitest — sem rede, SDKs mockados
npm run lint
npm run build
npm run version:print   # versão calculada pelas regras do GitVersion
```

### Versão (GitVersion)

A versão exibida por `maestro --version`, no cabeçalho e nos logs não é uma constante: vem do GitVersion. O workflow **Version and Tag** calcula a versão a partir das tags `v*` e dos prefixos dos commits (`fix:` → patch, `feat:` → minor, `major:` → major, conforme `GitVersion.yml`), carimba `package.json` e `dist/version.json`, gera o pacote `maestro-<versão>.tgz` e cria a tag. Localmente, `scripts/version.mjs` reproduz as mesmas regras a partir do histórico git: `npm run build` grava `dist/version.json` e `npm run dev` grava `src/version.json` (ignorado pelo git). Sem carimbo, vale a versão do `package.json`. Em branches fora de `main`, a versão recebe um sufixo de pré‑lançamento (por exemplo `0.1.2-feature-x.3`).

Estrutura: `src/config` (settings e precedência), `src/providers` (interface `ModelProvider`, `claude.ts`, `qwen.ts`), `src/session` (histórico, loop de turno e ferramentas, comandos `/`), `src/tools` (sandbox e quatro ferramentas), `src/ui` (Ink), `src/cli` (argumentos, pré‑voo, modos). Os documentos de especificação e plano estão em `specs/001-maestro-cli-mvp/`.

## Roadmap

1. Orquestração de agentes: sessões paralelas, delegação entre provedores, painéis por agente.
2. Provedor `claude-code` via Agent SDK (reutiliza o login do Claude Code).
3. Memória entre sessões e compactação de contexto.
4. Mais provedores (o registro aceita novos com um arquivo e uma entrada no schema).

## Licença

O Maestro é software livre sob a [licença MIT](./LICENSE). É e continuará sendo open-source: o pacote nunca será privado e o repositório público é a fonte canônica. Partes adaptadas de terceiros mantêm suas licenças; os avisos estão em [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

## Créditos

- [qwen-code](https://github.com/QwenLM/qwen-code) (Qwen Team, Alibaba; Apache-2.0): os modos de aprovação e a ferramenta `ask_user` foram adaptados de lá (identificadores e ciclo dos modos, esquema e formato de resposta da pergunta, teclas do diálogo, cores do indicador). Os arquivos adaptados trazem o cabeçalho de atribuição.
- [gemini-cli](https://github.com/google-gemini/gemini-cli) (Google LLC; Apache-2.0): projeto do qual o qwen-code deriva.
- [Claude Code](https://claude.com/claude-code): inspiração para a experiência de uso (histórico ↑/↓, prompt, atalhos); nenhum código foi copiado.
