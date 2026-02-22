import { StyleSheet } from 'react-native';
import type { SenseTheme } from '../lib/theme';

export const roomStatusPillStyles = StyleSheet.create({
  statusPill: {
    position: 'absolute',
    top: 12,
    left: 12,
    maxWidth: 620,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 2,
  },
  statusText: {
    fontSize: 16,
    fontWeight: '700',
  },
  statusSubText: {
    fontSize: 12,
  },
  boardToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    flexWrap: 'wrap',
  },
  boardToggleLabel: {
    fontSize: 11,
  },
  boardToggleChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  boardToggleText: {
    fontSize: 11,
    fontWeight: '700',
  },
  boardTogglePressed: {
    opacity: 0.82,
  },
});

export const createRoomStatusPillThemeStyles = (theme: SenseTheme) => ({
  statusPill: {
    borderColor: theme.colors.panelBorder,
    backgroundColor: theme.colors.panel,
  },
  statusText: {
    color: theme.colors.textPrimary,
    fontFamily: theme.fonts.heading,
  },
  statusSubText: {
    color: theme.colors.textSecondary,
    fontFamily: theme.fonts.body,
  },
  statusSubtleText: {
    color: theme.colors.textMuted,
    fontFamily: theme.fonts.body,
  },
  boardToggleChip: (active: boolean) => ({
    borderColor: active ? theme.colors.accent : theme.colors.inputBorder,
    backgroundColor: active ? theme.colors.accentSoft : theme.colors.inputBg,
  }),
  boardToggleText: (active: boolean) => ({
    color: active ? theme.colors.accentText : theme.colors.textSecondary,
    fontFamily: theme.fonts.body,
  }),
});
