/**
 * @license
 * Portions adapted from qwen-code (https://github.com/QwenLM/qwen-code),
 * packages/core/src/config/approval-mode.ts and packages/cli/src/config/approval-mode-value.ts
 * @ 1c9cdd234fd9a391cac146e2d4c834d603afd045.
 * Copyright 2025 Qwen Team. Copyright 2025 Google LLC.
 * SPDX-License-Identifier: Apache-2.0
 * Modified for Maestro; see THIRD_PARTY_NOTICES.md.
 */

/**
 * Approval policy (specs/005-approval-modes-ask-user/contracts/approval-modes.md).
 * Pure: no I/O, no UI. The session owns the live mode; tools declare their `kind`.
 */

/** Cycle order (TAB advances, Shift+TAB goes back). Values match qwen-code. */
export const APPROVAL_MODES = ['default', 'auto-edit', 'auto', 'yolo'] as const;
export type ApprovalMode = (typeof APPROVAL_MODES)[number];

/** What a tool does, declared on its definition. */
export type ToolKind = 'read' | 'edit' | 'command' | 'question';
/** The tool kind after inspecting the input (`command` may become `destructive`). */
export type ActionKind = ToolKind | 'destructive';

export interface ApprovalModeInfo {
  id: ApprovalMode;
  /** Full label for the status bar and messages. */
  label: string;
  /** Short label for compact terminals. */
  short: string;
  danger: 'none' | 'warn' | 'high';
  description: string;
}

const INFO: Record<ApprovalMode, ApprovalModeInfo> = {
  default: {
    id: 'default',
    label: 'Pedir permissão',
    short: 'ask',
    danger: 'none',
    description: 'toda edição e todo comando pedem confirmação',
  },
  'auto-edit': {
    id: 'auto-edit',
    label: 'Aceitar edições',
    short: 'edits',
    danger: 'warn',
    description: 'edições de arquivo são aplicadas; comandos pedem confirmação',
  },
  auto: {
    id: 'auto',
    label: 'Automático',
    short: 'auto',
    danger: 'warn',
    description: 'edições e comandos executam; só comandos destrutivos pedem confirmação',
  },
  yolo: {
    id: 'yolo',
    label: 'YOLO',
    short: 'YOLO',
    danger: 'high',
    description: 'nada pede confirmação',
  },
};

export function approvalModeInfo(mode: ApprovalMode): ApprovalModeInfo {
  return INFO[mode];
}

/** Accepts the ids in any case plus the legacy spellings `auto_edit` / `autoedit`. */
export function parseApprovalMode(value: string): ApprovalMode | undefined {
  const normalized = value.trim().toLowerCase();
  const canonical =
    normalized === 'auto_edit' || normalized === 'autoedit' ? 'auto-edit' : normalized;
  return (APPROVAL_MODES as readonly string[]).includes(canonical)
    ? (canonical as ApprovalMode)
    : undefined;
}

export function nextApprovalMode(mode: ApprovalMode, dir: 1 | -1): ApprovalMode {
  const i = APPROVAL_MODES.indexOf(mode);
  const n = APPROVAL_MODES.length;
  return APPROVAL_MODES[(i + dir + n) % n]!;
}

/** FR-003 table. `read` and `question` never reach this function. */
export function needsConfirmation(mode: ApprovalMode, kind: ActionKind): boolean {
  switch (kind) {
    case 'read':
    case 'question':
      return false;
    case 'edit':
      return mode === 'default';
    case 'command':
      return mode === 'default' || mode === 'auto-edit';
    case 'destructive':
      return mode !== 'yolo';
  }
}

// ---------------------------------------------------------------- destructive commands

export interface DestructivePattern {
  id: string;
  pattern: RegExp;
  /** `segment`: tested against each pipeline segment; `command`: against the whole line. */
  scope: 'segment' | 'command';
  reason: string;
}

/** Optional env assignments and an optional path prefix before the command name. */
const LEAD = String.raw`^(?:[A-Za-z_]\w*=\S*\s+)*(?:\S*[\\/])?`;
const cmd = (body: string, flags = 'i'): RegExp => new RegExp(LEAD + body, flags);

