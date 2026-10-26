# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Maestro is a multi-model AI assistant for the terminal (Claude, Claude Code, Codex, Qwen), written in TypeScript on Node ≥ 22 (ESM) with an Ink 8 / React 19 UI. It hosts GitHub's Spec Kit natively and is developed through it: every feature lives in `specs/NNN-name/` (spec, plan, research, data-model, contracts, quickstart, tasks) and is driven by the `/speckit.*` commands. The `## Active Technologies`, `## Recent Changes` and `Last updated` lines below are rewritten by `/speckit.plan` (`src/speckit/steps/agentContext.ts`); keep those headings verbatim. Everything else is maintained by hand. The project constitution is `.specify/memory/constitution.md` (YAGNI, text-first CLI, testability, credential safety, minimal observability, permanent MIT open source, third-party attribution).

Last updated: 2026-10-26

## Commands

- `npm run build` — tsc → `dist/` + `dist/version.json` (GitVersion-derived stamp)
- `npm run dev` — run from source with tsx; stamps `src/version.json` (gitignored)
- `npm test` — whole vitest suite (no network), then `tests/integration/ui/perf.test.tsx` alone via `npm run test:perf`, because its latency budgets are meaningless after the git-heavy Spec Kit tests
- `npx vitest run tests/unit/routes/resolve.test.ts` — one file; `npx vitest run -t "pattern"` — one test by name; `npm run test:watch`
- `npm run lint` (eslint: `consistent-type-imports`, react-hooks, `_`-prefixed unused vars) / `npm run format` / `npm run typecheck` (uses `tsconfig.test.json`, so tests are type-checked too)
- `npm run version:print` / `version:json` / `version:sync [semver]` — `scripts/version.mjs` reproduces `GitVersion.yml` (tags + commit prefixes + branch labels); CI passes real GitVersion outputs through `GITVERSION_*` env vars. `src/version.ts` reads the stamp next to it, falling back to `package.json`. Never hardcode the version.
- `node dist/index.js --help`; `maestro -p "…"` is the non-interactive mode and `maestro -p "/speckit.tasks"` runs Spec Kit commands headless.
- Prettier: single quotes, semicolons, width 100.

## Architecture

**Entry flow.** `src/index.ts`: `cli/args.ts` (yargs) → `config/loader.ts` (precedence args > env > `./.maestro/settings.json` > `~/.maestro/settings.json`, zod schema in `config/schema.ts`) → `cli/preflight.ts` → `cli/interactive.ts` (Ink) or `cli/nonInteractive.ts` (`-p`, raw markdown to stdout, exit codes in `cli/exitCodes.ts`).

**Provider boundary.** `src/providers/types.ts` defines `ModelProvider` / `ProviderEvent`; `claude.ts` and `qwen.ts` (protocol `openai` | `anthropic`, the latter reusing `anthropicProtocol.ts`) are the only files allowed to import an SDK. Every provider error becomes a `MaestroError` (`utils/errors.ts`) with a category and a secret-free message (`sanitizeCause` + `redact`); secrets are shown only via `mask()` (last 4 chars), enforced by `tests/unit/security/`. Claude requests never send `thinking`; `fallbacks: "default"` requires `client.beta.messages` + beta `server-side-fallback-2026-07-01`. `ProviderRequest.overrides` (effort/maxTokens) is honoured by the Anthropic protocol; Qwen applies maxTokens only.

**Claude Code provider (specs/010).** `providers/claudeCode.ts` runs the user's own `claude` binary (`-p`, stream-json in/out; arguments, stdin history and the stdout parser are pure in `claudeCodeStream.ts`). It never reads, stores or forwards Claude.ai credentials (the user logs in inside Claude Code; `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` are stripped from the child env) and `/auth` → Claude Code only runs `claude auth status` (`setup/claudeCodeCli.ts`), never a login. Claude Code runs with `--tools ""`, `--strict-mcp-config`, `--disable-slash-commands`, `--no-session-persistence`; Maestro's tools reach it through `providers/mcpBridge.ts`, a one-turn MCP HTTP server on 127.0.0.1 with a random bearer token. The provider declares `capabilities.executesTools`, so `runTurn` passes `ProviderRequest.runTool` and takes the provider-driven path: calls are serialized and each one goes through `executeTool` (validation → `intercept` → approval → run), recording `tool_call`/`tool_result` like the built-in loop. `--safe-mode` disables the bridge and `--bare` ignores OAuth, so neither may be used. Tests drive it with `tests/helpers/fakeClaudeCode.ts` (pass `platform: 'linux'` so `killTree` never runs `taskkill` against a fake pid).

