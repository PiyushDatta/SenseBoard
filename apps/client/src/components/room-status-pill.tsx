import { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { SenseTheme } from '../lib/theme';
import { createRoomStatusPillThemeStyles, roomStatusPillStyles } from '../styles/room-status-pill.styles';

interface RoomStatusPillProps {
  roomId: string;
  displayName: string;
  totalConnectedMembers: number;
  connected: boolean;
  aiStatus: string;
  boardMode: 'main' | 'personal';
  theme: SenseTheme;
  onBoardModeChange: (mode: 'main' | 'personal') => void;
}

export const RoomStatusPill = ({
  roomId,
  displayName,
  totalConnectedMembers,
  connected,
  aiStatus,
  boardMode,
  theme,
  onBoardModeChange,
}: RoomStatusPillProps) => {
  const themeStyles = useMemo(() => createRoomStatusPillThemeStyles(theme), [theme]);

  return (
    <View style={[roomStatusPillStyles.statusPill, themeStyles.statusPill]}>
      <Text style={[roomStatusPillStyles.statusText, themeStyles.statusText]}>Room {roomId}</Text>
      <Text style={[roomStatusPillStyles.statusSubText, themeStyles.statusSubText]}>Current user: {displayName || 'Guest'}</Text>
      <Text style={[roomStatusPillStyles.statusSubText, themeStyles.statusSubText]}>
        Total members connected: {totalConnectedMembers}
      </Text>
      <Text style={[roomStatusPillStyles.statusSubText, themeStyles.statusSubtleText]}>
        {connected ? 'Connected' : 'Reconnecting'} | AI {aiStatus}
      </Text>
      <View style={roomStatusPillStyles.boardToggleRow}>
        <Text style={[roomStatusPillStyles.boardToggleLabel, themeStyles.statusSubText]}>Board view:</Text>
        <Pressable
          onPress={() => onBoardModeChange('main')}
          style={({ pressed }) => [
            roomStatusPillStyles.boardToggleChip,
            themeStyles.boardToggleChip(boardMode === 'main'),
            pressed && roomStatusPillStyles.boardTogglePressed,
          ]}>
          <Text style={[roomStatusPillStyles.boardToggleText, themeStyles.boardToggleText(boardMode === 'main')]}>Main</Text>
        </Pressable>
        <Pressable
          onPress={() => onBoardModeChange('personal')}
          style={({ pressed }) => [
            roomStatusPillStyles.boardToggleChip,
            themeStyles.boardToggleChip(boardMode === 'personal'),
            pressed && roomStatusPillStyles.boardTogglePressed,
          ]}>
          <Text style={[roomStatusPillStyles.boardToggleText, themeStyles.boardToggleText(boardMode === 'personal')]}>
            Personal
          </Text>
        </Pressable>
      </View>
    </View>
  );
};
