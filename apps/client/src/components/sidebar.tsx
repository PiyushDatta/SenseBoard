import { useMemo } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import type { SenseTheme } from '../lib/theme';
import { createSidebarThemeStyles, sidebarStyles } from '../styles/sidebar.styles';

import type {
  ChatMessage,
  ContextPriority,
  ContextScope,
  NoteKind,
  RoomState,
  TranscriptChunk,
} from '../../../shared/types';
import type { ContextDraft } from '../lib/room-ui-state';

export type SidebarTab = 'transcript' | 'chat' | 'context';

type SidebarThemeStyles = ReturnType<typeof createSidebarThemeStyles>;

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
  onAddChatToPersonalization: () => void;
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
  onAddChatToPersonalization,
  onContextDraftChange,
  onAddContext,
}: SidebarProps) => {
  const openQuestions = room.aiHistory.at(-1)?.patch.openQuestions ?? [];
  const themeStyles = useMemo(() => createSidebarThemeStyles(theme), [theme]);

  return (
    <View
      style={[
        sidebarStyles.container,
        overlay ? sidebarStyles.overlayContainer : null,
        themeStyles.container,
      ]}>
      <View style={[sidebarStyles.tabsRow, themeStyles.tabsRow]}>
        <View style={sidebarStyles.tabs}>
          <TabButton label="Transcript" active={activeTab === 'transcript'} onPress={() => onTabChange('transcript')} themeStyles={themeStyles} />
          <TabButton label="Chat" active={activeTab === 'chat'} onPress={() => onTabChange('chat')} themeStyles={themeStyles} />
          <TabButton label="Context Bank" active={activeTab === 'context'} onPress={() => onTabChange('context')} themeStyles={themeStyles} />
        </View>
        {overlay ? (
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [
              sidebarStyles.closeButton,
              themeStyles.closeButton,
              pressed && sidebarStyles.pressed,
            ]}>
            <Text style={[sidebarStyles.closeButtonText, themeStyles.closeButtonText]}>Close</Text>
          </Pressable>
        ) : null}
      </View>

      {openQuestions.length > 0 ? (
        <View style={[sidebarStyles.questionsBanner, themeStyles.questionsBanner]}>
          <Text style={[sidebarStyles.questionsTitle, themeStyles.questionsTitle]}>Open Question</Text>
          {openQuestions.map((question) => (
            <Text key={question} style={[sidebarStyles.questionsText, themeStyles.questionsText]}>
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
          themeStyles={themeStyles}
          onTranscriptDraftChange={onTranscriptDraftChange}
          onSendManualTranscript={onSendManualTranscript}
        />
      ) : null}

      {activeTab === 'chat' ? (
        <ChatPanel
          messages={room.chatMessages}
          chatDraft={chatDraft}
          chatKind={chatKind}
          themeStyles={themeStyles}
          onChatDraftChange={onChatDraftChange}
          onChatKindChange={onChatKindChange}
          onSendChat={onSendChat}
          onAddChatToPersonalization={onAddChatToPersonalization}
        />
      ) : null}

      {activeTab === 'context' ? (
        <ContextPanel
          items={room.contextItems}
          draft={contextDraft}
          themeStyles={themeStyles}
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
  themeStyles,
  onTranscriptDraftChange,
  onSendManualTranscript,
}: {
  chunks: TranscriptChunk[];
  interimTranscript: string;
  transcriptDraft: string;
  themeStyles: SidebarThemeStyles;
  onTranscriptDraftChange: (value: string) => void;
  onSendManualTranscript: () => void;
}) => {
  return (
    <View style={sidebarStyles.panel}>
      <ScrollView style={sidebarStyles.list} contentContainerStyle={sidebarStyles.listContent}>
        {chunks
          .slice()
          .reverse()
          .map((chunk) => (
            <View key={chunk.id} style={[sidebarStyles.itemCard, themeStyles.itemCard]}>
              <Text style={[sidebarStyles.itemMeta, themeStyles.itemMeta]}>
                {chunk.speaker} - {new Date(chunk.createdAt).toLocaleTimeString()}
              </Text>
              <Text style={[sidebarStyles.itemBody, themeStyles.itemBody]}>{chunk.text}</Text>
            </View>
          ))}
        {interimTranscript ? (
          <View style={[sidebarStyles.itemCard, themeStyles.interimCard]}>
            <Text style={[sidebarStyles.itemMeta, themeStyles.interimMeta]}>Live</Text>
            <Text style={[sidebarStyles.interimText, themeStyles.interimText]}>{interimTranscript}</Text>
          </View>
        ) : null}
      </ScrollView>
      <View style={[sidebarStyles.composeArea, themeStyles.composeArea]}>
        <Text style={[sidebarStyles.composeLabel, themeStyles.composeLabel]}>Manual transcript fallback</Text>
        <TextInput
          value={transcriptDraft}
          onChangeText={onTranscriptDraftChange}
          placeholder="Type transcript chunk and send"
          placeholderTextColor={themeStyles.placeholderColor}
          style={[sidebarStyles.input, themeStyles.input]}
        />
        <Pressable style={[sidebarStyles.primaryButton, themeStyles.primaryButton]} onPress={onSendManualTranscript}>
          <Text style={[sidebarStyles.primaryButtonText, themeStyles.primaryButtonText]}>Send chunk</Text>
        </Pressable>
      </View>
    </View>
  );
};

const ChatPanel = ({
  messages,
  chatDraft,
  chatKind,
  themeStyles,
  onChatDraftChange,
  onChatKindChange,
  onSendChat,
  onAddChatToPersonalization,
}: {
  messages: ChatMessage[];
  chatDraft: string;
  chatKind: NoteKind;
  themeStyles: SidebarThemeStyles;
  onChatDraftChange: (value: string) => void;
  onChatKindChange: (value: NoteKind) => void;
  onSendChat: () => void;
  onAddChatToPersonalization: () => void;
}) => {
  return (
    <View style={sidebarStyles.panel}>
      <ScrollView style={sidebarStyles.list} contentContainerStyle={sidebarStyles.listContent}>
        {messages
          .slice()
          .reverse()
          .map((message) => (
            <View key={message.id} style={[sidebarStyles.itemCard, themeStyles.itemCard]}>
              <Text style={[sidebarStyles.itemMeta, themeStyles.itemMeta]}>
                {message.authorName} - {message.kind.toUpperCase()}
              </Text>
              <Text style={[sidebarStyles.itemBody, themeStyles.itemBody]}>{message.text}</Text>
            </View>
          ))}
      </ScrollView>
      <View style={[sidebarStyles.composeArea, themeStyles.composeArea]}>
        <TextInput
          value={chatDraft}
          onChangeText={onChatDraftChange}
          placeholder="Type note or correction"
          placeholderTextColor={themeStyles.placeholderColor}
          style={[sidebarStyles.input, themeStyles.input]}
          multiline
        />
        <View style={sidebarStyles.pillRow}>
          <KindPill
            label="Normal"
            value="normal"
            current={chatKind}
            onChange={(value) => onChatKindChange(value as NoteKind)}
            themeStyles={themeStyles}
          />
          <KindPill
            label="Correction"
            value="correction"
            current={chatKind}
            onChange={(value) => onChatKindChange(value as NoteKind)}
            themeStyles={themeStyles}
          />
          <KindPill
            label="Suggestion"
            value="suggestion"
            current={chatKind}
            onChange={(value) => onChatKindChange(value as NoteKind)}
            themeStyles={themeStyles}
          />
        </View>
        <View style={sidebarStyles.actionButtonRow}>
          <Pressable style={[sidebarStyles.primaryButton, sidebarStyles.flexButton, themeStyles.primaryButton]} onPress={onSendChat}>
            <Text style={[sidebarStyles.primaryButtonText, themeStyles.primaryButtonText]}>Send to AI</Text>
          </Pressable>
          <Pressable
            style={[sidebarStyles.secondaryActionButton, sidebarStyles.flexButton, themeStyles.secondaryActionButton]}
            onPress={onAddChatToPersonalization}>
            <Text style={[sidebarStyles.secondaryActionButtonText, themeStyles.secondaryActionButtonText]}>
              Add to personalization
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
};

const ContextPanel = ({
  items,
  draft,
  themeStyles,
  onDraftChange,
  onAdd,
}: {
  items: RoomState['contextItems'];
  draft: ContextDraft;
  themeStyles: SidebarThemeStyles;
  onDraftChange: (value: ContextDraft) => void;
  onAdd: () => void;
}) => {
  return (
    <View style={sidebarStyles.panel}>
      <ScrollView style={sidebarStyles.list} contentContainerStyle={sidebarStyles.listContent}>
        {items
          .slice()
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .map((item) => (
            <View key={item.id} style={[sidebarStyles.itemCard, themeStyles.itemCard]}>
              <Text style={[sidebarStyles.itemMeta, themeStyles.itemMeta]}>
                {item.pinned ? 'PINNED - ' : ''}
                {item.priority.toUpperCase()} - {item.scope}
              </Text>
              <Text style={[sidebarStyles.itemTitle, themeStyles.itemTitle]}>{item.title}</Text>
              <Text style={[sidebarStyles.itemBody, themeStyles.secondaryItemBody]}>{item.content}</Text>
            </View>
          ))}
      </ScrollView>
      <View style={[sidebarStyles.composeArea, themeStyles.composeArea]}>
        <TextInput
          value={draft.title}
          onChangeText={(value) => onDraftChange({ ...draft, title: value })}
          placeholder="Context title"
          placeholderTextColor={themeStyles.placeholderColor}
          style={[sidebarStyles.input, themeStyles.input]}
        />
        <TextInput
          value={draft.content}
          onChangeText={(value) => onDraftChange({ ...draft, content: value })}
          placeholder="Context content"
          placeholderTextColor={themeStyles.placeholderColor}
          style={[sidebarStyles.input, sidebarStyles.multiInput, themeStyles.input]}
          multiline
        />
        <View style={sidebarStyles.pillRow}>
          <KindPill
            label="Priority: Normal"
            value="normal"
            current={draft.priority}
            themeStyles={themeStyles}
            onChange={(value) => onDraftChange({ ...draft, priority: value as ContextPriority })}
          />
          <KindPill
            label="Priority: High"
            value="high"
            current={draft.priority}
            themeStyles={themeStyles}
            onChange={(value) => onDraftChange({ ...draft, priority: value as ContextPriority })}
          />
        </View>
        <View style={sidebarStyles.pillRow}>
          <KindPill
            label="Scope: Global"
            value="global"
            current={draft.scope}
            themeStyles={themeStyles}
            onChange={(value) => onDraftChange({ ...draft, scope: value as ContextScope })}
          />
          <KindPill
            label="Scope: Topic"
            value="topic"
            current={draft.scope}
            themeStyles={themeStyles}
            onChange={(value) => onDraftChange({ ...draft, scope: value as ContextScope })}
          />
          <KindPill
            label={draft.pinned ? 'Pinned' : 'Unpinned'}
            value={draft.pinned ? 'pinned' : 'unpinned'}
            current={draft.pinned ? 'pinned' : 'unpinned'}
            themeStyles={themeStyles}
            onChange={() => onDraftChange({ ...draft, pinned: !draft.pinned })}
          />
        </View>
        <Pressable style={[sidebarStyles.primaryButton, themeStyles.primaryButton]} onPress={onAdd}>
          <Text style={[sidebarStyles.primaryButtonText, themeStyles.primaryButtonText]}>Add context item</Text>
        </Pressable>
      </View>
    </View>
  );
};

const TabButton = ({
  label,
  active,
  onPress,
  themeStyles,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  themeStyles: SidebarThemeStyles;
}) => (
  <Pressable
    style={({ pressed }) => [
      sidebarStyles.tabButton,
      active && sidebarStyles.tabButtonActive,
      active && themeStyles.tabButtonActive,
      pressed && sidebarStyles.pressed,
    ]}
    onPress={onPress}>
    <Text
      style={[
        sidebarStyles.tabText,
        themeStyles.tabText,
        active && sidebarStyles.tabTextActive,
        active && themeStyles.tabTextActive,
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
  themeStyles,
}: {
  label: string;
  value: string;
  current: string;
  onChange: (value: string) => void;
  themeStyles: SidebarThemeStyles;
}) => (
  <Pressable
    style={({ pressed }) => [
      sidebarStyles.kindPill,
      themeStyles.kindPill,
      current === value && sidebarStyles.kindPillActive,
      current === value && themeStyles.kindPillActive,
      pressed && sidebarStyles.pressed,
    ]}
    onPress={() => onChange(value)}>
    <Text
      style={[
        sidebarStyles.kindPillText,
        themeStyles.kindPillText,
        current === value && sidebarStyles.kindPillTextActive,
        current === value && themeStyles.kindPillTextActive,
      ]}>
      {label}
    </Text>
  </Pressable>
);
