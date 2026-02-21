import { useMemo } from 'react';
import { Text, View } from 'react-native';

import type { SenseTheme } from '../lib/theme';
import { createRoomStatusPillThemeStyles, roomStatusPillStyles } from '../styles/room-status-pill.styles';

interface RoomStatusPillProps {
  roomId: string;
  displayName: string;
  totalConnectedMembers: number;
  connected: boolean;
  aiStatus: string;
  theme: SenseTheme;
}

export const RoomStatusPill = ({
  roomId,
  displayName,
  totalConnectedMembers,
  connected,
  aiStatus,
  theme,
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
    </View>
  );
};
