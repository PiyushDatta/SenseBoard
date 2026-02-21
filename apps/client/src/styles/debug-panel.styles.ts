import { StyleSheet } from 'react-native';
import type { SenseTheme } from '../lib/theme';

export const debugPanelStyles = StyleSheet.create({
  panel: {
    position: 'absolute',
    left: 12,
    bottom: 52,
    width: 320,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    gap: 4,
  },
  title: {
    fontWeight: '700',
    fontSize: 14,
    marginBottom: 2,
  },
  body: {
    fontSize: 12,
  },
  error: {
    marginTop: 4,
    fontSize: 12,
  },
});

export const createDebugPanelThemeStyles = (theme: SenseTheme) => ({
  panel: {
    borderColor: theme.colors.panelBorder,
    backgroundColor: theme.colors.panel,
  },
  title: {
    color: theme.colors.textPrimary,
    fontFamily: theme.fonts.heading,
  },
  body: {
    color: theme.colors.textSecondary,
    fontFamily: theme.fonts.mono,
  },
  error: {
    color: theme.colors.danger,
    fontFamily: theme.fonts.body,
  },
});
