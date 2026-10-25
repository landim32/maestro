# Feature Specification: Colar Arquivos, Copiar Seleção e Colagens Grandes no Console

**Feature Branch**: `007-paste-copy-console`  
**Created**: 2026-10-25  
**Status**: Draft  
**Input**: User description: "Implemente alguns recursos que encontrei no qwen-code: colar arquivos no console para passar para os modelos LLM; permitir copiar do console, bastando eu selecionar um texto e ele copiar automaticamente; quando colar um texto grande, não exibir o texto todo, apenas um [Pasted text #1 +10 lines], mas o texto que vai para o modelo LLM é o completo."

## Visão Geral

Hoje o prompt do Maestro trata tudo que chega pelo teclado como texto literal: colar um trecho de 200 linhas enche o prompt (que mostra só as últimas dez linhas e o marcador ⋮), colar o caminho de um arquivo não passa de uma string, e, como o Maestro ativa o rastreamento do mouse para rolar a transcrição com a roda, a seleção nativa do terminal deixa de funcionar — o usuário não consegue copiar o que o modelo respondeu.

Esta feature traz três recursos de uso diário, no espírito do qwen-code:

1. **Colagens grandes colapsadas**: um texto colado com várias linhas aparece no prompt e na transcrição como um marcador curto `[Pasted text #1 +10 lines]`, mas o modelo recebe o texto completo. O marcador pode ser expandido para conferência e removido como um bloco só.
2. **Colar arquivos**: colar ou arrastar o caminho de um arquivo (ou de vários) para o prompt anexa o arquivo à mensagem: o modelo recebe o conteúdo; o prompt e a transcrição mostram um marcador `[Arquivo: nome.ext, N linhas]`.
3. **Copiar do console**: selecionar um texto na transcrição com o mouse copia-o automaticamente para a área de transferência, mesmo com a rolagem por roda ativa; o usuário pode também desligar o rastreamento do mouse e usar a seleção nativa do terminal.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Colar um texto grande sem poluir o prompt (Priority: P1)

O usuário cola no prompt um trecho de código ou log com várias linhas. Em vez de o texto inteiro aparecer, o prompt mostra um marcador `[Pasted text #1 +42 lines]` na posição do cursor; ele pode continuar digitando antes ou depois do marcador ("explique este erro: [Pasted text #1 +42 lines]"). Ao enviar, a transcrição mostra a mensagem com o marcador, e o modelo recebe a mensagem com o texto completo no lugar do marcador. Backspace sobre o marcador remove a colagem inteira; uma tecla de expansão mostra o conteúdo para conferência.

**Why this priority**: É o incômodo mais frequente: logs e trechos de código colados tornam o prompt ilegível e o histórico ↑/↓ inútil. É também a base dos anexos de arquivo (mesmo mecanismo de marcador).

**Independent Test**: Colar 42 linhas, verificar o marcador no prompt, digitar texto em volta, enviar, verificar que o provedor recebeu o texto completo e que a transcrição mostra o marcador; colar duas vezes e verificar `#1` e `#2`; Backspace sobre o marcador remove tudo de uma vez.

**Acceptance Scenarios**:

1. **Given** o prompt ativo, **When** o usuário cola um texto com mais de um número configurável de linhas (padrão: 3), **Then** o prompt mostra `[Pasted text #N +L lines]` (N sequencial na sessão, L = número de linhas) no lugar do texto, e o cursor fica depois do marcador.
2. **Given** um texto colado com até esse limite de linhas, **When** colado, **Then** ele entra como texto normal, sem marcador.
3. **Given** um marcador no prompt, **When** o usuário envia a mensagem, **Then** o modelo recebe o texto da mensagem com o conteúdo completo da colagem no lugar do marcador, delimitado para que o modelo saiba onde começa e termina; a transcrição mostra a mensagem com o marcador.
4. **Given** um marcador no prompt, **When** o usuário aperta Backspace com o cursor logo após o marcador (ou Delete logo antes), **Then** o marcador inteiro é removido; as setas ← → pulam o marcador como uma unidade.
5. **Given** um marcador no prompt, **When** o usuário aciona a expansão (tecla documentada), **Then** o conteúdo é exibido para conferência (sem entrar no texto do prompt) e some ao continuar digitando ou ao acionar de novo.
6. **Given** uma mensagem com marcador enviada, **When** o usuário recupera a entrada pelo histórico ↑/↓, **Then** o prompt mostra o marcador e o conteúdo continua disponível para reenvio na mesma sessão; entre sessões, o histórico guarda só o texto visível (o marcador), nunca a colagem.
7. **Given** o modo não interativo (`-p`) ou entrada por stdin, **When** o texto é processado, **Then** nada é colapsado: o comportamento atual se mantém.

