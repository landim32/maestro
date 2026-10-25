#!/usr/bin/env node
import { parseArgs, UsageError, versionText } from './cli/args.js';
import { EXIT } from './cli/exitCodes.js';
import { firstRunMessage } from './cli/firstRun.js';
import { preflight } from './cli/preflight.js';
import { ConfigError, loadSettings } from './config/loader.js';
import type { ProviderContext } from './providers/types.js';
import { Session } from './session/session.js';
import { SessionController } from './session/controller.js';
import { buildSystemPrompt } from './session/systemPrompt.js';
import { hasWorkspaceTools, toolsFor } from './tools/registry.js';
import { formatError, toMaestroError } from './utils/errors.js';
import { createLogger } from './utils/logger.js';
import { isInteractive } from './utils/tty.js';
import { debugLogPath, historyPath } from './config/paths.js';
import { fileHistoryStore, InputHistory } from './session/history.js';
import { VERSION } from './version.js';

async function main(argv: string[]): Promise<number> {
  let args;
  try {
    args = await parseArgs(argv);
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`maestro: ${err.message}\nTry 'maestro --help'.\n`);
      return EXIT.USAGE;
    }
    throw err;
  }
  if (args.action === 'version') {
    process.stdout.write(versionText() + '\n');
    return EXIT.OK;
  }
  if (args.action === 'help') {
    process.stdout.write((args.helpText ?? '') + '\n');
    return EXIT.OK;
  }
  if (!args.color) process.env['NO_COLOR'] = '1';

  let loaded;
  try {
    loaded = loadSettings({
      configPath: args.config,
      overrides: {
        provider: args.provider,
        model: args.model,
        noTools: !args.tools,
        approvalMode: args.approvalMode,
      },
    });
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`maestro: configuration error in ${err.message}\n`);
      return EXIT.USAGE;
    }
    throw err;
  }

  const ctx: ProviderContext = {
    settings: loaded.settings,
    credentialSources: loaded.credentialSources,
    activeId: loaded.settings.activeProvider,
  };
  // Loaded lazily: registering providers pulls in both SDKs, which --version/--help never need.
  const { listStatuses } = await import('./providers/index.js');
  const statuses = listStatuses(ctx);
  const nonInteractive = args.prompt !== undefined;
  const interactive = !nonInteractive && isInteractive();

  if (loaded.created) process.stderr.write(firstRunMessage(loaded.globalPath, statuses) + '\n\n');

  const pf = await preflight({ statuses, activeId: ctx.activeId, interactive });
  if (!pf.ok) return pf.code;
  ctx.activeId = pf.providerId;

  const cwd = process.cwd();
  const tools = toolsFor(loaded.settings.tools);
  const logger = createLogger({
    enabled: args.debug,
    filePath: debugLogPath(),
    secrets: [
      loaded.settings.providers.claude.apiKey,
      loaded.settings.providers.qwen.apiKey,
      process.env['ANTHROPIC_API_KEY'],
      process.env['ANTHROPIC_AUTH_TOKEN'],
      process.env['DASHSCOPE_API_KEY'],
    ],
  });
  logger.log('start', {
    version: VERSION,
    provider: ctx.activeId,
    cwd,
    tools: tools.length,
    interactive,
    approvalMode: loaded.settings.tools.approvalMode,
  });
  const session = new Session({
    cwd,
    activeProviderId: ctx.activeId,
    modelOverride: pf.switched ? undefined : args.model,
  });
  const controller = new SessionController({
    session,
    ctx,
    tools,
    system: buildSystemPrompt({
      cwd,
      toolsEnabled: hasWorkspaceTools(tools),
      askUser: tools.some((t) => t.name === 'ask_user'),
    }),
    debug: args.debug,
    interactive: !nonInteractive,
    logger,
    settingsPaths: { globalPath: loaded.globalPath, cwd },
    env: process.env,
    // Input history is interactive-only: `-p` neither reads nor writes it (contracts/history.md § 2).
    history: nonInteractive
      ? undefined
      : new InputHistory(fileHistoryStore(historyPath(process.env), logger)),
  });

  if (nonInteractive) {
    const { runNonInteractive } = await import('./cli/nonInteractive.js');
    return runNonInteractive({ controller, prompt: args.prompt! });
  }

  const { runInteractive } = await import('./cli/interactive.js');
  return runInteractive({
    controller,
    settings: loaded.settings,
    flags: { altScreen: args.altScreen, color: args.color },
    env: process.env,
  });
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    process.stderr.write(formatError(toMaestroError(err), { debug: true }) + '\n');
    process.exitCode = EXIT.USAGE;
  });
