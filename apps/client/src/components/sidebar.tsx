import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { SenseTheme } from '../lib/theme';

import type {
  ChatMessage,
  ContextPriority,
  ContextScope,
  NoteKind,
  RoomState,
  TranscriptChunk,
} from '../../../shared/types';

export type SidebarTab = 'transcript' | 'chat' | 'context';

interface ContextDraft {
  title: string;
  content: string;
  priority: ContextPriority;
  scope: ContextScope;
  pinned: boolean;
}

interface SidebarProps {
  room: RoomState;
  activeTab: SidebarTab;
  interimTranscript: string;
  transcriptDraft: string;
  chatDraft: string;
  chatKind: NoteKind;
  contextDraft: ContextDraft;
  theme: SenseTheme;
  overlay?: boolean;
  onClose?: () => void;
  onTabChange: (tab: SidebarTab) => void;
  onTranscriptDraftChange: (value: string) => void;
  onSendManualTranscript: () => void;
  onChatDraftChange: (value: string) => void;
  onChatKindChange: (value: NoteKind) => void;
  onSendChat: () => void;
  onContextDraftChange: (value: ContextDraft) => void;
  onAddContext: () => void;
}

export const Sidebar = ({
  room,
  activeTab,
  interimTranscript,
  transcriptDraft,
  chatDraft,
  chatKind,
  contextDraft,
  theme,
  overlay,
  onClose,
  onTabChange,
  onTranscriptDraftChange,
  onSendManualTranscript,
  onChatDraftChange,
  onChatKindChange,
  onSendChat,
  onContextDraftChange,
  onAddContext,
}: SidebarProps) => {
  const openQuestions = room.aiHistory.at(-1)?.patch.openQuestions ?? [];

  return (
    <View
      style={[
        styles.container,
        overlay ? styles.overlayContainer : null,
        { borderColor: theme.colors.panelBorder, backgroundColor: theme.colors.panel },
      ]}>
      <View style={[styles.tabsRow, { borderBottomColor: theme.colors.panelBorder, backgroundColor: theme.colors.panelMuted }]}>
        <View style={styles.tabs}>
          <TabButton label="Transcript" active={activeTab === 'transcript'} onPress={() => onTabChange('transcript')} theme={theme} />
          <TabButton label="Chat" active={activeTab === 'chat'} onPress={() => onTabChange('chat')} theme={theme} />
          <TabButton label="Context Bank" active={activeTab === 'context'} onPress={() => onTabChange('context')} theme={theme} />
        </View>
        {overlay ? (
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [
              styles.closeButton,
              {
                borderColor: theme.colors.inputBorder,
                backgroundColor: theme.colors.inputBg,
              },
              pressed && styles.pressed,
            ]}>
            <Text style={[styles.closeButtonText, { color: theme.colors.textSecondary, fontFamily: theme.fonts.body }]}>Close</Text>
          </Pressable>
        ) : null}
      </View>

      {openQuestions.length > 0 ? (
        <View style={[styles.questionsBanner, { borderBottomColor: theme.colors.panelBorder, backgroundColor: theme.colors.accentSoft }]}>
          <Text style={[styles.questionsTitle, { color: theme.colors.accentText, fontFamily: theme.fonts.heading }]}>Open Question</Text>
          {openQuestions.map((question) => (
            <Text key={question} style={[styles.questionsText, { color: theme.colors.accentText, fontFamily: theme.fonts.body }]}>
              - {question}
            </Text>
          ))}
        </View>
      ) : null}

      {activeTab === 'transcript' ? (
        <TranscriptPanel
          chunks={room.transcriptChunks}
          interimTranscript={interimTranscript}
          transcriptDraft={transcriptDraft}
          theme={theme}
          onTranscriptDraftChange={onTranscriptDraftChange}
          onSendManualTranscript={onSendManualTranscript}
        />
      ) : null}

      {activeTab === 'chat' ? (
        <ChatPanel
          messages={room.chatMessages}
          chatDraft={chatDraft}
          chatKind={chatKind}
          theme={theme}
          onChatDraftChange={onChatDraftChange}
          onChatKindChange={onChatKindChange}
          onSendChat={onSendChat}
        />
      ) : null}

      {activeTab === 'context' ? (
        <ContextPanel
          items={room.contextItems}
          draft={contextDraft}
          theme={theme}
          onDraftChange={onContextDraftChange}
          onAdd={onAddContext}
        />
      ) : null}
    </View>
  );
};

