# maestro Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-10-25

## Active Technologies

- TypeScript 5.9, Node.js ≥ 22 (ESM), mesmo stack. + existentes — `ink` 8 (`usePaste`, `useBoxMetrics` com `left/top`, `useInput`), `node:child_process` (`execFile` para clip/pbcopy/xclip/wl-copy/xsel), `node:fs` (anexos), `zod` (limites). Nenhuma nova. (007-paste-copy-console)
- `settings.json` ganha `ui.pasteCollapseLines`, `ui.attachMaxBytes`, `ui.attachMaxTotalBytes`, `ui.imageMaxBytes`; `history.jsonl` continua texto (rótulos); nada mais persistido. (007-paste-copy-console)

- TypeScript 5.9, Node.js ≥ 22 (ESM), mesmo stack. + existentes — `node:fs`, `node:child_process` (`execFileSync('git', …)` para branches), `node:crypto` (sha256 do manifesto), `zod` (chave `speckit`), `ink` (sugestões no prompt). Parser YAML mínimo próprio para frontmatter e manifestos. Nenhuma nova. (006-native-spec-kit)
- novos `assets/speckit/` no pacote (templates, comandos e scripts v1.2.3 + NOTICE); por projeto, `.specify/` (templates, scripts, `memory/`, `feature.json`, `init-options.json`, `integration.json`, `integrations/maestro.manifest.json`), `.maestro/commands/`, `MAESTRO.md`; `settings.json` ganha `speckit.createBranch`. (006-native-spec-kit)

- TypeScript 5.9, Node.js ≥ 22 (ESM), mesmo stack. + existentes — `ink` 8 (`useInput` com `key.tab`/`key.shift`), `zod` 4 (`z.strictObject` + `z.toJSONSchema` para o esquema de `ask_user`), `yargs` (novos argumentos). Nenhuma nova. (005-approval-modes-ask-user)
- `settings.json` ganha `tools.approvalMode` (lido; a troca por TAB não grava). Novos arquivos de repositório: `THIRD_PARTY_NOTICES.md`; `LICENSE`, `package.json`, `README.md`, `.specify/memory/constitution.md` alterados. (005-approval-modes-ask-user)

- TypeScript 5.9, Node.js ≥ 22 (ESM), mesmo stack. + existentes — `ink` 8 (`useInput`), `zod` 4 (esquema de `models`), `node:fs` (append/rename). Nenhuma nova. (004-history-model-catalog)
- novo `~/.maestro/history.jsonl` (JSON Lines, append por envio, ≤ 1.000 entradas); `settings.json` ganha `providers.<id>.models` (gravado via `config/writer.ts`). (004-history-model-catalog)

- TypeScript 5.9, Node.js ≥ 22 (ESM), mesmo stack. + existentes — `ink` 8 (`useInput` com `isActive`), `@anthropic-ai/sdk` (`models.retrieve` para teste), `openai` (`chat.completions.create` mínimo para teste), `zod` (validação antes de gravar), `node:child_process` (CLI `ant`). Nenhuma nova. (003-auth-provider-setup)
- `~/.maestro/settings.json` passa a ser **escrito** pelo Maestro (patch por caminho, preservando `_comment`, escrita atômica). (003-auth-provider-setup)

- TypeScript 5.9, Node.js ≥ 22 (ESM), mesmo stack da feature 001. + existentes: `ink` 8.0.0 (usa `alternateScreen`, `useWindowSize`, `overflow="hidden"` + `contentOffsetY`, `useBoxMetrics`, `useInput` com `pageUp/pageDown/home/end/shift`, `useStdin`), `react` 19. Novas: `unified`, `remark-parse`, `remark-gfm`, `lowlight`, `string-width`, `ink-gradient` (ver research R8). (002-fullscreen-ui-markdown)
- nenhuma mudança; duas chaves novas em `settings.json` (`ui.altScreen`, `ui.mouse`). (002-fullscreen-ui-markdown)

- TypeScript 5.9 on Node.js ≥ 22, ESM (`"type": "module"`), single npm package with the `maestro` binary (001-maestro-cli-mvp)
- `@anthropic-ai/sdk` (Claude provider), `openai` (Qwen via OpenAI-compatible endpoint; the Anthropic-compatible Qwen endpoint reuses `@anthropic-ai/sdk` through `providers/anthropicProtocol.ts`), `ink` 8 + `react` 19 (terminal UI), `yargs` (args), `zod` 4 (settings + tool input validation, `z.toJSONSchema` for tool schemas), `diff` (write previews)
- Tests: `vitest` 5 + `ink-testing-library`; SDKs are mocked (`tests/helpers/anthropicMock.ts`, `openaiMock.ts`); no test touches the network
- Storage: `~/.maestro/settings.json` (global) and `./.maestro/settings.json` (project); conversation history is in-memory only

