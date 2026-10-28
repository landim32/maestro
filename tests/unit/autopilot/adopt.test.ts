import { describe, expect, it } from 'vitest';
import {
  adoptedStoryText,
  detectProgress,
  newestFeature,
  pickFeature,
  specTitle,
} from '../../../src/autopilot/adopt.js';

const SPEC = `# Feature Specification: Clientes

**Input**: User description: "CRUD de clientes"
`;
const CLARIFIED = `${SPEC}
## Clarifications

### Session 2026-10-27
`;

describe('detectProgress (/autopilot --continue)', () => {
  it.each([
    ['spec only', { spec: SPEC }, 'clarify', ['specify']],
    ['clarified spec', { spec: CLARIFIED }, 'plan', ['specify', 'clarify']],
    [
      'plan without clarify',
      { spec: SPEC, plan: '# Implementation Plan: Clientes' },
      'tasks',
      ['specify', 'clarify', 'plan'],
    ],
    [
      'tasks not started',
      { spec: CLARIFIED, plan: '# Implementation Plan: X', tasks: '- [ ] T001 a' },
      'analyze',
      ['specify', 'clarify', 'plan', 'tasks'],
    ],
    [
      'tasks half done',
      { spec: CLARIFIED, plan: '# Implementation Plan: X', tasks: '- [X] T001 a\n- [ ] T002 b' },
      'implement',
      ['specify', 'clarify', 'plan', 'tasks', 'analyze'],
    ],
    [
      'tasks all done',
      { spec: CLARIFIED, plan: '# Implementation Plan: X', tasks: '- [x] T001 a' },
      'verify',
      ['specify', 'clarify', 'plan', 'tasks', 'analyze', 'implement'],
    ],
    [
      'template plan and empty tasks',
      { spec: CLARIFIED, plan: '# Implementation Plan: [FEATURE]', tasks: '# Tasks' },
      'plan',
      ['specify', 'clarify'],
    ],
  ])('%s → next %s', (_name, files, next, done) => {
    const p = detectProgress(files);
    expect(p).toMatchObject({ next, done });
  });

  it('needs a filled spec.md', () => {
    expect(detectProgress({})).toHaveProperty('error');
    expect(detectProgress({ spec: '# Feature Specification: [FEATURE NAME]' })).toHaveProperty(
      'error',
    );
  });
});

describe('feature choice and story', () => {
  it('picks by name, by number, then the active one, then the newest', () => {
    const dirs = ['001-a', '002-b', '010-c'];
    expect(pickFeature(dirs, '002-b', undefined, '010-c')).toBe('002-b');
    expect(pickFeature(dirs, 'specs/002-b/', undefined, '010-c')).toBe('002-b');
    expect(pickFeature(dirs, '10', undefined, '010-c')).toBe('010-c');
    expect(pickFeature(dirs, '7', undefined, '010-c')).toEqual({
      error: 'feature não encontrada em specs/: 7',
    });
    expect(pickFeature(dirs, undefined, '001-a', '010-c')).toBe('001-a');
    expect(pickFeature(dirs, undefined, 'main', '010-c')).toBe('010-c');
    expect(pickFeature([], undefined, 'main', undefined)).toHaveProperty('error');
    expect(newestFeature(['main', '002-b', '010-c', '003-x'])).toBe('010-c');
    expect(newestFeature(['010-c', '20261027-101010-z'])).toBe('20261027-101010-z');
  });

  it('builds the story from the spec title and the original request', () => {
    expect(specTitle(SPEC, '003-x')).toBe('Clientes');
    expect(specTitle('sem título', '003-x')).toBe('003-x');
    const text = adoptedStoryText(SPEC, '003-x');
    expect(text.split('\n')[0]).toBe('Clientes');
    expect(text).toContain('specs/003-x/spec.md');
    expect(text).toContain('Pedido original: CRUD de clientes');
  });
});
