/**
 * Recognises Spec Kit script invocations in a shell command line (the three dialects: PowerShell
 * 0.4.x, bash and Python 1.x) and turns them into native step requests (contracts/native-steps.md § 1–2).
 */

export type StepRequest =
  | {
      step: 'create-feature';
      description: string;
      shortName?: string;
      number?: string;
      timestamp?: boolean;
      dryRun?: boolean;
      allowExisting?: boolean;
      json: boolean;
    }
  | { step: 'setup-plan'; json: boolean }
  | { step: 'setup-tasks'; json: boolean }
  | {
      step: 'check-prerequisites';
      json: boolean;
      requireSpec?: boolean;
      requireTasks?: boolean;
      includeTasks?: boolean;
      pathsOnly?: boolean;
      template?: string;
    }
  | { step: 'resolve-template'; name: string; json: boolean }
  | { step: 'update-agent-context'; agentType?: string; planPath?: string };

export type StepName = StepRequest['step'];

export interface InvocationError {
  step: StepName;
  error: string;
}

const SCRIPT_RE =
  /(?:^|[\\/])(?:\.specify[\\/])?scripts[\\/](bash|powershell|python)[\\/]([A-Za-z_-]+)\.(sh|ps1|py)$/;

const STEP_BY_SCRIPT: Record<string, StepName> = {
  'create-new-feature': 'create-feature',
  'setup-plan': 'setup-plan',
  'setup-tasks': 'setup-tasks',
  'check-prerequisites': 'check-prerequisites',
  'resolve-template': 'resolve-template',
  'update-agent-context': 'update-agent-context',
};

/** Programs/flags that may precede the script path. */
const LAUNCHERS = new Set([
  'pwsh',
  'pwsh.exe',
  'powershell',
  'powershell.exe',
  '-file',
  '-f',
  '-noprofile',
  '-executionpolicy',
  'bypass',
  '-command',
  '-c',
  'bash',
  'sh',
  'python',
  'python3',
  'py',
  '-3',
  '&',
  '.',
  'source',
]);

type Token = { kind: 'word'; text: string; quoted: boolean } | { kind: 'op'; text: string };

/** POSIX-ish tokenizer: quotes, `'\''`, backslash escapes outside single quotes, operators. */
export function tokenize(command: string): Token[] {
  const tokens: Token[] = [];
  let cur = '';
  let quoted = false;
  let has = false;
  let i = 0;
  const flush = () => {
    if (has) tokens.push({ kind: 'word', text: cur, quoted });
    cur = '';
    quoted = false;
    has = false;
  };
  while (i < command.length) {
    const ch = command[i]!;
    if (ch === "'") {
      has = true;
      quoted = true;
      i++;
      while (i < command.length && command[i] !== "'") cur += command[i++];
      i++;
      continue;
    }
    if (ch === '"') {
      has = true;
      quoted = true;
      i++;
      while (i < command.length && command[i] !== '"') {
        if (command[i] === '\\' && i + 1 < command.length && '"\\$`'.includes(command[i + 1]!)) i++;
        cur += command[i++];
      }
      i++;
      continue;
    }
    // Backslash escapes only what bash would need escaped; Windows paths (`C:\repo\x`) stay intact.
    if (ch === '\\' && i + 1 < command.length && ' "\'$`\\'.includes(command[i + 1]!)) {
      has = true;
      cur += command[i + 1];
      i += 2;
      continue;
    }
    if (/\s/.test(ch)) {
      flush();
      i++;
      continue;
    }
    const two = command.slice(i, i + 2);
    if (two === '&&' || two === '||') {
      flush();
      tokens.push({ kind: 'op', text: two });
      i += 2;
      continue;
    }
    if (ch === ';' || ch === '|') {
      flush();
      tokens.push({ kind: 'op', text: ch });
      i++;
      continue;
    }
    has = true;
    cur += ch;
    i++;
  }
  flush();
  return tokens;
}

function segments(tokens: Token[]): Word[][] {
  const out: Word[][] = [];
  let cur: Word[] = [];
  for (const t of tokens) {
    if (t.kind === 'op') {
      if (cur.length) out.push(cur);
      cur = [];
    } else cur.push(t);
  }
  if (cur.length) out.push(cur);
  return out;
}