**Codex provider (specs/012).** `providers/codex.ts` runs the user's own `codex exec --json` (prompt on stdin; arguments, child env, prompt, JSONL parser and `codexError` are pure in `codexStream.ts`). Same credential rule as Claude Code: Maestro never reads `CODEX_HOME`; `setup/codexCli.ts` only reads `codex --version` and the _method_ of `codex login status` (the API-key variant prints part of the key, so the rest of the line is dropped); `OPENAI_API_KEY`/`CODEX_API_KEY`/`OPENAI_BASE_URL` are stripped. Isolation: `--ephemeral --ignore-user-config --ignore-rules -s read-only -c approval_policy=never -c web_search=disabled -c project_doc_max_bytes=0 -c include_permissions_instructions=false -c include_environment_context=false` (otherwise Codex tells the model its sandbox is read-only and it stops calling `write_file`) plus `--disable` of every `CODEX_DISABLED_FEATURES` entry (shell, unified_exec, …; `code_mode_host` must stay on, it is what exposes MCP tools); the system prompt (plus `codexToolsNote` when there are tools) replaces Codex's via `-c model_instructions_file`. On Windows `locateCodex` takes `codex.exe`, then `codex.cmd` (never the npm POSIX shim `codex`). Tools go through the same `mcpBridge` (`-c mcp_servers.maestro.url=…`, token only in `MAESTRO_MCP_TOKEN` via `bearer_token_env_var`, `default_tools_approval_mode=approve` because Maestro decides). `-c` values never carry quotes (Codex takes non-TOML text literally; quotes would not survive `cmd /c` for the npm `codex.cmd` shim). `MIN_CODEX_VERSION` = 0.161.0 is checked before the first turn. Text arrives per `agent_message` block. Tests use `tests/helpers/fakeCodex.ts`; `tests/contract/codex-invocation.test.ts` pins the flags.

**Session core (provider-agnostic).** `session/session.ts` is the state machine (incl. `awaiting_answer`), `session/turn.ts` runs stream + tool loop + approval policy, `session/controller.ts` (`SessionController`) is what the UI talks to, `session/commands.ts` holds slash commands, `session/history.ts` the ↑/↓ input history (`~/.maestro/history.jsonl`, ≤ 1 000 lines; dialog input and `-p` never reach it). `config/projectContext.ts` appends `MAESTRO.md` (else `CLAUDE.md`) to the system prompt. `settings.language` (optional) replaces "answer in the user's language" with a fixed language and repeats it as the prompt's last line (`languageName` expands codes such as `pt-BR`).

**Tools and approval.** Tools declare `kind: 'read' | 'edit' | 'command' | 'question'`; `tools/approval.ts` (pure, adapted from qwen-code) maps `(mode, kind)` to confirm/auto via `needsConfirmation`, with `classifyAction` promoting commands matching `DESTRUCTIVE_PATTERNS` to `destructive`. `runTurn` takes `approvalMode: () => ApprovalMode` (a getter, so Shift+Tab mid-turn applies to the next call) and reports auto-approved actions through `onAutoApproved`. The live mode is `SessionController.approvalMode` (session only, never written to settings); the initial value comes from `tools.approvalMode` / `--approval-mode` / `--yolo`. Tool inputs are untrusted: zod-validate, confine paths with `resolveInsideCwd` (applies in every mode), confirm anything that writes or executes. `ask_user` (`kind: 'question'`) bypasses approval, survives `--no-tools`, and reaches the UI via `ToolContext.ask` → `Session.pendingQuestion` → `controller.questionFlow` (reducer `setup/askUserFlow.ts`) → `AskUserDialog`; free text typed in "Outro…" goes to the model only.

