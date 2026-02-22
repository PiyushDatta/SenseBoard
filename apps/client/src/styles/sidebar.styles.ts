import { StyleSheet } from 'react-native';
import type { SenseTheme } from '../lib/theme';

export const sidebarStyles = StyleSheet.create({
  container: {
    width: 430,
    minWidth: 350,
    maxWidth: 460,
    height: '100%',
    borderWidth: 1,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#0A2238',
    shadowOpacity: 0.11,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 6 },
  },
  overlayContainer: {
    width: '100%',
    minWidth: 0,
    maxWidth: '100%',
    borderRadius: 14,
  },
  tabsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    paddingRight: 8,
  },
  tabs: {
    flexDirection: 'row',
    flex: 1,
  },
  tabButton: {
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  tabButtonActive: {
    borderRadius: 10,
    margin: 4,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
  },
  tabTextActive: {
    fontWeight: '700',
  },
  closeButton: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  closeButtonText: {
    fontSize: 12,
    fontWeight: '700',
  },
  questionsBanner: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  questionsTitle: {
    fontWeight: '700',
    marginBottom: 2,
    fontSize: 12,
  },
  questionsText: {
    fontSize: 12,
  },
  panel: {
    flex: 1,
  },
  list: {
    flex: 1,
    maxHeight: '60%',
  },
  listContent: {
    padding: 10,
    gap: 8,
  },
  itemCard: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  itemMeta: {
    fontSize: 10,
    fontWeight: '600',
    marginBottom: 4,
  },
  itemTitle: {
    fontWeight: '700',
    marginBottom: 4,
    fontSize: 14,
  },
  itemBody: {
    fontSize: 13,
  },
  interimText: {
    fontStyle: 'italic',
    fontSize: 13,
  },
  composeArea: {
    padding: 10,
    borderTopWidth: 1,
    gap: 8,
  },
  composeLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  multiInput: {
    minHeight: 70,
    textAlignVertical: 'top',
  },
  pillRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  kindPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  kindPillActive: {
    transform: [{ translateY: -1 }],
  },
  kindPillText: {
    fontSize: 12,
  },
  kindPillTextActive: {
    fontWeight: '700',
  },
  primaryButton: {
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
  },
  primaryButtonText: {
    fontWeight: '700',
    fontSize: 14,
  },
  actionButtonRow: {
    flexDirection: 'row',
    gap: 8,
  },
  flexButton: {
    flex: 1,
  },
  secondaryActionButton: {
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
    borderWidth: 1,
  },
  secondaryActionButtonText: {
    fontWeight: '700',
    fontSize: 12,
  },
  pressed: {
    opacity: 0.78,
  },
});

export const createSidebarThemeStyles = (theme: SenseTheme) => ({
  container: {
    borderColor: theme.colors.panelBorder,
    backgroundColor: theme.colors.panel,
  },
  tabsRow: {
    borderBottomColor: theme.colors.panelBorder,
    backgroundColor: theme.colors.panelMuted,
  },
  closeButton: {
    borderColor: theme.colors.inputBorder,
    backgroundColor: theme.colors.inputBg,
  },
  closeButtonText: {
    color: theme.colors.textSecondary,
    fontFamily: theme.fonts.body,
  },
  questionsBanner: {
    borderBottomColor: theme.colors.panelBorder,
    backgroundColor: theme.colors.accentSoft,
  },
  questionsTitle: {
    color: theme.colors.accentText,
    fontFamily: theme.fonts.heading,
  },
  questionsText: {
    color: theme.colors.accentText,
    fontFamily: theme.fonts.body,
  },
  itemCard: {
    borderColor: theme.colors.panelBorder,
    backgroundColor: theme.colors.panelMuted,
  },
  itemMeta: {
    color: theme.colors.textMuted,
    fontFamily: theme.fonts.mono,
  },
  itemTitle: {
    color: theme.colors.textPrimary,
    fontFamily: theme.fonts.heading,
  },
  itemBody: {
    color: theme.colors.textPrimary,
    fontFamily: theme.fonts.body,
  },
  secondaryItemBody: {
    color: theme.colors.textSecondary,
    fontFamily: theme.fonts.body,
  },
  interimCard: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.accentSoft,
  },
  interimMeta: {
    color: theme.colors.accentText,
    fontFamily: theme.fonts.mono,
  },
  interimText: {
    color: theme.colors.accentText,
    fontFamily: theme.fonts.body,
  },
  composeArea: {
    borderTopColor: theme.colors.panelBorder,
    backgroundColor: theme.colors.panel,
  },
  composeLabel: {
    color: theme.colors.textSecondary,
    fontFamily: theme.fonts.body,
  },
  input: {
    borderColor: theme.colors.inputBorder,
    backgroundColor: theme.colors.inputBg,
    color: theme.colors.textPrimary,
    fontFamily: theme.fonts.body,
  },
  kindPill: {
    borderColor: theme.colors.inputBorder,
    backgroundColor: theme.colors.inputBg,
  },
  kindPillActive: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.accentSoft,
  },
  kindPillText: {
    color: theme.colors.textSecondary,
    fontFamily: theme.fonts.body,
  },
  kindPillTextActive: {
    color: theme.colors.accentText,
  },
  primaryButton: {
    backgroundColor: theme.colors.accent,
  },
  primaryButtonText: {
    color: theme.colors.accentText,
    fontFamily: theme.fonts.heading,
  },
  secondaryActionButton: {
    backgroundColor: theme.colors.inputBg,
    borderColor: theme.colors.inputBorder,
  },
  secondaryActionButtonText: {
    color: theme.colors.textSecondary,
    fontFamily: theme.fonts.body,
  },
  tabText: {
    color: theme.colors.textSecondary,
    fontFamily: theme.fonts.body,
  },
  tabButtonActive: {
    backgroundColor: theme.colors.accentSoft,
  },
  tabTextActive: {
    color: theme.colors.accentText,
  },
  placeholderColor: theme.colors.textMuted,
});
