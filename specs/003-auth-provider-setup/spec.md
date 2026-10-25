# Feature Specification: Configuração de Provedores pela Sessão (/auth) e Seleção de Modelo (/model)

**Feature Branch**: `003-auth-provider-setup`  
**Created**: 2026-10-24  
**Status**: Draft  
**Input**: User description: "Crie um comando para adicionar os providers de LLM: funciona da mesma forma que o comando /auth no qwen; abre uma tela (modal para console) com os modelos que podem ser configurados: Claude API, Claude Auth Login, Qwen; o usuário segue com a configuração; no caso do Claude Auth Login, executa o comando para fazer login na Anthropic; no comando /model deve exibir o modelo ativo e todos os modelos configurados para o usuário selecionar."

## Visão Geral

Hoje, configurar um provedor no Maestro exige editar `settings.json` à mão e definir variáveis de ambiente, e trocar de modelo exige digitar `/model <id> <modelo>`. Esta feature traz a experiência do comando `/auth` do qwen code para dentro da sessão: um diálogo no console lista as formas de conexão disponíveis, guia o preenchimento (chave, endpoint, modelo), executa o login na Anthropic quando a opção for "Claude Auth Login", grava a configuração e deixa o provedor pronto para uso sem reiniciar. O comando `/model` passa a abrir um seletor com o modelo ativo e todos os modelos já configurados, além de continuar aceitando a forma por texto.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Conectar um provedor pelo diálogo `/auth` (Priority: P1)

Na sessão interativa, o usuário digita `/auth` (ou `/connect`, `/login`). Abre-se um diálogo sobre a conversa com três opções: **Claude API** (chave de API da Anthropic), **Claude Auth Login** (login no navegador, perfil OAuth) e **Qwen** (Alibaba Cloud DashScope). Cada opção mostra seu estado atual (não configurado / configurado / ativo). O usuário navega com ↑/↓, confirma com Enter e cancela com Esc. Ao escolher **Claude API** ou **Qwen**, o diálogo pede os campos necessários em sequência (chave e, no Qwen, endpoint e modelo, com valores padrão pré‑preenchidos), valida, testa a conexão com uma chamada mínima e grava em `settings.json`. Ao final, pergunta se o provedor deve se tornar o ativo. Tudo acontece sem sair da sessão e sem perder a conversa.

**Why this priority**: É o pedido central: hoje a configuração exige editar arquivo e variáveis de ambiente, o maior atrito para um usuário novo.

**Independent Test**: Partindo de um `settings.json` sem Qwen ativado, rodar `/auth`, escolher Qwen, informar uma chave válida, aceitar os padrões, confirmar como ativo e enviar uma mensagem; a resposta deve vir do Qwen e o arquivo deve conter `providers.qwen.enabled = true`. Repetir com uma chave inválida: o diálogo informa a falha do teste de conexão e permite corrigir sem fechar.

**Acceptance Scenarios**:

1. **Given** uma sessão em `idle`, **When** o usuário digita `/auth`, **Then** um diálogo aparece sobre a área da conversa listando "Claude API", "Claude Auth Login" e "Qwen", cada um com seu estado atual, e o prompt de texto fica desativado enquanto o diálogo estiver aberto.
2. **Given** o diálogo aberto, **When** o usuário pressiona Esc, **Then** o diálogo fecha sem alterar nada e o prompt volta a aceitar texto.
3. **Given** o diálogo aberto, **When** o usuário escolhe "Qwen", **Then** são pedidos, nesta ordem, endpoint (pré‑preenchido com o padrão), chave de API (digitação mascarada) e modelo (pré‑preenchido com o padrão), com Enter para avançar e Esc para voltar/cancelar.
4. **Given** os campos do Qwen preenchidos, **When** o usuário confirma, **Then** o Maestro faz um teste de conexão de poucos segundos; em sucesso grava `providers.qwen` com `enabled = true` e os valores informados; em falha mostra a causa (chave rejeitada, endpoint inacessível) e volta ao campo relevante.
5. **Given** a gravação concluída, **When** o diálogo pergunta "Usar como provedor ativo?", **Then** "Sim" troca o provedor da sessão imediatamente (histórico preservado) e grava `activeProvider`; "Não" apenas mantém o provedor disponível.
6. **Given** o diálogo aberto, **When** o usuário escolhe "Claude API", **Then** é pedida a chave de API (mascarada) e, opcionalmente, um endpoint alternativo; o restante segue como no Qwen.
7. **Given** um provedor já configurado, **When** o usuário o escolhe de novo em `/auth`, **Then** os campos aparecem pré‑preenchidos (chave mascarada, com opção de manter) para edição.
8. **Given** a sessão em `generating` ou `awaiting_confirmation`, **When** o usuário digita `/auth`, **Then** o Maestro recusa com aviso "aguarde a resposta terminar" e não abre o diálogo.
9. **Given** o modo não interativo (`-p`), **When** o prompt é `/auth`, **Then** nada é aberto e a saída orienta a configurar por `settings.json` ou variáveis de ambiente, com código de saída 0.

