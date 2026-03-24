import { describe, expect, it } from 'bun:test';

import { sanitizeBoardText } from './text-sanitizer';

describe('sanitizeBoardText', () => {
  it('removes control characters and normalizes line endings', () => {
    const result = sanitizeBoardText('first\r\nsecond\rthird\u0000line');
    expect(result).not.toBeNull();
    expect(result?.text).toBe('first\nsecond\nthirdline');
    expect(result?.changed).toBe(true);
    expect(result?.empty).toBe(false);
    expect(result?.rejected).toBe(false);
  });

  it('rejects empty sanitized text unless empty values are allowed', () => {
    const rejected = sanitizeBoardText('   ');
    expect(rejected).not.toBeNull();
    expect(rejected?.empty).toBe(true);
    expect(rejected?.rejected).toBe(true);

    const allowed = sanitizeBoardText('   ', { allowEmpty: true });
    expect(allowed).not.toBeNull();
    expect(allowed?.text).toBe('');
    expect(allowed?.empty).toBe(true);
    expect(allowed?.rejected).toBe(false);
  });

  it('returns null for non-string values', () => {
    expect(sanitizeBoardText(undefined)).toBeNull();
    expect(sanitizeBoardText(42)).toBeNull();
  });
});
