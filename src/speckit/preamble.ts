/** Fixed text prepended to every Spec Kit command prompt (contracts/speckit-commands.md § 3). */
export const SPECKIT_PREAMBLE = [
  '<!-- Maestro: how this Spec Kit command runs here -->',
  'This command is executed by Maestro, a native Spec Kit host.',
  '- The Spec Kit helper scripts under `.specify/scripts/` (bash, PowerShell or Python spellings, e.g. `.specify/scripts/bash/check-prerequisites.sh --json` or `.specify/scripts/powershell/check-prerequisites.ps1 -Json`) are executed natively by Maestro when you call them through the `run_command` tool. They need no user confirmation and return exactly the JSON/text the scripts would. Always call them instead of creating feature directories, branches or `.specify/feature.json` by hand.',
  '- Whenever the command tells you to ask the user something or to wait for an answer (clarification questions, "proceed anyway?" checks), call the `ask_user` tool: one call per round with up to 4 questions, the suggested options as labels (put the recommended one first with "(Recommended)" in its label) and their implications as descriptions; "Other" is added automatically. Record each answer in the artifact before asking the next round, as the command requires. If the answer says the user declined, stop asking, keep what was already recorded and report the open items. If no interactive user is available, proceed with the documented default assumption and record it.',
  "- File writes and any other command follow the user's approval mode as usual.",
  '- Paths in the JSON the scripts return are absolute; use them as given.',
  '<!-- end of Maestro notes -->',
  '',
].join('\n');