---

### User Story 2 - Login na Anthropic pelo diálogo (Priority: P1)

No diálogo `/auth`, o usuário escolhe **Claude Auth Login**. O Maestro verifica se a ferramenta de login da Anthropic está disponível na máquina. Se estiver, executa o login: o navegador abre, o usuário autoriza, e o Maestro acompanha o progresso mostrando "aguardando autorização no navegador…" com opção de cancelar. Ao concluir, o Maestro confirma que o perfil foi criado, marca o provedor Claude como configurado (origem da credencial: perfil) e oferece torná‑lo ativo. Se a ferramenta não estiver instalada, o diálogo explica isso e mostra como obtê‑la, com opção de tentar novamente após a instalação.

**Why this priority**: É a única forma de usar Claude sem chave de API e foi um dos pontos de atrito já observados neste projeto (a CLI não estava instalada e o nome do pacote estava errado na documentação).

**Independent Test**: Com a ferramenta instalada e nenhum perfil, escolher "Claude Auth Login", concluir no navegador e verificar que `/model` mostra Claude como configurado via perfil e que uma mensagem recebe resposta. Sem a ferramenta instalada, escolher a opção e verificar a tela de instruções com o botão de tentar novamente.

**Acceptance Scenarios**:

1. **Given** a ferramenta de login disponível, **When** o usuário escolhe "Claude Auth Login", **Then** o login é iniciado, o diálogo mostra o estado "aguardando autorização no navegador…" e, quando o terminal não consegue abrir o navegador, exibe a URL para o usuário abrir manualmente.
2. **Given** o login em andamento, **When** o usuário autoriza no navegador, **Then** o diálogo mostra "login concluído", o estado do Claude passa a "configurado (perfil)" e é oferecida a opção de torná‑lo ativo.
3. **Given** o login em andamento, **When** o usuário pressiona Esc, **Then** o processo de login é interrompido e o diálogo volta à lista sem alterar a configuração.
4. **Given** a ferramenta de login ausente, **When** o usuário escolhe "Claude Auth Login", **Then** o diálogo informa que a ferramenta não foi encontrada, mostra a instrução de instalação adequada ao sistema (Windows: baixar e colocar no PATH; macOS: comando do gerenciador de pacotes) e oferece "Tentar novamente" e "Voltar".
5. **Given** o login falha (negado, expirado, sem rede), **When** o processo termina, **Then** o diálogo mostra a causa resumida e oferece tentar de novo ou voltar.
6. **Given** uma chave de API Claude já definida no ambiente, **When** o usuário conclui o login por perfil, **Then** o diálogo avisa que a chave do ambiente tem precedência sobre o perfil e explica como removê‑la se quiser usar o perfil.

---

### User Story 3 - Selecionar o modelo ativo pelo diálogo `/model` (Priority: P2)

