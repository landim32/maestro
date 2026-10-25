import { describe, expect, it } from 'vitest';
import { cleanBranchName, fitBranchName, generateBranchName, MAX_BRANCH_LENGTH } from '../../../src/speckit/naming.js';

/** specs/006 data-model § 4 — after create-new-feature.sh */
describe('naming', () => {
  it('cleanBranchName lowercases, hyphenates and collapses', () => {
    expect(cleanBranchName('User Auth!!')).toBe('user-auth');
    expect(cleanBranchName('--Já--Pronto--')).toBe('já-pronto');
    expect(cleanBranchName('***')).toBe('');
  });

  it('generateBranchName drops stop words, keeps 3 words (or 4 when exactly 4) and acronyms', () => {
    expect(generateBranchName('I want to add user authentication')).toBe('user-authentication');
    expect(generateBranchName('Implement OAuth2 integration for the API')).toBe('implement-oauth2-integration-api');
    expect(generateBranchName('Fix payment processing timeout bug')).toBe('fix-payment-processing');
    expect(generateBranchName('Create a dashboard for analytics')).toBe('create-dashboard-analytics');
    expect(generateBranchName('Add CI to the pipeline')).toBe('ci-pipeline');
    expect(generateBranchName('Melhorias na busca')).toBe('melhorias-busca');
    expect(generateBranchName('a to the')).toBe('a-to-the'); // all stop words → raw fallback
  });

  it("fitBranchName keeps GitHub's 244-byte limit on a character boundary without a trailing dash", () => {
    const suffix = 'x'.repeat(300);
    const fitted = fitBranchName('007', suffix);
    expect(Buffer.byteLength(fitted)).toBe(MAX_BRANCH_LENGTH);
    expect(fitted.startsWith('007-')).toBe(true);
    const unicode = 'ç'.repeat(200) + '-' + 'ç'.repeat(100);
    const f2 = fitBranchName('007', unicode);
    expect(Buffer.byteLength(f2)).toBeLessThanOrEqual(MAX_BRANCH_LENGTH);
    expect(f2.endsWith('-')).toBe(false);
    expect(fitBranchName('007', 'short')).toBe('007-short');
  });
});
