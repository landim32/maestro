# maestro Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-10-24

## Active Technologies

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
├── session/            # session.ts (state machine), turn.ts (stream + tool loop), commands.ts (/help /clear /model /exit), controller.ts, systemPrompt.ts
├── tools/              # types.ts, sandbox.ts, readFile.ts, listDirectory.ts, writeFile.ts, runCommand.ts, registry.ts
├── ui/                 # App.tsx (fixed-height layout), banner.ts, components/{Header,Transcript,ScrollIndicator,Banner,MessageList,InputPrompt,StatusBar,ConfirmationDialog}.tsx
│   ├── markdown/       # parse.ts (remark+gfm), Markdown.tsx, Inline.tsx, CodeBlock.tsx, Table.tsx, highlight.ts (lowlight), theme.ts
│   ├── dialogs/        # DialogHost, DialogFrame, SelectList, TextField (secret), ProgressView, ResultView, AuthDialog, ModelDialog
│   └── hooks/          # useSession, useKeyboard (+scroll keys, dialog routing), useViewport (reducer), useMouseWheel (SGR), useTerminalCapabilities
├── setup/              # methods.ts (catalogue), authFlow.ts + modelFlow.ts (pure reducers), driver.ts (effects), connectionTest.ts, antCli.ts, installHints.ts, dialog.ts
├── config/writer.ts    # patch-by-path, validated, atomic settings.json writes
└── utils/              # mask.ts, errors.ts (MaestroError), tty.ts, logger.ts
tests/
├── unit/ integration/ contract/ helpers/
specs/001-maestro-cli-mvp/  # spec, plan, research, data-model, contracts, quickstart, tasks
```

## Commands

- `npm run build` — tsc → `dist/` + `dist/version.json` (GitVersion-derived stamp)
- `npm run dev` — run from source (tsx); stamps `src/version.json` (gitignored)
- `npm test` — vitest (no network)
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
- The UI never writes escape sequences itself; only `useMouseWheel` (SGR mouse tracking) and Ink (`alternateScreen`) do. Assistant text is rendered through `ui/markdown/`; user and tool text stays literal; `-p` output stays raw markdown.
- UI tests use `tests/helpers/renderSized.ts` (sized fake TTY) and `waitFor`/`waitForFrame` instead of fixed sleeps: measurement → dispatch → re-render takes a few frames. Write a tick between typing and Enter (prompt state must update first).
- Dialog flows (`/auth`, `/model`) are pure reducers in `src/setup/`; side effects (connection test, settings writes, the `ant` process) live only in `SetupDriver` and are injectable (`setupDeps`, `settingsWriter`, `settingsLoader`). Keys enter only through `TextField secret`; logs record setting paths, never values.

## Recent Changes

- 003-auth-provider-setup: Added TypeScript 5.9, Node.js ≥ 22 (ESM), mesmo stack. + existentes — `ink` 8 (`useInput` com `isActive`), `@anthropic-ai/sdk` (`models.retrieve` para teste), `openai` (`chat.completions.create` mínimo para teste), `zod` (validação antes de gravar), `node:child_process` (CLI `ant`). Nenhuma nova.

- 002-fullscreen-ui-markdown: Added TypeScript 5.9, Node.js ≥ 22 (ESM), mesmo stack da feature 001. + existentes: `ink` 8.0.0 (usa `alternateScreen`, `useWindowSize`, `overflow="hidden"` + `contentOffsetY`, `useBoxMetrics`, `useInput` com `pageUp/pageDown/home/end/shift`, `useStdin`), `react` 19. Novas: `unified`, `remark-parse`, `remark-gfm`, `lowlight`, `string-width`, `ink-gradient` (ver research R8).

- 001-maestro-cli-mvp: initial CLI — interactive Ink chat, Claude + Qwen providers, `/model` switching, workspace tools with confirmation, `-p` non-interactive mode.

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