O usuário digita `/model` sem argumentos. Em vez de apenas uma tabela em texto, abre um seletor com o modelo ativo em destaque e, abaixo, todos os provedores configurados com seus modelos. Cada item mostra provedor, modelo e origem da credencial. ↑/↓ navegam, Enter seleciona e troca o provedor/modelo da sessão (histórico preservado), Esc fecha sem mudar nada. Um item final "Digitar outro modelo…" permite informar um nome de modelo diferente para o provedor escolhido. Provedores não configurados aparecem desativados, com atalho para abrir `/auth`. A forma textual `/model <id> [modelo]` continua funcionando como hoje.

**Why this priority**: Completa o fluxo: depois de conectar provedores, o usuário precisa alternar entre eles sem lembrar ids e nomes de modelo.

**Independent Test**: Com Claude e Qwen configurados, `/model` lista os dois com o ativo marcado; selecionar o outro e enviar uma mensagem confirma a troca; `/model qwen` por texto continua trocando sem abrir o diálogo.

**Acceptance Scenarios**:

1. **Given** dois provedores configurados, **When** o usuário digita `/model`, **Then** um seletor mostra o item ativo marcado e os demais configurados, com provedor, modelo e origem da credencial (mascarada quando for chave).
2. **Given** o seletor aberto, **When** o usuário escolhe outro item e pressiona Enter, **Then** o provedor/modelo da sessão muda, o cabeçalho reflete a troca, uma linha confirma na conversa e o histórico é preservado.
3. **Given** o seletor aberto, **When** o usuário escolhe "Digitar outro modelo…", **Then** é pedido o nome do modelo para o provedor atual e, ao confirmar, a sessão passa a usá‑lo.
4. **Given** um provedor não configurado, **When** aparece no seletor, **Then** está visualmente desativado, não pode ser selecionado e indica "configure com /auth".
5. **Given** a sessão em `generating`, **When** o usuário digita `/model`, **Then** o Maestro recusa com aviso e não abre o seletor.
6. **Given** o usuário digita `/model qwen qwen-max`, **When** o comando é processado, **Then** a troca acontece diretamente, sem abrir o diálogo, com o mesmo comportamento da versão anterior.
7. **Given** o modelo escolhido no seletor, **When** o usuário confirma, **Then** a escolha também é gravada em `settings.json` como `activeProvider` e modelo do provedor, para valer nas próximas execuções.

---

### Edge Cases

- O que acontece se `settings.json` não puder ser gravado (sem permissão, disco cheio)? O diálogo informa o caminho e o erro, mantém a configuração em memória para a sessão atual e avisa que ela não persistirá.
- O que acontece se o teste de conexão demorar? Limite de 10 segundos com indicador de progresso e opção de cancelar; estouro é tratado como falha de rede, com opção de gravar mesmo assim.
- O que acontece se o usuário colar uma chave com espaços ou quebras de linha? São removidos antes da validação.
- O que acontece se existir um `settings.json` de projeto (`./.maestro/`)? O diálogo grava no arquivo global por padrão e avisa quando o arquivo de projeto sobrescrever a chave que está sendo configurada.
- O que acontece se o terminal for redimensionado com o diálogo aberto? O diálogo reflui dentro da área disponível; em terminais no modo mínimo (12×40) o diálogo ocupa a área da conversa inteira.
- O que acontece se o login da Anthropic ficar aguardando indefinidamente? Após 5 minutos o diálogo oferece cancelar; o processo é encerrado ao cancelar ou ao sair do Maestro.
- O que acontece com uma chave inválida que o usuário insiste em gravar? A opção "gravar sem testar" existe, mas o estado do provedor fica "configurado (não verificado)" até a primeira resposta bem‑sucedida.
- O que acontece com a chave em tela e logs? Nunca aparece em texto claro: digitação mascarada, exibição só dos últimos 4 caracteres, logs de depuração mascarados.

## Requirements *(mandatory)*

### Functional Requirements

**Comando `/auth`**

