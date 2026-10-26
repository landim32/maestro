# maestro

Assistente de IA para o terminal com suporte a múltiplos modelos. Hoje é um chat de linha de comando no estilo do Claude Code e do qwen code, com ferramentas básicas de workspace. Amanhã será um orquestrador de agentes; a arquitetura de provedores plugáveis já foi desenhada para isso.

- Provedores: **Claude** pela API da Anthropic (consome créditos de API), **Claude Code** (usa o Claude Code instalado e logado com a sua assinatura do claude.ai), **Codex** (usa o Codex CLI instalado e logado com a sua conta do ChatGPT) e **Qwen** (Alibaba Cloud DashScope). Ative e configure cada um em `settings.json` ou com `/auth`.
- Sessão interativa com streaming, histórico de conversa, troca de provedor a quente (`/model`), cancelamento com Esc.
- Ferramentas: ler arquivos, listar diretórios, escrever arquivos e executar comandos, sempre confinadas à pasta atual. Quatro modos de aprovação (Shift+Tab alterna) decidem o que pede sua confirmação; `ask_user` deixa o modelo fazer perguntas de múltipla escolha.
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

**Pelo próprio Maestro.** Dentro da sessão, digite `/auth` (ou `/connect`, `/login`): um diálogo lista **Claude API** (chave), **Claude Auth Login** (login do console pela CLI `ant`), **Qwen** (DashScope) e **Claude Code** (assinatura), pede os campos, testa a conexão e grava em `settings.json`. É o caminho recomendado; o resto desta seção descreve a configuração manual equivalente.

**API ou assinatura?** As opções **Claude API** e **Claude Auth Login** usam o provedor `claude`, que fala com a API da Anthropic: cada pedido é cobrado dos créditos de API da organização do console, mesmo com o login pelo `ant`. Quando os créditos acabam, o Maestro avisa ("o saldo de créditos de API desta conta acabou"). A assinatura Pro/Max do claude.ai não cobre a API; para usá-la, escolha **Claude Code** (abaixo).

