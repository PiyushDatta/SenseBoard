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
});