/** research R3 — conveniences against accidents, not a security boundary. */
export const DESTRUCTIVE_PATTERNS: readonly DestructivePattern[] = [
  {
    id: 'rm-recursive',
    scope: 'segment',
    pattern: cmd(
      String.raw`(?:rm(?:\.exe)?\s+(?:-\S*\s+)*(?:-[a-z]*r|--recursive)|rmdir\s+(?:\S+\s+)*/s\b|rd\s+(?:\S+\s+)*/s\b|Remove-Item\b.*\s-Recurse\b)`,
    ),
    reason: 'remoção recursiva',
  },
  {
    id: 'rm-force',
    scope: 'segment',
    pattern: cmd(
      String.raw`(?:rm(?:\.exe)?\s+(?:-\S*\s+)*(?:-[a-z]*f|--force)|del\s+(?:\S+\s+)*/[fq]\b|erase\s+(?:\S+\s+)*/[fq]\b|Remove-Item\b.*\s-Force\b)`,
    ),
    reason: 'remoção forçada',
  },
  {
    id: 'git-destructive',
    scope: 'segment',
    // Case-sensitive: `git branch -d` (merged only) is safe, `-D` is not.
    pattern: cmd(
      String.raw`git\s+(?:-\S+\s+)*(?:reset\s+(?:\S+\s+)*--hard|clean\s+(?:\S+\s+)*-[a-zA-Z]*[fdx]|checkout\s+(?:\S+\s+)*--(?:\s|$)|restore(?:\s|$)|branch\s+(?:\S+\s+)*(?:-D\b|--delete\s+--force|--force\s+--delete)|rebase\b|commit\s+(?:\S+\s+)*--amend|stash\s+(?:drop|clear)\b)`,
      '',
    ),
    reason: 'descarta alterações ou reescreve o histórico do git',
  },
  {
    id: 'git-force-push',
    scope: 'segment',
    pattern: cmd(
      String.raw`git\s+(?:-\S+\s+)*push\b(?=.*(?:\s--force\b|\s--force-with-lease|\s-[a-zA-Z]*f\b|\s--delete\b|\s\+\S+))`,
      '',
    ),
    reason: 'envio forçado ao remoto',
  },
  {
    id: 'disk',
    scope: 'segment',
    pattern: cmd(
      String.raw`(?:mkfs(?:\.\w+)?\b|format(?:\.com|\.exe)?(?:\s|$)|diskpart\b|dd\s+(?=.*\b(?:if|of)=)|fdisk\b|parted\b|wipefs\b|Format-Volume\b|Clear-Disk\b)`,
    ),
    reason: 'formatação ou escrita direta em disco',
  },
  {
    id: 'power',
    scope: 'segment',
    pattern: cmd(
      String.raw`(?:shutdown\b|reboot\b|halt\b|poweroff\b|init\s+[06]\b|systemctl\s+(?:poweroff|reboot|halt)\b|Restart-Computer\b|Stop-Computer\b)`,
    ),
    reason: 'desligamento ou reinício da máquina',
  },
  {
    id: 'perms',
    scope: 'segment',
    pattern: cmd(
      String.raw`(?:(?:chmod|chown|chgrp)\s+(?:\S+\s+)*-[a-z]*R\b|icacls\b.*\s/T\b|takeown\b.*\s/r\b)`,
    ),
    reason: 'alteração de permissões em massa',
  },
  {
    id: 'sys-redirect',
    scope: 'segment',
    pattern: new RegExp(
      String.raw`>{1,2}\s*["']?(?:/etc/|/boot/|/usr/|/bin/|/sbin/|/dev/sd|[A-Za-z]:\\Windows\\)`,
      'i',
    ),
    reason: 'sobrescreve arquivos de sistema',
  },
  {
    id: 'pipe-shell',
    scope: 'command',
    pattern: new RegExp(
      String.raw`\b(?:curl|wget|iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b[^|]*\|\s*(?:\S*[\\/])?(?:sh|bash|zsh|ksh|dash|fish|iex|Invoke-Expression|pwsh|powershell|python\d*|node|perl|ruby)\b`,
      'i',
    ),
    reason: 'executa um download sem inspeção',
  },
  {
    id: 'sudo',
    scope: 'segment',
    pattern: cmd(String.raw`(?:sudo|doas|gsudo|runas)(?:\s|$)`),
    reason: 'privilégios elevados',
  },
];

/** Splits a command line on `;`, `&&`, `||` and `|`, trimming each segment. */
export function splitCommandSegments(command: string): string[] {
  return command
    .split(/\|\||&&|;|\|/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isDestructiveCommand(command: string): DestructivePattern | undefined {
  const segments = splitCommandSegments(command);
  for (const p of DESTRUCTIVE_PATTERNS) {
    if (p.scope === 'command') {
      if (p.pattern.test(command)) return p;
    } else if (segments.some((s) => p.pattern.test(s))) {
      return p;
    }
  }
  return undefined;
}

/** Classifies a tool call; `command` becomes `destructive` when a pattern matches. */
export function classifyAction(
  tool: { kind: ToolKind },
  input: unknown,
): { kind: ActionKind; reason?: string } {
  if (tool.kind !== 'command') return { kind: tool.kind };
  const command =
    typeof input === 'object' && input !== null && 'command' in input
      ? String((input as { command: unknown }).command)
      : '';
  const hit = isDestructiveCommand(command);
  return hit ? { kind: 'destructive', reason: hit.reason } : { kind: 'command' };
}
