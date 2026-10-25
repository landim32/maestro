# Contract — Atribuição ao qwen-code e compromisso open-source

**Feature**: `005-approval-modes-ask-user` · **Date**: 2026-10-25

## 1. Referência fixada

| Campo | Valor |
|---|---|
| Projeto | qwen-code — https://github.com/QwenLM/qwen-code |
| Commit de referência | `1c9cdd234fd9a391cac146e2d4c834d603afd045` (branch `main`, 2026-10-25) |
| Release mais próximo | `v0.26.1` (2026-10-24) |
| Licença | Apache-2.0 |
| Copyright | Copyright 2025 Qwen Team (Alibaba Group); Copyright 2025 Google LLC (código herdado do gemini-cli) |
| Projeto de origem do qwen-code | gemini-cli — https://github.com/google-gemini/gemini-cli (Apache-2.0, Copyright 2025 Google LLC) |

Se o usuário fornecer outra referência (URL/commit), ela substitui esta tabela e o cabeçalho dos arquivos.

## 2. Cabeçalho de arquivo (obrigatório nos arquivos listados em `THIRD_PARTY_NOTICES.md`)

```ts
/**
 * @license
 * Portions adapted from qwen-code (https://github.com/QwenLM/qwen-code),
 * <caminho/no/qwen-code> @ 1c9cdd234fd9a391cac146e2d4c834d603afd045.
 * Copyright 2025 Qwen Team. Copyright 2025 Google LLC.
 * SPDX-License-Identifier: Apache-2.0
 * Modified for Maestro; see THIRD_PARTY_NOTICES.md.
 */
```

Primeira coisa no arquivo (antes dos `import`). Em `.tsx` idem. Um arquivo que adapte mais de um arquivo de origem lista todos os caminhos.

## 3. `THIRD_PARTY_NOTICES.md` (raiz)

```
# Third-party notices

Maestro is MIT-licensed (see LICENSE). It includes material adapted from the
projects below; their notices are reproduced as their licenses require.

## qwen-code
- Repository, commit, license, copyright (tabela § 1)
- Files in Maestro containing adapted material:
  | Maestro | Origin |
  | `src/tools/approval.ts` | `packages/core/src/config/approval-mode.ts`, `packages/cli/src/config/approval-mode-value.ts` |
  | `src/tools/askUser.ts` | `packages/core/src/tools/askUserQuestion.ts` |
  | `src/setup/askUserFlow.ts` | `packages/cli/src/ui/components/messages/AskUserQuestionDialog.tsx` |
  | `src/ui/dialogs/AskUserDialog.tsx` | idem |
  | `src/ui/components/StatusBar.tsx` | `packages/cli/src/ui/components/approvalModeVisuals.ts` |

## gemini-cli
- Repository, license, copyright (qwen-code is derived from it; its notices are retained)

## Apache License 2.0
<texto integral>
```

A tabela "Files in Maestro" é a fonte de verdade do teste de atribuição.

## 4. `LICENSE`

Mantém o texto MIT atual e acrescenta ao final:

```
Portions of this software are adapted from third-party projects under the
Apache License 2.0; see THIRD_PARTY_NOTICES.md for the notices and license text.
```

## 5. `package.json`

```json
"license": "MIT",
"files": ["dist", "README.md", "LICENSE", "THIRD_PARTY_NOTICES.md"]
```

Sem `"private": true`. `npm pack` (workflow Version and Tag) passa a incluir os dois arquivos.

## 6. README

- Nova seção **Licença**: "O Maestro é software livre sob a licença MIT. É e continuará sendo open-source."
- Nova seção **Créditos**: qwen-code (link, Apache-2.0, o que foi adaptado: modos de aprovação e `ask_user`), gemini-cli (origem do qwen-code), Claude Code (inspiração de UX; nenhum código).
- Seção **Modos de aprovação** (contracts/approval-modes.md § 8) e linha sobre `ask_user`.

## 7. Constituição (`.specify/memory/constitution.md`, v1.0.0)

Princípios: I. Simplicidade/YAGNI · II. CLI texto I/O (`-p` sempre funcional) · III. Testabilidade (reducers puros, efeitos injetáveis, sem rede nos testes) · IV. Segurança de credenciais (mask, logs sem valores) · V. Observabilidade mínima (`--debug`) · **VI. Open-source permanente** (MIT ou licença permissiva equivalente; nunca `private`; o repositório público é a fonte canônica) · **VII. Atribuição de terceiros** (todo código copiado/adaptado traz cabeçalho e entrada em `THIRD_PARTY_NOTICES.md`; licenças compatíveis com MIT apenas). Governança: emendas por PR com atualização de versão.

## 8. Teste (`tests/unit/license/attribution.test.ts`)

1. `THIRD_PARTY_NOTICES.md` existe e contém `qwen-code`, `gemini-cli`, `Apache License` e `Version 2.0`.
2. Cada arquivo da tabela "Files in Maestro" existe e suas 12 primeiras linhas contêm `qwen-code`, `SPDX-License-Identifier: Apache-2.0` e `THIRD_PARTY_NOTICES.md`.
3. Nenhum outro arquivo em `src/` contém `SPDX-License-Identifier: Apache-2.0` sem estar na tabela (evita atribuição esquecida na tabela).
4. `package.json`: `license === 'MIT'`, `private !== true`, `files` inclui `LICENSE` e `THIRD_PARTY_NOTICES.md`.
5. `LICENSE` menciona `THIRD_PARTY_NOTICES.md`; `README.md` contém "open-source" e "qwen-code".
