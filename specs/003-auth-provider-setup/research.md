# Research: Configuração de Provedores pela Sessão (/auth) e Seleção de Modelo (/model)

**Feature**: `003-auth-provider-setup` | **Date**: 2026-10-24

Fontes: CLI `ant` 2.3.0 instalada nesta máquina (`ant auth --help`, `ant auth login --help`, saída real de `ant auth status`), qwen code v0.26.1 (`packages/cli/src/ui/commands/authCommand.ts`, `ui/auth/*`), código atual do Maestro (features 001/002) e referência oficial do SDK Anthropic já consultada.

---

## R1. Modelo de interação do `/auth` (referência qwen code)

**Observado**: `authCommand` tem `altNames: ['connect', 'login']`, é restrito ao modo interativo (no modo não interativo devolve uma mensagem orientando variáveis de ambiente) e devolve uma ação "abrir diálogo". O `AuthDialog` é uma lista de rádio com os métodos; a seleção leva a `ProviderSetupSteps` (campos em sequência) e `AuthInProgress` (progresso de login OAuth). Esc volta/cancela.

**Decision**: Reproduzir o mesmo desenho: comando → ação de abrir diálogo → máquina de estados de passos (lista → campos → teste → confirmação / progresso de login → resultado). O estado do diálogo vive no `SessionController` (`controller.dialog`), para que comandos `/` possam abri‑lo e para que o modo `-p` possa recusar sem depender da UI.

**Alternatives considered**: estado só no React (`App`) — rejeitado porque os comandos são executados pelo controller, não pela UI; prompts sequenciais no próprio `InputPrompt` (sem modal) — rejeitado por não ser "modal" nem igual ao qwen.

---

## R2. Executar o login da Anthropic a partir do Maestro

**Observado** (`ant auth login --help`): abre o navegador e aguarda callback local; `--no-browser` imprime a URL em vez de abrir; `--timeout` (padrão 5m) limita a espera; `--callback-port` opcional. `ant auth status` imprime texto (não há `--format json` para este subcomando; o flag global é ignorado); quando logado contém a linha `Logged in to <org> as <email>`; quando não, `(profile "default" not configured — run \`ant auth login\` to set it up)`. A documentação do SDK avisa para não depender do código de saída do `status`.

**Decision**:
- Localizar o binário: procurar `ant`/`ant.exe` nas entradas de `PATH` e, no Windows, também em `%LOCALAPPDATA%\Programs\ant\ant.exe` (local usado pela instalação feita nesta máquina). Nunca usar `shell: true`.
- Executar `ant auth login --timeout 5m` com `stdio: ['ignore', 'pipe', 'pipe']` (o stdin do Maestro está em modo raw e pertence ao Ink; o processo filho não pode compartilhá‑lo). Capturar stdout/stderr; qualquer `https://…` encontrado é mostrado no diálogo como URL de autorização (cobre o caso em que o navegador não abre). O próprio `ant` abre o navegador; não usamos `--no-browser` por padrão.
- Cancelar (Esc): encerrar a árvore de processos (reutilizar `killTree` de `tools/runCommand.ts`, movido para `utils/process.ts`).
- Confirmar sucesso: código de saída 0 **e** `ant auth status` contendo `Logged in to`; além disso recalcular `credentialSources` (arquivo em `credentials/*.json`) para o Claude passar a `profile` sem reiniciar.
- Falha: código ≠ 0 ou timeout → mostrar a última linha não vazia de stderr/stdout como causa resumida.
- Detectar `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` no ambiente após o login e avisar sobre precedência (regra "a chave sombreia o perfil" da documentação).

**Alternatives considered**: implementar o fluxo OAuth dentro do Maestro — rejeitado (client_id, callback e armazenamento de perfil são da ferramenta oficial); `--no-browser` por padrão — rejeitado porque exigiria devolver o código pelo stdin do filho; mantido só como fallback visual (URL exibida quando aparecer na saída).

---

## R3. Instalação ausente da CLI `ant`

**Decision**: Quando o binário não for encontrado, o diálogo mostra instruções por plataforma: Windows — baixar `ant_<versão>_windows_amd64.zip` em `https://github.com/anthropics/anthropic-cli/releases` e extrair para uma pasta no PATH (ex.: `%LOCALAPPDATA%\Programs\ant`); macOS — `brew install anthropics/tap/ant`; Linux — `tar.gz` do mesmo release. Botão "Tentar novamente" refaz a detecção (inclui o PATH atualizado só em novas sessões do shell; por isso também olhamos o diretório padrão do Windows). Sem instalação automática nesta feature (Assumptions da spec).

---

## R4. Teste de conexão

**Decision**:
- Claude: `new Anthropic({ apiKey, baseURL }).models.retrieve(model, { timeout: 10_000 })` — valida credencial, endpoint e nome do modelo em uma chamada sem custo de tokens (endpoint `GET /v1/models/{id}`, listado na referência do SDK). Para o método "Claude Auth Login" o mesmo teste roda com o cliente sem argumentos (resolução por perfil).
- Qwen, protocolo OpenAI compatível: `new OpenAI({ apiKey, baseURL }).chat.completions.create({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }, { timeout: 10_000 })` — a disponibilidade de `GET /models` no compatible‑mode não é garantida, então usamos uma conclusão mínima (1 token).
- Qwen, protocolo Anthropic compatível: `new Anthropic({ apiKey, baseURL }).messages.create({ model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }, { timeout: 10_000 })`, pelo mesmo motivo (`/v1/models` raramente existe em endpoints compatíveis). Erros passam por `mapQwenAnthropicError` (providerId `qwen`, segredos do Qwen).

