import { useMemo } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import type { SenseTheme, ThemeMode } from '../lib/theme';
import { createTopBarThemeStyles, topBarStyles } from '../styles/top-bar.styles';

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

type TopBarThemeStyles = ReturnType<typeof createTopBarThemeStyles>;

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
  const themeStyles = useMemo(() => createTopBarThemeStyles(theme), [theme]);

  return (
    <View style={[topBarStyles.wrap, themeStyles.wrap]}>
      <View style={topBarStyles.mainRow}>
        <View style={topBarStyles.leftInfo}>
          <Text style={[topBarStyles.roomCode, themeStyles.roomCode]}>Room {roomId}</Text>
          <View style={topBarStyles.statusRow}>
            <View style={[topBarStyles.statusDot, themeStyles.statusDot(connected)]} />
            <Text style={[topBarStyles.statusText, themeStyles.statusText]}>
              {connected ? 'Connected' : 'Reconnecting...'}
            </Text>
            <Text style={[topBarStyles.aiStatus, themeStyles.aiStatus(aiStatus)]}>AI: {aiStatus}</Text>
            <View style={[topBarStyles.resolvedThemePill, themeStyles.resolvedThemePill]}>
              <Text style={[topBarStyles.resolvedThemeText, themeStyles.resolvedThemeText]}>
                {resolvedTheme.toUpperCase()}
              </Text>
            </View>
          </View>
        </View>
        <View style={topBarStyles.quickActions}>
          <ActionButton
            text={panelsOpen ? 'Hide Panels' : 'Open Panels'}
            active={panelsOpen}
            themeStyles={themeStyles}
            onPress={onTogglePanels}
          />
          <ActionButton
            text={controlsOpen ? 'Hide Controls' : 'Show Controls'}
            active={controlsOpen}
            themeStyles={themeStyles}
            onPress={onToggleControls}
          />
          <ActionButton
            text={micListening ? 'Stop Mic' : 'Start Mic'}
            disabled={!micSupported}
            active={micListening}
            themeStyles={themeStyles}
            onPress={onToggleMic}
          />
          <View style={[topBarStyles.modeSwitcher, themeStyles.modeSwitcher]}>
            <ModeChip label="Auto" value="auto" active={themeMode === 'auto'} themeStyles={themeStyles} onPress={onThemeModeChange} />
            <ModeChip label="Light" value="light" active={themeMode === 'light'} themeStyles={themeStyles} onPress={onThemeModeChange} />
            <ModeChip label="Dark" value="dark" active={themeMode === 'dark'} themeStyles={themeStyles} onPress={onThemeModeChange} />
          </View>
        </View>
      </View>
      {controlsOpen ? (
        <>
          <View style={[topBarStyles.controlsDivider, themeStyles.controlsDivider]} />
          <View style={topBarStyles.controlsRow}>
            <ActionButton text={freezeAi ? 'Unfreeze AI' : 'Freeze AI'} active={freezeAi} themeStyles={themeStyles} onPress={onToggleFreeze} />
            <ActionButton text="Pin Diagram" themeStyles={themeStyles} onPress={onPinDiagram} />
            <ActionButton text={focusMode ? 'Cancel Focus' : 'Focus Mode'} active={focusMode} themeStyles={themeStyles} onPress={onToggleFocusMode} />
            <ActionButton text="Regenerate" themeStyles={themeStyles} onPress={onRegenerate} />
            <ActionButton text="Undo AI" themeStyles={themeStyles} onPress={onUndoAi} />
            <ActionButton
              text={`Restore Last (${archivedCount})`}
              disabled={archivedCount === 0}
              themeStyles={themeStyles}
              onPress={onRestoreArchived}
            />
          </View>
          <View style={topBarStyles.hintRow}>
            <Text style={[topBarStyles.hintLabel, themeStyles.hintLabel]}>Currently sharing:</Text>
            <TextInput
              value={visualHint}
              onChangeText={onVisualHintChange}
              placeholder="Design doc section / URL / snippet"
              placeholderTextColor={themeStyles.placeholderColor}
              style={[topBarStyles.hintInput, themeStyles.hintInput]}
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
  themeStyles,
}: {
  text: string;
  onPress: () => void;
  active?: boolean;
  disabled?: boolean;
  themeStyles: TopBarThemeStyles;
}) => (
  <Pressable
    disabled={disabled}
    onPress={onPress}
    style={({ pressed }) => [
      topBarStyles.actionButton,
      themeStyles.actionButton,
      active && topBarStyles.actionButtonActive,
      active && themeStyles.actionButtonActive,
      disabled && topBarStyles.actionButtonDisabled,
      pressed && topBarStyles.actionButtonPressed,
    ]}>
    <Text
      style={[
        topBarStyles.actionText,
        themeStyles.actionText,
        active && topBarStyles.actionTextActive,
        active && themeStyles.actionTextActive,
      ]}>
      {text}
    </Text>
  </Pressable>
);

const ModeChip = ({
  label,
  value,
  active,
  themeStyles,
  onPress,
}: {
  label: string;
  value: ThemeMode;
  active: boolean;
  themeStyles: TopBarThemeStyles;
  onPress: (mode: ThemeMode) => void;
}) => (
  <Pressable
    onPress={() => onPress(value)}
    style={({ pressed }) => [
      topBarStyles.modeChip,
      themeStyles.modeChip(active),
      pressed && topBarStyles.actionButtonPressed,
    ]}>
    <Text style={[topBarStyles.modeChipText, themeStyles.modeChipText(active)]}>{label}</Text>
  </Pressable>
);
