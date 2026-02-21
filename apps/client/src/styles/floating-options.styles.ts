import { StyleSheet } from 'react-native';
import type { SenseTheme, ThemeMode } from '../lib/theme';

export const floatingOptionsStyles = StyleSheet.create({
  container: {
    position: 'absolute',
    right: 16,
    bottom: 18,
    alignItems: 'flex-end',
    gap: 8,
    zIndex: 50,
  },
  panel: {
    width: 320,
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    gap: 8,
    shadowColor: '#0A2238',
    shadowOpacity: 0.24,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 5 },
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  optionButton: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  optionText: {
    fontSize: 12,
    fontWeight: '600',
  },
  optionDisabled: {
    opacity: 0.45,
  },
  optionPressed: {
    opacity: 0.78,
  },
  modeChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 56,
    alignItems: 'center',
  },
  modeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  chatPanel: {
    width: 320,
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    gap: 8,
    shadowColor: '#0A2238',
    shadowOpacity: 0.22,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
  },
  chatInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 12,
    minHeight: 70,
    textAlignVertical: 'top',
  },
  historyWrap: {
    borderWidth: 1,
    borderRadius: 10,
    overflow: 'hidden',
    maxHeight: 150,
  },
  historyScroll: {
    maxHeight: 150,
  },
  historyContent: {
    padding: 8,
    gap: 8,
  },
  historyItem: {
    borderBottomWidth: 1,
    paddingBottom: 6,
  },
  historyMeta: {
    fontSize: 10,
    marginBottom: 2,
  },
  historyText: {
    fontSize: 12,
  },
  historyEmpty: {
    fontSize: 12,
    fontStyle: 'italic',
  },
  fabButton: {
    width: 44,
    height: 44,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handle: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  handlePressed: {
    opacity: 0.8,
  },
  handleText: {
    fontSize: 13,
    fontWeight: '700',
  },
});

export const createFloatingOptionsThemeStyles = (theme: SenseTheme) => ({
  panel: {
    borderColor: theme.colors.panelBorder,
    backgroundColor: theme.colors.panel,
  },
  sectionTitle: {
    color: theme.colors.textPrimary,
    fontFamily: theme.fonts.heading,
  },
  sectionSubTitle: {
    color: theme.colors.textSecondary,
    fontFamily: theme.fonts.body,
  },
  optionButton: {
    borderColor: theme.colors.buttonBorder,
    backgroundColor: theme.colors.buttonBg,
  },
  optionText: {
    color: theme.colors.buttonText,
    fontFamily: theme.fonts.body,
  },
  modeChip: (active: boolean) => ({
    borderColor: theme.colors.buttonBorder,
    backgroundColor: active ? theme.colors.accent : theme.colors.buttonBg,
  }),
  modeText: (active: boolean) => ({
    color: active ? theme.colors.accentText : theme.colors.textSecondary,
    fontFamily: theme.fonts.body,
  }),
  chatPanel: {
    borderColor: theme.colors.panelBorder,
    backgroundColor: theme.colors.panel,
  },
  historyWrap: {
    borderColor: theme.colors.inputBorder,
    backgroundColor: theme.colors.inputBg,
  },
  historyItem: {
    borderColor: theme.colors.panelBorder,
  },
  historyMeta: {
    color: theme.colors.textMuted,
    fontFamily: theme.fonts.mono,
  },
  historyText: {
    color: theme.colors.textPrimary,
    fontFamily: theme.fonts.body,
  },
  historyEmpty: {
    color: theme.colors.textMuted,
    fontFamily: theme.fonts.body,
  },
  chatInput: {
    borderColor: theme.colors.inputBorder,
    backgroundColor: theme.colors.inputBg,
    color: theme.colors.textPrimary,
    fontFamily: theme.fonts.body,
  },
  handle: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.accentSoft,
  },
  handleText: {
    color: theme.colors.accentText,
    fontFamily: theme.fonts.heading,
  },
  micFab: (micListening: boolean) => ({
    borderColor: micListening ? theme.colors.accent : theme.colors.buttonBorder,
    backgroundColor: micListening ? theme.colors.accentSoft : theme.colors.buttonBg,
  }),
  micFabIcon: (micListening: boolean) => (micListening ? theme.colors.accentText : theme.colors.buttonText),
  chatFab: {
    borderColor: theme.colors.buttonBorder,
    backgroundColor: theme.colors.buttonBg,
  },
  chatFabIcon: theme.colors.buttonText,
  placeholderColor: theme.colors.textMuted,
});

export const isThemeModeActive = (currentMode: ThemeMode, mode: ThemeMode): boolean => currentMode === mode;