**Claude (API).** O Maestro reutiliza o que já existir na máquina, nesta ordem: `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, ou um perfil criado por `ant auth login`. O login do próprio Claude Code **não** é lido pelo SDK. Faça uma vez:

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

**Claude Code (assinatura do claude.ai).** O provedor `claude-code` atende cada pedido executando o [Claude Code](https://code.claude.com/docs/en/setup) que você instalou e logou, no modo não interativo. Quem cuida do login é o próprio Claude Code: com o login da assinatura (`authMethod: claude.ai`), o uso entra na cota da sua assinatura e não consome créditos de API. O Maestro nunca lê, guarda, pede ou repassa credenciais do claude.ai, e não inicia login nenhum.

1. Instale o Claude Code, rode `claude` num terminal e faça `/login` com a sua conta.
2. No Maestro, `/auth` → **Claude Code**: o Maestro localiza o executável, consulta `claude auth status`, mostra como você está logado (e-mail mascarado), habilita o provedor e oferece ativá-lo.
3. Use `/model claude-code`, ou aponte rotas para ele em `/routes` (por exemplo, `speckit.plan` no Claude Code e o resto no Qwen).

Como funciona: o Claude Code roda sem nenhuma ferramenta própria, sem os seus servidores MCP, comandos e skills, e sem gravar a sessão. As ferramentas do Maestro (ler, listar, escrever, executar, `ask_user`) são oferecidas a ele por um servidor MCP local que só escuta em 127.0.0.1, numa porta aleatória, com um token aleatório por pedido. Cada chamada passa pelo mesmo caminho dos outros provedores: modos de aprovação, diálogo de confirmação com diff, confinamento à pasta e passos nativos do Spec Kit. As variáveis `ANTHROPIC_API_KEY` e `ANTHROPIC_AUTH_TOKEN` são removidas do ambiente do processo para que ele use o login da assinatura. O histórico da conversa, inclusive respostas de outros provedores, vai pela entrada padrão a cada pedido. `effort` vale; `maxTokens` não se aplica.

`providers.claude-code` aceita `enabled`, `model`, `models`, `effort` e `command` (caminho do executável, se `claude` não estiver no PATH).

> **Ressalva sobre os termos da Anthropic.** Os [termos do Claude Code](https://code.claude.com/docs/en/legal-and-compliance) proíbem aplicativos de terceiros de oferecer login do claude.ai e de coletar ou repassar credenciais da assinatura, e permitem que o usuário use o binário original do Claude Code com a própria assinatura. O provedor `claude-code` foi desenhado para ficar desse lado da linha: ele só executa o Claude Code que você instalou e logou. Os termos não tratam explicitamente de uma ferramenta que chama o Claude Code dessa forma; avalie se esse uso é adequado ao seu caso e, se precisar de certeza, consulte a Anthropic. Para uso garantidamente suportado dentro do Maestro, use o provedor `claude` com créditos de API.

**Codex (assinatura do ChatGPT).** O provedor `codex` atende cada pedido executando o [Codex CLI](https://github.com/openai/codex) que você instalou e logou, no modo não interativo (`codex exec --json`). Quem cuida do login é o próprio Codex: com o login pela conta do ChatGPT, o uso entra na cota da sua assinatura, sem chave de API. O Maestro nunca lê, guarda, pede ou repassa credenciais do ChatGPT ou da OpenAI, e não inicia login nenhum.

1. Instale o Codex (`npm install -g @openai/codex`, versão 0.161.0 ou mais nova) e rode `codex login` num terminal com a sua conta do ChatGPT.
2. No Maestro, `/auth` → **Codex**: o Maestro localiza o executável, confere a versão, consulta `codex login status` (só o método de login), habilita o provedor e oferece ativá-lo. Um login por chave de API é aceito, com o aviso de que consome créditos da API da OpenAI.
3. Use `/model codex` (ou `/model codex gpt-5.6-terra`), `maestro --provider codex`, ou aponte rotas para ele em `/routes`.

Como funciona: o Codex roda com as ferramentas próprias desligadas (shell, edição, imagens, navegador, plugins, subagentes, busca na web), com o sandbox `read-only` dele como segunda barreira, sem a sua configuração (`~/.codex/config.toml`), regras e servidores MCP, e sem gravar a sessão. As ferramentas do Maestro chegam a ele pelo mesmo servidor MCP local do `claude-code` (127.0.0.1, porta e token aleatórios por pedido; o token vai por variável de ambiente, nunca na linha de comando), então valem os modos de aprovação, o diálogo de confirmação com diff, o confinamento à pasta e os passos nativos do Spec Kit. O prompt do Maestro substitui as instruções do Codex. `OPENAI_API_KEY` e `CODEX_API_KEY` são removidas do ambiente do processo. Quando a assinatura atinge o limite de uso, o Maestro espera e tenta de novo, como nos outros provedores.

Limitações: o texto chega em blocos (uma mensagem por vez), não letra a letra; `effort` vale (`model_reasoning_effort`), `maxTokens` não se aplica; os modelos disponíveis dependem da sua conta (padrão `gpt-6-luna`, lista `gpt-6-luna`, `gpt-5.6-terra`, `gpt-5.6-luna`). Uma versão do Codex anterior à 0.161.0 é recusada com o aviso para atualizar, em vez de rodar sem as garantias acima.

`providers.codex` aceita `enabled`, `model`, `models`, `effort` e `command` (caminho do executável, se `codex` não estiver no PATH).

## Configuração

Na primeira execução o Maestro cria `~/.maestro/settings.json` (Windows: `%USERPROFILE%\.maestro\settings.json`) com comentários. Um `./.maestro/settings.json` na pasta do projeto sobrescreve o global, chave a chave. Precedência: argumentos > variáveis de ambiente > projeto > global.

```json
{
  "activeProvider": "claude",
  "language": "pt-BR",
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
    },
    "claude-code": {
      "enabled": false,
      "model": "claude-opus-5-5",
      "models": ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
      "effort": "medium"
    },
    "codex": {
      "enabled": false,
      "model": "gpt-6-luna",
      "models": ["gpt-6-luna", "gpt-5.6-terra", "gpt-5.6-luna"],
      "effort": "medium"
    }
  },
  "tools": {
    "enabled": true,
    "commandTimeoutMs": 60000,
    "maxOutputChars": 20000,
    "maxToolIterations": 0,
    "approvalMode": "default"
  },
  "skills": {
    "enabled": true
  },
  "ui": {
    "altScreen": true,
    "mouse": true,
    "pasteCollapseLines": 3,
    "attachMaxBytes": 524288,
    "attachMaxTotalBytes": 2097152,
    "imageMaxBytes": 5242880
  }
}
```

**Idioma das respostas.** Por padrão o modelo responde no idioma em que você escreve. No autopiloto e nos comandos do Spec Kit, porém, boa parte do texto enviado ao modelo é em inglês, e modelos menores podem trocar de idioma no meio do caminho. `"language": "pt-BR"` (no global ou no `./.maestro/settings.json`) fixa o idioma de todas as respostas e dos artefatos escritos (specs, planos, tarefas, mensagens de commit, comentários), para todos os provedores e rotas. Os identificadores de código e os termos técnicos ficam no original. Aceita um código (`pt-BR`, `pt-PT`, `en`, `es`…) ou o nome do idioma por extenso.

Em `tools`: `maxToolIterations` é quantas rodadas de ferramentas o modelo pode fazer num mesmo turno. O padrão `0` significa **sem limite**, como no Claude Code, no qwen-code e no gemini-cli: o turno só termina quando o modelo responde sem pedir ferramenta, ou quando você aperta Esc. Um valor positivo cria um teto (no `claude-code`, 5 chamadas por rodada) e faz o Maestro parar com o aviso `stopped after N tool iterations in one turn`.

**Limite de taxa ou de uso do provedor.** Quando o provedor recusa por excesso de pedidos, ou a assinatura do Claude Code atinge o limite de uso, o Maestro não encerra o turno. Ele avisa (`limite de taxa do provedor …; aguardando 30s e tentando de novo`), espera e reenvia o mesmo pedido. A espera é o tempo indicado pelo provedor (`Retry-After` ou o horário de liberação da assinatura). Sem indicação, ela começa em 5 s e dobra a cada tentativa, até 5 min. As ferramentas que já rodaram ficam no histórico, e só a resposta parcial é descartada. O Esc interrompe a espera.

**Falha de conexão.** Uma queda de rede (`ECONNRESET`, `fetch failed`, `stream disconnected`…) também espera e reenvia, com o mesmo intervalo crescente, até 5 vezes seguidas. Depois disso o turno termina com o erro. No autopiloto não há limite de tentativas: a execução espera a conexão voltar. Quando o provedor anuncia uma chamada de ferramenta que não chega (resposta incompleta de um endpoint compatível), o Maestro reenvia o pedido até 2 vezes.

Em `ui`: `pasteCollapseLines` é o número de linhas a partir do qual uma colagem vira marcador; `attachMaxBytes` limita cada arquivo colado, `attachMaxTotalBytes` o total anexado por mensagem e `imageMaxBytes` cada imagem.

`providers.<id>.models` é a lista de modelos que o `/model` oferece para aquele provedor (edite à vontade; vazia ou ausente, vale a lista padrão acima). Um modelo digitado em "Digitar outro modelo…" ou passado em `/model <id> <modelo>` é acrescentado a ela automaticamente.

Variáveis reconhecidas: `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `DASHSCOPE_API_KEY`, `DASHSCOPE_BASE_URL`, `MAESTRO_PROVIDER`, `MAESTRO_CONFIG`, `NO_COLOR`. Chaves nunca aparecem em tela ou em logs; só os últimos 4 caracteres.