## Project Structure

```text
src/
├── index.ts            # entry: args → settings → preflight → interactive | -p
├── version.ts
├── cli/                # args.ts, exitCodes.ts, preflight.ts, firstRun.ts, interactive.ts, nonInteractive.ts
├── config/             # paths.ts, schema.ts (zod), defaults.ts, loader.ts (args > env > project > global)
├── providers/          # types.ts (ModelProvider, ProviderEvent), status.ts, registry.ts, anthropicProtocol.ts (shared Messages-API streaming), claude.ts, qwen.ts (protocol: openai | anthropic), index.ts
├── session/            # session.ts (state machine incl. awaiting_answer), turn.ts (stream + tool loop + approval policy), commands.ts (/help /auth /model /approval-mode /clear /exit), controller.ts, systemPrompt.ts, history.ts
├── tools/              # types.ts (kind, ToolContext.ask), approval.ts (modes, destructive patterns) [qwen-code attrib], askUser.ts [attrib], sandbox.ts, readFile.ts, listDirectory.ts, writeFile.ts, runCommand.ts, registry.ts
├── ui/                 # App.tsx (fixed-height layout), banner.ts, chips.ts, attachments.ts, selection.ts, frameRecorder.ts (specs/007), components/{Header,Transcript,ScrollIndicator,Banner,MessageList,InputPrompt,ChipPanel,StatusBar [attrib],ConfirmationDialog}.tsx
│   ├── markdown/       # parse.ts (remark+gfm), Markdown.tsx, Inline.tsx, CodeBlock.tsx, Table.tsx, highlight.ts (lowlight), theme.ts
│   ├── dialogs/        # DialogHost, DialogFrame, SelectList, TextField (secret), ProgressView, ResultView, AuthDialog, ModelDialog, AskUserDialog [attrib]
│   └── hooks/          # useSession, useKeyboard (+scroll keys, Shift+Tab mode cycle, dialog/question routing), useViewport (reducer), useMouseWheel (SGR), useMouseSelection (press/drag/release → copy), useTerminalCapabilities
├── setup/              # methods.ts (catalogue), authFlow.ts + modelFlow.ts + askUserFlow.ts [attrib] (pure reducers), driver.ts (effects), connectionTest.ts, antCli.ts, installHints.ts, dialog.ts
├── speckit/            # native Spec Kit host: discovery.ts, prompt.ts + preamble.ts, invocation.ts (script dialects), feature.ts, naming.ts, numbering.ts, templates.ts (layers), git.ts, steps/* (native steps), init.ts (+manifest), status.ts, service.ts
assets/speckit/         # bundled spec-kit v1.2.3 (MIT): VERSION, NOTICE, templates/, templates/commands/, scripts/{bash,powershell,python}
├── config/writer.ts    # patch-by-path, validated, atomic settings.json writes
└── utils/              # mask.ts, errors.ts (MaestroError), tty.ts, logger.ts, clipboard.ts (clip/pbcopy/wl-copy/xclip/xsel → OSC 52)
tests/
├── unit/ integration/ contract/ helpers/   # unit/license/attribution.test.ts guards headers + THIRD_PARTY_NOTICES.md
specs/00N-*/                # spec, plan, research, data-model, contracts, quickstart, tasks per feature
THIRD_PARTY_NOTICES.md      # qwen-code / gemini-cli notices + Apache-2.0 text (shipped in the tarball with LICENSE)
```

## Commands

- `npm run build` — tsc → `dist/` + `dist/version.json` (GitVersion-derived stamp)
- `npm run dev` — run from source (tsx); stamps `src/version.json` (gitignored)
- `npm test` — vitest (no network); the suite runs first and `tests/integration/ui/perf.test.tsx` runs afterwards in isolation (`npm run test:perf`) because its latency budgets are meaningless under the git-heavy Spec Kit tests
- `npm run lint` / `npm run format` / `npm run typecheck`
- `npm run version:print` / `version:json` / `version:sync [semver]` — `scripts/version.mjs` reproduces GitVersion.yml (tags + commit prefixes + branch labels); CI passes the real GitVersion outputs through `GITVERSION_*` env vars. `src/version.ts` reads the stamp next to it, falling back to `package.json`. Never hardcode the version.
- `node dist/index.js --help`

## Code Style