---

### User Story 2 - Colar ou arrastar arquivos para a conversa (Priority: P2)

O usuário arrasta um arquivo do explorador para a janela do terminal (o terminal insere o caminho) ou cola um caminho. O Maestro reconhece que o texto colado é o caminho de um arquivo existente e o anexa: o prompt mostra `[Arquivo: relatorio.log, 230 linhas]`; o modelo recebe o conteúdo do arquivo identificado pelo nome. Vários caminhos colados de uma vez viram vários anexos. Arquivos binários, muito grandes ou fora da pasta de trabalho são recusados com explicação, sem travar o prompt.

**Why this priority**: É a forma mais rápida de dar contexto ao modelo sem pedir que ele leia o arquivo com ferramentas (que em `--no-tools` nem existem). Depende do mecanismo de marcador da US1.

**Independent Test**: Colar o caminho de um arquivo texto da pasta de trabalho e verificar o marcador e o conteúdo enviado; colar dois caminhos separados por espaço ou quebra de linha; colar o caminho de um binário e verificar a recusa; colar um caminho inexistente e verificar que entra como texto comum.

**Acceptance Scenarios**:

1. **Given** o prompt ativo, **When** o usuário cola um texto que é exatamente o caminho de um arquivo texto existente (absoluto, relativo, com ou sem aspas, com `file://`), **Then** o prompt mostra `[Arquivo: <nome>, <N> linhas]` e o anexo fica associado à mensagem.
2. **Given** vários caminhos colados de uma vez (separados por espaço, quebra de linha ou aspas), **When** todos existem, **Then** cada um vira um marcador; caminhos que não existem permanecem como texto.
3. **Given** uma mensagem com anexos, **When** enviada, **Then** o modelo recebe, no lugar de cada marcador, o conteúdo do arquivo delimitado e identificado pelo caminho relativo; a transcrição mostra os marcadores.
4. **Given** um arquivo binário, maior que um limite configurável (padrão: 512 KB) ou fora da pasta de trabalho, **When** colado, **Then** o Maestro mostra um aviso explicando o motivo e o caminho entra como texto comum, sem anexo.
5. **Given** um marcador de arquivo, **When** o usuário o expande, **Then** vê o início do conteúdo e o tamanho; Backspace remove o anexo inteiro.
6. **Given** um caminho de imagem (PNG, JPEG, GIF, WebP) colado, **When** o provedor ativo aceita imagens, **Then** a imagem é anexada e enviada como imagem (US3); caso contrário, o aviso explica que o provedor não aceita imagens.

---

### User Story 3 - Copiar do console selecionando com o mouse (Priority: P2)

O usuário arrasta o mouse sobre um trecho da resposta na transcrição; o trecho fica destacado e, ao soltar o botão, é copiado para a área de transferência do sistema, com um aviso curto "copiado (N linhas)". Funciona mesmo com a rolagem por roda ativa (que hoje impede a seleção nativa do terminal). Quem preferir a seleção nativa do terminal pode desligar o rastreamento do mouse (`ui.mouse: false` ou uma tecla de alternância), e aí o Maestro não intercepta o mouse.

**Why this priority**: Hoje copiar uma resposta é impossível sem desligar o mouse na configuração, e quase ninguém descobre isso. É independente das outras histórias.

**Independent Test**: Com o mouse ativo, arrastar sobre três linhas da transcrição e verificar o destaque e o conteúdo copiado (texto puro, sem cores, sem marcadores de rolagem); com `ui.mouse: false`, verificar que nenhum evento de mouse é interceptado e a seleção nativa continua possível.

**Acceptance Scenarios**:

1. **Given** rastreamento do mouse ativo, **When** o usuário pressiona o botão esquerdo na transcrição e arrasta, **Then** as linhas e colunas entre o início e a posição atual ficam destacadas; ao soltar, o texto selecionado (sem formatação) vai para a área de transferência e a barra de status mostra `copiado (N linhas)`.
2. **Given** uma seleção em andamento, **When** o usuário rola com a roda, **Then** a seleção acompanha o conteúdo (é ancorada ao texto, não à tela).
3. **Given** um clique sem arrastar, **When** solto, **Then** nenhuma seleção é feita e nada é copiado; um clique duplo seleciona a palavra; triplo, a linha.
4. **Given** a área de transferência indisponível (sem utilitário no sistema ou sessão remota sem suporte), **When** o usuário solta a seleção, **Then** o Maestro avisa que não conseguiu copiar e mostra como desligar o mouse para usar a seleção nativa.
5. **Given** `ui.mouse: false` (ou a tecla de alternância desligou o mouse), **When** o usuário seleciona com o mouse, **Then** o terminal faz a seleção nativa como em qualquer programa; a barra de status indica "mouse desligado".
6. **Given** uma seleção ativa, **When** o usuário digita ou aperta Esc, **Then** o destaque some.
7. **Given** a sessão termina, **When** o Maestro sai, **Then** o rastreamento do mouse é desligado e o terminal volta ao normal (comportamento atual preservado).

---

### User Story 4 - Imagens para provedores que as aceitam (Priority: P3)

Quando o arquivo anexado é uma imagem e o provedor ativo aceita imagens, o modelo a recebe como imagem (não como texto). O marcador mostra `[Imagem: foto.png, 120 KB]`. Com um provedor sem suporte, o anexo é recusado com aviso.

**Why this priority**: Fecha o caso "colar um print da tela para o modelo olhar", comum no qwen-code; depende de cada provedor e por isso vem por último.

**Independent Test**: Anexar um PNG com o Claude ativo e verificar que a requisição ao provedor carrega a imagem; trocar para um provedor sem suporte e verificar o aviso.

**Acceptance Scenarios**:

1. **Given** o Claude ativo, **When** o usuário anexa um PNG/JPEG/GIF/WebP de até um limite configurável (padrão: 5 MB), **Then** a requisição ao modelo contém a imagem e o texto da mensagem; a transcrição mostra o marcador.
2. **Given** um provedor sem suporte a imagens, **When** o usuário anexa uma imagem, **Then** o aviso explica e o caminho entra como texto comum.
3. **Given** uma imagem acima do limite, **When** colada, **Then** é recusada com o tamanho e o limite no aviso.

---

### Edge Cases

- **Terminal sem "colagem com delimitadores"** (bracketed paste): o Maestro não distingue colar de digitar rápido; nesse caso só o primeiro recurso que não depende da detecção funciona (caminhos colados ainda são reconhecidos ao enviar), e a documentação lista os terminais testados.
- **Colagem no meio de um comando `/`** (ex.: `/speckit.specify ` + colagem grande): o marcador entra como argumento e o comando recebe o texto completo.
- **Colagem em campo de diálogo** (`/auth`, `ask_user` "Outro…"): nada é colapsado nem anexado; o texto entra literal, como hoje; chaves continuam mascaradas.
- **Colagem que é caminho mas o usuário queria o texto**: Backspace sobre o marcador remove o anexo; recolar com aspas simples ao redor força texto literal. Documentado.
- **Arquivo alterado entre colar e enviar**: o conteúdo é lido no envio; o marcador mostra a contagem de linhas do momento da colagem e é atualizado no envio se mudou.
- **Mensagem só com marcadores, sem texto**: enviada mesmo assim; o modelo recebe os conteúdos com uma instrução mínima de contexto ("o usuário anexou…").
- **Muitos marcadores ou anexos grandes**: um limite total por mensagem (padrão: 2 MB) evita estourar o contexto; acima dele o Maestro avisa antes de enviar.
- **Seleção de mouse sobre o prompt ou a barra de status**: ignorada; só a transcrição é selecionável.
- **Terminal que reporta o mouse mas sem suporte a arrastar** (alguns multiplexadores): sem evento de movimento, a seleção é entre o ponto de pressionar e o de soltar.
- **Windows Terminal, ConPTY**: a cópia usa o utilitário do sistema disponível (clip/pbcopy/xclip/wl-copy/OSC 52 como alternativa); a documentação lista a ordem tentada.
- **`-p`**: nenhum dos recursos de UI se aplica; `-p -` com arquivo grande em stdin continua funcionando como hoje.