## Uso

```bash
maestro                              # sessão interativa
maestro --provider qwen              # força um provedor nesta sessão
maestro --provider claude-code       # usa o Claude Code logado (assinatura) nesta sessão
maestro --provider codex             # usa o Codex logado (conta do ChatGPT) nesta sessão
maestro --model claude-sonnet-5-5    # força um modelo nesta sessão
maestro -p "explique src/index.ts"   # uma pergunta, resposta em stdout, sai
echo "resuma isto" | maestro -p -    # prompt via stdin
maestro --no-tools                   # sem ferramentas de workspace (ask_user continua)
maestro --approval-mode auto         # modo de aprovação inicial (default | auto-edit | auto | yolo)
maestro --yolo                       # = --approval-mode yolo
maestro --no-altscreen               # desenha no buffer principal (sem tela alternativa)
maestro --debug                      # erros detalhados + ~/.maestro/debug.log
maestro -p "/speckit.tasks"          # comandos do Spec Kit também funcionam em -p
maestro -p --route infra "…"         # força uma rota (provedor/modelo) neste pedido
maestro -p "/routes"                 # tabela das rotas configuradas
maestro --version                    # versão do Maestro e do Spec Kit embutido
```

A sessão interativa ocupa a tela inteira do terminal (tela alternativa, restaurada ao sair), abre com o banner "Maestro" e formata as respostas em markdown: títulos, listas, negrito, código com destaque de sintaxe e tabelas. A conversa rola dentro da interface: Page Up / Page Down (uma tela), Shift+↑ / Shift+↓ (uma linha), Home / End, e a roda do mouse onde o terminal a reporta. Um indicador à direita mostra a posição. Arrastar o mouse sobre a conversa seleciona e copia o texto (veja "Colar e copiar"). Em `settings.json`, `ui.altScreen` e `ui.mouse` desligam esses recursos; `MAESTRO_NO_ALTSCREEN=1` também desliga a tela alternativa.

Na sessão:

