import type { FocusBox, RoomState } from '../../../shared/types';
import { View, Text, StyleSheet } from 'react-native';
import type { SenseTheme } from '../lib/theme';

export interface CanvasSurfaceProps {
  room?: RoomState | null;
  focusDrawMode?: boolean;
  onFocusBoxSelected?: (box: FocusBox) => void;
  onFocusDrawModeChange?: (value: boolean) => void;
  showAiNotes?: boolean;
  unsupportedReason?: string;
  theme?: SenseTheme;
}

export const CanvasSurface = ({ unsupportedReason, theme }: CanvasSurfaceProps) => {
  return (
    <View
      style={[
        styles.container,
        {
          borderColor: theme?.colors.panelBorder ?? '#D7E1EB',
          backgroundColor: theme?.colors.panelMuted ?? '#F7FAFF',
        },
      ]}>
      <Text style={[styles.title, { color: theme?.colors.textPrimary ?? '#1B2D3D', fontFamily: theme?.fonts.heading }]}>
        Canvas unavailable on this platform.
      </Text>
      {unsupportedReason ? (
        <Text style={[styles.body, { color: theme?.colors.textSecondary ?? '#3B4A56', fontFamily: theme?.fonts.body }]}>
          {unsupportedReason}
        </Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
  },
  body: {
    marginTop: 8,
    textAlign: 'center',
  },
});
