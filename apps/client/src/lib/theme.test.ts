/// <reference types="bun-types" />

import { describe, expect, it } from 'bun:test';

import { THEMES, clampThemeMode, resolveThemeMode } from './theme';

describe('theme helpers', () => {
  it('resolves auto mode based on OS preference', () => {
    expect(resolveThemeMode('auto', false)).toBe('light');
    expect(resolveThemeMode('auto', true)).toBe('dark');
  });

  it('keeps explicit light/dark mode unchanged', () => {
    expect(resolveThemeMode('light', true)).toBe('light');
    expect(resolveThemeMode('dark', false)).toBe('dark');
  });

  it('clamps invalid stored values to auto', () => {
    expect(clampThemeMode('light')).toBe('light');
    expect(clampThemeMode('dark')).toBe('dark');
    expect(clampThemeMode('auto')).toBe('auto');
    expect(clampThemeMode('')).toBe('auto');
    expect(clampThemeMode(null)).toBe('auto');
    expect(clampThemeMode(undefined)).toBe('auto');
    expect(clampThemeMode('sepia')).toBe('auto');
  });

  it('exposes complete color/font tokens for both themes', () => {
    expect(THEMES.light.id).toBe('light');
    expect(THEMES.dark.id).toBe('dark');
    expect(THEMES.light.colors.accent.length).toBeGreaterThan(0);
    expect(THEMES.dark.colors.canvasBg.length).toBeGreaterThan(0);
    expect(THEMES.light.fonts.heading.length).toBeGreaterThan(0);
    expect(THEMES.dark.fonts.body.length).toBeGreaterThan(0);
  });
});