**Turn limits and rate limits.** `tools.maxToolIterations` defaults to `0` = no limit (like Claude Code / qwen-code / gemini-cli); a positive value caps rounds (provider-driven: × `CALLS_PER_ITERATION`). A `rate_limit` error never ends a turn: `runTurn` drops the partial reply, waits `MaestroError.retryAfterMs` (Retry-After via `retryAfterFrom`, or the Claude Code usage-limit reset) or `backoffMs(attempt)` (5 s doubling, capped at `MAX_BACKOFF_MS` = 5 min), announces it (`onNotice` + `onRetry`) and resends the same request, in both tool loops; only a cancellation stops the wait. A `network` error is retried the same way up to `TurnOptions.networkRetries` (default `NETWORK_RETRIES` = 5; the autopilot passes Infinity through `runOverrides`); the CLI providers map connection failures reported as text with `looksLikeNetworkError`. A `tool_use` stop without any tool call (an Anthropic-compatible endpoint that never closes the block; `anthropicProtocol` also recovers calls from `finalMessage().content`) is resent up to `LOST_TOOL_RETRIES` = 2. Tests inject `TurnOptions.sleep`.

**Skills (specs/013).** `src/skills/catalog.ts`:

- `sessionSkills` decides whether to discover: only with `skills.enabled` and `tools.enabled`.
- `discoverSkills` reads `SKILL.md` one level below `.claude/skills`, `.agents/skills` and `<homeDir>/.claude/skills`, in that precedence. It parses only the header, with the minimal `skills/frontmatter.ts` and no YAML dependency. Skills without a description and `speckit-*` skills are ignored; repeated names are shadowed.
- The pure `skillsSection` (50 items, 250-character descriptions) goes into `buildSystemPrompt` before the project guidelines.

`tools/loadSkill.ts` (`createLoadSkillTool(catalog)`, `kind: 'read'`) returns the body and the reference list, or one `file` confined by `realpath` to the skill folder. It fills `display.skill`. `toolsFor(settings, { skills })` adds it only for a non-empty catalogue, so without skills the prompt and the tools stay byte for byte unchanged.

`/skills` prints `skillsReport`. The controller logs `skill.load` without content and forwards every tool result to `runOverrides.onToolResult`, which the autopilot driver turns into `skill.load` lines in the `.jsonl`.

**Routes (specs/008).** `settings.routes.<name> = { provider, model, effort?, maxTokens? }`. A missing key means default: `chat` follows the active provider/model, every other route follows `chat`. `routes/catalog.ts` (`routeEntries`, `aliasCommands`, `ROUTE_GUIDANCE`) and `routes/resolve.ts` (`resolveRoute`: forced → command → chat → active, with `fallbacks`) are pure. `SlashCommand.kind` is `'prompt'` for commands that send a prompt (their name is their route) and `'route'` for `/ask` and `/<route>` shortcuts. `controller.submit` resolves the route, warns per fallback, picks `providerFor(id)` (one cached instance per provider; the active provider never changes) and runs `runTurn` with `model`/`overrides`/`route`; replies carry `Message.route`.

**Setup dialogs.** `/auth`, `/model`, `/routes` and `ask_user` are pure reducers in `src/setup/` (`authFlow`, `modelFlow`, `routesFlow`, `askUserFlow`); all side effects (connection test, settings writes, the `ant` CLI process) live only in `setup/driver.ts` (`SetupDriver`) and are injectable (`setupDeps`, `settingsWriter`, `settingsLoader`). `config/writer.ts` does patch-by-path, validated, atomic writes to `settings.json` preserving `_comment`; route names contain dots, so routes are written with explicit `segments`. Model catalogue: `providers.<id>.models` derivations are pure in `config/models.ts` (`modelCatalog`, `learnModelPatch` on the raw global file); learned models go to the global file only.

**Conversation display (specs/009).** Three pure modules drive it:

