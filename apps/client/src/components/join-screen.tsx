import { useMemo } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import type { SenseTheme, ThemeMode } from '../lib/theme';
import { createJoinScreenThemeStyles, joinScreenStyles } from '../styles/join-screen.styles';

interface JoinScreenProps {
  displayName: string;
  roomId: string;
  error: string | null;
  loading: boolean;
  theme: SenseTheme;
  themeMode: ThemeMode;
  resolvedTheme: 'light' | 'dark';
  onThemeModeChange: (mode: ThemeMode) => void;
  onDisplayNameChange: (value: string) => void;
  onRoomIdChange: (value: string) => void;
  onCreateRoom: () => void;
  onJoinRoom: () => void;
}

type JoinScreenThemeStyles = ReturnType<typeof createJoinScreenThemeStyles>;

export const JoinScreen = ({
  displayName,
  roomId,
  error,
  loading,
  theme,
  themeMode,
  resolvedTheme,
  onThemeModeChange,
  onDisplayNameChange,
  onRoomIdChange,
  onCreateRoom,
  onJoinRoom,
}: JoinScreenProps) => {
  const themeStyles = useMemo(() => createJoinScreenThemeStyles(theme), [theme]);

  return (
    <View style={[joinScreenStyles.page, themeStyles.page]}>
      <View style={[joinScreenStyles.heroBadge, themeStyles.heroBadge]}>
        <Text style={[joinScreenStyles.heroBadgeText, themeStyles.heroBadgeText]}>
          Theme: {resolvedTheme.toUpperCase()}
        </Text>
        <View style={[joinScreenStyles.modeSwitcher, themeStyles.modeSwitcher]}>
          <ModeChip label="Auto" value="auto" active={themeMode === 'auto'} themeStyles={themeStyles} onPress={onThemeModeChange} />
          <ModeChip label="Light" value="light" active={themeMode === 'light'} themeStyles={themeStyles} onPress={onThemeModeChange} />
          <ModeChip label="Dark" value="dark" active={themeMode === 'dark'} themeStyles={themeStyles} onPress={onThemeModeChange} />
        </View>
      </View>

      <View style={[joinScreenStyles.card, themeStyles.card]}>
        <Text style={[joinScreenStyles.brand, themeStyles.brand]}>SenseBoard</Text>
        <Text style={[joinScreenStyles.tagline, themeStyles.tagline]}>Your hang, illustrated live.</Text>

        <Text style={[joinScreenStyles.label, themeStyles.label]}>Display name</Text>
        <TextInput
          value={displayName}
          onChangeText={onDisplayNameChange}
          placeholder="Alex"
          placeholderTextColor={themeStyles.placeholderColor}
          style={[joinScreenStyles.input, themeStyles.input]}
        />

        <Text style={[joinScreenStyles.label, themeStyles.label]}>Room code</Text>
        <TextInput
          value={roomId}
          onChangeText={(value) => onRoomIdChange(value.toUpperCase())}
          placeholder="ABC123"
          placeholderTextColor={themeStyles.placeholderColor}
          autoCapitalize="characters"
          style={[joinScreenStyles.input, themeStyles.input]}
        />

        {error ? <Text style={[joinScreenStyles.error, themeStyles.error]}>{error}</Text> : null}
        {loading ? <Text style={[joinScreenStyles.info, themeStyles.info]}>Contacting SenseBoard server...</Text> : null}

        <View style={joinScreenStyles.buttonRow}>
          <Pressable
            onPress={onCreateRoom}
            disabled={loading}
            style={({ pressed }) => [
              joinScreenStyles.primaryButton,
              themeStyles.primaryButton,
              pressed && joinScreenStyles.buttonPressed,
              loading && joinScreenStyles.buttonDisabled,
            ]}>
            <Text style={[joinScreenStyles.primaryButtonText, themeStyles.primaryButtonText]}>
              {loading ? 'Working...' : 'Create room'}
            </Text>
          </Pressable>
          <Pressable
            onPress={onJoinRoom}
            disabled={loading}
            style={({ pressed }) => [
              joinScreenStyles.secondaryButton,
              themeStyles.secondaryButton,
              pressed && joinScreenStyles.buttonPressed,
              loading && joinScreenStyles.buttonDisabled,
            ]}>
            <Text style={[joinScreenStyles.secondaryButtonText, themeStyles.secondaryButtonText]}>Join room</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
};

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
  themeStyles: JoinScreenThemeStyles;
  onPress: (mode: ThemeMode) => void;
}) => (
  <Pressable
    onPress={() => onPress(value)}
    style={({ pressed }) => [
      joinScreenStyles.modeChip,
      themeStyles.modeChip(active),
      pressed && joinScreenStyles.buttonPressed,
    ]}>
    <Text style={[joinScreenStyles.modeChipText, themeStyles.modeChipText(active)]}>{label}</Text>
  </Pressable>
);