const TranscriptPanel = ({
  chunks,
  interimTranscript,
  transcriptDraft,
  theme,
  onTranscriptDraftChange,
  onSendManualTranscript,
}: {
  chunks: TranscriptChunk[];
  interimTranscript: string;
  transcriptDraft: string;
  theme: SenseTheme;
  onTranscriptDraftChange: (value: string) => void;
  onSendManualTranscript: () => void;
}) => {
  return (
    <View style={styles.panel}>
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {chunks
          .slice()
          .reverse()
          .map((chunk) => (
            <View key={chunk.id} style={[styles.itemCard, { borderColor: theme.colors.panelBorder, backgroundColor: theme.colors.panelMuted }]}>
              <Text style={[styles.itemMeta, { color: theme.colors.textMuted, fontFamily: theme.fonts.mono }]}>
                {chunk.speaker} - {new Date(chunk.createdAt).toLocaleTimeString()}
              </Text>
              <Text style={[styles.itemBody, { color: theme.colors.textPrimary, fontFamily: theme.fonts.body }]}>{chunk.text}</Text>
            </View>
          ))}
        {interimTranscript ? (
          <View style={[styles.itemCard, { borderColor: theme.colors.accent, backgroundColor: theme.colors.accentSoft }]}>
            <Text style={[styles.itemMeta, { color: theme.colors.accentText, fontFamily: theme.fonts.mono }]}>Live</Text>
            <Text style={[styles.interimText, { color: theme.colors.accentText, fontFamily: theme.fonts.body }]}>{interimTranscript}</Text>
          </View>
        ) : null}
      </ScrollView>
      <View style={[styles.composeArea, { borderTopColor: theme.colors.panelBorder, backgroundColor: theme.colors.panel }]}>
        <Text style={[styles.composeLabel, { color: theme.colors.textSecondary, fontFamily: theme.fonts.body }]}>Manual transcript fallback</Text>
        <TextInput
          value={transcriptDraft}
          onChangeText={onTranscriptDraftChange}
          placeholder="Type transcript chunk and send"
          placeholderTextColor={theme.colors.textMuted}
          style={[
            styles.input,
            {
              borderColor: theme.colors.inputBorder,
              backgroundColor: theme.colors.inputBg,
              color: theme.colors.textPrimary,
              fontFamily: theme.fonts.body,
            },
          ]}
        />
        <Pressable style={[styles.primaryButton, { backgroundColor: theme.colors.accent }]} onPress={onSendManualTranscript}>
          <Text style={[styles.primaryButtonText, { color: theme.colors.accentText, fontFamily: theme.fonts.heading }]}>Send chunk</Text>
        </Pressable>
      </View>
    </View>
  );
};

const ChatPanel = ({
  messages,
  chatDraft,
  chatKind,
  theme,
  onChatDraftChange,
  onChatKindChange,
  onSendChat,
}: {
  messages: ChatMessage[];
  chatDraft: string;
  chatKind: NoteKind;
  theme: SenseTheme;
  onChatDraftChange: (value: string) => void;
  onChatKindChange: (value: NoteKind) => void;
  onSendChat: () => void;
}) => {
  return (
    <View style={styles.panel}>
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {messages
          .slice()
          .reverse()
          .map((message) => (
            <View key={message.id} style={[styles.itemCard, { borderColor: theme.colors.panelBorder, backgroundColor: theme.colors.panelMuted }]}>
              <Text style={[styles.itemMeta, { color: theme.colors.textMuted, fontFamily: theme.fonts.mono }]}>
                {message.authorName} - {message.kind.toUpperCase()}
              </Text>
              <Text style={[styles.itemBody, { color: theme.colors.textPrimary, fontFamily: theme.fonts.body }]}>{message.text}</Text>
            </View>
          ))}
      </ScrollView>
      <View style={[styles.composeArea, { borderTopColor: theme.colors.panelBorder, backgroundColor: theme.colors.panel }]}>
        <TextInput
          value={chatDraft}
          onChangeText={onChatDraftChange}
          placeholder="Type note or correction"
          placeholderTextColor={theme.colors.textMuted}
          style={[
            styles.input,
            {
              borderColor: theme.colors.inputBorder,
              backgroundColor: theme.colors.inputBg,
              color: theme.colors.textPrimary,
              fontFamily: theme.fonts.body,
            },
          ]}
          multiline
        />
        <View style={styles.pillRow}>
          <KindPill label="Normal" value="normal" current={chatKind} onChange={onChatKindChange} theme={theme} />
          <KindPill label="Correction" value="correction" current={chatKind} onChange={onChatKindChange} theme={theme} />
          <KindPill label="Suggestion" value="suggestion" current={chatKind} onChange={onChatKindChange} theme={theme} />
        </View>
        <Pressable style={[styles.primaryButton, { backgroundColor: theme.colors.accent }]} onPress={onSendChat}>
          <Text style={[styles.primaryButtonText, { color: theme.colors.accentText, fontFamily: theme.fonts.heading }]}>Send message</Text>
        </Pressable>
      </View>
    </View>
  );
};