- ESM with explicit `.js` extensions in relative imports; `import type` for types (lint-enforced).
- Provider-agnostic core: nothing outside `src/providers/<id>.ts` may import an SDK. The session depends only on `ModelProvider` / `ProviderEvent`.
- Every provider error becomes a `MaestroError` with a category and a secret-free message; raw SDK errors never cross the provider boundary. Use `sanitizeCause` + `redact` when keeping a cause.
- Secrets are displayed only through `mask()` (last 4 chars). Tests in `tests/unit/security/` enforce this.
- Tool inputs come from the model and are untrusted: validate with the zod schema, confine paths with `resolveInsideCwd`, and require confirmation for anything that writes or executes.
- Claude requests: do not send `thinking` (adaptive by default on Opus 5.5); `fallbacks: "default"` requires `client.beta.messages` + beta `server-side-fallback-2026-07-01`.
- Prettier: single quotes, semicolons, width 100.
- UI layout: the root Box is `height={rows}`; every fixed region (Header, InputPrompt, StatusBar, dialogs) needs `flexShrink={0}` and scroll containers need `minHeight={0}` — Yoga's default min-height:auto otherwise refuses to shrink and pushes rows off-screen.
- The UI never writes escape sequences itself; only `useMouseWheel` (SGR mouse tracking), `utils/clipboard.ts` (OSC 52 fallback, specs/007) and Ink (`alternateScreen`, bracketed paste) do. Assistant text is rendered through `ui/markdown/`; user and tool text stays literal; `-p` output stays raw markdown.
- Paste & copy (specs/007): a paste/file/image marker is ONE private-use code point (U+E000 + id) in the prompt's `string[]`, resolved through the session's `ChipRegistry` (`controller.chips`; `src/ui/chips.ts`: `chipChar`, `chipLabel`, `labelChips`, `relinkChips`, `expandChips`). Labels are never editable text; pasted PUA characters are sanitized. Enter builds a `PromptSubmission` (`display` with labels for the transcript/history, `text` expanded with `<pasted-text>`/`<file>` blocks for the model, `parts` for images); `controller.submit` accepts a string or a submission, and slash commands see the expanded text. Pasted/attached content never reaches `history.jsonl` or the debug log (`paste.chip` logs kind and size only; `noSecrets` test). Paths are detected with `src/ui/attachments.ts` (existing files only; binary/size/outside rejections are notices). Mouse selection is the pure reducer `src/ui/selection.ts` in content coordinates driven by `useMouseSelection`; the copied text comes from the `FrameRecorder` (`src/ui/frameRecorder.ts`), a transparent Proxy over the stdout handed to Ink (`interactive.ts` and `renderSized`), cached per content line; the highlight is an absolute overlay in `Transcript`. `/mouse` toggles `controller.mouseEnabled` (session only; initial `ui.mouse`). Image parts require `ModelProvider.capabilities.images` (Claude only); the controller drops them with a warning otherwise.
- UI tests use `tests/helpers/renderSized.ts` (sized fake TTY) and `waitFor`/`waitForFrame` instead of fixed sleeps: measurement → dispatch → re-render takes a few frames. Write a tick between typing and Enter (prompt state must update first).
- Dialog flows (`/auth`, `/model`) are pure reducers in `src/setup/`; side effects (connection test, settings writes, the `ant` process) live only in `SetupDriver` and are injectable (`setupDeps`, `settingsWriter`, `settingsLoader`). Keys enter only through `TextField secret`; logs record setting paths, never values.
- Input history lives in `src/session/history.ts` (`InputHistory` + injectable `HistoryStore`; pure `historyNavigate` for ↑/↓). The controller records every interactive submit before executing it; dialog `TextField` input and `-p` never reach the history (`noSecrets` test enforces it). `InputPrompt` keeps refs beside state so keys batched in one tick see each other's result.
- Model catalogue: `providers.<id>.models` (zod: single tokens, no duplicates, `[]` → defaults). Derivations are pure in `src/config/models.ts` (`modelCatalog`, `learnModelPatch` on the **raw global** file); learned models are written to the global file only. `ModelFlowState` uses one `ModelEntry` per model and a `customProvider` step; `modelFlowReducer(state, event, ctx)` needs `{ statuses, settings, activeModel }`.
- Approval policy lives in `src/tools/approval.ts` (pure): tools declare `kind: 'read' | 'edit' | 'command' | 'question'` (no `requiresConfirmation`), `classifyAction` turns a `command` into `destructive` via `DESTRUCTIVE_PATTERNS`, and `needsConfirmation(mode, kind)` is the FR-003 table. `runTurn` receives `approvalMode: () => ApprovalMode` (a getter, so Shift+Tab mid-turn applies to the next call) and reports auto-approved actions through `onAutoApproved`. The live mode is `SessionController.approvalMode` (Shift+Tab / `/approval-mode`, session only; plain Tab completes the prompt suggestion — never written to settings); the initial value is `tools.approvalMode` (`--approval-mode`, `--yolo`). Destructive patterns are a convenience, not a security boundary; `resolveInsideCwd` applies in every mode.
- `ask_user` (`src/tools/askUser.ts`, `kind: 'question'`) never goes through `needsConfirmation` and stays available with `--no-tools` (`toolsFor`). It reaches the UI through `ToolContext.ask` → `Session.pendingQuestion` (`awaiting_answer`) → `SessionController.questionFlow` driven by the pure reducer `src/setup/askUserFlow.ts`; `AskUserDialog` renders in the confirmation slot. Free text typed in "Outro…" goes to the model only: never to `history.jsonl` nor to logs (`noSecrets` test). `multiSelect` is `.optional()` (not `.default`) so the JSON Schema sent to the model keeps it non-required.
- Code adapted from qwen-code (Apache-2.0) must start with the attribution header (see `src/tools/approval.ts`) and be listed in `THIRD_PARTY_NOTICES.md`; `tests/unit/license/attribution.test.ts` fails on a missing header, an unlisted Apache header, or a `package.json` without `license: MIT`. The project is and stays open-source (constitution §VI–VII).
- Spec Kit is hosted natively by `src/speckit/` (specs/006). Command files are discovered in `.maestro/commands/` → the active integration's folder (`.specify/integration.json`, e.g. `.claude/commands/`) → the bundled v1.2.3 copies in `assets/speckit/` (MIT; never edit the assets except through `assets/speckit/NOTICE`-documented modifications). A `/speckit.*` command is a **prompt command**: `SlashCommand.run` returns a `PromptTurn` (`display` for the transcript, `prompt` = preamble + body) and the controller runs the turn; `Message.display` keeps the typed line in the UI. The helper scripts are **never executed**: `TurnOptions.intercept` (before the approval policy) turns any `run_command` matching `.specify/scripts/{bash,powershell,python}/*` (three dialects, `parseInvocation`) into a native step (`runStep` over an injectable `StepContext`: git via `execFile`, assets, clock) that returns the scripts' JSON. Steps are pure modules under `src/speckit/steps/`; feature resolution follows env → `feature.json` → git branch → newest `specs/` dir; `createFeature` also creates the git branch (`speckit.createBranch`). Preflight (`preflightFor`) blocks a command with the script's own error before the model is called (`CommandBlocked` → `-p` exits 2). `/speckit.init [--upgrade]` installs from the assets with a sha256 manifest (`.specify/integrations/maestro.manifest.json`); `MAESTRO.md` (else `CLAUDE.md`) is appended to the system prompt by `config/projectContext.ts`.

