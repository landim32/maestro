import fs from 'node:fs';
import path from 'node:path';
import { FeatureNotFoundError, resolveFeaturePaths } from '../feature.js';
import type { StepRequest } from '../invocation.js';
import { resolveTemplateContent } from '../templates.js';
import { fail, ok } from './types.js';
import type { StepContext, StepResult } from './types.js';

type Req = Extract<StepRequest, { step: 'update-agent-context' }>;

/** Agent context files, after spec-kit's update-agent-context (0.4.x), plus Maestro's own. */
export const AGENT_FILES: Record<string, { file: string; name: string }> = {
  maestro: { file: 'MAESTRO.md', name: 'Maestro' },
  claude: { file: 'CLAUDE.md', name: 'Claude Code' },
  gemini: { file: 'GEMINI.md', name: 'Gemini CLI' },
  copilot: { file: '.github/copilot-instructions.md', name: 'GitHub Copilot' },
  'cursor-agent': { file: '.cursor/rules/specify-rules.mdc', name: 'Cursor IDE' },
  qwen: { file: 'QWEN.md', name: 'Qwen Code' },
  opencode: { file: 'AGENTS.md', name: 'opencode' },
  codex: { file: 'AGENTS.md', name: 'Codex CLI' },
  windsurf: { file: '.windsurf/rules/specify-rules.md', name: 'Windsurf' },
  junie: { file: '.junie/AGENTS.md', name: 'Junie' },
  kilocode: { file: '.kilocode/rules/specify-rules.md', name: 'Kilo Code' },
  auggie: { file: '.augment/rules/specify-rules.md', name: 'Auggie CLI' },
  roo: { file: '.roo/rules/specify-rules.md', name: 'Roo Code' },
  codebuddy: { file: 'CODEBUDDY.md', name: 'CodeBuddy CLI' },
  qodercli: { file: 'QODER.md', name: 'Qoder CLI' },
  amp: { file: 'AGENTS.md', name: 'Amp' },
  shai: { file: 'SHAI.md', name: 'SHAI' },
  tabnine: { file: 'TABNINE.md', name: 'Tabnine CLI' },
  'kiro-cli': { file: 'AGENTS.md', name: 'Kiro CLI' },
  agy: { file: '.agent/rules/specify-rules.md', name: 'Antigravity' },
  bob: { file: 'AGENTS.md', name: 'IBM Bob' },
  vibe: { file: '.vibe/agents/specify-agents.md', name: 'Mistral Vibe' },
  kimi: { file: 'KIMI.md', name: 'Kimi Code' },
  trae: { file: '.trae/rules/AGENTS.md', name: 'Trae' },
  pi: { file: 'AGENTS.md', name: 'Pi Coding Agent' },
  iflow: { file: 'IFLOW.md', name: 'iFlow CLI' },
};

export interface PlanFacts {
  language?: string;
  framework?: string;
  storage?: string;
  projectType?: string;
}

const SKIP = new Set(['NEEDS CLARIFICATION', 'N/A']);

function field(plan: string, label: string): string | undefined {
  const re = new RegExp(
    `^\\*\\*${label.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\*\\*: (.+)$`,
    'm',
  );
  const m = re.exec(plan);
  if (!m) return undefined;
  const value = m[1]!.trim();
  return SKIP.has(value) ? undefined : value;
}

