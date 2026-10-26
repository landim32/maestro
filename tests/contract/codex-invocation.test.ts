/**
 * contracts/codex-invocation.md: the isolation flags that keep Codex's own tools off and the
 * bridge token off the command line. A change here is a security change.
 */
import { describe, expect, it } from 'vitest';
import {
  buildCodexArgs,
  childEnvCodex,
  CODEX_DISABLED_FEATURES,
  MCP_TOKEN_ENV,
} from '../../src/providers/codexStream.js';

const base = { cwd: '/repo', instructionsFile: '/tmp/x/instructions.md' };
const TOKEN = 'b'.repeat(48);

describe('contract: codex exec invocation', () => {
  it('fixed prefix, sandbox, approval policy and every disabled feature', () => {
    const args = buildCodexArgs(base);
    expect(args.slice(0, 22)).toEqual([
      'exec',
      '--json',
      '--ephemeral',
      '--skip-git-repo-check',
      '--ignore-user-config',
      '--ignore-rules',
      '-C',
      '/repo',
      '-s',
      'read-only',
      '-c',
      'approval_policy=never',
      '-c',
      'web_search=disabled',
      '-c',
      'project_doc_max_bytes=0',
      '-c',
      'include_permissions_instructions=false',
      '-c',
      'include_environment_context=false',
      '-c',
      'model_instructions_file=/tmp/x/instructions.md',
    ]);
    expect([...CODEX_DISABLED_FEATURES]).toEqual([
      'shell_tool',
      'unified_exec',
      'view_image',
      'image_generation',
      'multi_agent',
      'multi_agent_v2',
      'browser_use',
      'computer_use',
      'apps',
      'plugins',
      'skill_search',
      'tool_suggest',
      'sleep_tool',
      'goals',
      'hooks',
      'memories',
    ]);
    for (const f of CODEX_DISABLED_FEATURES) {
      expect(args[args.indexOf(f) - 1]).toBe('--disable');
    }
    expect(args.at(-1)).toBe('-');
  });

  it('never weakens the sandbox or approvals', () => {
    const args = buildCodexArgs({ ...base, mcpUrl: 'http://127.0.0.1:1/mcp', model: 'm' });
    const joined = args.join(' ');
    expect(joined).not.toMatch(/dangerously|full-auto|danger-full-access|workspace-write/);
    expect(args.filter((a) => a === 'read-only')).toHaveLength(1);
  });

  it('model, effort, images and the MCP bridge', () => {
    const args = buildCodexArgs({
      ...base,
      model: 'gpt-6-luna',
      effort: 'high',
      images: ['/tmp/x/image-1.png'],
      mcpUrl: 'http://127.0.0.1:5555/mcp',
    });
    expect(args[args.indexOf('-m') + 1]).toBe('gpt-6-luna');
    expect(args).toContain('model_reasoning_effort=high');
    expect(args[args.indexOf('-i') + 1]).toBe('/tmp/x/image-1.png');
    expect(args).toEqual(
      expect.arrayContaining([
        'mcp_servers.maestro.url=http://127.0.0.1:5555/mcp',
        `mcp_servers.maestro.bearer_token_env_var=${MCP_TOKEN_ENV}`,
        'mcp_servers.maestro.default_tools_approval_mode=approve',
        'mcp_servers.maestro.tool_timeout_sec=86400',
        'mcp_servers.maestro.required=true',
      ]),
    );
    expect(args.at(-1)).toBe('-');
  });

  it('without tools no MCP server is configured', () => {
    expect(buildCodexArgs(base).some((a) => a.startsWith('mcp_servers.'))).toBe(false);
  });

  it('no -c value carries quotes (they would not survive cmd /c)', () => {
    const args = buildCodexArgs({ ...base, model: 'm', effort: 'max', mcpUrl: 'http://h/mcp' });
    args.forEach((a, i) => {
      if (args[i - 1] === '-c') expect(a).not.toMatch(/["']/);
    });
  });

  it('child env: API keys removed; the bridge token only in MAESTRO_MCP_TOKEN', () => {
    const env = {
      PATH: '/bin',
      OPENAI_API_KEY: 'sk-openai',
      CODEX_API_KEY: 'sk-codex',
      OPENAI_BASE_URL: 'http://evil',
      [MCP_TOKEN_ENV]: 'stale',
    };
    expect(childEnvCodex(env)).toEqual({ PATH: '/bin' });
    expect(childEnvCodex(env, TOKEN)).toEqual({ PATH: '/bin', [MCP_TOKEN_ENV]: TOKEN });
    const args = buildCodexArgs({ ...base, mcpUrl: 'http://127.0.0.1:5555/mcp' });
    expect(args.join(' ')).not.toContain(TOKEN);
  });
});
