import type { FocusBox, RoomState } from '../../../shared/types';
import { Text, View } from 'react-native';
import type { SenseTheme } from '../lib/theme';
import { canvasSurfaceStyles, createCanvasSurfaceThemeStyles } from '../styles/canvas-surface.styles';

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
  const themeStyles = createCanvasSurfaceThemeStyles(theme);

  return (
    <View style={[canvasSurfaceStyles.container, themeStyles.container]}>
      <Text style={[canvasSurfaceStyles.title, themeStyles.title]}>
        Canvas unavailable on this platform.
      </Text>
      {unsupportedReason ? (
        <Text style={[canvasSurfaceStyles.body, themeStyles.body]}>
          {unsupportedReason}
        </Text>
      ) : null}
    </View>
  );
};