/** `**Language/Version**: …` lines of the plan's Technical Context. */
export function parsePlanFacts(plan: string): PlanFacts {
  return {
    language: field(plan, 'Language/Version'),
    framework: field(plan, 'Primary Dependencies'),
    storage: field(plan, 'Storage'),
    projectType: field(plan, 'Project Type'),
  };
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

function techStack(f: PlanFacts): string {
  return [f.language, f.framework].filter((v): v is string => Boolean(v)).join(' + ');
}

function commandsFor(lang: string | undefined): string {
  if (!lang) return '# Add commands for your stack';
  if (/python/i.test(lang)) return 'cd src; pytest; ruff check .';
  if (/rust/i.test(lang)) return 'cargo test; cargo clippy';
  if (/javascript|typescript/i.test(lang)) return 'npm test; npm run lint';
  return `# Add commands for ${lang}`;
}

/** A new context file from the agent-file template (spec-kit `New-AgentFile`). */
export function createAgentFile(
  template: string,
  facts: PlanFacts,
  branch: string,
  projectName: string,
  now: Date,
): string {
  const stack = techStack(facts);
  const techLine = stack ? `- ${stack} (${branch})` : '';
  const change = stack ? `- ${branch}: Added ${stack}` : '';
  const structure = /web/i.test(facts.projectType ?? '')
    ? 'backend/\nfrontend/\ntests/'
    : 'src/\ntests/';
  return template
    .replace(/\[PROJECT NAME\]/g, projectName)
    .replace(/\[DATE\]/g, iso(now))
    .replace(/\[EXTRACTED FROM ALL PLAN\.MD FILES\]/g, techLine)
    .replace(/\[ACTUAL STRUCTURE FROM PLANS\]/g, structure)
    .replace(/\[ONLY COMMANDS FOR ACTIVE TECHNOLOGIES\]/g, commandsFor(facts.language))
    .replace(
      /\[LANGUAGE-SPECIFIC, ONLY FOR LANGUAGES IN USE\]/g,
      facts.language
        ? `${facts.language}: Follow standard conventions`
        : 'General: Follow standard conventions',
    )
    .replace(/\[LAST 3 FEATURES AND WHAT THEY ADDED\]/g, change);
}

/**
 * Updates an existing context file (spec-kit `Update-ExistingAgentFile`): new tech entries under
 * "## Active Technologies", one entry on top of "## Recent Changes" keeping three, the
 * "Last updated" date; everything else — including the manual-additions section — untouched.
 */
export function updateAgentFile(text: string, facts: PlanFacts, branch: string, now: Date): string {
  const stack = techStack(facts);
  const newTech: string[] = [];
  if (stack && !text.includes(stack)) newTech.push(`- ${stack} (${branch})`);
  if (facts.storage && !text.includes(facts.storage))
    newTech.push(`- ${facts.storage} (${branch})`);
  const change = stack
    ? `- ${branch}: Added ${stack}`
    : facts.storage
      ? `- ${branch}: Added ${facts.storage}`
      : '';

  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  let inTech = false;
  let inChanges = false;
  let techAdded = false;
  let existingChanges = 0;

  for (const line of lines) {
    if (line === '## Active Technologies') {
      out.push(line);
      inTech = true;
      continue;
    }
    if (inTech && (/^##\s/.test(line) || line.trim() === '')) {
      if (!techAdded && newTech.length) {
        out.push(...newTech);
        techAdded = true;
      }
      out.push(line);
      if (/^##\s/.test(line)) inTech = false;
      continue;
    }
    if (line === '## Recent Changes') {
      out.push(line);
      if (change) out.push(change);
      inChanges = true;
      continue;
    }
    if (inChanges && /^##\s/.test(line)) {
      out.push(line);
      inChanges = false;
      continue;
    }
    if (inChanges && /^- /.test(line)) {
      if (existingChanges < 2) {
        out.push(line);
        existingChanges++;
      }
      continue;
    }
    if (/(\*\*)?Last updated(\*\*)?: .*\d{4}-\d{2}-\d{2}/.test(line)) {
      out.push(line.replace(/\d{4}-\d{2}-\d{2}/, iso(now)));
      continue;
    }
    out.push(line);
  }
  if (inTech && !techAdded && newTech.length) out.push(...newTech);
  return out.join(eol);
}

const CURSOR_FRONTMATTER =
  '---\ndescription: Project Development Guidelines\nglobs: ["**/*"]\nalwaysApply: true\n---\n';

export function updateAgentContext(req: Req, ctx: StepContext): StepResult {
  let paths;
  try {
    paths = resolveFeaturePaths(ctx, { persist: false });
  } catch (err) {
    if (err instanceof FeatureNotFoundError) return fail([err.message]);
    throw err;
  }
  const planPath = req.planPath ? path.resolve(paths.REPO_ROOT, req.planPath) : paths.IMPL_PLAN;
  if (!fs.existsSync(planPath)) {
    return fail([
      `ERROR: No plan.md found at ${planPath}`,
      'INFO: Ensure you are working on a feature with a corresponding spec directory',
    ]);
  }
  const template = resolveTemplateContent('agent-file-template', paths.REPO_ROOT, ctx.assets);
  if (template === undefined) {
    return fail([
      `ERROR: Template file not found at ${path.join(paths.REPO_ROOT, '.specify', 'templates', 'agent-file-template.md')}`,
      'INFO: Run /speckit.init to scaffold .specify/templates, or add agent-file-template.md there.',
    ]);
  }

  const facts = parsePlanFacts(fs.readFileSync(planPath, 'utf8'));
  const lines: string[] = [
    `INFO: === Updating agent context files for feature ${paths.CURRENT_BRANCH} ===`,
    `INFO: Parsing plan data from ${planPath}`,
  ];
  if (facts.language) lines.push(`INFO: Found language: ${facts.language}`);
  else lines.push('WARNING: No language information found in plan');
  if (facts.framework) lines.push(`INFO: Found framework: ${facts.framework}`);
  if (facts.storage) lines.push(`INFO: Found database: ${facts.storage}`);
  if (facts.projectType) lines.push(`INFO: Found project type: ${facts.projectType}`);

  if (req.agentType && !(req.agentType in AGENT_FILES) && req.agentType !== 'generic') {
    return fail([
      `ERROR: Unknown agent type '${req.agentType}'`,
      `ERROR: Expected: ${Object.keys(AGENT_FILES).join('|')}|generic`,
    ]);
  }

  // Targets: MAESTRO.md always; the requested agent; every known agent file that already exists.
  const targets = new Map<string, string>();
  targets.set(AGENT_FILES['maestro']!.file, AGENT_FILES['maestro']!.name);
  if (req.agentType && req.agentType !== 'generic') {
    const a = AGENT_FILES[req.agentType]!;
    targets.set(a.file, a.name);
  }
  for (const a of Object.values(AGENT_FILES)) {
    if (fs.existsSync(path.join(paths.REPO_ROOT, a.file))) targets.set(a.file, a.name);
  }

  const now = (ctx.now ?? (() => new Date()))();
  const created: string[] = [];
  const updated: string[] = [];
  const projectName = path.basename(paths.REPO_ROOT);
  for (const [rel, name] of targets) {
    const file = path.join(paths.REPO_ROOT, rel);
    lines.push(`INFO: Updating ${name} context file: ${file}`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(file)) {
      let content = createAgentFile(template, facts, paths.CURRENT_BRANCH, projectName, now);
      if (rel.endsWith('.mdc')) content = CURSOR_FRONTMATTER + content;
      fs.writeFileSync(file, content, 'utf8');
      created.push(rel);
      lines.push(`✓ Created new ${name} context file`);
    } else {
      let content = updateAgentFile(
        fs.readFileSync(file, 'utf8'),
        facts,
        paths.CURRENT_BRANCH,
        now,
      );
      if (rel.endsWith('.mdc') && !content.startsWith('---'))
        content = CURSOR_FRONTMATTER + content;
      fs.writeFileSync(file, content, 'utf8');
      updated.push(rel);
      lines.push(`✓ Updated existing ${name} context file`);
    }
  }
  lines.push('', 'INFO: Summary of changes:');
  if (facts.language) lines.push(`  - Added language: ${facts.language}`);
  if (facts.framework) lines.push(`  - Added framework: ${facts.framework}`);
  if (facts.storage) lines.push(`  - Added database: ${facts.storage}`);
  lines.push('✓ Agent context update completed successfully');

  const summary = [
    ...created.map((f) => `${f} criado`),
    ...updated.map((f) => `${f} atualizado`),
  ].join(', ');
  return ok(lines.join('\n'), summary, { created, updated, facts: { ...facts } });
}