const ContextPanel = ({
  items,
  draft,
  theme,
  onDraftChange,
  onAdd,
}: {
  items: RoomState['contextItems'];
  draft: ContextDraft;
  theme: SenseTheme;
  onDraftChange: (value: ContextDraft) => void;
  onAdd: () => void;
}) => {
  return (
    <View style={styles.panel}>
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {items
          .slice()
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .map((item) => (
            <View key={item.id} style={[styles.itemCard, { borderColor: theme.colors.panelBorder, backgroundColor: theme.colors.panelMuted }]}>
              <Text style={[styles.itemMeta, { color: theme.colors.textMuted, fontFamily: theme.fonts.mono }]}>
                {item.pinned ? 'PINNED - ' : ''}
                {item.priority.toUpperCase()} - {item.scope}
              </Text>
              <Text style={[styles.itemTitle, { color: theme.colors.textPrimary, fontFamily: theme.fonts.heading }]}>{item.title}</Text>
              <Text style={[styles.itemBody, { color: theme.colors.textSecondary, fontFamily: theme.fonts.body }]}>{item.content}</Text>
            </View>
          ))}
      </ScrollView>
      <View style={[styles.composeArea, { borderTopColor: theme.colors.panelBorder, backgroundColor: theme.colors.panel }]}>
        <TextInput
          value={draft.title}
          onChangeText={(value) => onDraftChange({ ...draft, title: value })}
          placeholder="Context title"
          placeholderTextColor={theme.colors.textMuted}
          style={[
            styles.input,
            {
              borderColor: theme.colors.inputBorder,
              backgroundColor: theme.colors.inputBg,
              color: theme.colors.textPrimary,
              fontFamily: theme.fonts.body,
            },
          ]}
        />
        <TextInput
          value={draft.content}
          onChangeText={(value) => onDraftChange({ ...draft, content: value })}
          placeholder="Context content"
          placeholderTextColor={theme.colors.textMuted}
          style={[
            styles.input,
            styles.multiInput,
            {
              borderColor: theme.colors.inputBorder,
              backgroundColor: theme.colors.inputBg,
              color: theme.colors.textPrimary,
              fontFamily: theme.fonts.body,
            },
          ]}
          multiline
        />
        <View style={styles.pillRow}>
          <KindPill
            label="Priority: Normal"
            value="normal"
            current={draft.priority}
            theme={theme}
            onChange={(value) => onDraftChange({ ...draft, priority: value as ContextPriority })}
          />
          <KindPill
            label="Priority: High"
            value="high"
            current={draft.priority}
            theme={theme}
            onChange={(value) => onDraftChange({ ...draft, priority: value as ContextPriority })}
          />
        </View>
        <View style={styles.pillRow}>
          <KindPill
            label="Scope: Global"
            value="global"
            current={draft.scope}
            theme={theme}
            onChange={(value) => onDraftChange({ ...draft, scope: value as ContextScope })}
          />
          <KindPill
            label="Scope: Topic"
            value="topic"
            current={draft.scope}
            theme={theme}
            onChange={(value) => onDraftChange({ ...draft, scope: value as ContextScope })}
          />
          <KindPill
            label={draft.pinned ? 'Pinned' : 'Unpinned'}
            value={draft.pinned ? 'pinned' : 'unpinned'}
            current={draft.pinned ? 'pinned' : 'unpinned'}
            theme={theme}
            onChange={() => onDraftChange({ ...draft, pinned: !draft.pinned })}
          />
        </View>
        <Pressable style={[styles.primaryButton, { backgroundColor: theme.colors.accent }]} onPress={onAdd}>
          <Text style={[styles.primaryButtonText, { color: theme.colors.accentText, fontFamily: theme.fonts.heading }]}>Add context item</Text>
        </Pressable>
      </View>
    </View>
  );
};

const TabButton = ({
  label,
  active,
  onPress,
  theme,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  theme: SenseTheme;
}) => (
  <Pressable
    style={({ pressed }) => [
      styles.tabButton,
      active && styles.tabButtonActive,
      active && { backgroundColor: theme.colors.accentSoft },
      pressed && styles.pressed,
    ]}
    onPress={onPress}>
    <Text
      style={[
        styles.tabText,
        { color: theme.colors.textSecondary, fontFamily: theme.fonts.body },
        active && styles.tabTextActive,
        active && { color: theme.colors.accentText },
      ]}>
      {label}
    </Text>
  </Pressable>
);

const KindPill = ({
  label,
  value,
  current,
  onChange,
  theme,
}: {
  label: string;
  value: string;
  current: string;
  onChange: (value: any) => void;
  theme: SenseTheme;
}) => (
  <Pressable
    style={({ pressed }) => [
      styles.kindPill,
      {
        borderColor: theme.colors.inputBorder,
        backgroundColor: theme.colors.inputBg,
      },
      current === value && styles.kindPillActive,
      current === value && { borderColor: theme.colors.accent, backgroundColor: theme.colors.accentSoft },
      pressed && styles.pressed,
    ]}
    onPress={() => onChange(value)}>
    <Text
      style={[
        styles.kindPillText,
        { color: theme.colors.textSecondary, fontFamily: theme.fonts.body },
        current === value && styles.kindPillTextActive,
        current === value && { color: theme.colors.accentText },
      ]}>
      {label}
    </Text>
  </Pressable>
);

const styles = StyleSheet.create({
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
  pressed: {
    opacity: 0.78,
  },
});
