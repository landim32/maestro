# Maestro Constitution

Princípios que toda feature do Maestro deve respeitar. O `/speckit.plan` avalia cada plano contra
eles na seção "Constitution Check"; violações precisam de justificativa explícita em
"Complexity Tracking".

## Core Principles

### I. Simplicidade (YAGNI)

Cada feature entrega o que a spec pede e nada além. Sem dependências novas quando o stack atual
resolve; sem abstrações para um único uso; sem configuração para o que tem um padrão óbvio.
Alternativas mais complexas são registradas em `research.md` como "consideradas e rejeitadas".

### II. CLI com entrada e saída em texto

Tudo que funciona na sessão interativa precisa de um equivalente textual: o modo `-p` recebe o
prompt por argumento ou stdin, escreve a resposta em stdout e avisos/erros em stderr, e sai com
os códigos documentados. Nenhuma funcionalidade pode exigir o TTY para ser usada em scripts.

### III. Testabilidade

Lógica de fluxo é escrita como reducers puros; efeitos (rede, disco, processos, UI) ficam atrás
de interfaces injetáveis. Nenhum teste acessa a rede: os SDKs são mockados. Testes de UI usam o
terminal falso dimensionado e esperam por frames, nunca por tempos fixos. Toda feature chega
com testes unitários, de contrato e de integração que fixam seus contratos.

### IV. Segurança de credenciais

Chaves nunca aparecem em tela, transcrição, histórico de entradas ou logs; só os últimos quatro
caracteres via `mask()`. Entradas de diálogo não entram no histórico. Logs registram caminhos
de configuração e contadores, nunca valores. Erros de SDK são saneados antes de cruzar a
fronteira do provedor. Um teste em `tests/unit/security/` garante cada uma dessas regras.

### V. Observabilidade mínima

`--debug` grava um log estruturado (`~/.maestro/debug.log`) com eventos nomeados e dados
suficientes para diagnosticar — sem conteúdo do usuário. Mensagens de erro ao usuário são
claras, em português, e apontam o que fazer.

### VI. Open-source permanente

O Maestro é software livre sob a licença MIT e assim permanecerá. O pacote nunca é marcado como
privado, o manifesto declara a licença, e o repositório público em
https://github.com/landim32/maestro é a fonte canônica. Mudanças de licença só para outra licença
permissiva equivalente, por emenda desta constituição.

### VII. Atribuição de terceiros

Todo código copiado ou adaptado de outro projeto traz, nas primeiras linhas do arquivo, a
origem (projeto, caminho, commit), o aviso de copyright original, a licença (SPDX) e a indicação
de que foi modificado para o Maestro; e ganha uma entrada em `THIRD_PARTY_NOTICES.md`, que
reproduz as licenças exigidas. Só entra código sob licenças compatíveis com a MIT. Um teste
(`tests/unit/license/attribution.test.ts`) falha se um arquivo listado perder o cabeçalho ou se
um cabeçalho aparecer fora da lista.

## Restrições

- TypeScript 5.9, Node.js ≥ 22, ESM com extensões `.js` explícitas; Ink 8 + React 19 na UI; zod 4
  para validação; vitest para testes.
- Núcleo agnóstico de provedor: só `src/providers/<id>.ts` importa SDKs.
- Ferramentas confinam escritas e comandos à pasta de trabalho, independentemente do modo de
  aprovação.
- Versão derivada do GitVersion (commits `fix:`/`feat:`/`major:`); nunca codificada.

## Fluxo de desenvolvimento

Spec Kit: `/speckit.specify` → `/speckit.plan` → `/speckit.tasks` → `/speckit.implement`, uma
branch por feature (`NNN-nome`), PR para `main`. Antes do merge: `typecheck`, `lint`,
`format:check`, `test` e `build` verdes; quickstart executado manualmente.

## Governance

Esta constituição prevalece sobre qualquer outra prática do repositório. Emendas são feitas por
PR que altera este arquivo, incrementa a versão (semântica: MAJOR para remover/redefinir um
princípio, MINOR para acrescentar, PATCH para esclarecer) e atualiza a data. Todo plano registra
a verificação dos princípios; `CLAUDE.md` carrega as regras operacionais derivadas deles.

**Version**: 1.0.0 | **Ratified**: 2026-10-25 | **Last Amended**: 2026-10-25
