import { describe, expect, it } from 'vitest';
import { learnModelPatch, modelCatalog } from '../../../src/config/models.js';
import { makeSettings } from '../../helpers/context.js';

const CLAUDE_DEFAULTS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];
const QWEN_DEFAULTS = ['qwen3-coder-plus', 'qwen3-coder-flash', 'qwen3-max'];

describe('modelCatalog', () => {
  it('returns the provider defaults when nothing is configured', () => {
    const s = makeSettings();
    expect(modelCatalog(s, 'claude')).toEqual(CLAUDE_DEFAULTS);
    expect(modelCatalog(s, 'qwen')).toEqual(QWEN_DEFAULTS);
  });
  it('appends the configured model when it is not in the list, preserving order', () => {
    const s = makeSettings({ providers: { qwen: { model: 'qwen-max-preview' } } });
    expect(modelCatalog(s, 'qwen')).toEqual([...QWEN_DEFAULTS, 'qwen-max-preview']);
  });
  it('never repeats and keeps the file order', () => {
    const s = makeSettings({
      providers: { claude: { model: 'b', models: ['a', 'b', 'c'] } },
    });
    expect(modelCatalog(s, 'claude')).toEqual(['a', 'b', 'c']);
  });
  it('an empty list falls back to the defaults', () => {
    const s = makeSettings({ providers: { claude: { models: [] } } });
    expect(modelCatalog(s, 'claude')).toEqual(CLAUDE_DEFAULTS);
  });
});

describe('learnModelPatch', () => {
  it('returns [] when the model is already in the raw global list', () => {
    const raw = { providers: { qwen: { models: ['qwen3-max', 'x'] } } };
    expect(learnModelPatch(raw, 'qwen', 'x')).toEqual([]);
  });
  it('appends to the stored list', () => {
    const raw = { providers: { qwen: { models: ['qwen3-max'] } } };
    expect(learnModelPatch(raw, 'qwen', 'qwen3-new')).toEqual([
      { path: 'providers.qwen.models', value: ['qwen3-max', 'qwen3-new'] },
    ]);
  });
  it('starts from the provider defaults when the key is absent or empty', () => {
    expect(learnModelPatch({}, 'claude', 'claude-x')).toEqual([
      { path: 'providers.claude.models', value: [...CLAUDE_DEFAULTS, 'claude-x'] },
    ]);
    expect(
      learnModelPatch({ providers: { claude: { models: [] } } }, 'claude', 'claude-x'),
    ).toEqual([{ path: 'providers.claude.models', value: [...CLAUDE_DEFAULTS, 'claude-x'] }]);
    expect(learnModelPatch({}, 'claude', 'claude-opus-5-5')).toEqual([]); // already a default
  });
  it('trims the name and ignores blanks; never reads merged project lists', () => {
    expect(learnModelPatch({}, 'qwen', '   ')).toEqual([]);
    const raw = { providers: { qwen: { models: ['only-global'] } } };
    expect(learnModelPatch(raw, 'qwen', ' new ')).toEqual([
      { path: 'providers.qwen.models', value: ['only-global', 'new'] },
    ]);
  });
});
