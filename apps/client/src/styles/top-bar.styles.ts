import { StyleSheet } from 'react-native';
import type { SenseTheme } from '../lib/theme';

export const topBarStyles = StyleSheet.create({
  wrap: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 6,
    gap: 8,
    shadowColor: '#0A2238',
    shadowOpacity: 0.14,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
  },
  mainRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    alignItems: 'flex-start',
  },
  leftInfo: {
    gap: 5,
  },
  roomCode: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
  },
  statusText: {
    fontSize: 13,
  },
  aiStatus: {
    fontSize: 13,
    fontWeight: '600',
  },
  resolvedThemePill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  resolvedThemeText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  quickActions: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    alignItems: 'center',
    maxWidth: 1100,
  },
  actionButton: {
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 11,
  },
  actionButtonActive: {
    transform: [{ translateY: -1 }],
  },
  actionButtonDisabled: {
    opacity: 0.45,
  },
  actionButtonPressed: {
    opacity: 0.74,
  },
  actionText: {
    fontSize: 12,
    fontWeight: '600',
  },
  actionTextActive: {
    fontWeight: '700',
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
    paddingHorizontal: 8,
    paddingVertical: 5,
    minWidth: 50,
    alignItems: 'center',
  },
  modeChipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  hintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  controlsDivider: {
    borderTopWidth: 1,
    marginTop: 2,
    paddingTop: 8,
  },
  controlsRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
    marginBottom: 8,
  },
  hintLabel: {
    width: 130,
    fontSize: 13,
    fontWeight: '600',
  },
  hintInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
});

export const getTopBarStatusColor = (status: string, theme: SenseTheme) => {
  if (status === 'frozen') {
    return theme.colors.danger;
  }
  if (status === 'updating') {
    return theme.colors.warning;
  }
  if (status === 'listening') {
    return theme.colors.success;
  }
  return theme.colors.textSecondary;
};

export const createTopBarThemeStyles = (theme: SenseTheme) => ({
  wrap: {
    borderColor: theme.colors.panelBorder,
    backgroundColor: theme.colors.panel,
  },
  tabsRow: {
    borderBottomColor: theme.colors.panelBorder,
    backgroundColor: theme.colors.panelMuted,
  },
  roomCode: {
    color: theme.colors.textPrimary,
    fontFamily: theme.fonts.heading,
  },
  statusText: {
    color: theme.colors.textSecondary,
    fontFamily: theme.fonts.body,
  },
  statusDot: (connected: boolean) => ({
    backgroundColor: connected ? theme.colors.success : theme.colors.danger,
  }),
  aiStatus: (status: string) => ({
    color: getTopBarStatusColor(status, theme),
    fontFamily: theme.fonts.body,
  }),
  resolvedThemePill: {
    backgroundColor: theme.colors.accentSoft,
    borderColor: theme.colors.panelBorder,
  },
  resolvedThemeText: {
    color: theme.colors.accentText,
    fontFamily: theme.fonts.body,
  },
  actionButton: {
    borderColor: theme.colors.buttonBorder,
    backgroundColor: theme.colors.buttonBg,
  },
  actionText: {
    color: theme.colors.buttonText,
    fontFamily: theme.fonts.body,
  },
  actionButtonActive: {
    backgroundColor: theme.colors.accentSoft,
    borderColor: theme.colors.accent,
  },
  actionTextActive: {
    color: theme.colors.accentText,
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
  controlsDivider: {
    borderTopColor: theme.colors.panelBorder,
  },
  hintLabel: {
    color: theme.colors.textSecondary,
    fontFamily: theme.fonts.body,
  },
  hintInput: {
    borderColor: theme.colors.inputBorder,
    backgroundColor: theme.colors.inputBg,
    color: theme.colors.textPrimary,
    fontFamily: theme.fonts.body,
  },
  placeholderColor: theme.colors.textMuted,
});
