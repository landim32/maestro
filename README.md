# maestro

Assistente de IA para o terminal com suporte a múltiplos modelos. Hoje é um chat de linha de comando no estilo do Claude Code e do qwen code, com ferramentas básicas de workspace. Amanhã será um orquestrador de agentes; a arquitetura de provedores plugáveis já foi desenhada para isso.

- Provedores: **Claude** (Anthropic) e **Qwen** (Alibaba Cloud DashScope). Ative e configure cada um em `settings.json`.
- Sessão interativa com streaming, histórico de conversa, troca de provedor a quente (`/model`), cancelamento com Esc.
- Ferramentas: ler arquivos, listar diretórios, escrever arquivos e executar comandos, sempre confinadas à pasta atual. Escrita e comandos exigem sua aprovação.
- Modo não interativo (`maestro -p "..."`) para scripts.

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
      "effort": "medium",
      "fallbacks": true
    },
    "qwen": {
      "enabled": true,
      "protocol": "openai",
      "model": "qwen3-coder-plus",
      "baseUrl": "https://token-plan.maas.qwencloudapi.com/compatible-mode/v1"
    }
  },
  "tools": { "enabled": true, "commandTimeoutMs": 60000, "maxOutputChars": 20000 }
}
```

Variáveis reconhecidas: `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `DASHSCOPE_API_KEY`, `DASHSCOPE_BASE_URL`, `MAESTRO_PROVIDER`, `MAESTRO_CONFIG`, `NO_COLOR`. Chaves nunca aparecem em tela ou em logs; só os últimos 4 caracteres.

## Uso

```bash
maestro                              # sessão interativa
maestro --provider qwen              # força um provedor nesta sessão
maestro --model claude-sonnet-5-5    # força um modelo nesta sessão
maestro -p "explique src/index.ts"   # uma pergunta, resposta em stdout, sai
echo "resuma isto" | maestro -p -    # prompt via stdin
maestro --no-tools                   # sem ferramentas de workspace
maestro --no-altscreen               # desenha no buffer principal (sem tela alternativa)
maestro --debug                      # erros detalhados + ~/.maestro/debug.log
```

A sessão interativa ocupa a tela inteira do terminal (tela alternativa, restaurada ao sair), abre com o banner "Maestro" e formata as respostas em markdown: títulos, listas, negrito, código com destaque de sintaxe e tabelas. A conversa rola dentro da interface: Page Up / Page Down (uma tela), Shift+↑ / Shift+↓ (uma linha), Home / End, e a roda do mouse onde o terminal a reporta. Um indicador à direita mostra a posição. Em `settings.json`, `ui.altScreen` e `ui.mouse` desligam esses recursos; `MAESTRO_NO_ALTSCREEN=1` também desliga a tela alternativa.

Na sessão:

| Comando / tecla                          | Efeito                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------ |
| `/auth`, `/connect`, `/login`            | Abre o diálogo para conectar um provedor (Claude API, Claude Auth Login, Qwen) |
| `/model`                                 | Abre o seletor de modelo com o ativo marcado e todos os configurados           |
| `/model qwen` / `/model claude qwen-max` | Troca provedor (e modelo) mantendo a conversa                                  |
| `/clear`                                 | Nova conversa                                                                  |
| `/help`                                  | Lista comandos                                                                 |
| `/exit`                                  | Sai                                                                            |
| Esc ou Ctrl+C                            | Cancela a resposta em geração                                                  |
| Ctrl+C duas vezes                        | Sai                                                                            |
| `y` / `n`                                | Aprova / recusa uma escrita de arquivo ou comando                              |

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