**Endpoints Qwen (revisão 2026‑10‑24)**: o DashScope `https://dashscope.aliyuncs.com/compatible-mode/v1` deixou de funcionar para o plano por tokens do Qwen Cloud. `providers.qwen.protocol` escolhe o protocolo do endpoint — `openai` (padrão, `https://token-plan.maas.qwencloudapi.com/compatible-mode/v1`) ou `anthropic` (`https://token-plan.maas.qwencloudapi.com/apps/anthropic`). `baseUrl` passou a ser opcional: sem ela vale o padrão do protocolo (`resolveQwenBaseUrl`), e o usuário continua podendo informar qualquer URL (os endpoints DashScope ficam como dica). O streaming da Messages API foi extraído para `providers/anthropicProtocol.ts` e é compartilhado pelo Claude e pelo Qwen‑Anthropic; os extras exclusivos da Anthropic (`output_config.effort`, beta `server-side-fallback`) só são enviados pelo provedor Claude.
- Erros passam pelos mapeadores existentes (`mapAnthropicError`, `mapOpenAIError`) → categoria `auth` (chave rejeitada), `network` (endpoint inacessível/timeout), `provider` com 404 (modelo desconhecido). O diálogo escolhe o campo a corrigir pela categoria.
- Resultado "não verificado" quando o usuário escolhe gravar sem testar: refletido em `ProviderStatus.verified = false` (campo novo, apenas em memória).

---

## R5. Gravação do `settings.json`

**Decision**: Novo módulo `config/writer.ts`: lê o arquivo global como JSON bruto (preservando chaves `_comment` e campos desconhecidos do usuário), aplica um patch por caminho (`providers.qwen.apiKey`, `activeProvider`, …), valida o resultado com `settingsSchema` antes de gravar, escreve em arquivo temporário e renomeia (atômico), com 2 espaços de indentação e `\n` final. Erros (EACCES, ENOSPC) viram `MaestroError` com `hint` contendo o caminho. Após gravar, o controller recarrega `settings` + `credentialSources` em memória (`applySettings`) e descarta a instância de provedor em cache.

**Aviso de sobrescrita**: se existir `./.maestro/settings.json` com a mesma chave sendo gravada, o diálogo mostra "o arquivo do projeto sobrescreve este valor".

**Alternatives considered**: `jsonc-parser` para preservar comentários reais — desnecessário, o arquivo é JSON puro com `_comment`.

---

## R6. Componentes de diálogo no Ink

**Decision**: Camada `src/ui/dialogs/`: `DialogFrame` (moldura, título, dicas de teclas; ocupa a área do transcript, respeitando o layout de altura fixa da feature 002), `SelectList` (itens com rótulo, descrição, estado, desativado; ↑/↓/Enter/Esc), `TextField` (campo com valor inicial, `mask` para chaves — exibe `•` por caractere e os 4 últimos quando confirmado — Enter avança, Esc volta, Ctrl+U limpa), `ProgressView` (spinner textual + mensagem + URL), `ResultView` (sucesso/erro + ações). Enquanto `controller.dialog` existir: `InputPrompt` inativo, `useKeyboard` ignora Esc/Ctrl+C simples (Ctrl+C duplo continua saindo), teclas de rolagem continuam válidas.

**Rationale**: reutiliza `useInput` do Ink com `isActive`, sem novas dependências; a feature 002 já estabeleceu a disciplina de altura (`flexShrink={0}`, `minHeight={0}`).

---

## R7. Máquina de estados dos fluxos (testável sem UI)

**Decision**: `src/setup/authFlow.ts` com reducer puro: estados `menu` → (`fields` ⇄ `testing` → `saving` → `activate?` → `done`) | (`login.detect` → `login.missing` | `login.running` → `login.done` | `login.failed`); eventos `select`, `input`, `next`, `back`, `cancel`, `testResult`, `saved`, `loginEvent`. Efeitos (teste, gravação, spawn) ficam em um "driver" (`setup/authDriver.ts`) que recebe funções injetáveis (`testConnection`, `writeSettings`, `antCli`) para testes. `src/setup/modelFlow.ts` é mais simples: lista → seleção → gravação.

---

## R8. `/model` sem argumentos

**Decision**: abre `ModelDialog` com itens `{ providerId, model, status, credentialSource, active }` a partir de `listStatuses`, mais "Digitar outro modelo…" (abre `TextField` para o provedor atualmente destacado). Seleção → `controller.switchProvider(id, model)` + gravação de `activeProvider` e `providers.<id>.model`. Com argumentos, comportamento textual atual preservado (`/model qwen qwen-max`).

---

## R9. Testes

- Unitários: reducers de fluxo (todas as transições), `settingsWriter` (preserva `_comment`, patch por caminho, validação, erro de escrita), `antCli` (localização por PATH/diretório padrão, parsing de `status`, extração de URL, cancelamento), `connectionTest` com SDKs mockados (sucesso, 401, timeout, 404 de modelo).
- Integração (renderSized): `/auth` abre o diálogo e desativa o prompt; fluxo Qwen completo gravando em `MAESTRO_HOME` temporário e trocando o provedor; chave inválida mostra erro e permite corrigir; Esc em cada passo; `/model` seletor troca provedor e grava; item não configurado desativado; `/auth` em `-p` imprime orientação (teste existente de `nonInteractive`).
- Contrato: campos pedidos por método e sua ordem; teclas; textos de estado; sequência exata de argumentos do `ant`.

Sem novas dependências de runtime.
