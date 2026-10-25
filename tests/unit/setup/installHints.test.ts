import { describe, expect, it } from 'vitest';
import { ANT_RELEASES_URL, installHints } from '../../../src/setup/installHints.js';

describe('installHints', () => {
  it('windows: releases zip + PATH folder', () => {
    const h = installHints('win32');
    expect(h[0]).toContain('windows_amd64.zip');
    expect(h[0]).toContain(ANT_RELEASES_URL);
    expect(h[1]).toContain('%LOCALAPPDATA%\\Programs\\ant');
  });
  it('macos: homebrew', () => {
    expect(installHints('darwin')[0]).toContain('brew install anthropics/tap/ant');
  });
  it('linux: tarball', () => {
    expect(installHints('linux')[0]).toContain('tar.gz');
    expect(installHints('linux')[1]).toContain('/usr/local/bin');
  });
});