## Requirements *(mandatory)*

### Functional Requirements

**Colagens grandes**

- **FR-001**: O prompt MUST detectar uma colagem (texto recebido de uma vez pelo terminal) e, quando ela tiver mais linhas que `ui.pasteCollapseLines` (padrão 3), substituí‑la por um marcador `[Pasted text #N +L lines]`, com N sequencial na sessão e L o número de linhas, mantendo o conteúdo completo associado ao marcador.
- **FR-002**: Marcadores MUST ser unidades indivisíveis no editor: ← → os pulam, Backspace/Delete os removem inteiros, e o texto pode ser editado antes e depois deles.
- **FR-003**: Ao enviar, o texto entregue ao modelo MUST ter cada marcador substituído pelo conteúdo completo, delimitado (início/fim e número) para que o modelo o identifique; a transcrição e o histórico de entradas MUST mostrar o texto com os marcadores.
- **FR-004**: Uma tecla documentada MUST expandir/recolher a visualização do conteúdo de um marcador sem alterar o texto do prompt.
- **FR-005**: Colagens com até `ui.pasteCollapseLines` linhas MUST entrar como texto normal; campos de diálogo e o modo `-p` MUST NOT colapsar nem anexar nada.
- **FR-006**: Dentro da mesma sessão, uma entrada com marcadores recuperada pelo histórico ↑/↓ MUST reenviar o conteúdo completo; o arquivo `history.jsonl` MUST guardar só o texto visível.

**Arquivos**

- **FR-007**: Quando o texto colado for (ou contiver, separados por espaço, quebra de linha ou aspas) caminhos de arquivos existentes, o Maestro MUST transformar cada caminho em um anexo com marcador `[Arquivo: <nome>, <N> linhas]`; caminhos inexistentes permanecem texto. Formas aceitas: absoluto, relativo à pasta de trabalho, com aspas simples/duplas, `file://`.
- **FR-008**: Anexos MUST ser recusados, com aviso que explique o motivo, quando o arquivo for binário, exceder `ui.attachMaxBytes` (padrão 512 KB) ou estiver fora da pasta de trabalho; nesse caso o caminho entra como texto.
- **FR-009**: Ao enviar, cada marcador de arquivo MUST ser substituído pelo conteúdo do arquivo (lido no envio), delimitado e identificado pelo caminho relativo; o total de conteúdo anexado por mensagem MUST respeitar `ui.attachMaxTotalBytes` (padrão 2 MB), com aviso antes do envio quando ultrapassado.
- **FR-010**: Imagens (PNG, JPEG, GIF, WebP) MUST ser anexadas como imagem quando o provedor ativo declarar suporte, até `ui.imageMaxBytes` (padrão 5 MB); caso contrário MUST ser recusadas com aviso. O marcador é `[Imagem: <nome>, <tamanho>]`.

**Cópia**

- **FR-011**: Com o rastreamento do mouse ativo, arrastar com o botão esquerdo sobre a transcrição MUST destacar a seleção (ancorada ao conteúdo, sobrevivendo à rolagem) e, ao soltar, copiar o texto puro para a área de transferência do sistema, confirmando na barra de status com o número de linhas.
- **FR-012**: Clique duplo MUST selecionar a palavra e triplo a linha; clique sem arrastar não seleciona; digitar ou Esc limpa o destaque; prompt e barra de status não são selecionáveis.
- **FR-013**: A cópia MUST tentar os meios disponíveis no sistema em ordem documentada e, se nenhum funcionar, avisar e orientar a desligar o mouse para usar a seleção nativa.
- **FR-014**: O usuário MUST poder alternar o rastreamento do mouse durante a sessão por um comando ou tecla documentados, além de `ui.mouse` na configuração; com o mouse desligado, o Maestro MUST NOT interceptar eventos de mouse e a barra de status indica o estado.
- **FR-015**: O texto copiado MUST ser texto puro: sem cores, sem o indicador de rolagem, sem os marcadores de layout da interface; mensagens do modelo são copiadas como texto renderizado (não o markdown bruto), salvo blocos de código, que preservam o conteúdo literal.

