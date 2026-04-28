import { describe, expect, it } from 'vitest';
import { shouldUseLegacyPlayback } from './player-session.service';

describe('shouldUseLegacyPlayback', () => {
  it('returns true for very weak connections', () => {
    expect(shouldUseLegacyPlayback({ effectiveType: '2g', saveData: false })).toBe(true);
  });

  it('returns true for slow-2g connections', () => {
    expect(shouldUseLegacyPlayback({ effectiveType: 'slow-2g', saveData: false })).toBe(true);
  });

  it('returns false for normal connections', () => {
    expect(shouldUseLegacyPlayback({ effectiveType: '4g', saveData: false })).toBe(false);
  });

  it('returns true when saveData is enabled', () => {
    expect(shouldUseLegacyPlayback({ effectiveType: '4g', saveData: true })).toBe(true);
  });

  it('returns false when network information is unavailable', () => {
    expect(shouldUseLegacyPlayback(undefined)).toBe(false);
  });
});