- `session/activity.ts` (`activityReducer`, phrases, `formatSummary`) holds the activity line state. `SessionController.activity` is fed by `onDelta`, `onUsage`, `onToolStart`/`onToolEnd` and the session state (confirm/question), and is rendered by `ui/components/ActivityLine.tsx`, a fixed `flexShrink={0}` row above the prompt with its own timer, so the transcript never re-renders on a tick. The interactive turn ends with a `✻ …` info notice.
- `ui/toolDisplay.ts` (`describeCall`/`describeResult`) gives `MessageList` the `⏺ Label(arg)` + `⎿ summary` rows. It pairs each `tool_call` with its `tool_result` by `callId` and does not draw paired `tool` messages.
- `tools/diff.ts` (`fileDiff` over `structuredPatch`) builds the structured diff. `executeTool` calls `tool.diff` (only `write_file`) once before approval and attaches it to `PendingToolAction.diff` and to `tool_result.display`.

`display` (`{ diff, autoMode, declined, speckitStep, summary }`) is display-only: the provider converters copy only `callId`/`output`/`isError` (guarded by `tests/contract/display.test.ts`). The `⚙`/`⚠` tool notices are emitted only when `interactive` is false (`-p`, stderr). In the interactive session that information lives in the transcript, and `write_file.preview` keeps its text because its first line is the `-p` announcement.

**Autopilot (specs/011).** `/autopilot <file | prompt>` and `maestro -p --autopilot <file> [--resume]` (or `-p "<prompt>" --autopilot`) drive each story through specify → clarify → plan → tasks → analyze → implement → verify. `autopilot/flow.ts` is a pure state machine (each `on*` returns the new state plus the next action: turn, decide, verify, commit, publish, finish); `autopilot/driver.ts` is the only module with effects and runs every turn through `controller.submit(text, { record: false })`, so routes, preflight, Spec Kit interception and the approval policy apply unchanged. During a run `controller.runOverrides` forces `approvalMode: auto`, refuses every confirmation (= destructive commands) and sends `ask_user` to the decider (`autopilot/decider.ts`, route `autopilot.decide` in `SYSTEM_ROUTES`, no shortcut); text questions left at the end of a turn are found by `autopilot/questions.ts`. Gates (`autopilot/gates.ts`) are pure over a disk snapshot; implement without a newly ticked task gets a `nudge` (mark finished tasks, continue) up to `MAX_IMPLEMENT_NUDGES` before stopping. A prompt (not an existing file nor `looksLikePath`) becomes a one-story file `.maestro/autopilot/<id>.md` (`promptStoriesFile`), so the run and its resume treat it as any stories file. A new run refuses a stories file whose `##` titles look like document sections (`sectionLikeTitles`). Resuming an orphan run (pid gone) restarts the step left `running`. Each passed step is one commit (`GitCommitPort` in `speckit/git.ts`, kept apart from `GitPort`); `decisions.md` and the state are rewritten from memory before each commit (model edits discarded); the state and the `.jsonl` are local (added to `.git/info/exclude`); an interrupted step leaves its partial work on disk, uncommitted (the report says so), and the resume continues from it; a resumed plan accepts a `plan.md` that differs from HEAD (`GateSnapshot.planUncommitted`). Runs interrupted by older versions stashed that work (`interruptedStashName`); the resume re-applies such a stash on a clean tree (`GitCommitPort.unstash`). A specify turn records the feature it created as soon as it is on disk (`claimFeature`), so a resumed specify (`StepRun.resumed`) continues it with `resumeSpecifyText` and its gate accepts that same feature. Push/PR (`autopilot/remote.ts`, `gh`) only with `autopilot.push`, merge only with `autopilot.merge`. Tests: `tests/helpers/autopilotPorts.ts` (`speckitModel` scripted model, `fakeVerify`, `fakeRemote`) and `tests/integration/autopilot/run.test.ts` in a real temp git repo (stub GIT_AUTHOR__/GIT_COMMITTER__ and `commit.gpgsign=false` via GIT_CONFIG_*).

**Spec Kit host (specs/006).** `src/speckit/` discovers command files in `.maestro/commands/` → the folder of the integration in `.specify/integration.json` (e.g. `.claude/commands/`) → bundled v1.2.3 copies in `assets/speckit/` (MIT; never edit except via `assets/speckit/NOTICE`-documented modifications). A `/speckit.*` command is a prompt command: `SlashCommand.run` returns a `PromptTurn` (`display` + `prompt` = preamble + body). The helper scripts are never executed: `TurnOptions.intercept` (before approval) turns any `run_command` matching `.specify/scripts/{bash,powershell,python}/*` (`parseInvocation`, three dialects) into a native step (`runStep` over an injectable `StepContext`: git via `execFile`, assets, clock) returning the scripts' JSON. Steps are pure modules in `speckit/steps/`; feature resolution is env → `.specify/feature.json` → git branch → newest `specs/` dir; `createFeature` also creates the branch (`speckit.createBranch`). `preflightFor` blocks a command with the script's own error before the model is called (`CommandBlocked` → `-p` exits 2). `/speckit.init [--upgrade]` installs from the assets with a sha256 manifest.

