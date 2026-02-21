import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

import { isDragGesture, shouldToggleOptionsOnPress } from './floating-options.logic';
import type { ChatMessage } from '../../../shared/types';
import type { SenseTheme, ThemeMode } from '../lib/theme';

interface FloatingOptionsProps {
  open: boolean;
  panelsOpen: boolean;
  micListening: boolean;
  micSupported: boolean;
  freezeAi: boolean;
  focusMode: boolean;
  showAiNotes: boolean;
  chatHistory: ChatMessage[];
  archivedCount: number;
  debugPanelOpen: boolean;
  themeMode: ThemeMode;
  theme: SenseTheme;
  onToggleOpen: () => void;
  onTogglePanels: () => void;
  onToggleMic: () => void;
  onToggleFreeze: () => void;
  onPinDiagram: () => void;
  onToggleFocusMode: () => void;
  onRegenerate: () => void;
  onClearBoard: () => void;
  onUndoAi: () => void;
  onRestoreArchived: () => void;
  onToggleShowAiNotes: () => void;
  onThemeModeChange: (mode: ThemeMode) => void;
  onSendQuickChat: (text: string) => void;
  onToggleDebugPanel: () => void;
  onLeaveRoom: () => void;
}

export const FloatingOptions = ({
  open,
  panelsOpen,
  micListening,
  micSupported,
  freezeAi,
  focusMode,
  showAiNotes,
  chatHistory,
  archivedCount,
  debugPanelOpen,
  themeMode,
  theme,
  onToggleOpen,
  onTogglePanels,
  onToggleMic,
  onToggleFreeze,
  onPinDiagram,
  onToggleFocusMode,
  onRegenerate,
  onClearBoard,
  onUndoAi,
  onRestoreArchived,
  onToggleShowAiNotes,
  onThemeModeChange,
  onSendQuickChat,
  onToggleDebugPanel,
  onLeaveRoom,
}: FloatingOptionsProps) => {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [chatOpen, setChatOpen] = useState(false);
  const [chatDraft, setChatDraft] = useState('');
  const dragStartRef = useRef({ x: 0, y: 0 });
  const draggedRef = useRef(false);
  const pressDeltaRef = useRef({ dx: 0, dy: 0 });
  const chatInputRef = useRef<TextInput | null>(null);

  const submitQuickChat = useCallback(() => {
    const text = chatDraft.trim();
    if (!text) {
      return;
    }
    onSendQuickChat(text);
    setChatDraft('');
    setTimeout(() => {
      chatInputRef.current?.focus();
    }, 0);
  }, [chatDraft, onSendQuickChat]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          dragStartRef.current = offset;
          draggedRef.current = false;
          pressDeltaRef.current = { dx: 0, dy: 0 };
        },
        onPanResponderMove: (_event, gestureState) => {
          pressDeltaRef.current = { dx: gestureState.dx, dy: gestureState.dy };
          if (isDragGesture(gestureState.dx, gestureState.dy)) {
            draggedRef.current = true;
          }
          setOffset({
            x: dragStartRef.current.x + gestureState.dx,
            y: dragStartRef.current.y + gestureState.dy,
          });
        },
        onPanResponderRelease: () => {},
      }),
    [offset],
  );

  useEffect(() => {
    if (!chatOpen || typeof window === 'undefined') {
      return;
    }
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Enter') {
        return;
      }
      if (!event.altKey && !event.metaKey) {
        return;
      }
      const target = event.target as HTMLElement | null;
      const isTextInput =
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'INPUT' ||
        Boolean(target?.getAttribute('contenteditable'));
      if (!isTextInput) {
        return;
      }
      event.preventDefault();
      submitQuickChat();
    };
    window.addEventListener('keydown', handler, true);
    return () => {
      window.removeEventListener('keydown', handler, true);
    };
  }, [chatOpen, submitQuickChat]);

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.container,
        {
          transform: [{ translateX: offset.x }, { translateY: offset.y }],
        },
      ]}>
      {open ? (
        <View style={[styles.panel, { borderColor: theme.colors.panelBorder, backgroundColor: theme.colors.panel }]}>
          <Text style={[styles.sectionTitle, { color: theme.colors.textPrimary, fontFamily: theme.fonts.heading }]}>Options</Text>
          <View style={styles.row}>
            <OptionButton text={panelsOpen ? 'Hide Panels' : 'Show Panels'} onPress={onTogglePanels} theme={theme} />
            <OptionButton
              text={micListening ? 'Stop Mic' : 'Start Mic'}
              onPress={onToggleMic}
              disabled={!micSupported}
              theme={theme}
            />
          </View>
          <View style={styles.row}>
            <OptionButton text={freezeAi ? 'Unfreeze AI' : 'Freeze AI'} onPress={onToggleFreeze} theme={theme} />
            <OptionButton text="Pin Diagram" onPress={onPinDiagram} theme={theme} />
          </View>
          <View style={styles.row}>
            <OptionButton text={focusMode ? 'Cancel Focus' : 'Focus Mode'} onPress={onToggleFocusMode} theme={theme} />
            <OptionButton text="Regenerate" onPress={onRegenerate} theme={theme} />
            <OptionButton text="Clear board" onPress={onClearBoard} theme={theme} />
          </View>
          <View style={styles.row}>
            <OptionButton text="Undo AI" onPress={onUndoAi} theme={theme} />
            <OptionButton
              text={`Restore Last (${archivedCount})`}
              onPress={onRestoreArchived}
              disabled={archivedCount === 0}
              theme={theme}
            />
          </View>
          <View style={styles.row}>
            <OptionButton text={showAiNotes ? 'Hide AI Notes' : 'Show AI Notes'} onPress={onToggleShowAiNotes} theme={theme} />
            <OptionButton text={debugPanelOpen ? 'Hide Debug' : 'Show Debug'} onPress={onToggleDebugPanel} theme={theme} />
          </View>
          <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary, fontFamily: theme.fonts.body }]}>Theme</Text>
          <View style={styles.row}>
            <ModeChip label="Auto" value="auto" active={themeMode === 'auto'} theme={theme} onPress={onThemeModeChange} />
            <ModeChip label="Light" value="light" active={themeMode === 'light'} theme={theme} onPress={onThemeModeChange} />
            <ModeChip label="Dark" value="dark" active={themeMode === 'dark'} theme={theme} onPress={onThemeModeChange} />
          </View>
          <OptionButton text="Leave Room" onPress={onLeaveRoom} theme={theme} />
        </View>
      ) : null}
      {chatOpen ? (
        <View style={[styles.chatPanel, { borderColor: theme.colors.panelBorder, backgroundColor: theme.colors.panel }]}>
          <Text style={[styles.sectionTitle, { color: theme.colors.textPrimary, fontFamily: theme.fonts.heading }]}>Type Idea</Text>
          <View style={[styles.historyWrap, { borderColor: theme.colors.inputBorder, backgroundColor: theme.colors.inputBg }]}>
            <ScrollView style={styles.historyScroll} contentContainerStyle={styles.historyContent}>
              {chatHistory.length === 0 ? (
                <Text style={[styles.historyEmpty, { color: theme.colors.textMuted, fontFamily: theme.fonts.body }]}>No messages yet.</Text>
              ) : (
                chatHistory.map((message) => (
                  <View key={message.id} style={[styles.historyItem, { borderColor: theme.colors.panelBorder }]}>
                    <Text style={[styles.historyMeta, { color: theme.colors.textMuted, fontFamily: theme.fonts.mono }]}>
                      {message.authorName} - {message.kind}
                    </Text>
                    <Text style={[styles.historyText, { color: theme.colors.textPrimary, fontFamily: theme.fonts.body }]}>
                      {message.text}
                    </Text>
                  </View>
                ))
              )}
            </ScrollView>
          </View>
          <TextInput
            ref={chatInputRef}
            value={chatDraft}
            onChangeText={setChatDraft}
            placeholder="Type what should appear on the board..."
            placeholderTextColor={theme.colors.textMuted}
            style={[
              styles.chatInput,
              {
                borderColor: theme.colors.inputBorder,
                backgroundColor: theme.colors.inputBg,
                color: theme.colors.textPrimary,
                fontFamily: theme.fonts.body,
              },
            ]}
            multiline
          />
          <View style={styles.row}>
            <OptionButton
              text="Send to AI"
              onPress={submitQuickChat}
              theme={theme}
            />
            <OptionButton text="Close" onPress={() => setChatOpen(false)} theme={theme} />
          </View>
        </View>
      ) : null}
      <Pressable
        onPress={onToggleMic}
        disabled={!micSupported}
        style={({ pressed }) => [
          styles.fabButton,
          {
            borderColor: micListening ? theme.colors.accent : theme.colors.buttonBorder,
            backgroundColor: micListening ? theme.colors.accentSoft : theme.colors.buttonBg,
          },
          !micSupported && styles.optionDisabled,
          pressed && styles.handlePressed,
        ]}>
        <MaterialIcons
          name={micListening ? 'mic' : 'mic-none'}
          size={20}
          color={micListening ? theme.colors.accentText : theme.colors.buttonText}
        />
      </Pressable>
      <Pressable
        onPress={() => setChatOpen((value) => !value)}
        style={({ pressed }) => [
          styles.fabButton,
          {
            borderColor: theme.colors.buttonBorder,
            backgroundColor: theme.colors.buttonBg,
          },
          pressed && styles.handlePressed,
        ]}>
        <MaterialIcons name={chatOpen ? 'chat' : 'chat-bubble-outline'} size={20} color={theme.colors.buttonText} />
      </Pressable>
      <Pressable
        {...panResponder.panHandlers}
        onPress={() => {
          if (!shouldToggleOptionsOnPress(draggedRef.current)) {
            draggedRef.current = false;
            return;
          }
          onToggleOpen();
        }}
        style={({ pressed }) => [
          styles.handle,
          {
            borderColor: theme.colors.accent,
            backgroundColor: theme.colors.accentSoft,
          },
          pressed && styles.handlePressed,
        ]}>
        <Text style={[styles.handleText, { color: theme.colors.accentText, fontFamily: theme.fonts.heading }]}>
          {open ? 'Hide options' : 'Show options'}
        </Text>
      </Pressable>
    </View>
  );
};

const OptionButton = ({
  text,
  onPress,
  theme,
  disabled,
}: {
  text: string;
  onPress: () => void;
  theme: SenseTheme;
  disabled?: boolean;
}) => (
  <Pressable
    disabled={disabled}
    onPress={onPress}
    style={({ pressed }) => [
      styles.optionButton,
      {
        borderColor: theme.colors.buttonBorder,
        backgroundColor: theme.colors.buttonBg,
      },
      disabled && styles.optionDisabled,
      pressed && styles.optionPressed,
    ]}>
    <Text style={[styles.optionText, { color: theme.colors.buttonText, fontFamily: theme.fonts.body }]}>{text}</Text>
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
      pressed && styles.optionPressed,
    ]}>
    <Text style={[styles.modeText, { color: active ? theme.colors.accentText : theme.colors.textSecondary, fontFamily: theme.fonts.body }]}>
      {label}
    </Text>
  </Pressable>
);

const styles = StyleSheet.create({
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