| Comando / tecla                          | Efeito                                                                                                                                      |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `/auth`, `/connect`, `/login`            | Abre o diálogo para conectar um provedor (Claude API, Claude Auth Login, Qwen, Claude Code)                                                 |
| `/model`                                 | Abre o seletor com os modelos de cada provedor agrupados e o ativo marcado; "Digitar outro modelo…" pede o provedor e grava o nome na lista |
| `/model qwen` / `/model claude qwen-max` | Troca provedor (e modelo) mantendo a conversa; um modelo novo entra na lista do provedor                                                    |
| Shift+Tab                                | Avança o modo de aprovação (veja abaixo); vale só para a sessão                                                                             |
| Tab / → (seta direita)                   | Completa a sugestão de comando destacada enquanto o texto começa com ; ↑/↓ escolhem a sugestão                                              |
| `/approval-mode [modo]`                  | Mostra ou troca o modo de aprovação por texto                                                                                               |
| `/speckit.specify`, `/speckit.plan`, …   | Fluxo Spec Kit nativo (veja abaixo); `/speckit.init` instala, `/speckit.status` mostra a feature atual                                      |
| → (seta direita)                         | Completa a primeira sugestão de comando enquanto o texto começa com `/`                                                                     |
| ↑ / ↓                                    | Percorre o histórico de entradas (mensagens e comandos), do mais recente ao mais antigo; ↓ devolve o texto que estava sendo digitado        |
| Colar (Ctrl+V / Shift+Insert)            | Texto com mais de 3 linhas vira um marcador `[Pasted text #1 +42 lines]`; caminhos de arquivos viram `[Arquivo: …]` (veja "Colar e copiar") |
| Ctrl+O                                   | Mostra as primeiras linhas do marcador sob o cursor; Ctrl+O de novo fecha                                                                   |
| Arrastar com o mouse                     | Seleciona texto da conversa e copia ao soltar (duplo clique = palavra, triplo = linha)                                                      |
| `/mouse [on\|off]`                       | Liga/desliga o mouse na sessão (rolagem e seleção); desligado, a seleção nativa do terminal volta a funcionar                               |
| `/routes`                                | Abre a tela de rotas por modelo: qual provedor/modelo atende a conversa, cada comando e as rotas `github`/`infra` (veja abaixo)             |
| `/ask <rota> <pedido>`                   | Envia um pedido por uma rota específica sem trocar o modelo ativo (`/ask github …`, `/ask speckit.plan …`)                                  |
| `/github …`, `/infra …`, `/<rota> …`     | Atalhos das rotas de propósito (as fixas e as que você criar em `/routes`)                                                                  |
| `/skills`                                | Lista as skills encontradas (`.claude/skills`, `.agents/skills`, `~/.claude/skills`), as sombreadas e as ignoradas, com o motivo            |
| `/clear`                                 | Nova conversa                                                                                                                               |
| `/help`                                  | Lista comandos                                                                                                                              |
| `/exit`                                  | Sai                                                                                                                                         |
| Esc ou Ctrl+C                            | Cancela a resposta em geração                                                                                                               |
| Ctrl+C duas vezes                        | Sai                                                                                                                                         |
| `y` / `n`                                | Aprova / recusa uma escrita de arquivo ou comando                                                                                           |
| ↑↓ / 1-9 · Espaço · Enter · Esc          | No diálogo de pergunta (`ask_user`): navegar / escolher · marcar (múltipla) · confirmar · não responder                                     |

### Exibição da conversa

A conversa segue o formato do Claude Code:

- **Linha de atividade.** Enquanto o modelo trabalha, uma linha acima do prompt mostra um símbolo animado, uma frase, o tempo e os tokens recebidos, por exemplo `✻ Contemplando… (13s · ↓ 304 tokens · Esc para interromper)`. A frase muda para `Executando Bash…`, `Aguardando sua confirmação…` ou `Aguardando sua resposta…` conforme o que está acontecendo. Os tokens com `~` são uma estimativa a partir do texto, trocada pelo valor real quando o provedor o informa. No fim, a conversa guarda um resumo como `✻ 13s · ↓ 304 tokens`, ou `✻ interrompido · …` depois de um Esc.
- **Transcrição.** Cada resposta começa com `⏺`. Cada ferramenta aparece como `⏺ Read(src/index.ts)`, `⏺ List(src)`, `⏺ Write(a.txt)`, `⏺ Bash(npm test)` (`Cmd(…)` no Windows) ou `⏺ Speckit(setup-plan)`, e o resultado vem logo abaixo, depois de `⎿`. Os resumos são `Leu 120 linhas`, `14 itens`, as primeiras linhas da saída de um comando com `… +N linhas`, o erro completo em vermelho, `recusado pelo usuário` ou `· auto (<modo>)` quando o modo de aprovação liberou a ação.
- **Diff de escrita.** O diálogo de confirmação e a transcrição mostram o mesmo diff, com caminho, `+A −R`, números de linha, 3 linhas de contexto, adições em verde e remoções em vermelho. Arquivo novo, escrita sem mudança, troca só de fim de linha (CRLF ↔ LF) e conteúdo binário ou grande têm resumos próprios.