**UI (Ink).** Ink lays out and draws the whole transcript tree every frame (clipped part included), so `MessageList` renders only the newest items within `TRANSCRIPT_MAX_ROWS` (estimated by `messageRows`, cut by `firstVisible`) and a `↑ N itens anteriores…` line; the session history is untouched. `ui/App.tsx` is a fixed-height layout: root Box `height={rows}`, every fixed region (Header, InputPrompt, StatusBar, dialogs) needs `flexShrink={0}` and scroll containers need `minHeight={0}`, otherwise Yoga's min-height:auto pushes rows off-screen. The UI never writes escape sequences itself; only `hooks/useMouseWheel` (SGR mouse), `utils/clipboard.ts` (OSC 52 fallback) and Ink (`alternateScreen`, bracketed paste) do. Assistant text goes through `ui/markdown/` (remark + gfm, lowlight); user and tool text stays literal. Paste/file/image markers (specs/007) are ONE private-use code point (U+E000 + id) in the prompt's `string[]`, resolved via the session's `ChipRegistry` (`controller.chips`, helpers in `ui/chips.ts`); Enter builds a `PromptSubmission` (`display` for transcript/history, `text` expanded with `<pasted-text>`/`<file>` blocks for the model, `parts` for images). Pasted content never reaches `history.jsonl` or the debug log. Mouse selection is the pure reducer `ui/selection.ts` driven by `useMouseSelection`; copied text comes from `ui/frameRecorder.ts`, a Proxy over the stdout handed to Ink. Image parts require `ModelProvider.capabilities.images` (Claude only).

**Logging.** `utils/logger.ts` records setting paths, kinds and sizes (`route.resolve`, `routes.write`, `paste.chip`), never values, keys or pasted content; the `noSecrets` tests enforce it.

## Testing conventions

- vitest 5 + `ink-testing-library`; SDKs are mocked by `tests/helpers/anthropicMock.ts` / `openaiMock.ts`; no test touches the network. Layout: `tests/unit/`, `tests/integration/`, `tests/contract/`, `tests/helpers/`.
- UI tests use `tests/helpers/renderSized.ts` (sized fake TTY) and `waitFor`/`waitForFrame` instead of fixed sleeps: measurement → dispatch → re-render takes a few frames. Write a tick between typing and Enter (prompt state must update first). `InputPrompt` keeps refs beside state so keys batched in one tick see each other's result.
- `tests/unit/license/attribution.test.ts` fails on code adapted from qwen-code / gemini-cli (Apache-2.0) without the attribution header (see `src/tools/approval.ts`), on an Apache header not listed in `THIRD_PARTY_NOTICES.md`, or on a `package.json` without `license: MIT`.

## Code Style

- ESM with explicit `.js` extensions in relative imports; `import type` for types (lint-enforced).
- Nothing outside `src/providers/<id>.ts` may import an SDK; the session depends only on `ModelProvider` / `ProviderEvent`.
- Behaviour without configuration must stay unchanged when adding settings keys (missing key = current default); new keys go through `config/schema.ts` and are documented in `README.md`.
- `multiSelect` and similar optional tool fields use `.optional()` (not `.default`) so the JSON Schema sent to the model keeps them non-required.

## Project Structure