**Geral**

- **FR-016**: Todos os limites (`ui.pasteCollapseLines`, `ui.attachMaxBytes`, `ui.attachMaxTotalBytes`, `ui.imageMaxBytes`) MUST ser configuráveis em `settings.json` com os padrões acima e validados como os demais.
- **FR-017**: `/help` e o README MUST documentar os marcadores, a tecla de expansão, as regras de anexo, a cópia por seleção e a alternância do mouse.

### Key Entities *(include if feature involves data)*

- **Marcador (chip) no prompt**: tipo (`paste` | `file` | `image`), número de sequência, rótulo exibido, conteúdo completo (texto, ou caminho + bytes), posição no texto do prompt, estado expandido/recolhido.
- **Mensagem composta**: texto visível (com marcadores) e texto/partes enviados ao modelo (marcadores substituídos pelo conteúdo delimitado; imagens como partes de imagem).
- **Anexo de arquivo**: caminho relativo, tamanho, número de linhas, tipo detectado (texto/binário/imagem), motivo de recusa quando houver.
- **Seleção**: âncora e extremidade (linha e coluna no conteúdo da transcrição), texto puro resultante, estado (arrastando/concluída/limpa).
- **Configuração de UI**: limites de colagem e anexos, estado do mouse.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Colar 500 linhas no prompt mostra um único marcador em menos de 100 ms e o prompt continua com uma linha; o modelo recebe as 500 linhas íntegras (comparação byte a byte).
- **SC-002**: 100% dos caminhos de arquivos texto existentes colados dentro da pasta de trabalho viram anexos; 100% dos binários, grandes ou externos são recusados com aviso e sem travar o prompt.
- **SC-003**: Selecionar e soltar sobre a transcrição copia o texto em menos de 200 ms, e o conteúdo copiado é idêntico ao texto visível selecionado (sem códigos de cor), em Windows Terminal, macOS Terminal/iTerm2 e um terminal Linux com X11 ou Wayland.
- **SC-004**: Com `ui.mouse: false`, zero sequências de rastreamento de mouse são escritas no terminal (verificável pelo teste de E/S de terminal existente).
- **SC-005**: Um usuário descobre como copiar e como colar arquivos lendo apenas o `/help` (tempo para a primeira cópia bem-sucedida abaixo de 1 minuto em teste com usuário novo).

## Assumptions

- A detecção de colagem usa o modo de colagem com delimitadores do terminal (bracketed paste), suportado por Windows Terminal, iTerm2, Terminal.app, GNOME Terminal, Alacritty, kitty, WezTerm e tmux; terminais sem suporte só perdem o colapso de colagens grandes.
- "Colar arquivos" significa colar ou arrastar o caminho do arquivo (o que os terminais fazem ao soltar um arquivo na janela); não há acesso ao conteúdo da área de transferência de imagens do sistema nesta feature.
- Conteúdo de arquivos texto é enviado ao modelo como texto delimitado; imagens só para provedores que declarem suporte (Claude sim; Qwen depende do modelo e fica como "não suportado" até ser confirmado).
- A tecla de expansão do marcador é Ctrl+O (livre no prompt); a alternância do mouse é `/mouse` e Ctrl+M? (a definir no plano entre `/mouse` e uma tecla; o comando é obrigatório, a tecla opcional).
- A cópia usa, em ordem: utilitário nativo do sistema (`clip.exe`/`powershell Set-Clipboard` no Windows, `pbcopy` no macOS, `wl-copy`/`xclip`/`xsel` no Linux) e, como alternativa, a sequência OSC 52 do terminal; sem dependências de pacotes nativos.
- A seleção com mouse é em coordenadas do conteúdo (linhas lógicas da transcrição), não da tela, para sobreviver à rolagem e ao redimensionamento; a interação no prompt e na barra de status continua só por teclado.
- Esta feature reutiliza o rastreamento de mouse (SGR) já existente, o `InputPrompt` com cursor da feature 006/correções, e as partes de conteúdo dos provedores; não introduz dependências novas.