function flag(word: string): string {
  // `-RequireTasks` → `require-tasks`; `--require-tasks` → `require-tasks`
  const stripped = word.replace(/^-{1,2}/, '');
  return stripped
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/_/g, '-')
    .toLowerCase();
}

type Word = Extract<Token, { kind: 'word' }>;

function parseArgs(step: StepName, args: Word[]): StepRequest | InvocationError {
  const positional: string[] = [];
  const flags = new Set<string>();
  const values: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const t = args[i]!;
    if (t.quoted || !t.text.startsWith('-') || t.text === '-') {
      positional.push(t.text);
      continue;
    }
    const name = flag(t.text);
    const withValue = ['short-name', 'number', 'template', 'agent-type'];
    if (withValue.includes(name)) {
      const next = args[i + 1];
      if (!next || (!next.quoted && next.text.startsWith('-'))) {
        return { step, error: `Error: --${name} requires a value` };
      }
      values[name] = next.text;
      i++;
      continue;
    }
    const known: Record<StepName, string[]> = {
      'create-feature': ['json', 'timestamp', 'dry-run', 'allow-existing-branch', 'help', 'h'],
      'setup-plan': ['json', 'help', 'h'],
      'setup-tasks': ['json', 'help', 'h'],
      'check-prerequisites': [
        'json',
        'require-spec',
        'require-tasks',
        'include-tasks',
        'paths-only',
        'help',
        'h',
      ],
      'resolve-template': ['json', 'help', 'h'],
      'update-agent-context': ['help', 'h'],
    };
    if (!known[step].includes(name)) {
      return {
        step,
        error: `ERROR: Unknown option '${t.text}'. Use --help for usage information.`,
      };
    }
    flags.add(name);
  }
  const json = flags.has('json');
  switch (step) {
    case 'create-feature': {
      const description = positional.join(' ').trim();
      const req: StepRequest = {
        step,
        description,
        json,
        shortName: values['short-name'],
        number: values['number'],
        timestamp: flags.has('timestamp') || undefined,
        dryRun: flags.has('dry-run') || undefined,
        allowExisting: flags.has('allow-existing-branch') || undefined,
      };
      // A missing description is reported by the step itself (the frontmatter line has none yet).
      return req;
    }
    case 'setup-plan':
      return { step: 'setup-plan', json };
    case 'setup-tasks':
      return { step: 'setup-tasks', json };
    case 'check-prerequisites':
      return {
        step,
        json,
        requireSpec: flags.has('require-spec') || undefined,
        requireTasks: flags.has('require-tasks') || undefined,
        includeTasks: flags.has('include-tasks') || undefined,
        pathsOnly: flags.has('paths-only') || undefined,
        template: values['template'],
      };
    case 'resolve-template': {
      const name = positional[0];
      if (!name) return { step, error: 'ERROR: Template name is required' };
      return { step, name, json };
    }
    case 'update-agent-context':
      return {
        step,
        agentType: values['agent-type'] ?? positional[0],
        planPath: values['agent-type'] ? positional[0] : positional[1],
      };
  }
}

export function isInvocationError(r: StepRequest | InvocationError): r is InvocationError {
  return 'error' in r;
}

/** Undefined when no segment of the command line is a Spec Kit script. */
export function parseInvocation(command: string): StepRequest | InvocationError | undefined {
  for (const seg of segments(tokenize(command))) {
    for (let i = 0; i < seg.length; i++) {
      const word = seg[i]!;
      const normalized = word.text.replace(/^&\s*/, '').replace(/^\.\//, '');
      const m = SCRIPT_RE.exec(normalized);
      if (m) {
        const step = STEP_BY_SCRIPT[m[2]!.replace(/_/g, '-')];
        if (!step) return undefined; // a Spec Kit path we do not implement: run it as a normal command
        return parseArgs(step, seg.slice(i + 1));
      }
      // Only launchers (pwsh -File, bash, python3 …) may precede the script; anything else
      // (`cd x`, `npm test`) means this segment is not a script invocation.
      if (!LAUNCHERS.has(word.text.toLowerCase()) && !word.text.startsWith('-')) break;
    }
  }
  return undefined;
}