## Recent Changes

- 007-paste-copy-console: Added TypeScript 5.9, Node.js ≥ 22 (ESM), mesmo stack. + existentes — `ink` 8 (`usePaste`, `useBoxMetrics` com `left/top`, `useInput`), `node:child_process` (`execFile` para clip/pbcopy/xclip/wl-copy/xsel), `node:fs` (anexos), `zod` (limites). Nenhuma nova.

- 006-native-spec-kit: Added TypeScript 5.9, Node.js ≥ 22 (ESM), mesmo stack. + existentes — `node:fs`, `node:child_process` (`execFileSync('git', …)` para branches), `node:crypto` (sha256 do manifesto), `zod` (chave `speckit`), `ink` (sugestões no prompt). Parser YAML mínimo próprio para frontmatter e manifestos. Nenhuma nova.

- 005-approval-modes-ask-user: Added TypeScript 5.9, Node.js ≥ 22 (ESM), mesmo stack. + existentes — `ink` 8 (`useInput` com `key.tab`/`key.shift`), `zod` 4 (`z.strictObject` + `z.toJSONSchema` para o esquema de `ask_user`), `yargs` (novos argumentos). Nenhuma nova.

<!-- MANUAL ADDITIONS START -->

## Commits and versioning (GitVersion)

Versions are derived from commit messages (GitVersion with Conventional Commits). The prefix of the commit subject decides the bump:

| Prefix                                  | Bump                  | When                                                                                                       |
| --------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------- |
| `fix:`                                  | patch (0.1.0 → 0.1.1) | **Default.** Use for every commit unless told otherwise: bug fixes, refactors, docs, tests, chores, specs. |
| `feat:`                                 | minor (0.1.0 → 0.2.0) | Only when the user explicitly asks for a `feat:` commit.                                                   |
| `major:` (or `BREAKING CHANGE:` footer) | major (0.1.0 → 1.0.0) | Only when the user explicitly asks for a `major:` commit.                                                  |

Rules:

- Always start the subject with `fix:` unless the user says `feat:` or `major:` for that commit.
- Subject in the imperative, lowercase after the prefix, ≤ 72 characters; optional scope in parentheses (`fix(ui): …`).
- Body: what changed and why, in the user's language (Portuguese). Reference the spec/task when relevant (e.g. `specs/002-fullscreen-ui-markdown T017`).
- Never squash different bump levels into one commit; a `feat:` or `major:` commit contains only that change.
- Remote: `origin` → https://github.com/landim32/maestro.git (default branch `main`).

<!-- MANUAL ADDITIONS END -->
