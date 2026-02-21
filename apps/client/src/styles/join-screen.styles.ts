import { StyleSheet } from 'react-native';
import type { SenseTheme } from '../lib/theme';

export const joinScreenStyles = StyleSheet.create({
  page: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    gap: 14,
  },
  heroBadge: {
    width: '100%',
    maxWidth: 760,
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#0A2238',
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
  },
  heroBadgeText: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  modeSwitcher: {
    borderWidth: 1,
    borderRadius: 999,
    padding: 3,
    flexDirection: 'row',
    gap: 4,
  },
  modeChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 56,
    alignItems: 'center',
  },
  modeChipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  card: {
    width: '100%',
    maxWidth: 760,
    borderRadius: 24,
    borderWidth: 1,
    padding: 28,
    gap: 12,
    shadowColor: '#0A2238',
    shadowOpacity: 0.18,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 12 },
  },
  brand: {
    fontSize: 54,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  tagline: {
    fontSize: 19,
    marginBottom: 14,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 14,
    fontSize: 16,
  },
  error: {
    fontSize: 14,
    marginTop: 4,
  },
  info: {
    fontSize: 13,
    marginTop: 2,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  primaryButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    fontWeight: '700',
    fontSize: 15,
  },
  secondaryButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  secondaryButtonText: {
    fontWeight: '700',
    fontSize: 15,
  },
  buttonPressed: {
    opacity: 0.84,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
});

export const createJoinScreenThemeStyles = (theme: SenseTheme) => ({
  page: {
    backgroundColor: theme.colors.appBg,
  },
  heroBadge: {
    borderColor: theme.colors.panelBorder,
    backgroundColor: theme.colors.panelMuted,
  },
  heroBadgeText: {
    color: theme.colors.textSecondary,
    fontFamily: theme.fonts.body,
  },
  modeSwitcher: {
    borderColor: theme.colors.buttonBorder,
    backgroundColor: theme.colors.buttonBg,
  },
  modeChip: (active: boolean) => ({
    borderColor: theme.colors.buttonBorder,
    backgroundColor: active ? theme.colors.accent : theme.colors.buttonBg,
  }),
  modeChipText: (active: boolean) => ({
    color: active ? theme.colors.accentText : theme.colors.textSecondary,
    fontFamily: theme.fonts.body,
  }),
  card: {
    backgroundColor: theme.colors.panel,
    borderColor: theme.colors.panelBorder,
  },
  brand: {
    color: theme.colors.textPrimary,
    fontFamily: theme.fonts.heading,
  },
  tagline: {
    color: theme.colors.textSecondary,
    fontFamily: theme.fonts.body,
  },
  label: {
    color: theme.colors.textSecondary,
    fontFamily: theme.fonts.body,
  },
  input: {
    borderColor: theme.colors.inputBorder,
    backgroundColor: theme.colors.inputBg,
    color: theme.colors.textPrimary,
    fontFamily: theme.fonts.body,
  },
  error: {
    color: theme.colors.danger,
    fontFamily: theme.fonts.body,
  },
  info: {
    color: theme.colors.textSecondary,
    fontFamily: theme.fonts.body,
  },
  primaryButton: {
    backgroundColor: theme.colors.accent,
  },
  primaryButtonText: {
    color: theme.colors.accentText,
    fontFamily: theme.fonts.heading,
  },
  secondaryButton: {
    borderColor: theme.colors.buttonBorder,
    backgroundColor: theme.colors.buttonBg,
  },
  secondaryButtonText: {
    color: theme.colors.buttonText,
    fontFamily: theme.fonts.heading,
  },
  placeholderColor: theme.colors.textMuted,
});
