import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

import { isDragGesture, shouldToggleOptionsOnPress } from './floating-options.logic';
import type { ChatMessage } from '../../../shared/types';
import type { SenseTheme, ThemeMode } from '../lib/theme';
import { createFloatingOptionsThemeStyles, floatingOptionsStyles } from '../styles/floating-options.styles';

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
  onAddQuickPersonalization: (text: string) => void;
  onToggleDebugPanel: () => void;
  onLeaveRoom: () => void;
}

type FloatingOptionsThemeStyles = ReturnType<typeof createFloatingOptionsThemeStyles>;

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
  onAddQuickPersonalization,
  onToggleDebugPanel,
  onLeaveRoom,
}: FloatingOptionsProps) => {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [chatOpen, setChatOpen] = useState(false);
  const [chatDraft, setChatDraft] = useState('');
  const dragStartRef = useRef({ x: 0, y: 0 });
  const draggedRef = useRef(false);
  const chatInputRef = useRef<TextInput | null>(null);
  const themeStyles = useMemo(() => createFloatingOptionsThemeStyles(theme), [theme]);

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
        },
        onPanResponderMove: (_event, gestureState) => {
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
        floatingOptionsStyles.container,
        {
          transform: [{ translateX: offset.x }, { translateY: offset.y }],
        },
      ]}>
      {open ? (
        <View style={[floatingOptionsStyles.panel, themeStyles.panel]}>
          <Text style={[floatingOptionsStyles.sectionTitle, themeStyles.sectionTitle]}>Options</Text>
          <View style={floatingOptionsStyles.row}>
            <OptionButton text={panelsOpen ? 'Hide Panels' : 'Show Panels'} onPress={onTogglePanels} themeStyles={themeStyles} />
            <OptionButton
              text={micListening ? 'Stop Mic' : 'Start Mic'}
              onPress={onToggleMic}
              disabled={!micSupported}
              themeStyles={themeStyles}
            />
          </View>
          <View style={floatingOptionsStyles.row}>
            <OptionButton text={freezeAi ? 'Unfreeze AI' : 'Freeze AI'} onPress={onToggleFreeze} themeStyles={themeStyles} />
            <OptionButton text="Pin Diagram" onPress={onPinDiagram} themeStyles={themeStyles} />
          </View>
          <View style={floatingOptionsStyles.row}>
            <OptionButton text={focusMode ? 'Cancel Focus' : 'Focus Mode'} onPress={onToggleFocusMode} themeStyles={themeStyles} />
            <OptionButton text="Regenerate" onPress={onRegenerate} themeStyles={themeStyles} />
            <OptionButton text="Clear board" onPress={onClearBoard} themeStyles={themeStyles} />
          </View>
          <View style={floatingOptionsStyles.row}>
            <OptionButton text="Undo AI" onPress={onUndoAi} themeStyles={themeStyles} />
            <OptionButton
              text={`Restore Last (${archivedCount})`}
              onPress={onRestoreArchived}
              disabled={archivedCount === 0}
              themeStyles={themeStyles}
            />
          </View>
          <View style={floatingOptionsStyles.row}>
            <OptionButton text={showAiNotes ? 'Hide AI Notes' : 'Show AI Notes'} onPress={onToggleShowAiNotes} themeStyles={themeStyles} />
            <OptionButton text={debugPanelOpen ? 'Hide Debug' : 'Show Debug'} onPress={onToggleDebugPanel} themeStyles={themeStyles} />
          </View>
          <Text style={[floatingOptionsStyles.sectionTitle, themeStyles.sectionSubTitle]}>Theme</Text>
          <View style={floatingOptionsStyles.row}>
            <ModeChip label="Auto" value="auto" active={themeMode === 'auto'} themeStyles={themeStyles} onPress={onThemeModeChange} />
            <ModeChip label="Light" value="light" active={themeMode === 'light'} themeStyles={themeStyles} onPress={onThemeModeChange} />
            <ModeChip label="Dark" value="dark" active={themeMode === 'dark'} themeStyles={themeStyles} onPress={onThemeModeChange} />
          </View>
          <OptionButton text="Leave Room" onPress={onLeaveRoom} themeStyles={themeStyles} />
        </View>
      ) : null}
      {chatOpen ? (
        <View style={[floatingOptionsStyles.chatPanel, themeStyles.chatPanel]}>
          <Text style={[floatingOptionsStyles.sectionTitle, themeStyles.sectionTitle]}>Type Idea</Text>
          <View style={[floatingOptionsStyles.historyWrap, themeStyles.historyWrap]}>
            <ScrollView style={floatingOptionsStyles.historyScroll} contentContainerStyle={floatingOptionsStyles.historyContent}>
              {chatHistory.length === 0 ? (
                <Text style={[floatingOptionsStyles.historyEmpty, themeStyles.historyEmpty]}>No messages yet.</Text>
              ) : (
                chatHistory.map((message) => (
                  <View key={message.id} style={[floatingOptionsStyles.historyItem, themeStyles.historyItem]}>
                    <Text style={[floatingOptionsStyles.historyMeta, themeStyles.historyMeta]}>
                      {message.authorName} - {message.kind}
                    </Text>
                    <Text style={[floatingOptionsStyles.historyText, themeStyles.historyText]}>
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
            placeholderTextColor={themeStyles.placeholderColor}
            style={[floatingOptionsStyles.chatInput, themeStyles.chatInput]}
            multiline
          />
          <View style={floatingOptionsStyles.row}>
            <OptionButton text="Send to AI" onPress={submitQuickChat} themeStyles={themeStyles} />
            <OptionButton
              text="Add to personalization"
              onPress={() => {
                const text = chatDraft.trim();
                if (!text) {
                  return;
                }
                onAddQuickPersonalization(text);
                setChatDraft('');
                setTimeout(() => {
                  chatInputRef.current?.focus();
                }, 0);
              }}
              themeStyles={themeStyles}
            />
            <OptionButton text="Close" onPress={() => setChatOpen(false)} themeStyles={themeStyles} />
          </View>
        </View>
      ) : null}
      <Pressable
        onPress={onToggleMic}
        disabled={!micSupported}
        style={({ pressed }) => [
          floatingOptionsStyles.fabButton,
          themeStyles.micFab(micListening),
          !micSupported && floatingOptionsStyles.optionDisabled,
          pressed && floatingOptionsStyles.handlePressed,
        ]}>
        <MaterialIcons
          name={micListening ? 'mic' : 'mic-none'}
          size={20}
          color={themeStyles.micFabIcon(micListening)}
        />
      </Pressable>
      <Pressable
        onPress={() => setChatOpen((value) => !value)}
        style={({ pressed }) => [
          floatingOptionsStyles.fabButton,
          themeStyles.chatFab,
          pressed && floatingOptionsStyles.handlePressed,
        ]}>
        <MaterialIcons name={chatOpen ? 'chat' : 'chat-bubble-outline'} size={20} color={themeStyles.chatFabIcon} />
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
          floatingOptionsStyles.handle,
          themeStyles.handle,
          pressed && floatingOptionsStyles.handlePressed,
        ]}>
        <Text style={[floatingOptionsStyles.handleText, themeStyles.handleText]}>
          {open ? 'Hide options' : 'Show options'}
        </Text>
      </Pressable>
    </View>
  );
};

const OptionButton = ({
  text,
  onPress,
  themeStyles,
  disabled,
}: {
  text: string;
  onPress: () => void;
  themeStyles: FloatingOptionsThemeStyles;
  disabled?: boolean;
}) => (
  <Pressable
    disabled={disabled}
    onPress={onPress}
    style={({ pressed }) => [
      floatingOptionsStyles.optionButton,
      themeStyles.optionButton,
      disabled && floatingOptionsStyles.optionDisabled,
      pressed && floatingOptionsStyles.optionPressed,
    ]}>
    <Text style={[floatingOptionsStyles.optionText, themeStyles.optionText]}>{text}</Text>
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
  themeStyles: FloatingOptionsThemeStyles;
  onPress: (mode: ThemeMode) => void;
}) => (
  <Pressable
    onPress={() => onPress(value)}
    style={({ pressed }) => [
      floatingOptionsStyles.modeChip,
      themeStyles.modeChip(active),
      pressed && floatingOptionsStyles.optionPressed,
    ]}>
    <Text style={[floatingOptionsStyles.modeText, themeStyles.modeText(active)]}>{label}</Text>
  </Pressable>
);
