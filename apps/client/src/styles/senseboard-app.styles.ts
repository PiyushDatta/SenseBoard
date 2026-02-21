import { StyleSheet } from 'react-native';
import type { SenseTheme } from '../lib/theme';

export const senseboardAppStyles = StyleSheet.create({
  page: {
    flex: 1,
  },
  main: {
    flex: 1,
  },
  sidebarBackdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    pointerEvents: 'box-none',
  },
  sidebarScrim: {
    flex: 1,
  },
  sidebarOverlayWrap: {
    width: 420,
    maxWidth: '95%',
    height: '100%',
    paddingLeft: 10,
    paddingTop: 10,
    paddingBottom: 10,
  },
  loadingPage: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 16,
    fontWeight: '600',
  },
});

export const createSenseBoardAppThemeStyles = (theme: SenseTheme) => ({
  page: {
    backgroundColor: theme.colors.appBg,
  },
  loadingPage: {
    backgroundColor: theme.colors.appBg,
  },
  loadingText: {
    color: theme.colors.textPrimary,
    fontFamily: theme.fonts.heading,
  },
  sidebarScrim: {
    backgroundColor: theme.id === 'dark' ? '#00000066' : '#0B1A2A33',
  },
});