No modo `-p` nada disso muda: o stdout continua sendo só a resposta, e o progresso (`⚙ read_file …`) vai para o stderr.

### Modos de aprovação

Como no qwen-code, o Maestro tem quatro níveis de autonomia para as ações do modelo. A barra de status mostra o modo em vigor; **Shift+Tab** avança no ciclo (a barra mostra "(Shift+Tab para trocar)" ao lado do modo). A troca vale só para a sessão; o modo inicial vem de `--approval-mode`, `--yolo` ou `tools.approvalMode` no `settings.json`.

| Modo                          | Edição de arquivo | Comando | Comando destrutivo |
| ----------------------------- | ----------------- | ------- | ------------------ |
| `default` — Pedir permissão   | pede              | pede    | pede               |
| `auto-edit` — Aceitar edições | executa           | pede    | pede               |
| `auto` — Automático           | executa           | executa | pede               |
| `yolo` — YOLO                 | executa           | executa | executa            |

Ações executadas sem perguntar aparecem na transcrição com o resumo que o diálogo mostraria e o modo que as liberou. Em `-p`, o modo decide o que roda; o que exigiria confirmação é recusado (padrão: tudo).

**Comandos destrutivos** são reconhecidos por uma lista de padrões: remoção recursiva ou forçada (`rm -rf`, `rmdir /s`, `Remove-Item -Recurse`), descarte de alterações ou reescrita de histórico git (`reset --hard`, `clean -f`, `checkout -- .`, `branch -D`, `rebase`, `commit --amend`, `stash drop`), envio forçado ao remoto (`push --force`, `-f`, `+ref`, `--delete`), formatação ou escrita direta em disco (`mkfs`, `format`, `diskpart`, `dd if=`), desligamento/reinício, permissões em massa (`chmod -R`, `icacls /T`), redirecionamento para pastas de sistema, `curl … | sh` e `sudo`. É uma conveniência para evitar acidentes, não uma barreira de segurança; em repositórios sem controle de versão prefira _Pedir permissão_. Em nenhum modo o Maestro deixa de confinar escritas e comandos à pasta de trabalho.

### Spec Kit nativo