- **FR-001**: O sistema MUST oferecer o comando `/auth`, com apelidos `/connect` e `/login`, que abre um diálogo modal sobre a conversa listando as formas de conexão: "Claude API", "Claude Auth Login" e "Qwen".
- **FR-002**: Cada item do diálogo MUST exibir o estado atual do provedor correspondente: não configurado, configurado (com a origem da credencial: chave, perfil ou ambiente) ou ativo.
- **FR-003**: Enquanto um diálogo estiver aberto, o prompt de texto MUST ficar desativado e as teclas MUST ser roteadas ao diálogo (↑/↓ navegar, Enter confirmar, Esc voltar/cancelar).
- **FR-004**: O diálogo MUST ser recusado com aviso quando a sessão não estiver ociosa, e MUST ser indisponível no modo não interativo, onde `/auth` imprime orientação textual e retorna código 0.
- **FR-005**: Para "Claude API", o sistema MUST pedir a chave de API (digitação mascarada) e, opcionalmente, endpoint alternativo e modelo (pré‑preenchido com o padrão).
- **FR-006**: Para "Qwen", o sistema MUST pedir endpoint (pré‑preenchido com o padrão, com a alternativa internacional sugerida), chave de API (mascarada) e modelo (pré‑preenchido com o padrão).
- **FR-007**: O sistema MUST validar os campos antes de gravar (endpoint com `http://`/`https://`, chave não vazia, modelo não vazio) e remover espaços e quebras de linha de chaves coladas.
- **FR-008**: O sistema MUST executar um teste de conexão com limite de 10 segundos antes de gravar, mostrar a causa em caso de falha e permitir corrigir o campo relevante ou gravar sem testar.
- **FR-009**: O sistema MUST gravar a configuração em `settings.json` global, marcando o provedor como `enabled`, e MUST avisar quando um `settings.json` de projeto sobrescrever a chave configurada.
- **FR-010**: Ao final, o sistema MUST perguntar se o provedor deve se tornar o ativo; em caso afirmativo MUST trocar o provedor da sessão imediatamente, preservando o histórico, e gravar `activeProvider`.
- **FR-011**: Para um provedor já configurado, o diálogo MUST pré‑preencher os campos (chave mascarada, com opção de manter a atual) para edição.
- **FR-012**: Falha ao gravar o arquivo MUST ser informada com caminho e causa, mantendo a configuração em memória para a sessão atual.

**Claude Auth Login**

- **FR-013**: Para "Claude Auth Login", o sistema MUST verificar se a ferramenta de login da Anthropic está disponível na máquina; se não estiver, MUST exibir instruções de instalação específicas do sistema operacional e oferecer "Tentar novamente" e "Voltar".
- **FR-014**: Com a ferramenta disponível, o sistema MUST iniciar o login, mostrar o progresso ("aguardando autorização no navegador…"), exibir a URL de autorização quando o navegador não abrir, e permitir cancelar com Esc, encerrando o processo.
- **FR-015**: Ao concluir o login, o sistema MUST verificar que um perfil ficou disponível, atualizar o estado do Claude para "configurado (perfil)" sem exigir reinício e oferecer torná‑lo ativo.
- **FR-016**: Em falha ou expiração do login (limite de 5 minutos), o sistema MUST mostrar a causa resumida e oferecer tentar de novo ou voltar.
- **FR-017**: Quando houver chave de API Claude no ambiente, o sistema MUST avisar que ela tem precedência sobre o perfil e como removê‑la.

**Comando `/model`**

- **FR-018**: `/model` sem argumentos MUST abrir um seletor com o item ativo em destaque e todos os provedores configurados, mostrando provedor, modelo e origem da credencial (chave mascarada).
- **FR-019**: Selecionar um item MUST trocar provedor/modelo da sessão preservando o histórico, refletir no cabeçalho, registrar uma linha de confirmação e gravar `activeProvider` e o modelo em `settings.json`.
- **FR-020**: O seletor MUST oferecer "Digitar outro modelo…" para informar um nome de modelo para o provedor escolhido.
- **FR-021**: Provedores não configurados MUST aparecer desativados no seletor, com indicação "configure com /auth", e não podem ser selecionados.
- **FR-022**: `/model <id> [modelo]` MUST continuar funcionando por texto, sem abrir o seletor, com o comportamento atual.
- **FR-023**: `/model` MUST ser recusado com aviso quando a sessão não estiver ociosa.

**Segurança e compatibilidade**