```text
src/
├── index.ts, version.ts
├── cli/          args, exitCodes, preflight, firstRun, interactive, nonInteractive
├── config/       paths, schema (zod), defaults, loader, writer, models, projectContext
├── providers/    types, status, registry, anthropicProtocol, claude, qwen, claudeCode + claudeCodeStream + mcpBridge (specs/010), codex + codexStream (specs/012)
├── session/      session, turn, commands, controller, systemPrompt, history, activity
├── tools/        types, approval [qwen-code attrib], askUser [attrib], sandbox, readFile, listDirectory, writeFile, runCommand, loadSkill, registry, diff
├── routes/       catalog, resolve (pure)
├── setup/        methods, authFlow, modelFlow, askUserFlow, routesFlow (reducers), driver, connectionTest, antCli, claudeCodeCli, codexCli, installHints, dialog
├── autopilot/    types, stories, flow (pure reducer), gates, questions, decider, log, report, resume, state, remote, driver (specs/011)
├── skills/       frontmatter (minimal SKILL.md header parser), catalog (discovery, prompt section, /skills report) (specs/013)
├── speckit/      discovery, prompt, preamble, invocation, feature, naming, numbering, templates, git, init, status, service, steps/*
├── ui/           App, banner, chips, attachments, selection, frameRecorder, toolDisplay, components/ (ActivityLine, DiffView…), markdown/, dialogs/, hooks/
└── utils/        mask, errors, tty, logger, clipboard
assets/speckit/   bundled spec-kit v1.2.3 (MIT): VERSION, NOTICE, templates/, scripts/
tests/            unit/ integration/ contract/ helpers/
specs/NNN-*/      spec, plan, research, data-model, contracts, quickstart, tasks per feature
```

## Active Technologies

- 013-native-skills: no new dependencies; `src/skills/` (minimal frontmatter parser, catalog from `.claude/skills`, `.agents/skills`, `~/.claude/skills`), tool `load_skill` confined by `realpath` to the skill folder, `skill.load` events in the autopilot `.jsonl`; settings `skills.enabled`
- 012-codex-cli-provider: no new dependencies; provider `codex` spawns the user's `codex exec --json` (own tools disabled, `read-only` sandbox) and reuses the specs/010 MCP bridge; settings `providers.codex`
- 011-speckit-autopilot: no new dependencies; `src/autopilot/` (pure flow/gates/decider + driver), `execFile` for git and `gh`; local state `.specify/autopilot.json` + `.maestro/autopilot/<id>.jsonl` (kept out of commits via .git/info/exclude), versioned `specs/NNN/decisions.md`
- 009-ai-output-display: no new dependencies; `diff` `structuredPatch` for the structured write diff; `tool_result.display` is in-memory only (never sent to the model nor persisted)
- TypeScript 5.9, Node.js ≥ 22 (ESM), single npm package with the `maestro` binary; `@anthropic-ai/sdk`, `openai`, `ink` 8 + `react` 19, `yargs`, `zod` 4 (`z.toJSONSchema` for tool schemas), `diff`, `unified`/`remark-parse`/`remark-gfm`, `lowlight`, `string-width`, `ink-gradient`; `vitest` 5 + `ink-testing-library` — the Claude Code provider needs the user's own `claude` CLI (001–010)
- Storage: `~/.maestro/settings.json` (global, written by Maestro) and `./.maestro/settings.json` (project); `~/.maestro/history.jsonl`; per project `.specify/` (templates, scripts, `memory/`, `feature.json`, `integration.json`, `integrations/maestro.manifest.json`), `.maestro/commands/`, `MAESTRO.md`; conversation history is in-memory only (001–008)

## Recent Changes

- 013-native-skills: skills (`SKILL.md`) listed in the system prompt by name and description, loaded on demand with `load_skill`, `/skills` for diagnosis, `skill.load` in the autopilot log
- 012-codex-cli-provider: provider `codex` (user's Codex CLI with the ChatGPT subscription, own tools disabled, tools via the loopback MCP bridge)
- 011-speckit-autopilot: /autopilot and -p --autopilot run user stories through the whole Spec Kit without interaction, with a decider, gates, per-step commits and resume
- 009-ai-output-display: activity line (time, tokens), Claude Code style transcript (⏺/⎿), structured write diff in dialog and transcript

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
- Remote: `origin` → https://github.com/landim32/maestro.git (default branch `main`). Pushes to `main` trigger the `Version and Tag` workflow (GitVersion 5.x); the local `gitversion` v6 is incompatible, use `scripts/version.mjs`.

<!-- MANUAL ADDITIONS END -->