O Maestro hospeda o [Spec Kit](https://github.com/github/spec-kit) do GitHub sem Claude Code, sem a CLI `specify` e sem shell: os comandos `/speckit.*` (constitution, specify, clarify, plan, tasks, analyze, checklist, implement, converge, taskstoissues) funcionam com qualquer provedor, inclusive no modo `-p`.

- **Descoberta**: arquivos de comando em `.maestro/commands/`, depois na pasta da integração registrada em `.specify/integration.json` (por exemplo `.claude/commands/` de um projeto inicializado pela CLI `specify`), depois os embutidos (spec-kit v1.2.3). O primeiro nome encontrado vence; `/help` mostra a origem. Digite `/` para ver sugestões; **→** completa a primeira.
- **Scripts executados nativamente**: quando o modelo "roda" `.specify/scripts/bash/…`, `…/powershell/…ps1` ou `…/python/…py` (criar feature, configurar plano/tarefas, verificar pré‑requisitos, resolver templates, atualizar contexto do agente), o Maestro executa o passo equivalente em TypeScript e devolve o mesmo JSON. Nenhum PowerShell, bash ou Python é iniciado; o único programa externo é o `git`. Esses passos não pedem confirmação e aparecem como `⚙ speckit <passo>` na transcrição.
- **Pré‑requisitos**: um comando que precisa de `plan.md`, `tasks.md` ou de uma feature ativa é bloqueado com a mensagem do script antes de gastar tokens (código 2 em `-p`).
- **Projeto novo**: `/speckit.init` cria `.specify/` (templates, scripts para outros agentes, `memory/constitution.md`), `.maestro/commands/` e um manifesto de hashes; `/speckit.init --upgrade` substitui só os arquivos que você não modificou. `/speckit.status` mostra a feature atual, os artefatos e as versões.
- **Branch da feature**: `/speckit.specify` cria e ativa a branch `NNN-nome` em repositórios git (`"speckit": { "createBranch": false }` desliga). A feature é rastreada por `.specify/feature.json`, pela branch git ou pela pasta mais recente em `specs/`.
- **Contexto do projeto**: `MAESTRO.md` na raiz (ou `CLAUDE.md`, se só ele existir) entra no prompt de sistema; o `/speckit.plan` o mantém atualizado com as tecnologias do plano.
- **Perguntas**: as clarificações do `specify` e do `clarify` chegam como diálogos `ask_user`.

### Skills

O Maestro lê as skills no formato do Claude Code: uma pasta com um `SKILL.md` cujo cabeçalho traz `name` e `description`. Ele procura em três lugares, nesta ordem:

1. `.claude/skills/<nome>/SKILL.md` do projeto;
2. `.agents/skills/<nome>/SKILL.md` do projeto;
3. `~/.claude/skills/<nome>/SKILL.md` do usuário.

Se o mesmo nome aparecer em mais de um lugar, vale o primeiro.

O modelo recebe só uma lista curta, com o nome e a descrição de cada skill, e a regra de carregar a skill antes de uma tarefa que ela cobre. O conteúdo inteiro só entra quando o modelo chama a ferramenta `load_skill`. Ela devolve o `SKILL.md` e a lista dos arquivos de referência da skill, e com `file` lê um desses arquivos. Assim as skills da sua pasta pessoal ficam acessíveis, embora as outras ferramentas continuem confinadas à pasta de trabalho. A leitura de um arquivo nunca sai da pasta da skill.

A carga não pede confirmação em nenhum modo e funciona com todos os provedores. Na conversa, ela aparece como `⏺ Skill(nome)`.

`/skills` mostra o que foi encontrado. As skills sem `description` e as do Spec Kit (`speckit-*`) são ignoradas, porque o Maestro já hospeda esses comandos. `"skills": { "enabled": false }` desliga o recurso. Com `--no-tools`, as skills também ficam de fora. No autopiloto, cada carga grava no registro `.maestro/autopilot/<id>.jsonl` um evento `skill.load` com a história, a feature, o passo e a skill, sem o conteúdo.

### Perguntas do modelo (`ask_user`)

Quando precisa de uma decisão sua para continuar, o modelo chama a ferramenta `ask_user`: um diálogo mostra a pergunta com duas a quatro opções descritas (até quatro perguntas por chamada, uma de cada vez) e sempre uma opção **Outro…** para digitar uma resposta livre. ↑/↓ ou os dígitos escolhem, Espaço marca em múltipla escolha, Enter confirma e Esc devolve ao modelo que você não respondeu. A pergunta aparece em qualquer modo de aprovação, inclusive YOLO, e a ferramenta continua disponível com `--no-tools`. O texto digitado vai só para o modelo: não entra no histórico ↑/↓ nem nos logs.

O histórico de entradas é guardado em `~/.maestro/history.jsonl` (uma linha JSON por entrada, até 1.000 entradas) e sobrevive ao fechamento do Maestro, como no Claude Code. Comandos `/` também entram; o que é digitado nos campos dos diálogos (`/auth`, `/model`), inclusive chaves, nunca entra. O modo `-p` não lê nem grava o histórico.

### Colar e copiar

Como no qwen-code, colar e copiar funcionam dentro da interface:

- **Colagens grandes.** Um texto colado com mais de `ui.pasteCollapseLines` linhas (padrão 3) não polui o prompt: aparece como `[Pasted text #1 +42 lines]`, um marcador que se edita como um caractere só (← → pulam, Backspace apaga inteiro). O modelo recebe o texto completo, delimitado em um bloco `<pasted-text>`; a transcrição e o histórico ↑/↓ guardam só o rótulo (dentro da mesma sessão, ↑ recupera o marcador e reenvia o conteúdo). **Ctrl+O** com o cursor sobre o marcador mostra as primeiras linhas. Colagens curtas entram como texto normal; nos campos dos diálogos e no modo `-p` nada é colapsado.
- **Arquivos.** Arraste um arquivo para o terminal ou cole o caminho (absoluto, relativo, com aspas, `~/…` ou `file://…`): ele vira `[Arquivo: nome, N linhas]` e o conteúdo, lido no momento do envio, vai ao modelo em um bloco `<file path="…">`. Vários caminhos de uma vez viram vários marcadores. Arquivos binários, maiores que `ui.attachMaxBytes` (512 KB) ou fora da pasta de trabalho são recusados com um aviso e o caminho fica como texto; o total anexado por mensagem é limitado por `ui.attachMaxTotalBytes` (2 MB).
- **Imagens.** PNG, JPEG, GIF e WebP (até `ui.imageMaxBytes`, 5 MB) viram `[Imagem: nome, 120 KB]` quando o provedor ativo aceita imagens (Claude); o Qwen recebe um aviso e o caminho fica como texto.
- **Copiar com o mouse.** Com o mouse ligado, arraste sobre a conversa: o trecho fica destacado e, ao soltar, é copiado para a área de transferência exatamente como está na tela (duplo clique seleciona a palavra, triplo a linha; a seleção acompanha o conteúdo se você rolar com a roda durante o arrasto). A barra mostra `copiado (N linhas)`. A cópia usa `clip.exe` / PowerShell (Windows), `pbcopy` (macOS), `wl-copy`, `xclip` ou `xsel` (Linux) e, sem nenhum deles, a sequência OSC 52 do terminal (funciona por SSH em terminais modernos). Shift+arrasto continua sendo a seleção nativa do terminal; `/mouse off` desliga o mouse na sessão (a barra mostra `mouse desligado`) e `ui.mouse: false` o deixa desligado desde o início. Testado no Windows Terminal; iTerm2, GNOME Terminal, WezTerm e kitty reportam o mouse no mesmo protocolo (SGR).

### Rotas por modelo

Uma **rota** é um nome que aponta para um provedor e um modelo (e, se quiser, `effort` e `maxTokens`). Cada pedido é resolvido para uma rota antes de ir ao modelo, e **todas as rotas trabalham sobre a mesma conversa**: o que o Claude respondeu está no contexto quando o Qwen responde, e vice-versa. O provedor ativo (`/model`) nunca muda por causa de uma rota.

- **`chat`** é a rota da conversa comum. Por padrão segue o provedor/modelo ativo, então `/model` continua sendo o jeito rápido de trocar o modelo.
- **Cada comando que chama o modelo** (`/speckit.specify`, `/speckit.plan`, `/speckit.implement`, comandos de `.maestro/commands/`…) tem a sua rota, que por padrão segue `chat`. Assim dá para planejar num modelo forte e implementar num barato. Comandos sem modelo (`/help`, `/clear`, `/speckit.init`…) não têm rota.
- **`github`** e **`infra`** são rotas de propósito, acionadas por `/ask github …`, `/github …` ou `/infra …`; elas acrescentam uma orientação curta ao modelo (fluxo de branch/PR/issues; deploy/CI/containers). Você pode criar as suas (`review`, `docs`…) em `/routes`; cada uma ganha o atalho `/<rota> …`, exceto quando o nome colide com um comando.
- **Ordem de resolução**: rota forçada (`/ask`, atalho, `--route`) → rota do comando → `chat` → provedor ativo. Se o provedor de uma rota não estiver configurado ou estiver desabilitado, o Maestro avisa e usa a próxima da cadeia; `/routes` marca a rota como `indisponível`.
- **`/routes`** lista todas as rotas com provedor/modelo, origem (`padrão`, `global`, `projeto`) e disponibilidade; Enter numa rota permite escolher provedor e modelo (ou digitar outro), voltar ao padrão, ou remover uma rota sua; "Nova rota…" cria uma. A tela grava no `settings.json` global; `./.maestro/settings.json` sobrescreve rota a rota.
- Na transcrição, respostas de rotas diferentes da `chat` vêm marcadas com `⇢ rota · provedor / modelo`; a barra de status mostra `rota: …` enquanto a resposta é gerada.

```json
"routes": {
  "speckit.plan": { "provider": "claude", "model": "claude-opus-5-5", "effort": "high" },
  "speckit.implement": { "provider": "qwen", "model": "qwen3-coder-plus" },
  "github": { "provider": "claude", "model": "claude-sonnet-5-5" },
  "review": { "provider": "claude", "model": "claude-sonnet-5-5" }
}
```

Códigos de saída: `0` sucesso · `1` erro do provedor (modo `-p`) · `2` uso/configuração inválida · `3` nenhum provedor utilizável · `130` interrompido.

### Autopiloto

O autopiloto pega um arquivo de histórias de usuário e leva cada uma por todos os passos do Spec Kit, sem nenhuma interação: `specify → clarify → plan → tasks → analyze → implement → verificação`.

```bash
/autopilot historias.md              # na sessão interativa
/autopilot --resume                  # retoma uma execução interrompida ou parada
/autopilot --status                  # mostra o estado salvo
maestro -p --autopilot historias.md  # sem terminal: progresso no stderr, relatório no stdout
```

O arquivo é Markdown, e cada título `## ` é uma história:

```markdown
## Saudação

Como usuário, quero uma função greet(name) que devolve "Olá, <name>!".

## Despedida

Como usuário, quero bye(name) que devolve "Tchau, <name>!".
```

Um arquivo sem títulos `##` conta como uma história só. O texto antes do primeiro `##` vale como contexto para todas. Se dois ou mais títulos `##` parecerem seções de um documento (`## Contexto`, `## Escopo`, `## Riscos`, `## Critérios de aceite`…), o autopiloto recusa começar: use `###` nas seções e `##` só no título de cada história.

- **Cada história vira uma feature** com a própria branch `NNN-nome`. As histórias rodam em sequência, e cada branch parte da anterior. Cada passo começa numa conversa limpa, lê os artefatos do disco e usa a rota configurada para o comando em `/routes`. Cada passo concluído vira um commit (`fix: autopilot(012): plan`), então dá para desfazer passo a passo. O analyze só lê e não gera commit.
- **Decisões automáticas.** As perguntas que os passos fariam a você vão para um decisor, que usa a rota `autopilot.decide` e por padrão segue `chat`. Isso inclui as clarificações, o "(yes/no)" do implement e qualquer pergunta deixada no fim de um turno. O decisor escolhe a opção recomendada, ou senão a que menos amplia escopo e risco, sempre com uma justificativa. Tudo fica em `specs/NNN-nome/decisions.md`, que é versionado, e em `.maestro/autopilot/<execução>.jsonl`, que é local.
- **Portões entre os passos.**
  - specify, plan e tasks precisam criar o artefato.
  - Se o analyze apontar algo CRITICAL, há uma rodada de correção e uma nova análise.
  - O implement repete "continue" enquanto marcar tarefas novas. Se um turno terminar sem marcar nenhuma, o autopiloto pede que as tarefas concluídas sejam marcadas com `[X]` e que a implementação continue. Ele só para depois de 2 lembretes seguidos sem progresso.
  - A verificação (`autopilot.verify.command`; por padrão, os scripts `test`, `lint` e `build` do `package.json`) tem até `autopilot.verify.maxAttempts` correções.
  - Um portão que falha para a execução, com relatório e o comando de retomada.
- **Segurança.** Durante a execução, o modo de aprovação é `auto`, nunca `yolo`. Edições e comandos comuns rodam, e comandos destrutivos são recusados. Escritas continuam confinadas à pasta. Nada vai para o remoto, a menos que você ligue `autopilot.push` (push e um PR por história, cada um com base na branch anterior). O merge exige também `autopilot.merge`.
- **Limites e retomada.** Por padrão o autopiloto não tem teto: ele só para num portão que falha ou no Esc. Se quiser, `autopilot.limits` define tetos por história de turnos (0 ou pelo menos 7), minutos e tokens, com 0 = sem limite. O limite de taxa do provedor não para a execução, porque o turno espera e tenta de novo, e o tempo dessa espera não conta no teto de minutos. Ao retomar, a contagem da história recomeça do zero. O estado fica em `.specify/autopilot.json`, que é local e fica de fora dos commits pelo `.git/info/exclude`. Um Esc, um Ctrl+C ou o limite de uso do provedor interrompem o passo atual. As alterações parciais vão para um `git stash` nomeado, e `/autopilot --resume` recomeça desse passo. Se o processo morrer no meio (terminal fechado, queda de energia), `--resume` encontra a execução órfã e recomeça o passo que estava em andamento. As alterações que ficaram na árvore são mantidas e entram no commit do próximo passo.

```json
{
  "autopilot": {
    "verify": { "command": ["npm test", "npm run lint"], "maxAttempts": 3, "timeoutMs": 600000 },
    "limits": { "turns": 0, "minutes": 0, "tokens": 0 },
    "commitPrefix": "fix:",
    "push": false,
    "merge": false
  }
}
```

O autopiloto exige um repositório git com a árvore limpa e o Spec Kit inicializado (`/speckit.init`).

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
- [spec-kit](https://github.com/github/spec-kit) (GitHub; MIT): os templates, prompts de comando e scripts do Spec Kit v1.2.3 vêm embutidos em `assets/speckit/`; três prompts foram adaptados ao Maestro (listados em `assets/speckit/NOTICE`).
- [Claude Code](https://claude.com/claude-code): inspiração para a experiência de uso (histórico ↑/↓, prompt, atalhos, linha de atividade, transcrição com `⏺`/`⎿` e diff de escrita); nenhum código foi copiado.
- [OpenClaude](https://github.com/Twigpine/openclaude): referência do comportamento visual da exibição da conversa (linha de atividade, transcrição e diff). Como o projeto se declara derivado do código do Claude Code, ele foi usado só como referência do que é visível; nenhum código dele foi incorporado.