- **FR-024**: Chaves MUST NOT aparecer em texto claro em nenhum momento: digitação mascarada, exibição só dos últimos 4 caracteres, logs mascarados.
- **FR-025**: Os diálogos MUST respeitar o layout de tela cheia da feature 002 (altura limitada, sem crescer o scrollback) e funcionar sem cores.
- **FR-026**: Todos os comportamentos das features 001 e 002 MUST permanecer inalterados, incluindo configuração por arquivo e variáveis de ambiente, que continuam válidas e com a mesma precedência.

### Key Entities

- **Método de Conexão**: uma forma de conectar um provedor. Atributos: identificador (`claude-api`, `claude-login`, `qwen`), rótulo, provedor alvo, campos exigidos (endpoint, chave, modelo), se exige processo externo (login), estado atual derivado da configuração.
- **Diálogo**: estado da interface modal. Atributos: tipo (`auth`, `model`), passo atual (lista, campo, teste, confirmação, progresso de login, erro), item selecionado, valores dos campos, mensagem de erro, processo externo em andamento.
- **Resultado do Teste de Conexão**: sucesso ou falha com categoria (chave rejeitada, endpoint inacessível, tempo esgotado, modelo desconhecido) e mensagem resumida.
- **Configuração** (existente): ganha gravação parcial por provedor e de `activeProvider` a partir da sessão.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Um usuário sem nenhum provedor configurado consegue, só com `/auth`, deixar o Qwen pronto e receber a primeira resposta em menos de 2 minutos, sem editar arquivos nem definir variáveis de ambiente.
- **SC-002**: Com a ferramenta de login disponível, o fluxo "Claude Auth Login" do início ao primeiro uso leva menos de 3 minutos, incluindo a autorização no navegador.
- **SC-003**: 100% das falhas de chave, endpoint e login mostram uma causa compreensível no próprio diálogo, sem fechar a sessão nem perder a conversa.
- **SC-004**: Trocar de modelo pelo seletor `/model` leva no máximo 3 teclas (abrir, mover, confirmar) e menos de 1 segundo para refletir no cabeçalho.
- **SC-005**: Nenhuma chave aparece em texto claro em tela, logs ou arquivos de teste em qualquer cenário.
- **SC-006**: Todas as configurações feitas pelos diálogos persistem entre execuções: ao reabrir o Maestro, `/model` mostra os mesmos provedores configurados e o mesmo ativo.
- **SC-007**: A suíte de testes das features 001 e 002 continua passando integralmente.

## Assumptions

- **Nome do comando**: `/auth`, como no qwen code, com apelidos `/connect` e `/login`.
- **Ferramenta de login**: "executar o comando para fazer login na Anthropic" significa invocar a ferramenta oficial de linha de comando da Anthropic já instalada na máquina (a mesma usada nesta sessão, `ant auth login`), que cria um perfil reutilizado pelo Maestro. O Maestro **não** instala a ferramenta automaticamente; mostra instruções e oferece tentar novamente. Instalação automática pode vir em feature futura.
- **Onde gravar**: sempre no `settings.json` global do usuário. O arquivo de projeto continua sendo editado manualmente.
- **Chave de API**: gravada no `settings.json` quando informada pelo diálogo; variáveis de ambiente continuam tendo precedência, e o diálogo avisa quando uma variável estiver sobrescrevendo o que foi configurado.
- **Teste de conexão**: uma requisição mínima ao provedor (pedir uma resposta curtíssima) com limite de 10 segundos; falha não impede gravar, mas marca o estado como "não verificado".
- **Lista de métodos**: fixa nesta versão (Claude API, Claude Auth Login, Qwen). Novos provedores entram pelo registro de provedores já existente.
- **Modelos sugeridos**: o seletor lista o modelo configurado de cada provedor; não consulta a API para listar todos os modelos disponíveis (fica para feature futura).
- **Escopo excluído**: remover provedores pelo diálogo (continua por arquivo), configuração por projeto via diálogo, múltiplas chaves por provedor, instalação automática da ferramenta de login, listagem dinâmica de modelos.
