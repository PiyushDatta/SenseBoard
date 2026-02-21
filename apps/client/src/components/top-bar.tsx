import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { SenseTheme, ThemeMode } from '../lib/theme';

interface TopBarProps {
  roomId: string;
  connected: boolean;
  aiStatus: string;
  archivedCount: number;
  visualHint: string;
  micListening: boolean;
  micSupported: boolean;
  freezeAi: boolean;
  focusMode: boolean;
  panelsOpen: boolean;
  controlsOpen: boolean;
  theme: SenseTheme;
  themeMode: ThemeMode;
  resolvedTheme: 'light' | 'dark';
  onThemeModeChange: (mode: ThemeMode) => void;
  onTogglePanels: () => void;
  onToggleControls: () => void;
  onVisualHintChange: (value: string) => void;
  onToggleMic: () => void;
  onToggleFreeze: () => void;
  onPinDiagram: () => void;
  onToggleFocusMode: () => void;
  onRegenerate: () => void;
  onUndoAi: () => void;
  onRestoreArchived: () => void;
}

const statusColor = (status: string, theme: SenseTheme) => {
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

export const TopBar = ({
  roomId,
  connected,
  aiStatus,
  archivedCount,
  visualHint,
  micListening,
  micSupported,
  freezeAi,
  focusMode,
  panelsOpen,
  controlsOpen,
  theme,
  themeMode,
  resolvedTheme,
  onThemeModeChange,
  onTogglePanels,
  onToggleControls,
  onVisualHintChange,
  onToggleMic,
  onToggleFreeze,
  onPinDiagram,
  onToggleFocusMode,
  onRegenerate,
  onUndoAi,
  onRestoreArchived,
}: TopBarProps) => {
  return (
    <View
      style={[
        styles.wrap,
        {
          borderColor: theme.colors.panelBorder,
          backgroundColor: theme.colors.panel,
        },
      ]}>
      <View style={styles.mainRow}>
        <View style={styles.leftInfo}>
          <Text style={[styles.roomCode, { color: theme.colors.textPrimary, fontFamily: theme.fonts.heading }]}>Room {roomId}</Text>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: connected ? theme.colors.success : theme.colors.danger }]} />
            <Text style={[styles.statusText, { color: theme.colors.textSecondary, fontFamily: theme.fonts.body }]}>
              {connected ? 'Connected' : 'Reconnecting...'}
            </Text>
            <Text style={[styles.aiStatus, { color: statusColor(aiStatus, theme), fontFamily: theme.fonts.body }]}>AI: {aiStatus}</Text>
            <View
              style={[
                styles.resolvedThemePill,
                {
                  backgroundColor: theme.colors.accentSoft,
                  borderColor: theme.colors.panelBorder,
                },
              ]}>
              <Text style={[styles.resolvedThemeText, { color: theme.colors.accentText, fontFamily: theme.fonts.body }]}>
                {resolvedTheme.toUpperCase()}
              </Text>
            </View>
          </View>
        </View>
        <View style={styles.quickActions}>
          <ActionButton
            text={panelsOpen ? 'Hide Panels' : 'Open Panels'}
            active={panelsOpen}
            theme={theme}
            onPress={onTogglePanels}
          />
          <ActionButton
            text={controlsOpen ? 'Hide Controls' : 'Show Controls'}
            active={controlsOpen}
            theme={theme}
            onPress={onToggleControls}
          />
          <ActionButton
            text={micListening ? 'Stop Mic' : 'Start Mic'}
            disabled={!micSupported}
            active={micListening}
            theme={theme}
            onPress={onToggleMic}
          />
          <View
            style={[
              styles.modeSwitcher,
              {
                borderColor: theme.colors.buttonBorder,
                backgroundColor: theme.colors.buttonBg,
              },
            ]}>
            <ModeChip label="Auto" value="auto" active={themeMode === 'auto'} theme={theme} onPress={onThemeModeChange} />
            <ModeChip label="Light" value="light" active={themeMode === 'light'} theme={theme} onPress={onThemeModeChange} />
            <ModeChip label="Dark" value="dark" active={themeMode === 'dark'} theme={theme} onPress={onThemeModeChange} />
          </View>
        </View>
      </View>
      {controlsOpen ? (
        <>
          <View style={[styles.controlsDivider, { borderTopColor: theme.colors.panelBorder }]} />
          <View style={styles.controlsRow}>
            <ActionButton text={freezeAi ? 'Unfreeze AI' : 'Freeze AI'} active={freezeAi} theme={theme} onPress={onToggleFreeze} />
            <ActionButton text="Pin Diagram" theme={theme} onPress={onPinDiagram} />
            <ActionButton text={focusMode ? 'Cancel Focus' : 'Focus Mode'} active={focusMode} theme={theme} onPress={onToggleFocusMode} />
            <ActionButton text="Regenerate" theme={theme} onPress={onRegenerate} />
            <ActionButton text="Undo AI" theme={theme} onPress={onUndoAi} />
            <ActionButton
              text={`Restore Last (${archivedCount})`}
              disabled={archivedCount === 0}
              theme={theme}
              onPress={onRestoreArchived}
            />
          </View>
          <View style={styles.hintRow}>
            <Text style={[styles.hintLabel, { color: theme.colors.textSecondary, fontFamily: theme.fonts.body }]}>Currently sharing:</Text>
            <TextInput
              value={visualHint}
              onChangeText={onVisualHintChange}
              placeholder="Design doc section / URL / snippet"
              placeholderTextColor={theme.colors.textMuted}
              style={[
                styles.hintInput,
                {
                  borderColor: theme.colors.inputBorder,
                  backgroundColor: theme.colors.inputBg,
                  color: theme.colors.textPrimary,
                  fontFamily: theme.fonts.body,
                },
              ]}
            />
          </View>
        </>
      ) : null}
    </View>
  );
};

const ActionButton = ({
  text,
  onPress,
  active,
  disabled,
  theme,
}: {
  text: string;
  onPress: () => void;
  active?: boolean;
  disabled?: boolean;
  theme: SenseTheme;
}) => (
  <Pressable
    disabled={disabled}
    onPress={onPress}
    style={({ pressed }) => [
      styles.actionButton,
      {
        borderColor: theme.colors.buttonBorder,
        backgroundColor: theme.colors.buttonBg,
      },
      active && styles.actionButtonActive,
      active && { backgroundColor: theme.colors.accentSoft, borderColor: theme.colors.accent },
      disabled && styles.actionButtonDisabled,
      pressed && styles.actionButtonPressed,
    ]}>
    <Text
      style={[
        styles.actionText,
        { color: theme.colors.buttonText, fontFamily: theme.fonts.body },
        active && styles.actionTextActive,
        active && { color: theme.colors.accentText },
      ]}>
      {text}
    </Text>
  </Pressable>
);

const ModeChip = ({
  label,
  value,
  active,
  theme,
  onPress,
}: {
  label: string;
  value: ThemeMode;
  active: boolean;
  theme: SenseTheme;
  onPress: (mode: ThemeMode) => void;
}) => (
  <Pressable
    onPress={() => onPress(value)}
    style={({ pressed }) => [
      styles.modeChip,
      {
        borderColor: theme.colors.buttonBorder,
        backgroundColor: active ? theme.colors.accent : theme.colors.buttonBg,
      },
      pressed && styles.actionButtonPressed,
    ]}>
    <Text
      style={[
        styles.modeChipText,
        {
          color: active ? theme.colors.accentText : theme.colors.textSecondary,
          fontFamily: theme.fonts.body,
        },
      ]}>
      {label}
    </Text>
  </Pressable>
);

const styles = StyleSheet.create({
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
