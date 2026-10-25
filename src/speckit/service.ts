import { CommandBlocked } from '../session/commands.js';
import type { SlashCommand } from '../session/commands.js';
import type { ToolDefinition, ToolResult } from '../tools/types.js';
import { noopLogger } from '../utils/logger.js';
import type { Logger } from '../utils/logger.js';
import { bundledAssets } from './assets.js';
import type { AssetsPort } from './assets.js';
import { discoverCommands, preflightFor } from './discovery.js';
import type { DiscoveryResult, SpecKitCommandFile } from './discovery.js';
import { findSpecifyRoot } from './feature.js';
import { systemGit } from './git.js';
import type { GitPort } from './git.js';
import { isInvocationError, parseInvocation } from './invocation.js';
import type { StepRequest } from './invocation.js';
import { initReportText, initSpecKit } from './init.js';
import { buildPromptTurn } from './prompt.js';
import { statusText } from './status.js';
import { runStep } from './steps/index.js';
import type { StepContext, StepResult } from './steps/index.js';

export interface SpecKitServiceOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  git?: GitPort;
  assets?: AssetsPort;
  settings?: { createBranch: boolean };
  logger?: Logger;
  now?: () => Date;
}

export type StepListener = (step: StepRequest['step'], result: StepResult) => void;

/**
 * Glue between the Spec Kit module and the session: discovered commands as slash commands,
 * the run_command interceptor that executes scripts natively, and preflight checks.
 */
export class SpecKitService {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly git: GitPort;
  readonly assets: AssetsPort;
  readonly settings: { createBranch: boolean };
  readonly logger: Logger;
  readonly now?: () => Date;
  private discovery: DiscoveryResult;
  /** Called after every native step (the controller turns it into a transcript notice). */
  onStep?: StepListener;

  constructor(opts: SpecKitServiceOptions) {
    this.cwd = opts.cwd;
    this.env = opts.env ?? process.env;
    this.git = opts.git ?? systemGit;
    this.assets = opts.assets ?? bundledAssets();
    this.settings = opts.settings ?? { createBranch: true };
    this.logger = opts.logger ?? noopLogger;
    this.now = opts.now;
    this.discovery = discoverCommands(this.root, this.assets);
  }

  get root(): string {
    return findSpecifyRoot(this.cwd, this.git);
  }

  get files(): SpecKitCommandFile[] {
    return this.discovery.commands;
  }

  get bundledVersion(): string {
    return this.assets.version;
  }

  /** Re-scans the command directories (after /speckit.init or external changes). */
  refresh(): void {
    this.discovery = discoverCommands(this.root, this.assets);
  }

  /** One line for /help: bundled version and the project folders that were scanned. */
  summary(): string {
    const parts = [`embutido ${this.assets.version}`];
    if (this.discovery.integrationDir)
      parts.push(`${this.discovery.integration}: ${this.discovery.integrationDir}`);
    if (this.files.some((f) => f.origin === 'project')) parts.push('projeto: .maestro/commands');
    return parts.join(' · ');
  }

  stepContext(readOnly = false): StepContext {
    return {
      cwd: this.cwd,
      env: this.env,
      git: this.git,
      assets: this.assets,
      settings: this.settings,
      now: this.now,
      readOnly,
    };
  }

  /** Runs the command's validation step without side effects; the failure result when blocked. */
  async preflight(file: SpecKitCommandFile): Promise<StepResult | undefined> {
    const req = preflightFor(file);
    if (!req) return undefined;
    const result = await runStep(req, this.stepContext(true));
    return result.ok ? undefined : result;
  }

  /** `/speckit.init` and `/speckit.status` (contracts/speckit-commands.md § 6). */
  nativeCommands(): SlashCommand[] {
    return [
      {
        name: 'speckit.init',
        usage: '/speckit.init [--upgrade]',
        description: 'Instala ou atualiza o Spec Kit neste projeto (templates, scripts, comandos)',
        origin: 'Maestro',
        run: (ctl, args) => {
          const upgrade = args.includes('--upgrade');
          const report = initSpecKit(this.root, { upgrade }, this.assets, this.git);
          this.logger.log('speckit.init', {
            upgrade,
            created: report.created.length,
            updated: report.updated.length,
            kept: report.kept.length,
          });
          ctl.notice(initReportText(report, upgrade), 'info');
          ctl.refreshCommands();
        },
      },
      {
        name: 'speckit.status',
        description: 'Feature atual, artefatos e versão do Spec Kit',
        origin: 'Maestro',
        run: (ctl) => {
          ctl.notice(
            statusText(
              { cwd: this.cwd, env: this.env, git: this.git },
              this.assets,
              this.discovery,
            ),
            'info',
          );
        },
      },
    ];
  }

  /** Discovered command files as prompt commands (contracts/speckit-commands.md § 2), plus the native ones. */
  commands(): SlashCommand[] {
    return [...this.promptCommands(), ...this.nativeCommands()];
  }

  private promptCommands(): SlashCommand[] {
    return this.files.map((file) => ({
      name: file.name,
      description: file.description || `Spec Kit: ${file.name}`,
      usage: file.name === 'speckit.specify' ? '/speckit.specify <descrição>' : undefined,
      origin: file.origin,
      kind: 'prompt' as const, // calls the model → has a route (specs/008)
      run: async (ctl, _args, rest) => {
        if (!ctl.tools.some((t) => t.name === 'run_command')) {
          throw new CommandBlocked(
            'Os comandos do Spec Kit precisam das ferramentas de workspace (remova --no-tools).',
          );
        }
        const blocked = await this.preflight(file);
        if (blocked) throw new CommandBlocked(blocked.output);
        return buildPromptTurn(file, rest ?? '');
      },
    }));
  }

  /** `TurnOptions.intercept`: Spec Kit script invocations become native steps. */
  readonly intercept = async (
    tool: ToolDefinition,
    input: unknown,
  ): Promise<ToolResult | undefined> => {
    if (tool.name !== 'run_command') return undefined;
    const command =
      typeof input === 'object' && input !== null
        ? String((input as { command?: unknown }).command ?? '')
        : '';
    const req = parseInvocation(command);
    if (!req) return undefined;
    if (isInvocationError(req)) {
      this.onStep?.(req.step, { ok: false, output: req.error, summary: req.error });
      return { isError: true, output: req.error };
    }
    const started = Date.now();
    const result = await runStep(req, this.stepContext());
    this.logger.log('speckit.step', { step: req.step, ok: result.ok, ms: Date.now() - started });
    this.onStep?.(req.step, result);
    // Warnings first (the scripts print them to stderr) so the JSON stays the last line.
    const output = result.warnings?.length
      ? `${result.warnings.join('\n')}\n${result.output}`
      : result.output;
    return { isError: !result.ok, output };
  };
}
