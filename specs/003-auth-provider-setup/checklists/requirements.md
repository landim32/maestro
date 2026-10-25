# Specification Quality Checklist: Configuração de Provedores pela Sessão (/auth) e Seleção de Modelo (/model)

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-10-24
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- Validation run 1 (2026-10-24): all items pass.
- Defaults chosen instead of [NEEDS CLARIFICATION] markers, documented in Assumptions: command name `/auth` (+ `/connect`, `/login`) mirroring qwen code; "Claude Auth Login" invokes the Anthropic CLI already installed (`ant auth login`) and does **not** install it automatically; dialogs write to the global `settings.json`; the model selector lists configured models only (no live model listing). Confirm via `/speckit.clarify` if any of these should differ.
- The qwen code `/auth` command (aliases `connect`, `login`; interactive-only; dialog with provider list) was inspected as the behavioural reference.
- Items marked incomplete require spec updates before `/speckit.clarify` or `/speckit.plan`

## Implementation notes (2026-10-24)

- Phases 1–6 implemented except T041 (manual check in a real terminal with the installed `ant` CLI and a real Qwen key). T042 recorded after the final green run.
- Architecture as planned: pure reducers (`src/setup/authFlow.ts`, `modelFlow.ts`) + `SetupDriver` with injectable effects; dialog state lives in `SessionController.dialog`; `config/writer.ts` writes `settings.json` atomically after schema validation, preserving `_comment`.
- Behaviour deviation from contracts/commands.md § 1: in `-p` mode the `/auth` guidance is emitted through the notice channel (stderr), like the existing `/model` table, exit code 0.
- `ant auth login` is spawned with `--timeout 5m`, no stdin; success requires exit 0 **and** `Logged in to` in `ant auth status`; cancelling kills the process tree.
- Coverage added: reducers (all transitions), driver (test/save/activate/login/cancel/warnings), antCli (spawn args, URL capture, cancel, status parsing), connection test (both SDKs mocked, every category), settings writer (atomicity, validation, project overrides), dialog UI integration for the three stories, `/model` persistence, non-interactive guidance, secrets audit of the dialog flow.
