import { useMemo } from 'react';
import { Text, View } from 'react-native';

import type { RoomState } from '../../../shared/types';
import type { SenseTheme } from '../lib/theme';
import { createDebugPanelThemeStyles, debugPanelStyles } from '../styles/debug-panel.styles';

interface DebugPanelProps {
  room: RoomState;
  error: string | null;
  theme: SenseTheme;
}

export const DebugPanel = ({ room, error, theme }: DebugPanelProps) => {
  const themeStyles = useMemo(() => createDebugPanelThemeStyles(theme), [theme]);

  return (
    <View style={[debugPanelStyles.panel, themeStyles.panel]}>
      <Text style={[debugPanelStyles.title, themeStyles.title]}>Debug</Text>
      <Text style={[debugPanelStyles.body, themeStyles.body]}>Active group: {room.activeGroupId}</Text>
      <Text style={[debugPanelStyles.body, themeStyles.body]}>Pinned groups: {room.aiConfig.pinnedGroupIds.length}</Text>
      <Text style={[debugPanelStyles.body, themeStyles.body]}>Transcript chunks: {room.transcriptChunks.length}</Text>
      <Text style={[debugPanelStyles.body, themeStyles.body]}>Chat messages: {room.chatMessages.length}</Text>
      <Text style={[debugPanelStyles.body, themeStyles.body]}>Context items: {room.contextItems.length}</Text>
      <Text style={[debugPanelStyles.body, themeStyles.body]}>Diagram groups: {Object.keys(room.diagramGroups).length}</Text>
      <Text style={[debugPanelStyles.body, themeStyles.body]}>Archived groups: {room.archivedGroups.length}</Text>
      {error ? <Text style={[debugPanelStyles.error, themeStyles.error]}>Error: {error}</Text> : null}
    </View>
  );
};
