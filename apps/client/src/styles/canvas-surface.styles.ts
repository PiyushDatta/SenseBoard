import { StyleSheet } from 'react-native';
import type { SenseTheme } from '../lib/theme';

export const canvasSurfaceStyles = StyleSheet.create({
  container: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
  },
  body: {
    marginTop: 8,
    textAlign: 'center',
  },
});

export const createCanvasSurfaceThemeStyles = (theme?: SenseTheme) => ({
  container: {
    borderColor: theme?.colors.panelBorder ?? '#D7E1EB',
    backgroundColor: theme?.colors.panelMuted ?? '#F7FAFF',
  },
  title: {
    color: theme?.colors.textPrimary ?? '#1B2D3D',
    fontFamily: theme?.fonts.heading,
  },
  body: {
    color: theme?.colors.textSecondary ?? '#3B4A56',
    fontFamily: theme?.fonts.body,
  },
});
