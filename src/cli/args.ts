import yargs from 'yargs';
import { PROVIDER_IDS } from '../config/schema.js';
import type { ProviderId } from '../config/schema.js';
import { APPROVAL_MODES, parseApprovalMode } from '../tools/approval.js';
import type { ApprovalMode } from '../tools/approval.js';
import { bundledAssets } from '../speckit/assets.js';
import { APP_NAME, VERSION } from '../version.js';

export interface ParsedArgs {
  action: 'run' | 'help' | 'version';
  prompt?: string;
  provider?: ProviderId;
  model?: string;
  /** `--route` (specs/008): forced route for a `-p` request. */
  route?: string;
  /** `--autopilot <file | prompt>` (specs/011): run the stories (or the prompt) through the Spec Kit. */
  autopilot?: string;
  /** `--resume` with --autopilot: continue the interrupted or stopped run. */
  resume?: boolean;
  config?: string;
  tools: boolean;
  color: boolean;
  altScreen: boolean;
  debug: boolean;
  /** `--approval-mode` / `--yolo`; undefined keeps settings.tools.approvalMode. */
  approvalMode?: ApprovalMode;
  helpText?: string;
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

function build(argv: string[]) {
  return yargs(argv)
    .scriptName(APP_NAME)
    .usage('$0 [options]\n$0 -p "<prompt>" [options]')
    .option('prompt', {
      alias: 'p',
      type: 'string',
      describe: 'Run a single turn and exit. Use "-" to read the prompt from stdin.',
    })
    .option('provider', {
      type: 'string',
      choices: PROVIDER_IDS,
      describe: 'Provider to use for this run (overrides settings.activeProvider).',
    })
    .option('model', { type: 'string', describe: 'Model name for this run.' })
    .option('route', {
      type: 'string',
      describe: 'Route (provider/model) for this -p request, e.g. github or speckit.plan.',
    })
    .option('autopilot', {
      type: 'string',
      describe:
        'Run every story of the file (or a prompt, as one story) through the Spec Kit without interaction.',
    })
    .option('resume', {
      type: 'boolean',
      describe: 'With --autopilot: resume the interrupted or stopped run.',
    })
    .option('config', { type: 'string', describe: 'Path to the global settings.json.' })
    .option('tools', {
      type: 'boolean',
      default: true,
      describe: 'Enable workspace tools (--no-tools to disable).',
    })
    .option('color', {
      type: 'boolean',
      default: true,
      describe: 'Colored output (--no-color to disable).',
    })
    .option('altscreen', {
      type: 'boolean',
      default: true,
      describe: 'Draw on the alternate screen (--no-altscreen to stay in the main buffer).',
    })
    .option('approval-mode', {
      type: 'string',
      describe: `Initial approval mode: ${APPROVAL_MODES.join(' | ')} (Tab cycles it in the session).`,
      coerce: (v: unknown) => {
        if (v === undefined) return undefined;
        const mode = parseApprovalMode(String(v));
        if (!mode) {
          throw new UsageError(
            `Invalid --approval-mode '${String(v)}'. Expected one of: ${APPROVAL_MODES.join(', ')}.`,
          );
        }
        return mode;
      },
    })
    .option('yolo', {
      type: 'boolean',
      default: false,
      describe: 'Shortcut for --approval-mode yolo (never ask for confirmation).',
    })
    .option('debug', {
      type: 'boolean',
      default: false,
      describe: 'Verbose errors and ~/.maestro/debug.log.',
    })
    .version(false)
    .help(false)
    .strict()
    .exitProcess(false)
    .fail((msg, err) => {
      throw new UsageError(msg || err?.message || 'invalid arguments');
    });
}

/** Parses CLI arguments (contracts/cli.md § 1). Throws UsageError on invalid input. */
export async function parseArgs(argv: string[]): Promise<ParsedArgs> {
  if (argv.includes('-v') || argv.includes('--version')) {
    return { action: 'version', tools: true, color: true, altScreen: true, debug: false };
  }
  if (argv.includes('-h') || argv.includes('--help')) {
    const helpText = await build(argv.filter((a) => a !== '-h' && a !== '--help')).getHelp();
    return { action: 'help', tools: true, color: true, altScreen: true, debug: false, helpText };
  }
  const parsed = await build(argv).parseAsync();
  const positional = parsed._.filter((p) => p !== '');
  if (positional.length > 0) {
    throw new UsageError(
      `Unexpected argument: ${positional.join(' ')}. Use -p "<prompt>" to pass a prompt.`,
    );
  }
  let autopilot = parsed.autopilot as string | undefined;
  if (parsed.resume && autopilot === undefined)
    throw new UsageError('--resume só vale com --autopilot <arquivo>.');
  if (autopilot !== undefined) {
    const prompt = parsed.prompt?.trim() ?? '';
    // `-p "texto" --autopilot`: the prompt is the autopilot's input (one story).
    if (autopilot.trim() === '' && prompt !== '' && parsed.prompt !== '-' && !parsed.resume)
      autopilot = parsed.prompt!;
    // `-p --autopilot x` is accepted (the -p is then empty); a prompt plus a file is not.
    else if (prompt !== '')
      throw new UsageError(
        '--autopilot <arquivo> não pode ser combinado com um prompt (-p "…"); use -p "…" --autopilot.',
      );
    if (parsed.route !== undefined)
      throw new UsageError(
        '--autopilot não pode ser combinado com --route (cada passo usa a sua rota).',
      );
    if (autopilot.trim() === '' && !parsed.resume)
      throw new UsageError('--autopilot precisa do arquivo de histórias ou de um prompt.');
  } else if (parsed.prompt !== undefined && parsed.prompt !== '-' && parsed.prompt.trim() === '') {
    throw new UsageError('--prompt must not be empty.');
  }
  return {
    action: 'run',
    prompt: autopilot !== undefined ? undefined : parsed.prompt,
    provider: parsed.provider as ProviderId | undefined,
    model: parsed.model,
    route: parsed.route,
    autopilot,
    resume: parsed.resume || undefined,
    config: parsed.config,
    tools: parsed.tools,
    color: parsed.color,
    altScreen: parsed.altscreen,
    debug: parsed.debug,
    approvalMode: parsed.yolo ? 'yolo' : (parsed['approval-mode'] as ApprovalMode | undefined),
  };
}

export function versionText(): string {
  return `${APP_NAME} ${VERSION}\nspec-kit ${bundledAssets().version} (embutido)`;
}
